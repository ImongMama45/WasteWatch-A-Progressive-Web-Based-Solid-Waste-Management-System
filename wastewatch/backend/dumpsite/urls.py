from rest_framework import routers
from . import views
from . import inspection_views

router = routers.DefaultRouter()
router.register(r'dumpsites',           views.DumpsiteViewSet)
router.register(r'waste-deliveries',    views.WasteDeliveryViewSet)
router.register(r'dumpsite-incidents',  views.DumpsiteIncidentViewSet, basename='dumpsite-incidents')
router.register(r'truck-inspections',   inspection_views.DumpsiteTruckInspectionViewSet, basename='truck-inspections')

urlpatterns = router.urls
