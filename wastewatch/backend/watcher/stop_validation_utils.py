"""
Centralized stop validation workflow utilities.
"""
import math
from datetime import timedelta

from django.utils import timezone

from driver.models import CollectionSchedule

INSPECTION_RADIUS_M = 50
COLLECTION_RADIUS_M = 20
VERIFICATION_RADIUS_M = 50

DAY_ABBREV = {
    0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun',
}


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000
    phi_1 = math.radians(float(lat1))
    phi_2 = math.radians(float(lat2))
    delta_phi = math.radians(float(lat2) - float(lat1))
    delta_lambda = math.radians(float(lon2) - float(lon1))
    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi_1) * math.cos(phi_2) * math.sin(delta_lambda / 2.0) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_schedule_today(schedule, today=None):
    """Return True when a collection schedule is active for the given date."""
    if today is None:
        today = timezone.localdate()

    if schedule.date:
        return schedule.date == today

    days_raw = (schedule.days or '').strip().lower()
    if not days_raw:
        return True

    today_abbrev = DAY_ABBREV.get(today.weekday(), '').lower()
    return today_abbrev in days_raw


def get_stop_coordinates(schedule, stop_order):
    waypoints = schedule.waypoints or []
    if stop_order < 1 or stop_order >= len(waypoints):
        return None
    wp = waypoints[stop_order]
    if not isinstance(wp, dict):
        return None
    lat = wp.get('lat')
    lng = wp.get('lng')
    if lat is None or lng is None:
        return None
    return float(lat), float(lng)


def validate_gps_proximity(user_lat, user_lng, stop_lat, stop_lng, radius_m):
    if user_lat is None or user_lng is None:
        return False, 'GPS coordinates are required.'
    try:
        dist = haversine_m(user_lat, user_lng, stop_lat, stop_lng)
    except (TypeError, ValueError):
        return False, 'Invalid GPS coordinates.'
    if dist > radius_m:
        return False, f'You are too far from the stop ({int(dist)}m away). Must be within {radius_m}m.'
    return True, None


def schedules_for_today():
    today = timezone.localdate()
    return [
        s for s in CollectionSchedule.objects.exclude(status='CANCELLED').select_related('driver', 'truck')
        if is_schedule_today(s, today)
    ]


def is_validation_visible(validation):
    """Hide completed/empty stops after 24 hours."""
    from .models import StopValidationStatus

    if validation.current_status not in (
        StopValidationStatus.VERIFIED_COLLECTED,
        StopValidationStatus.COLLECTION_DISPUTED,
        StopValidationStatus.EMPTY_STOP,
    ):
        return True

    cutoff = timezone.now() - timedelta(hours=24)
    ts = (
        validation.post_validation_timestamp
        or validation.pre_validation_timestamp
        or validation.collection_timestamp
    )
    if not ts:
        return True
    return ts >= cutoff
