from rest_framework import viewsets
from .models import NewsItem, EmergencyAlert, BarangaySpotlight
from .serializers import NewsItemSerializer, EmergencyAlertSerializer, BarangaySpotlightSerializer

class NewsItemViewSet(viewsets.ModelViewSet):
    queryset = NewsItem.objects.all()
    serializer_class = NewsItemSerializer

class EmergencyAlertViewSet(viewsets.ModelViewSet):
    queryset = EmergencyAlert.objects.filter(is_active=True)
    serializer_class = EmergencyAlertSerializer

class BarangaySpotlightViewSet(viewsets.ModelViewSet):
    queryset = BarangaySpotlight.objects.all()
    serializer_class = BarangaySpotlightSerializer
