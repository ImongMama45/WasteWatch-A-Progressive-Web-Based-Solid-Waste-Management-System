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
    from datetime import timedelta
    from django.db.models import Sum, Count
    
    User = get_user_model()

    today = timezone.localdate()

    try:
        verified_reports = GarbageReport.objects.filter(status__in=[ReportStatus.APPROVED, ReportStatus.RESOLVED])
        total_reports    = verified_reports.count()
        resolved_reports = verified_reports.filter(status=ReportStatus.RESOLVED).count()
        pending_reports  = GarbageReport.objects.filter(status=ReportStatus.PENDING).count()
        total_trucks     = Truck.objects.count()
        active_trucks    = Truck.objects.filter(status=TruckStatus.ACTIVE).count()
        hotspots         = GarbageHotspot.objects.count()

        now = timezone.now()
        cutoff = now - timedelta(minutes=5)
        online_trucks = Truck.objects.filter(
            shifts__ended_at__isnull=True,
            shifts__started_at__lte=now,
            shifts__driver__role='driver',
            shifts__driver__last_activity__gte=cutoff,
        ).distinct().count()

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
    Returns general collection schedule (not personalized).
    Personalized schedule requires auth — handled in watcher API.
    """
    from driver.models import CollectionSchedule
    import datetime
    
    # CollectionSchedule has a ManyToMany relationship to Barangay via 'barangays' field
    schedules = CollectionSchedule.objects.prefetch_related('barangays').all().order_by('id')
    
    today_name = datetime.datetime.now().strftime("%a")
    
    data = []
    for s in schedules:
        is_today = today_name in s.days if s.days else False
        data.append({
            'day': s.days,
            'zone': ", ".join([b.name for b in s.barangays.all()]) if s.barangays.exists() else s.area,
            'time': f"{s.start_time.strftime('%I:%M %p')} – {s.end_time.strftime('%I:%M %p')}",
            'isNext': is_today,
            'status': 'upcoming' if is_today else 'pending'
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

    now = timezone.now()
    staleness_cutoff = now - timedelta(hours=24)
    
    active_shifts = DriverShift.objects.filter(
        is_active=True,
        ended_at__isnull=True,
        started_at__gte=staleness_cutoff
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
            'truck_plate': shift.truck.plate_number if shift.truck else 'Unknown',
            'truck_model': shift.truck.model if shift.truck else 'Unknown',
            'driver_name': shift.driver.get_full_name() if shift.driver else 'Unknown',
            'latitude': float(shift.current_latitude) if shift.current_latitude else None,
            'longitude': float(shift.current_longitude) if shift.current_longitude else None,
            'op_status': shift.op_status,
            'barangays': barangays,
            'started_at': shift.started_at.isoformat() if shift.started_at else None,
            'last_updated': shift.last_location_update.isoformat() if shift.last_location_update else None
        })
        
        
    return JsonResponse(data, safe=False)
