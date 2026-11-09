"""
wastewatch/public_api.py
------------------------
Public JSON endpoints — no login required.
These are cached by the service worker for offline use.

Endpoints:
  GET /api/public/announcements/  — city announcements
  GET /api/public/stats/          — community-level counts
  GET /api/public/schedule/       — general collection schedule
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
