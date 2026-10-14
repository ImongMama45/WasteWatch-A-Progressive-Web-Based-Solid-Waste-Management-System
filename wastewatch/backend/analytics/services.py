from datetime import timedelta
from statistics import mean, stdev

from django.db.models import (
    Case, Count, F, FloatField, Q, Sum, Avg, Value, When, Max
)
from django.db.models.functions import Cast, TruncDate
from django.utils import timezone

from accounts.models import Barangay
from driver.models import PickupStatus, CollectionSchedule, MissedStop, DriverShift
from dumpsite.models import WasteDelivery
from watcher.models import GarbageReport, ReportStatus, GarbageHotspot
import logging

logger = logging.getLogger(__name__)

COMPLETED = ['COMPLETED']
MISSED = ['DRIVER_MISSED', 'FAILED']

from dumpsite.models import WasteDelivery, FILL_LEVEL_MULTIPLIERS
import logging

logger = logging.getLogger(__name__)

# fill_level choices -> %
FILL_PCT = {k: v * 100 for k, v in FILL_LEVEL_MULTIPLIERS.items()}

# Per-row weight: scale weight if present, else the driver's estimate
WEIGHT = Case(
    When(net_weight__gt=0, then=Cast('net_weight', FloatField())),
    default=Cast('estimated_kg', FloatField()),
    output_field=FloatField(),
)
FILL_EXPR = Case(
    *[When(fill_level=k, then=Value(float(v))) for k, v in FILL_PCT.items()],
    default=None, output_field=FloatField(),
)


def _pct(v):
    return round(v) if v is not None else None


