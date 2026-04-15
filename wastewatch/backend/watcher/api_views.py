"""
watcher/api_views.py
--------------------
JSON API endpoints for the Watcher module, consumed by React.

Endpoints:
  GET  /api/watcher/reports/        — list current user's reports
  POST /api/watcher/reports/        — submit a new report (multipart)
  GET  /api/watcher/reports/<id>/   — single report detail
  GET  /api/watcher/stats/          — stat counts for dashboard cards
  POST /api/watcher/confirm/        — confirm a collection
"""

import json
from django.http                    import JsonResponse
from django.views.decorators.http   import require_http_methods
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt

from .models import GarbageReport, CollectionConfirmation, ReportStatus
from accounts.models import Barangay


@csrf_exempt
@require_http_methods(['POST'])
def api_register_view(request):
    ...

@csrf_exempt
@require_http_methods(['POST'])
def api_login_view(request):
    ...

# ── Helper: serialize a report ───────────────────────────────────────────────
def report_to_dict(r):
    return {
        'id':               r.id,
        'issue_type':       r.issue_type,
        'issue_type_display': r.get_issue_type_display(),
        'severity':         r.severity,
        'status':           r.status,
        'description':      r.description,
        'latitude':         str(r.latitude),
        'longitude':        str(r.longitude),
        'barangay_id':      r.barangay_id,
        'barangay_name':    r.barangay.name if r.barangay else None,
        'image_url':        r.image.url if r.image else None,
        'created_at':       r.created_at.isoformat(),
        'updated_at':       r.updated_at.isoformat(),
    }


# ── GET + POST /api/watcher/reports/ ─────────────────────────────────────────
@login_required
def reports_view(request):
    if request.method == 'GET':
        reports = GarbageReport.objects.filter(user=request.user).select_related('barangay')
        return JsonResponse([report_to_dict(r) for r in reports], safe=False)

    if request.method == 'POST':
        # React sends multipart/form-data for image uploads
        data = request.POST
        files = request.FILES

        # Basic validation
        errors = {}
        if not data.get('latitude'):  errors['latitude']  = 'Latitude is required.'
        if not data.get('longitude'): errors['longitude'] = 'Longitude is required.'
        if errors:
            return JsonResponse(errors, status=400)

        barangay = None
        if data.get('barangay'):
            try:
                barangay = Barangay.objects.get(pk=data['barangay'])
            except Barangay.DoesNotExist:
                pass

        report = GarbageReport.objects.create(
            user        = request.user,
            barangay    = barangay,
            latitude    = data['latitude'],
            longitude   = data['longitude'],
            issue_type  = data.get('issue_type',  'overflow'),
            severity    = data.get('severity',    'medium'),
            description = data.get('description', ''),
            image       = files.get('image'),
            status      = ReportStatus.PENDING,
        )
        return JsonResponse(report_to_dict(report), status=201)

    return JsonResponse({'error': 'Method not allowed'}, status=405)


# ── GET /api/watcher/reports/<id>/ ───────────────────────────────────────────
@login_required
def report_detail_view(request, report_id):
    try:
        report = GarbageReport.objects.get(id=report_id, user=request.user)
    except GarbageReport.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)

    return JsonResponse(report_to_dict(report))


# ── GET /api/watcher/stats/ ──────────────────────────────────────────────────
@login_required
@require_http_methods(['GET'])
def stats_view(request):
    """Dashboard stat card counts for the logged-in user."""
    qs = GarbageReport.objects.filter(user=request.user)
    return JsonResponse({
        'total':            qs.count(),
        'pending_approval': qs.filter(status=ReportStatus.PENDING).count(),
        'resolved':         qs.filter(status=ReportStatus.RESOLVED).count(),
        'rejected':         qs.filter(status=ReportStatus.REJECTED).count(),
    })


# ── POST /api/watcher/confirm/ ───────────────────────────────────────────────
@login_required
@require_http_methods(['POST'])
def confirm_collection_view(request):
    data = json.loads(request.body)

    barangay = None
    if data.get('barangay'):
        try:
            barangay = Barangay.objects.get(pk=data['barangay'])
        except Barangay.DoesNotExist:
            pass

    report = None
    if data.get('report'):
        try:
            report = GarbageReport.objects.get(pk=data['report'])
        except GarbageReport.DoesNotExist:
            pass

    confirmation = CollectionConfirmation.objects.create(
        confirmed_by = request.user,
        barangay     = barangay,
        report       = report,
        latitude     = data.get('latitude')  or None,
        longitude    = data.get('longitude') or None,
        notes        = data.get('notes', ''),
    )

    # Auto-resolve the linked report
    if report:
        report.status = ReportStatus.RESOLVED
        report.save()

    return JsonResponse({
        'id':           confirmation.id,
        'confirmed_at': confirmation.confirmed_at.isoformat(),
        'message':      'Collection confirmed!',
    }, status=201)
