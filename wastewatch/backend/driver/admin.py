from django.contrib import admin
from django.db.models.deletion import ProtectedError

from accounts.permissions import is_admin_user
from .models import Truck
from .truck_service import TruckHistoricalAuditService, TruckService


@admin.register(Truck)
class TruckAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'plate_number',
        'model',
        'status',
        'commissioning_provenance',
        'retirement_state',
        'commissioned_at',
        'is_retired',
        'is_operational_hold',
    )
    list_filter = (
        'status',
        'commissioning_provenance',
        'retirement_state',
        'is_retired',
        'is_operational_hold',
    )
    search_fields = ('plate_number', 'model', 'zone')
    readonly_fields = (
        'commissioning_provenance',
        'retirement_state',
        'commissioned_at',
        'is_retired',
        'mechanical_status',
        'maintenance_status',
        'is_operational_hold',
        'last_inspected_dumpsite',
        'hold_dumpsite',
        'hold_placed_by',
        'hold_placed_at',
        'hold_reason',
        'maintenance_start',
        'past_crew_names',
        'created_at',
    )

    def get_actions(self, request):
        actions = super().get_actions(request)
        if 'delete_selected' in actions:
            del actions['delete_selected']
        return actions

    def has_delete_permission(self, request, obj=None):
        if not is_admin_user(getattr(request, 'user', None)):
            return False
        if obj is None:
            return False
        return TruckHistoricalAuditService.is_eligible_for_physical_delete(obj)

    def delete_model(self, request, obj):
        TruckService.delete_uncommissioned_truck(obj, user=request.user)

    def delete_queryset(self, request, queryset):
        raise ProtectedError(
            "Bulk deletion of Truck records via Admin queryset action is strictly prohibited. "
            "Eligible uncommissioned vehicles must be deleted individually.",
            list(queryset),
        )
