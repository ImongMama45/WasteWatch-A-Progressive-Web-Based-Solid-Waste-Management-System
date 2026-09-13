from rest_framework import viewsets, permissions, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q

from .models import NewsItem, EmergencyAlert, BarangaySpotlight
from .serializers import (
    NewsItemSerializer,
    EmergencyAlertSerializer,
    BarangaySpotlightSerializer,
)
from notifications.services import notify_announcement

class NewsItemViewSet(viewsets.ModelViewSet):
    queryset = NewsItem.objects.filter(is_active=True)
    serializer_class = NewsItemSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['date', 'priority', 'is_pinned']

    def get_queryset(self):
        qs = NewsItem.objects.filter(is_active=True).select_related('barangay')

        # ?barangay_id=<pk>  — explicit filter used by admin/brgy pages
        barangay_id = self.request.query_params.get('barangay_id')
        if barangay_id:
            # City-wide items PLUS items for that specific barangay
            qs = qs.filter(Q(barangay__isnull=True) | Q(barangay_id=barangay_id))

        # ?city_wide=true  — only global items
        if self.request.query_params.get('city_wide') == 'true':
            qs = qs.filter(barangay__isnull=True)

        # ?type=announcement|news|emergency
        news_type = self.request.query_params.get('type')
        if news_type:
            qs = qs.filter(type=news_type)

        # ?pinned=true
        if self.request.query_params.get('pinned') == 'true':
            qs = qs.filter(is_pinned=True)

        return qs

    def perform_create(self, serializer):
        user = self.request.user

        # FormData sends booleans as strings — coerce them here
        data = serializer.validated_data
        for field in ('is_pinned', 'is_featured', 'is_active'):
            if field in data and isinstance(data[field], str):
                data[field] = data[field].lower() == 'true'

        if hasattr(user, 'role') and user.role == 'brgy_official':
            # Force the user's own barangay, ignoring anything the client sent
            data.pop('barangay', None)
            instance = serializer.save(barangay=user.barangay)
        else:
            instance = serializer.save()

        # Only notify when the post is immediately active (not a draft)
        if instance.is_active:
            notify_announcement(instance)

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
            .filter(is_active=True)
            .filter(q)
            .select_related('barangay')
            .order_by('-is_pinned', '-date')[:5]
        )
        return Response(NewsItemSerializer(items, many=True).data)


class EmergencyAlertViewSet(viewsets.ModelViewSet):
    queryset           = EmergencyAlert.objects.filter(is_active=True)
    serializer_class   = EmergencyAlertSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]


class BarangaySpotlightViewSet(viewsets.ModelViewSet):
    queryset           = BarangaySpotlight.objects.select_related('barangay').all()
    serializer_class   = BarangaySpotlightSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]