"""
Normalization functions for the WasteWatch Calendar Service.

Translates CollectionSchedule model instances and StopValidation evidence
into canonical, sanitized CalendarEntry dictionaries conforming to
Calendar Service Contract v0.2.
"""

import datetime
import logging
from zoneinfo import ZoneInfo
from django.utils import timezone

from driver.crew_resolver import normalize_days
from watcher.models import StopValidationStatus

logger = logging.getLogger(__name__)

MANILA_TZ = ZoneInfo('Asia/Manila')

VALID_WEEKDAYS = {'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'}

RESOLVED_STATUSES = {
    StopValidationStatus.COLLECTION_REPORTED,
    StopValidationStatus.VERIFIED_COLLECTED,
    StopValidationStatus.COLLECTION_DISPUTED,
    StopValidationStatus.EMPTY_STOP,
}


def classify_schedule_scope(barangay_count, area_string):
    """
    Classifies schedule scope using the approved 4-tier precedence:
    1. Explicit barangay assignments -> 'barangay'
    2. Explicit citywide marker -> 'citywide'
    3. Meaningful area -> 'area'
    4. Unassigned -> 'unassigned'

    Recognized citywide markers (case-insensitive):
    - 'citywide'
    - 'city-wide'
    """
    if barangay_count > 0:
        return 'barangay'

    cleaned_area = (area_string or '').strip()
    area_lower = cleaned_area.lower()
    if area_lower in ('citywide', 'city-wide'):
        return 'citywide'
    elif cleaned_area:
        return 'area'
    else:
        return 'unassigned'


def determine_completion_status(schedule, occurrence_date, stop_dict=None, reference_date=None):
    """
    Determines calendar-facing operational status for a single schedule occurrence.

    Statuses:
    - scheduled: The occurrence is in the future relative to reference_date (default: today).
    - in_progress: The occurrence is on reference_date and has not reached operational resolution.
    - verified_collected: All expected stops have reached VERIFIED_COLLECTED status.
    - operationally_completed: All expected stops have reached a resolved status
      (COLLECTION_REPORTED, VERIFIED_COLLECTED, COLLECTION_DISPUTED, EMPTY_STOP),
      with at least one stop not being VERIFIED_COLLECTED.
    - unverified: Historical occurrence without sufficient completion evidence.
    """
    ref_date = reference_date or timezone.localdate()

    # 1. Future occurrences are always 'scheduled'
    if occurrence_date > ref_date:
        return 'scheduled'

    # 2. Check waypoint / stop configuration
    # The first waypoint represents the route origin/depot; collection stops start at index 1.
    total_expected = len(schedule.waypoints) - 1 if schedule.waypoints else 0
    if total_expected <= 0:
        # Malformed or zero-stop schedule cannot prove completion
        return 'in_progress' if occurrence_date == ref_date else 'unverified'

    if not stop_dict:
        return 'in_progress' if occurrence_date == ref_date else 'unverified'

    # 3. Verify that every expected stop order (1 .. total_expected) has a recorded status
    for order in range(1, total_expected + 1):
        if order not in stop_dict:
            return 'in_progress' if occurrence_date == ref_date else 'unverified'

    statuses = [stop_dict[order] for order in range(1, total_expected + 1)]

    # 4. Check for complete verified collection
    if all(st == StopValidationStatus.VERIFIED_COLLECTED for st in statuses):
        return 'verified_collected'

    # 5. Check for operational resolution (all stops in RESOLVED_STATUSES)
    if all(st in RESOLVED_STATUSES for st in statuses):
        return 'operationally_completed'

    # 6. Unresolved stops remain in progress today, or unverified historically
    return 'in_progress' if occurrence_date == ref_date else 'unverified'


