"""
Database selectors for the WasteWatch Calendar Service.

Provides read-only, bounded database queries for CollectionSchedule records
and StopValidation completion evidence, strictly avoiding N+1 query patterns.
"""

from collections import defaultdict
import datetime
from django.db.models import Q
from django.utils import timezone

from accounts.models import UserRole
from accounts.permissions import is_admin_user
from driver.models import CollectionSchedule
from events.models import EventCategory, EventStatus, MunicipalEvent
from news.models import ContentStatus, EmergencyAlert, NewsItem
from watcher.models import StopValidation
from .exceptions import CalendarCapacityError, CalendarDateRangeError
from .normalizers import (
    MANILA_TZ,
    expand_schedule_occurrences,
    normalize_collection_schedules,
    normalize_emergency_alerts,
    normalize_municipal_events,
    normalize_news_items,
)

MAX_INCLUSIVE_DAYS = 93
MAX_RECURRING_TEMPLATES = 100
OVERFLOW_SAMPLE_LIMIT = 101
GLOBAL_MAX_ENTRIES = 1000
UNPAGINATED_MAX_ENTRIES = 250


def validate_date_window(start_date, end_date):
    """
    Validates that the provided start_date and end_date form a valid, bounded window.
    Raises CalendarDateRangeError if start_date > end_date or if the inclusive day
    count exceeds 93 calendar days.
    """
    if not isinstance(start_date, datetime.date) or not isinstance(end_date, datetime.date):
        raise CalendarDateRangeError("start_date and end_date must be datetime.date instances.")

    if start_date > end_date:
        raise CalendarDateRangeError("Inverted date range: start_date must be on or before end_date.")

    inclusive_days = (end_date - start_date).days + 1
    if inclusive_days > MAX_INCLUSIVE_DAYS:
        raise CalendarDateRangeError(
            f"Requested date range ({inclusive_days} days) exceeds maximum allowed limit of {MAX_INCLUSIVE_DAYS} days."
        )

    return inclusive_days


def fetch_stop_validations_map(schedule_ids, dates):
    """
    Fetches date-specific StopValidation evidence in a single grouped batch query.
    Returns a dictionary mapping:
        (schedule_id, collection_date) -> {stop_order: current_status}
    """
    if not schedule_ids or not dates:
        return {}

    validations = (
        StopValidation.objects
        .filter(schedule_id__in=schedule_ids, collection_date__in=dates)
        .values('schedule_id', 'collection_date', 'stop_order', 'current_status')
    )

    validations_map = defaultdict(dict)
    for row in validations:
        key = (row['schedule_id'], row['collection_date'])
        validations_map[key][row['stop_order']] = row['current_status']

    return dict(validations_map)


