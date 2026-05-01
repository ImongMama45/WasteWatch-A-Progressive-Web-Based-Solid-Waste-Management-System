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
    TODO: Replace mock data with a real Announcement model query.
    """
    # Mock data — replace with:
    # from announcements.models import Announcement
    # items = Announcement.objects.filter(is_public=True).order_by('-created_at')[:10]
    data = [
        {
            'id': 1,
            'title': 'Collection Schedule Updated',
            'body':  'Monday and Wednesday schedules adjusted for holiday season.',
            'date':  '2026-04-20',
            'type':  'info',
        },
        {
            'id': 2,
            'title': 'Illegal Dumping Alert',
            'body':  'Multiple reports near Baranggay 1, 5th Ave. Please be vigilant.',
            'date':  '2026-04-18',
            'type':  'warning',
        },
        {
            'id': 3,
            'title': 'Collection Completed',
            'body':  'All routes in Zone A completed. Thank you for your cooperation.',
            'date':  '2026-04-17',
            'type':  'success',
        },
    ]
    return JsonResponse(data, safe=False)


@require_http_methods(['GET'])
@cache_page(60 * 2)
def public_stats_view(request):
    """
    Returns aggregate community statistics.
    Safe to expose publicly — no personal data.
    """
    from watcher.models import GarbageReport, ReportStatus

    try:
        total_reports    = GarbageReport.objects.count()
        resolved_reports = GarbageReport.objects.filter(status=ReportStatus.RESOLVED).count()
    except Exception:
        total_reports    = 0
        resolved_reports = 0

    return JsonResponse({
        'total_reports':    total_reports,
        'resolved_reports': resolved_reports,
        'active_trucks':    3,   # TODO: from Truck model when Driver module is built
        'hotspots':         7,   # TODO: from hotspot detection algorithm
    })


@require_http_methods(['GET'])
def public_schedule_view(request):
    """
    Returns general collection schedule (not personalized).
    Personalized schedule requires auth — handled in watcher API.
    """
    data = [
        { 'day': 'Monday',    'zone': 'Baranggay Isabang',      'time': '6:00 AM – 10:00 AM', 'isNext': True  },
        { 'day': 'Wednesday', 'zone': 'Baranggay Gulang-Gulang', 'time': 'N/A',                'isNext': False },
        { 'day': 'Friday',    'zone': 'Baranggay Isabang',      'time': '6:00 AM – 10:00 AM', 'isNext': False },
    ]
    return JsonResponse(data, safe=False)
