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
import json
import uuid
import datetime
from django.conf import settings
from django.db import models, transaction
from django.utils import timezone

from .models import Notification, NotificationType, EmergencyActivationEvent
from .deduplication import claim_deduplication_key
from news.models import EmergencyAlert
from analytics.models import ActivityLog

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


# ── 1b. EMERGENCY ALERT ──────────────────────────────────────────────────────

@transaction.atomic
def update_emergency_alert(alert_pk, actor, validated_fields: dict = None):
    """
    Authoritative state transition and field update manager for EmergencyAlert.
    Executes within an atomic transaction with row locking.

    Lock-First Sequence:
    1. Locks the alert row via select_for_update().
    2. Reads previous is_active from that locked row.
    3. Applies all submitted, validated editable fields to the locked instance.
    4. If is_active is omitted, preserves the locked row's current is_active.
    5. Evaluates genuine activation / deactivation transitions.
    6. Saves instance, creates activation event & notification if activated.
    7. Records audit trail in ActivityLog.
    8. Returns the saved locked instance.
    """
    validated_fields = validated_fields or {}

    # Step 1: Lock the database row immediately
    alert = EmergencyAlert.objects.select_for_update().get(pk=alert_pk)

    # Step 2: Capture previous is_active directly from the locked instance
    was_active = alert.is_active

    # Step 3 & 4: Apply validated fields; preserve current is_active if omitted
    for field in ['title', 'body']:
        if field in validated_fields:
            setattr(alert, field, validated_fields[field])

    if 'is_active' in validated_fields:
        target_active = bool(validated_fields['is_active'])
    else:
        target_active = was_active  # Preserves locked state on partial updates

    alert.is_active = target_active
    alert._lifecycle_managed = True
    alert.save()

    admin_user = actor if (actor and getattr(actor, 'is_authenticated', False) and hasattr(actor, 'pk')) else None

    # Step 5 & 6: Activation Transition (Inactive -> Active)
    if not was_active and target_active:
        last_seq = EmergencyActivationEvent.objects.filter(
            alert=alert
        ).aggregate(m=models.Max('sequence'))['m'] or 0

        event = EmergencyActivationEvent.objects.create(
            alert=alert,
            sequence=last_seq + 1,
            activated_by=admin_user,
        )

        prefix = "EMERGENCY ADVISORY: "
        avail_len = 200 - len(prefix)
        notif_title = f"{prefix}{alert.title[:avail_len]}"

        Notification.objects.create(
            user=None,
            barangay=None,  # City-wide broadcast
            title=notif_title,
            message=alert.body[:5000],
            type=NotificationType.EMERGENCY_ALERT,
        )

        ActivityLog.objects.create(
            admin=admin_user,
            action='update',
            module='EmergencyAlert',
            details=json.dumps({
                "operation": "emergency_activate",
                "alert_id": alert.pk,
                "sequence": event.sequence,
                "previous_is_active": was_active,
                "new_is_active": target_active,
                "title": alert.title[:200],
            })
        )

    # Step 5 & 6: Deactivation Transition (Active -> Inactive)
    elif was_active and not target_active:
        open_events = EmergencyActivationEvent.objects.filter(
            alert=alert,
            deactivated_at__isnull=True
        )
        open_event = open_events.order_by('-sequence').first()
        closed_seq = open_event.sequence if open_event else None
        now = timezone.now()
        open_events.update(deactivated_at=now)

        ActivityLog.objects.create(
            admin=admin_user,
            action='update',
            module='EmergencyAlert',
            details=json.dumps({
                "operation": "emergency_deactivate",
                "alert_id": alert.pk,
                "sequence": closed_seq,
                "previous_is_active": was_active,
                "new_is_active": target_active,
                "title": alert.title[:200],
            })
        )

    # Active -> Active edit
    elif was_active and target_active:
        ActivityLog.objects.create(
            admin=admin_user,
            action='update',
            module='EmergencyAlert',
            details=json.dumps({
                "operation": "emergency_edit",
                "alert_id": alert.pk,
                "previous_is_active": was_active,
                "new_is_active": target_active,
                "title": alert.title[:200],
            })
        )

    return alert


