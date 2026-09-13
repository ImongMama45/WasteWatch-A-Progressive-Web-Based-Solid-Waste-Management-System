"""
Daily stop validation initialization and reset logic.
"""
from django.db import transaction
from django.utils import timezone

from driver.models import CollectionSchedule

from .models import StopValidation, StopValidationStatus
from .stop_validation_utils import is_schedule_today, schedules_for_today


def ensure_stop_validations_for_schedule(schedule, collection_date=None):
    """Create PENDING_INSPECTION rows for all collection stops on a scheduled day."""
    if collection_date is None:
        collection_date = timezone.localdate()

    if not is_schedule_today(schedule, collection_date):
        return []

    waypoints = schedule.waypoints or []
    if len(waypoints) <= 1:
        return []

    created = []
    with transaction.atomic():
        for order in range(1, len(waypoints)):
            wp = waypoints[order]
            barangay_id = wp.get('barangay_id') if isinstance(wp, dict) else None
            stop_id = wp.get('stop_id') if isinstance(wp, dict) else None

            sv, was_created = StopValidation.objects.get_or_create(
                schedule=schedule,
                stop_order=order,
                collection_date=collection_date,
                defaults={
                    'current_status': StopValidationStatus.PENDING_INSPECTION,
                    'barangay_id': barangay_id,
                    'stop_id': stop_id,
                },
            )
            if was_created:
                created.append(sv)
            else:
                if sv.barangay_id != barangay_id or sv.stop_id != stop_id:
                    sv.barangay_id = barangay_id
                    sv.stop_id = stop_id
                    sv.save(update_fields=['barangay_id', 'stop_id'])
    return created


def ensure_today_stop_validations():
    """Initialize stop validations for all schedules active today."""
    results = []
    for schedule in schedules_for_today():
        created = ensure_stop_validations_for_schedule(schedule)
        if created:
            results.extend(created)
    return results


def reset_completed_validations():
    """
    After 24 hours, completed validations remain hidden via is_validation_visible().
    On the next scheduled collection day, fresh PENDING_INSPECTION rows are created
    by ensure_today_stop_validations() — no mutation of old rows needed.
    """
    return ensure_today_stop_validations()