def build_live_payload(date_from, date_to, brgy_obj=None, include_peers=True):
    deliveries = WasteDelivery.objects.filter(date__range=[date_from, date_to])
    pickups = PickupStatus.objects.filter(schedule__date__range=[date_from, date_to])
    reports = GarbageReport.objects.filter(created_at__date__range=[date_from, date_to])
    if brgy_obj:
        deliveries = deliveries.filter(barangays=brgy_obj)
        pickups = pickups.filter(barangay=brgy_obj)
        reports = reports.filter(barangay=brgy_obj)

    # ── summary: 3 queries, no Python loops ──────────────────────────────
    d = deliveries.aggregate(kg=Sum(WEIGHT), fill=Avg(FILL_EXPR))
    p = pickups.aggregate(
        total=Count('id'),
        done=Count('id', filter=Q(status__in=COMPLETED)),
        missed=Count('id', filter=Q(status__in=MISSED)),
    )
    r = reports.aggregate(
        total=Count('id'),
        resolved=Count('id', filter=Q(status=ReportStatus.RESOLVED)),
    )
    summary = {
        'total_weight_kg': d['kg'] or 0,
        'stops_total': p['total'], 'stops_completed': p['done'], 'stops_missed': p['missed'],
        # Denominator = decided (completed + missed); excludes pending/en-route stops
        # so the rate doesn't deflate during active shifts. None when no stop decided yet.
        'stops_decided': p['done'] + p['missed'],
        'stops_pending': max(0, p['total'] - (p['done'] + p['missed'])),
        'completion_rate': round(p['done'] / (p['done'] + p['missed']), 4)
            if (p['done'] + p['missed']) else None,
        'avg_fill_pct': _pct(d['fill']),
        'reports_total': r['total'], 'reports_resolved': r['resolved'],
    }

    # ── fleet: pickups per truck + deliveries per truck, merged by plate ─
    # Group by plate only; if a truck had multiple drivers, Max picks a name
    truck_rows = (
        pickups.filter(schedule__truck__isnull=False)
        .values('schedule__truck__plate_number')
        .annotate(
            stops_total=Count('id'),
            stops_completed=Count('id', filter=Q(status__in=COMPLETED)),
            stops_missed=Count('id', filter=Q(status__in=MISSED)),
            dfn=Max('schedule__driver__first_name'),
            dln=Max('schedule__driver__last_name'),
        )
    )
    # Exclude deliveries with no truck to avoid None plate and inflated active_trucks
    truck_deliv = {
        row['truck__plate_number']: row
        for row in deliveries.filter(truck__isnull=False)
        .values('truck__plate_number')
        .annotate(
            kg=Sum(WEIGHT), fill=Avg(FILL_EXPR),
            dfn=Max('driver__first_name'), dln=Max('driver__last_name'),
        )
    }

    truck_rows_dict = {row['schedule__truck__plate_number']: row for row in truck_rows}
    all_plates = set(truck_rows_dict.keys()) | set(truck_deliv.keys())

    fleet = []
    for plate in all_plates:
        row = truck_rows_dict.get(plate, {})
        dv = truck_deliv.get(plate, {})

        fname = row.get('dfn') or dv.get('dfn') or ''
        lname = row.get('dln') or dv.get('dln') or ''
        name = f"{fname} {lname}".strip()

        fleet.append({
            'plate_number': plate, 'driver_name': name or '—',
            'stops_total': row.get('stops_total', 0),
            'stops_completed': row.get('stops_completed', 0),
            'stops_missed': row.get('stops_missed', 0),
            'avg_fill_pct': _pct(dv.get('fill')),
            'total_weight_kg': dv.get('kg') or 0,
        })
    fleet.sort(key=lambda f: -f['stops_completed'])

    # ── barangay breakdown: weight (M2M) + reports, merged by id ─────────
    # Deliberately NOT scoped to brgy_obj so the leaderboard still has peers.
    w = {
        r['barangays__id']: r for r in
        WasteDelivery.objects.filter(date__range=[date_from, date_to])
        .exclude(barangays__isnull=True)
        .values('barangays__id', 'barangays__name')
        .annotate(kg=Sum(WEIGHT), n=Count('id'))
    }
    rp = {
        r['barangay__id']: r for r in
        GarbageReport.objects.filter(created_at__date__range=[date_from, date_to])
        .exclude(barangay__isnull=True)
        .values('barangay__id', 'barangay__name')
        .annotate(total=Count('id'), resolved=Count('id', filter=Q(status=ReportStatus.RESOLVED)))
    }
    pk = {
        r['barangay_id']: r for r in
        PickupStatus.objects.filter(schedule__date__range=[date_from, date_to], barangay__isnull=False)
        .values('barangay_id', 'barangay__name')
        .annotate(total=Count('id'),
                  done=Count('id', filter=Q(status__in=COMPLETED)),
                  missed=Count('id', filter=Q(status__in=MISSED)))
    }
    breakdown = []
    all_brgys = Barangay.objects.all().values_list('id', 'name')
    if not include_peers:
        # default-deny: with no brgy_obj this filters to nothing instead of leaking everyone
        all_brgys = all_brgys.filter(pk=brgy_obj.pk if brgy_obj else None)
    for bid, name in all_brgys:
        s = pk.get(bid, {})
        s_done   = s.get('done',   0)
        s_missed = s.get('missed', 0)
        s_total  = s.get('total',  0)
        s_decided = s_done + s_missed
        breakdown.append({
            'id': bid,
            'name': name,
            'weight_kg': (w.get(bid) or {}).get('kg') or 0,
            'deliveries': (w.get(bid) or {}).get('n', 0),
            'reports_total': (rp.get(bid) or {}).get('total', 0),
            'reports_resolved': (rp.get(bid) or {}).get('resolved', 0),
            'stops_completed': s_done,
            'stops_missed':    s_missed,
            'stops_decided':   s_decided,
            'stops_pending':   max(0, s_total - s_decided),
            # decided denominator matches the global summary
            'completion_rate': round(s_done / s_decided, 4) if s_decided else None,
        })
    breakdown.sort(key=lambda b: -b['weight_kg'])

    # ── incidents per day (zero-filled so the trend line is continuous) ──
    per_day = {
        row['day']: row['n'] for row in
        reports.annotate(day=TruncDate('created_at')).values('day').annotate(n=Count('id'))
    }
    incidents, day = [], date_from
    while day <= date_to:
        incidents.append({'date': str(day), 'count': per_day.get(day, 0)})
        day += timedelta(days=1)

    issue_types = [
        {'label': row['issue_type'].replace('_', ' ').title(), 'count': row['n']}
        for row in reports.values('issue_type').annotate(n=Count('id')).order_by('-n')
    ]

    weight_over_time = [
        {'date': str(r['date']), 'weight_kg': r['kg'] or 0, 'deliveries': r['n']}
        for r in deliveries.values('date').annotate(kg=Sum(WEIGHT), n=Count('id')).order_by('date')
    ]

    hotspots_qs = GarbageHotspot.objects.all()
    if brgy_obj:
        hotspots_qs = hotspots_qs.filter(barangay=brgy_obj)

    rep_by_brgy = {
        r['barangay_id']: r for r in
        GarbageReport.objects.exclude(barangay__isnull=True)
        .values('barangay_id')
        .annotate(
            total=Count('id'),
            resolved=Count('id', filter=Q(status=ReportStatus.RESOLVED)),
            in_range=Count('id', filter=Q(created_at__date__range=[date_from, date_to])),
        )
    }

    active_hotspots = []
    for h in hotspots_qs.select_related('barangay', 'source_report'):
        st = rep_by_brgy.get(h.barangay_id, {})
        active_hotspots.append({
            'id': h.id,
            'location': f"{h.name}, {h.barangay.name}",
            'barangay_name': h.barangay.name,
            'barangay_id': h.barangay_id,
            'severity': h.severity,
            'type': h.source_report.issue_type.replace('_', ' ').title() if h.source_report else 'Multiple Issues',
            'reports': st.get('total', 0),
            'reports_in_range': st.get('in_range', 0),
            'resolved': st.get('resolved', 0),
        })
    severity_order = {'critical': 4, 'high': 3, 'medium': 2, 'low': 1}
    active_hotspots.sort(key=lambda x: (severity_order.get(x['severity'].lower(), 0), x['reports_in_range']), reverse=True)

    return {
        'scope': 'barangay' if brgy_obj else 'global',
        'barangay_id': brgy_obj.pk if brgy_obj else None,
        'peers_included': include_peers,
        'date_from': str(date_from), 'date_to': str(date_to),
        'summary': summary, 'fleet': fleet, 'barangay_breakdown': breakdown,
        'incidents_over_time': incidents, 'issue_types': issue_types,
        'weight_over_time': weight_over_time,
        'hotspots': active_hotspots,
        'forecast': forecast_weight(brgy_obj),
    }


