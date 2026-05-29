from django.contrib import admin
from .models import (
    CollectionSchedule,
    RouteAssignment,
    PickupStatus,
    TruckLocation,
    CompletionReport,
    DriverNotification,
)

admin.site.register(CollectionSchedule)
admin.site.register(RouteAssignment)
admin.site.register(PickupStatus)
admin.site.register(TruckLocation)
admin.site.register(CompletionReport)
admin.site.register(DriverNotification)
