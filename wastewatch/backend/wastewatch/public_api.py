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
    from django.utils import timezone
    from django.db.models import Sum

    today = timezone.localdate()

    try:
        verified_reports = GarbageReport.objects.filter(status__in=[ReportStatus.APPROVED, ReportStatus.RESOLVED])
        total_reports    = verified_reports.count()
        resolved_reports = verified_reports.filter(status=ReportStatus.RESOLVED).count()
        pending_reports  = GarbageReport.objects.filter(status=ReportStatus.PENDING).count()
        active_trucks    = Truck.objects.filter(status=TruckStatus.ACTIVE).count()
        hotspots         = GarbageHotspot.objects.count()

        deliveries_today = WasteDelivery.objects.filter(date=today)
        completed_routes = deliveries_today.count()
        total_waste      = deliveries_today.aggregate(total=Sum('estimated_kg'))['total'] or 0
        barangays_covered = deliveries_today.values('barangays').distinct().count()
    except Exception:
        total_reports    = 0
        resolved_reports = 0
        pending_reports  = 0
        active_trucks    = 0
        hotspots         = 0
        completed_routes = 0
        total_waste      = 0
        barangays_covered = 0

    return JsonResponse({
        'total_reports':    total_reports,
        'resolved_reports': resolved_reports,
        'pending_reports':  pending_reports,
        'active_trucks':    active_trucks,
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
    
    # CollectionSchedule has a ManyToMany relationship to Barangay via 'barangays' field
    schedules = CollectionSchedule.objects.prefetch_related('barangays').all()[:10]
    data = [
        {
            'day': s.days,
            'zone': ", ".join([b.name for b in s.barangays.all()]) if s.barangays.exists() else s.area,
            'time': f"{s.start_time.strftime('%I:%M %p')} – {s.end_time.strftime('%I:%M %p')}",
            'isNext': False # Logic for 'isNext' can be added later
        } for s in schedules
    ]
    return JsonResponse(data, safe=False)
