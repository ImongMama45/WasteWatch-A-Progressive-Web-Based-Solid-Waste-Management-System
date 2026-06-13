from django.db.models import Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import api_view, permission_classes
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
    q = Q(user=user)
    if user.barangay_id:
        q |= Q(barangay_id=user.barangay_id, user__isnull=True)
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

class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class   = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Admins see everything; others see only their own
        user = self.request.user
        if getattr(user, 'role', None) == 'admin':
            return Notification.objects.all()
        return _notifications_for_user(user)