# ── Forecast: weekday-adjusted baseline + 80% residual band ──────────────
Z80 = 1.2816  # two-sided 80%

def forecast_weight(brgy_obj=None, lookback=30, horizon=7, min_span=14, min_active=7):
    today = timezone.localdate()  # local PH date, not UTC
    end = today - timedelta(days=1)
    start = end - timedelta(days=lookback - 1)
    qs = WasteDelivery.objects.filter(date__range=[start, end])
    if brgy_obj:
        qs = qs.filter(barangays=brgy_obj)
    by_day = {row['date']: row['kg'] or 0 for row in qs.values('date').annotate(kg=Sum(WEIGHT))}

    if not by_day:
        return {'sufficient': False, 'reason': 'no_data'}
    span = (end - min(by_day)).days + 1
    if span < min_span or len(by_day) < min_active:
        return {'sufficient': False, 'reason': 'not_enough_data', 'days_available': span}

    # Zero-fill: a day with no delivery is a real zero (e.g. no Sunday collection)
    first = min(by_day)
    days = [first + timedelta(days=i) for i in range((end - first).days + 1)]
    y = [by_day.get(d, 0.0) for d in days]

    overall = mean(y)
    if overall <= 0:
        return {'sufficient': False, 'reason': 'no_data'}

    buckets = {wd: [] for wd in range(7)}
    for d, v in zip(days, y):
        buckets[d.weekday()].append(v)
    index = {wd: (mean(v) / overall if v else 1.0) for wd, v in buckets.items()}

    fitted = [overall * index[d.weekday()] for d in days]
    resid = [a - f for a, f in zip(y, fitted)]
    band = Z80 * (stdev(resid) if len(resid) > 1 else 0.0)

    points = []
    for i in range(horizon):
        d = today + timedelta(days=i)
        e = overall * index[d.weekday()]
        points.append({'date': str(d), 'expected_kg': round(e),
                       'low_kg': round(max(0, e - band)), 'high_kg': round(e + band)})

    return {
        'sufficient': True, 'band_pct': 80,
        'history': [{'date': str(d), 'kg': round(v)} for d, v in zip(days[-14:], y[-14:])],
        'points': points,
    }