def notify_emergency_alert(alert):
    """
    Deprecated legacy helper. Kept for backwards compatibility.
    Prefer update_emergency_alert().
    """
    try:
        prefix = "EMERGENCY ADVISORY: "
        avail_len = 200 - len(prefix)
        notif_title = f"{prefix}{alert.title[:avail_len]}"
        Notification.objects.create(
            user=None,
            barangay=None,   # system-wide
            title=notif_title,
            message=alert.body[:5000],
            type=NotificationType.EMERGENCY_ALERT,
        )
    except Exception:
        logger.exception('notify_emergency_alert failed for EmergencyAlert pk=%s', alert.pk)


# ── 2. COLLECTION SCHEDULE LIFECYCLE & DISPATCH ─────────────────────────────

def _coerce_time(val):
    if val is None:
        return None
    if isinstance(val, datetime.time):
        return val
    if isinstance(val, str):
        val = val.strip()
        try:
            parts = val.split(':')
            if len(parts) >= 2:
                h = int(parts[0])
                m = int(parts[1])
                s = int(parts[2]) if len(parts) > 2 else 0
                return datetime.time(h, m, s)
        except Exception:
            pass
    return None


def _coerce_date(val):
    if val is None:
        return None
    if isinstance(val, datetime.date):
        return val
    if isinstance(val, str):
        val = val.strip()
        try:
            return datetime.date.fromisoformat(val)
        except Exception:
            pass
    return None


def time_difference_minutes(t1, t2):
    """
    Returns absolute difference in minutes between two datetime.time instances.
    """
    t1 = _coerce_time(t1)
    t2 = _coerce_time(t2)
    if t1 is None and t2 is None:
        return 0
    if t1 is None or t2 is None:
        return 999999
    m1 = t1.hour * 60 + t1.minute
    m2 = t2.hour * 60 + t2.minute
    return abs(m2 - m1)


def extract_resident_stops(waypoints):
    """
    Extracts canonical representation of resident-facing pickup stops (waypoints index 1+).
    """
    if not waypoints or not isinstance(waypoints, list):
        return []
    stops = []
    for idx, wp in enumerate(waypoints):
        if idx == 0:
            continue
        if isinstance(wp, dict):
            label = (wp.get('label') or wp.get('address') or '').strip().lower()
            stop_id = wp.get('stop_id')
            brgy_id = wp.get('barangay_id')
            stops.append((label, stop_id, brgy_id))
    return stops


def capture_schedule_snapshot(schedule):
    """
    Captures an immutable snapshot of resident-relevant state of a CollectionSchedule.
    Must be called while holding a row-level lock or prior to modification.
    """
    if schedule is None:
        return None

    from driver.crew_resolver import normalize_days

    status = getattr(schedule, 'status', 'PENDING')
    is_available = bool(getattr(schedule, 'is_available', True))

    date = _coerce_date(getattr(schedule, 'date', None))
    days = getattr(schedule, 'days', '')
    normalized_days = normalize_days(days)
    start_time = _coerce_time(getattr(schedule, 'start_time', None))
    frequency = (getattr(schedule, 'frequency', '') or '').strip()

    if hasattr(schedule, 'barangays') and getattr(schedule, 'pk', None):
        barangay_ids = set(schedule.barangays.values_list('id', flat=True))
    else:
        barangay_ids = set()

    waypoints = getattr(schedule, 'waypoints', []) or []
    resident_stops = extract_resident_stops(waypoints)

    return {
        'id': schedule.pk if getattr(schedule, 'pk', None) else None,
        'status': status,
        'is_available': is_available,
        'date': date,
        'days': days,
        'normalized_days': normalized_days,
        'start_time': start_time,
        'frequency': frequency,
        'barangay_ids': barangay_ids,
        'resident_stops': resident_stops,
    }


def _format_schedule_details(schedule):
    """
    Constructs a resident-facing summary string without exposing internal
    driver, truck, dumpsite, or sanitation team information.
    """
    parts = []
    date = _coerce_date(getattr(schedule, 'date', None))
    start_time = _coerce_time(getattr(schedule, 'start_time', None))

    if date:
        parts.append(f"Date: {date.strftime('%b %d, %Y')}")
    elif getattr(schedule, 'days', None):
        parts.append(f"Days: {schedule.days}")

    if start_time:
        formatted_start = start_time.strftime('%I:%M %p').lstrip('0')
        parts.append(f"Start Time: {formatted_start}")

    if getattr(schedule, 'frequency', None):
        parts.append(f"Frequency: {schedule.frequency}")

    return " · ".join(parts) if parts else "Please check the schedule calendar for details."


