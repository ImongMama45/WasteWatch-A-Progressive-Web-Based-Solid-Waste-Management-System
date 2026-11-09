"""
Unified Calendar Aggregator for the WasteWatch Calendar Service.

Combines CollectionSchedule, MunicipalEvent, NewsItem, and EmergencyAlert sources
into a unified, deterministically sorted collection conforming to Calendar Service Contract v0.2.
"""

import datetime
from zoneinfo import ZoneInfo
from django.utils import timezone

from .exceptions import CalendarCapacityError
from .normalizers import MANILA_TZ
from .selectors import (
    GLOBAL_MAX_ENTRIES,
    UNPAGINATED_MAX_ENTRIES,
    get_normalized_collection_schedules,
    get_normalized_emergency_alerts,
    get_normalized_municipal_events,
    get_normalized_news_items,
    select_collection_schedules,
    select_emergency_alerts,
    select_municipal_events,
    select_news_items,
)

ENTRY_TYPE_PRIORITY = {
    'emergency_advisory': 0,
    'municipal_event': 1,
    'collection_schedule': 2,
    'announcement': 3,
    'news': 3,
}


def calendar_sort_key(entry):
    """
    Deterministic global sort key conforming to Contract v0.2:
    (start_datetime, priority_int, source_str, source_id)
    """
    start_str = entry.get('start_datetime') or entry.get('start')
    try:
        dt = datetime.datetime.fromisoformat(start_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=MANILA_TZ)
    except (ValueError, TypeError):
        dt = datetime.datetime.min.replace(tzinfo=MANILA_TZ)

    entry_type = entry.get('entry_type', '')
    priority = ENTRY_TYPE_PRIORITY.get(entry_type, 99)
    source_str = entry.get('source', '')
    try:
        source_id = int(entry.get('source_id', 0))
    except (ValueError, TypeError):
        source_id = 0

    return (dt, priority, source_str, source_id)


def filter_entry_by_category(entry, category):
    """Checks whether a normalized entry matches the requested category."""
    if not category or category == 'all':
        return True
    target = category.strip().lower()
    entry_cat = str(entry.get('category', '')).lower()
    entry_type = str(entry.get('entry_type', '')).lower()
    meta_news_cat = str(entry.get('metadata', {}).get('news_category', '')).lower()

    return target in (entry_cat, entry_type, meta_news_cat)


def filter_entry_by_status(entry, status):
    """Checks whether a normalized entry matches the requested status."""
    if not status or status == 'all':
        return True
    target = status.strip().lower()
    entry_status = str(entry.get('status', '')).lower()
    meta_lifecycle = str(entry.get('metadata', {}).get('schedule_lifecycle', '')).lower()

    return target in (entry_status, meta_lifecycle)


def aggregate_calendar_entries(
    start_date,
    end_date,
    user=None,
    barangay_id=None,
    source=None,
    category=None,
    status=None,
    include_notices=False,
    reference_date=None,
    paginate=True,
):
    """
    Aggregates, filters, and globally sorts calendar entries across all supported sources.

    Parameters:
    - start_date (datetime.date): inclusive start date
    - end_date (datetime.date): inclusive end date
    - user: requesting user instance (or AnonymousUser)
    - barangay_id: optional barangay filter (int or 'citywide')
    - source: optional source filter ('collection_schedule', 'municipal_event', 'news_item', 'emergency_alert', 'all')
    - category: optional category filter
    - status: optional status filter
    - include_notices (bool): gate for NewsItem and EmergencyAlert
    - reference_date (datetime.date): optional reference date for schedule completion evaluation
    - paginate (bool): whether pagination is enabled

    Returns:
    - list of normalized CalendarEntry dictionaries sorted deterministically
    """
    entries = []
    target_source = source.lower() if source else None

    # 1. Collection Schedules
    if target_source in (None, 'all', 'collection_schedule'):
        sched_entries = get_normalized_collection_schedules(
            start_date=start_date,
            end_date=end_date,
            barangay_id=barangay_id,
            include_admin_scopes=False,
            include_cancelled=False,
            reference_date=reference_date,
        )
        entries.extend(sched_entries)
        if len(entries) > GLOBAL_MAX_ENTRIES:
            raise CalendarCapacityError(
                f"Calendar aggregation capacity limit exceeded ({len(entries)} entries). "
                f"Maximum allowed processing limit is {GLOBAL_MAX_ENTRIES} entries. "
                f"Please narrow your date range or filter by barangay."
            )

    # 2. Municipal Events
    if target_source in (None, 'all', 'municipal_event'):
        event_entries = get_normalized_municipal_events(
            start_date=start_date,
            end_date=end_date,
            user=user,
            barangay_id=barangay_id,
            category=category,
            status=status,
        )
        entries.extend(event_entries)
        if len(entries) > GLOBAL_MAX_ENTRIES:
            raise CalendarCapacityError(
                f"Calendar aggregation capacity limit exceeded ({len(entries)} entries). "
                f"Maximum allowed processing limit is {GLOBAL_MAX_ENTRIES} entries. "
                f"Please narrow your date range or filter by barangay."
            )

    # 3. News Items (Announcements and News) — only if include_notices is True
    if target_source in (None, 'all', 'news_item'):
        if include_notices:
            news_entries = get_normalized_news_items(
                start_date=start_date,
                end_date=end_date,
                user=user,
                barangay_id=barangay_id,
                category=category,
                status=status,
                include_notices=True,
            )
            entries.extend(news_entries)
            if len(entries) > GLOBAL_MAX_ENTRIES:
                raise CalendarCapacityError(
                    f"Calendar aggregation capacity limit exceeded ({len(entries)} entries). "
                    f"Maximum allowed processing limit is {GLOBAL_MAX_ENTRIES} entries. "
                    f"Please narrow your date range or filter by barangay."
                )

    # 4. Emergency Alerts (Advisories) — only if include_notices is True
    if target_source in (None, 'all', 'emergency_alert'):
        if include_notices:
            alert_entries = get_normalized_emergency_alerts(
                start_date=start_date,
                end_date=end_date,
                user=user,
                category=category,
                status=status,
                include_notices=True,
            )
            entries.extend(alert_entries)
            if len(entries) > GLOBAL_MAX_ENTRIES:
                raise CalendarCapacityError(
                    f"Calendar aggregation capacity limit exceeded ({len(entries)} entries). "
                    f"Maximum allowed processing limit is {GLOBAL_MAX_ENTRIES} entries. "
                    f"Please narrow your date range or filter by barangay."
                )

    # Apply cross-source filters for category and status
    if category and category != 'all':
        entries = [e for e in entries if filter_entry_by_category(e, category)]

    if status and status != 'all':
        entries = [e for e in entries if filter_entry_by_status(e, status)]

    # Final capacity checks
    if len(entries) > GLOBAL_MAX_ENTRIES:
        raise CalendarCapacityError(
            f"Calendar aggregation capacity limit exceeded ({len(entries)} entries). "
            f"Maximum allowed processing limit is {GLOBAL_MAX_ENTRIES} entries. "
            f"Please narrow your date range or filter by barangay."
        )

    # Unpaginated safety cap enforcement
    if not paginate and len(entries) > UNPAGINATED_MAX_ENTRIES:
        raise CalendarCapacityError(
            f"Unpaginated calendar result ({len(entries)} entries) exceeds the maximum allowable limit of {UNPAGINATED_MAX_ENTRIES} entries."
        )

    # Deterministic global sorting across all aggregated entries
    entries.sort(key=calendar_sort_key)

    return entries
