"""
notifications/services.py
--------------------------
Thin helpers that create Notification rows.
Each function is self-contained: it imports only what it needs,
wraps DB writes in try/except so callers are never broken by a
notification failure, and returns the created object(s) or None.

Import pattern used by callers:
    from notifications.services import notify_announcement
"""

import logging
from django.core.cache import cache

from .models import Notification, NotificationType

logger = logging.getLogger(__name__)


# ── 1. ANNOUNCEMENT ──────────────────────────────────────────────────────────

def notify_announcement(news_item):
    """
    Called when a NewsItem is created with is_active=True.
    Creates one barangay-wide or system-wide notification row.

    news_item.barangay = None  → city-wide (barangay=None on notification)
    news_item.barangay = <obj> → targets that barangay only
    """
    try:
        Notification.objects.create(
            user=None,
            barangay=news_item.barangay,   # None = city-wide
            title=news_item.title,
            message=_truncate(news_item.description, 200),
            type=NotificationType.ANNOUNCEMENT,
        )
    except Exception:
        logger.exception('notify_announcement failed for NewsItem pk=%s', news_item.pk)


# ── 2. SCHEDULE_CHANGE ───────────────────────────────────────────────────────

def notify_schedule_change(schedule, is_new=False):
    """
    Called from CollectionSchedule.save().
    Creates one notification per affected barangay.

    is_new=True  → "New schedule published"
    is_new=False → "Schedule updated"
    """
    try:
        barangays = list(schedule.barangays.all())
        if not barangays:
            return  # No targeting info yet — skip silently

        verb    = 'published' if is_new else 'updated'
        days    = schedule.days or 'TBD'
        start   = schedule.start_time.strftime('%I:%M %p') if schedule.start_time else '—'

        for brgy in barangays:
            Notification.objects.create(
                user=None,
                barangay=brgy,
                title=f'Collection Schedule {verb.capitalize()}',
                message=(
                    f'The garbage collection schedule for {brgy.name} has been {verb}. '
                    f'Days: {days} · Start: {start}.'
                ),
                type=NotificationType.SCHEDULE_CHANGE,
            )
    except Exception:
        logger.exception(
            'notify_schedule_change failed for CollectionSchedule pk=%s', schedule.pk
        )


# ── 3. COLLECTION_DONE ───────────────────────────────────────────────────────

def notify_collection_done(schedule, stop_order, driver=None):
    """
    Called when a driver successfully completes a stop (collect action).
    Creates one notification per barangay linked to the schedule.

    stop_order is used to look up the stop address from schedule.waypoints.
    """
    try:
        barangays = list(schedule.barangays.all())
        if not barangays:
            return

        # Resolve stop address from waypoints if available
        waypoints   = schedule.waypoints or []
        address     = ''
        if stop_order < len(waypoints) and isinstance(waypoints[stop_order], dict):
            address = (
                waypoints[stop_order].get('label')
                or waypoints[stop_order].get('address')
                or ''
            )
        location_str = f' at {address}' if address else ''
        driver_str   = f' by {driver.full_name}' if driver else ''

        for brgy in barangays:
            Notification.objects.create(
                user=None,
                barangay=brgy,
                title='Garbage Collection Completed',
                message=(
                    f'Stop #{stop_order}{location_str} has been collected{driver_str}. '
                    f'Check the map for real-time truck status.'
                ),
                type=NotificationType.COLLECTION_DONE,
            )
    except Exception:
        logger.exception(
            'notify_collection_done failed for schedule pk=%s stop=%s',
            schedule.pk, stop_order,
        )


# ── 4. TRUCK_NEAR ────────────────────────────────────────────────────────────

# Notification is suppressed if one was already sent for this
# (shift, stop_order) pair within this window (seconds).
_TRUCK_NEAR_COOLDOWN_S = 1800   # 30 minutes
_TRUCK_NEAR_RADIUS_M   = 300    # trigger distance from stop


def notify_truck_near(shift, schedule, stop_order, stop_lat, stop_lng,
                      driver_lat, driver_lng):
    """
    Called from TruckLocationViewSet.create() when a GPS ping is processed.

    Checks:
      1. Distance between driver and the upcoming stop is within _TRUCK_NEAR_RADIUS_M.
      2. No TRUCK_NEAR notification has been sent for this (shift, stop) in the
         last _TRUCK_NEAR_COOLDOWN_S seconds (enforced via Django cache).

    Uses django.core.cache — works with any backend (LocMemCache in dev,
    Memcached/Redis in prod) with zero extra dependencies.
    """
    try:
        import math

        # ── Distance check ───────────────────────────────────────────────────
        dist = _haversine(driver_lat, driver_lng, stop_lat, stop_lng)
        if dist > _TRUCK_NEAR_RADIUS_M:
            return  # not close enough yet

        # ── Deduplication via cache ──────────────────────────────────────────
        cache_key = f'truck_near_{shift.id}_{stop_order}'
        if cache.get(cache_key):
            return  # already notified for this stop in this shift

        # Mark as sent before writing DB row to avoid race on concurrent pings
        cache.set(cache_key, True, timeout=_TRUCK_NEAR_COOLDOWN_S)

        # ── Resolve stop address ─────────────────────────────────────────────
        waypoints = schedule.waypoints or []
        address   = ''
        if stop_order < len(waypoints) and isinstance(waypoints[stop_order], dict):
            address = (
                waypoints[stop_order].get('label')
                or waypoints[stop_order].get('address')
                or ''
            )
        location_str = f' near {address}' if address else ''

        # ── Create one notification per barangay ─────────────────────────────
        for brgy in schedule.barangays.all():
            Notification.objects.create(
                user=None,
                barangay=brgy,
                title='Garbage Truck is Nearby!',
                message=(
                    f'A collection truck is{location_str} in {brgy.name}. '
                    f'Please place your garbage out now.'
                ),
                type=NotificationType.TRUCK_NEAR,
            )

    except Exception:
        logger.exception(
            'notify_truck_near failed for shift pk=%s stop=%s', shift.pk, stop_order
        )


# ── 5. DUMPSITE_INBOUND ────────────────────────────────────────────────────────

def notify_dumpsite_inbound(shift, dumpsite):
    """
    Called when a truck finishes its route and heads to the dumpsite.
    Notifies all Dumpsite Operator accounts assigned to that dumpsite.
    """
    try:
        if not dumpsite:
            return

        from accounts.models import User
        from django.db.models import Q
        operators = User.objects.filter(Q(dumpsite=dumpsite) | Q(operated_dumpsite=dumpsite)).distinct()
        if not operators.exists():
            return

        truck_str = f"Truck {shift.truck.plate_number}" if shift.truck else "A truck"
        
        for op in operators:
            Notification.objects.create(
                user=op,
                barangay=None,
                title='Incoming Truck',
                message=(
                    f'{truck_str} has finished its collection route and is heading to the dumpsite. '
                    f'Driver: {shift.driver.full_name}'
                ),
                type=NotificationType.DUMPSITE_INBOUND,
            )
    except Exception:
        logger.exception('notify_dumpsite_inbound failed for shift pk=%s', getattr(shift, 'pk', None))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _truncate(text, max_len):
    if len(text) <= max_len:
        return text
    return text[:max_len - 1] + '…'


def _haversine(lat1, lon1, lat2, lon2):
    import math
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi       = math.radians(lat2 - lat1)
    dlambda    = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))