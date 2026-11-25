from django.urls import path
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

urlpatterns = [
    path(
        'crew-attendance/deployments/',
        views.WatcherCrewAttendanceDeploymentsView.as_view(),
        name='watcher-crew-deployments',
    ),
    path(
        'crew-attendance/deployments/<int:schedule_id>/',
        views.WatcherCrewAttendanceDetailView.as_view(),
        name='watcher-crew-deployment-detail',
    ),
    path(
        'crew-attendance/deployments/<int:schedule_id>/submit/',
        views.WatcherCrewAttendanceSubmitView.as_view(),
        name='watcher-crew-deployment-submit',
    ),
    path(
        'crew-attendance/deployments/<int:schedule_id>/correct/',
        views.WatcherCrewAttendanceCorrectView.as_view(),
        name='watcher-crew-deployment-correct',
    ),
] + router.urls