@transaction.atomic
def process_schedule_lifecycle_change(before_snapshot, after_schedule, actor=None):
    """
    Authoritative schedule lifecycle evaluator and notification dispatcher.
    Compares the immutable before-snapshot against the persisted after-schedule.
    Emits resident-facing notifications only for meaningful resident-visible changes.
    Rolls back the transaction if notification dispatch fails.
    """
    if after_schedule is None:
        return []

    from accounts.models import Barangay
    from accounts.permissions import is_admin_user

    after_snapshot = capture_schedule_snapshot(after_schedule)

    before_status = before_snapshot.get('status') if before_snapshot else None
    after_status = after_snapshot.get('status')

    before_is_available = (
        bool(before_snapshot['is_available'] and before_status != 'CANCELLED')
        if before_snapshot else False
    )
    after_is_available = bool(after_snapshot['is_available'] and after_status != 'CANCELLED')

    before_barangay_ids = set(before_snapshot['barangay_ids']) if before_snapshot else set()
    after_barangay_ids = set(after_snapshot['barangay_ids'])

    admin_user = actor if (actor and is_admin_user(actor)) else None
    broadcast_id = uuid.uuid4()
    created_notifications = []
    log_entries = []

    # ── 1. Availability Transition: False -> True (Became Available) ────────
    if not before_is_available and after_is_available:
        if after_barangay_ids:
            details_str = _format_schedule_details(after_schedule)
            target_barangays = Barangay.objects.filter(id__in=after_barangay_ids)
            is_reinstate = (
                before_snapshot is not None
                and (
                    before_snapshot.get('status') == 'CANCELLED'
                    or not before_snapshot.get('is_available')
                )
            )
            title = "Collection Schedule Reinstated" if is_reinstate else "Collection Schedule Published"
            msg_prefix = (
                "The garbage collection schedule for {brgy_name} has been reinstated."
                if is_reinstate
                else "A collection schedule has been published for {brgy_name}."
            )
            for brgy in target_barangays:
                msg = f"{msg_prefix.format(brgy_name=brgy.name)} {details_str}".strip()
                n = Notification.objects.create(
                    user=None,
                    barangay=brgy,
                    title=title,
                    message=msg,
                    type=NotificationType.SCHEDULE_CHANGE,
                    broadcast_id=broadcast_id,
                )
                created_notifications.append(n)

            log_entries.append({
                "operation": "schedule_reinstate" if is_reinstate else "schedule_publish",
                "schedule_id": after_schedule.pk,
                "affected_barangay_ids": sorted(list(after_barangay_ids)),
            })

    # ── 2. Availability Transition: True -> False (Became Unavailable) ──────
    elif before_is_available and not after_is_available:
        if before_barangay_ids:
            target_barangays = Barangay.objects.filter(id__in=before_barangay_ids)
            for brgy in target_barangays:
                n = Notification.objects.create(
                    user=None,
                    barangay=brgy,
                    title="Collection Schedule Cancelled",
                    message=f"The garbage collection schedule for {brgy.name} has been cancelled until further notice.",
                    type=NotificationType.SCHEDULE_CHANGE,
                    broadcast_id=broadcast_id,
                )
                created_notifications.append(n)

            log_entries.append({
                "operation": "schedule_cancel",
                "schedule_id": after_schedule.pk,
                "affected_barangay_ids": sorted(list(before_barangay_ids)),
            })

    # ── 3. Unchanged Availability: False -> False (Remains Unavailable) ─────
    elif not before_is_available and not after_is_available:
        # Schedule was unavailable and remains unavailable.
        # No notifications are emitted to residents regardless of field edits.
        pass

    # ── 4. Unchanged Availability: True -> True (Remains Available) ─────────
    elif before_is_available and after_is_available:
        added_b_ids = after_barangay_ids - before_barangay_ids
        removed_b_ids = before_barangay_ids - after_barangay_ids
        retained_b_ids = before_barangay_ids & after_barangay_ids

        # 4A. Added barangays
        if added_b_ids:
            details_str = _format_schedule_details(after_schedule)
            target_barangays = Barangay.objects.filter(id__in=added_b_ids)
            for brgy in target_barangays:
                n = Notification.objects.create(
                    user=None,
                    barangay=brgy,
                    title="Collection Schedule Published",
                    message=f"A collection schedule has been published for {brgy.name}. {details_str}",
                    type=NotificationType.SCHEDULE_CHANGE,
                    broadcast_id=broadcast_id,
                )
                created_notifications.append(n)

            log_entries.append({
                "operation": "schedule_barangay_add",
                "schedule_id": after_schedule.pk,
                "affected_barangay_ids": sorted(list(added_b_ids)),
            })

        # 4B. Removed barangays
        if removed_b_ids:
            target_barangays = Barangay.objects.filter(id__in=removed_b_ids)
            for brgy in target_barangays:
                n = Notification.objects.create(
                    user=None,
                    barangay=brgy,
                    title="Collection Schedule Removed",
                    message=f"The collection schedule for {brgy.name} has been updated and no longer covers this area.",
                    type=NotificationType.SCHEDULE_CHANGE,
                    broadcast_id=broadcast_id,
                )
                created_notifications.append(n)

            log_entries.append({
                "operation": "schedule_barangay_remove",
                "schedule_id": after_schedule.pk,
                "affected_barangay_ids": sorted(list(removed_b_ids)),
            })

        # 4C. Retained barangays — check for meaningful schedule changes
        if retained_b_ids:
            date_changed = (before_snapshot['date'] != after_snapshot['date'])
            days_changed = (before_snapshot['normalized_days'] != after_snapshot['normalized_days'])
            start_time_changed = (time_difference_minutes(before_snapshot['start_time'], after_snapshot['start_time']) >= 30)
            freq_changed = ((before_snapshot['frequency'] or '').strip().lower() != (after_snapshot['frequency'] or '').strip().lower())
            stops_changed = (before_snapshot['resident_stops'] != after_snapshot['resident_stops'])

            reasons = []
            if date_changed:
                reasons.append('date')
            if days_changed:
                reasons.append('days')
            if start_time_changed:
                reasons.append('start_time')
            if freq_changed:
                reasons.append('frequency')
            if stops_changed:
                reasons.append('stops')

            if reasons:
                details_str = _format_schedule_details(after_schedule)
                target_barangays = Barangay.objects.filter(id__in=retained_b_ids)
                for brgy in target_barangays:
                    n = Notification.objects.create(
                        user=None,
                        barangay=brgy,
                        title="Collection Schedule Updated",
                        message=f"The collection schedule for {brgy.name} has been updated. {details_str}",
                        type=NotificationType.SCHEDULE_CHANGE,
                        broadcast_id=broadcast_id,
                    )
                    created_notifications.append(n)

                log_entries.append({
                    "operation": "schedule_update",
                    "schedule_id": after_schedule.pk,
                    "affected_barangay_ids": sorted(list(retained_b_ids)),
                    "reasons": reasons,
                })

    # ActivityLog entry for auditing
    for entry in log_entries:
        ActivityLog.objects.create(
            admin=admin_user,
            action='update' if before_snapshot else 'create',
            module='CollectionSchedule',
            details=json.dumps(entry),
        )

    return created_notifications


