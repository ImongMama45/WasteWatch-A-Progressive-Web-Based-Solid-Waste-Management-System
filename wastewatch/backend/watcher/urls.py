from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'reports', views.GarbageReportViewSet, basename='report')
router.register(r'confirmations', views.CollectionConfirmationViewSet, basename='confirmation')
router.register(r'hotspots', views.GarbageHotspotViewSet, basename='hotspot')
router.register(r'interventions', views.HotspotInterventionViewSet, basename='intervention')
router.register(r'escalations', views.EscalationViewSet, basename='escalation')
router.register(r'stop-validations', views.StopValidationViewSet, basename='stop-validation')
router.register(r'spots', views.WatcherReportedSpotViewSet, basename='watcher-spot')

urlpatterns = router.urls