from watcher.stop_validation_utils import is_schedule_today, haversine_m, COLLECTION_RADIUS_M
from watcher.models import StopValidation, StopValidationStatus as SVS
from driver.models import DriverShift

RESOLVED_STATUSES = [SVS.COLLECTION_REPORTED, SVS.VERIFIED_COLLECTED, SVS.COLLECTION_DISPUTED, SVS.EMPTY_STOP]
DUMP_STATUSES = ['heading_to_dumpsite', 'at_dumpsite']
DUMP_PHASES = ['dump_site', 'waiting_dump_confirmation']
SHIFT_OVER_PHASES = ['returning', 'at_base', 'calibration_complete']
SPEED_KMH = 20.0
DWELL_MIN = 3.0

def pt(wp):
    if not isinstance(wp, dict): return None
    lat, lng = wp.get('lat'), wp.get('lng')
    if lat is None or lng is None: return None
    try:
        return (float(lat), float(lng))
    except (TypeError, ValueError):
        return None

def _compute_tracker_payload(bid, today, now):
    scheds = (CollectionSchedule.objects.exclude(status='CANCELLED')
              .filter(barangays__id=bid).select_related('truck').distinct())
    out = []
    
    for s in scheds:
        if not is_schedule_today(s, today): 
            continue

        wps = s.waypoints or []
        my = sorted(i for i, w in enumerate(wps) if i > 0 and isinstance(w, dict)
                    and str(w.get('barangay_id')) == str(bid))
        if not my: 
            continue

        resolved = set(StopValidation.objects.filter(
            schedule=s, collection_date=today, current_status__in=RESOLVED_STATUSES
        ).values_list('stop_order', flat=True))
        
        skipped = set(MissedStop.objects.filter(
            original_schedule=s, collection_date=today
        ).exclude(status='RESOLVED').values_list('stop_order', flat=True))
        
        handled = resolved | skipped

        my_pending = [o for o in my if o not in handled]
        my_done    = [o for o in my if o in resolved and o not in skipped]
        my_missed  = [o for o in my if o in skipped]

        shift = (DriverShift.objects.filter(schedule=s, is_active=True, started_at__date=today)
                 .select_related('driver').order_by('-started_at').first())


        # ── is_stale must be known before state chain (bug #4) ──────────────
        is_stale = False
        if shift and shift.last_location_update:
            is_stale = (now - shift.last_location_update).total_seconds() > 180


        # ── State determination ───────────────────────────────────────────────
        target = my_pending[0] if my_pending else None
        if shift and shift.is_extended_mode and not target and my_missed:
            target = my_missed[0]

        t_pt = None
        if shift and shift.current_latitude and shift.current_longitude:
            try:
                t_pt = (float(shift.current_latitude), float(shift.current_longitude))
            except (ValueError, TypeError):
                pass

        target_pt = pt(wps[target]) if target else None

        # Bug #1: check done/missed BEFORE the time-window test so a barangay
        # that was already served doesn't stay "Scheduled" until end_time.
        done_state = 'passed' if my_done else ('missed' if my_missed else 'none')
        in_extended_recollect = shift and shift.is_extended_mode and my_missed

        if not my_pending and not in_extended_recollect:
            # All stops handled (or nothing to handle) — report the outcome now.
            state = done_state
        elif not shift:
            # No active shift for this schedule today.
            last_shift = DriverShift.objects.filter(schedule=s, started_at__date=today).order_by('-started_at').first()
            if last_shift:
                if my_pending and s.end_time and now.time() <= s.end_time:
                    state = 'scheduled'   # may resume
                elif my_pending and not my_done:
                    state = 'no_show'
                else:
                    state = done_state
            elif s.end_time and now.time() <= s.end_time:
                state = 'scheduled'   # might still show up
            else:
                state = 'no_show'
        elif shift.is_extended_mode:
            state = 'extended' if target else done_state
        elif shift.status in ('navigate_to_base', 'confirm_start', 'checkin'):
            state = 'scheduled'
        elif getattr(shift, 'end_shift_phase', None) in SHIFT_OVER_PHASES:
            if my_pending and not my_done:
                state = 'no_show'
            else:
                state = done_state
        elif getattr(shift, 'end_shift_phase', None) in DUMP_PHASES or shift.op_status in DUMP_STATUSES:
            state = 'unloading'
        elif t_pt and target_pt and not is_stale and haversine_m(t_pt[0], t_pt[1], target_pt[0], target_pt[1]) <= COLLECTION_RADIUS_M:
            # Bug #4: only trust coordinates for arrived if the fix is fresh.
            state = 'arrived'
        else:
            state = 'en_route'

        if state == 'arrived':
            behind = False

        # ── Proximity / ETA ──────────────────────────────────────────────────
        unresolved = [o for o in range(1, len(wps)) if o not in handled]
        frontier = max(handled, default=0)

        # Bug #3: target behind the frontier means the truck already passed this
        # stop without collecting it. ETA/distance would be meaningless.
        behind = bool(target is not None
                  and target < frontier
                  and not (shift and shift.is_extended_mode))
                  
        if state == 'arrived':
            behind = False

        ahead = ([] if behind
                 else ([o for o in unresolved if frontier < o < target] if target else []))
                 
        if state not in ('en_route', 'extended'):
            stops_away = None
        else:
            stops_away = None if behind else len(ahead)

        eta_min = None
        eta_max = None

        if not behind and state in ('en_route', 'extended') and t_pt and target_pt:
            pts = [t_pt] + [pt(wps[o]) for o in ahead + [target] if pt(wps[o])]
            dist_km = sum(haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(pts, pts[1:])) / 1000.0 * 1.3
            mins = dist_km / SPEED_KMH * 60 + (stops_away or 0) * DWELL_MIN
            if mins < 5:
                eta_min, eta_max = 0, 5
            else:
                eta_min, eta_max = round(mins * 0.85), round(mins * 1.15)

        # ── Assemble row ─────────────────────────────────────────────────────
        driver_name = (
            getattr(shift.driver, 'full_name', '') or getattr(shift.driver, 'username', '')
            if shift and shift.driver else None
        )
        fix_age_s = None
        if shift and shift.last_location_update:
            fix_age_s = int((now - shift.last_location_update).total_seconds())

        # partial: the truck reached some stops but not all
        partial = bool(my_done) and bool(my_pending or my_missed)

        preparing = bool(shift and not shift.is_extended_mode
                     and shift.status in ('navigate_to_base', 'confirm_start', 'checkin'))

        if state == 'none' and len(my) > 0:
            logger.warning("Tracker logic gap: state is 'none' but stops exist for schedule %s, b_id %s", s.id, bid)

        out.append({
            'schedule_id': s.id,
            'state': state,
            'truck': {
                'plate': s.truck.plate_number if s.truck else 'Unknown',
                'model': s.truck.model if s.truck else 'Unknown',
                'lat': t_pt[0] if t_pt else None,
                'lng': t_pt[1] if t_pt else None,
                'fix_at': shift.last_location_update.isoformat() if shift and shift.last_location_update else None,
            } if s.truck else None,
            'driver_name': driver_name,
            'next_stop': {
                'order': target,
                'address': wps[target].get('label', ''),
                'lat': target_pt[0] if target_pt else None,
                'lng': target_pt[1] if target_pt else None,
            } if target else None,
            'stops_away': stops_away,
            'behind': behind,
            'eta_min': eta_min,
            'eta_max': eta_max,
            'stops_done': len(my_done),
            'stops_total': len(my),
            'start_time': s.start_time.strftime('%H:%M') if s.start_time else '00:00',
            'end_time': s.end_time.strftime('%H:%M') if s.end_time else '23:59',
            'is_stale': is_stale,
            'fix_age_s': fix_age_s,
            'partial': partial,
            'preparing': preparing,
        })

    RANK = {'arrived': 0, 'en_route': 1, 'extended': 2, 'unloading': 3,
            'scheduled': 4, 'passed': 5, 'missed': 6, 'none': 7, 'no_show': 8}
    out.sort(key=lambda t: (RANK.get(t['state'], 9), t.get('eta_min') or 999))
    return {'trucks': out, 'server_time': now.isoformat()}

