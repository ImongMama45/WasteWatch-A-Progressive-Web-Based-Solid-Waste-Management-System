"""
wastewatch/public_api.py
------------------------
Public JSON endpoints — no login required.
These are cached by the service worker for offline use.

Endpoints:
  GET /api/public/announcements/  — city announcements
  GET /api/public/stats/          — community-level counts
  GET /api/public/schedule/       — general collection schedule
  GET /api/public/map/pins/       — sanitized collection-stop map pins
"""

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.cache import cache_page


# Cache for 5 minutes — reduces DB hits while keeping data fresh
@require_http_methods(['GET'])
@cache_page(60 * 5)
def announcements_view(request):
    """
    Returns public announcements.
    """
    from news.models import NewsItem
    
    items = NewsItem.objects.filter(is_featured=True)[:10]
    data = [
        {
            'id': item.id,
            'title': item.title,
            'body':  item.description,
            'date':  item.date.isoformat(),
            'type':  item.type,
            'barangay': item.barangay,
            'priority': item.priority,
        } for item in items
    ]
    return JsonResponse(data, safe=False)


@require_http_methods(['GET'])
@cache_page(60 * 2)
def public_stats_view(request):
    """
    Returns aggregate community statistics.
    Safe to expose publicly — no personal data.
    """
    from watcher.models import GarbageReport, ReportStatus, GarbageHotspot
    from driver.models import Truck, TruckStatus
    from dumpsite.models import WasteDelivery
    from django.contrib.auth import get_user_model
    from django.utils import timezone
    from django.conf import settings
    from datetime import timedelta
    from django.db.models import Sum, Count
    
    User = get_user_model()

    today = timezone.localdate()

    try:
        verified_reports = GarbageReport.objects.filter(status__in=[ReportStatus.APPROVED, ReportStatus.RESOLVED], is_watcher_spot=False)
        total_reports    = verified_reports.count()
        resolved_reports = verified_reports.filter(status=ReportStatus.RESOLVED).count()
        pending_reports  = GarbageReport.objects.filter(status=ReportStatus.PENDING).count()
        total_trucks     = Truck.objects.count()
        active_trucks    = Truck.objects.filter(status=TruckStatus.ACTIVE).count()
        hotspots         = GarbageHotspot.objects.exclude(source_report__is_watcher_spot=True).count()

        now = timezone.now()
        staleness_cutoff = now - timedelta(hours=getattr(settings, 'SHIFT_STALE_HOURS', 6))
        online_trucks = Truck.objects.filter(
            shifts__is_active=True,
            shifts__last_location_update__gte=staleness_cutoff,
        ).distinct().count()

        cutoff = now - timedelta(minutes=5)

        online_counts = (
            User.objects
            .filter(
                role__in=('watcher', 'brgy_official', 'driver'),
                last_activity__gte=cutoff,
            )
            .values('role')
            .annotate(count=Count('id'))
        )
        role_counts = {row['role']: row['count'] for row in online_counts}

        active_watchers  = role_counts.get('watcher', 0)
        total_watchers   = User.objects.filter(role='watcher').count()
        active_officials = role_counts.get('brgy_official', 0)
        total_officials  = User.objects.filter(role='brgy_official').count()

        deliveries_today = WasteDelivery.objects.filter(date=today)
        completed_routes = deliveries_today.count()
        total_waste      = deliveries_today.aggregate(total=Sum('estimated_kg'))['total'] or 0
        barangays_covered = deliveries_today.values('barangays').distinct().count()
    except Exception:
        total_reports    = 0
        resolved_reports = 0
        pending_reports  = 0
        total_trucks     = 0
        active_trucks    = 0
        online_trucks    = 0
        hotspots         = 0
        active_watchers  = 0
        total_watchers   = 0
        active_officials = 0
        total_officials  = 0
        completed_routes = 0
        total_waste      = 0
        barangays_covered = 0

    return JsonResponse({
        'total_reports':    total_reports,
        'resolved_reports': resolved_reports,
        'pending_reports':  pending_reports,
        'active_trucks':    active_trucks,
        'online_trucks':    online_trucks,
        'total_trucks':     total_trucks,
        'active_watchers':  active_watchers,
        'total_watchers':   total_watchers,
        'active_officials': active_officials,
        'total_officials':  total_officials,
        'hotspots':         hotspots,
        'completed_routes': completed_routes,
        'total_waste':      total_waste,
        'barangays_covered': barangays_covered,
    })



