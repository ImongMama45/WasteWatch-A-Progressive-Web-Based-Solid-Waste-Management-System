from rest_framework import routers
from . import views

router = routers.DefaultRouter()
router.register(r'trucks',              views.TruckViewSet)
router.register(r'dumpsites',           views.DumpsiteViewSet)
router.register(r'collection-schedules',views.CollectionScheduleViewSet)
router.register(r'route-assignments',   views.RouteAssignmentViewSet)
router.register(r'pickup-statuses',     views.PickupStatusViewSet)
router.register(r'truck-locations',     views.TruckLocationViewSet)
router.register(r'completion-reports',  views.CompletionReportViewSet)
router.register(r'notifications',       views.DriverNotificationViewSet)
router.register(r'crew-assignments',    views.TruckCrewAssignmentViewSet)
router.register(r'waste-deliveries',    views.WasteDeliveryViewSet)
router.register(r'calendar-events',     views.CalendarEventViewSet)

urlpatterns = router.urls
