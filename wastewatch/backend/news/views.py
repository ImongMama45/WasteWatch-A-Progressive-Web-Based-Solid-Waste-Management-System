from rest_framework import viewsets, permissions, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q

from accounts.permissions import IsAdminRole, IsAdminRoleOrReadOnly, is_admin_user
from .models import NewsItem, EmergencyAlert, BarangaySpotlight, ContentStatus
from .serializers import (
    NewsItemSerializer,
    EmergencyAlertSerializer,
    BarangaySpotlightSerializer,
)
from notifications.services import notify_announcement, notify_emergency_alert


class NewsItemViewSet(viewsets.ModelViewSet):
    queryset = NewsItem.objects.all()
    serializer_class = NewsItemSerializer
    permission_classes = [IsAdminRoleOrReadOnly]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['date', 'updated_at', 'priority', 'is_pinned', 'title', 'status']

    def get_queryset(self):
        is_admin = is_admin_user(self.request.user)
        admin_mode = self.request.query_params.get('admin_mode') == 'true'
        status_param = self.request.query_params.get('status')

        if is_admin and (admin_mode or status_param is not None or self.action in ['retrieve', 'admin_stats', 'publish_item', 'unpublish_item', 'archive_item', 'restore_item']):
            if status_param and status_param != 'all':
                qs = NewsItem.objects.filter(status=status_param)
            else:
                qs = NewsItem.objects.all()
        else:
            # Public and non-admin queries strictly see published, active items only
            qs = NewsItem.objects.filter(is_active=True, status=ContentStatus.PUBLISHED)

        qs = qs.select_related('barangay', 'author')

        # ?barangay_id=<pk> | 'citywide'
        barangay_id = self.request.query_params.get('barangay_id')
        if barangay_id:
            if barangay_id == 'citywide':
                qs = qs.filter(barangay__isnull=True)
            elif admin_mode:
                qs = qs.filter(barangay_id=barangay_id)
            else:
                # City-wide items PLUS items for that specific barangay
                qs = qs.filter(Q(barangay__isnull=True) | Q(barangay_id=barangay_id))

        # ?city_wide=true  — only global items
        if self.request.query_params.get('city_wide') == 'true':
            qs = qs.filter(barangay__isnull=True)

        # ?type=announcement|news|emergency
        news_type = self.request.query_params.get('type')
        if news_type:
            qs = qs.filter(type=news_type)

        # ?category=<cat>
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)

        # ?priority=low|medium|high
        priority = self.request.query_params.get('priority')
        if priority:
            qs = qs.filter(priority=priority)

        # ?pinned=true
        if self.request.query_params.get('pinned') == 'true':
            qs = qs.filter(is_pinned=True)

        # ?search=<term>
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(description__icontains=search))

        return qs

    def perform_create(self, serializer):
        user = self.request.user
        author = user if user.is_authenticated else None

        # FormData sends booleans as strings — coerce them here
        data = serializer.validated_data
        for field in ('is_pinned', 'is_featured', 'is_active'):
            if field in data and isinstance(data[field], str):
                data[field] = data[field].lower() == 'true'

        if hasattr(user, 'role') and user.role == 'brgy_official':
            # Force the user's own barangay, ignoring anything the client sent
            data.pop('barangay', None)
            instance = serializer.save(barangay=user.barangay, author=author)
        else:
            instance = serializer.save(author=author)

        # Only notify when the post is published and active
        if instance.status == ContentStatus.PUBLISHED and instance.is_active:
            notify_announcement(instance)

    def perform_update(self, serializer):
        old_instance = self.get_object()
        was_published = (old_instance.status == ContentStatus.PUBLISHED and old_instance.is_active)
        instance = serializer.save()
        is_now_published = (instance.status == ContentStatus.PUBLISHED and instance.is_active)

        # Notify only when newly published to avoid spamming recipients on minor edits
        if is_now_published and not was_published:
            notify_announcement(instance)

    @action(detail=False, methods=['get'], url_path='admin-stats', permission_classes=[IsAdminRole])
    def admin_stats(self, request):
        """
        GET /api/news/items/admin-stats/
        Returns aggregate count metrics for the Admin Content Management Workspace.
        """
        total = NewsItem.objects.count()
        published = NewsItem.objects.filter(status=ContentStatus.PUBLISHED).count()
        drafts = NewsItem.objects.filter(status=ContentStatus.DRAFT).count()
        archived = NewsItem.objects.filter(status=ContentStatus.ARCHIVED).count()
        active_alerts = EmergencyAlert.objects.filter(is_active=True).count()
        total_alerts = EmergencyAlert.objects.count()

        return Response({
            'total': total,
            'published': published,
            'drafts': drafts,
            'archived': archived,
            'active_alerts': active_alerts,
            'total_alerts': total_alerts,
        })

    @action(detail=True, methods=['post'], url_path='publish', permission_classes=[IsAdminRole])
    def publish_item(self, request, pk=None):
        """
        POST /api/news/items/<pk>/publish/
        Transitions a news item to published status and notifies recipients.
        """
        item = self.get_object()
        was_published = (item.status == ContentStatus.PUBLISHED and item.is_active)
        item.status = ContentStatus.PUBLISHED
        item.is_active = True
        item.save()
        if not was_published:
            notify_announcement(item)
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=['post'], url_path='unpublish', permission_classes=[IsAdminRole])
    def unpublish_item(self, request, pk=None):
        """
        POST /api/news/items/<pk>/unpublish/
        Transitions a news item back to draft.
        """
        item = self.get_object()
        item.status = ContentStatus.DRAFT
        item.is_active = False
        item.save()
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=['post'], url_path='archive', permission_classes=[IsAdminRole])
    def archive_item(self, request, pk=None):
        """
        POST /api/news/items/<pk>/archive/
        Transitions a news item to archived status.
        """
        item = self.get_object()
        item.status = ContentStatus.ARCHIVED
        item.is_active = False
        item.save()
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=['post'], url_path='restore', permission_classes=[IsAdminRole])
    def restore_item(self, request, pk=None):
        """
        POST /api/news/items/<pk>/restore/
        Restores an archived item to draft or published.
        """
        item = self.get_object()
        target_status = request.data.get('status', ContentStatus.DRAFT)
        if target_status not in [ContentStatus.DRAFT, ContentStatus.PUBLISHED]:
            target_status = ContentStatus.DRAFT
        item.status = target_status
        item.is_active = (target_status == ContentStatus.PUBLISHED)
        item.save()
        if item.is_active:
            notify_announcement(item)
        return Response(self.get_serializer(item).data)

    @action(detail=False, methods=['get'], url_path='for-dashboard')
    def for_dashboard(self, request):
        """
        GET /api/news/items/for-dashboard/
        Returns latest 5 announcements visible to the requesting user.
        City-wide + user's own barangay (if set).
        """
        q = Q(barangay__isnull=True)
        if request.user.is_authenticated and request.user.barangay_id:
            q |= Q(barangay_id=request.user.barangay_id)

        items = (
            NewsItem.objects
            .filter(is_active=True, status=ContentStatus.PUBLISHED)
            .filter(q)
            .select_related('barangay')
            .order_by('-is_pinned', '-date')[:5]
        )
        return Response(NewsItemSerializer(items, many=True).data)


