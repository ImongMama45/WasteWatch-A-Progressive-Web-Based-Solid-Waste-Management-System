from rest_framework import viewsets, permissions
from .models import SystemKPI, TruckPerformance, BarangayPerformance, IssueTrend, ActivityLog
from .serializers import (
    SystemKPISerializer, 
    TruckPerformanceSerializer, 
    BarangayPerformanceSerializer, 
    IssueTrendSerializer,
    ActivityLogSerializer
)

class SystemKPIViewSet(viewsets.ModelViewSet):
    queryset = SystemKPI.objects.all()
    serializer_class = SystemKPISerializer

class TruckPerformanceViewSet(viewsets.ModelViewSet):
    queryset = TruckPerformance.objects.all()
    serializer_class = TruckPerformanceSerializer

class BarangayPerformanceViewSet(viewsets.ModelViewSet):
    queryset = BarangayPerformance.objects.all()
    serializer_class = BarangayPerformanceSerializer

class IssueTrendViewSet(viewsets.ModelViewSet):
    queryset = IssueTrend.objects.all()
    serializer_class = IssueTrendSerializer

class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ActivityLog.objects.all().order_by('-timestamp')
    serializer_class = ActivityLogSerializer
    permission_classes = [permissions.IsAuthenticated] # Should be restricted to admin later
