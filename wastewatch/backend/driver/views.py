from rest_framework import viewsets, permissions, status
from django.conf import settings
from rest_framework.throttling import ScopedRateThrottle, AnonRateThrottle, UserRateThrottle
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from datetime import timezone, timedelta
from django.utils.dateparse import parse_datetime
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_page
from .models import (
    Truck,
    CollectionSchedule,
    RouteAssignment,
    PickupStatus,
    TruckLocation,
    CompletionReport,
    TruckCrewAssignment,
    CalendarEvent,
    DriverShift,
)
from .serializers import (
    TruckSerializer,
    CollectionScheduleSerializer,
    RouteAssignmentSerializer,
    PickupStatusSerializer,
    TruckLocationSerializer,
    CompletionReportSerializer,
    TruckCrewAssignmentSerializer,
    CalendarEventSerializer,
    DriverShiftSerializer,
)

from django.db import transaction
from django.db.models import Q, Count
from django.utils import timezone
import logging
from accounts.models import UserRole
from accounts.permissions import is_admin_user
from wastewatch.pagination import StandardResultsSetPagination

logger = logging.getLogger(__name__)

_MAP_FULL_ACCESS_ROLES = {'admin', 'watcher', 'brgy_official', 'driver'}
import math

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000  # radius of Earth in meters
    phi_1 = math.radians(lat1)
    phi_2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi_1) * math.cos(phi_2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def is_schedule_complete_today(schedule):
    if not schedule or not schedule.waypoints:
        return False
    from watcher.models import StopValidation, StopValidationStatus
    RESOLVED = {
        StopValidationStatus.COLLECTION_REPORTED,
        StopValidationStatus.VERIFIED_COLLECTED,
        StopValidationStatus.COLLECTION_DISPUTED,
        StopValidationStatus.EMPTY_STOP,
    }
    today = timezone.localdate()
    total = len(schedule.waypoints) - 1
    if total <= 0:
        return False
    resolved = StopValidation.objects.filter(
        schedule=schedule, collection_date=today, current_status__in=RESOLVED
    ).values_list('stop_order', flat=True).distinct().count()
    return resolved >= total


def _is_driver_suspended(driver):
    if getattr(driver, 'is_suspended', False):
        return True
    profile = getattr(driver, 'driverprofile', None)
    return bool(profile and getattr(profile, 'is_suspended', False))


def _local_day_bounds(today=None):
    import datetime as dt
    if today is None:
        today = timezone.localdate()
    tz = timezone.get_current_timezone()
    start_dt = timezone.make_aware(dt.datetime.combine(today, dt.time.min), tz)
    end_dt = start_dt + dt.timedelta(days=1)
    return start_dt, end_dt


def _get_ended_shift_for_schedule_today(schedule=None, truck=None, driver=None, today=None):
    """
    Return the most recent ended shift today for the target schedule/truck
    (ignoring pre-route shifts that were only swept by heartbeat_timeout).
    """
    start_dt, end_dt = _local_day_bounds(today)
    match_q = Q()
    if schedule is not None:
        match_q |= Q(schedule=schedule)
        eff_truck = truck or schedule.truck
        if eff_truck is not None:
            match_q |= Q(schedule__isnull=True, truck=eff_truck)
        elif driver is not None:
            match_q |= Q(schedule__isnull=True, truck__isnull=True, driver=driver)
    elif truck is not None:
        match_q |= Q(truck=truck)
    elif driver is not None:
        match_q |= Q(driver=driver)
    else:
        return None

    return (
        DriverShift.objects.filter(
            match_q,
            is_active=False,
            started_at__gte=start_dt,
            started_at__lt=end_dt,
        )
        .exclude(
            end_reason='heartbeat_timeout',
            status__in=['assignment', 'navigate_to_base', 'confirm_start', 'checkin'],
        )
        .select_related('truck', 'schedule', 'driver')
        .order_by('-ended_at', '-started_at')
        .first()
    )


def _get_truck_previous_shifts_today(truck=None, schedule=None, driver=None, today=None):
    """
    Return today's previous (inactive) shifts associated with the driver's truck,
    schedule, or driver account, ordered newest first.
    """
    start_dt, end_dt = _local_day_bounds(today)
    match_q = Q()
    if truck is not None:
        match_q |= Q(truck=truck)
    if schedule is not None:
        match_q |= Q(schedule=schedule)
    if driver is not None:
        match_q |= Q(driver=driver)
    if not match_q:
        return DriverShift.objects.none()

    return (
        DriverShift.objects.filter(
            match_q,
            is_active=False,
            started_at__gte=start_dt,
            started_at__lt=end_dt,
        )
        .select_related('truck', 'schedule', 'driver')
        .order_by('-ended_at', '-started_at')
    )


def compute_schedule_truck_status(obj):
    today = timezone.localdate()
    start_dt, end_dt = _local_day_bounds(today)

    active_q = Q(schedule=obj)
    if obj.truck_id:
        active_q |= Q(schedule__isnull=True, truck_id=obj.truck_id)
    elif obj.driver_id:
        active_q |= Q(schedule__isnull=True, truck__isnull=True, driver_id=obj.driver_id)

    active_shift = (
        DriverShift.objects.filter(
            active_q,
            is_active=True,
            started_at__gte=start_dt,
            started_at__lt=end_dt,
        )
        .order_by('-started_at')
        .first()
    )
    if active_shift:
        return active_shift.op_status

    if _is_driver_schedule_for_date(obj, today) and is_schedule_complete_today(obj):
        return 'completed'

    ended_shift = _get_ended_shift_for_schedule_today(
        schedule=obj,
        truck=obj.truck,
        driver=obj.driver,
        today=today,
    )
    if ended_shift:
        count = obj.pickups.count()
        total_stops = count if count > 0 else max(0, len(obj.waypoints or []) - 1)
        pickup_completed_orders = set(
            obj.pickups.filter(
                status='COMPLETED',
                collected_at__gte=start_dt,
                collected_at__lt=end_dt,
            ).values_list('stop_order', flat=True)
        )
        try:
            from watcher.models import StopValidation
            empty_stop_orders = set(
                StopValidation.objects.filter(
                    schedule=obj,
                    collection_date=today,
                    current_status='EMPTY_STOP',
                ).values_list('stop_order', flat=True)
            )
        except Exception:
            empty_stop_orders = set()

        completed_stops = len(pickup_completed_orders | empty_stop_orders)
        if total_stops > 0 and completed_stops >= total_stops:
            return 'completed'
        return 'returning_unfinished'

    return 'unassigned'


def _is_driver_schedule_for_date(schedule, today=None):
    if not schedule or schedule.status == 'CANCELLED':
        return False
    if today is None:
        today = timezone.localdate()
    if schedule.date:
        return schedule.date == today
    from .crew_resolver import normalize_days
    normalized = normalize_days(schedule.days)
    if not normalized:
        return False
    weekday_str = today.strftime('%A')[:3].lower()
    return weekday_str in normalized


def _resolve_driver_today_schedule(driver, today=None, requested_schedule_id=None):
    """
    Resolve `(schedule, truck, scheduled_today)` for `driver` on `today`.
    Raises `CollectionSchedule.DoesNotExist` if `requested_schedule_id` is given
    and does not belong to `driver` (or is cancelled).
    """
    if today is None:
        today = timezone.localdate()

    assignment = (
        TruckCrewAssignment.objects.filter(driver=driver, date=today, is_active=True)
        .select_related('schedule', 'truck')
        .first()
    )

    if requested_schedule_id:
        schedule = (
            CollectionSchedule.objects.exclude(status='CANCELLED')
            .select_related('truck')
            .get(pk=requested_schedule_id, driver=driver)
        )
        is_today = bool(
            (assignment and assignment.schedule_id == schedule.id)
            or _is_driver_schedule_for_date(schedule, today)
        )
        truck = (
            assignment.truck
            if (assignment and assignment.schedule_id == schedule.id and assignment.truck)
            else schedule.truck
        )
        return schedule, truck, is_today

    if assignment and assignment.schedule and assignment.schedule.status != 'CANCELLED':
        schedule = assignment.schedule
        truck = assignment.truck or schedule.truck
        return schedule, truck, True

    candidates = [
        s for s in (
            CollectionSchedule.objects.filter(driver=driver)
            .exclude(status='CANCELLED')
            .select_related('truck')
        )
        if _is_driver_schedule_for_date(s, today)
    ]
    if not candidates:
        return None, (assignment.truck if assignment else None), False

    unfinished = [s for s in candidates if not is_schedule_complete_today(s)]
    pool = unfinished or candidates

    now_time = timezone.localtime().time()
    chosen = None
    for s in pool:
        if s.start_time and s.end_time and s.start_time <= now_time <= s.end_time:
            chosen = s
            break
    if not chosen:
        upcoming = [s for s in pool if s.start_time and s.start_time > now_time]
        if upcoming:
            chosen = min(upcoming, key=lambda s: s.start_time)
        else:
            with_start = [s for s in pool if s.start_time]
            chosen = min(with_start, key=lambda s: s.start_time) if with_start else pool[0]

    truck = (assignment.truck if assignment and assignment.truck else None) or chosen.truck
    return chosen, truck, True

class IsAppAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return is_admin_user(getattr(request, 'user', None))

class TruckViewSet(viewsets.ModelViewSet):
    queryset = Truck.objects.all().prefetch_related('drivers', 'crew').order_by('id')
    serializer_class = TruckSerializer
    pagination_class = StandardResultsSetPagination
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @property
    def allow_unpaginated(self):
        # Admins (Route Builder / assignment dropdowns) may request the full fleet.
        return is_admin_user(getattr(getattr(self, 'request', None), 'user', None))

    def get_permissions(self):
        if self.request.method in permissions.SAFE_METHODS:
            return [permissions.IsAuthenticated()]
        return [IsAppAdmin()]

    def get_queryset(self):
        qs = Truck.objects.all().prefetch_related('drivers', 'crew').order_by('id')
        status_param = self.request.query_params.get('status')
        if status_param and status_param.lower() != 'all':
            qs = qs.filter(status=status_param.lower())

        search_query = self.request.query_params.get('search', '').strip()
        if search_query:
            qs = qs.filter(
                Q(plate_number__icontains=search_query) |
                Q(model__icontains=search_query) |
                Q(zone__icontains=search_query) |
                Q(drivers__full_name__icontains=search_query) |
                Q(drivers__username__icontains=search_query)
            ).distinct()

        return qs

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        if getattr(self, 'paginator', None) is not None:
            summary_agg = Truck.objects.aggregate(
                all=Count('id', distinct=True),
                active=Count('id', filter=Q(status='active'), distinct=True),
                maintenance=Count('id', filter=Q(status='maintenance'), distinct=True),
                inactive=Count('id', filter=Q(status='inactive'), distinct=True),
            )
            self.paginator.extra_data = {'summary': summary_agg}

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

class CollectionScheduleViewSet(viewsets.ModelViewSet):
    queryset = CollectionSchedule.objects.all().order_by('-id')
    serializer_class = CollectionScheduleSerializer
    pagination_class = StandardResultsSetPagination
    allow_unpaginated = True  # Fixed municipal schedule referenced by map and calendar
    
    def get_permissions(self):
        if self.request.method in permissions.SAFE_METHODS:
            return [permissions.AllowAny()]
        return [IsAppAdmin()]

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

class RouteAssignmentViewSet(viewsets.ModelViewSet):
    queryset = RouteAssignment.objects.all()
    serializer_class = RouteAssignmentSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='today')
    def today(self, request):
        def _get_schedule_brgy_name(s):
            b_list = list(s.barangays.all()[:3])
            if b_list:
                return ', '.join(b.name for b in b_list)
            if hasattr(s, 'barangay') and s.barangay:
                return s.barangay.name
            return getattr(s, 'area', None) or 'City-Wide'

        def _get_schedule_name(s):
            return getattr(s, 'title', None) or getattr(s, 'area', None) or f"Route {s.id}"

        today_date = timezone.localdate() if hasattr(timezone, 'localdate') else timezone.now().date()

        assignment = (
            RouteAssignment.objects.filter(driver=request.user)
            .select_related('schedule', 'schedule__truck')
            .first()
        )
        if assignment and assignment.schedule and _is_driver_schedule_for_date(assignment.schedule, today_date):
            schedule = assignment.schedule
            truck = schedule.truck
            stops = [wp for idx, wp in enumerate(schedule.waypoints or []) if idx > 0]
            completed_count = schedule.pickups.filter(status='COMPLETED').count()
            brgy_name = _get_schedule_brgy_name(schedule)
            return Response({
                'id': assignment.id,
                'name': assignment.route_name or _get_schedule_name(schedule),
                'barangay': brgy_name,
                'totalStops': len(stops) or 10,
                'completedStops': completed_count,
                'distanceKm': 15,
                'startTime': schedule.start_time.strftime('%I:%M %p') if schedule.start_time else '08:00 AM',
                'estEnd': schedule.end_time.strftime('%I:%M %p') if schedule.end_time else '05:00 PM',
                'truck': f"TRUCK {truck.plate_number}" if truck else "NO TRUCK",
                'assigned': True,
            })

        # Fallback 1: check active DriverShift
        shift = (
            DriverShift.objects.filter(driver=request.user, is_active=True)
            .select_related('schedule', 'truck')
            .first()
        )
        schedule = shift.schedule if (shift and shift.schedule) else None
        truck = shift.truck if (shift and shift.truck) else None

        # Fallback 2 & 3: resolve today's CrewAssignment or today-applicable CollectionSchedule
        if not schedule:
            schedule, resolved_truck, scheduled_today = _resolve_driver_today_schedule(
                request.user, today=today_date
            )
            if not scheduled_today:
                schedule = None
            elif not truck:
                truck = resolved_truck

        if schedule:
            stops = [wp for idx, wp in enumerate(schedule.waypoints or []) if idx > 0]
            completed_count = schedule.pickups.filter(status='COMPLETED').count()
            brgy_name = _get_schedule_brgy_name(schedule)
            return Response({
                'id': schedule.id,
                'name': _get_schedule_name(schedule),
                'barangay': brgy_name,
                'totalStops': len(stops) or 10,
                'completedStops': completed_count,
                'distanceKm': 15,
                'startTime': schedule.start_time.strftime('%I:%M %p') if schedule.start_time else '08:00 AM',
                'estEnd': schedule.end_time.strftime('%I:%M %p') if schedule.end_time else '05:00 PM',
                'truck': f"TRUCK {truck.plate_number}" if truck else "NO TRUCK",
                'assigned': True,
            })

        return Response({
            'assigned': False,
            'message': 'No route assigned for today',
        }, status=status.HTTP_200_OK)

