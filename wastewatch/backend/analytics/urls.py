from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    AnalyticsViewSet,
    ActivityLogViewSet
)

router = DefaultRouter()
# AnalyticsViewSet uses @action, but because of custom paths below, we can omit it from router or keep it.
# We keep it for the `dashboard` endpoint which has no custom path definition in urlpatterns here.
router.register(r'logs', ActivityLogViewSet, basename='activity-logs')
router.register(r'', AnalyticsViewSet, basename='analytics')


urlpatterns = [
    path('export/', AnalyticsViewSet.as_view({'get': 'export_csv'}), name='analytics-export'),
    path('live/', AnalyticsViewSet.as_view({'get': 'live_dashboard'}), name='analytics-live'),
    path('driver-summary/', AnalyticsViewSet.as_view({'get': 'driver_summary'}), name='analytics-driver'),
    path('', include(router.urls)),
]
