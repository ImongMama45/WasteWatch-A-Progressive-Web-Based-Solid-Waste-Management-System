from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from .models import MunicipalEvent, EventStatus, EventCategory, VALID_EVENT_TRANSITIONS
from .serializers import MunicipalEventSerializer
from .services import notify_event_published, notify_event_cancelled, EventNotificationError
from accounts.permissions import is_admin_user, IsAdminRole, IsAdminRoleOrReadOnly
from accounts.models import UserRole


class MunicipalEventViewSet(viewsets.ModelViewSet):
    """
    MunicipalEventViewSet
    ---------------------
    Manages public and administrative endpoints for Municipal Events in Lucena City.
    - Public: List and retrieve published, cancelled, and completed events.
    - Admin: Full CRUD, lifecycle actions, statistics, and access to drafts and archives.
    All lifecycle transitions and notification broadcasts are executed atomically and
    concurrency-safely using database row-level locking.
    """
    queryset = MunicipalEvent.objects.all().prefetch_related('barangays')
    serializer_class = MunicipalEventSerializer
    permission_classes = [IsAdminRoleOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        is_admin = is_admin_user(user)
        qs = MunicipalEvent.objects.all().prefetch_related('barangays').distinct()

        # Non-admins can NEVER view drafts or archived events
        if not is_admin:
            qs = qs.filter(status__in=[
                EventStatus.PUBLISHED,
                EventStatus.CANCELLED,
                EventStatus.COMPLETED,
            ])
            # Barangay Officials scope enforcement
            if getattr(user, 'role', None) == UserRole.BRGY_OFFICIAL and getattr(user, 'barangay_id', None):
                user_brgy = user.barangay_id
                # Citywide events (no barangay assigned) OR events assigned to user's barangay
                qs = qs.filter(Q(barangays__isnull=True) | Q(barangays__id=user_brgy))
        else:
            # For admin, if specific status requested, filter by it
            status_param = self.request.query_params.get('status')
            if status_param and status_param != 'all':
                qs = qs.filter(status=status_param)

        # Filtering parameters applicable to both public and admin
        category_param = self.request.query_params.get('category')
        if category_param and category_param != 'all':
            qs = qs.filter(category=category_param)

        barangay_param = self.request.query_params.get('barangay')
        if barangay_param:
            if barangay_param == 'citywide':
                qs = qs.filter(barangays__isnull=True)
            elif barangay_param != 'all':
                try:
                    b_id = int(barangay_param)
                    # Show events for this barangay OR citywide events
                    qs = qs.filter(Q(barangays__id=b_id) | Q(barangays__isnull=True))
                except (ValueError, TypeError):
                    pass

        # Date range filtering
        start_date = self.request.query_params.get('start_date')
        if start_date:
            qs = qs.filter(end_datetime__gte=start_date)

        end_date = self.request.query_params.get('end_date')
        if end_date:
            qs = qs.filter(start_datetime__lte=end_date)

        # Text search across title, description, location, organizer
        search = self.request.query_params.get('search')
        if search:
            search = search.strip()
            qs = qs.filter(
                Q(title__icontains=search) |
                Q(description__icontains=search) |
                Q(location__icontains=search) |
                Q(organizer__icontains=search)
            )

        # Ordering
        ordering = self.request.query_params.get('ordering', 'start_datetime')
        if ordering in ['start_datetime', '-start_datetime', 'created_at', '-created_at', 'title', '-title']:
            qs = qs.order_by(ordering)
        else:
            qs = qs.order_by('start_datetime')

        return qs

    def create(self, request, *args, **kwargs):
        """
        Creates an event atomically. If created directly in PUBLISHED status,
        notification dispatch is executed within the same atomic transaction.
        """
        try:
            with transaction.atomic():
                serializer = self.get_serializer(data=request.data)
                serializer.is_valid(raise_exception=True)
                user = request.user
                created_by = user if user.is_authenticated else None
                instance = serializer.save(created_by=created_by)

                if instance.status == EventStatus.PUBLISHED:
                    notify_event_published(instance)

                headers = self.get_success_headers(serializer.data)
                return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
        except EventNotificationError:
            return Response(
                {'error': 'Failed to dispatch notifications. Event creation was rolled back.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def update(self, request, *args, **kwargs):
        """
        Updates an event atomically and concurrency-safely.
        Locks the record using select_for_update() and ensures notification
        dispatch and status changes are atomic.
        """
        partial = kwargs.pop('partial', False)
        pk = kwargs.get(self.lookup_field or 'pk')
        try:
            with transaction.atomic():
                instance = MunicipalEvent.objects.select_for_update().get(pk=pk)
                was_published = (instance.status == EventStatus.PUBLISHED)
                was_cancelled = (instance.status == EventStatus.CANCELLED)

                serializer = self.get_serializer(instance, data=request.data, partial=partial)
                serializer.is_valid(raise_exception=True)
                instance = serializer.save()

                if instance.status == EventStatus.PUBLISHED and not was_published:
                    notify_event_published(instance)
                elif instance.status == EventStatus.CANCELLED and not was_cancelled:
                    notify_event_cancelled(instance)

                return Response(serializer.data)
        except MunicipalEvent.DoesNotExist:
            return Response({'error': 'Event not found.'}, status=status.HTTP_404_NOT_FOUND)
        except EventNotificationError:
            return Response(
                {'error': 'Failed to dispatch notifications. Event update was rolled back.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    # ── Administrative Aggregate Metrics ─────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='admin-stats', permission_classes=[IsAdminRole])
    def admin_stats(self, request):
        now = timezone.now()
        total = MunicipalEvent.objects.count()
        published = MunicipalEvent.objects.filter(status=EventStatus.PUBLISHED).count()
        drafts = MunicipalEvent.objects.filter(status=EventStatus.DRAFT).count()
        cancelled = MunicipalEvent.objects.filter(status=EventStatus.CANCELLED).count()
        completed = MunicipalEvent.objects.filter(status=EventStatus.COMPLETED).count()
        archived = MunicipalEvent.objects.filter(status=EventStatus.ARCHIVED).count()
        upcoming = MunicipalEvent.objects.filter(status=EventStatus.PUBLISHED, start_datetime__gte=now).count()

        return Response({
            'total': total,
            'published': published,
            'drafts': drafts,
            'cancelled': cancelled,
            'completed': completed,
            'archived': archived,
            'upcoming': upcoming,
        })

    # ── Concurrency-Safe Lifecycle Management Actions ─────────────────────────
    @action(detail=True, methods=['post'], url_path='publish', permission_classes=[IsAdminRole])
    def publish_event(self, request, pk=None):
        try:
            with transaction.atomic():
                event = MunicipalEvent.objects.select_for_update().get(pk=pk)

                # Deduplication: already published, return immediately without duplicate notification
                if event.status == EventStatus.PUBLISHED:
                    return Response(self.get_serializer(event).data)

                allowed = VALID_EVENT_TRANSITIONS.get(event.status, set())
                if EventStatus.PUBLISHED not in allowed:
                    return Response(
                        {'error': f"Cannot publish event with current status '{event.status}'."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                event.status = EventStatus.PUBLISHED
                event.save()
                notify_event_published(event)

                return Response(self.get_serializer(event).data)
        except MunicipalEvent.DoesNotExist:
            return Response({'error': 'Event not found.'}, status=status.HTTP_404_NOT_FOUND)
        except EventNotificationError:
            return Response(
                {'error': 'Failed to dispatch notifications. Event publication was rolled back.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['post'], url_path='cancel', permission_classes=[IsAdminRole])
    def cancel_event(self, request, pk=None):
        try:
            with transaction.atomic():
                event = MunicipalEvent.objects.select_for_update().get(pk=pk)

                # Deduplication: already cancelled, return immediately without duplicate notification
                if event.status == EventStatus.CANCELLED:
                    return Response(self.get_serializer(event).data)

                allowed = VALID_EVENT_TRANSITIONS.get(event.status, set())
                if EventStatus.CANCELLED not in allowed:
                    return Response(
                        {'error': f"Cannot cancel event with current status '{event.status}'."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                event.status = EventStatus.CANCELLED
                event.save()
                notify_event_cancelled(event)

                return Response(self.get_serializer(event).data)
        except MunicipalEvent.DoesNotExist:
            return Response({'error': 'Event not found.'}, status=status.HTTP_404_NOT_FOUND)
        except EventNotificationError:
            return Response(
                {'error': 'Failed to dispatch cancellation notifications. Cancellation was rolled back.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['post'], url_path='complete', permission_classes=[IsAdminRole])
    def complete_event(self, request, pk=None):
        try:
            with transaction.atomic():
                event = MunicipalEvent.objects.select_for_update().get(pk=pk)
                allowed = VALID_EVENT_TRANSITIONS.get(event.status, set())
                if EventStatus.COMPLETED not in allowed:
                    return Response(
                        {'error': f"Cannot mark completed an event with current status '{event.status}'."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                event.status = EventStatus.COMPLETED
                event.save()
                return Response(self.get_serializer(event).data)
        except MunicipalEvent.DoesNotExist:
            return Response({'error': 'Event not found.'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['post'], url_path='archive', permission_classes=[IsAdminRole])
    def archive_event(self, request, pk=None):
        try:
            with transaction.atomic():
                event = MunicipalEvent.objects.select_for_update().get(pk=pk)
                allowed = VALID_EVENT_TRANSITIONS.get(event.status, set())
                if EventStatus.ARCHIVED not in allowed:
                    return Response(
                        {'error': f"Cannot archive an event with current status '{event.status}'."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                event.status = EventStatus.ARCHIVED
                event.save()
                return Response(self.get_serializer(event).data)
        except MunicipalEvent.DoesNotExist:
            return Response({'error': 'Event not found.'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['post'], url_path='restore', permission_classes=[IsAdminRole])
    def restore_event(self, request, pk=None):
        try:
            with transaction.atomic():
                event = MunicipalEvent.objects.select_for_update().get(pk=pk)
                allowed = VALID_EVENT_TRANSITIONS.get(event.status, set())
                if EventStatus.DRAFT not in allowed:
                    return Response(
                        {'error': f"Cannot restore an event with current status '{event.status}' to draft."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                event.status = EventStatus.DRAFT
                event.save()
                return Response(self.get_serializer(event).data)
        except MunicipalEvent.DoesNotExist:
            return Response({'error': 'Event not found.'}, status=status.HTTP_404_NOT_FOUND)
