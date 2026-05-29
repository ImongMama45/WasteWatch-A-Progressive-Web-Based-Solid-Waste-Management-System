from rest_framework import routers
from . import views

router = routers.DefaultRouter()
router.register(r'collection-schedules', views.CollectionScheduleViewSet)
router.register(r'route-assignments', views.RouteAssignmentViewSet)
router.register(r'pickup-statuses', views.PickupStatusViewSet)
router.register(r'truck-locations', views.TruckLocationViewSet)
router.register(r'completion-reports', views.CompletionReportViewSet)
router.register(r'notifications', views.DriverNotificationViewSet)