def select_collection_schedules(
    start_date,
    end_date,
    barangay_id=None,
    include_admin_scopes=False,
    include_cancelled=False,
    reference_date=None,
):
    """
    Selects CollectionSchedule records relevant to the requested bounded date range.

    Lifecycle semantics:
    - CANCELLED schedules are excluded unless explicitly requested via include_cancelled=True.
    - COMPLETED one-time schedules are preserved for historical/current dates (date <= ref_date).
      If the query window is purely in the future (start_date > ref_date), they are excluded.
    - COMPLETED recurring templates do not generate future occurrences.
      If the query window is purely in the future (start_date > ref_date), they are excluded.
    - Active recurring template capacity limit (100 templates) checks eligible active recurring templates.
      Completed and cancelled recurring templates do not consume the active template capacity.
    """
    validate_date_window(start_date, end_date)
    ref_date = reference_date or timezone.localdate()

    one_time_qs = CollectionSchedule.objects.filter(date__range=(start_date, end_date))
    recurring_qs = CollectionSchedule.objects.filter(date__isnull=True)

    if not include_cancelled:
        one_time_qs = one_time_qs.exclude(status='CANCELLED')
        recurring_qs = recurring_qs.exclude(status='CANCELLED')

        if start_date > ref_date:
            one_time_qs = one_time_qs.exclude(status='COMPLETED')
            recurring_qs = recurring_qs.exclude(status='COMPLETED')

    if barangay_id is not None:
        if include_admin_scopes:
            scope_filter = Q(barangays__id=barangay_id) | Q(barangays__isnull=True)
        else:
            scope_filter = (
                Q(barangays__id=barangay_id) |
                (Q(barangays__isnull=True) & (Q(area__iexact='citywide') | Q(area__iexact='city-wide')))
            )
        one_time_qs = one_time_qs.filter(scope_filter).distinct()
        recurring_qs = recurring_qs.filter(scope_filter).distinct()

    one_time_qs = one_time_qs.prefetch_related('barangays').order_by('id')
    recurring_qs = recurring_qs.prefetch_related('barangays').order_by('id')

    # Bounded processing with overflow detection on active recurring templates
    active_recurring_qs = recurring_qs.filter(status='PENDING')
    active_recurring_sample = list(active_recurring_qs[:OVERFLOW_SAMPLE_LIMIT])
    if len(active_recurring_sample) > MAX_RECURRING_TEMPLATES:
        raise CalendarCapacityError(
            f"Active recurring schedule templates exceed maximum processing limit of {MAX_RECURRING_TEMPLATES}."
        )

    # For recurring schedules, completed templates only apply if start_date <= ref_date
    if start_date <= ref_date and not include_cancelled:
        completed_recurring = list(recurring_qs.filter(status='COMPLETED'))
    elif include_cancelled:
        completed_recurring = list(recurring_qs.filter(status__in=['COMPLETED', 'CANCELLED']))
    else:
        completed_recurring = []

    # One-time schedules capacity check (cap-plus-one)
    one_time_sample = list(one_time_qs[:GLOBAL_MAX_ENTRIES + 1])
    if len(one_time_sample) > GLOBAL_MAX_ENTRIES:
        raise CalendarCapacityError(
            f"One-time collection schedules count exceeds maximum processing limit of {GLOBAL_MAX_ENTRIES}."
        )

    recurring_list = active_recurring_sample + completed_recurring
    one_time_list = one_time_sample

    # Return merged deterministic list of schedule objects
    merged = sorted(one_time_list + recurring_list, key=lambda s: s.id)
    return merged


def get_normalized_collection_schedules(
    start_date,
    end_date,
    barangay_id=None,
    include_admin_scopes=False,
    include_cancelled=False,
    reference_date=None,
):
    """
    High-level read-only pipeline:
    1. Validates bounds.
    2. Selects relevant schedules.
    3. Expands occurrence dates.
    4. Batch queries StopValidation evidence in 1 single query.
    5. Normalizes occurrences into sanitized CalendarEntry dictionaries.
    """
    ref_date = reference_date or timezone.localdate()

    schedules = select_collection_schedules(
        start_date=start_date,
        end_date=end_date,
        barangay_id=barangay_id,
        include_admin_scopes=include_admin_scopes,
        include_cancelled=include_cancelled,
        reference_date=ref_date,
    )

    if not schedules:
        return []

    # Collect all needed (schedule_id, date) coordinates
    needed_schedule_ids = set()
    needed_dates = set()
    for schedule in schedules:
        occ_dates = expand_schedule_occurrences(schedule, start_date, end_date, reference_date=ref_date)
        if occ_dates:
            needed_schedule_ids.add(schedule.id)
            needed_dates.update(occ_dates)

    stop_validations_map = fetch_stop_validations_map(needed_schedule_ids, needed_dates)

    return normalize_collection_schedules(
        schedules=schedules,
        start_date=start_date,
        end_date=end_date,
        stop_validations_map=stop_validations_map,
        reference_date=ref_date,
    )


