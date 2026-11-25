"""
Defensive circuit-breaker signal for driver.Truck physical deletion.
Enforces Owner-Approved Item 13 (Option A):
- Commissioned, legacy-reconciliation, or retired trucks cannot be physically deleted.
- Uncommissioned trucks cannot be physically deleted if any Category A historical record
  or Category B live operational reference exists.
- Never attempts shift closure inside pre_delete (preventing T1 -> L3 lock-order inversion).
"""
from django.db.models.deletion import ProtectedError
from django.db.models.signals import pre_delete
from django.dispatch import receiver

from .models import Truck, CommissioningProvenance, TruckRetirementState
from .truck_service import TruckHistoricalAuditService


@receiver(pre_delete, sender=Truck)
def guard_truck_pre_delete(sender, instance, **kwargs):
    if (
        instance.retirement_state != TruckRetirementState.UNCOMMISSIONED
        or instance.commissioning_provenance != CommissioningProvenance.UNCOMMISSIONED
        or instance.commissioned_at is not None
        or instance.is_retired
    ):
        raise ProtectedError(
            f"Cannot delete Truck {instance.id} ({instance.plate_number}): vehicle is commissioned, "
            f"retired, or awaiting legacy reconciliation (provenance='{instance.commissioning_provenance}', "
            f"state='{instance.retirement_state}'). Commissioned vehicles must remain permanently retired.",
            [instance],
        )

    cat_a = TruckHistoricalAuditService.get_category_a_counts(instance)
    non_zero_a = {k: v for k, v in cat_a.items() if v > 0}
    if non_zero_a:
        raise ProtectedError(
            f"Cannot delete Truck {instance.id} ({instance.plate_number}): historical operational records exist "
            f"({non_zero_a}). Physical deletion would destroy historical attribution or cascade-delete telemetry.",
            [instance],
        )

    cat_b = TruckHistoricalAuditService.get_category_b_counts(instance)
    non_zero_b = {k: v for k, v in cat_b.items() if v > 0}
    if non_zero_b:
        raise ProtectedError(
            f"Cannot delete Truck {instance.id} ({instance.plate_number}): standing operational references remain "
            f"({non_zero_b}). All operational references must be detached through canonical services before deletion.",
            [instance],
        )
