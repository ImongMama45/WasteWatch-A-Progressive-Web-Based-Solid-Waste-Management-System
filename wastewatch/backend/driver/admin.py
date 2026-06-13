from django.contrib import admin
from .models import (
    Truck,
    Dumpsite,
    CollectionSchedule,
    RouteAssignment,
    PickupStatus,
    TruckLocation,
    CompletionReport,
)

admin.site.register(Truck)
admin.site.register(Dumpsite)
admin.site.register(CollectionSchedule)
admin.site.register(RouteAssignment)
admin.site.register(PickupStatus)
admin.site.register(TruckLocation)
admin.site.register(CompletionReport)