def select_municipal_events(
    start_date,
    end_date,
    user=None,
    barangay_id=None,
    category=None,
    status=None,
):
    """
    Selects MunicipalEvent records relevant to the requested bounded date range.

    Visibility & Scoping:
    - Non-admin:
      - Strictly sees status IN ['published', 'cancelled', 'completed'].
      - Draft and archived events never leak.
      - If user is Barangay Official:
        Locked to citywide events (barangays__isnull=True) OR user.barangay_id.
        Cross-barangay query parameters are blocked.
      - If other non-admin:
        If barangay_id is provided, matches citywide OR barangay_id.
        If no barangay_id, matches all published public events.
    - Admin (is_admin_user(user)):
      - Can view all statuses (draft, published, cancelled, completed, archived).
      - If status filter is passed, filter by that status.
    """
    validate_date_window(start_date, end_date)
    is_admin = is_admin_user(user)

    window_start = datetime.datetime.combine(start_date, datetime.time.min, tzinfo=MANILA_TZ)
    window_end = datetime.datetime.combine(end_date, datetime.time.max, tzinfo=MANILA_TZ)

    qs = MunicipalEvent.objects.filter(
        end_datetime__gte=window_start,
        start_datetime__lte=window_end,
    )

    if not is_admin:
        qs = qs.filter(status__in=[
            EventStatus.PUBLISHED,
            EventStatus.CANCELLED,
            EventStatus.COMPLETED,
        ])
        if status and status != 'all':
            qs = qs.filter(status=status)
        if getattr(user, 'role', None) == UserRole.BRGY_OFFICIAL and getattr(user, 'barangay_id', None):
            user_brgy = user.barangay_id
            qs = qs.filter(Q(barangays__isnull=True) | Q(barangays__id=user_brgy))
        elif barangay_id is not None:
            if barangay_id == 'citywide':
                qs = qs.filter(barangays__isnull=True)
            else:
                qs = qs.filter(Q(barangays__isnull=True) | Q(barangays__id=barangay_id))
    else:
        if status and status != 'all':
            qs = qs.filter(status=status)
        if barangay_id is not None:
            if barangay_id == 'citywide':
                qs = qs.filter(barangays__isnull=True)
            else:
                qs = qs.filter(Q(barangays__isnull=True) | Q(barangays__id=barangay_id))

    if category and category != 'all':
        qs = qs.filter(category=category)

    qs = qs.select_related('created_by').prefetch_related('barangays').distinct().order_by('start_datetime', 'id')

    # Bounded processing with overflow detection (cap-plus-one)
    sample = list(qs[:GLOBAL_MAX_ENTRIES + 1])
    if len(sample) > GLOBAL_MAX_ENTRIES:
        raise CalendarCapacityError(
            f"Municipal events count exceeds maximum processing limit of {GLOBAL_MAX_ENTRIES}."
        )

    return sample


def get_normalized_municipal_events(
    start_date,
    end_date,
    user=None,
    barangay_id=None,
    category=None,
    status=None,
):
    """Selects and normalizes MunicipalEvent instances into canonical CalendarEntry dicts."""
    events = select_municipal_events(
        start_date=start_date,
        end_date=end_date,
        user=user,
        barangay_id=barangay_id,
        category=category,
        status=status,
    )
    return normalize_municipal_events(events)