@require_http_methods(['GET'])
def public_schedule_view(request):
    """
    Returns sanitized public collection schedules (not personalized).
    Safe for unauthenticated public consumption:
    - Excludes cancelled schedules.
    - Excludes driver identities and user IDs.
    - Excludes truck plates, IDs, and live telemetry.
    - Excludes dumpsite coordinates and internal IDs.
    - Excludes watcher names and raw GPS waypoint coordinates.
    - Bounded to 100 schedules.
    """
    from driver.models import CollectionSchedule
    from django.db.models import Q
    import datetime

    # Exclude CANCELLED schedules completely from public schedule view
    schedules = CollectionSchedule.objects.exclude(status='CANCELLED').prefetch_related('barangays')

    # Optional barangay filtering
    barangay_id = request.GET.get('barangay_id')
    if barangay_id:
        try:
            bid = int(barangay_id)
            schedules = schedules.filter(
                Q(barangays__id=bid) |
                (Q(barangays__isnull=True) & (Q(area__iexact='citywide') | Q(area__iexact='city-wide')))
            ).distinct()
        except (ValueError, TypeError):
            pass

    # Bounded processing
    schedules = schedules.order_by('id')[:100]

    today_name = datetime.datetime.now().strftime("%a")

    data = []
    for s in schedules:
        is_today = today_name in s.days if s.days else False

        time_str = ""
        if s.start_time and s.end_time:
            time_str = f"{s.start_time.strftime('%I:%M %p').lstrip('0')} – {s.end_time.strftime('%I:%M %p').lstrip('0')}"
        elif s.start_time:
            time_str = s.start_time.strftime('%I:%M %p').lstrip('0')

        brgy_list = list(s.barangays.all())
        brgy_names = ", ".join([b.name for b in brgy_list]) if brgy_list else (s.area or "City-Wide")
        brgy_ids = [b.id for b in brgy_list]

        # Extract sanitized stop labels only (no GPS coords, no watcher names)
        safe_stops = []
        for idx, wp in enumerate(s.waypoints or []):
            if isinstance(wp, dict):
                lbl = wp.get('label') or wp.get('address') or f"Stop {idx + 1}"
            elif isinstance(wp, str):
                lbl = wp
            else:
                lbl = f"Stop {idx + 1}"
            safe_stops.append({
                'order': idx + 1,
                'label': str(lbl).strip(),
            })

        data.append({
            # Backward-compatible fields for OfflineCommandCenter & existing clients
            'day': s.days or '',
            'zone': brgy_names,
            'time': time_str,
            'isNext': is_today,
            'status': 'upcoming' if is_today else 'pending',

            # Sanitized public collection route fields
            'id': s.id,
            'area': s.area or brgy_names,
            'days': s.days or '',
            'start_time': s.start_time.strftime('%H:%M:%S') if s.start_time else None,
            'end_time': s.end_time.strftime('%H:%M:%S') if s.end_time else None,
            'barangays': brgy_ids,
            'barangay_names': brgy_names,
            'total_stops': len(safe_stops),
            'stops': safe_stops,
            'color': getattr(s, 'color', None) or '#16a34a',
            'lifecycle_status': s.status,
        })

    return JsonResponse(data, safe=False)


@require_http_methods(['GET'])
def public_live_view(request):
    """
    Returns active truck locations for the citizen-facing map.
    Data is stripped of sensitive driver information.
    """
    from driver.models import DriverShift
    from django.utils import timezone
    from datetime import timedelta
    from django.conf import settings

    now = timezone.now()
    staleness_cutoff = now - timedelta(hours=getattr(settings, 'SHIFT_STALE_HOURS', 6))
    from django.db.models import Q
    
    active_shifts = DriverShift.objects.filter(
        Q(last_location_update__gte=staleness_cutoff) | Q(last_location_update__isnull=True, started_at__gte=staleness_cutoff),
        is_active=True,
        ended_at__isnull=True,
    ).select_related('truck', 'schedule')

    data = []
    for shift in active_shifts:
        schedule = shift.schedule
        if not schedule:
            from driver.models import TruckCrewAssignment, CollectionSchedule
            assignment = TruckCrewAssignment.objects.filter(
                driver=shift.driver, date=now.date(), is_active=True
            ).select_related('schedule').first()
            if assignment:
                schedule = assignment.schedule
            if not schedule:
                schedule = CollectionSchedule.objects.filter(driver=shift.driver, date=now.date()).first()
            if not schedule:
                schedule = CollectionSchedule.objects.filter(driver=shift.driver).first()

        barangays = ", ".join([b.name for b in schedule.barangays.all()]) if schedule and schedule.barangays.exists() else (schedule.area if schedule and schedule.area else "City-wide")
        
        data.append({
            'id': shift.id,
            'truck_model': shift.truck.model if shift.truck else 'Unknown',
            'latitude': float(shift.current_latitude) if shift.current_latitude else None,
            'longitude': float(shift.current_longitude) if shift.current_longitude else None,
            'op_status': shift.op_status,
            'barangays': barangays,
            'started_at': shift.started_at.isoformat() if shift.started_at else None,
            'last_updated': shift.last_location_update.isoformat() if shift.last_location_update else None
        })
        
        
    return JsonResponse(data, safe=False)