def expand_schedule_occurrences(schedule, start_date, end_date, reference_date=None):
    """
    Expands a CollectionSchedule into a list of occurrence dates within [start_date, end_date].

    Lifecycle rules:
    - CANCELLED schedules never generate public calendar occurrences.
    - One-time schedules (schedule.date is populated):
      - PENDING: Emits schedule.date if within window.
      - COMPLETED: Preserves eligible historical occurrence (date <= ref_date).
      - CANCELLED: Returns [].
    - Recurring schedules (schedule.date is None):
      - PENDING: Normalizes days and emits matching weekdays inside [start_date, end_date].
      - COMPLETED: Emits matching weekdays only up to min(end_date, ref_date).
        Must NOT generate future occurrences (curr > ref_date).
      - CANCELLED: Returns [].
    - Missing or invalid time ranges (start_time >= end_time) are excluded with a warning log.
    """
    ref_date = reference_date or timezone.localdate()

    if schedule.status == 'CANCELLED':
        return []

    if schedule.start_time is None or schedule.end_time is None:
        logger.warning("Schedule pk=%s excluded: missing start_time or end_time", schedule.pk)
        return []

    if schedule.start_time >= schedule.end_time:
        logger.warning(
            "Schedule pk=%s excluded: invalid time range (start_time %s >= end_time %s)",
            schedule.pk,
            schedule.start_time,
            schedule.end_time,
        )
        return []

    # One-time schedule
    if schedule.date is not None:
        if start_date <= schedule.date <= end_date:
            if schedule.status == 'COMPLETED':
                if schedule.date <= ref_date:
                    return [schedule.date]
                return []
            return [schedule.date]
        return []

    # Recurring schedule
    if schedule.status == 'COMPLETED':
        if start_date > ref_date:
            return []
        effective_end = min(end_date, ref_date)
    else:
        effective_end = end_date

    normalized = normalize_days(schedule.days)
    valid_days = normalized.intersection(VALID_WEEKDAYS)
    if not valid_days:
        logger.warning(
            "Schedule pk=%s excluded: no valid weekdays found in days definition '%s'",
            schedule.pk,
            schedule.days,
        )
        return []

    occurrences = []
    curr = start_date
    while curr <= effective_end:
        weekday_code = curr.strftime('%a').lower()
        if weekday_code in valid_days:
            occurrences.append(curr)
        curr += datetime.timedelta(days=1)

    return occurrences


def normalize_collection_schedule_occurrence(schedule, occurrence_date, stop_validations=None, reference_date=None):
    """
    Constructs an in-memory normalized CalendarEntry dictionary for a single schedule occurrence.
    All sensitive operational fields (driver, truck, dumpsite, raw GPS waypoints) are stripped.
    """
    barangays_list = list(schedule.barangays.all())
    scope = classify_schedule_scope(len(barangays_list), schedule.area)
    is_citywide = (scope == 'citywide')

    if scope == 'barangay':
        sorted_barangays = sorted(barangays_list, key=lambda b: b.name)
        barangays_ids = [b.id for b in sorted_barangays]
        barangay_details = [{'id': b.id, 'name': b.name} for b in sorted_barangays]
        location = ", ".join(b.name for b in sorted_barangays)
    elif scope == 'citywide':
        barangays_ids = []
        barangay_details = []
        location = "Citywide"
    elif scope == 'area':
        barangays_ids = []
        barangay_details = []
        location = schedule.area.strip()
    else:  # unassigned
        barangays_ids = []
        barangay_details = []
        location = schedule.area.strip() if schedule.area else "Unassigned"

    title = f"Solid Waste Collection — {location}"
    desc = f"Scheduled solid waste collection for {location}."
    if schedule.frequency:
        desc += f" Frequency: {schedule.frequency}."

    status = determine_completion_status(
        schedule=schedule,
        occurrence_date=occurrence_date,
        stop_dict=stop_validations,
        reference_date=reference_date,
    )

    start_dt = datetime.datetime.combine(occurrence_date, schedule.start_time, tzinfo=MANILA_TZ)
    end_dt = datetime.datetime.combine(occurrence_date, schedule.end_time, tzinfo=MANILA_TZ)

    total_stops = max(0, len(schedule.waypoints) - 1) if schedule.waypoints else 0
    resolved_stops_count = 0
    if stop_validations and total_stops > 0:
        resolved_stops_count = sum(
            1 for order in range(1, total_stops + 1)
            if stop_validations.get(order) in RESOLVED_STATUSES
        )

    entry_id = f"sched_{schedule.id}_{occurrence_date.strftime('%Y%m%d')}"

    return {
        "id": entry_id,
        "source": "collection_schedule",
        "source_id": schedule.id,
        "entry_type": "collection_schedule",
        "title": title,
        "description": desc,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "start_datetime": start_dt.isoformat(),
        "end_datetime": end_dt.isoformat(),
        "all_day": False,
        "location": location,
        "scope": scope,
        "is_citywide": is_citywide,
        "category": "collection_schedule",
        "category_display": "Waste Collection",
        "status": status,
        "barangays": barangays_ids,
        "barangay_details": barangay_details,
        "url": "/schedule",
        "metadata": {
            "frequency": schedule.frequency or "",
            "is_recurring": schedule.date is None,
            "total_stops": total_stops,
            "resolved_stops": resolved_stops_count,
            "schedule_lifecycle": schedule.status,
        },
    }


