from rest_framework import viewsets, permissions, response
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.throttling import UserRateThrottle
from django.contrib.auth import get_user_model
from django.db.models import Count, Sum, Avg, Q, F, FloatField, ExpressionWrapper, Max
from django.db.models.functions import TruncDate
from django.utils.dateparse import parse_date
from django.utils import timezone
from datetime import timedelta, date as date_type

from .models import ActivityLog
from .serializers import ActivityLogSerializer
from .services import build_live_payload, _compute_tracker_payload


class TrackerThrottle(UserRateThrottle):
    scope = 'tracker'


def _csv_safe(v):
    """Prevent CSV injection by prefixing formula-starting characters."""
    s = '' if v is None else str(v)
    return ("'" + s) if s[:1] in ('=', '+', '-', '@') else s

BADGES = {1: 'gold', 2: 'silver', 3: 'bronze'}

def _driver_points(done, missed, validated_kg, capacity, avg_fill, incidents):
    fill_bonus = 0
    if avg_fill is not None:
        fill_bonus = 10 if 60 <= avg_fill <= 85 else (-15 if avg_fill > 85 else 0)
    credited_kg = min(validated_kg, done * capacity) if capacity else validated_kg
    pts = done * 50 + float(credited_kg) * 0.1 + fill_bonus - missed * 20 - incidents * 20
    return max(0, round(pts)), fill_bonus

from watcher.models import GarbageReport, ReportStatus, IssueType, GarbageHotspot, Escalation
from driver.models import CollectionSchedule, PickupStatus, Truck, DriverShift
from dumpsite.models import WasteDelivery
from accounts.models import Barangay

from django.http import HttpResponse
import csv

# ── Status constants (mirrored from frontend pickupStatusSync.js) ──────────────
COMPLETED_STATUSES = ['COMPLETED']
MISSED_STATUSES = ['DRIVER_MISSED', 'FAILED']

CITYWIDE_ROLES = ('admin', 'watcher', 'driver')
REDACT_DRIVER_ROLES = ('citizen', 'watcher')

class AnalyticsViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='system-overview')
    def system_overview(self, request):
        if request.user.role != 'admin':
            return response.Response({'detail': 'Forbidden'}, status=403)
        User = get_user_model()
        rep = GarbageReport.objects.aggregate(
            total=Count('id'),
            resolved=Count('id', filter=Q(status=ReportStatus.RESOLVED)),
        )
        return response.Response({
            'users': User.objects.count(),
            'barangays': Barangay.objects.count(),
            'reports_total': rep['total'],
            'reports_resolved': rep['resolved'],
            'trucks': Truck.objects.count(),
            'hotspots': GarbageHotspot.objects.count(),
        })

    @action(detail=False, methods=['get'], url_path='export')
    def export_csv(self, request):
        # Only admins and barangay officials may export PII
        if request.user.role not in ('admin', 'brgy_official'):
            return response.Response({'detail': 'Forbidden'}, status=403)

        date_from, date_to = self._get_date_range(request)
        scope_id, err = self._resolve_barangay_scope(request)
        if err:
            return err
        brgy_filter = Q(barangay_id=scope_id) if scope_id is not None else Q()

        reports = GarbageReport.objects.filter(
            created_at__date__range=[date_from, date_to]
        ).filter(brgy_filter).select_related('barangay', 'user')

        http_response = HttpResponse(content_type='text/csv')
        http_response['Content-Disposition'] = (
            f'attachment; filename="wastewatch_analytics_{date_from}_to_{date_to}.csv"'
        )

        writer = csv.writer(http_response)
        writer.writerow(['ID', 'Timestamp', 'Barangay', 'Category', 'Status', 'Address', 'User'])

        for r in reports:
            writer.writerow([
                r.id,
                r.created_at,
                r.barangay.name if r.barangay else 'N/A',
                r.issue_type,
                r.status,
                _csv_safe(r.address),
                _csv_safe(r.user.username if r.user else 'Anonymous'),
            ])

        return http_response

    def _get_date_range(self, request):
        raw_from = request.query_params.get('date_from')
        raw_to = request.query_params.get('date_to')

        try:
            date_from = parse_date(raw_from) if raw_from else None
            date_to = parse_date(raw_to) if raw_to else None
        except ValueError:
            raise ValidationError('Invalid date format. Use YYYY-MM-DD.')

        # parse_date returns None (not raise) for malformed strings like 'abc'
        if (raw_from and not date_from) or (raw_to and not date_to):
            raise ValidationError('Invalid date format. Use YYYY-MM-DD.')

        # Default to last 30 days in local Philippine time
        today = timezone.localdate()
        if not date_to:
            date_to = today
        if not date_from:
            date_from = date_to - timedelta(days=30)

        if date_from > date_to:
            raise ValidationError('date_from must not be after date_to.')
        if (date_to - date_from).days > 366:
            raise ValidationError('Date range must not exceed 366 days.')

        return date_from, date_to

    def _get_barangay_filter(self, request):
        barangay_id = request.query_params.get('barangay_id')
        if barangay_id and barangay_id != 'all':
            return Q(barangay_id=barangay_id)
        return Q()

    def _get_area_filter(self, request):
        area = request.query_params.get('route')
        if area and area != 'All Routes':
            return Q(area=area)
        return Q()

    def _resolve_barangay_scope(self, request):
        """Returns (barangay_id | None, error_response | None)."""
        bid = request.query_params.get('barangay_id')
        requested = None
        if bid and bid != 'all':
            if not str(bid).isdigit():
                return None, response.Response({'detail': 'Invalid barangay_id.'}, status=400)
            requested = int(bid)

        if request.user.role in CITYWIDE_ROLES:
            return requested, None

        own = getattr(request.user, 'barangay_id', None)
        if own is None:
            return None, response.Response(
                {'detail': 'No barangay assigned to your account.'}, status=403)
        if requested is not None and requested != own:
            return None, response.Response(
                {'detail': 'You may only view your own barangay.'}, status=403)
        return own, None

    @action(detail=False, methods=['get'], url_path='live')
    def live_dashboard(self, request):
        date_from, date_to = self._get_date_range(request)
        scope_id, err = self._resolve_barangay_scope(request)
        if err:
            return err
        brgy_obj = None
        if scope_id is not None:
            brgy_obj = Barangay.objects.filter(pk=scope_id).first()
            if not brgy_obj:
                return response.Response({'detail': 'Barangay not found.'}, status=404)

        payload = build_live_payload(
            date_from, date_to, brgy_obj,
            include_peers=request.user.role in CITYWIDE_ROLES,
        )
        if request.user.role in REDACT_DRIVER_ROLES:
            for row in payload['fleet']:
                row['driver_name'] = None
        return response.Response(payload)



    @action(detail=False, methods=['get'], url_path='driver-summary')
    def driver_summary(self, request):
        if request.user.role not in ('driver', 'admin'):
            return response.Response({'detail': 'Forbidden'}, status=403)

        period = request.query_params.get('period', 'week')
        days = 7 if period == 'week' else 30
        today = timezone.localdate()   # PH local date, not UTC
        start = today - timedelta(days=days - 1)

        # distinct=True prevents LEFT JOIN on missed_stops from inflating done count
        stops = {r['driver_id']: r for r in
            PickupStatus.objects.filter(schedule__date__range=[start, today])
            .values('driver_id', 'driver__first_name', 'driver__last_name')
            .annotate(
                done=Count('id', distinct=True, filter=Q(status__in=COMPLETED_STATUSES)),
                missed=Count('id', distinct=True, filter=Q(
                    status__in=MISSED_STATUSES,
                    schedule__missed_stops__stop_order=F('stop_order'),
                    schedule__missed_stops__reason__in=['DRIVER_SKIP', 'WATCHER_FLAG']
                ))
            )}

        from django.db.models import Max
        from .services import WEIGHT, FILL_EXPR
        from dumpsite.models import DumpsiteIncident
        deliv = {r['driver_id']: r for r in
            WasteDelivery.objects.filter(date__range=[start, today])
            .values('driver_id')
            .annotate(
                kg=Sum(WEIGHT, filter=Q(is_validated=True)),
                fill=Avg(FILL_EXPR),
                cap=Max('truck__max_capacity_kg'))}

        incidents = {r['delivery__driver_id']: r['n'] for r in
            DumpsiteIncident.objects.filter(delivery__date__range=[start, today])
            .values('delivery__driver_id').annotate(n=Count('id'))}

        board = []
        for did, s in stops.items():
            if did is None:
                continue
            dv = deliv.get(did, {})
            inc = incidents.get(did, 0)
            pts, fill_bonus = _driver_points(
                s['done'], s['missed'], dv.get('kg') or 0, dv.get('cap') or 0,
                dv.get('fill'), inc)
            board.append({
                'driver_id': did, 'points': pts, 'stops_completed': s['done'],
                'stops_missed': s['missed'], 'fill_bonus': fill_bonus,
                'name': f"{s['driver__first_name'] or ''} {(s['driver__last_name'] or ' ')[0]}.".strip(),
            })
        board.sort(key=lambda b: -b['points'])
        for i, b in enumerate(board, 1):
            b['rank'] = i

        me = next((b for b in board if b['driver_id'] == request.user.id), None)
        return response.Response({
            'period': period, 'fleet_size': len(board),
            'me': None if not me else {
                'points': me['points'], 'rank': me['rank'], 'of': len(board),
                'badge': BADGES.get(me['rank']),
                'stops_completed': me['stops_completed'], 'stops_missed': me['stops_missed'],
                'fill_bonus': me['fill_bonus'],
            },
            'leaders': [{'rank': b['rank'], 'name': b['name'], 'points': b['points']} for b in board[:3]],
        })

    @action(detail=False, methods=['get'], url_path='barangay-tracker', throttle_classes=[TrackerThrottle])
    def barangay_tracker(self, request):
        brgy_id = request.query_params.get('brgy_id')
        
        if request.user.role not in CITYWIDE_ROLES:
            # Force to own barangay, or 403 if they try to look at others
            if brgy_id and str(brgy_id) != str(request.user.barangay_id):
                return response.Response({'error': 'Forbidden'}, status=403)
            brgy_id = request.user.barangay_id
        else:
            if not brgy_id:
                brgy_id = request.user.barangay_id
                
        try:
            brgy_id = int(brgy_id)
        except (TypeError, ValueError):
            return response.Response({'error': 'Invalid barangay ID.'}, status=400)
            
        today = timezone.localdate()
        cache_key = f"tracker:{brgy_id}:{today}"
        from django.core.cache import cache
        payload = cache.get(cache_key)
        
        if not payload:
            now = timezone.localtime()
            try:
                payload = _compute_tracker_payload(brgy_id, today, now)
                cache.set(cache_key, payload, 8)
            except Exception as e:
                import logging
                logger = logging.getLogger(__name__)
                logger.exception("Tracker payload failed")
                return response.Response({'error': 'Failed to compute tracker'}, status=500)
                
        # Redaction
        from copy import deepcopy
        ret = deepcopy(payload)
        is_full_access = request.user.role in ('admin', 'brgy_official')
        
        for t in ret.get('trucks', []):
            if not is_full_access:
                if t.get('truck'):
                    t['truck']['plate'] = 'Hidden'
                    t['truck']['model'] = 'Hidden'
                t['driver_name'] = None
                
        return response.Response(ret)

class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ActivityLog.objects.all().order_by('-timestamp')
    serializer_class = ActivityLogSerializer
    permission_classes = [permissions.IsAuthenticated]
