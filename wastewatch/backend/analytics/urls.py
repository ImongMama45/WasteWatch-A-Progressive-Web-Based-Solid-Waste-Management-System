from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    SystemKPIViewSet, 
    TruckPerformanceViewSet, 
    BarangayPerformanceViewSet, 
    IssueTrendViewSet,
    ActivityLogViewSet
)

router = DefaultRouter()
router.register(r'kpi', SystemKPIViewSet)
router.register(r'truck-performance', TruckPerformanceViewSet)
router.register(r'barangay-performance', BarangayPerformanceViewSet)
router.register(r'trends', IssueTrendViewSet)
router.register(r'activity-logs', ActivityLogViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