def select_news_items(
    start_date,
    end_date,
    user=None,
    barangay_id=None,
    category=None,
    status=None,
    include_notices=False,
):
    """
    Selects NewsItem notices published within [start_date, end_date].
    OPTIONAL: Disabled by default (returns [] unless include_notices is True).

    Visibility & Scoping:
    - Non-admin:
      - is_active=True and status=ContentStatus.PUBLISHED.
      - Draft and archived records do not leak.
      - If user is Barangay Official:
        Locked to citywide (barangay__isnull=True) OR user.barangay_id.
      - If other non-admin:
        If barangay_id is provided, matches citywide OR barangay_id.
        If no barangay_id, matches all published active items.
    - Admin (is_admin_user(user)):
      - Can view all statuses.
    """
    if not include_notices:
        return []

    validate_date_window(start_date, end_date)
    is_admin = is_admin_user(user)

    qs = NewsItem.objects.filter(date__range=(start_date, end_date))

    if not is_admin:
        qs = qs.filter(is_active=True, status=ContentStatus.PUBLISHED)
        if status and status != 'all':
            qs = qs.filter(status=status)
        if getattr(user, 'role', None) == UserRole.BRGY_OFFICIAL and getattr(user, 'barangay_id', None):
            user_brgy = user.barangay_id
            qs = qs.filter(Q(barangay__isnull=True) | Q(barangay_id=user_brgy))
        elif barangay_id is not None:
            if barangay_id == 'citywide':
                qs = qs.filter(barangay__isnull=True)
            else:
                qs = qs.filter(Q(barangay__isnull=True) | Q(barangay_id=barangay_id))
    else:
        if status and status != 'all':
            qs = qs.filter(status=status)
        if barangay_id is not None:
            if barangay_id == 'citywide':
                qs = qs.filter(barangay__isnull=True)
            else:
                qs = qs.filter(Q(barangay__isnull=True) | Q(barangay_id=barangay_id))

    if category and category != 'all':
        qs = qs.filter(Q(category__iexact=category) | Q(type__iexact=category))

    qs = qs.select_related('barangay', 'author').distinct().order_by('-is_pinned', '-date', 'id')

    # Bounded processing with overflow detection (cap-plus-one)
    sample = list(qs[:GLOBAL_MAX_ENTRIES + 1])
    if len(sample) > GLOBAL_MAX_ENTRIES:
        raise CalendarCapacityError(
            f"News items count exceeds maximum processing limit of {GLOBAL_MAX_ENTRIES}."
        )

    return sample


def get_normalized_news_items(
    start_date,
    end_date,
    user=None,
    barangay_id=None,
    category=None,
    status=None,
    include_notices=False,
):
    """Selects and normalizes NewsItem notices into all-day CalendarEntry dicts."""
    items = select_news_items(
        start_date=start_date,
        end_date=end_date,
        user=user,
        barangay_id=barangay_id,
        category=category,
        status=status,
        include_notices=include_notices,
    )
    return normalize_news_items(items)


def select_emergency_alerts(
    start_date,
    end_date,
    user=None,
    category=None,
    status=None,
    include_notices=False,
):
    """
    Selects EmergencyAlert advisories published within [start_date, end_date].
    OPTIONAL: Disabled by default (returns [] unless include_notices is True).

    Visibility:
    - Non-admin: is_active=True only. Inactive alerts do not leak.
    - Admin (is_admin_user(user)): all alerts.
    - Scope: Always citywide.
    """
    if not include_notices:
        return []

    validate_date_window(start_date, end_date)
    is_admin = is_admin_user(user)

    qs = EmergencyAlert.objects.filter(date__range=(start_date, end_date))

    if not is_admin:
        qs = qs.filter(is_active=True)
        if status and status != 'all':
            if status.lower() not in ('active', 'published'):
                return []
    else:
        if status and status != 'all':
            if status.lower() == 'active':
                qs = qs.filter(is_active=True)
            elif status.lower() == 'inactive':
                qs = qs.filter(is_active=False)

    if category and category != 'all':
        if category.lower() not in ('emergency_advisory', 'advisory'):
            return []

    qs = qs.order_by('-date', '-updated_at', 'id')

    # Bounded processing with overflow detection (cap-plus-one)
    sample = list(qs[:GLOBAL_MAX_ENTRIES + 1])
    if len(sample) > GLOBAL_MAX_ENTRIES:
        raise CalendarCapacityError(
            f"Emergency alerts count exceeds maximum processing limit of {GLOBAL_MAX_ENTRIES}."
        )

    return sample


def get_normalized_emergency_alerts(
    start_date,
    end_date,
    user=None,
    category=None,
    status=None,
    include_notices=False,
):
    """Selects and normalizes EmergencyAlert advisories into all-day CalendarEntry dicts."""
    alerts = select_emergency_alerts(
        start_date=start_date,
        end_date=end_date,
        user=user,
        category=category,
        status=status,
        include_notices=include_notices,
    )
    return normalize_emergency_alerts(alerts)