def get_eligible_public_schedules_queryset(barangay_id=None):
    """
    Authoritative query logic shared by public map pins and public stop statuses:
    1. Excludes CANCELLED schedules.
    2. Citywide schedules: barangays is null and area in ('citywide', 'city-wide') case-insensitively.
    3. Excludes blank/unassigned schedules and schedules with meaningful non-citywide area but no assigned barangays.
    4. If barangay_id is supplied: includes matching barangay OR recognized citywide.
       If barangay_id is not supplied: includes assigned-barangay schedules OR recognized citywide.
    5. Returns schedules ordered by 'id'.
    """
    from driver.models import CollectionSchedule
    from django.db.models import Q

    schedules = CollectionSchedule.objects.exclude(status='CANCELLED').prefetch_related('barangays')
    citywide_q = Q(barangays__isnull=True) & (Q(area__iexact='citywide') | Q(area__iexact='city-wide'))

    if barangay_id is not None:
        schedules = schedules.filter(Q(barangays__id=barangay_id) | citywide_q).distinct()
    else:
        schedules = schedules.filter(Q(barangays__isnull=False) | citywide_q).distinct()

    return schedules.order_by('id')


@require_http_methods(['GET'])
def public_map_pins_view(request):
    """
    Returns sanitized public collection route geometry and collection-stop coordinates.
    Safe for unauthenticated public consumption:
    - Excludes cancelled schedules.
    - Excludes driver identities, IDs, and assignments.
    - Excludes truck plates, IDs, and telemetry.
    - Excludes dumpsite coordinates, depot origin objects, and internal IDs.
    - Excludes watcher names and validation statuses.
    - Validates numeric coordinate ranges for each collection stop.
    - Omits malformed stops safely.
    - Adheres to Stage 0 citywide vs unassigned scope rules.
    - Bounded to 100 schedules.
    """
    # Optional barangay filtering
    barangay_id = request.GET.get('barangay_id')
    bid = None
    if barangay_id is not None:
        try:
            bid = int(barangay_id)
            if bid <= 0:
                return JsonResponse({'detail': 'Invalid barangay_id. Must be a positive integer.'}, status=400)
        except (ValueError, TypeError):
            return JsonResponse({'detail': 'Invalid barangay_id. Must be a positive integer.'}, status=400)

    schedules = get_eligible_public_schedules_queryset(bid)[:100]

    data = []
    for s in schedules:
        time_window = ""
        if s.start_time and s.end_time:
            time_window = f"{s.start_time.strftime('%I:%M %p')} – {s.end_time.strftime('%I:%M %p')}"
        elif s.start_time:
            time_window = s.start_time.strftime('%I:%M %p')

        brgy_list = list(s.barangays.all())
        brgy_names = ", ".join([b.name for b in brgy_list]) if brgy_list else (s.area or "City-Wide")
        brgy_ids = [b.id for b in brgy_list]

        # Extract and sanitize collection stops starting at index 1 (omitting index 0 depot)
        wps = s.waypoints if isinstance(s.waypoints, list) else []
        safe_stops = []
        for stop_idx, wp in enumerate(wps[1:], start=1):
            if not isinstance(wp, dict):
                continue
            lat = wp.get('lat')
            lng = wp.get('lng')
            if lat is None or lng is None:
                continue
            try:
                lat_f = float(lat)
                lng_f = float(lng)
            except (ValueError, TypeError):
                continue

            # Validate standard coordinate ranges (-90 to 90 lat, -180 to 180 lng)
            if not (-90.0 <= lat_f <= 90.0 and -180.0 <= lng_f <= 180.0):
                continue

            wp_bid = wp.get('barangay_id')
            if wp_bid is not None:
                try:
                    wp_bid = int(wp_bid)
                except (ValueError, TypeError):
                    wp_bid = None

            label = str(wp.get('label') or wp.get('address') or f"Stop {stop_idx}").strip()

            safe_stops.append({
                'order': stop_idx,
                'label': label,
                'lat': lat_f,
                'lng': lng_f,
                'barangay_id': wp_bid,
            })

        data.append({
            'id': s.id,
            'area': s.area or brgy_names,
            'days': s.days or '',
            'time_window': time_window,
            'color': getattr(s, 'color', None) or '#16a34a',
            'barangays': brgy_ids,
            'barangay_names': brgy_names,
            'total_stops': len(safe_stops),
            'stops': safe_stops,
        })

    return JsonResponse(data, safe=False)