def normalize_collection_schedules(schedules, start_date, end_date, stop_validations_map=None, reference_date=None):
    """
    Expands and normalizes a sequence of schedules across [start_date, end_date].
    Returns entries sorted deterministically by start datetime and entry ID.
    """
    entries = []
    stop_validations_map = stop_validations_map or {}

    for schedule in schedules:
        occurrence_dates = expand_schedule_occurrences(
            schedule, start_date, end_date, reference_date=reference_date
        )
        for occ_date in occurrence_dates:
            stops = stop_validations_map.get((schedule.id, occ_date), {})
            entry = normalize_collection_schedule_occurrence(
                schedule=schedule,
                occurrence_date=occ_date,
                stop_validations=stops,
                reference_date=reference_date,
            )
            entries.append(entry)

    # Sort deterministically
    entries.sort(key=lambda e: (e['start_datetime'], e['id']))
    return entries


def normalize_municipal_event(event):
    """
    Normalizes a MunicipalEvent instance into a canonical CalendarEntry dictionary.
    Empty barangay selection means citywide for MunicipalEvent only.
    """
    barangays_list = list(event.barangays.all())
    is_citywide = (len(barangays_list) == 0)
    scope = 'citywide' if is_citywide else 'barangay'

    if scope == 'barangay':
        sorted_barangays = sorted(barangays_list, key=lambda b: b.name)
        barangays_ids = [b.id for b in sorted_barangays]
        barangay_details = [{'id': b.id, 'name': b.name} for b in sorted_barangays]
        location = event.location or ", ".join(b.name for b in sorted_barangays)
    else:
        barangays_ids = []
        barangay_details = []
        location = event.location or "Citywide"

    start_dt = event.start_datetime.astimezone(MANILA_TZ)
    end_dt = event.end_datetime.astimezone(MANILA_TZ)

    cover_image_url = None
    if getattr(event, 'cover_image', None):
        try:
            cover_image_url = event.cover_image.url
        except Exception:
            cover_image_url = str(event.cover_image)

    return {
        "id": f"event_{event.id}",
        "source": "municipal_event",
        "source_id": event.id,
        "entry_type": "municipal_event",
        "title": event.title,
        "description": event.description,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "start_datetime": start_dt.isoformat(),
        "end_datetime": end_dt.isoformat(),
        "all_day": False,
        "location": location,
        "scope": scope,
        "is_citywide": is_citywide,
        "category": event.category,
        "category_display": event.get_category_display() if hasattr(event, 'get_category_display') else event.category,
        "status": event.status,
        "barangays": barangays_ids,
        "barangay_details": barangay_details,
        "url": f"/events/{event.id}",
        "metadata": {
            "organizer": event.organizer,
            "cover_image": cover_image_url,
            "is_citywide": is_citywide,
        },
    }