class PickupStatusViewSet(viewsets.ModelViewSet):
    queryset = PickupStatus.objects.all()
    serializer_class = PickupStatusSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = (
            super()
            .get_queryset()
            .select_related('driver', 'schedule', 'schedule__truck')
        )

        user = self.request.user
        params = self.request.query_params

        schedule_id = params.get('schedule_id')
        if schedule_id:
            qs = qs.filter(schedule_id=schedule_id)

        driver_id = params.get('driver_id')
        if driver_id:
            qs = qs.filter(driver_id=driver_id)
        elif getattr(user, 'role', None) == 'driver':
            qs = qs.filter(driver=user)

        updated_after = params.get('updated_after')
        if updated_after:
            parsed = parse_datetime(updated_after)
            if parsed:
                qs = qs.filter(updated_at__gt=parsed)

        return qs.order_by('schedule_id', 'stop_order', '-updated_at')

    @action(detail=False, methods=['get'], url_path='current')
    def current(self, request):
        """
        Returns the driver's next uncompleted stop.

        Resolution order:
        1. Today's TruckCrewAssignment → schedule
        2. Today's CollectionSchedule for this driver
        3. Any CollectionSchedule for this driver (date may be null for recurring)
        4. Any uncompleted PickupStatus for this driver across all schedules

        Auto-repair: if a schedule exists with waypoints but no PickupStatus rows,
        sync_pickup_statuses() is called to create them before querying.

        Maps to GET /api/driver/stops/current/
        """
        today = timezone.localdate()

        # ── 1. Resolve schedule ──────────────────────────────────────────────
        schedule = None

        assignment = (
            TruckCrewAssignment.objects
            .filter(driver=request.user, date=today, is_active=True)
            .select_related('schedule')
            .first()
        )
        if assignment and assignment.schedule_id:
            schedule = assignment.schedule

        if not schedule:
            schedule = (
                CollectionSchedule.objects
                .filter(driver=request.user, date=today)
                .first()
            )

        if not schedule:
            # Covers recurring schedules where date is left null
            schedule = (
                CollectionSchedule.objects
                .filter(driver=request.user)
                .order_by('-id')
                .first()
            )

        # ── 2. Auto-repair missing PickupStatus rows ──────────────────────────
        # If a schedule has waypoints but no stops were ever synced, create them now.
        if schedule:
            has_stops = PickupStatus.objects.filter(
                driver=request.user, schedule=schedule
            ).exists()
            if not has_stops and schedule.waypoints and len(schedule.waypoints) > 1:
                try:
                    schedule.sync_pickup_statuses()
                except Exception:
                    pass  # non-fatal — fall through to last-resort query

        # ── 3. Query next READY_FOR_COLLECTION stop (watcher-validated) ───────
        from watcher.models import StopValidation, StopValidationStatus
        from watcher.stop_validation_service import ensure_stop_validations_for_schedule

        stop = None
        if schedule:
            ensure_stop_validations_for_schedule(schedule)
            ready_orders = set(
                StopValidation.objects.filter(
                    schedule=schedule,
                    collection_date=today,
                    current_status=StopValidationStatus.READY_FOR_COLLECTION,
                ).values_list('stop_order', flat=True)
            )
            reported_orders = set(
                StopValidation.objects.filter(
                    schedule=schedule,
                    collection_date=today,
                    current_status__in=[
                        StopValidationStatus.COLLECTION_REPORTED,
                        StopValidationStatus.VERIFIED_COLLECTED,
                        StopValidationStatus.COLLECTION_DISPUTED,
                        StopValidationStatus.EMPTY_STOP,
                    ],
                ).values_list('stop_order', flat=True)
            )
            eligible_orders = sorted(ready_orders - reported_orders)
            if eligible_orders:
                next_order = eligible_orders[0]
                stop = (
                    PickupStatus.objects
                    .filter(driver=request.user, schedule=schedule, stop_order=next_order)
                    .select_related('schedule')
                    .first()
                )
                if not stop:
                    waypoints = schedule.waypoints or []
                    address = ''
                    if next_order < len(waypoints) and isinstance(waypoints[next_order], dict):
                        address = waypoints[next_order].get('label') or waypoints[next_order].get('address') or ''
                    stop = PickupStatus.objects.create(
                        driver=request.user,
                        schedule=schedule,
                        stop_order=next_order,
                        status='EN_ROUTE',
                        address=address,
                    )

        # ── 4. Last resort: any uncompleted stop for this driver (ONLY if no validations exist) ──────────────
        if not stop and not schedule:
            stop = (
                PickupStatus.objects
                .filter(driver=request.user)
                .exclude(status='COMPLETED')
                .select_related('schedule')
                .order_by('stop_order')
                .first()
            )

        if not stop:
            return Response(None)  # null → frontend shows "no more stops"

        sched = stop.schedule
        return Response({
            'id':            stop.id,
            'order':         stop.stop_order,
            'address':       stop.address or (sched.area if sched else 'Unknown'),
            'barangay':      (
                ', '.join(b.name for b in sched.barangays.all()[:1])
                if sched else 'Unknown'
            ),
            'zone':          sched.area if sched else '',
            'category':      'Mixed Waste',
            'scheduledTime': sched.start_time.strftime('%I:%M %p') if sched else 'N/A',
            'distance':      '—',
            'notes':         stop.note,
        })  
    
    @action(detail=False, methods=['get'], url_path='history/today')
    def history_today(self, request):
        """
        Returns all stops the driver completed today.
        Maps to GET /api/driver/stops/history/today/
        """
        from django.utils import timezone
        today = timezone.localdate()
        stops = PickupStatus.objects.filter(
            driver=request.user,
            status='COMPLETED',
            collected_at__date=today,
        ).select_related('schedule').order_by('stop_order')

        data = []
        for s in stops:
            schedule = s.schedule
            data.append({
                'id':          s.id,
                'order':       s.stop_order,
                'address':     s.address or (schedule.area if schedule else 'Unknown'),
                'barangay':    ', '.join(b.name for b in schedule.barangays.all()[:1]) if schedule else 'Unknown',
                'category':    'Mixed Waste',
                'collectedAt': s.collected_at.strftime('%I:%M %p') if s.collected_at else '',
                'note':        s.note,
            })
        return Response(data)

    @action(detail=False, methods=['get'], url_path='history/week')
    def history_week(self, request):
        """
        Returns all stops the driver completed in the last 7 days.
        Maps to GET /api/driver/stops/history/week/
        """
        from django.utils import timezone
        import datetime
        
        today = timezone.localdate()
        start_date = today - datetime.timedelta(days=7)
        
        stops = PickupStatus.objects.filter(
            driver=request.user,
            status='COMPLETED',
            collected_at__date__gte=start_date,
            collected_at__date__lte=today,
        ).select_related('schedule').order_by('-collected_at')

        data = []
        for s in stops:
            schedule = s.schedule
            data.append({
                'id':          s.id,
                'order':       s.stop_order,
                'date':        s.collected_at.strftime('%Y-%m-%d') if s.collected_at else '',
                'address':     s.address or (schedule.area if schedule else 'Unknown'),
                'barangay':    ', '.join(b.name for b in schedule.barangays.all()[:1]) if schedule else 'Unknown',
                'category':    'Mixed Waste',
                'collectedAt': s.collected_at.strftime('%I:%M %p') if s.collected_at else '',
                'note':        s.note,
            })
        return Response(data)


    @action(detail=False, methods=['get'], url_path='reassigned')
    def reassigned_stops(self, request):
        """Returns only stops explicitly flagged DRIVER_MISSED that were
        reassigned to this driver (extended mode only).
        Non-extended drivers always get an empty list."""
        from driver.models import DriverShift, CollectionSchedule, PickupStatus

        shift = DriverShift.objects.filter(driver=request.user, is_active=True).first()
        if not shift or not shift.is_extended_mode:
            return Response({'stops': []})

        schedule = CollectionSchedule.objects.filter(driver=request.user).first()
        if not schedule:
            return Response({'stops': []})

        # Only rows explicitly marked DRIVER_MISSED on this driver's schedule
        missed_records = PickupStatus.objects.filter(
            schedule=schedule,
            status='DRIVER_MISSED',
        ).order_by('stop_order')

        # Build waypoint lookup by stop_order for geometry data
        wp_by_order = {}
        for i, wp in enumerate(schedule.waypoints or []):
            order = wp.get('stopOrder') or wp.get('stop_order') or i
            wp_by_order[int(order)] = wp

        stops = []
        for record in missed_records:
            wp = wp_by_order.get(record.stop_order)
            if wp:
                stops.append({
                    **wp,
                    'pickup_status_id': record.id,
                    'stop_order': record.stop_order,
                    'status': 'DRIVER_MISSED',
                })

        return Response({'stops': stops})

    @action(detail=False, methods=['post'], url_path='collect')
    def collect(self, request):
        """
        Upload a collection proof photo by schedule + stop order.
        Does NOT require a pre-existing PickupStatus pk.
        Creates the PickupStatus row if it doesn't exist yet.

        POST /api/driver/stops/collect/
        Form fields: schedule_id, stop_order, photo, note, lat, lng, collected_at
        """
        schedule_id  = request.data.get('schedule_id')
        stop_order   = request.data.get('stop_order')
        photo        = request.FILES.get('photo')
        note         = request.data.get('note', '').strip()
        collected_at_raw = request.data.get('collected_at')
        watcher_delayed = request.data.get('watcher_delayed') == 'true'

        if not schedule_id:
            return Response({'error': 'schedule_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if stop_order is None:
            return Response({'error': 'stop_order is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            stop_order = int(stop_order)
        except (ValueError, TypeError):
            return Response({'error': 'stop_order must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            schedule = CollectionSchedule.objects.get(pk=schedule_id, driver=request.user)
        except CollectionSchedule.DoesNotExist:
            return Response({'error': 'Schedule not found or not assigned to you.'}, status=status.HTTP_404_NOT_FOUND)

        from watcher.models import StopValidation, StopValidationStatus
        from watcher.stop_validation_utils import COLLECTION_RADIUS_M, get_stop_coordinates, validate_gps_proximity
        from watcher.stop_validation_service import ensure_stop_validations_for_schedule

        ensure_stop_validations_for_schedule(schedule)
        today = timezone.localdate()
        try:
            validation = StopValidation.objects.get(
                schedule=schedule,
                stop_order=stop_order,
                collection_date=today,
            )
        except StopValidation.DoesNotExist:
            return Response({'error': 'Stop validation not found for today.'}, status=status.HTTP_404_NOT_FOUND)

        from django.conf import settings as django_settings

        if validation.current_status not in [StopValidationStatus.READY_FOR_COLLECTION, StopValidationStatus.PENDING_INSPECTION]:
            if not django_settings.DEBUG:
                return Response(
                    {'error': 'Stop is not ready for collection. Watcher pre-inspection required.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        driver_lat = request.data.get('lat')
        driver_lng = request.data.get('lng')
        coords = get_stop_coordinates(schedule, stop_order)
        if coords and not django_settings.DEBUG:
            ok, err = validate_gps_proximity(driver_lat, driver_lng, coords[0], coords[1], COLLECTION_RADIUS_M)
            if not ok:
                return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)

        collected_at = timezone.now()
        if collected_at_raw:
            try:
                parsed = parse_datetime(collected_at_raw)
                if parsed:
                    collected_at = parsed
            except Exception:
                pass

        # Get or create — safe even if sync_pickup_statuses() never ran
        ps, created = PickupStatus.objects.get_or_create(
            driver=request.user,
            schedule=schedule,
            stop_order=stop_order,
            defaults={
                'status': 'COMPLETED',
                'address': (schedule.waypoints or [{}])[stop_order].get('label', '') if len(schedule.waypoints or []) > stop_order else '',
                'note': note,
                'collected_at': collected_at,
            },
        )

        if not created:
            ps.status = 'COMPLETED'
            ps.note = note
            ps.collected_at = collected_at

        if photo:
            ps.photo_url = photo  # Cloudinary field handles upload on save

        try:
            ps.save()

            validation.driver = request.user
            validation.collection_timestamp = collected_at
            validation.collection_notes = note
            if driver_lat is not None:
                validation.collection_latitude = driver_lat
            if driver_lng is not None:
                validation.collection_longitude = driver_lng
            
            if watcher_delayed:
                validation.driver_bypassed_watcher = True
                
            validation.current_status = StopValidationStatus.COLLECTION_REPORTED
            validation.save()

            # Stamp the photo reference directly by public_id — avoids
            # passing the already-consumed file object a second time, which
            # causes Cloudinary to raise "Invalid image file".
            if ps.photo_url:
                try:
                    public_id = str(ps.photo_url)  # e.g. "image/upload/v.../file.jpg"
                    StopValidation.objects.filter(pk=validation.pk).update(
                        collection_photo=public_id
                    )
                except Exception:
                    pass  # non-fatal — collection is recorded, photo link is cosmetic
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'error': f'Failed to save collection record: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # ── Notify barangay: collection done ─────────────────────────────────
        try:
            from notifications.services import notify_collection_done
            notify_collection_done(schedule, stop_order, driver=request.user)
        except Exception:
            pass  # non-fatal — collection is already recorded

        photo_url = None
        if ps.photo_url:
            try:
                photo_url = ps.photo_url.url
            except Exception:
                pass

        return Response({
            'id':          ps.id,
            'stop_order':  ps.stop_order,
            'status':      ps.status,
            'validation_status': validation.current_status,
            'photo_url':   photo_url,
            'collected_at': ps.collected_at,
        }, status=status.HTTP_201_CREATED)

class TruckLocationViewSet(viewsets.ModelViewSet):
    queryset = TruckLocation.objects.all().order_by('-timestamp')
    serializer_class = TruckLocationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        driver = request.user

        # 1. Enforce Active Shift
        active_shift = DriverShift.objects.filter(driver=driver, is_active=True).first()
        if not active_shift:
            return Response({'error': 'GPS tracking requires an active shift.', 'code': 'no_active_shift'}, status=403)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        lat = serializer.validated_data['latitude']
        lng = serializer.validated_data['longitude']
        accuracy = serializer.validated_data.get('accuracy')  # metres, can be None

        ACCURACY_THRESHOLD = 150  # metres — only gate TruckLocation history rows, NOT the live map position

        # 2. Always update the live map position (current_latitude / current_longitude)
        #    so the truck marker always appears on the citizen map — even if GPS accuracy
        #    is poor (common on mobile / indoors). Accuracy-gating is applied to the
        #    TruckLocation history write below, not to the live position marker.
        MIN_MOVEMENT_M = 10
        last = (
            TruckLocation.objects
            .filter(shift=active_shift)
            .order_by('-timestamp')
            .values('latitude', 'longitude')
            .first()
        )

        # Always write live position so the citizen map always sees the truck
        active_shift.current_latitude = lat
        active_shift.current_longitude = lng
        active_shift.last_location_update = timezone.now()
        active_shift.save(update_fields=[
            'current_latitude', 'current_longitude', 'last_location_update'
        ])

        if last:
            dist = haversine(
                float(last['latitude']), float(last['longitude']),
                float(lat), float(lng)
            )
            if dist < MIN_MOVEMENT_M:
                return Response({'skipped': True, 'reason': 'no_movement'}, status=200)

        # ── TRUCK_NEAR check ──────────────────────────────────────────────────
        # Runs on every qualifying ping. The service handles distance + dedup
        # internally — this call is always safe and non-blocking.
        try:
            from notifications.services import notify_truck_near

            _schedule = active_shift.schedule
            if not _schedule:
                logger.warning(
                    "Active shift pk=%s has no assigned schedule; skipping truck-near checks.",
                    active_shift.pk,
                )
            elif _schedule.waypoints:
                # Find the next uncompleted stop to check proximity against
                from watcher.models import StopValidation, StopValidationStatus
                today_date = timezone.localdate()
                next_stop  = (
                    StopValidation.objects
                    .filter(
                        schedule=_schedule,
                        collection_date=today_date,
                        current_status=StopValidationStatus.READY_FOR_COLLECTION,
                    )
                    .order_by('stop_order')
                    .first()
                )
                if next_stop:
                    wp = _schedule.waypoints[next_stop.stop_order] if next_stop.stop_order < len(_schedule.waypoints) else None
                    if wp and 'lat' in wp and 'lng' in wp:
                        notify_truck_near(
                            shift=active_shift,
                            schedule=_schedule,
                            stop_order=next_stop.stop_order,
                            stop_lat=float(wp['lat']),
                            stop_lng=float(wp['lng']),
                            driver_lat=float(lat),
                            driver_lng=float(lng),
                        )
        except Exception:
            pass  # TRUCK_NEAR is best-effort — never block GPS recording

        # Only write a TruckLocation history row when accuracy is good enough.
        # The live position (current_latitude) was already saved above unconditionally.
        if accuracy is not None and accuracy > ACCURACY_THRESHOLD:
            return Response({'skipped': True, 'reason': 'poor_accuracy', 'accuracy': accuracy}, status=200)

        location = TruckLocation.objects.create(
            driver=driver,
            truck=active_shift.truck,
            shift=active_shift,
            latitude=lat,
            longitude=lng,
            accuracy=accuracy,
        )

        return Response(TruckLocationSerializer(location).data, status=status.HTTP_201_CREATED)


class CompletionReportViewSet(viewsets.ModelViewSet):
    queryset = CompletionReport.objects.all()
    serializer_class = CompletionReportSerializer
    permission_classes = [permissions.IsAuthenticated]
 


class TruckCrewAssignmentViewSet(viewsets.ModelViewSet):
    queryset = TruckCrewAssignment.objects.select_related(
        'truck', 'driver', 'schedule'
    ).prefetch_related('crew_members', 'schedule__barangays').all()
    serializer_class = TruckCrewAssignmentSerializer

    def get_permissions(self):
        if self.action == 'my_assignment':
            return [permissions.IsAuthenticated()]
        return [IsAppAdmin()]

    @action(detail=False, methods=['get'], url_path='my-assignment')
    def my_assignment(self, request):
        """Returns today's active crew assignment for the requesting crew member."""
        from .crew_resolver import get_crew_assignment_for
        resolved = get_crew_assignment_for(request.user)
        if resolved:
            return Response(resolved)

        # DEPRECATED legacy fallback
        from django.utils import timezone
        today = timezone.localdate()
        assignment = TruckCrewAssignment.objects.filter(
            crew_members=request.user,
            date=today,
            is_active=True,
        ).select_related(
            'truck', 'driver', 'schedule'
        ).prefetch_related('crew_members', 'schedule__barangays').first()

        if not assignment:
            # Try most recent active assignment as fallback
            assignment = TruckCrewAssignment.objects.filter(
                crew_members=request.user,
                is_active=True,
            ).select_related(
                'truck', 'driver', 'schedule'
            ).prefetch_related('crew_members', 'schedule__barangays').first()

        if not assignment:
            return Response({'detail': 'No active assignment found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = TruckCrewAssignmentSerializer(assignment, context={'request': request})
        return Response(serializer.data)



def _thin_shift_locations(shift_id):
    from django.db import connection

    # Get all location IDs for this shift ordered by timestamp,
    # then keep every 24th one (every ~2 minutes at 5s ping rate).
    # Delete the rest.
    location_ids = list(
        TruckLocation.objects
        .filter(shift_id=shift_id)
        .order_by('timestamp')
        .values_list('id', flat=True)
    )

    if len(location_ids) <= 24:
        return  # Short shift — keep everything

    # Keep every 24th record (indices 0, 24, 48, ...)
    keep_ids = set(location_ids[i] for i in range(0, len(location_ids), 24))
    delete_qs = TruckLocation.objects.filter(shift_id=shift_id).exclude(id__in=keep_ids)
    deleted_count = delete_qs.count()
    delete_qs.delete()

    import logging
    logging.getLogger(__name__).info(
        f'Shift {shift_id}: thinned {deleted_count} location records, '
        f'kept {len(keep_ids)} (~2-min intervals)'
    )

class DriverShiftViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = DriverShift.objects.all()
    serializer_class = DriverShiftSerializer
    permission_classes = [permissions.IsAuthenticated]

    PUBLIC_READ_ACTIONS = frozenset({
        'active_shifts',
        'barangay_stops',
        'barangay_collection_summary',
    })
    ADMIN_ONLY_ACTIONS = frozenset({
        'dev_reset',
        'force_end',
    })
    AUTHENTICATED_ACTIONS = frozenset({
        'list',
        'retrieve',
        'current',
        'active',
        'my_active_shift',
        'profile',
        'shift_status',
        'analytics',
        'missed_stops_list',
        'collect_missed_stop',
        'pre_start_shift',
        'start_shift',
        'end_shift',
        'update_status',
        'extended_mode',
    })

    def get_permissions(self):
        # Allow public read access to endpoints used by the citizen map
        if self.action in self.PUBLIC_READ_ACTIONS and self.request.method in permissions.SAFE_METHODS:
            return [permissions.AllowAny()]
        if self.action in self.ADMIN_ONLY_ACTIONS:
            return [IsAppAdmin()]
        if self.action not in self.AUTHENTICATED_ACTIONS:
            if self.request.method == 'OPTIONS':
                return [permissions.IsAuthenticated()]
            return [IsAppAdmin()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset().select_related('driver', 'truck', 'schedule').order_by('-started_at')
        user = getattr(self.request, 'user', None)
        if not user or not user.is_authenticated:
            return qs.none()
        if is_admin_user(user):
            return qs
        return qs.filter(driver=user)

    @action(detail=False, methods=['post'], url_path='dev-reset', permission_classes=[IsAppAdmin])
    def dev_reset(self, request):
        if not is_admin_user(request.user):
            return Response(
                {'error': 'Only administrators can reset shift state.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        from django.conf import settings as django_settings
        if not django_settings.DEBUG:
            return Response({'error': 'Not available.'}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            target_driver = request.user
            requested_shift_id = request.data.get('shift_id')
            requested_driver_id = request.data.get('driver_id')

            if requested_shift_id is not None:
                shift = DriverShift.objects.select_for_update().select_related('driver', 'schedule').filter(
                    pk=requested_shift_id
                ).first()
                if shift:
                    target_driver = shift.driver
            else:
                if requested_driver_id is not None:
                    from django.contrib.auth import get_user_model
                    resolved_driver = get_user_model().objects.filter(pk=requested_driver_id).first()
                    if resolved_driver:
                        target_driver = resolved_driver
                shift = DriverShift.objects.select_for_update().select_related('driver', 'schedule').filter(
                    driver=target_driver, is_active=True
                ).first()

            target_phase = request.data.get('phase', 'navigate_to_base')
            
            if shift and shift.is_active:
                PHASE_OP_STATUS = {
                    'navigate_to_base': 'heading_to_start',
                    'confirm_start': 'heading_to_start',
                    'checkin': 'heading_to_start',
                    'shiftroute': 'on_route'
                }
                
                shift.status = target_phase
                shift.op_status = PHASE_OP_STATUS.get(target_phase, 'heading_to_start')
                shift.end_shift_phase = ''
                shift.is_extended_mode = False
                shift.save(update_fields=['status', 'op_status', 'end_shift_phase', 'is_extended_mode'])

            today = timezone.localdate()
            schedule = None
            if shift and shift.schedule:
                schedule = shift.schedule
            else:
                from driver.models import CollectionSchedule, TruckCrewAssignment
                assignment = TruckCrewAssignment.objects.filter(driver=target_driver, date=today, is_active=True).first()
                if assignment and assignment.schedule:
                    schedule = assignment.schedule
                else:
                    schedule = CollectionSchedule.objects.filter(driver=target_driver, date=today).order_by('-id').first()
                    if not schedule:
                        schedule = CollectionSchedule.objects.filter(driver=target_driver).order_by('-id').first()
            
            if schedule:
                from watcher.models import StopValidation, StopValidationStatus
                from .models import MissedStop

                # DEV-ONLY intentional DB mutation:
                # is_schedule_today(schedule) in ensure_stop_validations_for_schedule
                # returns False when schedule.date != today, so it would return []
                # and never recreate the deleted validation rows. For one-off test
                # schedules whose date is a past day, we must pin date to today so
                # the next ensure_stop_validations_for_schedule call (triggered by the
                # first API hit after nuking) re-populates the rows correctly.
                # Recurring schedules (date=None) are unaffected by this condition.
                # This mutation only runs behind the DEBUG guard on this endpoint.
                if schedule.date and schedule.date != today:
                    schedule.date = today
                    schedule.save(update_fields=['date'])

                # Full wipe — deliberately NOT reset_shift_validations(), whose
                # selective preservation is correct for production restarts but
                # wrong for a test nuke. We delete ALL validations for this schedule.
                # The endpoints will automatically recreate fresh PENDING_INSPECTION rows.
                StopValidation.objects.filter(schedule=schedule).delete()
                
                PickupStatus.objects.filter(
                    schedule=schedule
                ).delete()
                
                MissedStop.objects.filter(
                    original_schedule=schedule,
                    collection_date=today
                ).delete()

                start_dt, end_dt = _local_day_bounds(today)
                DriverShift.objects.filter(
                    Q(schedule=schedule) | (Q(truck=schedule.truck) if schedule.truck_id else Q(driver=target_driver)),
                    is_active=False,
                    started_at__gte=start_dt,
                    started_at__lt=end_dt,
                ).delete()

        return Response({'status': 'reset', 'shift_id': shift.id if shift else None, 'phase': target_phase})

    @action(detail=False, methods=['get'], url_path='current')
    def current(self, request):
        from datetime import timedelta
        from django.db.models import Q
        from django.conf import settings
        now = timezone.now()
        staleness_cutoff = now - timedelta(hours=getattr(settings, 'SHIFT_STALE_HOURS', 6))

        # Auto-close any shifts abandoned for more than SHIFT_STALE_HOURS
        from django.db.models import F
        from django.db.models.functions import Coalesce
        DriverShift.objects.filter(
            Q(last_location_update__lt=staleness_cutoff) | Q(last_location_update__isnull=True, started_at__lt=staleness_cutoff),
            driver=request.user,
            ended_at__isnull=True,
        ).update(
            ended_at=Coalesce(F('last_location_update'), F('started_at')),
            status='end_shift',
            is_active=False,
            end_reason='heartbeat_timeout',
        )

        # Now look for a genuinely active shift
        shift = DriverShift.objects.filter(
            Q(last_location_update__gte=staleness_cutoff) | Q(last_location_update__isnull=True, started_at__gte=staleness_cutoff),
            driver=request.user,
            ended_at__isnull=True,
            is_active=True
        ).order_by('-started_at').first()

        if not shift:
            today = timezone.localdate()
            schedule, truck, scheduled_today = _resolve_driver_today_schedule(
                request.user, today=today
            )
            if not truck and hasattr(request.user, 'assigned_trucks'):
                truck = request.user.assigned_trucks.filter(status='active').first()

            previous_shifts_qs = _get_truck_previous_shifts_today(
                truck=truck,
                schedule=schedule,
                driver=request.user,
                today=today,
            )
            ended_schedule_shift = (
                _get_ended_shift_for_schedule_today(
                    schedule=schedule,
                    truck=truck,
                    driver=request.user,
                    today=today,
                )
                if (schedule and scheduled_today)
                else None
            )
            latest_previous_shift = ended_schedule_shift or previous_shifts_qs.first()

            truck_active_shift = (
                DriverShift.objects.filter(
                    Q(last_location_update__gte=staleness_cutoff) | Q(last_location_update__isnull=True, started_at__gte=staleness_cutoff),
                    truck=truck,
                    ended_at__isnull=True,
                    is_active=True,
                )
                .exclude(driver=request.user)
                .select_related('driver', 'truck', 'schedule')
                .first()
                if truck is not None
                else None
            )

            can_start_shift = True
            block_reason = None
            block_message = None

            if _is_driver_suspended(request.user):
                can_start_shift = False
                block_reason = 'suspended'
                block_message = 'Your account is suspended. You cannot start a shift.'
            elif not schedule or not scheduled_today:
                can_start_shift = False
                block_reason = 'no_schedule_today'
                block_message = 'You have no scheduled collection duty for today.'
            elif truck_active_shift:
                can_start_shift = False
                block_reason = 'truck_in_use'
                co_driver_name = truck_active_shift.driver.full_name or truck_active_shift.driver.username
                block_message = f'Truck {truck.plate_number} is currently in an active shift ({co_driver_name}).'
            elif is_schedule_complete_today(schedule):
                can_start_shift = False
                block_reason = 'route_completed'
                block_message = "Today's collection route has already been completed."
            elif ended_schedule_shift:
                can_start_shift = False
                block_reason = 'shift_already_ended'
                plate = truck.plate_number if truck else (ended_schedule_shift.truck.plate_number if ended_schedule_shift.truck else None)
                block_message = (
                    f"Today's shift for TRUCK {plate} has already ended."
                    if plate
                    else "Today's collection shift has already ended."
                )

            return Response({
                'active_shift': None,
                'previous_shift_today': DriverShiftSerializer(latest_previous_shift).data if latest_previous_shift else None,
                'truck_previous_shifts_today': DriverShiftSerializer(previous_shifts_qs[:5], many=True).data,
                'can_start_shift': can_start_shift,
                'can_dev_reset': bool(getattr(settings, 'DEBUG', False) and is_admin_user(request.user)),
                'block_reason': block_reason,
                'block_message': block_message,
            })

        # Auto-heal: if the shift is in 'shiftroute' but the schedule is
        # already 100% resolved today, advance it to 'end_shift' so DriverRouteFlow
        # never reloads ShiftRouteModule for a finished route on resume.
        #
        # IMPORTANT: Only fires when status == 'shiftroute' — not on earlier phases
        # (navigate_to_base, confirm_start, checkin). Those phases predate any stop
        # collection; firing there would wrongly skip the driver straight to EndShiftModule
        # if StopValidation rows happened to be pre-resolved (e.g. from testing).
        if shift.status == 'shiftroute' and shift.schedule_id:
            schedule_obj = DriverShift.objects.select_related('schedule').get(pk=shift.pk).schedule
            if is_schedule_complete_today(schedule_obj):
                shift.status = 'end_shift'
                shift.op_status = 'heading_to_dumpsite'
                shift.save(update_fields=['status', 'op_status'])

        prev_qs = _get_truck_previous_shifts_today(
            truck=shift.truck,
            schedule=shift.schedule,
            driver=request.user,
        )
        return Response({
            'active_shift': DriverShiftSerializer(shift).data,
            'previous_shift_today': None,
            'truck_previous_shifts_today': DriverShiftSerializer(prev_qs[:5], many=True).data,
            'can_start_shift': True,
            'can_dev_reset': bool(getattr(settings, 'DEBUG', False) and is_admin_user(request.user)),
            'block_reason': None,
            'block_message': None,
        })

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        shift = self.get_object()
        if not is_admin_user(request.user) and shift.driver_id != request.user.id:
            return Response(
                {'error': "You do not have permission to update another driver's shift."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not shift.is_active:
            return Response(
                {'error': 'No active shift found.', 'code': 'no_active_shift'},
                status=status.HTTP_400_BAD_REQUEST
            )

        RECOGNIZED_PHASES = {
            'navigate_to_base',
            'confirm_start',
            'checkin',
            'shiftroute',
            'end_shift',
        }

        VALID_TRANSITIONS = {
            'navigate_to_base': ['confirm_start', 'end_shift'],
            'confirm_start':    ['checkin', 'end_shift'],
            'checkin':          ['shiftroute', 'end_shift'],
            'shiftroute':       ['end_shift'],
            'end_shift':        ['end_shift', 'shiftroute'],  # allow re-entry for Extended Mode
            'assignment':       ['navigate_to_base'],
        }

        # Map each phase → op_status so the live map always shows a meaningful label
        PHASE_OP_STATUS = {
            'assignment':       'off_duty',
            'navigate_to_base': 'heading_to_start',
            'confirm_start':    'at_base',
            'checkin':          'checking_in',
            'shiftroute':       'on_route',
            'end_shift':        'heading_to_dumpsite',
        }

        new_status = request.data.get('status')
        current = shift.status
        end_shift_phase = request.data.get('end_shift_phase')

        status_changed = new_status is not None and new_status != current
        phase_changed  = end_shift_phase is not None and end_shift_phase != shift.end_shift_phase

        # Only a true no-op when NEITHER the top-level status NOR the sub-phase changed.
        # Previously this guard fired on `new_status == current`, which silently dropped
        # every end_shift_phase update after the first (since status is already 'end_shift').
        if not status_changed and not phase_changed:
            return Response({
                'status': current,
                'op_status': shift.op_status,
                'end_shift_phase': shift.end_shift_phase,
            })

        update_fields = []

        if status_changed:
            if new_status not in RECOGNIZED_PHASES:
                return Response(
                    {'error': f'Unrecognized phase status: {new_status}'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            is_dev_skip = bool(request.data.get('dev_skip', False))
            can_bypass_transitions = (
                is_dev_skip
                and getattr(settings, 'DEBUG', False)
                and is_admin_user(request.user)
            )

            if not can_bypass_transitions and new_status not in VALID_TRANSITIONS.get(current, []):
                return Response(
                    {'error': f'Invalid transition: {current} → {new_status}'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            shift.status = new_status
            shift.op_status = PHASE_OP_STATUS.get(new_status, shift.op_status)
            update_fields += ['status', 'op_status']

        if phase_changed:
            shift.end_shift_phase = end_shift_phase
            update_fields.append('end_shift_phase')

        shift.save(update_fields=update_fields)
        return Response({
            'status': shift.status,
            'op_status': shift.op_status,
            'end_shift_phase': shift.end_shift_phase,
        })

    @action(detail=True, methods=['post'], url_path='extended_mode')
    def extended_mode(self, request, pk=None):
        shift = self.get_object()
        if not is_admin_user(request.user) and shift.driver_id != request.user.id:
            return Response(
                {'error': "You do not have permission to modify another driver's shift."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not shift.is_active:
            return Response(
                {'error': 'Cannot activate extended mode on an inactive shift.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            shift = (
                DriverShift.objects.select_for_update()
                .select_related('schedule')
                .get(pk=shift.pk)
            )

            client_schedule_id = request.data.get('schedule_id')
            missed_stop_orders = request.data.get('missed_stop_orders', [])

            # Schedule ownership & mismatch validation
            if shift.schedule_id:
                if client_schedule_id is not None and str(client_schedule_id) != str(shift.schedule_id):
                    return Response({
                        'error': 'schedule_id does not match your currently active shift.',
                        'active_schedule_id': shift.schedule_id,
                    }, status=status.HTTP_409_CONFLICT)
                authoritative_schedule = shift.schedule
            else:
                if client_schedule_id is not None:
                    return Response({
                        'error': 'schedule_id cannot be specified for a shift without an assigned schedule.',
                        'active_schedule_id': None,
                    }, status=status.HTTP_409_CONFLICT)
                authoritative_schedule = None

            # Set status back to shiftroute so a page refresh returns to the map,
            # not EndShiftModule / dump_site. is_extended_mode distinguishes this from
            # a normal collection run so reassignment logic can target this driver.
            shift.is_extended_mode = True
            shift.status = 'shiftroute'
            shift.save(update_fields=['is_extended_mode', 'status'])

            # Process missed stops strictly for the authoritative schedule
            if authoritative_schedule and missed_stop_orders:
                from driver.models import PickupStatus
                PickupStatus.objects.filter(
                    schedule=authoritative_schedule,
                    stop_order__in=missed_stop_orders,
                ).update(status='DRIVER_MISSED', updated_at=timezone.now())

                from driver.missed_stop_service import create_missed_stops
                create_missed_stops(authoritative_schedule, missed_stop_orders, reason='TRUCK_FULL')

            return Response({'status': 'extended_mode_activated'})

    @action(detail=True, methods=['post'], url_path='force-end', permission_classes=[IsAppAdmin])
    def force_end(self, request, pk=None):
        if not is_admin_user(request.user):
            return Response({'error': 'Only admins can force-end shifts.'}, status=status.HTTP_403_FORBIDDEN)
            
        shift = self.get_object()
        if not shift.is_active:
            return Response({'error': 'Shift is already inactive.'}, status=status.HTTP_400_BAD_REQUEST)
            
        shift.is_active = False
        shift.status = 'end_shift'
        shift.end_reason = 'admin_force_ended'
        shift.ended_at = timezone.now()
        shift.save(update_fields=['is_active', 'status', 'ended_at', 'end_reason'])
        
        return Response({'status': 'force_ended', 'shift_id': shift.id})

    @action(detail=False, methods=['post'], url_path='pre_start')
    def pre_start_shift(self, request):
        driver = request.user
        if _is_driver_suspended(driver):
            return Response(
                {'error': 'Your account is suspended. You cannot start a shift.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        duty_type = request.data.get('duty_type', 'normal')
        requested_schedule_id = request.data.get('schedule_id')
        today = timezone.localdate()

        try:
            schedule, truck, scheduled_today = _resolve_driver_today_schedule(
                driver, today=today, requested_schedule_id=requested_schedule_id
            )
        except CollectionSchedule.DoesNotExist:
            return Response(
                {'error': 'The requested route was not found or is not assigned to you.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        with transaction.atomic():
            shift = DriverShift.objects.select_for_update().filter(driver=driver, is_active=True).first()
            if shift:
                if shift.schedule_id and requested_schedule_id and str(shift.schedule_id) != str(requested_schedule_id):
                    return Response({
                        'error': 'You already have an active shift on a different route.',
                        'active_schedule_id': shift.schedule_id,
                        'active_shift_id': shift.id,
                    }, status=status.HTTP_409_CONFLICT)
                return Response(DriverShiftSerializer(shift).data, status=status.HTTP_200_OK)

            if not schedule or not scheduled_today:
                return Response(
                    {
                        'error': 'You have no scheduled collection duty for today.',
                        'code': 'no_schedule_today',
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if is_schedule_complete_today(schedule):
                return Response(
                    {
                        'error': 'This route has already been completed today.',
                        'code': 'route_completed',
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            ended_today = _get_ended_shift_for_schedule_today(
                schedule=schedule,
                truck=truck,
                driver=driver,
                today=today,
            )
            if ended_today:
                return Response(
                    {
                        'error': "Today's shift for this truck and route has already ended.",
                        'code': 'shift_already_ended',
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if truck and truck.status == 'maintenance':
                return Response({'error': 'This truck is currently under maintenance and cannot be used.'}, status=status.HTTP_400_BAD_REQUEST)
            if truck and DriverShift.objects.select_for_update().filter(truck=truck, is_active=True).exists():
                return Response({'error': 'Truck is currently being used in another active shift.'}, status=status.HTTP_400_BAD_REQUEST)

            shift = DriverShift.objects.create(
                driver=driver,
                truck=truck,
                schedule=schedule,
                duty_type=duty_type,
                started_at=timezone.now(),  # Temporary start time
                is_active=True,
                op_status='heading_to_start',
                current_latitude=None,
                current_longitude=None,
                last_location_update=None
            )
        return Response(DriverShiftSerializer(shift).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='active')
    def active(self, request):
        """
        THE canonical 'is this driver on shift right now' check.
        GET /api/driver/shift/active/

        Response:
          { "active": false, "shift": null }
          { "active": true,  "shift": { ...DriverShiftSerializer... } }
        """
        from datetime import timedelta
        from django.db.models import Q
        from django.conf import settings
        now = timezone.now()
        staleness_cutoff = now - timedelta(hours=getattr(settings, 'SHIFT_STALE_HOURS', 6))

        # Auto-close any shifts abandoned for more than SHIFT_STALE_HOURS
        from django.db.models import F
        from django.db.models.functions import Coalesce
        DriverShift.objects.filter(
            Q(last_location_update__lt=staleness_cutoff) | Q(last_location_update__isnull=True, started_at__lt=staleness_cutoff),
            driver=request.user,
            is_active=True,
        ).update(
            ended_at=Coalesce(F('last_location_update'), F('started_at')),
            status='end_shift',
            is_active=False,
            end_reason='heartbeat_timeout',
        )

        shift = (
            DriverShift.objects
            .filter(driver=request.user, is_active=True)
            .select_related('truck', 'schedule')
            .order_by('-started_at')
            .first()
        )

        if not shift:
            return Response({'active': False, 'shift': None})

        return Response({'active': True, 'shift': DriverShiftSerializer(shift).data})

    @action(detail=False, methods=['post'], url_path='start')
    def start_shift(self, request):
        driver = request.user
        if _is_driver_suspended(driver):
            return Response(
                {'error': 'Your account is suspended. You cannot start a shift.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        duty_type = request.data.get('duty_type', 'normal')
        driver_lat = request.data.get('latitude')
        driver_lng = request.data.get('longitude')
        requested_schedule_id = request.data.get('schedule_id')

        today = timezone.localdate()
        try:
            schedule, truck, scheduled_today = _resolve_driver_today_schedule(
                driver, today=today, requested_schedule_id=requested_schedule_id
            )
        except CollectionSchedule.DoesNotExist:
            return Response(
                {'error': 'The requested route was not found or is not assigned to you.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        from django.conf import settings as django_settings

        def _check_home_base_proximity(target_schedule):
            if target_schedule and target_schedule.waypoints and not django_settings.DEBUG:
                waypoints = target_schedule.waypoints
                if waypoints and len(waypoints) > 0:
                    home_base = waypoints[0]
                    if driver_lat and driver_lng and 'lat' in home_base and 'lng' in home_base:
                        try:
                            dist = haversine(
                                float(driver_lat), float(driver_lng),
                                float(home_base['lat']), float(home_base['lng'])
                            )
                            if dist > 1000:
                                return Response({
                                    'error': f'You are too far from the home base ({int(dist)}m away)...'
                                }, status=status.HTTP_403_FORBIDDEN)
                        except ValueError:
                            pass
            return None

        with transaction.atomic():
            shift = (
                DriverShift.objects.select_for_update()
                .filter(driver=driver, is_active=True)
                .select_related('schedule')
                .first()
            )

            if shift:
                # Driver already has an active shift (e.g. from pre_start). If it's tied
                # to a DIFFERENT schedule than what's being requested, refuse — don't
                # silently switch routes under them.
                if shift.schedule_id and requested_schedule_id and str(shift.schedule_id) != str(requested_schedule_id):
                    return Response({
                        'error': 'You already have an active shift on a different route.',
                        'active_schedule_id': shift.schedule_id,
                        'active_shift_id': shift.id,
                    }, status=status.HTTP_409_CONFLICT)

                proximity_err = _check_home_base_proximity(shift.schedule or schedule)
                if proximity_err is not None:
                    return proximity_err

                shift.started_at = timezone.now()
                shift.current_latitude = driver_lat
                shift.current_longitude = driver_lng
                shift.last_location_update = timezone.now()
                shift.op_status = 'on_duty'
                if schedule and not shift.schedule_id:
                    shift.schedule = schedule
                shift.save()
                return Response(DriverShiftSerializer(shift).data, status=status.HTTP_200_OK)

            if not schedule or not scheduled_today:
                return Response(
                    {
                        'error': 'You have no scheduled collection duty for today.',
                        'code': 'no_schedule_today',
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            proximity_err = _check_home_base_proximity(schedule)
            if proximity_err is not None:
                return proximity_err

            if truck and truck.status == 'maintenance':
                return Response({'error': 'This truck is currently under maintenance and cannot be used.'}, status=status.HTTP_400_BAD_REQUEST)
            if truck and DriverShift.objects.select_for_update().filter(truck=truck, is_active=True).exists():
                return Response({'error': 'Truck is currently being used in another active shift.'}, status=status.HTTP_400_BAD_REQUEST)

            if is_schedule_complete_today(schedule):
                return Response(
                    {
                        'error': 'This route has already been completed today.',
                        'code': 'route_completed',
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            ended_today = _get_ended_shift_for_schedule_today(
                schedule=schedule,
                truck=truck,
                driver=driver,
                today=today,
            )
            if ended_today:
                return Response(
                    {
                        'error': "Today's shift for this truck and route has already ended.",
                        'code': 'shift_already_ended',
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            shift = DriverShift.objects.create(
                driver=driver,
                truck=truck,
                schedule=schedule,
                duty_type=duty_type,
                started_at=timezone.now(),
                is_active=True,
                op_status='on_duty',
                current_latitude=driver_lat,
                current_longitude=driver_lng,
                last_location_update=timezone.now()
            )
        return Response(DriverShiftSerializer(shift).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='end')
    def end_shift(self, request):
        driver = request.user
        missed_stop_orders = request.data.get('missed_stop_orders', [])
        client_schedule_id = request.data.get('schedule_id')

        with transaction.atomic():
            shift = (
                DriverShift.objects.select_for_update()
                .select_related('schedule')
                .filter(driver=driver, is_active=True)
                .first()
            )
            if not shift:
                return Response(
                    {'error': 'No active shift found.', 'code': 'no_active_shift'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Schedule ownership & mismatch validation
            if shift.schedule_id:
                if client_schedule_id is not None and str(client_schedule_id) != str(shift.schedule_id):
                    return Response({
                        'error': 'schedule_id does not match your currently active shift.',
                        'active_schedule_id': shift.schedule_id,
                    }, status=status.HTTP_409_CONFLICT)
                authoritative_schedule = shift.schedule
            else:
                if client_schedule_id is not None:
                    return Response({
                        'error': 'schedule_id cannot be specified for a shift without an assigned schedule.',
                        'active_schedule_id': None,
                    }, status=status.HTTP_409_CONFLICT)
                authoritative_schedule = None

            now = timezone.now()
            shift.ended_at = now
            shift.duration_ms = int((now - shift.started_at).total_seconds() * 1000)
            shift.is_active = False
            shift.status = 'end_shift'
            shift.end_reason = 'driver_ended'
            shift.current_latitude = None
            shift.current_longitude = None
            shift.last_location_update = None
            shift.save()

            ended_early = request.data.get('ended_early', False)
            early_reason = request.data.get('reason', '') or ''
            if authoritative_schedule and missed_stop_orders:
                from driver.models import PickupStatus
                PickupStatus.objects.filter(
                    schedule=authoritative_schedule,
                    stop_order__in=missed_stop_orders
                ).update(status='DRIVER_MISSED', updated_at=timezone.now())

                from driver.missed_stop_service import create_missed_stops
                from driver.models import MissedStopReason
                if ended_early:
                    miss_reason = MissedStopReason.SHIFT_ENDED_EARLY
                else:
                    miss_reason = MissedStopReason.TRUCK_FULL
                create_missed_stops(
                    authoritative_schedule,
                    missed_stop_orders,
                    reason=miss_reason,
                    early_end_reason=early_reason if ended_early else None,
                )

        try:
            _thin_shift_locations(shift.id)
        except Exception as e:
            # Non-fatal — log and continue. The full data is already saved.
            import logging
            logging.getLogger(__name__).warning(f'Location thinning failed for shift {shift.id}: {e}')

        return Response(DriverShiftSerializer(shift).data)

    # ── MISSED STOPS: list & resolve ──────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='missed-stops',
            permission_classes=[permissions.IsAuthenticated])
    def missed_stops_list(self, request):
        """
        GET /api/driver/shift/missed-stops/
        Returns today's PENDING missed stops sorted by proximity to the driver's
        current GPS (passed as ?lat=&lng= query params).
        Extended-mode drivers call this to populate their work queue.
        """
        from driver.models import MissedStop, MissedStopStatus
        today = timezone.localdate()
        qs = MissedStop.objects.filter(
            status=MissedStopStatus.PENDING,
            collection_date=today,
        ).select_related('original_schedule').order_by('id')

        driver_lat = request.query_params.get('lat')
        driver_lng = request.query_params.get('lng')

        stops_data = []
        for ms in qs:
            wp = ms.waypoint_data or {}
            entry = {
                'id': ms.id,
                'stop_order': ms.stop_order,
                'schedule_id': ms.original_schedule_id,
                'reason': ms.reason,
                'lat': wp.get('lat'),
                'lng': wp.get('lng'),
                'label': wp.get('label') or wp.get('address') or '',
                'barangay_id': wp.get('barangay_id'),
                'status': ms.status,
            }
            if driver_lat and driver_lng:
                try:
                    dist = haversine(float(driver_lat), float(driver_lng),
                                     float(wp.get('lat', 0)), float(wp.get('lng', 0)))
                    entry['distance_m'] = round(dist)
                except (TypeError, ValueError):
                    entry['distance_m'] = None
            stops_data.append(entry)

        if driver_lat and driver_lng:
            stops_data.sort(key=lambda s: s.get('distance_m') or float('inf'))

        return Response(stops_data)

    @action(detail=False, methods=['post'],
            url_path=r'missed-stops/(?P<missed_stop_id>\d+)/collect',
            permission_classes=[permissions.IsAuthenticated])
    def collect_missed_stop(self, request, missed_stop_id=None):
        """
        POST /api/driver/shift/missed-stops/<id>/collect/
        Extended-mode driver marks a missed stop as collected.
        Awards +50 points via resolve_missed_stop.
        """
        from driver.models import DriverShift
        shift = DriverShift.objects.filter(driver=request.user, is_active=True, is_extended_mode=True).first()
        if not shift:
            return Response({'error': 'No active extended-mode shift found.'}, status=status.HTTP_400_BAD_REQUEST)

        from driver.missed_stop_service import resolve_missed_stop
        resolved = resolve_missed_stop(missed_stop_id, shift)
        if resolved is None:
            return Response({'error': 'Stop not found or already collected.'}, status=status.HTTP_404_NOT_FOUND)
        return Response({'status': 'resolved', 'points_awarded': 50})


    @action(detail=False, methods=['get'], url_path='active_shifts')
    def active_shifts(self, request):
        from django.core.cache import cache
        if cache.add('shift_sweep_lock', 1, 300):   # at most once per 5 min
            from .management.commands.sweep_stale_shifts import sweep_stale_shifts
            sweep_stale_shifts()

        from django.db.models import Q
        is_privileged = request.user.is_authenticated and getattr(request.user, 'role', None) in _MAP_FULL_ACCESS_ROLES
        today = timezone.localdate()
        # Include: all active shifts, today's inactive shifts, and today-swept abandoned shifts
        shifts = DriverShift.objects.filter(
            Q(is_active=True)
            | Q(is_active=False, started_at__date=today)
            | Q(is_active=False, end_reason__in=['heartbeat_timeout', 'truck_deleted'], ended_at__date=today)
        ).select_related('driver', 'truck')
        data = []
        now = timezone.now()

        for shift in shifts:
            end_reason = shift.end_reason or ''
            if end_reason in ('heartbeat_timeout', 'truck_deleted'):
                # Authoritative abandoned — swept by management command or truck delete signal
                conn_status = 'abandoned'
            elif not shift.is_active:
                conn_status = 'done'
            elif shift.current_latitude and shift.current_longitude:
                # Determine staleness status from last_location_update
                if shift.last_location_update:
                    age_seconds = (now - shift.last_location_update).total_seconds()
                    if age_seconds <= 60:
                        conn_status = 'active'
                    elif age_seconds <= 300:
                        conn_status = 'weak_signal'
                    else:
                        conn_status = 'offline'
                else:
                    conn_status = 'offline'
            else:
                # If no location yet, determine status by driver's last activity
                if shift.driver.last_activity:
                    age_seconds = (now - shift.driver.last_activity).total_seconds()
                    conn_status = 'active' if age_seconds <= 300 else 'offline'
                else:
                    conn_status = 'offline'

            truck = shift.truck
            if not truck:
                schedule = CollectionSchedule.objects.filter(driver=shift.driver, date=timezone.localdate()).first()
                if not schedule:
                    schedule = CollectionSchedule.objects.filter(driver=shift.driver).first()
                truck = schedule.truck if schedule else None

            data.append({
                'id': shift.id,
                'driver': (shift.driver.full_name or shift.driver.username) if is_privileged else 'Collection Team',
                'truck': truck.id if truck and is_privileged else None,
                'truckId': truck.plate_number if truck and is_privileged else 'Hidden',
                'truckModel': truck.model if truck and is_privileged else 'Hidden',
                'lat': float(shift.current_latitude) if shift.current_latitude else None,
                'lng': float(shift.current_longitude) if shift.current_longitude else None,
                'last_update': shift.last_location_update,
                'ended_at': shift.ended_at,
                'end_reason': end_reason,
                'duty_type': shift.duty_type,
                'op_status': shift.op_status,
                'phase_status': shift.status,
                'end_shift_phase': getattr(shift, 'end_shift_phase', None),
                'status': conn_status,
                'is_extended_mode': shift.is_extended_mode,
                'schedule_id': shift.schedule_id,
                })
        return Response(data)

    @action(detail=False, methods=['get'], url_path='my_active_shift',
            permission_classes=[permissions.IsAuthenticated])
    def my_active_shift(self, request):
        shift = DriverShift.objects.filter(
            driver=request.user,
            is_active=True,
            current_latitude__isnull=False,
            current_longitude__isnull=False,
        ).select_related('driver', 'truck').first()

        if not shift:
            return Response(None)

        now = timezone.now()
        if shift.last_location_update:
            age_seconds = (now - shift.last_location_update).total_seconds()
            if age_seconds <= 60:
                conn_status = 'active'
            elif age_seconds <= 300:
                conn_status = 'weak_signal'
            else:
                conn_status = 'offline'
        else:
            conn_status = 'offline'

        truck = shift.truck
        if not truck:
            schedule = CollectionSchedule.objects.filter(driver=shift.driver, date=timezone.localdate()).first()
            if not schedule:
                schedule = CollectionSchedule.objects.filter(driver=shift.driver).first()
            truck = schedule.truck if schedule else None

        return Response({
            'id': shift.id,
            'driver': shift.driver.full_name or shift.driver.username,
            'truckId': truck.plate_number if truck else 'Unknown',
            'truckModel': truck.model if truck else 'Unknown',
            'lat': float(shift.current_latitude),
            'lng': float(shift.current_longitude),
            'last_update': shift.last_location_update,
            'duty_type': shift.duty_type,
            'op_status': shift.op_status,
            'status': conn_status,
        })

    @action(detail=False, methods=['get'], url_path='profile')
    def profile(self, request):
        """Driver profile + current truck assignment, consumed by CheckInModule & DriverStatusPanel."""
        user = request.user
        today = timezone.localdate()
        assignment = TruckCrewAssignment.objects.filter(
            driver=user, date=today, is_active=True
        ).select_related('truck', 'schedule').prefetch_related('schedule__barangays').first()

        truck = assignment.truck if assignment else None
        schedule = assignment.schedule if assignment else None

        if not schedule:
            schedule = CollectionSchedule.objects.filter(driver=user).prefetch_related('barangays').first()
            if schedule and not truck:
                truck = schedule.truck

        return Response({
            'id':           user.id,
            'name':         user.full_name,
            'email':        user.email,
            'role':         user.role,
            'employeeId':   f'DRV-{user.id:03d}',
            'barangay':     user.barangay.name if user.barangay else 'Unassigned',
            'truck':        f'TRUCK {truck.plate_number}' if truck else 'No Truck Assigned',
            'plateNumber':  truck.plate_number if truck else '—',
            'route':        str(schedule) if schedule else 'No Route Assigned',
            'truckId':      truck.id if truck else None,
        })

    @action(detail=False, methods=['get', 'post'], url_path='status')
    def shift_status(self, request):
        shift = DriverShift.objects.filter(driver=request.user, is_active=True).first()
        if request.method == 'POST':
            new_status = request.data.get('status')
            valid_statuses = ('heading_to_start', 'on_duty', 'on_route', 'delayed', 'heading_to_dumpsite', 'at_dumpsite', 'returning_to_base')
            if shift and new_status in valid_statuses:
                # Trigger dumpsite notification if transitioning to heading_to_dumpsite
                if new_status == 'heading_to_dumpsite':
                    from notifications.services import notify_dumpsite_inbound
                    from driver.models import CollectionSchedule
                    # Try to find today's schedule for this driver to know which dumpsite they're heading to
                    import datetime
                    date_str = str(datetime.date.today())
                    sched = CollectionSchedule.objects.filter(driver=request.user, date=date_str).first()
                    if not sched:
                        sched = CollectionSchedule.objects.filter(driver=request.user).first()
                    if sched and sched.dumpsite:
                        notify_dumpsite_inbound(shift, sched.dumpsite)

                shift.op_status = new_status
                shift.save(update_fields=['op_status'])
                return Response({'shift_active': True, 'op_status': shift.op_status})
            return Response({'error': 'No active shift or invalid status.'}, status=400)
        # GET
        if shift:
            return Response({
                'shift_active': True,
                'status': 'on_duty',
                'op_status': shift.op_status,
                'started_at': shift.started_at,
            })
        return Response({'shift_active': False, 'status': 'off_duty', 'op_status': 'off_duty'})

    @action(detail=False, methods=['get'], url_path='analytics')
    def analytics(self, request):
        """Per-driver analytics: summary + weekly stops + trend. Supports ?period=week|month"""
        from django.db.models import Count, Sum
        import datetime
        user = request.user
        today = timezone.localdate()
        period = request.query_params.get('period', 'week')

        start_week  = today - datetime.timedelta(days=today.weekday())
        start_month = today.replace(day=1)

        start_date = start_week if period == 'week' else start_month

        month_agg = DriverShift.objects.filter(
            driver=user, is_active=False, started_at__date__gte=start_date
        ).aggregate(total_ms=Sum('duration_ms'), routes_done=Count('id'))
        total_ms    = month_agg['total_ms'] or 0
        routes_done = month_agg['routes_done'] or 0
        total_hrs   = round(total_ms / 3_600_000, 1)
        avg_mins    = round((total_ms / 1000 / 60) / routes_done, 0) if routes_done else 0

        chart_data = []
        if period == 'month':
            for i in range(4):
                week_start = start_month + datetime.timedelta(days=i*7)
                week_end = week_start + datetime.timedelta(days=6)
                if i == 3: # Extend last week to end of month
                    import calendar
                    last_day = calendar.monthrange(today.year, today.month)[1]
                    week_end = today.replace(day=last_day)
                count = PickupStatus.objects.filter(
                    driver=user,
                    status='COMPLETED',
                    collected_at__date__gte=week_start,
                    collected_at__date__lte=week_end
                ).count()
                chart_data.append({
                    'day': f'Wk {i+1}', 
                    'stops': count, 
                    'date': f'{week_start.strftime("%b %d")}-{week_end.strftime("%d")}'
                })
        else:
            days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            for i, day_name in enumerate(days):
                day_date = start_week + datetime.timedelta(days=i)
                count = PickupStatus.objects.filter(
                    driver=user,
                    status='COMPLETED',
                    collected_at__date=day_date
                ).count()
                chart_data.append({'day': day_name, 'stops': count, 'date': day_date.strftime('%b %d')})

        # Trend chart based on period
        recent_qs = DriverShift.objects.filter(
            driver=user, is_active=False, duration_ms__isnull=False, started_at__date__gte=start_date
        ).order_by('started_at')
        
        trend = [
            {
                'val': round(ms / 1000 / 60, 1),
                'date': dt.strftime('%b %d, %I:%M %p')
            }
            for ms, dt in recent_qs.values_list('duration_ms', 'started_at')
        ]
        if not trend:
            trend = [{'val': 0, 'date': ''}]

        return Response({
            'summary': {
                'routesCompleted':   routes_done,
                'stopsCompleted':    PickupStatus.objects.filter(driver=user, status='COMPLETED', collected_at__date__gte=start_date).count(),
                'totalWorkingHours': total_hrs,
                'avgCompletionMins': avg_mins,
            },
            'weekly': chart_data,
            'trend':  trend,
        })
    # ↑ analytics ends here — barangay_stops is a SEPARATE method below

    @method_decorator(cache_page(15))
    @action(detail=False, methods=['get'], url_path='barangay_summary', permission_classes=[permissions.AllowAny], throttle_classes=[AnonRateThrottle, UserRateThrottle])
    def barangay_collection_summary(self, request):
        """
        Returns aggregate collection progress per barangay for the public transparency portal.
        """
        from accounts.models import Barangay
        from watcher.models import StopValidation, StopValidationStatus
        from watcher.stop_validation_service import ensure_stop_validations_for_schedule
        from watcher.stop_validation_utils import is_schedule_today

        today = timezone.localdate()
        active_shifts = DriverShift.objects.filter(is_active=True).select_related('schedule')
        
        # Determine which schedules are active today
        active_schedules = []
        for shift in active_shifts:
            schedule = shift.schedule
            if not schedule:
                continue
            if not is_schedule_today(schedule, today):
                continue
            active_schedules.append(schedule)

        summary = []
        barangays = Barangay.objects.all()

        for b in barangays:
            # Find if this barangay is covered by any active schedule
            b_schedules = [s for s in active_schedules if s.barangays.filter(id=b.id).exists()]
            if not b_schedules:
                continue
            
            total_stops = 0
            completed_stops = 0
            
            for s in b_schedules:
                ensure_stop_validations_for_schedule(s)
                # Build a set of stop_orders that belong to this specific barangay
                b_stop_orders = {
                    i for i, wp in enumerate(s.waypoints or [])
                    if isinstance(wp, dict) and str(wp.get('barangay_id', '')) == str(b.id)
                }
                if not b_stop_orders:
                    continue

                validations = StopValidation.objects.filter(schedule=s, collection_date=today, stop_order__in=b_stop_orders)
                
                total_stops += validations.count()
                completed_stops += validations.filter(
                    current_status__in=[StopValidationStatus.COLLECTION_REPORTED, StopValidationStatus.VERIFIED_COLLECTED]
                ).count()
            
            if total_stops > 0:
                summary.append({
                    'barangay_id': b.id,
                    'barangay_name': b.name,
                    'total_stops': total_stops,
                    'completed_stops': completed_stops,
                    'is_active': True
                })
            
        return Response(summary)

    @action(detail=False, methods=['get'], url_path='barangay_stops')
    def barangay_stops(self, request):
        """
        Returns active trucks + stop markers for a given barangay.
        GET /api/driver/shift/barangay_stops/?barangay_name=<name>&scope=focus|all

        Fix summary:
          1. Resolves schedule from shift.schedule (stamped at shift creation) instead of
             guessing via a driver+barangay name filter — which could silently resolve to
             the wrong schedule or None.
          2. Truck visibility is decided once, up front, by whether the shift's schedule
             serves this barangay — NOT by whether the driver's current stop physically
             sits inside the barangay. This means the truck always shows even when the
             driver is currently working a stop in a different barangay of the same route.
          3. scope=focus now returns the GLOBAL current stop (whatever the driver is
             actually doing right now), regardless of which barangay that stop is in.
             Each stop carries an `in_focused_barangay` flag so the frontend can treat
             out-of-zone stops differently (e.g. exclude from fitBounds) without a
             second round-trip.
        """
        from watcher.models import StopValidation, StopValidationStatus
        from watcher.stop_validation_service import ensure_stop_validations_for_schedule
        from watcher.stop_validation_utils import is_schedule_today, is_validation_visible

        barangay_name = request.query_params.get('barangay_name', '').strip()
        scope = request.query_params.get('scope', 'all').strip().lower()
        if not barangay_name:
            return Response({'error': 'barangay_name is required.'}, status=status.HTTP_400_BAD_REQUEST)

        is_privileged = request.user.is_authenticated and getattr(request.user, 'role', None) in _MAP_FULL_ACCESS_ROLES
        now = timezone.now()
        today = timezone.localdate()
        result_trucks, result_stops = [], []

        from django.conf import settings
        staleness_cutoff = now - timedelta(hours=getattr(settings, 'SHIFT_STALE_HOURS', 6))
        from django.db.models import Q

        active_shifts = (
            DriverShift.objects
            .filter(
                Q(last_location_update__gte=staleness_cutoff) | Q(last_location_update__isnull=True, started_at__gte=staleness_cutoff),
                is_active=True,
            )
            .select_related('driver', 'truck', 'schedule')
        )

        for shift in active_shifts:
            # ── Fix 1: Use the shift's explicitly-stamped schedule first ──────────
            # Shifts created after "schedule stamped at creation" was introduced will
            # always have this. Older/stale active shifts may still have schedule=None;
            # fall back to the old name-based guess so those don't vanish from the map.
            schedule = shift.schedule
            if not schedule:
                schedule = CollectionSchedule.objects.filter(
                    driver=shift.driver,
                    barangays__name=barangay_name,
                ).first()

            if not schedule:
                continue

            # Confirm this schedule actually covers the requested barangay.
            matched_barangay = schedule.barangays.filter(name=barangay_name).first()
            if not matched_barangay:
                continue

            age = (now - shift.last_location_update).total_seconds() if shift.last_location_update else None
            conn = 'active' if age and age <= 60 else 'weak_signal' if age and age <= 300 else 'offline'

            # ── Fix 2: Add truck unconditionally once we know the schedule serves
            # this barangay. No longer gated on the driver's current stop being
            # inside the zone. ─────────────────────────────────────────────────────
            if shift.current_latitude and shift.current_longitude:
                result_trucks.append({
                    'id': shift.id,
                    'driver_id': shift.driver.id if is_privileged else None,
                    'driver': shift.driver.full_name if is_privileged else 'Collection Team',
                    'driver_name': shift.driver.full_name if is_privileged else 'Collection Team',
                    'truckId': shift.truck.plate_number if shift.truck and is_privileged else 'Hidden',
                    'truck_plate': shift.truck.plate_number if shift.truck and is_privileged else 'Hidden',
                    'truckModel': shift.truck.model if shift.truck and is_privileged else 'Hidden',
                    'lat': float(shift.current_latitude),
                    'lng': float(shift.current_longitude),
                    'status': conn,
                    'op_status': shift.op_status,
                    'last_update': shift.last_location_update.isoformat() if shift.last_location_update else None,
                    'barangay_name': barangay_name,
                })

            if not is_schedule_today(schedule):
                continue

            ensure_stop_validations_for_schedule(schedule)
            validations = {
                sv.stop_order: sv
                for sv in StopValidation.objects.filter(schedule=schedule, collection_date=today)
                if is_validation_visible(sv)
            }

            # Pass 1 — prefer the first stop that still needs action (unstarted or ready).
            # PENDING_INSPECTION is the default state every stop starts in, so this is the
            # common case: pick the lowest-order stop that hasn't been collected yet.
            current_order = None
            for order in sorted(validations.keys()):
                if validations[order].current_status in (
                    StopValidationStatus.PENDING_INSPECTION,
                    StopValidationStatus.READY_FOR_COLLECTION,
                ):
                    current_order = order
                    break
            # Pass 2 — fallback only when every remaining visible stop has already been
            # collected by the driver but not yet watcher-verified (COLLECTION_REPORTED).
            # Without this, the truck disappears from the map during the tail-end of a
            # route where no PENDING/READY stop is left but the shift is still active.
            if current_order is None:
                for order in sorted(validations.keys()):
                    if validations[order].current_status == StopValidationStatus.COLLECTION_REPORTED:
                        current_order = order
                        break

            # ── Fix 3: scope=focus returns the GLOBAL current stop, not only stops
            # physically inside the focused barangay. Each stop carries
            # `in_focused_barangay` so the frontend can optionally exclude out-of-zone
            # stops from fitBounds without another round-trip. ─────────────────────
            for i, wp in enumerate(schedule.waypoints or []):
                if i == 0:
                    continue  # skip home base
                sv = validations.get(i)
                if not sv:
                    continue
                is_current = i == current_order
                if scope == 'focus' and not is_current:
                    continue
                st = sv.current_status
                result_stops.append({
                    'lat': float(wp.get('lat', 0)), 'lng': float(wp.get('lng', 0)),
                    'label': wp.get('label', f'Stop {i}'),
                    'status': st,
                    'current_status': st,
                    'is_current': is_current,
                    'in_focused_barangay': str(wp.get('barangay_id', '')) == str(matched_barangay.id),
                    'stop_order': i,
                    'schedule_id': schedule.id,
                    'driver_id': shift.driver.id if is_privileged else None,
                    'driver_name': shift.driver.full_name if is_privileged else 'Collection Team',
                    'truck_plate': (shift.truck.plate_number if shift.truck else '') if is_privileged else 'Hidden',
                    'collected_at': sv.collection_timestamp.isoformat() if sv.collection_timestamp else None,
                })

        # NOTE: the old post-loop filter —
        #   active_driver_ids = {s['driver_id'] for s in result_stops}
        #   result_trucks = [t for t in result_trucks if t.get('driver_id') in active_driver_ids]
        # — is intentionally removed. Truck visibility is decided once, up front,
        # by "does this shift's schedule serve the requested barangay".

        return Response({'trucks': result_trucks, 'stops': result_stops})

class CalendarEventViewSet(viewsets.ModelViewSet):
    queryset = CalendarEvent.objects.all().order_by('-date')
    serializer_class = CalendarEventSerializer
    permission_classes = [permissions.IsAuthenticated]

from .models import SystemSetting
from .serializers import HomeBaseSerializer
from rest_framework.views import APIView

def _home_base_payload(s):
    return {'lat': s.home_base_lat, 'lng': s.home_base_lng, 'label': s.home_base_label}

class HomeBaseView(APIView):
    def get_permissions(self):
        return [IsAppAdmin()] if self.request.method == 'PUT' else [permissions.IsAuthenticated()]

    def get(self, request):
        return Response(_home_base_payload(SystemSetting.load()))

    def put(self, request):
        ser = HomeBaseSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        label = d['label'].strip() or 'Home Base'
        updated_routes = 0

        with transaction.atomic():
            setting, _ = SystemSetting.objects.select_for_update().get_or_create(pk=1)
            
            if d.get('apply_to_existing'):
                from django.conf import settings
                cutoff = timezone.now() - timedelta(hours=getattr(settings, 'SHIFT_STALE_HOURS', 6))
                live = DriverShift.objects.filter(is_active=True).filter(
                    Q(last_location_update__gte=cutoff) |
                    Q(last_location_update__isnull=True, started_at__gte=cutoff)
                )
                if live.exists():
                    return Response(
                        {'error': f'{live.count()} shift(s) are active. End them (or force-end) first.'},
                        status=status.HTTP_409_CONFLICT,
                    )
            setting.home_base_lat = d['lat']
            setting.home_base_lng = d['lng']
            setting.home_base_label = label
            setting.updated_by = request.user
            setting.save()

            if d.get('apply_to_existing'):
                base = {'lat': d['lat'], 'lng': d['lng'], 'label': label}
                schedules = list(CollectionSchedule.objects.select_for_update())
                for sch in schedules:
                    wps = sch.waypoints if isinstance(sch.waypoints, list) else []
                    wps = [{**wps[0], **base}, *wps[1:]] if wps else [base]
                    sch.waypoints = wps
                CollectionSchedule.objects.bulk_update(schedules, ['waypoints'])
                updated_routes = len(schedules)

        return Response({**_home_base_payload(setting), 'updated_routes': updated_routes})
