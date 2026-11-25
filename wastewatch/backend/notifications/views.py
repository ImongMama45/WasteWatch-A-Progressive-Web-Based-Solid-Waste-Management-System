import uuid
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets, mixins
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from accounts.models import Barangay
from accounts.permissions import IsAdminRole, is_admin_user
from .models import Notification, NotificationReadReceipt, NotificationType
from .receipts import get_cutover_at, annotate_user_state, unread_filter_q
from .serializers import NotificationSerializer


class NotificationPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 50


def _notifications_for_user(user):
    """
    Returns the queryset visible to a given user:
      - notifications addressed directly to them, OR
      - barangay-wide notifications for their barangay, OR
      - system-wide notifications (both FKs null)
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return Notification.objects.none()

    q = Q(user=user)
    barangay_id = getattr(user, 'barangay_id', None)
    if barangay_id:
        q |= Q(barangay_id=barangay_id, user__isnull=True)
    q |= Q(user__isnull=True, barangay__isnull=True)
    return Notification.objects.filter(q)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def notification_unread(request):
    """
    GET /api/notifications/unread/
    Returns unread, non-archived notifications for the requesting user,
    and the accurate total count for badges.
    """
    cutover_at = get_cutover_at()
    qs = _notifications_for_user(request.user).select_related('barangay').order_by('-created_at', '-id')
    qs = annotate_user_state(qs, request.user, cutover_at)
    unread_qs = qs.filter(unread_filter_q())
    count = unread_qs.count()
    results = list(unread_qs[:10])
    serializer = NotificationSerializer(results, many=True, context={'request': request, 'cutover_at': cutover_at})
    return Response({
        'count': count,
        'results': serializer.data,
    })


def _validate_notification_ids(request, ids, allow_empty=False):
    """
    Validates requested notification IDs for receipt actions:
      - Validates payload structure and ID types (must be a list of positive integers, max 200).
      - Normalizes duplicate IDs (preserving order).
      - Verifies every requested ID belongs to the requesting user's visible notification scope,
        locking matched rows via select_for_update() within the caller's atomic transaction.
      - If even one ID is invalid, nonexistent, or inaccessible, returns an atomic HTTP 400 error.
      - Never reveals whether an inaccessible ID exists.
      - Returns (norm_ids, None) or (None, error_response).
    """
    if ids is None:
        if allow_empty:
            return None, None
        return None, Response(
            {
                'success': False,
                'error': 'Invalid notification IDs.',
                'details': {
                    'ids': ['A non-empty list of notification IDs is required.']
                },
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not isinstance(ids, list) or len(ids) == 0:
        msg = (
            '`ids` must be a non-empty list of positive integers, or omitted to mark all visible unread notifications as read.'
            if allow_empty else
            'A non-empty list of notification IDs is required.'
        )
        return None, Response(
            {
                'success': False,
                'error': 'Invalid notification IDs.',
                'details': {'ids': [msg]},
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(ids) > 200:
        return None, Response(
            {
                'success': False,
                'error': 'Invalid notification IDs.',
                'details': {
                    'ids': ['Cannot process more than 200 notification IDs at once.']
                },
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not all(isinstance(i, int) and not isinstance(i, bool) and i > 0 for i in ids):
        return None, Response(
            {
                'success': False,
                'error': 'Invalid notification IDs.',
                'details': {
                    'ids': ['One or more IDs are invalid or inaccessible.']
                },
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Normalize duplicates while preserving order
    norm_ids = list(dict.fromkeys(ids))

    # Lock matched notification rows within caller's transaction and verify scope
    visible_qs = (
        _notifications_for_user(request.user)
        .filter(id__in=norm_ids)
        .select_for_update()
    )
    visible_ids = set(visible_qs.values_list('id', flat=True))
    if len(visible_ids) != len(norm_ids):
        return None, Response(
            {
                'success': False,
                'error': 'Invalid notification IDs.',
                'details': {
                    'ids': ['One or more IDs are invalid or inaccessible.']
                },
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    return norm_ids, None


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def notification_mark_read(request):
    """
    POST /api/notifications/read/
    Body: { "ids": [1, 2, 3] }   ← mark specific notifications read
          {}                      ← mark ALL visible non-archived unread notifications read
    """
    cutover_at = get_cutover_at()
    ids = request.data.get('ids')

    with transaction.atomic():
        norm_ids, err = _validate_notification_ids(request, ids, allow_empty=True)
        if err:
            return err

        qs = _notifications_for_user(request.user)
        qs = annotate_user_state(qs, request.user, cutover_at)

        if norm_ids is not None:
            target_qs = qs.filter(id__in=norm_ids).filter(unread_filter_q())
        else:
            target_qs = qs.filter(unread_filter_q())

        target_notif_ids = list(target_qs.values_list('id', flat=True))
        if not target_notif_ids:
            return Response({
                'success': True,
                'updated_count': 0,
                'message': 'Notifications marked as read.',
            })

        # Lock rows where mark-all was used
        if norm_ids is None:
            Notification.objects.filter(id__in=target_notif_ids).select_for_update()

        now = timezone.now()
        existing_rcpts = {
            r.notification_id: r
            for r in NotificationReadReceipt.objects.select_for_update().filter(
                notification_id__in=target_notif_ids,
                user=request.user,
            )
        }
        to_create = []
        to_update_ids = []
        for nid in target_notif_ids:
            if nid in existing_rcpts:
                r = existing_rcpts[nid]
                if r.read_at is None:
                    to_update_ids.append(r.id)
            else:
                to_create.append(
                    NotificationReadReceipt(
                        notification_id=nid,
                        user=request.user,
                        read_at=now,
                        is_archived=False,
                    )
                )

        if to_create:
            NotificationReadReceipt.objects.bulk_create(to_create, ignore_conflicts=True)
        if to_update_ids:
            NotificationReadReceipt.objects.filter(id__in=to_update_ids).update(read_at=now)

        # Transition period dual-write for direct notifications belonging to user
        direct_ids = list(Notification.objects.filter(id__in=target_notif_ids, user=request.user).values_list('id', flat=True))
        if direct_ids:
            Notification.objects.filter(id__in=direct_ids).update(is_read=True)

        updated_count = len(to_create) + len(to_update_ids)

    return Response({
        'success': True,
        'updated_count': updated_count,
        'message': 'Notifications marked as read.',
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def notification_mark_unread(request):
    """
    POST /api/notifications/mark-unread/
    Body: { "ids": [1, 2, 3] }   ← mark specific notifications unread
    """
    cutover_at = get_cutover_at()
    ids = request.data.get('ids')

    with transaction.atomic():
        norm_ids, err = _validate_notification_ids(request, ids, allow_empty=False)
        if err:
            return err

        qs = _notifications_for_user(request.user)
        qs = annotate_user_state(qs, request.user, cutover_at)

        # Target effectively read, non-archived notifications within validated IDs
        target_qs = qs.filter(id__in=norm_ids, _rcpt_archived=False).exclude(unread_filter_q())
        target_notif_ids = list(target_qs.values_list('id', flat=True))
        if not target_notif_ids:
            return Response({
                'success': True,
                'updated_count': 0,
                'message': 'Notifications marked as unread.',
            })

        existing_rcpts = {
            r.notification_id: r
            for r in NotificationReadReceipt.objects.select_for_update().filter(
                notification_id__in=target_notif_ids,
                user=request.user,
            )
        }
        to_create = []
        to_update_ids = []
        for nid in target_notif_ids:
            if nid in existing_rcpts:
                r = existing_rcpts[nid]
                if r.read_at is not None:
                    to_update_ids.append(r.id)
            else:
                to_create.append(
                    NotificationReadReceipt(
                        notification_id=nid,
                        user=request.user,
                        read_at=None,
                        is_archived=False,
                    )
                )

        if to_create:
            NotificationReadReceipt.objects.bulk_create(to_create, ignore_conflicts=True)
        if to_update_ids:
            NotificationReadReceipt.objects.filter(id__in=to_update_ids).update(read_at=None)

        # Transition dual-write for direct notifications
        direct_ids = list(Notification.objects.filter(id__in=target_notif_ids, user=request.user).values_list('id', flat=True))
        if direct_ids:
            Notification.objects.filter(id__in=direct_ids).update(is_read=False)

        updated_count = len(to_create) + len(to_update_ids)

    return Response({
        'success': True,
        'updated_count': updated_count,
        'message': 'Notifications marked as unread.',
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def notification_archive(request):
    """
    POST /api/notifications/archive/
    Body: { "ids": [1, 2, 3] }
    """
    cutover_at = get_cutover_at()
    ids = request.data.get('ids')

    with transaction.atomic():
        norm_ids, err = _validate_notification_ids(request, ids, allow_empty=False)
        if err:
            return err

        qs = _notifications_for_user(request.user)
        qs = annotate_user_state(qs, request.user, cutover_at)

        target_qs = qs.filter(id__in=norm_ids, _rcpt_archived=False)
        target_notifs = list(target_qs)
        if not target_notifs:
            return Response({
                'success': True,
                'updated_count': 0,
                'message': 'Notifications archived.',
            })

        target_notif_ids = [n.id for n in target_notifs]
        existing_rcpts = {
            r.notification_id: r
            for r in NotificationReadReceipt.objects.select_for_update().filter(
                notification_id__in=target_notif_ids,
                user=request.user,
            )
        }
        to_create = []
        to_update_ids = []
        for n in target_notifs:
            if n.id in existing_rcpts:
                r = existing_rcpts[n.id]
                if not r.is_archived:
                    to_update_ids.append(r.id)
            else:
                # Set read_at to preserve effective read state: if historical shared, set to cutover_at; else None
                r_at = cutover_at if n._historical_shared else None
                to_create.append(
                    NotificationReadReceipt(
                        notification_id=n.id,
                        user=request.user,
                        read_at=r_at,
                        is_archived=True,
                    )
                )

        if to_create:
            NotificationReadReceipt.objects.bulk_create(to_create, ignore_conflicts=True)
        if to_update_ids:
            NotificationReadReceipt.objects.filter(id__in=to_update_ids).update(is_archived=True)

        updated_count = len(to_create) + len(to_update_ids)

    return Response({
        'success': True,
        'updated_count': updated_count,
        'message': 'Notifications archived.',
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def notification_unarchive(request):
    """
    POST /api/notifications/unarchive/
    Body: { "ids": [1, 2, 3] }
    """
    get_cutover_at()  # Fail closed if cutover missing
    ids = request.data.get('ids')

    with transaction.atomic():
        norm_ids, err = _validate_notification_ids(request, ids, allow_empty=False)
        if err:
            return err

        updated_count = NotificationReadReceipt.objects.select_for_update().filter(
            notification_id__in=norm_ids,
            user=request.user,
            is_archived=True,
        ).update(is_archived=False)

    return Response({
        'success': True,
        'updated_count': updated_count,
        'message': 'Notifications unarchived.',
    })


class NotificationViewSet(mixins.DestroyModelMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    pagination_class = NotificationPagination
    VALID_TABS = {'inbox', 'unread', 'archived'}

    def get_permissions(self):
        if self.action in ['destroy', 'broadcast', 'delete_broadcast']:
            return [permissions.IsAuthenticated(), IsAdminRole()]
        return [permissions.IsAuthenticated()]

    def list(self, request, *args, **kwargs):
        if request.query_params.get('broadcast') == '1':
            if not is_admin_user(request.user):
                return Response(
                    {'error': 'Admin privileges required to view broadcast management list.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            cutover_at = get_cutover_at()
            qs = Notification.objects.filter(broadcast_id__isnull=False).select_related('barangay').order_by('-created_at', '-id')[:500]
            qs = annotate_user_state(qs, request.user, cutover_at)
            serializer = self.get_serializer(qs, many=True)
            return Response(serializer.data)
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        cutover_at = get_cutover_at()
        qs = _notifications_for_user(self.request.user).select_related('barangay').order_by('-created_at', '-id')
        qs = annotate_user_state(qs, self.request.user, cutover_at)

        tab = self.request.query_params.get('tab', 'inbox')
        if tab not in self.VALID_TABS:
            raise ValidationError({'tab': ['Invalid tab parameter. Choices are: inbox, unread, archived.']})

        if tab == 'unread':
            qs = qs.filter(unread_filter_q())
        elif tab == 'archived':
            qs = qs.filter(_rcpt_archived=True)
        else:  # 'inbox' (default)
            qs = qs.filter(_rcpt_archived=False)

        return qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        try:
            context['cutover_at'] = get_cutover_at()
        except Exception:
            pass
        return context

    @action(
        detail=False,
        methods=['post'],
        url_path='broadcast',
        permission_classes=[permissions.IsAuthenticated, IsAdminRole],
    )
    def broadcast(self, request):
        title = (request.data.get('title') or '').strip()
        message = (request.data.get('message') or '').strip()
        ntype = request.data.get('type')
        barangay_ids = request.data.get('barangay_ids')

        title_max = Notification._meta.get_field('title').max_length or 200
        if not title:
            return Response({'error': 'Title is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(title) > title_max:
            return Response({'error': f'Title cannot exceed {title_max} characters.'}, status=status.HTTP_400_BAD_REQUEST)

        if not message:
            return Response({'error': 'Message is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(message) > 5000:
            return Response({'error': 'Message cannot exceed 5000 characters.'}, status=status.HTTP_400_BAD_REQUEST)

        if ntype not in [NotificationType.ANNOUNCEMENT, NotificationType.SCHEDULE_CHANGE]:
            return Response({'error': 'Invalid notification type for broadcast.'}, status=status.HTTP_400_BAD_REQUEST)

        if barangay_ids is not None:
            if (not isinstance(barangay_ids, list) or not barangay_ids or len(barangay_ids) > 200
                    or not all(isinstance(i, int) and not isinstance(i, bool) for i in barangay_ids)):
                return Response(
                    {'error': 'barangay_ids must be null (city-wide) or a non-empty list of integers.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            target_ids = sorted(set(barangay_ids))
            if Barangay.objects.filter(id__in=target_ids).count() != len(target_ids):
                return Response({'error': 'One or more barangay IDs do not exist.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            target_ids = None

        bid = uuid.uuid4()
        with transaction.atomic():
            if target_ids is None:
                Notification.objects.create(
                    title=title,
                    message=message,
                    type=ntype,
                    user=None,
                    barangay=None,
                    broadcast_id=bid,
                )
                count = 1
            else:
                rows = [
                    Notification(
                        title=title,
                        message=message,
                        type=ntype,
                        user=None,
                        barangay_id=b_id,
                        broadcast_id=bid,
                    )
                    for b_id in target_ids
                ]
                Notification.objects.bulk_create(rows)
                count = len(rows)

        return Response({'broadcast_id': str(bid), 'count': count}, status=status.HTTP_201_CREATED)

    @action(
        detail=False,
        methods=['delete'],
        url_path=r'broadcast/(?P<bid>[^/.]+)',
        permission_classes=[permissions.IsAuthenticated, IsAdminRole],
    )
    def delete_broadcast(self, request, bid=None):
        try:
            parsed_bid = uuid.UUID(str(bid), version=4)
        except (ValueError, TypeError, AttributeError):
            return Response({'error': 'Invalid broadcast UUID.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            deleted_count, _ = Notification.objects.filter(broadcast_id=parsed_bid).delete()

        if deleted_count == 0:
            return Response({'error': 'Broadcast not found.'}, status=status.HTTP_404_NOT_FOUND)

        return Response(status=status.HTTP_204_NO_CONTENT)
