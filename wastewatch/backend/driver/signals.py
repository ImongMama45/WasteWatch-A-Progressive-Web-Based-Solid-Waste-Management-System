"""
driver/signals.py
Prevent orphan shifts when a truck is deleted.
"""
from django.db.models.signals import pre_delete
from django.dispatch import receiver
from django.utils import timezone

from .models import Truck, DriverShift


@receiver(pre_delete, sender=Truck)
def close_shifts_on_truck_delete(sender, instance, **kwargs):
    """
    Close every active shift for this truck before the row is deleted.
    Using pre_delete so the FK is still valid when we query.
    end_reason = 'truck_deleted' so the UI can distinguish these from
    heartbeat_timeout sweeps and from normal completions.
    """
    DriverShift.objects.filter(truck=instance, is_active=True).update(
        is_active=False,
        end_reason='truck_deleted',
        ended_at=timezone.now(),
    )