def normalize_municipal_events(events):
    """Normalizes a list of MunicipalEvent instances sorted deterministically."""
    entries = [normalize_municipal_event(e) for e in events]
    entries.sort(key=lambda e: (e['start_datetime'], e['id']))
    return entries


def normalize_news_item(item):
    """
    Normalizes a NewsItem instance into an all-day informational CalendarEntry dictionary.
    Do not treat date as an event activity time; it is a publication date.
    """
    is_citywide = (item.barangay is None)
    scope = 'citywide' if is_citywide else 'barangay'

    if item.barangay:
        barangays_ids = [item.barangay.id]
        barangay_details = [{'id': item.barangay.id, 'name': item.barangay.name}]
        location = item.barangay.name
    else:
        barangays_ids = []
        barangay_details = []
        location = "Citywide"

    # All-day notice representation
    start_dt = datetime.datetime.combine(item.date, datetime.time.min, tzinfo=MANILA_TZ)
    end_dt = datetime.datetime.combine(item.date, datetime.time.max.replace(microsecond=0), tzinfo=MANILA_TZ)

    entry_type = "announcement" if item.type == 'announcement' else "news"

    image_url = None
    if getattr(item, 'image', None):
        try:
            image_url = item.image.url
        except Exception:
            image_url = str(item.image)

    return {
        "id": f"news_{item.id}",
        "source": "news_item",
        "source_id": item.id,
        "entry_type": entry_type,
        "title": item.title,
        "description": item.description,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "start_datetime": start_dt.isoformat(),
        "end_datetime": end_dt.isoformat(),
        "all_day": True,
        "location": location,
        "scope": scope,
        "is_citywide": is_citywide,
        "category": item.type,
        "category_display": item.get_type_display() if hasattr(item, 'get_type_display') else item.type,
        "status": item.status,
        "barangays": barangays_ids,
        "barangay_details": barangay_details,
        "url": f"/news/{item.id}",
        "metadata": {
            "priority": item.priority,
            "is_pinned": item.is_pinned,
            "is_featured": item.is_featured,
            "news_category": item.category,
            "image": image_url,
        },
    }


def normalize_news_items(items):
    """Normalizes a list of NewsItem instances sorted deterministically."""
    entries = [normalize_news_item(i) for i in items]
    entries.sort(key=lambda e: (e['start_datetime'], e['id']))
    return entries


def normalize_emergency_alert(alert):
    """
    Normalizes an EmergencyAlert instance into an all-day emergency advisory CalendarEntry.
    """
    start_dt = datetime.datetime.combine(alert.date, datetime.time.min, tzinfo=MANILA_TZ)
    end_dt = datetime.datetime.combine(alert.date, datetime.time.max.replace(microsecond=0), tzinfo=MANILA_TZ)

    status_str = "active" if alert.is_active else "inactive"

    return {
        "id": f"alert_{alert.id}",
        "source": "emergency_alert",
        "source_id": alert.id,
        "entry_type": "emergency_advisory",
        "title": alert.title,
        "description": alert.body,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "start_datetime": start_dt.isoformat(),
        "end_datetime": end_dt.isoformat(),
        "all_day": True,
        "location": "Citywide",
        "scope": "citywide",
        "is_citywide": True,
        "category": "emergency_advisory",
        "category_display": "Emergency Advisory",
        "status": status_str,
        "barangays": [],
        "barangay_details": [],
        "url": None,
        "metadata": {
            "is_active": alert.is_active,
        },
    }


def normalize_emergency_alerts(alerts):
    """Normalizes a list of EmergencyAlert instances sorted deterministically."""
    entries = [normalize_emergency_alert(a) for a in alerts]
    entries.sort(key=lambda e: (e['start_datetime'], e['id']))
    return entries