@transaction.atomic
def dispatch_schedule_cancellation_notifications(schedule_pk, barangay_ids, actor=None):
    """
    Emits cancellation notifications when an available schedule is deleted.
    """
    from accounts.models import Barangay
    from accounts.permissions import is_admin_user

    admin_user = actor if (actor and is_admin_user(actor)) else None
    broadcast_id = uuid.uuid4()
    notifications = []
    for brgy in Barangay.objects.filter(id__in=barangay_ids):
        n = Notification.objects.create(
            user=None,
            barangay=brgy,
            title="Collection Schedule Cancelled",
            message=f"The garbage collection schedule for {brgy.name} has been cancelled until further notice.",
            type=NotificationType.SCHEDULE_CHANGE,
            broadcast_id=broadcast_id,
        )
        notifications.append(n)

    ActivityLog.objects.create(
        admin=admin_user,
        action='update',
        module='CollectionSchedule',
        details=json.dumps({
            "operation": "schedule_delete",
            "schedule_id": schedule_pk,
            "affected_barangay_ids": sorted(list(barangay_ids)),
        }),
    )
    return notifications


@transaction.atomic
def create_collection_schedule(validated_fields, barangay_ids=None, actor=None):
    """
    Authoritative service to create a CollectionSchedule with lifecycle notifications.
    """
    from driver.models import CollectionSchedule

    fields = dict(validated_fields)
    raw_barangays = barangay_ids
    if raw_barangays is None and 'barangays' in fields:
        raw_barangays = fields.pop('barangays')
    elif 'barangays' in fields:
        fields.pop('barangays')

    schedule = CollectionSchedule.objects.create(**fields)
    if raw_barangays is not None:
        ids = [b.pk if hasattr(b, 'pk') else int(b) for b in raw_barangays]
        schedule.barangays.set(ids)

    process_schedule_lifecycle_change(
        before_snapshot=None,
        after_schedule=schedule,
        actor=actor,
    )
    return schedule


