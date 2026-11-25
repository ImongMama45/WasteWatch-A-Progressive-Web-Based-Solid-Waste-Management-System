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
router.register(r'workers',             views.WorkerViewSet, basename='workers')
router.register(r'worker-reconciliations', views.WorkerReconciliationViewSet, basename='worker-reconciliations')
router.register(r'teams',               views.SanitationTeamViewSet, basename='teams')
router.register(r'team-memberships',    views.SanitationTeamMembershipViewSet, basename='team-memberships')
router.register(r'schedule-team-overrides', views.ScheduleTeamOverrideViewSet, basename='schedule-team-overrides')
router.register(r'schedule-truck-allocations', views.ScheduleTruckAllocationViewSet, basename='schedule-truck-allocations')
router.register(r'watcher-shifts',          views.WatcherShiftViewSet, basename='watcher-shifts')
router.register(r'crew-shifts',             views.CrewShiftViewSet, basename='crew-shift')
router.register(r'unfinished-stop-reviews', views.UnfinishedStopReviewViewSet, basename='unfinished-stop-reviews')
router.register(r'truck-replacement-requests', views.TruckReplacementRequestViewSet, basename='truck-replacement-requests')
router.register(r'truck-holds', views.TruckOperationalHoldLogViewSet, basename='truck-holds')
router.register(r'maintenance-records', views.TruckMaintenanceRecordViewSet, basename='maintenance-records')
router.register(r'fuel-logs', views.FuelLogViewSet, basename='fuel-logs')

from django.urls import path

urlpatterns = [
    path('home-base/', views.HomeBaseView.as_view(), name='home-base'),
] + router.urls
