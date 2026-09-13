from rest_framework import routers
from . import views

router = routers.DefaultRouter()
router.register(r'dumpsites',           views.DumpsiteViewSet)
router.register(r'waste-deliveries',    views.WasteDeliveryViewSet)
router.register(r'dumpsite-incidents',  views.DumpsiteIncidentViewSet, basename='dumpsite-incidents')

urlpatterns = router.urls
