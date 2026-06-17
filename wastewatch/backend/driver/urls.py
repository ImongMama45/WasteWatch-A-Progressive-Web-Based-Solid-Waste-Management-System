from rest_framework import routers
from . import views

router = routers.DefaultRouter()
router.register(r'trucks',              views.TruckViewSet)
router.register(r'collection-schedules',views.CollectionScheduleViewSet)
router.register(r'route-assignments',   views.RouteAssignmentViewSet)
router.register(r'pickup-statuses',     views.PickupStatusViewSet, basename='pickup-statuses')
router.register(r'stops',               views.PickupStatusViewSet, basename='stops')
router.register(r'truck-locations',     views.TruckLocationViewSet)
router.register(r'completion-reports',  views.CompletionReportViewSet)
router.register(r'crew-assignments',    views.TruckCrewAssignmentViewSet)
router.register(r'calendar-events',     views.CalendarEventViewSet)
router.register(r'shift',               views.DriverShiftViewSet, basename='shift')

urlpatterns = router.urls
