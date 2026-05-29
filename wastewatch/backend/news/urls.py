from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import NewsItemViewSet, EmergencyAlertViewSet, BarangaySpotlightViewSet

router = DefaultRouter()
router.register(r'items', NewsItemViewSet)
router.register(r'alerts', EmergencyAlertViewSet)
router.register(r'spotlights', BarangaySpotlightViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
