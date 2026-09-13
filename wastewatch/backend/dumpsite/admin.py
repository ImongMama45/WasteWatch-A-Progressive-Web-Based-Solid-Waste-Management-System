from django.contrib import admin
from .models import (
    Dumpsite,
    WasteDelivery,
    TruckFillEstimate,
    DumpsiteIncident,
)

admin.site.register(Dumpsite)
admin.site.register(WasteDelivery)
admin.site.register(TruckFillEstimate)
admin.site.register(DumpsiteIncident)