class EmergencyAlertViewSet(viewsets.ModelViewSet):
    queryset           = EmergencyAlert.objects.all()
    serializer_class   = EmergencyAlertSerializer
    permission_classes = [IsAdminRoleOrReadOnly]

    def get_queryset(self):
        is_admin = is_admin_user(self.request.user)
        include_inactive = self.request.query_params.get('include_inactive') == 'true'
        admin_mode = self.request.query_params.get('admin_mode') == 'true'

        if is_admin and (include_inactive or admin_mode or self.action in ['retrieve', 'toggle_active']):
            return EmergencyAlert.objects.all().order_by('-date', '-updated_at')
        return EmergencyAlert.objects.filter(is_active=True).order_by('-date', '-updated_at')

    def perform_create(self, serializer):
        instance = serializer.save()
        if instance.is_active:
            notify_emergency_alert(instance)

    def perform_update(self, serializer):
        old_alert = self.get_object()
        was_active = old_alert.is_active
        instance = serializer.save()
        if instance.is_active and not was_active:
            notify_emergency_alert(instance)

    @action(detail=True, methods=['post'], url_path='toggle-active', permission_classes=[IsAdminRole])
    def toggle_active(self, request, pk=None):
        alert = self.get_object()
        alert.is_active = not alert.is_active
        alert.save()
        if alert.is_active:
            notify_emergency_alert(alert)
        return Response(self.get_serializer(alert).data)


class BarangaySpotlightViewSet(viewsets.ModelViewSet):
    queryset           = BarangaySpotlight.objects.select_related('barangay').all()
    serializer_class   = BarangaySpotlightSerializer
    permission_classes = [IsAdminRoleOrReadOnly]