@require_http_methods(['GET'])
def public_stop_statuses_view(request):
    """
    Returns sanitized public stop validation statuses for collection route stops.
    Safe for unauthenticated public consumption:
    - Bounded strictly to eligible public schedules (excludes CANCELLED, unassigned).
    - Validates stop_order against existing, valid coordinate waypoints.
    - Validates schedule occurrence:
        * One-time schedule: matches schedule.date
        * Recurring schedule: matches normalized weekday using calendar_service.normalizers.normalize_days
    - Visibility rules:
        * Today's non-terminal statuses (PENDING_INSPECTION, READY_FOR_COLLECTION, COLLECTION_REPORTED)
          are visible for today.
        * Terminal statuses (EMPTY_STOP, VERIFIED_COLLECTED, COLLECTION_DISPUTED) require authoritative
          transition timestamp within the last 24 hours (pre_validation_timestamp for EMPTY_STOP,
          post_validation_timestamp for VERIFIED_COLLECTED and COLLECTION_DISPUTED).
        * Fail closed: missing authoritative terminal timestamp excludes the record.
        * Never substitute collection_timestamp for post_validation_timestamp.
    - Date semantics:
        * Default: today and yesterday considered. At most one record per physical stop (schedule_id, stop_order).
          Today's record takes precedence. Yesterday carryover only if no today record exists and
          yesterday terminal record is within 24h.
        * Explicit ?date=YYYY-MM-DD: accepts today or yesterday only; exact date matching (no carryover).
          Invalid, future, or dates older than yesterday return HTTP 400.
    - Minimal 7-field payload:
        {schedule_id, stop_order, status, collected_at, collection_date, is_today, occurrence_key}
    """
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    from django.utils import timezone
    from calendar_service.normalizers import normalize_days, VALID_WEEKDAYS
    from watcher.models import StopValidation, StopValidationStatus

    # 1. Parse and validate barangay_id
    barangay_id = request.GET.get('barangay_id')
    bid = None
    if barangay_id is not None:
        try:
            bid = int(barangay_id)
            if bid <= 0:
                return JsonResponse({'detail': 'Invalid barangay_id. Must be a positive integer.'}, status=400)
        except (ValueError, TypeError):
            return JsonResponse({'detail': 'Invalid barangay_id. Must be a positive integer.'}, status=400)

    # 2. Parse and validate date parameter
    today = timezone.localdate()
    yesterday = today - timedelta(days=1)
    date_param = request.GET.get('date')
    explicit_date = None

    if date_param is not None:
        try:
            explicit_date = datetime.strptime(date_param, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            return JsonResponse({'detail': 'Invalid date format. Expected YYYY-MM-DD.'}, status=400)

        if explicit_date > today:
            return JsonResponse({'detail': 'Date cannot be in the future.'}, status=400)
        if explicit_date < yesterday:
            return JsonResponse({'detail': 'Date query out of range. Public stop status is restricted to current active cycles.'}, status=400)

    # 3. Retrieve eligible schedules and map valid stops
    schedules_qs = get_eligible_public_schedules_queryset(bid)[:100]
    schedules = list(schedules_qs)
    schedule_map = {}
    valid_stops_by_schedule = {}

    for s in schedules:
        schedule_map[s.id] = s
        wps = s.waypoints if isinstance(s.waypoints, list) else []
        valid_orders = set()
        for idx in range(1, len(wps)):
            wp = wps[idx]
            if not isinstance(wp, dict):
                continue
            lat = wp.get('lat')
            lng = wp.get('lng')
            if lat is None or lng is None:
                continue
            try:
                lat_f = float(lat)
                lng_f = float(lng)
            except (ValueError, TypeError):
                continue
            if -90.0 <= lat_f <= 90.0 and -180.0 <= lng_f <= 180.0:
                valid_orders.add(idx)
        if valid_orders:
            valid_stops_by_schedule[s.id] = valid_orders

    if not valid_stops_by_schedule:
        return JsonResponse([], safe=False)

    eligible_schedule_ids = list(valid_stops_by_schedule.keys())

    # 4. Determine dates to query
    if explicit_date is not None:
        query_dates = [explicit_date]
    else:
        query_dates = [today, yesterday]

    # 5. Fetch candidate validations
    validations = (
        StopValidation.objects
        .filter(
            schedule_id__in=eligible_schedule_ids,
            collection_date__in=query_dates
        )
        .select_related('schedule')
        .order_by('collection_date', 'schedule_id', 'stop_order')
    )

    now = timezone.now()
    cutoff_24h = now - timedelta(hours=24)
    manila_tz = ZoneInfo('Asia/Manila')

    def is_valid_occurrence(schedule, c_date):
        if schedule.date is not None:
            return schedule.date == c_date
        normalized = normalize_days(schedule.days)
        valid_days = normalized.intersection(VALID_WEEKDAYS)
        if not valid_days:
            return False
        weekday_code = c_date.strftime('%a').lower()
        return weekday_code in valid_days

    # Group validations by physical stop: (schedule_id, stop_order) -> {date: record}
    validations_by_stop = {}
    for sv in validations:
        key = (sv.schedule_id, sv.stop_order)
        if key not in validations_by_stop:
            validations_by_stop[key] = {}
        validations_by_stop[key][sv.collection_date] = sv

    def evaluate_record(sv, is_today_flag):
        schedule = schedule_map.get(sv.schedule_id)
        if not schedule:
            return None

        # Waypoint check
        allowed_orders = valid_stops_by_schedule.get(sv.schedule_id, set())
        if sv.stop_order not in allowed_orders:
            return None

        # Occurrence check
        if not is_valid_occurrence(schedule, sv.collection_date):
            return None

        st = sv.current_status
        collected_at_str = None

        if st == StopValidationStatus.PENDING_INSPECTION:
            if not is_today_flag:
                return None
        elif st == StopValidationStatus.READY_FOR_COLLECTION:
            if not is_today_flag:
                return None
        elif st == StopValidationStatus.COLLECTION_REPORTED:
            if not is_today_flag:
                return None
            if sv.collection_timestamp:
                collected_at_str = timezone.localtime(sv.collection_timestamp, manila_tz).strftime('%H:%M')
        elif st == StopValidationStatus.EMPTY_STOP:
            # Authoritative timestamp: pre_validation_timestamp
            if not sv.pre_validation_timestamp:
                return None
            if sv.pre_validation_timestamp < cutoff_24h or sv.pre_validation_timestamp > now:
                return None
        elif st == StopValidationStatus.VERIFIED_COLLECTED:
            # Authoritative timestamp: post_validation_timestamp strictly
            if not sv.post_validation_timestamp:
                return None
            if sv.post_validation_timestamp < cutoff_24h or sv.post_validation_timestamp > now:
                return None
            if sv.collection_timestamp:
                collected_at_str = timezone.localtime(sv.collection_timestamp, manila_tz).strftime('%H:%M')
        elif st == StopValidationStatus.COLLECTION_DISPUTED:
            # Authoritative timestamp: post_validation_timestamp strictly
            if not sv.post_validation_timestamp:
                return None
            if sv.post_validation_timestamp < cutoff_24h or sv.post_validation_timestamp > now:
                return None
        else:
            return None

        return {
            'schedule_id': sv.schedule_id,
            'stop_order': sv.stop_order,
            'status': st,
            'collected_at': collected_at_str,
            'collection_date': sv.collection_date.isoformat(),
            'is_today': is_today_flag,
            'occurrence_key': f"{sv.schedule_id}:{sv.stop_order}:{sv.collection_date.isoformat()}",
        }

    results = []

    if explicit_date is not None:
        # Explicit date: return valid records for explicit_date only
        is_today_flag = (explicit_date == today)
        for key, dates_dict in validations_by_stop.items():
            sv = dates_dict.get(explicit_date)
            if sv:
                evaluated = evaluate_record(sv, is_today_flag)
                if evaluated:
                    results.append(evaluated)
    else:
        # Default request: today takes precedence over yesterday
        for key, dates_dict in validations_by_stop.items():
            if today in dates_dict:
                # Today's record exists: evaluate today's record.
                # If valid, emit it. If invalid, discard it (do NOT fall back to yesterday).
                today_record = dates_dict[today]
                evaluated = evaluate_record(today_record, is_today_flag=True)
                if evaluated:
                    results.append(evaluated)
            elif yesterday in dates_dict:
                # No today record exists: evaluate yesterday's record for carryover
                yesterday_record = dates_dict[yesterday]
                evaluated = evaluate_record(yesterday_record, is_today_flag=False)
                if evaluated:
                    results.append(evaluated)

    results.sort(key=lambda r: (r['schedule_id'], r['stop_order']))
    return JsonResponse(results, safe=False)