@transaction.atomic
def update_collection_schedule(schedule_pk, validated_fields=None, barangay_ids=None, actor=None):
    """
    Authoritative service to update a CollectionSchedule with row locking and lifecycle notifications.
    """
    from driver.models import CollectionSchedule

    locked_schedule = CollectionSchedule.objects.select_for_update().get(pk=schedule_pk)
    before_snapshot = capture_schedule_snapshot(locked_schedule)

    fields = dict(validated_fields or {})
    raw_barangays = barangay_ids
    if raw_barangays is None and 'barangays' in fields:
        raw_barangays = fields.pop('barangays')
    elif 'barangays' in fields:
        fields.pop('barangays')

    if fields:
        for field, value in fields.items():
            setattr(locked_schedule, field, value)
        locked_schedule.save()

    if raw_barangays is not None:
        ids = [b.pk if hasattr(b, 'pk') else int(b) for b in raw_barangays]
        locked_schedule.barangays.set(ids)

    process_schedule_lifecycle_change(
        before_snapshot=before_snapshot,
        after_schedule=locked_schedule,
        actor=actor,
    )
    return locked_schedule


def notify_schedule_change(schedule, is_new=False):
    """
    Backwards-compatible wrapper around process_schedule_lifecycle_change.
    """
    if not schedule or not getattr(schedule, 'pk', None):
        return
    process_schedule_lifecycle_change(None, schedule)


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
# (shift, schedule, stop_order) tuple within this window (seconds).
_TRUCK_NEAR_COOLDOWN_S = getattr(settings, 'TRUCK_NEAR_COOLDOWN_SECONDS', 1800)   # 30 minutes
_TRUCK_NEAR_RADIUS_M   = getattr(settings, 'TRUCK_NEAR_DETECTION_RADIUS_M', 350)   # trigger distance from stop
_TRUCK_NEAR_IMMEDIATE_RADIUS_M = getattr(settings, 'TRUCK_NEAR_IMMEDIATE_RADIUS_M', 75)
_TRUCK_NEAR_APPROACH_DELTA_M = getattr(settings, 'TRUCK_NEAR_APPROACH_DELTA_M', 15)
_TRUCK_NEAR_ACCURACY_THRESHOLD = getattr(settings, 'TRUCK_NEAR_ACCURACY_THRESHOLD', 100)
_GPS_SHIFT_ACCURACY_THRESHOLD = getattr(settings, 'GPS_SHIFT_ACCURACY_THRESHOLD', 150)


