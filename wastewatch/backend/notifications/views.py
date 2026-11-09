from django.db.models import Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer


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
def notification_list(request):
    """
    GET /api/notifications/
    Returns all notifications visible to the requesting user, newest first.
    """
    qs = _notifications_for_user(request.user)
    serializer = NotificationSerializer(qs, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def notification_unread(request):
    """
    GET /api/notifications/unread/
    Returns only unread notifications for the requesting user.
    Also returns the unread count as a top-level field for badge use.
    """
    qs = _notifications_for_user(request.user).filter(is_read=False)
    serializer = NotificationSerializer(qs, many=True)
    return Response({
        'count':  qs.count(),
        'results': serializer.data,
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def notification_mark_read(request):
    """
    POST /api/notifications/read/
    Body: { "ids": [1, 2, 3] }   ← mark specific notifications read
          {}                      ← mark ALL visible notifications read

    Only marks notifications the user is actually allowed to see.
    Returns the count of rows updated.
    """
    ids = request.data.get('ids')
    qs  = _notifications_for_user(request.user).filter(is_read=False)

    if ids is not None:
        if not isinstance(ids, list):
            return Response(
                {'error': '`ids` must be a list of integers.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        qs = qs.filter(id__in=ids)

    updated = qs.update(is_read=True)
    return Response({'marked_read': updated})

import uuid
from django.db import transaction
from accounts.models import Barangay
from accounts.permissions import IsAdminRole, IsAdminRoleOrReadOnly, is_admin_user
from .models import Notification, NotificationType


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class   = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminRoleOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        if is_admin_user(user):
            qs = Notification.objects.select_related('barangay').order_by('-created_at')
            if self.request.query_params.get('broadcast') == '1':
                qs = qs.filter(broadcast_id__isnull=False)
            return qs
        return _notifications_for_user(user).select_related('barangay').order_by('-created_at')

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