def notify_truck_near(shift, schedule, stop_order, stop_lat, stop_lng,
                      driver_lat, driver_lng, target_barangay=None, stop_label=None):
    """
    Called when a GPS ping qualifies for resident notification.

    Checks:
      1. schedule.dumpsite is assigned with valid numeric coordinates (fails closed if missing).
      2. Schedule is available and not CANCELLED/COMPLETED.
      3. Distance between driver and stop is within _TRUCK_NEAR_RADIUS_M (350m).
      4. Single target barangay is resolved:
         - Explicit target_barangay verified against schedule.barangays
         - OR stop_order in schedule.waypoints has barangay_id
         - OR schedule has exactly one barangay (sole barangay fallback)
         - Multi-barangay with missing/invalid ID fails closed.
      5. Atomic deduplication key claim with 1,800s cooldown.
      6. Creates exactly ONE Notification row for the target barangay.

    Guarantees:
      - Deduplication claim and notification insert share the same atomic transaction.
      - If insert fails, claim rolls back completely.
    """
    try:
        # ── 1. Assigned Dumpsite check (Approved Decision 1) ─────────────────
        dumpsite = getattr(schedule, 'dumpsite', None)
        if not dumpsite or dumpsite.latitude is None or dumpsite.longitude is None:
            logger.warning(
                'notify_truck_near: Missing or invalid assigned dumpsite for schedule pk=%s; failing closed.',
                getattr(schedule, 'pk', None)
            )
            return

        # ── 2. Schedule availability check ───────────────────────────────────
        if not getattr(schedule, 'is_available', True) or getattr(schedule, 'status', None) in ('CANCELLED', 'COMPLETED'):
            return

        # ── 3. Distance check ────────────────────────────────────────────────
        dist = _haversine(driver_lat, driver_lng, stop_lat, stop_lng)
        if dist > _TRUCK_NEAR_RADIUS_M:
            return  # not close enough yet

        # ── 4. Target barangay resolution (Approved Decision 3) ──────────────
        all_schedule_barangays = {b.id: b for b in schedule.barangays.all()}
        resolved_brgy = None

        if target_barangay is not None:
            if isinstance(target_barangay, int):
                resolved_brgy = all_schedule_barangays.get(target_barangay)
            elif hasattr(target_barangay, 'id'):
                resolved_brgy = all_schedule_barangays.get(target_barangay.id)
            if not resolved_brgy:
                logger.warning(
                    'notify_truck_near: target_barangay %s does not belong to schedule pk=%s; failing closed.',
                    target_barangay, schedule.pk
                )
                return
        else:
            # Attempt to resolve from waypoint
            waypoints = getattr(schedule, 'waypoints', None) or []
            if stop_order < len(waypoints) and isinstance(waypoints[stop_order], dict):
                wp_bid = waypoints[stop_order].get('barangay_id')
                if wp_bid is not None:
                    try:
                        resolved_brgy = all_schedule_barangays.get(int(wp_bid))
                    except (ValueError, TypeError):
                        resolved_brgy = None

            if not resolved_brgy:
                if len(all_schedule_barangays) == 1:
                    resolved_brgy = list(all_schedule_barangays.values())[0]
                else:
                    logger.warning(
                        'notify_truck_near: Cannot resolve target barangay for schedule pk=%s stop=%s in multi-barangay schedule; failing closed.',
                        schedule.pk, stop_order
                    )
                    return

        if not resolved_brgy:
            return

        # ── 5. Database-backed deduplication & atomic notification dispatch ──
        dedup_key = f'truck_near_{shift.id}_{schedule.id}_{stop_order}'

        with transaction.atomic():
            claimed = claim_deduplication_key(
                key=dedup_key,
                cooldown_seconds=_TRUCK_NEAR_COOLDOWN_S,
            )
            if not claimed:
                return  # Cooldown active; safely suppressed

            # Resolve stop address / label
            if not stop_label:
                waypoints = getattr(schedule, 'waypoints', None) or []
                if stop_order < len(waypoints) and isinstance(waypoints[stop_order], dict):
                    stop_label = (
                        waypoints[stop_order].get('label')
                        or waypoints[stop_order].get('name')
                        or waypoints[stop_order].get('address')
                        or ''
                    )
            location_str = f' near {stop_label}' if stop_label else ''

            # Create exactly ONE notification for the target barangay
            # Resident-facing: no driver name, plate number, or dumpsite internal details
            Notification.objects.create(
                user=None,
                barangay=resolved_brgy,
                title='Collection Truck Approaching',
                message=(
                    f'A collection truck is approaching{location_str} in {resolved_brgy.name}. '
                    f'Please prepare your waste for collection.'
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