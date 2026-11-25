from rest_framework import viewsets, permissions, status
from django.conf import settings
from rest_framework.throttling import ScopedRateThrottle, AnonRateThrottle, UserRateThrottle
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from datetime import timezone, timedelta
from django.utils.dateparse import parse_datetime, parse_date
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
    Worker,
    LegacyCrewReconciliationAudit,
    SanitationTeam,
    SanitationTeamMembership,
    ScheduleTeamOverride,
    ScheduleTruckAllocation,
    WatcherShift,
    CrewShift,
    ShiftCrewRosterSnapshot,
    TruckReplacementRequest,
    TruckOperationalHoldLog,
    TruckMaintenanceRecord,
    FuelLog,
    is_truck_dispatchable,
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
    WorkerSerializer,
    LegacyCrewReconciliationAuditSerializer,
    SanitationTeamSerializer,
    SanitationTeamMembershipSerializer,
    ScheduleTeamOverrideSerializer,
    ScheduleTruckAllocationSerializer,
    WatcherShiftSerializer,
    TruckOperationalHoldLogSerializer,
    TruckMaintenanceRecordSerializer,
    FuelLogSerializer,
)

from django.db import IntegrityError, transaction
from django.db.models import Q, Count, Prefetch
from django.db.models.deletion import ProtectedError
from django.http import Http404
from django.utils import timezone
import logging
from accounts.models import UserRole
from accounts.permissions import IsAdminRole, is_admin_user
from dumpsite.permissions import IsAdminOrAssignedDumpsiteOperator
from wastewatch.pagination import StandardResultsSetPagination
from .pagination import SanitationTeamPagination

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
    Supports legacy `TruckCrewAssignment` / `CollectionSchedule.driver` as well as
    D-10/D-11 team, override, and `ScheduleTruckAllocation` assignments
    (including Driver-Team Leaders).
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

    driver_team_ids = list(
        SanitationTeamMembership.objects.filter(
            worker__user=driver,
            worker__is_active=True,
            is_active=True,
            team__is_active=True,
            role_in_team__in=('driver', 'leader'),
        ).values_list('team_id', flat=True)
    )

    today_allocs = list(
        ScheduleTruckAllocation.objects.filter(
            team_id__in=driver_team_ids,
            allocation_date=today,
        ).select_related('schedule', 'truck', 'team').order_by('id')
    ) if driver_team_ids else []
    alloc_by_schedule_id = {a.schedule_id: a for a in today_allocs}

    override_schedule_ids = set(
        ScheduleTeamOverride.objects.filter(
            team_id__in=driver_team_ids,
            effective_date=today,
        ).values_list('schedule_id', flat=True)
    ) if driver_team_ids else set()
    overridden_away_ids = set(
        ScheduleTeamOverride.objects.filter(
            effective_date=today,
        ).exclude(team_id__in=driver_team_ids).values_list('schedule_id', flat=True)
    )
    other_team_alloc_ids = set(
        ScheduleTruckAllocation.objects.filter(
            allocation_date=today,
        ).exclude(team_id__in=driver_team_ids).values_list('schedule_id', flat=True)
    )
    excluded_direct_ids = list(overridden_away_ids | other_team_alloc_ids)

    if requested_schedule_id:
        auth_q = Q(driver=driver) & ~Q(pk__in=excluded_direct_ids)
        if assignment and assignment.schedule_id == int(requested_schedule_id):
            auth_q |= Q(pk=requested_schedule_id)
        if driver_team_ids:
            auth_q |= Q(pk__in=list(alloc_by_schedule_id.keys()))
            auth_q |= Q(pk__in=list(override_schedule_ids))
            auth_q |= (Q(default_team_id__in=driver_team_ids) & ~Q(pk__in=list(overridden_away_ids)))
        schedule = (
            CollectionSchedule.objects.exclude(status__in=['CANCELLED', 'COMPLETED'])
            .filter(is_available=True)
            .select_related('truck', 'dumpsite')
            .filter(auth_q)
            .distinct()
            .get(pk=requested_schedule_id)
        )
        alloc = alloc_by_schedule_id.get(schedule.id)
        is_today = bool(
            (assignment and assignment.schedule_id == schedule.id)
            or alloc is not None
            or _is_driver_schedule_for_date(schedule, today)
        )
        truck = (
            alloc.truck
            if alloc and alloc.truck
            else (
                assignment.truck
                if (assignment and assignment.schedule_id == schedule.id and assignment.truck)
                else schedule.truck
            )
        )
        return schedule, truck, is_today

    if assignment and assignment.schedule and assignment.schedule.status not in ('CANCELLED', 'COMPLETED') and getattr(assignment.schedule, 'is_available', True):
        schedule = assignment.schedule
        alloc = alloc_by_schedule_id.get(schedule.id)
        truck = (alloc.truck if alloc and alloc.truck else None) or assignment.truck or schedule.truck
        return schedule, truck, True

    candidate_q = Q(driver=driver) & ~Q(id__in=excluded_direct_ids)
    if driver_team_ids:
        candidate_q |= Q(id__in=list(alloc_by_schedule_id.keys()))
        candidate_q |= Q(id__in=list(override_schedule_ids))
        candidate_q |= (Q(default_team_id__in=driver_team_ids) & ~Q(id__in=list(overridden_away_ids)))

    candidates = [
        s for s in (
            CollectionSchedule.objects.filter(candidate_q)
            .exclude(status__in=['CANCELLED', 'COMPLETED'])
            .filter(is_available=True)
            .select_related('truck', 'dumpsite')
            .distinct()
        )
        if s.id in alloc_by_schedule_id or _is_driver_schedule_for_date(s, today)
    ]
    if not candidates:
        return None, (assignment.truck if assignment else None), False

    unfinished = [s for s in candidates if not is_schedule_complete_today(s)]
    pool = unfinished or candidates

    # Prefer schedules with an explicit today allocation if multiple candidates exist
    alloc_pool = [s for s in pool if s.id in alloc_by_schedule_id]
    if alloc_pool:
        pool = alloc_pool

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

    alloc = alloc_by_schedule_id.get(chosen.id)
    truck = (
        (alloc.truck if alloc and alloc.truck else None)
        or (assignment.truck if assignment and assignment.truck else None)
        or chosen.truck
    )
    return chosen, truck, True

def _pick_present_field(data, *keys):
    for key in keys:
        if key in data:
            val = data.get(key)
            if val is not None and str(val).strip() != '':
                return val
    return None


def _sweep_stale_shifts_for(*, driver=None, truck=None):
    """
    Auto-close active shifts abandoned beyond SHIFT_STALE_HOURS for the given driver
    and/or truck, strictly via ShiftService.conclude_shift_atomic.
    """
    from datetime import timedelta
    from django.conf import settings as django_settings
    from .shift_service import ShiftService

    if driver is None and truck is None:
        return []

    now = timezone.now()
    staleness_cutoff = now - timedelta(hours=getattr(django_settings, 'SHIFT_STALE_HOURS', 6))
    scope_q = Q()
    if driver is not None:
        scope_q |= Q(driver=driver)
    if truck is not None:
        scope_q |= Q(truck=truck) | Q(allocation__truck=truck)

    stale_shifts = list(
        DriverShift.objects.filter(
            scope_q,
            Q(last_location_update__lt=staleness_cutoff)
            | Q(last_location_update__isnull=True, started_at__lt=staleness_cutoff),
            ended_at__isnull=True,
            is_active=True,
        ).order_by('id')
    )
    concluded = []
    for stale_s in stale_shifts:
        concluded.append(
            ShiftService.conclude_shift_atomic(
                driver_shift_id=stale_s.id,
                concluded_by=None,
                end_reason='heartbeat_timeout',
                ended_at=stale_s.last_location_update or stale_s.started_at,
            )
        )
    return concluded


class IsOperationalStaffOrAdmin(permissions.BasePermission):
    """
    Allows access to Administrators (role='admin' or is_staff=True) and operational roles
    (dumpsite, watcher, driver); denies citizens and brgy_official.
    """
    ALLOWED_ROLES = {UserRole.ADMIN, UserRole.DUMPSITE, UserRole.WATCHER, UserRole.DRIVER}

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if is_admin_user(user):
            return True
        return getattr(user, 'role', None) in self.ALLOWED_ROLES

class TruckViewSet(viewsets.ModelViewSet):
    queryset = Truck.objects.all().prefetch_related('drivers', 'crew').order_by('id')
    serializer_class = TruckSerializer
    pagination_class = StandardResultsSetPagination
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @property
    def allow_unpaginated(self):
        # Admins and assigned Dumpsite Operators (facility-scoped) may request unpaginated fleet lists.
        from .truck_service import TruckService
        user = getattr(getattr(self, 'request', None), 'user', None)
        return is_admin_user(user) or TruckService.get_operator_dumpsite_id(user) is not None

    def get_permissions(self):
        if self.request.method in permissions.SAFE_METHODS:
            return [permissions.IsAuthenticated()]
        action_name = getattr(self, 'action', None)
        if action_name in {
            'clear_hold',
            'record_maintenance',
            'update_inspection',
            'replace_truck',
        }:
            return [permissions.IsAuthenticated(), IsAdminOrAssignedDumpsiteOperator()]
        if action_name == 'request_replacement':
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), IsAdminRole()]

    def _base_scoped_queryset(self):
        qs = Truck.objects.all().prefetch_related('drivers', 'crew').order_by('id')
        user = getattr(self.request, 'user', None)
        if not user or not user.is_authenticated:
            return Truck.objects.none()
        if is_admin_user(user):
            return qs
        if getattr(user, 'role', None) == UserRole.DUMPSITE:
            from .truck_service import TruckService
            fac_id = TruckService.get_operator_dumpsite_id(user)
            if not fac_id:
                return Truck.objects.none()
            return qs.filter(TruckService.facility_trucks_q(fac_id)).distinct()
        return qs

    def get_queryset(self):
        qs = self._base_scoped_queryset()
        status_param = self.request.query_params.get('status')
        if status_param and status_param.lower() != 'all':
            qs = qs.filter(status=status_param.lower())

        lifecycle_param = (self.request.query_params.get('lifecycle') or '').strip().lower()
        if lifecycle_param == 'available':
            qs = qs.filter(status='active', is_retired=False, is_operational_hold=False, op_status='AVAILABLE')
        elif lifecycle_param == 'assigned':
            qs = qs.filter(status='active', is_retired=False, drivers__isnull=False).distinct()
        elif lifecycle_param == 'in_use':
            qs = qs.filter(
                status='active',
                is_retired=False,
                op_status__in=['ON_DUTY', 'IN_USE', 'EN_ROUTE', 'IN_TRANSIT'],
            )
        elif lifecycle_param == 'maintenance':
            qs = qs.filter(status='maintenance', is_retired=False)
        elif lifecycle_param == 'operational_hold':
            qs = qs.filter(is_operational_hold=True, is_retired=False)
        elif lifecycle_param == 'retired':
            qs = qs.filter(is_retired=True)

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
        base_qs = self._base_scoped_queryset()
        queryset = self.filter_queryset(self.get_queryset())

        if getattr(self, 'paginator', None) is not None:
            summary_agg = base_qs.aggregate(
                all=Count('id', distinct=True),
                active=Count('id', filter=Q(status='active', is_retired=False), distinct=True),
                available=Count('id', filter=Q(status='active', is_retired=False, is_operational_hold=False, op_status='AVAILABLE'), distinct=True),
                assigned=Count('id', filter=Q(status='active', is_retired=False, drivers__isnull=False), distinct=True),
                in_use=Count(
                    'id',
                    filter=Q(status='active', is_retired=False, op_status__in=['ON_DUTY', 'IN_USE', 'EN_ROUTE', 'IN_TRANSIT']),
                    distinct=True,
                ),
                maintenance=Count('id', filter=Q(status='maintenance', is_retired=False), distinct=True),
                operational_hold=Count('id', filter=Q(is_operational_hold=True, is_retired=False), distinct=True),
                retired=Count('id', filter=Q(is_retired=True), distinct=True),
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

    def destroy(self, request, *args, **kwargs):
        from django.db.models.deletion import ProtectedError
        from django.core.exceptions import PermissionDenied
        from .truck_service import TruckService, TruckLifecycleConflictError

        instance = self.get_object()
        try:
            TruckService.delete_uncommissioned_truck(instance, user=request.user)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except PermissionDenied as e:
            return Response({'error': str(e), 'code': 'permission_denied'}, status=status.HTTP_403_FORBIDDEN)
        except (ProtectedError, TruckLifecycleConflictError, DjangoValidationError) as e:
            msg = e.args[0] if getattr(e, 'args', None) else str(e)
            return Response(
                {
                    'error': str(msg),
                    'code': getattr(e, 'error_code', 'deletion_prohibited'),
                    'truck_id': instance.id,
                    'retirement_state': instance.retirement_state,
                    'commissioning_provenance': instance.commissioning_provenance,
                },
                status=status.HTTP_409_CONFLICT,
            )

    @action(detail=True, methods=['post'], url_path='commission', permission_classes=[IsAdminRole])
    def commission(self, request, pk=None):
        """
        POST /api/driver/trucks/{id}/commission/
        Controlled initial commissioning endpoint for newly created uncommissioned trucks.
        """
        from django.core.exceptions import PermissionDenied
        from .models import is_truck_dispatchable
        from .truck_service import TruckService, TruckLifecycleConflictError

        truck = self.get_object()
        commissioned_at = request.data.get('commissioned_at')
        notes = request.data.get('notes', '')
        try:
            updated = TruckService.commission_truck(
                truck,
                user=request.user,
                commissioned_at=commissioned_at,
                notes=notes,
            )
            return Response(
                {
                    'status': 'success',
                    'truck_id': updated.id,
                    'retirement_state': updated.retirement_state,
                    'commissioning_provenance': updated.commissioning_provenance,
                    'commissioned_at': updated.commissioned_at.isoformat() if updated.commissioned_at else None,
                    'is_dispatchable': is_truck_dispatchable(updated),
                    'truck': TruckSerializer(updated, context=self.get_serializer_context()).data,
                },
                status=status.HTTP_200_OK,
            )
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response(
                {
                    'error': str(e.message if hasattr(e, 'message') else e),
                    'code': e.error_code,
                    **e.details,
                },
                status=status.HTTP_409_CONFLICT,
            )

        except DjangoValidationError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=True, methods=['post'], url_path='reconcile-commissioning', permission_classes=[IsAdminRole])
    def reconcile_commissioning(self, request, pk=None):
        """
        POST /api/driver/trucks/{id}/reconcile-commissioning/
        Administrative reconciliation endpoint for legacy_reconciliation trucks.
        """
        from django.core.exceptions import PermissionDenied
        from .models import is_truck_dispatchable
        from .truck_service import TruckService, TruckHistoricalAuditService, TruckLifecycleConflictError

        truck = self.get_object()
        act = request.data.get('action')
        verified_commissioned_at = request.data.get('verified_commissioned_at')
        verification_notes = request.data.get('verification_notes', '')
        try:
            updated = TruckService.reconcile_legacy_truck(
                truck,
                user=request.user,
                action=act,
                verified_commissioned_at=verified_commissioned_at,
                verification_notes=verification_notes,
            )
            payload = {
                'status': 'success',
                'truck_id': updated.id,
                'retirement_state': updated.retirement_state,
                'commissioning_provenance': updated.commissioning_provenance,
                'commissioned_at': updated.commissioned_at.isoformat() if updated.commissioned_at else None,
                'is_dispatchable': is_truck_dispatchable(updated),
                'eligible_for_physical_deletion': TruckHistoricalAuditService.is_eligible_for_physical_delete(updated),
            }
            return Response(payload, status=status.HTTP_200_OK)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response(
                {
                    'error': str(e.message if hasattr(e, 'message') else e),
                    'code': e.error_code,
                    **e.details,
                },
                status=status.HTTP_409_CONFLICT,
            )

        except DjangoValidationError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=True, methods=['post'], url_path='retire', permission_classes=[IsAdminRole])
    def retire(self, request, pk=None):
        """
        POST /api/driver/trucks/{id}/retire/
        Owner-Approved Item 13 (Option A): 4-phase resumable permanent retirement endpoint.
        """
        from django.core.exceptions import PermissionDenied
        from .models import is_truck_dispatchable
        from .truck_service import TruckService, TruckLifecycleConflictError

        truck = self.get_object()
        reason = request.data.get('reason', '')
        try:
            updated = TruckService.retire_truck(truck, user=request.user, reason=reason)
            return Response(
                {
                    'status': 'success',
                    'truck_id': updated.id,
                    'retirement_state': updated.retirement_state,
                    'commissioning_provenance': updated.commissioning_provenance,
                    'is_retired': updated.is_retired,
                    'is_dispatchable': is_truck_dispatchable(updated),
                    'truck': TruckSerializer(updated, context=self.get_serializer_context()).data,
                },
                status=status.HTTP_200_OK,
            )
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response(
                {
                    'error': str(e.message if hasattr(e, 'message') else e),
                    'code': e.error_code,
                    **e.details,
                },
                status=status.HTTP_409_CONFLICT,
            )

    def _get_unscoped_truck(self, pk):
        from django.shortcuts import get_object_or_404
        return get_object_or_404(Truck.objects.all(), pk=pk)

    @action(detail=True, methods=['post'], url_path='clear-hold', permission_classes=[permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator])
    def clear_hold(self, request, pk=None):
        from django.core.exceptions import PermissionDenied
        from .truck_service import TruckService, TruckLifecycleConflictError
        truck = self._get_unscoped_truck(pk)
        self.check_object_permissions(request, truck)
        try:
            updated = TruckService.clear_operational_hold(
                truck,
                user=request.user,
                resolution_notes=request.data.get('resolution_notes', ''),
            )
            return Response(TruckSerializer(updated, context=self.get_serializer_context()).data, status=status.HTTP_200_OK)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response({'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code}, status=status.HTTP_409_CONFLICT)
        except DjangoValidationError as e:
            return Response(e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='record-maintenance', permission_classes=[permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator])
    def record_maintenance(self, request, pk=None):
        from django.core.exceptions import PermissionDenied
        from .truck_service import TruckService, TruckLifecycleConflictError
        truck = self._get_unscoped_truck(pk)
        self.check_object_permissions(request, truck)
        scheduled_for_raw = request.data.get('scheduled_for')
        scheduled_for = parse_date(str(scheduled_for_raw)) if scheduled_for_raw else None
        if scheduled_for_raw and not scheduled_for:
            return Response({'scheduled_for': 'Invalid scheduled_for date format.'}, status=status.HTTP_400_BAD_REQUEST)
        record_id_raw = request.data.get('record_id')
        record_id = None
        if record_id_raw not in (None, ''):
            try:
                record_id = int(record_id_raw)
            except (TypeError, ValueError):
                return Response({'record_id': 'Invalid record_id.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            updated = TruckService.record_maintenance(
                truck,
                user=request.user,
                action_type=request.data.get('action_type', 'start'),
                reason=request.data.get('reason', '') or request.data.get('notes', ''),
                maintenance_status=request.data.get('maintenance_status', 'under_repair'),
                maintenance_type=request.data.get('maintenance_type', 'CORRECTIVE'),
                title=request.data.get('title', ''),
                scheduled_for=scheduled_for,
                cost=request.data.get('cost'),
                odometer_km=request.data.get('odometer_km'),
                record_id=record_id,
            )
            return Response(TruckSerializer(updated, context=self.get_serializer_context()).data, status=status.HTTP_200_OK)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response({'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code}, status=status.HTTP_409_CONFLICT)
        except DjangoValidationError as e:
            return Response(e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='update-inspection', permission_classes=[permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator])
    def update_inspection(self, request, pk=None):
        from django.core.exceptions import PermissionDenied
        from .truck_service import TruckService, TruckLifecycleConflictError
        truck = self._get_unscoped_truck(pk)
        self.check_object_permissions(request, truck)
        try:
            updated = TruckService.update_inspection_state(
                truck,
                user=request.user,
                inspection_state=request.data.get('inspection_state', 'PASSED'),
                mechanical_condition=request.data.get('mechanical_condition'),
                reason=request.data.get('reason', ''),
            )
            return Response(TruckSerializer(updated, context=self.get_serializer_context()).data, status=status.HTTP_200_OK)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response({'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code}, status=status.HTTP_409_CONFLICT)
        except DjangoValidationError as e:
            return Response(e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='replace-truck', permission_classes=[permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator])
    def replace_truck(self, request, pk=None):
        from django.core.exceptions import PermissionDenied
        from .truck_service import TruckService, TruckLifecycleConflictError
        from .serializers import ScheduleTruckAllocationSerializer
        truck = self._get_unscoped_truck(pk)
        self.check_object_permissions(request, truck)
        replacement_truck_id = request.data.get('replacement_truck_id')
        schedule_id = request.data.get('schedule_id')
        if not replacement_truck_id or not schedule_id:
            return Response({'error': 'replacement_truck_id and schedule_id are required.'}, status=status.HTTP_400_BAD_REQUEST)
        eff_date_raw = request.data.get('effective_date')
        eff_date = parse_date(str(eff_date_raw)) if eff_date_raw else None
        if eff_date_raw and not eff_date:
            return Response({'error': 'Invalid effective_date format.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            res = TruckService.replace_truck_assignment(
                truck,
                replacement_truck_id=int(replacement_truck_id),
                schedule_id=int(schedule_id),
                user=request.user,
                effective_date=eff_date,
                reason=request.data.get('reason', ''),
                transfer_drivers=bool(request.data.get('transfer_drivers', False)),
            )
            return Response({
                'old_truck': TruckSerializer(res['old_truck'], context=self.get_serializer_context()).data,
                'replacement_truck': TruckSerializer(res['replacement_truck'], context=self.get_serializer_context()).data,
                'allocation': ScheduleTruckAllocationSerializer(res['allocation']).data,
                'transferred_driver_ids': res['transferred_driver_ids'],
            }, status=status.HTTP_200_OK)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response({'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code}, status=status.HTTP_409_CONFLICT)
        except (DjangoValidationError, ValueError) as e:
            return Response(e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='request-replacement', permission_classes=[permissions.IsAuthenticated])
    def request_replacement(self, request, pk=None):
        from django.core.exceptions import PermissionDenied
        from .truck_service import TruckLifecycleConflictError, TruckService
        truck = self._get_unscoped_truck(pk)
        try:
            res = TruckService.request_truck_replacement(
                truck,
                user=request.user,
                schedule_id=request.data.get('schedule_id'),
                reason=request.data.get('reason', ''),
            )
            return Response(res, status=status.HTTP_201_CREATED)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response(
                {'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code},
                status=status.HTTP_409_CONFLICT,
            )
        except DjangoValidationError as e:
            return Response(e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'], url_path='audit-history', permission_classes=[permissions.IsAuthenticated])
    def audit_history(self, request, pk=None):
        import json as _json
        from django.core.exceptions import PermissionDenied
        from analytics.models import ActivityLog
        from .truck_service import TruckService

        truck = self._get_unscoped_truck(pk)
        try:
            TruckService.require_admin_or_facility_operator(request.user, truck=truck)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)

        logs = ActivityLog.objects.filter(module='Trucks').select_related('admin').order_by('-timestamp')[:100]
        matched = []
        for log in logs:
            try:
                parsed = _json.loads(log.details) if log.details else {}
            except Exception:
                parsed = {}
            if (
                str(parsed.get('target_object_id')) == str(truck.id)
                or str(parsed.get('replacement_truck_id')) == str(truck.id)
                or str(parsed.get('old_truck_id')) == str(truck.id)
            ):
                matched.append({
                    'id': log.id,
                    'event': parsed.get('event', log.action),
                    'actor': log.admin.username if log.admin_id else 'system',
                    'timestamp': log.timestamp,
                    'created_at': log.timestamp,
                    'details': parsed,
                })
        return Response(matched[:25], status=status.HTTP_200_OK)

class IsCollectionScheduleAuthorized(permissions.BasePermission):
    """
    Operational permission for CollectionScheduleViewSet:
    - Anonymous users: Denied (HTTP 401 Unauthorized via IsAuthenticated check).
    - Write actions: Admins only (role='admin' or is_staff=True).
    - Read actions: Admins, Drivers, and Dumpsite operators only.
      Citizens, Watchers, and Barangay Officials are denied (HTTP 403 Forbidden).
    """
    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if is_admin_user(user):
            return True
        if request.method in permissions.SAFE_METHODS:
            return getattr(user, 'role', None) in (UserRole.DRIVER, UserRole.DUMPSITE)
        return False


class CollectionScheduleViewSet(viewsets.ModelViewSet):
    queryset = CollectionSchedule.objects.select_related('truck', 'driver', 'dumpsite', 'default_team').prefetch_related('barangays').order_by('-id')
    serializer_class = CollectionScheduleSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [permissions.IsAuthenticated, IsCollectionScheduleAuthorized]

    @property
    def allow_unpaginated(self):
        user = getattr(getattr(self, 'request', None), 'user', None)
        if not user or not user.is_authenticated:
            return False
        if is_admin_user(user):
            return True
        return getattr(user, 'role', None) in (UserRole.DRIVER, UserRole.DUMPSITE)

    def get_queryset(self):
        user = getattr(self.request, 'user', None)
        if not user or not user.is_authenticated:
            return CollectionSchedule.objects.none()

        qs = CollectionSchedule.objects.select_related('truck', 'driver', 'dumpsite', 'default_team').prefetch_related('barangays').order_by('-id')

        if is_admin_user(user):
            driver_param = self.request.query_params.get('driver')
            if driver_param:
                qs = qs.filter(driver_id=driver_param)
            truck_param = self.request.query_params.get('truck')
            if truck_param:
                qs = qs.filter(truck_id=truck_param)
            dumpsite_param = self.request.query_params.get('dumpsite')
            if dumpsite_param:
                qs = qs.filter(dumpsite_id=dumpsite_param)
            return qs

        role = getattr(user, 'role', None)
        if role == UserRole.DRIVER:
            today = timezone.localdate()
            # 1. Active DriverShift schedule
            active_shift_schedules = DriverShift.objects.filter(
                driver=user, is_active=True, schedule__isnull=False
            ).values_list('schedule_id', flat=True)

            # 2. Daily crew assignment for today
            crew_schedules = TruckCrewAssignment.objects.filter(
                driver=user, date=today, schedule__isnull=False, is_active=True
            ).values_list('schedule_id', flat=True)

            # 3. Recurring default driver assignment + D-10/D-11 team/allocation assignments
            driver_team_ids = SanitationTeamMembership.objects.filter(
                worker__user=user, role_in_team__in=('driver', 'leader'), is_active=True
            ).values_list('team_id', flat=True)
            alloc_schedule_ids = ScheduleTruckAllocation.objects.filter(
                team_id__in=driver_team_ids, allocation_date=today
            ).values_list('schedule_id', flat=True)
            override_schedule_ids = ScheduleTeamOverride.objects.filter(
                team_id__in=driver_team_ids, effective_date=today
            ).values_list('schedule_id', flat=True)

            return qs.filter(
                Q(id__in=active_shift_schedules) |
                Q(id__in=crew_schedules) |
                Q(id__in=alloc_schedule_ids) |
                Q(id__in=override_schedule_ids) |
                Q(default_team_id__in=driver_team_ids) |
                Q(driver=user)
            ).distinct()

        if role == UserRole.DUMPSITE:
            from .truck_service import TruckService
            facility_id = TruckService.get_operator_dumpsite_id(user)
            if facility_id:
                return qs.filter(dumpsite_id=facility_id)
            return CollectionSchedule.objects.none()

        return CollectionSchedule.objects.none()

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        from notifications.services import process_schedule_lifecycle_change
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        schedule = serializer.save()

        process_schedule_lifecycle_change(
            before_snapshot=None,
            after_schedule=schedule,
            actor=request.user,
        )

        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        from notifications.services import (
            capture_schedule_snapshot,
            process_schedule_lifecycle_change,
        )
        partial = kwargs.pop('partial', False)
        schedule_pk = kwargs.get('pk') or self.kwargs.get('pk')

        locked_instance = CollectionSchedule.objects.select_for_update().get(pk=schedule_pk)
        before_snapshot = capture_schedule_snapshot(locked_instance)

        serializer = self.get_serializer(locked_instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        updated_schedule = serializer.save()

        process_schedule_lifecycle_change(
            before_snapshot=before_snapshot,
            after_schedule=updated_schedule,
            actor=request.user,
        )

        return Response(serializer.data)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        from notifications.services import (
            capture_schedule_snapshot,
            dispatch_schedule_cancellation_notifications,
        )
        schedule_pk = kwargs.get('pk') or self.kwargs.get('pk')
        locked_instance = CollectionSchedule.objects.select_for_update().get(pk=schedule_pk)

        has_shift_or_alloc = (
            DriverShift.objects.filter(Q(schedule=locked_instance) | Q(allocation__schedule=locked_instance)).exists()
            or ScheduleTruckAllocation.objects.filter(schedule=locked_instance).exists()
            or CrewShift.objects.filter(Q(schedule=locked_instance) | Q(allocation__schedule=locked_instance)).exists()
            or TruckReplacementRequest.objects.filter(schedule=locked_instance).exists()
        )
        if has_shift_or_alloc:
            return Response(
                {
                    'error': (
                        'Cannot delete a schedule with existing truck allocations, shifts, or replacement requests. '
                        'Cancel or mark the schedule unavailable instead.'
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        before_snapshot = capture_schedule_snapshot(locked_instance)
        try:
            response = super().destroy(request, *args, **kwargs)
        except ProtectedError:
            transaction.set_rollback(True)
            return Response(
                {'error': 'Schedule is referenced by protected operational records and cannot be deleted.'},
                status=status.HTTP_409_CONFLICT,
            )

        if before_snapshot and before_snapshot['is_available'] and before_snapshot['barangay_ids']:
            dispatch_schedule_cancellation_notifications(
                schedule_pk=locked_instance.pk,
                barangay_ids=before_snapshot['barangay_ids'],
                actor=request.user,
            )

        return response

    # ── Route Optimisation (closed-loop: Dumpsite → Stops → Dumpsite) ────────
    @action(detail=False, methods=['post'], url_path='optimize-route',
            permission_classes=[permissions.IsAuthenticated])
    def optimize_route(self, request):
        """
        Accepts { dumpsite_id, stops: [{stop_id, lat, lng, label, barangay_id, is_hotspot}] }
        Returns reordered stops + ORS route geometry via a server-side ORS call.
        Falls back to nearest-neighbour order with no geometry if ORS is unavailable.
        """
        import os, math, urllib.request, urllib.error, json as _json

        dumpsite_id = request.data.get('dumpsite_id')
        raw_stops = request.data.get('stops', [])

        if not dumpsite_id:
            return Response({'error': 'dumpsite_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(raw_stops, list) or len(raw_stops) == 0:
            return Response({'error': 'stops must be a non-empty list'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            from driver.models import Dumpsite
            dumpsite = Dumpsite.objects.get(pk=dumpsite_id)
        except Exception:
            return Response({'error': 'Dumpsite not found'}, status=status.HTTP_404_NOT_FOUND)

        origin_lat = float(dumpsite.latitude)
        origin_lng = float(dumpsite.longitude)

        # Validate stops
        stops = []
        for s in raw_stops:
            try:
                stops.append({
                    'stop_id': s.get('stop_id', ''),
                    'lat': float(s['lat']),
                    'lng': float(s['lng']),
                    'label': s.get('label', ''),
                    'barangay_id': s.get('barangay_id'),
                    'is_hotspot': bool(s.get('is_hotspot', False)),
                })
            except (KeyError, TypeError, ValueError):
                return Response({'error': 'Each stop must have numeric lat and lng'}, status=status.HTTP_400_BAD_REQUEST)

        # ── Nearest-neighbour TSP (closed loop from origin) ──────────────────
        def haversine(lat1, lng1, lat2, lng2):
            R = 6371008.8
            dlat = math.radians(lat2 - lat1)
            dlng = math.radians(lng2 - lng1)
            a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
            return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        unvisited = list(range(len(stops)))
        ordered = []
        cur_lat, cur_lng = origin_lat, origin_lng
        while unvisited:
            nearest = min(unvisited, key=lambda i: haversine(cur_lat, cur_lng, stops[i]['lat'], stops[i]['lng']))
            unvisited.remove(nearest)
            ordered.append(nearest)
            cur_lat, cur_lng = stops[nearest]['lat'], stops[nearest]['lng']

        ordered_stops = [
            {**stops[i], 'stop_order': idx + 1}
            for idx, i in enumerate(ordered)
        ]

        # ── ORS route fetch (server-side) ─────────────────────────────────────
        ors_api_key = os.environ.get('ORS_API_KEY', '')
        route_geometry = ''
        route_distance_m = None
        route_duration_s = None

        if ors_api_key and len(ordered_stops) >= 1:
            # Build closed-loop waypoints: origin → stops → origin
            waypoints = [[origin_lng, origin_lat]]
            for s in ordered_stops:
                waypoints.append([s['lng'], s['lat']])
            waypoints.append([origin_lng, origin_lat])

            ors_url = 'https://api.openrouteservice.org/v2/directions/driving-car'
            auth_header = ors_api_key if ors_api_key.startswith('Bearer ') else f'Bearer {ors_api_key}'
            ors_body = _json.dumps({'coordinates': waypoints, 'instructions': False}).encode('utf-8')
            ors_req = urllib.request.Request(
                ors_url,
                data=ors_body,
                headers={
                    'Authorization': auth_header,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                method='POST',
            )
            try:
                with urllib.request.urlopen(ors_req, timeout=10) as resp:
                    ors_data = _json.loads(resp.read())
                    if ors_data.get('routes'):
                        r = ors_data['routes'][0]
                        route_geometry = r.get('geometry', '')
                        summary = r.get('summary', {})
                        route_distance_m = round(summary.get('distance', 0))
                        route_duration_s = round(summary.get('duration', 0))
            except Exception:
                pass  # ORS unavailable — return ordered stops without geometry

        import hashlib, datetime
        sig_parts = f"{dumpsite_id}|" + '|'.join(f"{s['lat']:.5f},{s['lng']:.5f}" for s in ordered_stops)
        route_signature = hashlib.sha256(sig_parts.encode()).hexdigest()[:16]

        return Response({
            'stops': ordered_stops,
            'route_geometry': route_geometry,
            'route_distance_m': route_distance_m,
            'route_duration_s': route_duration_s,
            'route_signature': route_signature,
            'route_optimized_at': datetime.datetime.utcnow().isoformat() + 'Z',
        })

    @action(detail=True, methods=['get'], url_path='resolve-team')
    def resolve_team(self, request, pk=None):
        from .allocation_service import AllocationService
        from .serializers import SanitationTeamSerializer
        schedule = self.get_object()
        date_str = request.query_params.get('date')
        target_date = parse_date(date_str) if date_str else timezone.localdate()
        try:
            team = AllocationService.resolve_schedule_team(schedule_id=schedule.id, target_date=target_date)
            return Response(SanitationTeamSerializer(team).data if team else None, status=status.HTTP_200_OK)
        except DjangoValidationError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='set-default-team', permission_classes=[IsAdminRole])
    def set_default_team(self, request, pk=None):
        from .allocation_service import AllocationService
        from .team_service import ActiveShiftConflictError
        team_id = request.data.get('team_id')
        if not team_id:
            return Response({'error': 'team_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            schedule = AllocationService.set_schedule_default_team(
                schedule_id=int(pk),
                team_id=int(team_id),
            )
            return Response(CollectionScheduleSerializer(schedule).data, status=status.HTTP_200_OK)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError, TypeError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=True, methods=['post'], url_path='create-override', permission_classes=[IsAdminRole])
    def create_override(self, request, pk=None):
        from .allocation_service import AllocationService
        from .serializers import ScheduleTeamOverrideSerializer
        from .team_service import ActiveShiftConflictError
        effective_date_str = request.data.get('effective_date')
        team_id = request.data.get('team_id')
        reason = request.data.get('reason', '')
        if not effective_date_str or not team_id:
            return Response({'error': 'effective_date and team_id are required.'}, status=status.HTTP_400_BAD_REQUEST)
        eff_date = parse_date(effective_date_str)
        if not eff_date:
            return Response({'error': 'Invalid date format.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            override = AllocationService.create_schedule_override(
                schedule_id=int(pk),
                effective_date=eff_date,
                team_id=int(team_id),
                reason=reason,
                created_by=request.user,
            )
            return Response(ScheduleTeamOverrideSerializer(override).data, status=status.HTTP_201_CREATED)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='allocate-truck', permission_classes=[permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator])
    def allocate_truck(self, request, pk=None):
        from django.core.exceptions import PermissionDenied
        from .allocation_service import AllocationService
        from .serializers import ScheduleTruckAllocationSerializer
        from .team_service import ActiveShiftConflictError
        from .truck_service import TruckService
        schedule = CollectionSchedule.objects.filter(pk=pk).first()
        if not schedule:
            return Response({'error': f'Schedule #{pk} not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            TruckService.require_admin_or_facility_operator(request.user, schedule=schedule)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)

        allocation_date_str = request.data.get('allocation_date')
        truck_id = request.data.get('truck_id')
        team_id = request.data.get('team_id')
        if not allocation_date_str or not truck_id:
            return Response({'error': 'allocation_date and truck_id are required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            truck_id_int = int(truck_id)
        except (TypeError, ValueError):
            return Response({'error': 'Invalid truck_id.'}, status=status.HTTP_400_BAD_REQUEST)
        truck_obj = Truck.objects.filter(pk=truck_id_int).first()
        if not truck_obj:
            return Response({'error': f'Truck #{truck_id_int} not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            TruckService.require_admin_or_facility_operator(request.user, schedule=schedule, truck=truck_obj)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)

        alloc_date = parse_date(allocation_date_str)
        if not alloc_date:
            return Response({'error': 'Invalid date format.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            allocation = AllocationService.allocate_truck_for_schedule(
                schedule_id=int(pk),
                allocation_date=alloc_date,
                truck_id=truck_id_int,
                team_id=int(team_id) if team_id else None,
                allocated_by=request.user,
            )
            return Response(ScheduleTruckAllocationSerializer(allocation).data, status=status.HTTP_201_CREATED)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


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

class PickupStatusViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PickupStatus.objects.all()
    serializer_class = PickupStatusSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = (
            super()
            .get_queryset()
            .select_related('driver', 'schedule', 'schedule__truck')
        )

        user = getattr(self.request, 'user', None)
        if not user or not user.is_authenticated:
            return qs.none()

        params = self.request.query_params
        schedule_id = params.get('schedule_id')
        driver_id = params.get('driver_id')

        if is_admin_user(user):
            if schedule_id:
                try:
                    qs = qs.filter(schedule_id=int(schedule_id))
                except (TypeError, ValueError):
                    return qs.none()
            if driver_id:
                try:
                    qs = qs.filter(driver_id=int(driver_id))
                except (TypeError, ValueError):
                    return qs.none()
        elif getattr(user, 'role', None) == UserRole.DRIVER:
            qs = qs.filter(driver=user)
            if schedule_id:
                try:
                    qs = qs.filter(schedule_id=int(schedule_id))
                except (TypeError, ValueError):
                    return qs.none()
            if driver_id:
                try:
                    qs = qs.filter(driver_id=int(driver_id))
                except (TypeError, ValueError):
                    return qs.none()
        elif getattr(user, 'role', None) == UserRole.WATCHER:
            if schedule_id:
                try:
                    qs = qs.filter(schedule_id=int(schedule_id))
                except (TypeError, ValueError):
                    return qs.none()
            if driver_id:
                try:
                    qs = qs.filter(driver_id=int(driver_id))
                except (TypeError, ValueError):
                    return qs.none()

            from .team_service import filter_watcher_authorized_schedule_dates
            today = timezone.localdate()
            schedule_ids = list(
                qs.filter(schedule_id__isnull=False)
                .values_list('schedule_id', flat=True)
                .distinct()
            )
            authorized_pairs = filter_watcher_authorized_schedule_dates(
                user,
                [(sid, today) for sid in schedule_ids],
            )
            authorized_schedule_ids = [sid for sid, _ in authorized_pairs]
            if not authorized_schedule_ids:
                return qs.none()
            qs = qs.filter(schedule_id__in=authorized_schedule_ids)
        else:
            return qs.none()

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
        if getattr(request.user, 'role', None) != UserRole.DRIVER:
            return Response(
                {'error': 'Only Drivers may submit collection proof.'},
                status=status.HTTP_403_FORBIDDEN,
            )
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

def is_dumpsite_base_marker(wp, dumpsite):
    """
    Returns True if waypoint `wp` explicitly or geographically represents the assigned dumpsite.
    Approved Decisions 1 & 2:
    - schedule.dumpsite is the authoritative operational base.
    - Waypoint index 0 is a collection stop unless an explicit base marker or verified coordinate
      match identifies it as the assigned Dumpsite.
    - Treat the 50m Dumpsite coordinate comparison as a legacy base-marker heuristic, not sufficient
      grounds to discard a legitimate resident stop without checking route identity and context.
    """
    if not isinstance(wp, dict):
        return False

    wp_type = str(wp.get('type') or '').strip().lower()
    wp_role = str(wp.get('role') or '').strip().lower()
    is_base_flag = bool(wp.get('is_base'))
    if is_base_flag or wp_type in ('base', 'dumpsite', 'depot') or wp_role in ('origin', 'base', 'dumpsite'):
        return True

    label = str(wp.get('label') or wp.get('name') or wp.get('address') or '').strip().lower()
    is_base_label = any(k in label for k in ('base depot', 'depot', 'dumpsite', 'staging base')) or label == 'base' or label.startswith('base ')

    # Explicit base label without resident stop identity
    if is_base_label and not wp.get('stop_id') and not wp.get('barangay_id'):
        return True

    # Coordinate match with dumpsite (within 50m) as heuristic
    if dumpsite and dumpsite.latitude is not None and dumpsite.longitude is not None:
        try:
            w_lat = float(wp['lat'])
            w_lng = float(wp['lng'])
            d_lat = float(dumpsite.latitude)
            d_lng = float(dumpsite.longitude)
            dist_to_dumpsite = haversine(w_lat, w_lng, d_lat, d_lng)
            if dist_to_dumpsite <= 50.0:
                if not wp.get('stop_id') and not wp.get('barangay_id'):
                    return True
                if is_base_label:
                    return True
                if dist_to_dumpsite <= 10.0 and not wp.get('stop_id'):
                    return True
        except (ValueError, KeyError, TypeError):
            pass

    return False


def resolve_eligible_collection_stops(shift, schedule):
    """
    Resolves all valid, eligible collection stops for a schedule during an active shift.
    - Fails closed if schedule.dumpsite is missing or lacks valid coordinates.
    - Evaluates waypoints (including index 0 if not a confirmed base marker).
    - Matches PickupStatus and StopValidation records by schedule and stop_order (and stop_id).
    - Rejects conflicting stop_ids and duplicate records.
    - Excludes completed, verified, and empty stops.
    - Excludes missed/failed stops unless shift.is_extended_mode is True.
    - Includes PENDING_INSPECTION and READY_FOR_COLLECTION stops.
    - Resolves target barangay: sole barangay fallback if schedule has 1 barangay;
      multi-barangay schedule missing/invalid stop barangay fails closed for that stop.
    - Missing status records default to pending if waypoint is valid.
    """
    dumpsite = getattr(schedule, 'dumpsite', None)
    if not dumpsite or dumpsite.latitude is None or dumpsite.longitude is None:
        logger.warning(
            "resolve_eligible_collection_stops: Schedule pk=%s missing or invalid assigned dumpsite; failing closed.",
            getattr(schedule, 'pk', None)
        )
        return []

    waypoints = getattr(schedule, 'waypoints', None) or []
    if not waypoints:
        return []

    from watcher.models import StopValidation, StopValidationStatus
    today = timezone.localdate()

    # Pre-fetch PickupStatus records for schedule
    pickups_by_order = {}
    pickups_duplicate_orders = set()
    for ps in PickupStatus.objects.filter(schedule=schedule):
        if ps.stop_order in pickups_by_order:
            pickups_duplicate_orders.add(ps.stop_order)
        else:
            pickups_by_order[ps.stop_order] = ps

    # Pre-fetch StopValidation records for schedule and today
    validations_by_order = {}
    validations_duplicate_orders = set()
    for sv in StopValidation.objects.filter(schedule=schedule, collection_date=today):
        if sv.stop_order in validations_by_order:
            validations_duplicate_orders.add(sv.stop_order)
        else:
            validations_by_order[sv.stop_order] = sv

    all_schedule_barangays = {b.id: b for b in schedule.barangays.all()}
    single_barangay = list(all_schedule_barangays.values())[0] if len(all_schedule_barangays) == 1 else None
    is_extended = getattr(shift, 'is_extended_mode', False)

    eligible_stops = []
    for idx, wp in enumerate(waypoints):
        if not isinstance(wp, dict):
            continue

        try:
            lat = float(wp['lat'])
            lng = float(wp['lng'])
        except (ValueError, KeyError, TypeError):
            continue  # Invalid coordinates

        # Determine stop_order
        wp_order = wp.get('stop_order')
        if wp_order is not None:
            try:
                order = int(wp_order)
            except (ValueError, TypeError):
                order = idx
        else:
            order = idx

        # Exclude confirmed Dumpsite base marker
        if is_dumpsite_base_marker(wp, dumpsite):
            continue

        # Check for duplicate records (fail closed for this stop)
        if order in pickups_duplicate_orders or order in validations_duplicate_orders:
            logger.warning(
                "resolve_eligible_collection_stops: Duplicate records for schedule pk=%s stop_order=%s; failing closed.",
                schedule.pk, order
            )
            continue

        wp_stop_id = str(wp.get('stop_id') or '').strip()
        ps = pickups_by_order.get(order)
        sv = validations_by_order.get(order)

        # Check for ID conflicts (fail closed for this stop)
        if ps and ps.stop_id and wp_stop_id and str(ps.stop_id).strip() != wp_stop_id:
            logger.warning(
                "resolve_eligible_collection_stops: Conflicting stop_id in PickupStatus for schedule pk=%s stop_order=%s; failing closed.",
                schedule.pk, order
            )
            continue
        if sv and sv.stop_id and wp_stop_id and str(sv.stop_id).strip() != wp_stop_id:
            logger.warning(
                "resolve_eligible_collection_stops: Conflicting stop_id in StopValidation for schedule pk=%s stop_order=%s; failing closed.",
                schedule.pk, order
            )
            continue

        # Resolve barangay
        wp_bid = wp.get('barangay_id')
        resolved_brgy = None
        if wp_bid is not None:
            try:
                resolved_brgy = all_schedule_barangays.get(int(wp_bid))
            except (ValueError, TypeError):
                resolved_brgy = None
            if not resolved_brgy:
                # Invalid barangay ID; fail closed
                continue
        else:
            if single_barangay is not None:
                resolved_brgy = single_barangay
            else:
                # Multi-barangay schedule with missing barangay ID: fail closed!
                continue

        # Exclusion checks based on status
        if ps and ps.status == 'COMPLETED':
            continue
        if sv and sv.current_status in (StopValidationStatus.COLLECTION_REPORTED, StopValidationStatus.VERIFIED_COLLECTED):
            continue
        if sv and sv.current_status == StopValidationStatus.EMPTY_STOP:
            continue

        if not is_extended:
            if ps and ps.status in ('DRIVER_MISSED', 'FAILED'):
                continue
            if sv and sv.current_status == StopValidationStatus.COLLECTION_DISPUTED:
                continue

        label = wp.get('label') or wp.get('name') or wp.get('address') or ''
        eligible_stops.append({
            'stop_order': order,
            'stop_id': wp_stop_id,
            'lat': lat,
            'lng': lng,
            'barangay': resolved_brgy,
            'label': label,
        })

    # Sort deterministically by stop_order ASC
    eligible_stops.sort(key=lambda s: s['stop_order'])
    return eligible_stops


def evaluate_and_dispatch_truck_near(shift, schedule, driver_lat, driver_lng, last_location):
    """
    Evaluates approaching proximity for active collection route and calls notify_truck_near.
    - Preserves deterministic target selection and stop-invariant approach vector.
    - Gated by detection radius (350m), immediate radius (75m), and approach delta (15m).
    """
    eligible_stops = resolve_eligible_collection_stops(shift, schedule)
    if not eligible_stops:
        return

    DETECTION_RADIUS_M = 350.0
    IMMEDIATE_RADIUS_M = 75.0
    APPROACH_DELTA_M = 15.0
    MAX_HISTORY_AGE_S = 180.0

    # Calculate distance from current driver position to each eligible stop
    stops_in_detection_zone = []
    for s in eligible_stops:
        d_curr = haversine(driver_lat, driver_lng, s['lat'], s['lng'])
        if d_curr <= DETECTION_RADIUS_M:
            stops_in_detection_zone.append((d_curr, s))

    if not stops_in_detection_zone:
        return  # No eligible stop within 350m

    # Deterministic priority: lowest stop_order within detection zone
    stops_in_detection_zone.sort(key=lambda item: item[1]['stop_order'])
    d_curr, target_stop = stops_in_detection_zone[0]

    s_lat = target_stop['lat']
    s_lng = target_stop['lng']

    should_dispatch = False

    if not last_location:
        # First ping of shift: permit dispatch only if already at immediate doorstep
        if d_curr <= IMMEDIATE_RADIUS_M:
            should_dispatch = True
    else:
        # Check staleness
        now = timezone.now()
        age_s = (now - last_location.timestamp).total_seconds()
        if age_s > MAX_HISTORY_AGE_S:
            # Stale history: permit only if within immediate radius
            if d_curr <= IMMEDIATE_RADIUS_M:
                should_dispatch = True
        else:
            # Fresh history: calculate approach delta against the SAME target stop
            d_prev = haversine(
                float(last_location.latitude), float(last_location.longitude),
                s_lat, s_lng
            )
            delta_d = d_prev - d_curr  # Positive when closing in

            if d_curr <= IMMEDIATE_RADIUS_M:
                # Doorstep arrival: permit if not rapidly retreating (> 10m away)
                if delta_d >= -10.0:
                    should_dispatch = True
            else:
                # Outer detection zone (75m - 350m): require >= 15m approach
                if delta_d >= APPROACH_DELTA_M:
                    should_dispatch = True

    if should_dispatch:
        from notifications.services import notify_truck_near
        notify_truck_near(
            shift=shift,
            schedule=schedule,
            stop_order=target_stop['stop_order'],
            stop_lat=s_lat,
            stop_lng=s_lng,
            driver_lat=driver_lat,
            driver_lng=driver_lng,
            target_barangay=target_stop['barangay'],
            stop_label=target_stop['label'],
        )


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

        GPS_SHIFT_ACCURACY_THRESHOLD = getattr(settings, 'GPS_SHIFT_ACCURACY_THRESHOLD', 150)
        TRUCK_NEAR_ACCURACY_THRESHOLD = getattr(settings, 'TRUCK_NEAR_ACCURACY_THRESHOLD', 100)

        # ── 1. GPS Shift Accuracy Gate ────────────────────────────────────────
        # Pings with accuracy > 150m must NOT mutate shift coordinates, write TruckLocation,
        # or trigger truck-near notifications.
        if accuracy is not None and accuracy > GPS_SHIFT_ACCURACY_THRESHOLD:
            return Response({'skipped': True, 'reason': 'poor_accuracy', 'accuracy': accuracy}, status=200)

        # ── 2. Retrieve previous observation and check movement ───────────────
        MIN_MOVEMENT_M = 10
        last_location = (
            TruckLocation.objects
            .filter(shift=active_shift)
            .order_by('-timestamp')
            .first()
        )

        _schedule = active_shift.schedule

        # Check if truck is within 75m immediate radius of an eligible target stop
        is_immediate_eligible = False
        if _schedule and active_shift.status == 'shiftroute' and active_shift.op_status == 'on_route':
            eligible_stops = resolve_eligible_collection_stops(active_shift, _schedule)
            for c_stop in eligible_stops:
                if haversine(float(lat), float(lng), c_stop['lat'], c_stop['lng']) <= 75.0:
                    is_immediate_eligible = True
                    break

        if last_location:
            dist_moved = haversine(
                float(last_location.latitude), float(last_location.longitude),
                float(lat), float(lng)
            )
            # Sub-10m skip applies UNLESS truck is at the doorstep of an eligible stop
            if dist_moved < MIN_MOVEMENT_M and not is_immediate_eligible:
                return Response({'skipped': True, 'reason': 'no_movement'}, status=200)

        # ── 3. Update authoritative shift coordinates and persist history ─────
        active_shift.current_latitude = lat
        active_shift.current_longitude = lng
        active_shift.last_location_update = timezone.now()
        active_shift.save(update_fields=[
            'current_latitude', 'current_longitude', 'last_location_update'
        ])

        location = TruckLocation.objects.create(
            driver=driver,
            truck=active_shift.truck,
            shift=active_shift,
            latitude=lat,
            longitude=lng,
            accuracy=accuracy,
        )

        # ── 4. TRUCK_NEAR evaluation ──────────────────────────────────────────
        try:
            if not _schedule:
                logger.warning(
                    "Active shift pk=%s has no assigned schedule; skipping truck-near checks.",
                    active_shift.pk,
                )
            elif active_shift.status != 'shiftroute' or active_shift.op_status != 'on_route':
                pass  # Alert gated on active route collection phase & on_route op_status
            elif not getattr(_schedule, 'is_available', True) or getattr(_schedule, 'status', None) in ('CANCELLED', 'COMPLETED'):
                pass  # Schedule cancelled or unavailable
            elif accuracy is not None and accuracy > TRUCK_NEAR_ACCURACY_THRESHOLD:
                pass  # 101m - 150m: accepted for shift tracking, but too coarse for push alerts
            else:
                evaluate_and_dispatch_truck_near(
                    shift=active_shift,
                    schedule=_schedule,
                    driver_lat=float(lat),
                    driver_lng=float(lng),
                    last_location=last_location,
                )
        except Exception:
            logger.exception("TRUCK_NEAR evaluation failed unexpectedly for shift pk=%s", active_shift.pk)

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
        return [IsAdminRole()]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                instance = serializer.save(created_by=request.user)
            return Response(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)
        except IntegrityError:
            return Response(
                {'error': 'An active TruckCrewAssignment already exists for this truck, date, and schedule.'},
                status=status.HTTP_409_CONFLICT,
            )

    def update(self, request, *args, **kwargs):
        from dumpsite.models import WasteDelivery
        partial = kwargs.pop('partial', False)
        try:
            with transaction.atomic():
                instance = (
                    TruckCrewAssignment.objects.select_for_update(of=('self',))
                    .select_related('truck', 'driver', 'schedule')
                    .filter(pk=kwargs.get('pk'))
                    .first()
                )
                if not instance:
                    self.get_object()

                active_shift_q = Q(is_active=True, truck=instance.truck)
                if instance.schedule_id:
                    active_shift_q &= Q(schedule_id=instance.schedule_id)
                elif instance.driver_id:
                    active_shift_q &= Q(driver_id=instance.driver_id)
                if DriverShift.objects.filter(active_shift_q).exists():
                    return Response(
                        {'error': 'Cannot modify TruckCrewAssignment while a matching DriverShift is active.'},
                        status=status.HTTP_409_CONFLICT,
                    )

                serializer = self.get_serializer(instance, data=request.data, partial=partial)
                serializer.is_valid(raise_exception=True)
                validated = serializer.validated_data
                structural_change = (
                    ('truck' in validated and validated['truck'].id != instance.truck_id)
                    or ('driver' in validated and getattr(validated['driver'], 'id', None) != instance.driver_id)
                    or ('schedule' in validated and getattr(validated['schedule'], 'id', None) != instance.schedule_id)
                    or ('date' in validated and validated['date'] != instance.date)
                    or ('is_active' in validated and instance.is_active and not validated['is_active'])
                )
                if structural_change and WasteDelivery.objects.filter(crew_assignment=instance).exists():
                    return Response(
                        {'error': 'Cannot structurally modify a TruckCrewAssignment referenced by WasteDelivery records.'},
                        status=status.HTTP_409_CONFLICT,
                    )

                updated = serializer.save()
            return Response(self.get_serializer(updated).data, status=status.HTTP_200_OK)
        except IntegrityError:
            return Response(
                {'error': 'An active TruckCrewAssignment already exists for this truck, date, and schedule.'},
                status=status.HTTP_409_CONFLICT,
            )

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        from dumpsite.models import WasteDelivery
        with transaction.atomic():
            instance = (
                TruckCrewAssignment.objects.select_for_update(of=('self',))
                .select_related('truck', 'driver', 'schedule')
                .filter(pk=kwargs.get('pk'))
                .first()
            )
            if not instance:
                self.get_object()

            active_shift_q = Q(is_active=True, truck=instance.truck)
            if instance.schedule_id:
                active_shift_q &= Q(schedule_id=instance.schedule_id)
            elif instance.driver_id:
                active_shift_q &= Q(driver_id=instance.driver_id)
            if DriverShift.objects.filter(active_shift_q).exists():
                return Response(
                    {'error': 'Cannot delete TruckCrewAssignment while a matching DriverShift is active.'},
                    status=status.HTTP_409_CONFLICT,
                )
            if WasteDelivery.objects.filter(crew_assignment=instance).exists():
                return Response(
                    {'error': 'Cannot delete TruckCrewAssignment referenced by historical WasteDelivery records.'},
                    status=status.HTTP_409_CONFLICT,
                )
            instance.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

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
        'preallocated_truck',
        'my_team_roster',
        'my_attendance_history',
        'attendance',
        'attendance_correction',
        'submit_deployment_attendance',
        'correct_deployment_attendance',
        'request_truck_replacement',
        'roster_snapshot',
    })

    def get_permissions(self):
        # Allow public read access to endpoints used by the citizen map
        if self.action in self.PUBLIC_READ_ACTIONS and self.request.method in permissions.SAFE_METHODS:
            return [permissions.AllowAny()]
        user = getattr(self.request, 'user', None)
        if (
            user
            and user.is_authenticated
            and not is_admin_user(user)
            and getattr(user, 'role', None) == UserRole.DUMPSITE
        ):
            if self.action in ('list', 'retrieve', 'my_attendance_history') and self.request.method in permissions.SAFE_METHODS:
                return [permissions.IsAuthenticated()]
            return [IsAdminRole()]
        if self.action in self.ADMIN_ONLY_ACTIONS:
            return [IsAdminRole()]
        if self.action not in self.AUTHENTICATED_ACTIONS:
            if self.request.method == 'OPTIONS':
                return [permissions.IsAuthenticated()]
            return [IsAdminRole()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset().select_related('driver', 'truck', 'schedule', 'allocation', 'allocation__schedule').order_by('-started_at')
        user = getattr(self.request, 'user', None)
        if not user or not user.is_authenticated:
            return qs.none()
        if is_admin_user(user):
            return qs
        if getattr(user, 'role', None) == UserRole.DUMPSITE:
            from .truck_service import TruckService
            fac_id = TruckService.get_operator_dumpsite_id(user)
            if not fac_id:
                return qs.none()
            return qs.filter(
                Q(schedule__dumpsite_id=fac_id) | Q(allocation__schedule__dumpsite_id=fac_id)
            ).distinct()
        if getattr(user, 'role', None) == UserRole.WATCHER:
            candidate_qs = qs.filter(
                Q(crew_shift__watcher_shift__watcher=user)
                | Q(crew_shift__team_leader=user)
                | Q(
                    schedule__default_team__memberships__worker__user=user,
                    schedule__default_team__memberships__role_in_team='leader',
                    schedule__default_team__memberships__is_active=True,
                )
                | Q(
                    schedule__team_overrides__team__memberships__worker__user=user,
                    schedule__team_overrides__team__memberships__role_in_team='leader',
                    schedule__team_overrides__team__memberships__is_active=True,
                )
                | Q(
                    allocation__team__memberships__worker__user=user,
                    allocation__team__memberships__role_in_team='leader',
                    allocation__team__memberships__is_active=True,
                )
            ).select_related('allocation', 'schedule', 'crew_shift', 'crew_shift__watcher_shift').distinct()

            from .team_service import resolve_deployment_team_leader
            allowed_ids = []
            for s in candidate_qs:
                cs = getattr(s, 'crew_shift', None)
                if cs and (cs.team_leader_id == user.id or (cs.watcher_shift_id and cs.watcher_shift.watcher_id == user.id)):
                    allowed_ids.append(s.id)
                    continue
                if s.schedule_id:
                    svc_date = (
                        s.allocation.allocation_date
                        if s.allocation_id and s.allocation
                        else (timezone.localdate(s.started_at) if s.started_at else timezone.localdate())
                    )
                    try:
                        resolved = resolve_deployment_team_leader(s.schedule, svc_date)
                        if resolved.leadership_mode == 'watcher' and resolved.user.id == user.id:
                            allowed_ids.append(s.id)
                    except DjangoValidationError:
                        continue
            return qs.filter(id__in=allowed_ids)
        return qs.filter(driver=user)

    @action(detail=False, methods=['post'], url_path='dev-reset', permission_classes=[IsAdminRole])
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
                shift = DriverShift.objects.select_for_update(of=('self',)).select_related('driver', 'schedule').filter(
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
                shift = DriverShift.objects.select_for_update(of=('self',)).select_related('driver', 'schedule').filter(
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
                ).exclude(
                    Q(roster_snapshots__isnull=False)
                    | Q(attendance_records__isnull=False)
                    | Q(crew_shift__attendance_records__isnull=False)
                    | Q(crew_shift__roster_snapshots__isnull=False)
                ).delete()

        return Response({'status': 'reset', 'shift_id': shift.id if shift else None, 'phase': target_phase})

    @action(detail=False, methods=['get'], url_path='current')
    def current(self, request):
        from datetime import timedelta
        from django.db.models import Q
        from django.conf import settings
        now = timezone.now()
        staleness_cutoff = now - timedelta(hours=getattr(settings, 'SHIFT_STALE_HOURS', 6))

        # Auto-close any shifts abandoned for more than SHIFT_STALE_HOURS via coordinated lifecycle service
        _sweep_stale_shifts_for(driver=request.user)

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

            if truck is not None:
                _sweep_stale_shifts_for(truck=truck)

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
                    Q(truck=truck) | Q(allocation__truck=truck),
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
            elif not schedule.dumpsite_id:
                can_start_shift = False
                block_reason = 'missing_dumpsite'
                block_message = f"Schedule #{schedule.id} has no assigned dumpsite facility."
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

            resolved_allocation = None
            if schedule and scheduled_today:
                from .allocation_service import AllocationService
                try:
                    resolved_allocation = AllocationService.get_preallocated_truck_for_driver(
                        request.user, target_date=today, schedule_id=schedule.id
                    )
                except DjangoValidationError:
                    resolved_allocation = None

            return Response({
                'active_shift': None,
                'schedule_id': schedule.id if schedule else None,
                'allocation': ScheduleTruckAllocationSerializer(resolved_allocation).data if resolved_allocation else None,
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
        with transaction.atomic():
            shift = self.get_object()
            shift = (
                DriverShift.objects.select_for_update(of=('self',))
                .filter(pk=shift.pk)
                .first()
            )
            if not shift:
                return Response({'error': 'Shift not found.'}, status=status.HTTP_404_NOT_FOUND)
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
                DriverShift.objects.select_for_update(of=('self',))
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

    @action(detail=True, methods=['post'], url_path='force-end', permission_classes=[IsAdminRole])
    def force_end(self, request, pk=None):
        if not is_admin_user(request.user):
            return Response({'error': 'Only admins can force-end shifts.'}, status=status.HTTP_403_FORBIDDEN)

        shift = self.get_object()
        if not shift.is_active:
            return Response({'error': 'Shift is already inactive.'}, status=status.HTTP_400_BAD_REQUEST)

        from .shift_service import ShiftService
        ShiftService.conclude_shift_atomic(
            driver_shift_id=shift.id,
            concluded_by=request.user,
            end_reason='admin_force_ended',
        )

        return Response({'status': 'force_ended', 'shift_id': shift.id})

    @action(detail=True, methods=['get', 'post'], url_path='attendance')
    def attendance(self, request, pk=None):
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .serializers import CrewAttendanceRecordSerializer
        from .shift_service import ShiftService
        from .team_service import ActiveShiftConflictError
        shift = self.get_object()
        if request.method == 'GET':
            effective = ShiftService.get_effective_shift_attendance(shift.id)
            return Response(effective, status=status.HTTP_200_OK)

        attendance_list = request.data.get('attendance', [])
        if not attendance_list:
            return Response({'error': 'attendance list cannot be empty.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            records = ShiftService.record_initial_attendance(shift.id, attendance_list, request.user)
            from .serializers import CrewAttendanceRecordSerializer
            return Response(CrewAttendanceRecordSerializer(records, many=True).data, status=status.HTTP_201_CREATED)
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except DjangoValidationError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=['post'], url_path='attendance-correction')
    def attendance_correction(self, request, pk=None):
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .serializers import CrewAttendanceRecordSerializer
        from .shift_service import ShiftService
        from .serializers import CrewAttendanceCorrectionSerializer
        shift = self.get_object()
        record_id = request.data.get('record_id')
        corrected_status = request.data.get('corrected_status')
        reason = request.data.get('reason', '')
        if not record_id or not corrected_status or not reason:
            return Response({'error': 'record_id, corrected_status, and reason are required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            correction = ShiftService.correct_attendance(
                attendance_record_id=int(record_id),
                corrected_status=corrected_status,
                reason=reason,
                corrected_by=request.user,
                driver_shift_id=shift.id,
            )
            return Response(CrewAttendanceCorrectionSerializer(correction).data, status=status.HTTP_201_CREATED)
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=['get'], url_path='roster-snapshot')
    def roster_snapshot(self, request, pk=None):
        shift = self.get_object()
        snapshot = (
            ShiftCrewRosterSnapshot.objects.filter(
                Q(driver_shift=shift) | Q(crew_shift__driver_shift=shift)
            )
            .order_by('-snapshot_timestamp', '-id')
            .first()
        )
        if not snapshot:
            return Response(None, status=status.HTTP_200_OK)
        from .serializers import ShiftCrewRosterSnapshotSerializer
        return Response(ShiftCrewRosterSnapshotSerializer(snapshot).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='preallocated-truck')
    def preallocated_truck(self, request):
        driver = request.user
        from .allocation_service import AllocationService
        from .serializers import ScheduleTruckAllocationSerializer
        schedule_id_raw = request.query_params.get('schedule_id')
        schedule_id = None
        if schedule_id_raw is not None and str(schedule_id_raw).strip() != '':
            try:
                schedule_id = int(schedule_id_raw)
            except (TypeError, ValueError):
                return Response({'error': 'Invalid schedule_id parameter.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            alloc = AllocationService.get_preallocated_truck_for_driver(driver, schedule_id=schedule_id)
        except DjangoValidationError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not alloc:
            return Response({'has_allocation': False, 'allocation': None}, status=status.HTTP_200_OK)
        return Response({
            'has_allocation': True,
            'allocation': ScheduleTruckAllocationSerializer(alloc).data
        }, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='my_team_roster')
    def my_team_roster(self, request):
        user = request.user
        today = timezone.localdate()
        date_raw = request.query_params.get('date')
        service_date = today
        if date_raw:
            parsed_d = parse_date(str(date_raw))
            if not parsed_d:
                return Response({'error': 'Invalid date parameter. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
            service_date = parsed_d

        requested_schedule_id_raw = request.query_params.get('schedule_id')
        parsed_schedule_id = None
        if requested_schedule_id_raw is not None:
            raw_str = str(requested_schedule_id_raw).strip()
            if not raw_str:
                return Response({'error': 'Invalid schedule_id parameter.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                parsed_schedule_id = int(raw_str)
            except (TypeError, ValueError):
                return Response({'error': 'Invalid schedule_id parameter.'}, status=status.HTTP_400_BAD_REQUEST)
            if parsed_schedule_id <= 0:
                return Response({'error': 'Invalid schedule_id parameter.'}, status=status.HTTP_400_BAD_REQUEST)

        from .allocation_service import AllocationService
        from .shift_service import ShiftService

        active_shift = (
            DriverShift.objects.filter(driver=user, is_active=True)
            .select_related(
                'allocation__team',
                'crew_shift__team',
                'crew_shift__attendance_submitted_by',
                'crew_shift__team_leader',
                'schedule',
            )
            .first()
        )
        matching_active_shift = (
            active_shift
            if (active_shift and (parsed_schedule_id is None or active_shift.schedule_id == parsed_schedule_id))
            else None
        )

        def _empty_roster_response(shift_obj=None):
            return Response({
                'has_team': False,
                'team': None,
                'team_leader': None,
                'leader_type': None,
                'deployment_leader': None,
                'is_driver_team_leader': False,
                'has_watcher_assigned': False,
                'is_watcher_led': False,
                'can_submit_attendance': False,
                'driver_shift_id': shift_obj.id if shift_obj else None,
                'crew_shift_id': None,
                'crew_members': [],
                'members': [],
                'attendance': [],
                'attendance_records': [],
                'attendance_submitted': False,
                'submitted_by': None,
                'submitted_at': None,
            }, status=status.HTTP_200_OK)

        effective_team = None
        prealloc = None
        if parsed_schedule_id is not None:
            # Schedule-scoped path: resolve strictly from matching active shift, preallocation, or resolve_schedule_team
            if matching_active_shift:
                prealloc = matching_active_shift.allocation
                crew_shift_from_active = getattr(matching_active_shift, 'crew_shift', None)
                if crew_shift_from_active and crew_shift_from_active.team_id and crew_shift_from_active.team.is_active:
                    effective_team = crew_shift_from_active.team
                elif matching_active_shift.allocation_id and matching_active_shift.allocation.team_id and matching_active_shift.allocation.team.is_active:
                    effective_team = matching_active_shift.allocation.team

            if prealloc is None:
                try:
                    prealloc = AllocationService.get_preallocated_truck_for_driver(
                        user, target_date=service_date, schedule_id=parsed_schedule_id
                    )
                    if not effective_team and prealloc and prealloc.team_id and prealloc.team.is_active:
                        effective_team = prealloc.team
                except DjangoValidationError:
                    prealloc = None

            if not effective_team:
                try:
                    effective_team = AllocationService.resolve_schedule_team(parsed_schedule_id, target_date=service_date)
                except (DjangoValidationError, TypeError, ValueError):
                    effective_team = None

            if not effective_team or not effective_team.is_active:
                return _empty_roster_response(matching_active_shift)
        else:
            # Unscoped path: only permitted when schedule_id is omitted
            if matching_active_shift:
                prealloc = matching_active_shift.allocation
                crew_shift_from_active = getattr(matching_active_shift, 'crew_shift', None)
                if crew_shift_from_active and crew_shift_from_active.team_id and crew_shift_from_active.team.is_active:
                    effective_team = crew_shift_from_active.team
                elif matching_active_shift.allocation_id and matching_active_shift.allocation.team_id and matching_active_shift.allocation.team.is_active:
                    effective_team = matching_active_shift.allocation.team

            if prealloc is None:
                try:
                    prealloc = AllocationService.get_preallocated_truck_for_driver(
                        user, target_date=service_date, schedule_id=None
                    )
                    if not effective_team and prealloc and prealloc.team_id and prealloc.team.is_active:
                        effective_team = prealloc.team
                except DjangoValidationError:
                    prealloc = None

            if not effective_team:
                personal_memberships = list(
                    SanitationTeamMembership.objects.filter(
                        worker__user=user,
                        worker__is_active=True,
                        is_active=True,
                        team__is_active=True,
                    ).select_related('team').order_by('id')
                )
                if len(personal_memberships) == 1:
                    effective_team = personal_memberships[0].team

            if not effective_team or not effective_team.is_active:
                return _empty_roster_response(matching_active_shift)

        memberships = list(
            SanitationTeamMembership.objects.filter(team=effective_team, is_active=True)
            .select_related('worker__user')
            .order_by('role_in_team', 'worker__full_name')
        )

        target_schedule_id = None
        if parsed_schedule_id is not None:
            target_schedule_id = parsed_schedule_id
        elif matching_active_shift and matching_active_shift.schedule_id:
            target_schedule_id = matching_active_shift.schedule_id
        elif prealloc and prealloc.schedule_id:
            target_schedule_id = prealloc.schedule_id

        resolved_leader_result = None
        if target_schedule_id:
            try:
                from .team_service import resolve_deployment_team_leader
                resolved_leader_result = resolve_deployment_team_leader(target_schedule_id, service_date=service_date)
            except (DjangoValidationError, TypeError, ValueError):
                resolved_leader_result = None
            if resolved_leader_result and resolved_leader_result.team.id != effective_team.id:
                resolved_leader_result = None

        if parsed_schedule_id is not None:
            is_team_member = any(
                m.worker.is_active and m.worker.user_id == user.id
                for m in memberships
            )
            is_resolved_leader = bool(
                resolved_leader_result
                and resolved_leader_result.user
                and resolved_leader_result.user.id == user.id
            )
            if not (is_team_member or is_resolved_leader or is_admin_user(user)):
                return _empty_roster_response()

        crew_shift = getattr(matching_active_shift, 'crew_shift', None) if matching_active_shift else None
        if crew_shift is None and prealloc is not None:
            crew_shift = (
                CrewShift.objects.filter(allocation=prealloc)
                .select_related('attendance_submitted_by', 'team_leader', 'watcher_shift')
                .first()
            )

        if resolved_leader_result:
            leader_user = resolved_leader_result.user
            leader_worker = resolved_leader_result.worker
            leader_role = resolved_leader_result.leadership_mode
            has_watcher_assigned = bool(
                resolved_leader_result.has_watcher_assigned
                or (crew_shift and crew_shift.watcher_shift_id is not None)
            )
            is_driver_team_leader = bool(
                resolved_leader_result.is_driver_team_leader
                and leader_user
                and leader_user.id == user.id
            )
            can_submit_attendance = bool(is_driver_team_leader and not has_watcher_assigned)
        elif target_schedule_id is not None:
            # Schedule-specific leader resolution failed: do not silently substitute a different leader
            leader_worker = None
            leader_user = None
            leader_role = None
            has_watcher_assigned = bool(crew_shift and crew_shift.watcher_shift_id is not None)
            is_driver_team_leader = False
            can_submit_attendance = False
        else:
            leader_candidates = [
                m for m in memberships
                if m.role_in_team == 'leader'
                and m.worker.is_active
                and m.worker.user_id
                and getattr(m.worker.user, 'is_active', True)
                and getattr(m.worker.user, 'role', None) in ('watcher', 'driver')
            ]
            leader_membership = leader_candidates[0] if len(leader_candidates) == 1 else None
            leader_worker = leader_membership.worker if leader_membership else None
            leader_user = leader_worker.user if (leader_worker and leader_worker.user_id) else None
            leader_role = getattr(leader_user, 'role', None) if leader_user else None

            has_watcher_assigned = bool(
                (crew_shift and crew_shift.watcher_shift_id is not None)
                or leader_role == 'watcher'
            )
            is_driver_team_leader = bool(
                leader_user
                and leader_user.id == user.id
                and getattr(user, 'role', '') == 'driver'
            )
            can_submit_attendance = bool(is_driver_team_leader and not has_watcher_assigned)

        crew_members = [
            {
                'worker_id': m.worker_id,
                'full_name': m.worker.full_name,
                'employee_id': m.worker.employee_id,
                'role_in_team': m.role_in_team,
            }
            for m in memberships
            if m.role_in_team == 'crew'
            and m.worker.is_active
            and (not m.worker.user_id or getattr(m.worker.user, 'is_active', False))
            and (not m.worker.user_id or m.worker.user_id != user.id)
            and (not leader_worker or m.worker_id != leader_worker.id)
        ]

        attendance_data = ShiftService.get_effective_shift_attendance(
            driver_shift_id=matching_active_shift.id if matching_active_shift else None,
            crew_shift_id=crew_shift.id if crew_shift else None,
        )

        if getattr(user, 'role', '') == 'citizen' and not is_admin_user(user):
            caller_worker = Worker.objects.filter(user=user).only('id').first()
            caller_worker_id = caller_worker.id if caller_worker else None
            attendance_data = [
                rec for rec in attendance_data
                if caller_worker_id is not None and rec.get('worker_id') == caller_worker_id
            ]
            crew_members = []

        submitted_by = None
        if crew_shift and crew_shift.attendance_submitted_by_id:
            sub_u = crew_shift.attendance_submitted_by
            submitted_by = {
                'id': sub_u.id,
                'username': sub_u.username,
                'full_name': (getattr(sub_u, 'full_name', '') or '').strip() or sub_u.username,
            }

        resp_data = {
            'has_team': True,
            'team': {
                'id': effective_team.id,
                'name': effective_team.name,
                'code': effective_team.code,
            },
            'team_leader': {
                'user_id': leader_user.id if leader_user else None,
                'username': leader_user.username if leader_user else None,
                'full_name': leader_worker.full_name if leader_worker else None,
                'role': leader_role,
            } if leader_worker else None,
            'leader_type': leader_role,
            'deployment_leader': resolved_leader_result.to_dict() if resolved_leader_result else None,
            'is_driver_team_leader': is_driver_team_leader,
            'has_watcher_assigned': has_watcher_assigned,
            'is_watcher_led': has_watcher_assigned,
            'can_submit_attendance': can_submit_attendance,
            'driver_shift_id': matching_active_shift.id if matching_active_shift else None,
            'crew_shift_id': crew_shift.id if crew_shift else None,
            'allocation_id': prealloc.id if prealloc else None,
            'schedule_id': target_schedule_id,
            'crew_members': crew_members,
            'members': crew_members,
            'attendance': attendance_data,
            'attendance_records': attendance_data,
            'attendance_submitted': len(attendance_data) > 0,
            'submitted_by': submitted_by,
            'submitted_at': crew_shift.attendance_submitted_at if crew_shift else None,
        }
        return Response(resp_data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='my-attendance-history')
    def my_attendance_history(self, request):
        """
        GET /api/driver/shift/my-attendance-history/
        Stage 5B read-only personal attendance and shift history scoped strictly to request.user.
        Rejects or ignores any client attempt to inspect another user's private history.
        """
        from .shift_service import ShiftService

        requested_user_id = request.query_params.get('user_id')
        requested_worker_id = request.query_params.get('worker_id')
        if requested_user_id is not None and str(requested_user_id).strip() != str(request.user.id):
            return Response(
                {'error': "You cannot view another user's private attendance history."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if requested_worker_id is not None:
            own_worker = Worker.objects.filter(user=request.user).only('id').first()
            if not own_worker or str(requested_worker_id).strip() != str(own_worker.id):
                return Response(
                    {'error': "You cannot view another worker's private attendance history."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        payload = ShiftService.get_personal_attendance_history(request.user)
        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='submit-deployment-attendance')
    def submit_deployment_attendance(self, request):
        """
        POST /api/driver/shift/submit-deployment-attendance/
        Pre-departure or staged Driver-led initial attendance submission.
        """
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .allocation_service import AllocationService
        from .serializers import CrewAttendanceRecordSerializer
        from .shift_service import ShiftService

        user = request.user
        today = timezone.localdate()
        date_raw = request.data.get('service_date')
        service_date = today
        if date_raw:
            parsed_d = parse_date(str(date_raw))
            if not parsed_d:
                return Response({'error': 'Invalid service_date format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
            service_date = parsed_d

        attendance_list = request.data.get('attendance')
        if attendance_list is None:
            attendance_list = request.data.get('records', [])

        schedule_id = request.data.get('schedule_id')
        allocation_id = request.data.get('allocation_id')

        active_shift = DriverShift.objects.filter(driver=user, is_active=True).select_related('allocation').first()
        if active_shift:
            if not schedule_id:
                schedule_id = active_shift.schedule_id
            if allocation_id is None:
                allocation_id = active_shift.allocation_id

        if not schedule_id and allocation_id is not None:
            alloc_obj = ScheduleTruckAllocation.objects.filter(id=allocation_id).first()
            if not alloc_obj:
                return Response({'error': f'Allocation #{allocation_id} not found.'}, status=status.HTTP_400_BAD_REQUEST)
            schedule_id = alloc_obj.schedule_id

        if not schedule_id:
            try:
                prealloc = AllocationService.get_preallocated_truck_for_driver(
                    user, target_date=service_date, schedule_id=None
                )
            except DjangoValidationError as e:
                return Response(e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
            if prealloc:
                schedule_id = prealloc.schedule_id
                allocation_id = prealloc.id

        if not schedule_id:
            return Response(
                {'error': 'schedule_id or an active allocation is required.', 'code': 'no_schedule_today'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            records, crew_shift = ShiftService.record_deployment_attendance(
                schedule_id=int(schedule_id),
                service_date=service_date,
                attendance_list=attendance_list,
                recorded_by=user,
                require_leadership_mode='driver',
                driver_shift_id=active_shift.id if active_shift else None,
                allocation_id=int(allocation_id) if allocation_id is not None else None,
            )
            effective = ShiftService.get_effective_shift_attendance(
                driver_shift_id=active_shift.id if active_shift else None,
                crew_shift_id=crew_shift.id if crew_shift else None,
            )
            return Response(
                {
                    'crew_shift_id': crew_shift.id if crew_shift else None,
                    'driver_shift_id': active_shift.id if active_shift else None,
                    'attendance_submitted': True,
                    'records': CrewAttendanceRecordSerializer(records, many=True).data,
                    'attendance': effective,
                },
                status=status.HTTP_201_CREATED,
            )
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='correct-deployment-attendance')
    def correct_deployment_attendance(self, request):
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .serializers import CrewAttendanceCorrectionSerializer
        from .shift_service import ShiftService

        record_id = request.data.get('record_id') or request.data.get('attendance_record_id')
        corrected_status = request.data.get('corrected_status') or request.data.get('new_status')
        reason = request.data.get('reason', '')
        if not record_id or not corrected_status or not str(reason).strip():
            return Response(
                {'error': 'record_id, corrected_status, and reason are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            correction = ShiftService.correct_attendance(
                attendance_record_id=int(record_id),
                corrected_status=corrected_status,
                reason=reason,
                corrected_by=request.user,
            )
            return Response(CrewAttendanceCorrectionSerializer(correction).data, status=status.HTTP_201_CREATED)
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='request-truck-replacement')
    def request_truck_replacement(self, request):
        """
        POST /api/driver/shift/request-truck-replacement/
        Allows Driver to submit a TruckReplacementRequest; resolves truck strictly server-side
        from the active DriverShift or authorized today's ScheduleTruckAllocation (never trusting client truck_id).
        """
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .allocation_service import AllocationService
        from .truck_service import TruckLifecycleConflictError, TruckService

        user = request.user
        driver_shift_id = request.data.get('driver_shift_id')
        schedule_id = request.data.get('schedule_id')
        reason = request.data.get('reason', '')

        resolved_schedule_id = None
        if schedule_id is not None and str(schedule_id).strip() != '':
            try:
                resolved_schedule_id = int(schedule_id)
            except (TypeError, ValueError):
                return Response({'schedule_id': 'Invalid schedule_id.'}, status=status.HTTP_400_BAD_REQUEST)
            if resolved_schedule_id <= 0:
                return Response({'schedule_id': 'schedule_id must be a positive integer.'}, status=status.HTTP_400_BAD_REQUEST)

        shift = None
        if driver_shift_id is not None and str(driver_shift_id).strip() != '':
            try:
                shift_id_int = int(driver_shift_id)
            except (TypeError, ValueError):
                return Response({'driver_shift_id': 'Invalid driver_shift_id.'}, status=status.HTTP_400_BAD_REQUEST)
            if shift_id_int <= 0:
                return Response({'driver_shift_id': 'driver_shift_id must be a positive integer.'}, status=status.HTTP_400_BAD_REQUEST)
            shift = DriverShift.objects.select_related('truck', 'allocation__truck', 'schedule').filter(
                id=shift_id_int
            ).first()
            if not shift:
                return Response({'error': f'Shift #{shift_id_int} not found.'}, status=status.HTTP_404_NOT_FOUND)
            if not is_admin_user(user) and shift.driver_id != user.id:
                return Response({'error': 'You may only request replacement for your own shift.'}, status=status.HTTP_403_FORBIDDEN)
            if not shift.is_active:
                return Response(
                    {'error': 'Cannot request truck replacement for an ended shift.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            shift = DriverShift.objects.select_related('truck', 'allocation__truck', 'schedule').filter(
                driver=user, is_active=True
            ).first()

        truck = None
        if shift is not None:
            truck = shift.effective_truck
            if resolved_schedule_id is None:
                resolved_schedule_id = shift.schedule_id or (shift.allocation.schedule_id if shift.allocation_id else None)
        else:
            try:
                alloc = AllocationService.get_preallocated_truck_for_driver(
                    user, target_date=timezone.localdate(), schedule_id=resolved_schedule_id
                )
            except DjangoValidationError as e:
                return Response(e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
            if alloc:
                truck = alloc.truck
                if resolved_schedule_id is None:
                    resolved_schedule_id = alloc.schedule_id

        if truck is None:
            return Response(
                {'error': 'No active shift or authorized truck allocation found for truck replacement request.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            res = TruckService.request_truck_replacement(
                truck,
                user=user,
                schedule_id=resolved_schedule_id,
                driver_shift=shift,
                reason=reason,
            )
            return Response(res, status=status.HTTP_201_CREATED)
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response(
                {'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code},
                status=status.HTTP_409_CONFLICT,
            )
        except DjangoValidationError as e:
            return Response(e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

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
        allocation_id = request.data.get('allocation_id')
        manifested_worker_ids = request.data.get('manifested_worker_ids')
        attendance_payload = request.data.get('attendance')
        today = timezone.localdate()

        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .serializers import CrewAttendanceRecordSerializer
        from .shift_service import ShiftService
        from .team_service import ActiveShiftConflictError
        from .allocation_service import AllocationService

        req_sched_int = None
        if requested_schedule_id is not None and str(requested_schedule_id).strip() != '':
            try:
                req_sched_int = int(requested_schedule_id)
            except (TypeError, ValueError):
                return Response({'schedule_id': 'Invalid schedule_id.'}, status=status.HTTP_400_BAD_REQUEST)
            if req_sched_int <= 0:
                return Response({'schedule_id': 'schedule_id must be a positive integer.'}, status=status.HTTP_400_BAD_REQUEST)

        alloc_id_int = None
        if allocation_id is not None and str(allocation_id).strip() != '':
            try:
                alloc_id_int = int(allocation_id)
            except (TypeError, ValueError):
                return Response({'allocation_id': 'Invalid allocation_id.'}, status=status.HTTP_400_BAD_REQUEST)
            if alloc_id_int <= 0:
                return Response({'allocation_id': 'allocation_id must be a positive integer.'}, status=status.HTTP_400_BAD_REQUEST)

        target_schedule_id = req_sched_int
        pre_target_truck = None
        if alloc_id_int is not None:
            alloc_obj = ScheduleTruckAllocation.objects.select_related('truck').filter(id=alloc_id_int).first()
            if not alloc_obj:
                return Response({'error': f'Allocation #{alloc_id_int} not found.'}, status=status.HTTP_400_BAD_REQUEST)
            if not target_schedule_id:
                target_schedule_id = alloc_obj.schedule_id
            pre_target_truck = alloc_obj.truck
        else:
            try:
                prealloc_for_sweep = AllocationService.get_preallocated_truck_for_driver(
                    driver, target_date=today, schedule_id=target_schedule_id
                )
                if prealloc_for_sweep and prealloc_for_sweep.truck_id:
                    pre_target_truck = prealloc_for_sweep.truck
            except DjangoValidationError:
                pre_target_truck = None

        _sweep_stale_shifts_for(driver=driver, truck=pre_target_truck)

        class _ConcurrentShiftScheduleChange(Exception):
            pass

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                observed_shift = DriverShift.objects.filter(driver=driver, is_active=True).values('id', 'schedule_id').first()
                resolved_target_sched = target_schedule_id
                resolved_alloc_id = alloc_id_int
                if observed_shift is None and resolved_target_sched is None:
                    try:
                        prealloc = AllocationService.get_preallocated_truck_for_driver(driver, target_date=today)
                    except DjangoValidationError as e:
                        return Response(
                            e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if prealloc:
                        resolved_alloc_id = prealloc.id
                        resolved_target_sched = prealloc.schedule_id

                schedule_ids_to_lock = sorted({
                    sid for sid in (
                        observed_shift['schedule_id'] if observed_shift else None,
                        resolved_target_sched,
                    ) if sid
                })

                existing_shift_id = None
                existing_payload = None
                with transaction.atomic():
                    locked_schedules = {}
                    if schedule_ids_to_lock:
                        locked_schedules = {
                            s.id: s
                            for s in CollectionSchedule.objects.filter(id__in=schedule_ids_to_lock).order_by('id').select_for_update()
                        }

                    shift = (
                        DriverShift.objects.select_for_update(of=('self',))
                        .select_related('schedule', 'allocation', 'truck')
                        .filter(driver=driver, is_active=True)
                        .first()
                    )

                    if (
                        (observed_shift is None and shift is not None)
                        or (observed_shift is not None and shift is None)
                        or (shift is not None and shift.schedule_id and shift.schedule_id not in locked_schedules)
                    ):
                        raise _ConcurrentShiftScheduleChange()

                    if shift:
                        if req_sched_int is not None and shift.schedule_id != req_sched_int:
                            return Response({
                                'error': (
                                    'You already have an active shift on a different route.'
                                    if shift.schedule_id
                                    else 'Active shift has no matching schedule.'
                                ),
                                'active_schedule_id': shift.schedule_id,
                                'active_shift_id': shift.id,
                            }, status=status.HTTP_409_CONFLICT)

                        if alloc_id_int is not None and shift.allocation_id != alloc_id_int:
                            return Response({
                                'error': 'allocation_id does not match your currently active shift.',
                                'active_allocation_id': shift.allocation_id,
                                'active_shift_id': shift.id,
                            }, status=status.HTTP_409_CONFLICT)

                        eff_truck = shift.effective_truck
                        if eff_truck and not is_truck_dispatchable(eff_truck):
                            return Response(
                                {'truck': f"Truck {eff_truck.plate_number} is not dispatchable."},
                                status=status.HTTP_400_BAD_REQUEST,
                            )

                        if shift.schedule:
                            if shift.schedule.status in ('CANCELLED', 'COMPLETED') or not shift.schedule.is_available:
                                return Response(
                                    {'schedule_id': f"Schedule #{shift.schedule.id} is not active or available for dispatch."},
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            if not shift.schedule.dumpsite_id:
                                return Response(
                                    {
                                        'error': f"Schedule #{shift.schedule.id} has no assigned dumpsite facility.",
                                        'code': 'missing_dumpsite',
                                    },
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            if shift.allocation_id and shift.allocation:
                                try:
                                    resolved_team = AllocationService.resolve_schedule_team(
                                        shift.schedule_id, shift.allocation.allocation_date
                                    )
                                except DjangoValidationError as e:
                                    return Response(
                                        e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                                        status=status.HTTP_400_BAD_REQUEST,
                                    )
                                if resolved_team.id != shift.allocation.team_id:
                                    return Response(
                                        {'allocation_id': 'Active shift allocation team no longer matches the resolved schedule team.'},
                                        status=status.HTTP_409_CONFLICT,
                                    )

                        existing_payload = DriverShiftSerializer(shift).data
                        if attendance_payload is None:
                            return Response(existing_payload, status=status.HTTP_200_OK)
                        existing_shift_id = shift.id

                    if existing_shift_id is None:
                        if not resolved_target_sched:
                            return Response(
                                {
                                    'error': 'You have no pre-allocated collection duty for today.',
                                    'code': 'no_schedule_today',
                                },
                                status=status.HTTP_400_BAD_REQUEST,
                            )

                        schedule = locked_schedules.get(resolved_target_sched)
                        if not schedule:
                            return Response({'error': 'The requested route was not found.'}, status=status.HTTP_404_NOT_FOUND)

                        if schedule.status in ('CANCELLED', 'COMPLETED') or not schedule.is_available:
                            return Response(
                                {'schedule_id': f"Schedule #{schedule.id} is not active or available for dispatch."},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                        if not schedule.dumpsite_id:
                            return Response(
                                {
                                    'error': f"Schedule #{schedule.id} has no assigned dumpsite facility.",
                                    'code': 'missing_dumpsite',
                                },
                                status=status.HTTP_400_BAD_REQUEST,
                            )

                        has_alloc_today = ScheduleTruckAllocation.objects.filter(
                            schedule=schedule, allocation_date=today
                        ).exists()
                        if not has_alloc_today and not _is_driver_schedule_for_date(schedule, today):
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

                        ended_schedule_shift = _get_ended_shift_for_schedule_today(
                            schedule=schedule,
                            truck=schedule.truck,
                            driver=driver,
                            today=today,
                        )
                        if ended_schedule_shift:
                            return Response(
                                {
                                    'error': "Today's collection shift has already ended.",
                                    'code': 'shift_already_ended',
                                },
                                status=status.HTTP_400_BAD_REQUEST,
                            )

                        try:
                            shift = ShiftService.stage_and_start_shift(
                                driver_user=driver,
                                schedule_id=schedule.id,
                                allocation_id=resolved_alloc_id,
                                manifested_worker_ids=manifested_worker_ids,
                                duty_type=duty_type,
                                initial_status='navigate_to_base',
                                initial_op_status='heading_to_start',
                            )
                            payload = DriverShiftSerializer(shift).data
                            if attendance_payload is not None:
                                records = ShiftService.record_initial_attendance(
                                    shift.id, attendance_payload, recorded_by=driver
                                )
                                payload['attendance'] = CrewAttendanceRecordSerializer(records, many=True).data
                                payload['attendance_submitted'] = True
                            return Response(payload, status=status.HTTP_201_CREATED)
                        except DjangoPermissionDenied as e:
                            transaction.set_rollback(True)
                            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
                        except ActiveShiftConflictError as e:
                            transaction.set_rollback(True)
                            return Response(
                                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                                status=status.HTTP_409_CONFLICT,
                            )
                        except (DjangoValidationError, ValueError) as e:
                            transaction.set_rollback(True)
                            return Response(
                                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                                status=status.HTTP_400_BAD_REQUEST,
                            )

                if existing_shift_id is not None:
                    # Execute outside the DriverShift-locked atomic block so record_deployment_attendance
                    # acquires locks strictly in canonical order (1 -> 2 -> 4 -> 6 -> 7 -> 8 -> 9 -> 10).
                    try:
                        records = ShiftService.record_initial_attendance(
                            existing_shift_id, attendance_payload, recorded_by=driver
                        )
                        existing_payload['attendance'] = CrewAttendanceRecordSerializer(records, many=True).data
                        existing_payload['attendance_submitted'] = True
                        return Response(existing_payload, status=status.HTTP_200_OK)
                    except DjangoPermissionDenied as e:
                        return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
                    except ActiveShiftConflictError as e:
                        return Response(
                            e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                            status=status.HTTP_409_CONFLICT,
                        )
                    except (DjangoValidationError, ValueError) as e:
                        return Response(
                            e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
            except _ConcurrentShiftScheduleChange:
                if attempt == max_attempts - 1:
                    return Response(
                        {'error': 'Active shift state changed concurrently; please retry.'},
                        status=status.HTTP_409_CONFLICT,
                    )
            except IntegrityError:
                return Response(
                    {'error': 'Driver or truck already has an active shift (concurrent start conflict).'},
                    status=status.HTTP_409_CONFLICT,
                )

    @action(detail=False, methods=['get'], url_path='active')
    def active(self, request):
        """
        THE canonical 'is this driver on shift right now' check.
        GET /api/driver/shift/active/

        Response:
          { "active": false, "shift": null }
          { "active": true,  "shift": { ...DriverShiftSerializer... } }
        """
        # Auto-close any shifts abandoned for more than SHIFT_STALE_HOURS via coordinated lifecycle service
        _sweep_stale_shifts_for(driver=request.user)

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
        allocation_id = request.data.get('allocation_id')
        manifested_worker_ids = request.data.get('manifested_worker_ids')

        today = timezone.localdate()
        from django.conf import settings as django_settings
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .serializers import CrewAttendanceRecordSerializer
        from .shift_service import ShiftService
        from .team_service import ActiveShiftConflictError
        from .allocation_service import AllocationService

        def _check_home_base_proximity(target_schedule):
            if (
                not target_schedule
                or not target_schedule.dumpsite_id
                or not target_schedule.dumpsite
                or target_schedule.dumpsite.latitude is None
                or target_schedule.dumpsite.longitude is None
            ):
                return Response(
                    {
                        'error': 'Schedule has no assigned dumpsite with valid coordinates and cannot start a shift.',
                        'code': 'missing_dumpsite',
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not django_settings.DEBUG:
                base_lat = target_schedule.dumpsite.latitude
                base_lng = target_schedule.dumpsite.longitude
                if driver_lat is not None and driver_lng is not None and str(driver_lat).strip() != '' and str(driver_lng).strip() != '':
                    try:
                        dist = haversine(
                            float(driver_lat), float(driver_lng),
                            float(base_lat), float(base_lng)
                        )
                        if dist > 1000:
                            return Response({
                                'error': f'You are too far from the home base ({int(dist)}m away)...'
                            }, status=status.HTTP_403_FORBIDDEN)
                    except (TypeError, ValueError):
                        pass
            return None

        req_sched_int = None
        if requested_schedule_id is not None and str(requested_schedule_id).strip() != '':
            try:
                req_sched_int = int(requested_schedule_id)
            except (TypeError, ValueError):
                return Response({'schedule_id': 'Invalid schedule_id.'}, status=status.HTTP_400_BAD_REQUEST)
            if req_sched_int <= 0:
                return Response({'schedule_id': 'schedule_id must be a positive integer.'}, status=status.HTTP_400_BAD_REQUEST)

        alloc_id_int = None
        if allocation_id is not None and str(allocation_id).strip() != '':
            try:
                alloc_id_int = int(allocation_id)
            except (TypeError, ValueError):
                return Response({'allocation_id': 'Invalid allocation_id.'}, status=status.HTTP_400_BAD_REQUEST)
            if alloc_id_int <= 0:
                return Response({'allocation_id': 'allocation_id must be a positive integer.'}, status=status.HTTP_400_BAD_REQUEST)

        target_schedule_id = req_sched_int
        pre_target_truck = None
        if alloc_id_int is not None:
            alloc_obj = ScheduleTruckAllocation.objects.select_related('truck').filter(id=alloc_id_int).first()
            if not alloc_obj:
                return Response({'error': f'Allocation #{alloc_id_int} not found.'}, status=status.HTTP_400_BAD_REQUEST)
            if not target_schedule_id:
                target_schedule_id = alloc_obj.schedule_id
            pre_target_truck = alloc_obj.truck
        else:
            try:
                prealloc_for_sweep = AllocationService.get_preallocated_truck_for_driver(
                    driver, target_date=today, schedule_id=target_schedule_id
                )
                if prealloc_for_sweep and prealloc_for_sweep.truck_id:
                    pre_target_truck = prealloc_for_sweep.truck
            except DjangoValidationError:
                pre_target_truck = None

        _sweep_stale_shifts_for(driver=driver, truck=pre_target_truck)

        class _ConcurrentShiftScheduleChange(Exception):
            pass

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                observed_shift = DriverShift.objects.filter(driver=driver, is_active=True).values('id', 'schedule_id').first()
                resolved_target_sched = target_schedule_id
                resolved_alloc_id = alloc_id_int
                if observed_shift is None and resolved_target_sched is None:
                    try:
                        prealloc = AllocationService.get_preallocated_truck_for_driver(driver, target_date=today)
                    except DjangoValidationError as e:
                        return Response(
                            e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if prealloc:
                        resolved_alloc_id = prealloc.id
                        resolved_target_sched = prealloc.schedule_id

                schedule_ids_to_lock = sorted({
                    sid for sid in (
                        observed_shift['schedule_id'] if observed_shift else None,
                        resolved_target_sched,
                    ) if sid
                })

                with transaction.atomic():
                    locked_schedules = {}
                    if schedule_ids_to_lock:
                        locked_schedules = {
                            s.id: s
                            for s in CollectionSchedule.objects.filter(id__in=schedule_ids_to_lock).order_by('id').select_for_update()
                        }

                    shift = (
                        DriverShift.objects.select_for_update(of=('self',))
                        .filter(driver=driver, is_active=True)
                        .select_related('schedule', 'allocation', 'truck')
                        .first()
                    )

                    if (
                        (observed_shift is None and shift is not None)
                        or (observed_shift is not None and shift is None)
                        or (shift is not None and shift.schedule_id and shift.schedule_id not in locked_schedules)
                    ):
                        raise _ConcurrentShiftScheduleChange()

                    if shift:
                        # Driver already has an active staged shift (e.g. from pre_start).
                        if req_sched_int is not None and shift.schedule_id != req_sched_int:
                            return Response({
                                'error': (
                                    'You already have an active shift on a different route.'
                                    if shift.schedule_id
                                    else 'Active shift has no matching schedule.'
                                ),
                                'active_schedule_id': shift.schedule_id,
                                'active_shift_id': shift.id,
                            }, status=status.HTTP_409_CONFLICT)

                        if alloc_id_int is not None and shift.allocation_id != alloc_id_int:
                            return Response({
                                'error': 'allocation_id does not match your currently active shift.',
                                'active_allocation_id': shift.allocation_id,
                                'active_shift_id': shift.id,
                            }, status=status.HTTP_409_CONFLICT)

                        eff_truck = shift.effective_truck
                        if eff_truck and not is_truck_dispatchable(eff_truck):
                            return Response(
                                {'truck': f"Truck {eff_truck.plate_number} is not dispatchable."},
                                status=status.HTTP_400_BAD_REQUEST,
                            )

                        if shift.schedule:
                            if shift.schedule.status in ('CANCELLED', 'COMPLETED') or not shift.schedule.is_available:
                                return Response(
                                    {'schedule_id': f"Schedule #{shift.schedule.id} is not active or available for dispatch."},
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            if not shift.schedule.dumpsite_id:
                                return Response(
                                    {
                                        'error': f"Schedule #{shift.schedule.id} has no assigned dumpsite facility.",
                                        'code': 'missing_dumpsite',
                                    },
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            if shift.allocation_id and shift.allocation:
                                try:
                                    resolved_team = AllocationService.resolve_schedule_team(
                                        shift.schedule_id, shift.allocation.allocation_date
                                    )
                                except DjangoValidationError as e:
                                    return Response(
                                        e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                                        status=status.HTTP_400_BAD_REQUEST,
                                    )
                                if resolved_team.id != shift.allocation.team_id:
                                    return Response(
                                        {'allocation_id': 'Active shift allocation team no longer matches the resolved schedule team.'},
                                        status=status.HTTP_409_CONFLICT,
                                    )

                        proximity_err = _check_home_base_proximity(shift.schedule)
                        if proximity_err is not None:
                            return proximity_err

                        if shift.status == 'shiftroute' and shift.started_at is not None:
                            update_fields = []
                            if driver_lat is not None and driver_lng is not None:
                                shift.current_latitude = driver_lat
                                shift.current_longitude = driver_lng
                                shift.last_location_update = timezone.now()
                                update_fields.extend(['current_latitude', 'current_longitude', 'last_location_update'])
                            if update_fields:
                                shift.save(update_fields=update_fields)
                        else:
                            shift.started_at = timezone.now()
                            shift.current_latitude = driver_lat
                            shift.current_longitude = driver_lng
                            shift.last_location_update = timezone.now()
                            shift.op_status = 'on_duty'
                            shift.save(update_fields=[
                                'started_at', 'current_latitude', 'current_longitude',
                                'last_location_update', 'op_status',
                            ])
                        return Response(DriverShiftSerializer(shift).data, status=status.HTTP_200_OK)

                    if not resolved_target_sched:
                        return Response(
                            {
                                'error': 'You have no pre-allocated collection duty for today.',
                                'code': 'no_schedule_today',
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    schedule = locked_schedules.get(resolved_target_sched)
                    if not schedule:
                        return Response({'error': 'The requested route was not found.'}, status=status.HTTP_404_NOT_FOUND)

                    if schedule.status in ('CANCELLED', 'COMPLETED') or not schedule.is_available:
                        return Response(
                            {'schedule_id': f"Schedule #{schedule.id} is not active or available for dispatch."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    has_alloc_today = ScheduleTruckAllocation.objects.filter(
                        schedule=schedule, allocation_date=today
                    ).exists()
                    if not has_alloc_today and not _is_driver_schedule_for_date(schedule, today):
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

                    if is_schedule_complete_today(schedule):
                        return Response(
                            {
                                'error': 'This route has already been completed today.',
                                'code': 'route_completed',
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    ended_schedule_shift = _get_ended_shift_for_schedule_today(
                        schedule=schedule,
                        truck=schedule.truck,
                        driver=driver,
                        today=today,
                    )
                    if ended_schedule_shift:
                        return Response(
                            {
                                'error': "Today's collection shift has already ended.",
                                'code': 'shift_already_ended',
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    try:
                        shift = ShiftService.stage_and_start_shift(
                            driver_user=driver,
                            schedule_id=schedule.id,
                            allocation_id=resolved_alloc_id,
                            manifested_worker_ids=manifested_worker_ids,
                            duty_type=duty_type,
                            initial_status='shiftroute',
                            initial_op_status='on_duty',
                            latitude=driver_lat,
                            longitude=driver_lng,
                        )
                        return Response(DriverShiftSerializer(shift).data, status=status.HTTP_201_CREATED)
                    except DjangoPermissionDenied as e:
                        transaction.set_rollback(True)
                        return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
                    except ActiveShiftConflictError as e:
                        transaction.set_rollback(True)
                        return Response(
                            e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                            status=status.HTTP_409_CONFLICT,
                        )
                    except (DjangoValidationError, ValueError) as e:
                        transaction.set_rollback(True)
                        return Response(
                            e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
            except _ConcurrentShiftScheduleChange:
                if attempt == max_attempts - 1:
                    return Response(
                        {'error': 'Active shift state changed concurrently; please retry.'},
                        status=status.HTTP_409_CONFLICT,
                    )
            except IntegrityError:
                return Response(
                    {'error': 'Driver or truck already has an active shift (concurrent start conflict).'},
                    status=status.HTTP_409_CONFLICT,
                )

    @action(detail=False, methods=['post'], url_path='end')
    def end_shift(self, request):
        driver = request.user
        missed_stop_orders = request.data.get('missed_stop_orders', [])
        client_schedule_id = request.data.get('schedule_id')

        class _ConcurrentShiftTruckChange(Exception):
            pass

        max_attempts = 3
        for attempt in range(max_attempts):
            observed = (
                DriverShift.objects.filter(driver=driver, is_active=True)
                .values('id', 'truck_id', 'allocation__truck_id')
                .first()
            )
            if not observed:
                return Response(
                    {'error': 'No active shift found.', 'code': 'no_active_shift'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            obs_truck_id = observed['truck_id'] or observed['allocation__truck_id']

            try:
                with transaction.atomic():
                    # Canonical lock order: Truck (Level 5) BEFORE DriverShift (Level 8)
                    if obs_truck_id is not None:
                        Truck.objects.filter(id=obs_truck_id).select_for_update().first()

                    shift = (
                        DriverShift.objects.select_for_update(of=('self',))
                        .select_related('schedule', 'allocation')
                        .filter(driver=driver, is_active=True)
                        .first()
                    )
                    if not shift:
                        raise _ConcurrentShiftTruckChange()

                    actual_truck_id = shift.truck_id or (
                        shift.allocation.truck_id if shift.allocation_id and shift.allocation else None
                    )
                    if actual_truck_id != obs_truck_id:
                        raise _ConcurrentShiftTruckChange()

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

                    early_reason = (request.data.get('reason', '') or '').strip()

                    from .shift_service import ShiftService
                    shift = ShiftService.conclude_shift_atomic(
                        driver_shift_id=shift.id,
                        concluded_by=driver,
                        end_reason='driver_ended',
                        end_reason_notes=early_reason,
                    )
                    break
            except _ConcurrentShiftTruckChange:
                if attempt == max_attempts - 1:
                    return Response(
                        {'error': 'Active shift state changed concurrently; please retry.'},
                        status=status.HTTP_409_CONFLICT,
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
        import logging
        from django.core.cache import cache
        # Quarantined: never allow anonymous AllowAny GET requests to mutate shift rows.
        if request.user.is_authenticated and is_admin_user(request.user):
            if cache.add('shift_sweep_lock', 1, 300):   # at most once per 5 min
                try:
                    from .management.commands.sweep_stale_shifts import sweep_stale_shifts
                    sweep_stale_shifts()
                except Exception:
                    logging.getLogger(__name__).exception("Stale shift sweep failed in active_shifts")
                    try:
                        cache.delete('shift_sweep_lock')
                    except Exception:
                        pass

        from django.db.models import Q
        is_privileged = request.user.is_authenticated and getattr(request.user, 'role', None) in _MAP_FULL_ACCESS_ROLES
        today = timezone.localdate()
        # Include: all active shifts, today's inactive shifts, and today-swept/retired shifts
        shifts = DriverShift.objects.filter(
            Q(is_active=True)
            | Q(is_active=False, started_at__date=today)
            | Q(is_active=False, end_reason__in=['heartbeat_timeout', 'truck_deleted', 'truck_retired'], ended_at__date=today)
        ).select_related('driver', 'truck')
        data = []
        now = timezone.now()

        for shift in shifts:
            end_reason = shift.end_reason or ''
            if end_reason in ('heartbeat_timeout', 'truck_deleted'):
                # Authoritative abandoned — swept by management command or legacy truck delete signal
                conn_status = 'abandoned'
            elif end_reason == 'truck_retired' or not shift.is_active:
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

            team = shift.effective_team
            data.append({
                'id': shift.id,
                'driver': (shift.driver.full_name or shift.driver.username) if is_privileged else 'Collection Team',
                'truck': truck.id if truck and is_privileged else None,
                'truckId': truck.plate_number if truck and is_privileged else 'Hidden',
                'truckModel': truck.model if truck and is_privileged else 'Hidden',
                'team_name': team.name if team else None,
                'team_code': team.code if team else None,
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
        shift = (
            DriverShift.objects
            .select_related('schedule__dumpsite', 'allocation__schedule__dumpsite')
            .filter(driver=request.user, is_active=True)
            .first()
        )
        if request.method == 'POST':
            new_status = request.data.get('status')
            valid_statuses = ('heading_to_start', 'on_duty', 'on_route', 'delayed', 'heading_to_dumpsite', 'at_dumpsite', 'returning_to_base')
            if shift and new_status in valid_statuses:
                # Trigger dumpsite notification if transitioning to heading_to_dumpsite
                if new_status == 'heading_to_dumpsite':
                    from notifications.services import notify_dumpsite_inbound
                    dumpsite = shift.effective_dumpsite or (shift.schedule.dumpsite if shift.schedule_id else None)
                    if dumpsite:
                        notify_dumpsite_inbound(shift, dumpsite)

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
        return [IsAdminRole()] if self.request.method == 'PUT' else [permissions.IsAuthenticated()]

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
                schedules = list(CollectionSchedule.objects.filter(dumpsite__isnull=True).select_for_update())
                for sch in schedules:
                    wps = sch.waypoints if isinstance(sch.waypoints, list) else []
                    wps = [{**wps[0], **base}, *wps[1:]] if wps else [base]
                    sch.waypoints = wps
                if schedules:
                    CollectionSchedule.objects.bulk_update(schedules, ['waypoints'])
                updated_routes = len(schedules)

        return Response({**_home_base_payload(setting), 'updated_routes': updated_routes})


from .worker_service import WorkerService
from .team_service import TeamService, ActiveShiftConflictError
from django.core.exceptions import ValidationError as DjangoValidationError

class WorkerViewSet(viewsets.ModelViewSet):
    """
    CRUD and administrative operations for canonical Worker entities.
    """
    queryset = Worker.objects.select_related('user').all()
    serializer_class = WorkerSerializer
    permission_classes = [permissions.IsAuthenticated]
    allow_unpaginated = True

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'merge', 'update_employee_id', 'attendance_history']:
            return [IsAdminRole()]
        return [IsOperationalStaffOrAdmin()]

    def get_queryset(self):
        qs = super().get_queryset()
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ('true', '1'))

        search = self.request.query_params.get('search')
        if search:
            search = search.strip()
            qs = qs.filter(
                Q(full_name__icontains=search) |
                Q(employee_id__icontains=search) |
                Q(user__username__icontains=search) |
                Q(team_memberships__team__name__icontains=search, team_memberships__is_active=True) |
                Q(team_memberships__team__code__icontains=search, team_memberships__is_active=True)
            ).distinct()

        pool_filter = self.request.query_params.get('pool_filter') or self.request.query_params.get('role')
        if pool_filter:
            pool_filter = pool_filter.lower().strip()
            if pool_filter in ('available', 'unassigned'):
                qs = qs.exclude(
                    team_memberships__is_active=True,
                    team_memberships__team__is_active=True
                )
            elif pool_filter in ('watchers', 'watcher'):
                qs = qs.filter(user__role='watcher')
            elif pool_filter in ('drivers', 'driver'):
                qs = qs.filter(user__role='driver')
            elif pool_filter in ('crew', 'crew_members', 'crew_member'):
                qs = qs.filter(
                    Q(user__isnull=True) |
                    Q(user__role='citizen', user__employee_type='crew_member')
                )

        provisional_only = self.request.query_params.get('provisional')
        if provisional_only is not None:
            if provisional_only.lower() in ('true', '1'):
                qs = qs.filter(employee_id__startswith='PROV-')
            else:
                qs = qs.exclude(employee_id__startswith='PROV-')

        worker_type = self.request.query_params.get('worker_type')
        if worker_type == 'authenticated':
            qs = qs.filter(user__isnull=False)
        elif worker_type == 'non_login':
            qs = qs.filter(user__isnull=True).exclude(employee_id__startswith='PROV-')
        elif worker_type == 'provisional':
            qs = qs.filter(employee_id__startswith='PROV-')

        return qs.order_by('employee_id', 'id')

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if getattr(self, 'action', None) == 'list':
            from collections import defaultdict
            from django.utils import timezone
            from .models import (
                SanitationTeamMembership,
                CollectionSchedule,
                ScheduleTeamOverride,
                DriverShift,
                WatcherShift,
                CrewShift,
                ShiftCrewRosterItem,
            )

            today = timezone.localdate()

            # 1. Active memberships map
            membership_map = {
                m.worker_id: m
                for m in SanitationTeamMembership.objects.filter(
                    is_active=True, team__is_active=True
                ).select_related('team')
            }

            # 2. Distinct active schedules for default team & driver assignments
            # Excludes CANCELLED, COMPLETED, and expired single-date schedules (date < today)
            team_sched_map = defaultdict(set)
            driver_sched_map = defaultdict(set)

            valid_schedules = (
                CollectionSchedule.objects
                .exclude(status__in=['CANCELLED', 'COMPLETED'])
                .filter(Q(date__isnull=True) | Q(date__gte=today))
                .values('id', 'default_team_id', 'driver_id')
            )
            for s in valid_schedules:
                if s['default_team_id']:
                    team_sched_map[s['default_team_id']].add(s['id'])
                if s['driver_id']:
                    driver_sched_map[s['driver_id']].add(s['id'])

            # 3. Valid date overrides (effective_date >= today, schedule not CANCELLED or COMPLETED)
            overrides = (
                ScheduleTeamOverride.objects
                .filter(effective_date__gte=today)
                .exclude(schedule__status__in=['CANCELLED', 'COMPLETED'])
                .filter(Q(schedule__date__isnull=True) | Q(schedule__date__gte=today))
                .values('team_id', 'schedule_id')
            )
            for ov in overrides:
                team_sched_map[ov['team_id']].add(ov['schedule_id'])

            # 4. Active shifts across DriverShift, WatcherShift, CrewShift, ShiftCrewRosterItem
            active_shift_workers = set(
                DriverShift.objects.filter(
                    is_active=True, driver__worker_profile__isnull=False
                ).values_list('driver__worker_profile__id', flat=True)
            )
            active_shift_workers.update(
                WatcherShift.objects.filter(
                    is_active=True, watcher__worker_profile__isnull=False
                ).values_list('watcher__worker_profile__id', flat=True)
            )
            active_shift_workers.update(
                CrewShift.objects.filter(
                    team_leader__worker_profile__isnull=False
                ).filter(
                    Q(is_active=True) | Q(driver_shift__is_active=True)
                ).values_list('team_leader__worker_profile__id', flat=True)
            )
            active_shift_workers.update(
                ShiftCrewRosterItem.objects.filter(
                    Q(snapshot__driver_shift__is_active=True)
                    | Q(snapshot__crew_shift__is_active=True)
                    | Q(snapshot__crew_shift__driver_shift__is_active=True)
                ).values_list('worker_id', flat=True)
            )

            context['active_membership_by_worker'] = membership_map
            context['schedule_ids_by_team'] = team_sched_map
            context['schedule_ids_by_driver_user'] = driver_sched_map
            context['active_shift_worker_ids'] = active_shift_workers
        return context

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user_val = serializer.validated_data.get('user')
        try:
            worker = WorkerService.create_worker(
                employee_id=serializer.validated_data['employee_id'],
                full_name=serializer.validated_data['full_name'],
                user=user_val,
                is_active=serializer.validated_data.get('is_active', True),
            )
            return Response(WorkerSerializer(worker).data, status=status.HTTP_201_CREATED)
        except DjangoValidationError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        with transaction.atomic():
            worker = Worker.objects.select_related('user').filter(pk=kwargs.get('pk')).select_for_update(of=('self',)).first()
            if not worker:
                self.get_object()
            serializer = self.get_serializer(worker, data=request.data, partial=partial)
            serializer.is_valid(raise_exception=True)
            validated = serializer.validated_data

            if 'is_active' in validated and worker.is_active and not validated['is_active']:
                if TeamService.is_worker_on_active_shift(worker.id):
                    return Response(
                        {'error': f"Worker '{worker.full_name}' is currently on an active shift and cannot be deactivated."},
                        status=status.HTTP_409_CONFLICT,
                    )
                if SanitationTeamMembership.objects.filter(worker=worker, is_active=True).exists():
                    return Response(
                        {'error': f"Worker '{worker.full_name}' has an active sanitation team membership. Remove or transfer worker first."},
                        status=status.HTTP_409_CONFLICT,
                    )

            if 'user' in validated and validated['user'] != worker.user:
                if TeamService.is_worker_on_active_shift(worker.id):
                    return Response(
                        {'error': f"Worker '{worker.full_name}' is currently on an active shift; user link cannot be modified."},
                        status=status.HTTP_409_CONFLICT,
                    )
                if SanitationTeamMembership.objects.filter(worker=worker, is_active=True).exists():
                    return Response(
                        {'error': f"Worker '{worker.full_name}' has an active sanitation team membership; remove worker from team before changing linked user."},
                        status=status.HTTP_409_CONFLICT,
                    )

            resulting_is_active = validated.get('is_active', worker.is_active)
            effective_user = validated.get('user', worker.user)
            user_changed = 'user' in validated and validated['user'] != worker.user
            if effective_user is not None and (user_changed or resulting_is_active):
                if not getattr(effective_user, 'is_active', False):
                    return Response(
                        {'user': f"User '{effective_user.username}' is inactive and cannot be linked to a Worker."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                sys_role = getattr(effective_user, 'role', None)
                emp_type = getattr(effective_user, 'employee_type', None)
                eligible = (
                    sys_role in ('driver', 'watcher')
                    or (sys_role == 'citizen' and emp_type == 'crew_member')
                )
                if not eligible:
                    return Response(
                        {'user': f"User '{effective_user.username}' with role '{sys_role}' is not eligible for operational sanitation Worker linkage."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            new_employee_id = validated.pop('employee_id', None)
            if new_employee_id is not None and new_employee_id != worker.employee_id:
                try:
                    worker = WorkerService.update_employee_id(
                        worker_id=worker.id,
                        new_employee_id=new_employee_id,
                        authorized_by=request.user,
                    )
                except DjangoValidationError as e:
                    return Response(
                        e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            update_fields = []
            for field in ('full_name', 'user', 'is_active'):
                if field in validated:
                    setattr(worker, field, validated[field])
                    update_fields.append(field)
            if update_fields:
                update_fields.append('updated_at')
                worker.save(update_fields=update_fields)

            return Response(WorkerSerializer(worker, context=self.get_serializer_context()).data)

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            worker = Worker.objects.filter(pk=kwargs.get('pk')).select_for_update().first()
            if not worker:
                self.get_object()
            if TeamService.is_worker_on_active_shift(worker.id):
                return Response(
                    {'error': f"Worker '{worker.full_name}' is currently on an active shift and cannot be deleted."},
                    status=status.HTTP_409_CONFLICT,
                )
            if SanitationTeamMembership.objects.filter(worker=worker, is_active=True).exists():
                return Response(
                    {'error': f"Worker '{worker.full_name}' has an active team membership. Remove worker from team first."},
                    status=status.HTTP_409_CONFLICT,
                )
            try:
                worker.delete()
            except ProtectedError:
                return Response(
                    {'error': f"Worker '{worker.full_name}' is referenced by historical operational records and cannot be deleted; deactivate instead."},
                    status=status.HTTP_409_CONFLICT,
                )
            return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='merge', permission_classes=[IsAdminRole])
    def merge(self, request, pk=None):
        target_id = request.data.get('target_worker_id')
        notes = request.data.get('notes', '')
        if not target_id:
            return Response({'error': 'target_worker_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target = WorkerService.merge_workers(
                source_worker_id=int(pk),
                target_worker_id=int(target_id),
                resolved_by=request.user,
                notes=notes,
            )
            return Response(WorkerSerializer(target).data, status=status.HTTP_200_OK)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=True, methods=['post'], url_path='update-employee-id', permission_classes=[IsAdminRole])
    def update_employee_id(self, request, pk=None):
        new_id = request.data.get('new_employee_id')
        if not new_id:
            return Response({'error': 'new_employee_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            worker = WorkerService.update_employee_id(
                worker_id=int(pk),
                new_employee_id=new_id,
                authorized_by=request.user,
            )
            return Response(WorkerSerializer(worker).data, status=status.HTTP_200_OK)
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=True, methods=['get'], url_path='attendance-history', permission_classes=[IsAdminRole])
    def attendance_history(self, request, pk=None):
        """
        GET /api/driver/workers/{id}/attendance-history/
        Admin-only inspection of persisted attendance, shift, and team membership history for a Worker.
        """
        from .shift_service import ShiftService
        worker = self.get_object()
        payload = ShiftService.get_worker_attendance_history(worker, viewer_user=request.user)
        return Response(payload, status=status.HTTP_200_OK)


class WorkerReconciliationViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Administrative quarantine review and resolution for provisional Worker records.
    """
    queryset = LegacyCrewReconciliationAudit.objects.select_related('provisional_worker', 'resolved_by').all()
    serializer_class = LegacyCrewReconciliationAuditSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        qs = super().get_queryset()
        st = self.request.query_params.get('status')
        if st:
            qs = qs.filter(reconciliation_status=st.upper())
        return qs.order_by('-id')

    @action(detail=True, methods=['post'], url_path='resolve', permission_classes=[IsAdminRole])
    def resolve(self, request, pk=None):
        act = request.data.get('action')
        target_worker_id = request.data.get('target_worker_id')
        new_employee_id = request.data.get('new_employee_id')
        notes = request.data.get('notes', '')

        if not act:
            return Response({'error': 'action is required (PROMOTE, MERGE, or DISMISS).'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            audit = WorkerService.reconcile_provisional_worker(
                audit_id=int(pk),
                action=act,
                target_worker_id=int(target_worker_id) if target_worker_id else None,
                new_employee_id=new_employee_id,
                notes=notes,
                resolved_by=request.user,
            )
            return Response(LegacyCrewReconciliationAuditSerializer(audit).data, status=status.HTTP_200_OK)
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )



class SanitationTeamViewSet(viewsets.ModelViewSet):
    """
    CRUD and administrative operations for Sanitation Teams.
    """
    queryset = SanitationTeam.objects.prefetch_related(
        Prefetch(
            'memberships',
            queryset=SanitationTeamMembership.objects.filter(is_active=True).select_related('worker__user')
        ),
        Prefetch(
            'default_schedules',
            queryset=CollectionSchedule.objects.select_related('dumpsite', 'truck').order_by('id')
        )
    ).all()
    serializer_class = SanitationTeamSerializer
    pagination_class = SanitationTeamPagination
    permission_classes = [permissions.IsAuthenticated]
    allow_unpaginated = True

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'assign_member', 'transfer_worker']:
            return [IsAdminRole()]
        return [IsOperationalStaffOrAdmin()]

    def get_queryset(self):
        qs = super().get_queryset()
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ('true', '1'))
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                Q(name__icontains=search) |
                Q(code__icontains=search) |
                Q(description__icontains=search) |
                Q(memberships__is_active=True, memberships__worker__full_name__icontains=search) |
                Q(memberships__is_active=True, memberships__worker__employee_id__icontains=search)
            ).distinct()
        leadership_mode = self.request.query_params.get('leadership_mode')
        if leadership_mode == 'watcher':
            qs = qs.filter(
                memberships__is_active=True,
                memberships__role_in_team='leader',
                memberships__worker__user__role='watcher',
            ).distinct()
        elif leadership_mode == 'driver':
            qs = qs.filter(
                memberships__is_active=True,
                memberships__role_in_team='leader',
                memberships__worker__user__role='driver',
            ).distinct()
        elif leadership_mode == 'incomplete':
            from django.db.models import Exists, OuterRef
            active_leader = SanitationTeamMembership.objects.filter(
                team=OuterRef('pk'), is_active=True, role_in_team='leader'
            )
            watcher_leader = SanitationTeamMembership.objects.filter(
                team=OuterRef('pk'), is_active=True, role_in_team='leader', worker__user__role='watcher'
            )
            active_driver = SanitationTeamMembership.objects.filter(
                team=OuterRef('pk'), is_active=True, role_in_team='driver'
            )
            active_crew = SanitationTeamMembership.objects.filter(
                team=OuterRef('pk'), is_active=True, role_in_team='crew'
            )
            qs = qs.annotate(
                _has_leader=Exists(active_leader),
                _is_watcher_led=Exists(watcher_leader),
                _has_driver=Exists(active_driver),
                _has_crew=Exists(active_crew),
            ).filter(
                Q(_has_leader=False) |
                Q(_is_watcher_led=True, _has_driver=False) |
                Q(_has_crew=False)
            )
        return qs.order_by('code', 'id')

    def _team_has_operational_dependencies(self, team):
        today = timezone.localdate()
        if SanitationTeamMembership.objects.filter(team=team, is_active=True).exists():
            return 'Team still has active members. Remove or transfer all members first.'
        if CrewShift.objects.filter(team=team).filter(Q(is_active=True) | Q(driver_shift__is_active=True)).exists():
            return 'Team is participating in an active crew shift.'
        if DriverShift.objects.filter(is_active=True).filter(
            Q(allocation__team=team) | Q(schedule__default_team=team)
        ).exists():
            return 'Team is participating in an active driver shift.'
        if CollectionSchedule.objects.filter(default_team=team).exclude(status__in=['CANCELLED', 'COMPLETED']).exists():
            return 'Team is assigned as default team on active collection schedules.'
        if ScheduleTeamOverride.objects.filter(team=team, effective_date__gte=today).exclude(
            schedule__status__in=['CANCELLED', 'COMPLETED']
        ).exists():
            return 'Team is assigned on upcoming or current schedule team overrides.'
        if ScheduleTruckAllocation.objects.filter(team=team, allocation_date__gte=today).exclude(
            schedule__status__in=['CANCELLED', 'COMPLETED']
        ).exists():
            return 'Team is assigned on upcoming or current truck allocations.'
        return None

    def create(self, request, *args, **kwargs):
        name = request.data.get('name')
        code = request.data.get('code')
        desc = request.data.get('description', '')
        try:
            team = TeamService.create_team(name=name, code=code, description=desc)
            return Response(SanitationTeamSerializer(team).data, status=status.HTTP_201_CREATED)
        except DjangoValidationError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        with transaction.atomic():
            team = SanitationTeam.objects.filter(pk=kwargs.get('pk')).select_for_update().first()
            if not team:
                self.get_object()
            serializer = self.get_serializer(team, data=request.data, partial=partial)
            serializer.is_valid(raise_exception=True)
            validated = serializer.validated_data
            if 'is_active' in validated and team.is_active and not validated['is_active']:
                conflict_msg = self._team_has_operational_dependencies(team)
                if conflict_msg:
                    return Response({'error': conflict_msg}, status=status.HTTP_409_CONFLICT)
            serializer.save()
            return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            team = SanitationTeam.objects.filter(pk=kwargs.get('pk')).select_for_update().first()
            if not team:
                self.get_object()
            conflict_msg = self._team_has_operational_dependencies(team)
            if conflict_msg:
                return Response({'error': conflict_msg}, status=status.HTTP_409_CONFLICT)
            try:
                team.delete()
            except ProtectedError:
                return Response(
                    {'error': 'Team is referenced by historical operational records and cannot be deleted; deactivate instead.'},
                    status=status.HTTP_409_CONFLICT,
                )
            return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='assign-member', permission_classes=[IsAdminRole])
    def assign_member(self, request, pk=None):
        worker_id = request.data.get('worker_id')
        role_in_team = request.data.get('role') or request.data.get('role_in_team', 'crew')
        if not worker_id:
            return Response({'error': 'worker_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            membership = TeamService.assign_member(
                team_id=int(pk),
                worker_id=int(worker_id),
                role_in_team=role_in_team,
                created_by=request.user,
            )
            return Response(SanitationTeamMembershipSerializer(membership).data, status=status.HTTP_201_CREATED)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


    @action(detail=False, methods=['post'], url_path='transfer-worker', permission_classes=[IsAdminRole])
    def transfer_worker(self, request):
        worker_id = request.data.get('worker_id')
        target_team_id = request.data.get('target_team_id') or request.data.get('to_team_id')
        new_role = request.data.get('new_role') or request.data.get('role_in_team', 'crew')
        if not worker_id or not target_team_id:
            return Response({'error': 'worker_id and target_team_id are required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            membership = TeamService.transfer_member(
                worker_id=int(worker_id),
                target_team_id=int(target_team_id),
                new_role=new_role,
                authorized_by=request.user,
            )
            return Response(SanitationTeamMembershipSerializer(membership).data, status=status.HTTP_200_OK)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )



class SanitationTeamMembershipViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Membership audit and management viewset.
    """
    queryset = SanitationTeamMembership.objects.select_related('team', 'worker', 'worker__user', 'created_by').all()
    serializer_class = SanitationTeamMembershipSerializer
    permission_classes = [IsOperationalStaffOrAdmin]

    def get_queryset(self):
        qs = super().get_queryset()
        team_id = self.request.query_params.get('team_id')
        if team_id:
            qs = qs.filter(team_id=team_id)
        worker_id = self.request.query_params.get('worker_id')
        if worker_id:
            qs = qs.filter(worker_id=worker_id)
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ('true', '1'))
        return qs

    @action(detail=True, methods=['post'], url_path='deactivate', permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        try:
            membership = TeamService.deactivate_member(
                membership_id=int(pk),
                authorized_by=request.user,
            )
            return Response(SanitationTeamMembershipSerializer(membership).data, status=status.HTTP_200_OK)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class ScheduleTeamOverrideViewSet(viewsets.ModelViewSet):
    queryset = ScheduleTeamOverride.objects.select_related('schedule', 'team', 'created_by').all()
    serializer_class = ScheduleTeamOverrideSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get_queryset(self):
        qs = super().get_queryset()
        schedule_id = self.request.query_params.get('schedule_id')
        if schedule_id:
            qs = qs.filter(schedule_id=schedule_id)
        effective_date = self.request.query_params.get('effective_date')
        if effective_date:
            qs = qs.filter(effective_date=effective_date)
        return qs

    def create(self, request, *args, **kwargs):
        from .allocation_service import AllocationService
        from .team_service import ActiveShiftConflictError
        schedule_id = request.data.get('schedule')
        team_id = request.data.get('team')
        effective_date_raw = request.data.get('effective_date')
        reason = request.data.get('reason', '')
        if not schedule_id or not team_id or not effective_date_raw:
            return Response(
                {'error': 'schedule, team, and effective_date are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        eff_date = parse_date(str(effective_date_raw))
        if not eff_date:
            return Response({'error': 'Invalid effective_date format.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            override = AllocationService.create_schedule_override(
                schedule_id=int(schedule_id),
                effective_date=eff_date,
                team_id=int(team_id),
                reason=reason,
                created_by=request.user,
            )
            return Response(self.get_serializer(override).data, status=status.HTTP_201_CREATED)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError, TypeError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def update(self, request, *args, **kwargs):
        from .allocation_service import AllocationService
        from .team_service import ActiveShiftConflictError
        instance = self.get_object()
        schedule_id = request.data.get('schedule')
        team_id = request.data.get('team')
        effective_date_raw = request.data.get('effective_date')
        reason = request.data.get('reason')
        eff_date = None
        if effective_date_raw is not None:
            eff_date = parse_date(str(effective_date_raw))
            if not eff_date:
                return Response({'error': 'Invalid effective_date format.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            override = AllocationService.update_schedule_override(
                override_id=instance.id,
                schedule_id=int(schedule_id) if schedule_id is not None else None,
                effective_date=eff_date,
                team_id=int(team_id) if team_id is not None else None,
                reason=reason,
            )
            return Response(self.get_serializer(override).data, status=status.HTTP_200_OK)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        from .allocation_service import AllocationService
        from .team_service import ActiveShiftConflictError
        instance = self.get_object()
        try:
            AllocationService.delete_schedule_override(instance.id)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class ScheduleTruckAllocationViewSet(viewsets.ModelViewSet):
    queryset = ScheduleTruckAllocation.objects.select_related('schedule', 'truck', 'team', 'allocated_by').all()
    serializer_class = ScheduleTruckAllocationSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator]

    def get_queryset(self):
        qs = super().get_queryset()
        user = getattr(self.request, 'user', None)
        if user and not is_admin_user(user):
            from .truck_service import TruckService
            facility_id = TruckService.get_operator_dumpsite_id(user)
            if not facility_id:
                return qs.none()
            qs = qs.filter(schedule__dumpsite_id=facility_id)
        schedule_id = self.request.query_params.get('schedule_id')
        if schedule_id:
            qs = qs.filter(schedule_id=schedule_id)
        truck_id = self.request.query_params.get('truck_id')
        if truck_id:
            qs = qs.filter(truck_id=truck_id)
        team_id = self.request.query_params.get('team_id')
        if team_id:
            qs = qs.filter(team_id=team_id)
        allocation_date = self.request.query_params.get('allocation_date')
        if allocation_date:
            qs = qs.filter(allocation_date=allocation_date)
        dumpsite_id = self.request.query_params.get('dumpsite_id')
        if dumpsite_id:
            qs = qs.filter(schedule__dumpsite_id=dumpsite_id)
        search = (self.request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                Q(truck__plate_number__icontains=search)
                | Q(truck__model__icontains=search)
                | Q(schedule__area__icontains=search)
                | Q(team__name__icontains=search)
            )
        return qs

    def create(self, request, *args, **kwargs):
        from django.core.exceptions import PermissionDenied
        from .allocation_service import AllocationService
        from .truck_service import TruckService
        schedule_id = request.data.get('schedule')
        allocation_date_raw = request.data.get('allocation_date')
        truck_id = request.data.get('truck')
        team_id = request.data.get('team')
        if not schedule_id or not allocation_date_raw or not truck_id:
            return Response(
                {'error': 'schedule, allocation_date, and truck are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        schedule = CollectionSchedule.objects.filter(pk=schedule_id).first()
        if not schedule:
            return Response({'error': f'Schedule #{schedule_id} not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            truck_id_int = int(truck_id)
        except (TypeError, ValueError):
            return Response({'error': 'Invalid truck.'}, status=status.HTTP_400_BAD_REQUEST)
        truck_obj = Truck.objects.filter(pk=truck_id_int).first()
        if not truck_obj:
            return Response({'error': f'Truck #{truck_id_int} not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            TruckService.require_admin_or_facility_operator(request.user, schedule=schedule, truck=truck_obj)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        alloc_date = parse_date(str(allocation_date_raw))
        if not alloc_date:
            return Response({'error': 'Invalid allocation_date format.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            from .team_service import ActiveShiftConflictError
            allocation = AllocationService.allocate_truck_for_schedule(
                schedule_id=int(schedule_id),
                allocation_date=alloc_date,
                truck_id=truck_id_int,
                team_id=int(team_id) if team_id is not None else None,
                allocated_by=request.user,
            )
            return Response(self.get_serializer(allocation).data, status=status.HTTP_201_CREATED)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def update(self, request, *args, **kwargs):
        from django.core.exceptions import PermissionDenied
        from .allocation_service import AllocationService
        from .team_service import ActiveShiftConflictError
        from .truck_service import TruckService

        schedule_id = request.data.get('schedule')
        truck_id = request.data.get('truck')
        allocation_date_raw = request.data.get('allocation_date')
        team_id = request.data.get('team')

        schedule_id_int = None
        if schedule_id is not None:
            try:
                schedule_id_int = int(schedule_id)
            except (TypeError, ValueError):
                return Response({'error': 'Invalid schedule.'}, status=status.HTTP_400_BAD_REQUEST)

        truck_id_int = None
        if truck_id is not None:
            try:
                truck_id_int = int(truck_id)
            except (TypeError, ValueError):
                return Response({'error': 'Invalid truck.'}, status=status.HTTP_400_BAD_REQUEST)

        team_id_int = None
        if team_id is not None:
            try:
                team_id_int = int(team_id)
            except (TypeError, ValueError):
                return Response({'error': 'Invalid team.'}, status=status.HTTP_400_BAD_REQUEST)

        alloc_date = None
        if allocation_date_raw is not None:
            alloc_date = parse_date(str(allocation_date_raw))
            if not alloc_date:
                return Response({'error': 'Invalid allocation_date format.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            instance = (
                ScheduleTruckAllocation.objects
                .select_related('schedule', 'truck')
                .filter(pk=kwargs.get('pk'))
                .first()
            )
            if not instance:
                raise Http404('ScheduleTruckAllocation not found.')
            # Verify queryset facility visibility
            if not self.get_queryset().filter(pk=instance.pk).exists():
                raise Http404('ScheduleTruckAllocation not found.')

            truck_obj = instance.truck
            if truck_id_int is not None:
                truck_obj = Truck.objects.filter(pk=truck_id_int).first()
                if not truck_obj:
                    return Response({'error': f'Truck #{truck_id_int} not found.'}, status=status.HTTP_404_NOT_FOUND)

            TruckService.require_admin_or_facility_operator(
                request.user, schedule=instance.schedule, truck=instance.truck
            )
            if truck_obj and truck_obj.id != instance.truck_id:
                TruckService.require_admin_or_facility_operator(
                    request.user, schedule=instance.schedule, truck=truck_obj
                )
            if schedule_id_int is not None:
                target_sched = CollectionSchedule.objects.filter(pk=schedule_id_int).first()
                if target_sched:
                    TruckService.require_admin_or_facility_operator(
                        request.user, schedule=target_sched, truck=truck_obj
                    )

            allocation = AllocationService.update_truck_allocation(
                allocation_id=instance.id,
                schedule_id=schedule_id_int,
                allocation_date=alloc_date,
                truck_id=truck_id_int,
                team_id=team_id_int,
                actor=request.user,
            )
            return Response(self.get_serializer(allocation).data, status=status.HTTP_200_OK)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        from django.core.exceptions import PermissionDenied
        from .allocation_service import AllocationService
        from .team_service import ActiveShiftConflictError
        from .truck_service import TruckService
        try:
            instance = (
                ScheduleTruckAllocation.objects
                .select_related('schedule', 'truck')
                .filter(pk=kwargs.get('pk'))
                .first()
            )
            if not instance:
                raise Http404('ScheduleTruckAllocation not found.')
            if not self.get_queryset().filter(pk=instance.pk).exists():
                raise Http404('ScheduleTruckAllocation not found.')
            TruckService.require_admin_or_facility_operator(
                request.user, schedule=instance.schedule, truck=instance.truck
            )
            AllocationService.delete_truck_allocation(instance.id, actor=request.user)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except PermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except ActiveShiftConflictError as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_409_CONFLICT,
            )
        except ProtectedError:
            return Response(
                {'error': 'Cannot delete truck allocation because operational shift records reference it.'},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class WatcherShiftViewSet(viewsets.ModelViewSet):
    queryset = WatcherShift.objects.select_related('watcher', 'schedule', 'barangay').order_by('-shift_date', '-started_at')
    serializer_class = WatcherShiftSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not is_admin_user(user):
            qs = qs.filter(watcher=user)
        schedule_id = self.request.query_params.get('schedule_id')
        if schedule_id:
            qs = qs.filter(schedule_id=schedule_id)
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ('true', '1'))
        return qs

    @action(detail=False, methods=['get'], url_path='current')
    def current(self, request):
        from .shift_service import ShiftService
        ShiftService.cleanup_stale_unlinked_watcher_shifts(watcher_user=request.user)
        shift = self.get_queryset().filter(is_active=True).first()
        if not shift:
            return Response(None, status=status.HTTP_200_OK)
        return Response(self.get_serializer(shift).data, status=status.HTTP_200_OK)

    def create(self, request, *args, **kwargs):
        return Response(
            {'error': 'Use /api/driver/watcher-shifts/start/ to start and confirm a WatcherShift.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=False, methods=['post'], url_path='start')
    def start_shift(self, request):
        # Reject client-supplied watcher identity spoofing
        supplied_watcher = request.data.get('watcher') or request.data.get('watcher_id')
        if supplied_watcher is not None and str(supplied_watcher) != str(request.user.id):
            return Response(
                {'error': 'Cannot start a WatcherShift on behalf of another user.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if getattr(request.user, 'role', None) != UserRole.WATCHER:
            return Response(
                {'error': 'Only an assigned Watcher (Team Leader) may start a WatcherShift.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        schedule_id = request.data.get('schedule_id')
        if not schedule_id:
            return Response({'error': 'schedule_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            schedule_id_int = int(schedule_id)
        except (TypeError, ValueError):
            return Response({'error': 'Invalid schedule_id.'}, status=status.HTTP_400_BAD_REQUEST)
        if schedule_id_int <= 0:
            return Response({'error': 'schedule_id must be a positive integer.'}, status=status.HTTP_400_BAD_REQUEST)

        today = timezone.localdate()
        from .allocation_service import AllocationService
        from .shift_service import ShiftService

        # Idempotently close any prior-date unlinked WatcherShifts / pre-departure CrewShifts BEFORE transaction.atomic()
        ShiftService.cleanup_stale_unlinked_watcher_shifts(watcher_user=request.user)

        class _ConcurrentTeamChange(Exception):
            pass

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                with transaction.atomic():
                    # Canonical lock order:
                    # CollectionSchedule (1) -> SanitationTeam (2) -> Worker (6, asc id)
                    # -> SanitationTeamMembership (7, asc id) -> CrewShift (9, asc id) -> WatcherShift (10, of=('self',))
                    schedule = CollectionSchedule.objects.filter(id=schedule_id_int).select_for_update().first()
                    if not schedule:
                        return Response({'error': 'Schedule not found.'}, status=status.HTTP_404_NOT_FOUND)
                    if schedule.status in ('CANCELLED', 'COMPLETED') or not schedule.is_available:
                        return Response(
                            {'error': f"Schedule #{schedule.id} is not active or available for dispatch."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    try:
                        pre_team = AllocationService.resolve_schedule_team(schedule.id, today)
                    except DjangoValidationError as e:
                        return Response(
                            e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    locked_team = SanitationTeam.objects.filter(id=pre_team.id, is_active=True).select_for_update().first()
                    if not locked_team:
                        return Response(
                            {'error': f'Resolved team for Schedule #{schedule.id} is inactive.'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    team_worker_ids = sorted(
                        SanitationTeamMembership.objects.filter(
                            team=locked_team, is_active=True
                        ).values_list('worker_id', flat=True)
                    )
                    if team_worker_ids:
                        list(
                            Worker.objects.filter(id__in=team_worker_ids)
                            .order_by('id')
                            .select_for_update(of=('self',))
                        )
                    list(
                        SanitationTeamMembership.objects.filter(team=locked_team, is_active=True)
                        .order_by('id')
                        .select_for_update(of=('self',))
                    )

                    try:
                        from .team_service import TeamService, resolve_deployment_team_leader
                        deployment_leader = resolve_deployment_team_leader(schedule, today)
                    except DjangoValidationError as e:
                        return Response(
                            e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    if deployment_leader.team.id != locked_team.id:
                        raise _ConcurrentTeamChange()

                    if deployment_leader.leadership_mode != 'watcher' or deployment_leader.user.id != request.user.id:
                        return Response(
                            {'error': f'You are not the designated Team Leader (Watcher) for Team {locked_team.code}.'},
                            status=status.HTTP_403_FORBIDDEN,
                        )

                    # Lock CrewShift (9, asc id) BEFORE WatcherShift (10, of=('self',))
                    unlinked_cs = list(
                        CrewShift.objects.filter(
                            schedule=schedule,
                            service_date=today,
                            team_leader=request.user,
                            watcher_shift__isnull=True,
                            is_active=True,
                        ).order_by('id').select_for_update()
                    )
                    if len(unlinked_cs) > 1:
                        return Response(
                            {
                                'error': (
                                    'Multiple active unlinked CrewShifts exist for this schedule and date; '
                                    'resolve duplicate CrewShifts before starting WatcherShift.'
                                )
                            },
                            status=status.HTTP_409_CONFLICT,
                        )

                    active = WatcherShift.objects.select_for_update(of=('self',)).filter(
                        watcher=request.user, is_active=True
                    ).first()
                    if active:
                        if active.schedule_id != schedule.id or active.shift_date != today:
                            return Response(
                                {'error': 'You already have an active WatcherShift on a different schedule or date.'},
                                status=status.HTTP_409_CONFLICT,
                            )
                        linked_cs_id = (
                            CrewShift.objects.filter(watcher_shift=active, is_active=True)
                            .values_list('id', flat=True)
                            .first()
                        )
                        if TeamService.is_worker_on_active_shift(
                            deployment_leader.worker.id,
                            exclude_watcher_shift_id=active.id,
                            exclude_crew_shift_id=unlinked_cs[0].id if len(unlinked_cs) == 1 else linked_cs_id,
                            exclude_driver_shift_schedule_id=schedule.id,
                        ):
                            return Response(
                                {'error': 'You are already participating in another active shift.'},
                                status=status.HTTP_409_CONFLICT,
                            )
                        if len(unlinked_cs) == 1:
                            cs = unlinked_cs[0]
                            cs.watcher_shift = active
                            cs.save(update_fields=['watcher_shift'])
                        return Response(self.get_serializer(active).data, status=status.HTTP_200_OK)

                    if TeamService.is_worker_on_active_shift(
                        deployment_leader.worker.id,
                        exclude_watcher_shift_id=None,
                        exclude_crew_shift_id=unlinked_cs[0].id if len(unlinked_cs) == 1 else None,
                        exclude_driver_shift_schedule_id=schedule.id,
                    ):
                        return Response(
                            {'error': 'You are already participating in another active shift.'},
                            status=status.HTTP_409_CONFLICT,
                        )

                    barangay = schedule.barangays.first() if schedule.barangays.exists() else None
                    shift = WatcherShift.objects.create(
                        watcher=request.user,
                        schedule=schedule,
                        barangay=barangay,
                        shift_date=today,
                        is_active=True,
                    )
                    if len(unlinked_cs) == 1:
                        cs = unlinked_cs[0]
                        cs.watcher_shift = shift
                        cs.save(update_fields=['watcher_shift'])
                    return Response(self.get_serializer(shift).data, status=status.HTTP_201_CREATED)
            except _ConcurrentTeamChange:
                if attempt == max_attempts - 1:
                    return Response(
                        {'error': 'Deployment team changed concurrently while starting shift; please retry.'},
                        status=status.HTTP_409_CONFLICT,
                    )
            except IntegrityError:
                return Response(
                    {'error': 'You already have an active WatcherShift for today (concurrent start conflict).'},
                    status=status.HTTP_409_CONFLICT,
                )

    @action(detail=True, methods=['post'], url_path='end')
    def end_shift(self, request, pk=None):
        from .models import CrewShift
        shift = self.get_object()
        with transaction.atomic():
            locked_shift = WatcherShift.objects.select_for_update().filter(pk=shift.pk).first()
            if not locked_shift:
                return Response({'error': 'WatcherShift not found.'}, status=status.HTTP_404_NOT_FOUND)
            has_active_linked = (
                CrewShift.objects.filter(watcher_shift=locked_shift)
                .filter(Q(is_active=True) | Q(driver_shift__is_active=True))
                .exists()
            )
            if has_active_linked:
                return Response(
                    {
                        'error': (
                            'Cannot end a WatcherShift while its linked DriverShift or CrewShift is still active. '
                            'Conclude the shift through the coordinated shift-conclusion flow.'
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            if locked_shift.is_active:
                locked_shift.is_active = False
                locked_shift.ended_at = timezone.now()
                locked_shift.end_reason = 'watcher_ended'
                locked_shift.save(update_fields=['is_active', 'ended_at', 'end_reason'])
            return Response(self.get_serializer(locked_shift).data, status=status.HTTP_200_OK)


class UnfinishedStopReviewViewSet(viewsets.ReadOnlyModelViewSet):
    """
    D-12 Admin-authorized resolution workflow for UnfinishedStopReview records.
    """
    from .models import UnfinishedStopReview
    from .serializers import UnfinishedStopReviewSerializer

    queryset = UnfinishedStopReview.objects.select_related(
        'shift', 'stop_validation', 'pickup_status', 'reviewed_by'
    ).order_by('-created_at', 'stop_order')
    serializer_class = UnfinishedStopReviewSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get_queryset(self):
        qs = super().get_queryset()
        shift_id = self.request.query_params.get('shift_id')
        if shift_id:
            qs = qs.filter(shift_id=shift_id)
        res_status = self.request.query_params.get('resolution_status')
        if res_status:
            qs = qs.filter(resolution_status=res_status.upper())
        return qs

    @action(detail=True, methods=['post'], url_path='resolve', permission_classes=[IsAdminRole])
    def resolve(self, request, pk=None):
        if not is_admin_user(request.user):
            return Response({'error': 'Admin authorization required.'}, status=status.HTTP_403_FORBIDDEN)
        review = self.get_object()
        target_status = (request.data.get('resolution_status') or 'RESOLVED').upper().strip()
        if target_status not in ('RESOLVED', 'DISMISSED'):
            return Response(
                {'error': 'resolution_status must be RESOLVED or DISMISSED.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        notes = (request.data.get('resolution_notes') or '').strip()
        review.resolution_status = target_status
        review.resolution_notes = notes
        review.reviewed_by = request.user
        review.reviewed_at = timezone.now()
        review.save(update_fields=['resolution_status', 'resolution_notes', 'reviewed_by', 'reviewed_at'])
        return Response(self.get_serializer(review).data, status=status.HTTP_200_OK)


class TruckReplacementRequestViewSet(viewsets.ReadOnlyModelViewSet):
    from .serializers import TruckReplacementRequestSerializer

    queryset = TruckReplacementRequest.objects.select_related(
        'driver_shift', 'schedule', 'schedule__dumpsite', 'truck', 'requested_by', 'resolved_by'
    ).order_by('-created_at')
    serializer_class = TruckReplacementRequestSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if is_admin_user(user):
            pass
        elif getattr(user, 'role', None) == UserRole.DUMPSITE:
            from .truck_service import TruckService
            fac_id = TruckService.get_operator_dumpsite_id(user)
            if not fac_id:
                return qs.none()
            facility_trucks = Truck.objects.filter(TruckService.facility_trucks_q(fac_id))
            qs = qs.filter(
                Q(schedule__dumpsite_id=fac_id)
                | Q(schedule__isnull=True, truck__in=facility_trucks)
            ).distinct()
        elif getattr(user, 'role', None) == UserRole.DRIVER:
            qs = qs.filter(requested_by=user)
        else:
            return qs.none()

        params = self.request.query_params
        status_param = params.get('status')
        if status_param:
            qs = qs.filter(status=status_param.strip().upper())
        truck_id = params.get('truck_id')
        if truck_id:
            qs = qs.filter(truck_id=truck_id)
        schedule_id = params.get('schedule_id')
        if schedule_id:
            qs = qs.filter(schedule_id=schedule_id)
        dumpsite_id = params.get('dumpsite_id')
        if dumpsite_id:
            qs = qs.filter(schedule__dumpsite_id=dumpsite_id)
        search = (params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                Q(truck__plate_number__icontains=search)
                | Q(reason__icontains=search)
                | Q(requested_by__full_name__icontains=search)
                | Q(requested_by__username__icontains=search)
            )
        return qs

    @action(
        detail=True,
        methods=['post'],
        url_path='approve',
        permission_classes=[permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator],
    )
    def approve(self, request, pk=None):
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .truck_service import TruckLifecycleConflictError, TruckService

        replacement_truck_id = request.data.get('replacement_truck_id')
        if not replacement_truck_id:
            return Response(
                {'replacement_truck_id': 'replacement_truck_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            replacement_truck_int = int(replacement_truck_id)
        except (TypeError, ValueError):
            return Response(
                {'replacement_truck_id': 'Invalid replacement_truck_id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        resolution_notes = (request.data.get('resolution_notes') or '').strip()
        transfer_drivers = bool(request.data.get('transfer_drivers', True))

        req_meta = (
            TruckReplacementRequest.objects
            .select_related('schedule', 'truck', 'driver_shift__allocation')
            .filter(pk=pk)
            .first()
        )
        if not req_meta:
            return Response({'error': 'Replacement request not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            if req_meta.schedule is not None:
                TruckService.require_admin_or_facility_operator(request.user, schedule=req_meta.schedule)
            else:
                TruckService.require_admin_or_facility_operator(request.user, truck=req_meta.truck)
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)

        if req_meta.status != 'PENDING':
            return Response(
                {'error': f'Replacement request #{req_meta.id} is already {req_meta.status}.', 'code': 'already_resolved'},
                status=status.HTTP_409_CONFLICT,
            )
        if not req_meta.schedule_id:
            return Response(
                {'error': 'Replacement request has no associated schedule.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        effective_date = None
        if req_meta.driver_shift_id and req_meta.driver_shift and req_meta.driver_shift.allocation_id:
            effective_date = req_meta.driver_shift.allocation.allocation_date

        try:
            # Canonical lock order inside replace_truck_assignment:
            # CollectionSchedule -> SanitationTeam -> ScheduleTruckAllocation -> Truck -> TruckReplacementRequest (of=('self',))
            res = TruckService.replace_truck_assignment(
                req_meta.truck,
                replacement_truck_id=replacement_truck_int,
                schedule_id=req_meta.schedule_id,
                user=request.user,
                effective_date=effective_date,
                reason=resolution_notes or req_meta.reason,
                transfer_drivers=transfer_drivers,
                replacement_request_id=req_meta.id,
            )
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response(
                {'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        req_meta.refresh_from_db()
        return Response(
            {
                **self.get_serializer(req_meta).data,
                'replacement_truck': TruckSerializer(
                    res['replacement_truck'], context=self.get_serializer_context()
                ).data,
                'allocation': ScheduleTruckAllocationSerializer(res['allocation']).data,
                'transferred_driver_ids': res['transferred_driver_ids'],
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['post'],
        url_path='reject',
        permission_classes=[permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator],
    )
    def reject(self, request, pk=None):
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .truck_service import TruckService, _record_truck_audit_log

        resolution_notes = (request.data.get('resolution_notes') or '').strip()
        with transaction.atomic():
            req = (
                TruckReplacementRequest.objects.select_for_update(of=('self',))
                .select_related('schedule', 'truck')
                .filter(pk=pk)
                .first()
            )
            if not req:
                return Response({'error': 'Replacement request not found.'}, status=status.HTTP_404_NOT_FOUND)

            try:
                if req.schedule is not None:
                    TruckService.require_admin_or_facility_operator(request.user, schedule=req.schedule)
                else:
                    TruckService.require_admin_or_facility_operator(request.user, truck=req.truck)
            except DjangoPermissionDenied as e:
                return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)

            if req.status != 'PENDING':
                return Response(
                    {'error': f'Replacement request #{req.id} is already {req.status}.', 'code': 'already_resolved'},
                    status=status.HTTP_409_CONFLICT,
                )

            req.status = 'REJECTED'
            req.resolved_by = request.user
            req.resolved_at = timezone.now()
            req.resolution_notes = resolution_notes
            req.save(update_fields=['status', 'resolved_by', 'resolved_at', 'resolution_notes'])

            _record_truck_audit_log(
                actor=request.user,
                action_code='TRUCK_REPLACEMENT_REJECTED',
                target_object_id=str(req.truck_id),
                details={
                    'request_id': req.id,
                    'plate_number': req.truck.plate_number,
                    'schedule_id': req.schedule_id,
                    'resolution_notes': resolution_notes,
                },
            )
            return Response(self.get_serializer(req).data, status=status.HTTP_200_OK)


class TruckOperationalHoldLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = TruckOperationalHoldLog.objects.select_related(
        'truck', 'dumpsite', 'inspection', 'placed_by', 'cleared_by'
    ).order_by('-placed_at', '-id')
    serializer_class = TruckOperationalHoldLogSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        from .truck_service import TruckService

        qs = super().get_queryset()
        user = self.request.user
        if not is_admin_user(user):
            fac_id = TruckService.get_operator_dumpsite_id(user)
            if not fac_id:
                return qs.none()
            qs = qs.filter(dumpsite_id=fac_id)

        params = self.request.query_params
        truck_id = params.get('truck_id')
        if truck_id:
            qs = qs.filter(truck_id=truck_id)
        dumpsite_id = params.get('dumpsite_id')
        if dumpsite_id:
            qs = qs.filter(dumpsite_id=dumpsite_id)
        is_active_raw = params.get('is_active')
        if is_active_raw is not None and str(is_active_raw).strip() != '':
            val = str(is_active_raw).strip().lower()
            if val in ('true', '1'):
                qs = qs.filter(is_active=True)
            elif val in ('false', '0'):
                qs = qs.filter(is_active=False)
        search = (params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                Q(truck__plate_number__icontains=search)
                | Q(truck__model__icontains=search)
                | Q(reason__icontains=search)
                | Q(resolution_notes__icontains=search)
                | Q(placed_by__full_name__icontains=search)
                | Q(cleared_by__full_name__icontains=search)
            )
        return qs


class TruckMaintenanceRecordViewSet(viewsets.ModelViewSet):
    queryset = TruckMaintenanceRecord.objects.select_related(
        'truck', 'dumpsite', 'created_by', 'started_by', 'completed_by'
    ).order_by('-created_at', '-id')
    serializer_class = TruckMaintenanceRecordSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator]
    pagination_class = StandardResultsSetPagination
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        from .truck_service import TruckService

        qs = super().get_queryset()
        user = self.request.user
        if not is_admin_user(user):
            fac_id = TruckService.get_operator_dumpsite_id(user)
            if not fac_id:
                return qs.none()
            facility_truck_ids = Truck.objects.filter(TruckService.facility_trucks_q(fac_id)).values_list('id', flat=True)
            qs = qs.filter(Q(dumpsite_id=fac_id) | Q(dumpsite__isnull=True, truck_id__in=facility_truck_ids))

        params = self.request.query_params
        truck_id = params.get('truck_id')
        if truck_id:
            qs = qs.filter(truck_id=truck_id)
        dumpsite_id = params.get('dumpsite_id')
        if dumpsite_id:
            qs = qs.filter(dumpsite_id=dumpsite_id)
        status_param = params.get('status')
        if status_param:
            qs = qs.filter(status=status_param.strip().upper())
        mtype = params.get('maintenance_type')
        if mtype:
            qs = qs.filter(maintenance_type=mtype.strip().upper())
        search = (params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                Q(truck__plate_number__icontains=search)
                | Q(truck__model__icontains=search)
                | Q(title__icontains=search)
                | Q(notes__icontains=search)
                | Q(completion_notes__icontains=search)
            )
        return qs

    def create(self, request, *args, **kwargs):
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .truck_service import TruckLifecycleConflictError, TruckService

        raw_truck_id = request.data.get('truck_id')
        if raw_truck_id is None:
            raw_truck_id = request.data.get('truck')
        if not raw_truck_id:
            return Response({'truck_id': 'truck_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            truck_obj = Truck.objects.get(pk=int(raw_truck_id))
        except (Truck.DoesNotExist, TypeError, ValueError):
            return Response({'truck_id': f'Truck #{raw_truck_id} not found.'}, status=status.HTTP_404_NOT_FOUND)

        scheduled_for_raw = request.data.get('scheduled_for')
        scheduled_for = parse_date(str(scheduled_for_raw)) if scheduled_for_raw else None
        if scheduled_for_raw and not scheduled_for:
            return Response({'scheduled_for': 'Invalid scheduled_for date format.'}, status=status.HTTP_400_BAD_REQUEST)

        dumpsite_id_raw = request.data.get('dumpsite_id') or request.data.get('dumpsite')
        dumpsite_id = None
        if dumpsite_id_raw not in (None, ''):
            try:
                dumpsite_id = int(dumpsite_id_raw)
            except (TypeError, ValueError):
                return Response({'dumpsite_id': 'Invalid dumpsite_id.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            rec = TruckService.create_maintenance_record(
                truck_obj,
                user=request.user,
                maintenance_type=request.data.get('maintenance_type', 'CORRECTIVE'),
                title=request.data.get('title', ''),
                notes=request.data.get('notes', '') or request.data.get('reason', ''),
                scheduled_for=scheduled_for,
                cost=request.data.get('cost'),
                odometer_km=request.data.get('odometer_km'),
                start_immediately=bool(request.data.get('start_immediately', False)),
                dumpsite_id=dumpsite_id,
                maintenance_status=request.data.get('maintenance_status', 'under_repair'),
            )
            return Response(self.get_serializer(rec).data, status=status.HTTP_201_CREATED)
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response(
                {'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def partial_update(self, request, *args, **kwargs):
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .truck_service import TruckLifecycleConflictError, TruckService

        rec = self.get_object()
        data = dict(request.data)
        if 'scheduled_for' in data and data['scheduled_for']:
            parsed = parse_date(str(data['scheduled_for']))
            if not parsed:
                return Response({'scheduled_for': 'Invalid scheduled_for date format.'}, status=status.HTTP_400_BAD_REQUEST)
            data['scheduled_for'] = parsed
        try:
            updated = TruckService.update_maintenance_record(rec, user=request.user, data=data)
            return Response(self.get_serializer(updated).data, status=status.HTTP_200_OK)
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response(
                {'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    @action(detail=True, methods=['post'], url_path='start')
    def start(self, request, pk=None):
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .truck_service import TruckLifecycleConflictError, TruckService

        rec = self.get_object()
        try:
            updated = TruckService.start_maintenance_record(
                rec,
                user=request.user,
                maintenance_status=request.data.get('maintenance_status', 'under_repair'),
            )
            return Response(self.get_serializer(updated).data, status=status.HTTP_200_OK)
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response(
                {'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=True, methods=['post'], url_path='complete')
    def complete(self, request, pk=None):
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .truck_service import TruckLifecycleConflictError, TruckService

        rec = self.get_object()
        try:
            updated = TruckService.complete_maintenance_record(
                rec,
                user=request.user,
                completion_notes=request.data.get('completion_notes', '') or request.data.get('notes', ''),
                cost=request.data.get('cost'),
                odometer_km=request.data.get('odometer_km'),
            )
            return Response(self.get_serializer(updated).data, status=status.HTTP_200_OK)
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TruckLifecycleConflictError as e:
            return Response(
                {'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code},
                status=status.HTTP_409_CONFLICT,
            )
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class IsFuelLogAuthorized(permissions.BasePermission):
    def has_permission(self, request, view):
        from .truck_service import TruckService

        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if is_admin_user(user):
            return True
        role = getattr(user, 'role', None)
        if role == UserRole.DRIVER:
            return True
        if role == UserRole.DUMPSITE:
            return TruckService.get_operator_dumpsite_id(user) is not None
        return False


class FuelLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = FuelLog.objects.select_related(
        'driver_shift', 'truck', 'dumpsite', 'driver', 'gauge_submitted_by', 'recorded_by'
    ).order_by('-created_at', '-id')
    serializer_class = FuelLogSerializer
    permission_classes = [permissions.IsAuthenticated, IsFuelLogAuthorized]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        from .truck_service import TruckService

        qs = super().get_queryset()
        user = self.request.user
        role = getattr(user, 'role', None)
        if is_admin_user(user):
            pass
        elif role == UserRole.DUMPSITE:
            fac_id = TruckService.get_operator_dumpsite_id(user)
            if not fac_id:
                return qs.none()
            qs = qs.filter(dumpsite_id=fac_id)
        elif role == UserRole.DRIVER:
            qs = qs.filter(driver=user)
        else:
            return qs.none()

        params = self.request.query_params
        driver_shift_id = params.get('driver_shift_id')
        if driver_shift_id not in (None, ''):
            try:
                qs = qs.filter(driver_shift_id=int(driver_shift_id))
            except (TypeError, ValueError):
                raise DRFValidationError({'driver_shift_id': 'Invalid driver_shift_id.'})
        truck_id = params.get('truck_id')
        if truck_id not in (None, ''):
            try:
                qs = qs.filter(truck_id=int(truck_id))
            except (TypeError, ValueError):
                raise DRFValidationError({'truck_id': 'Invalid truck_id.'})
        dumpsite_id = params.get('dumpsite_id')
        if dumpsite_id not in (None, ''):
            try:
                qs = qs.filter(dumpsite_id=int(dumpsite_id))
            except (TypeError, ValueError):
                raise DRFValidationError({'dumpsite_id': 'Invalid dumpsite_id.'})
        status_param = params.get('status')
        if status_param:
            qs = qs.filter(status=status_param.strip().upper())
        date_from = params.get('date_from')
        if date_from not in (None, ''):
            parsed_from = parse_date(str(date_from).strip())
            if not parsed_from:
                raise DRFValidationError({'date_from': 'Invalid date_from format. Use YYYY-MM-DD.'})
            qs = qs.filter(created_at__date__gte=parsed_from)
        date_to = params.get('date_to')
        if date_to not in (None, ''):
            parsed_to = parse_date(str(date_to).strip())
            if not parsed_to:
                raise DRFValidationError({'date_to': 'Invalid date_to format. Use YYYY-MM-DD.'})
            qs = qs.filter(created_at__date__lte=parsed_to)
        search = (params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                Q(truck__plate_number__icontains=search)
                | Q(driver__full_name__icontains=search)
                | Q(driver__username__icontains=search)
                | Q(notes__icontains=search)
            )
        return qs

    @action(detail=False, methods=['post'], url_path='submit-gauge')
    def submit_gauge(self, request):
        from decimal import Decimal, InvalidOperation
        from .truck_service import _record_truck_audit_log

        user = request.user
        if getattr(user, 'role', None) != UserRole.DRIVER:
            return Response(
                {'error': 'Only Drivers may submit fuel gauge percentages.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        raw_pct = request.data.get('gauge_percentage')
        if raw_pct is None or str(raw_pct).strip() == '':
            return Response({'gauge_percentage': 'gauge_percentage is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            gauge_pct = Decimal(str(raw_pct))
        except (InvalidOperation, TypeError, ValueError):
            return Response({'gauge_percentage': 'Invalid gauge_percentage value.'}, status=status.HTTP_400_BAD_REQUEST)
        if gauge_pct < Decimal('0') or gauge_pct > Decimal('100'):
            return Response(
                {'gauge_percentage': 'gauge_percentage must be between 0 and 100.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_shift_id = _pick_present_field(request.data, 'driver_shift_id', 'driver_shift')
        raw_truck_id = _pick_present_field(request.data, 'truck_id', 'truck')
        raw_dumpsite_id = _pick_present_field(request.data, 'dumpsite_id', 'dumpsite')
        notes = (request.data.get('notes') or '').strip()

        with transaction.atomic():
            if raw_shift_id is not None:
                if isinstance(raw_shift_id, bool):
                    return Response({'driver_shift_id': 'Invalid driver_shift_id.'}, status=status.HTTP_400_BAD_REQUEST)
                try:
                    shift_id = int(raw_shift_id)
                except (TypeError, ValueError):
                    return Response({'driver_shift_id': 'Invalid driver_shift_id.'}, status=status.HTTP_400_BAD_REQUEST)
                if shift_id <= 0:
                    return Response(
                        {'driver_shift_id': 'driver_shift_id must be a positive integer.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                shift = (
                    DriverShift.objects.select_for_update(of=('self',))
                    .select_related('truck', 'allocation__truck', 'schedule__dumpsite', 'allocation__schedule__dumpsite')
                    .filter(pk=shift_id)
                    .first()
                )
                if not shift:
                    return Response({'driver_shift_id': f'DriverShift #{shift_id} not found.'}, status=status.HTTP_404_NOT_FOUND)
                if shift.driver_id != user.id:
                    return Response(
                        {'error': 'You may only submit fuel gauge for your own DriverShift.'},
                        status=status.HTTP_403_FORBIDDEN,
                    )
            else:
                shift = (
                    DriverShift.objects.select_for_update(of=('self',))
                    .select_related('truck', 'allocation__truck', 'schedule__dumpsite', 'allocation__schedule__dumpsite')
                    .filter(driver=user, is_active=True)
                    .first()
                )
                if not shift:
                    return Response(
                        {'error': 'No active DriverShift found and driver_shift_id was not supplied.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            auth_truck = shift.effective_truck
            auth_dumpsite = shift.effective_dumpsite
            if not auth_truck or not auth_dumpsite:
                return Response(
                    {'error': 'DriverShift must have an authoritative Truck and Dumpsite.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if raw_truck_id not in (None, ''):
                try:
                    if int(raw_truck_id) != auth_truck.id:
                        return Response(
                            {'truck_id': 'Supplied truck_id does not match the authoritative DriverShift truck.'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                except (TypeError, ValueError):
                    return Response({'truck_id': 'Invalid truck_id.'}, status=status.HTTP_400_BAD_REQUEST)

            if raw_dumpsite_id not in (None, ''):
                try:
                    if int(raw_dumpsite_id) != auth_dumpsite.id:
                        return Response(
                            {'dumpsite_id': 'Supplied dumpsite_id does not match the authoritative DriverShift dumpsite.'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                except (TypeError, ValueError):
                    return Response({'dumpsite_id': 'Invalid dumpsite_id.'}, status=status.HTTP_400_BAD_REQUEST)

            now_ts = timezone.now()
            fuel_log = FuelLog.objects.select_for_update().filter(driver_shift=shift).first()
            created = fuel_log is None
            if fuel_log is None:
                fuel_log = FuelLog.objects.create(
                    driver_shift=shift,
                    truck=auth_truck,
                    dumpsite=auth_dumpsite,
                    driver=shift.driver,
                    status='GAUGE_SUBMITTED',
                    gauge_percentage=gauge_pct,
                    gauge_submitted_by=user,
                    gauge_submitted_at=now_ts,
                    notes=notes,
                )
            else:
                fuel_log.truck = auth_truck
                fuel_log.dumpsite = auth_dumpsite
                fuel_log.gauge_percentage = gauge_pct
                fuel_log.gauge_submitted_by = user
                fuel_log.gauge_submitted_at = now_ts
                if notes:
                    fuel_log.notes = notes
                fuel_log.save(update_fields=[
                    'truck', 'dumpsite', 'gauge_percentage', 'gauge_submitted_by',
                    'gauge_submitted_at', 'notes', 'updated_at',
                ])

            _record_truck_audit_log(
                actor=user,
                action_code='FUEL_GAUGE_SUBMITTED',
                target_object_id=str(auth_truck.id),
                details={
                    'fuel_log_id': fuel_log.id,
                    'driver_shift_id': shift.id,
                    'plate_number': auth_truck.plate_number,
                    'dumpsite_id': auth_dumpsite.id,
                    'gauge_percentage': str(gauge_pct),
                },
            )
            return Response(
                self.get_serializer(fuel_log).data,
                status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            )

    @action(
        detail=False,
        methods=['post'],
        url_path='record-refill',
        permission_classes=[permissions.IsAuthenticated, IsAdminOrAssignedDumpsiteOperator],
    )
    def record_refill(self, request):
        from decimal import Decimal, InvalidOperation
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .truck_service import TruckService, _record_truck_audit_log

        raw_shift_id = _pick_present_field(request.data, 'driver_shift_id', 'driver_shift')
        if raw_shift_id is None:
            return Response({'driver_shift_id': 'driver_shift_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if isinstance(raw_shift_id, bool):
            return Response({'driver_shift_id': 'Invalid driver_shift_id.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            shift_id = int(raw_shift_id)
        except (TypeError, ValueError):
            return Response({'driver_shift_id': 'Invalid driver_shift_id.'}, status=status.HTTP_400_BAD_REQUEST)
        if shift_id <= 0:
            return Response(
                {'driver_shift_id': 'driver_shift_id must be a positive integer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_liters = request.data.get('liters_added')
        raw_cost = request.data.get('fuel_cost')
        raw_odometer = request.data.get('odometer_km')
        if raw_liters in (None, '') or raw_cost in (None, '') or raw_odometer in (None, ''):
            return Response(
                {'error': 'liters_added, fuel_cost, and odometer_km are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            liters_added = Decimal(str(raw_liters))
            fuel_cost = Decimal(str(raw_cost))
            odometer_km = Decimal(str(raw_odometer))
        except (InvalidOperation, TypeError, ValueError):
            return Response(
                {'error': 'liters_added, fuel_cost, and odometer_km must be valid numbers.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if liters_added <= Decimal('0'):
            return Response({'liters_added': 'liters_added must be greater than 0.'}, status=status.HTTP_400_BAD_REQUEST)
        if fuel_cost < Decimal('0'):
            return Response({'fuel_cost': 'fuel_cost must be >= 0.'}, status=status.HTTP_400_BAD_REQUEST)
        if odometer_km < Decimal('0'):
            return Response({'odometer_km': 'odometer_km must be >= 0.'}, status=status.HTTP_400_BAD_REQUEST)

        raw_truck_id = _pick_present_field(request.data, 'truck_id', 'truck')
        raw_dumpsite_id = _pick_present_field(request.data, 'dumpsite_id', 'dumpsite')
        notes = (request.data.get('notes') or '').strip()

        with transaction.atomic():
            shift = (
                DriverShift.objects.select_for_update(of=('self',))
                .select_related('truck', 'allocation__truck', 'schedule__dumpsite', 'allocation__schedule__dumpsite', 'driver')
                .filter(pk=shift_id)
                .first()
            )
            if not shift:
                return Response({'driver_shift_id': f'DriverShift #{shift_id} not found.'}, status=status.HTTP_404_NOT_FOUND)

            auth_truck = shift.effective_truck
            auth_dumpsite = shift.effective_dumpsite
            auth_schedule = shift.effective_schedule
            if not auth_truck or not auth_dumpsite:
                return Response(
                    {'error': 'DriverShift must have an authoritative Truck and Dumpsite.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if raw_truck_id not in (None, ''):
                try:
                    if int(raw_truck_id) != auth_truck.id:
                        return Response(
                            {'truck_id': 'Supplied truck_id does not match the authoritative DriverShift truck.'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                except (TypeError, ValueError):
                    return Response({'truck_id': 'Invalid truck_id.'}, status=status.HTTP_400_BAD_REQUEST)

            if raw_dumpsite_id not in (None, ''):
                try:
                    if int(raw_dumpsite_id) != auth_dumpsite.id:
                        return Response(
                            {'dumpsite_id': 'Supplied dumpsite_id does not match the authoritative DriverShift dumpsite.'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                except (TypeError, ValueError):
                    return Response({'dumpsite_id': 'Invalid dumpsite_id.'}, status=status.HTTP_400_BAD_REQUEST)

            try:
                if auth_schedule is not None:
                    TruckService.require_admin_or_facility_operator(request.user, schedule=auth_schedule)
                else:
                    fac_id = TruckService.get_operator_dumpsite_id(request.user)
                    if not is_admin_user(request.user) and fac_id != auth_dumpsite.id:
                        raise DjangoPermissionDenied("Cross-Dumpsite access denied.")
            except DjangoPermissionDenied as e:
                return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)

            now_ts = timezone.now()
            fuel_log = FuelLog.objects.select_for_update().filter(driver_shift=shift).first()
            created = fuel_log is None
            if fuel_log is None:
                fuel_log = FuelLog.objects.create(
                    driver_shift=shift,
                    truck=auth_truck,
                    dumpsite=auth_dumpsite,
                    driver=shift.driver,
                    status='REFILL_RECORDED',
                    liters_added=liters_added,
                    fuel_cost=fuel_cost,
                    odometer_km=odometer_km,
                    recorded_by=request.user,
                    recorded_at=now_ts,
                    notes=notes,
                )
            else:
                fuel_log.truck = auth_truck
                fuel_log.dumpsite = auth_dumpsite
                fuel_log.status = 'REFILL_RECORDED'
                fuel_log.liters_added = liters_added
                fuel_log.fuel_cost = fuel_cost
                fuel_log.odometer_km = odometer_km
                fuel_log.recorded_by = request.user
                fuel_log.recorded_at = now_ts
                if notes:
                    fuel_log.notes = notes
                fuel_log.save(update_fields=[
                    'truck', 'dumpsite', 'status', 'liters_added', 'fuel_cost',
                    'odometer_km', 'recorded_by', 'recorded_at', 'notes', 'updated_at',
                ])

            _record_truck_audit_log(
                actor=request.user,
                action_code='FUEL_REFILL_RECORDED',
                target_object_id=str(auth_truck.id),
                details={
                    'fuel_log_id': fuel_log.id,
                    'driver_shift_id': shift.id,
                    'plate_number': auth_truck.plate_number,
                    'dumpsite_id': auth_dumpsite.id,
                    'liters_added': str(liters_added),
                    'fuel_cost': str(fuel_cost),
                    'odometer_km': str(odometer_km),
                },
            )
            return Response(
                self.get_serializer(fuel_log).data,
                status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            )


class CrewShiftViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Stage 5B Admin citywide oversight for CrewShift records (including pre-departure
    CrewShifts where driver_shift is None). Supports viewing effective attendance,
    roster snapshot, and submitting authorized append-only attendance corrections.
    """
    from .serializers import CrewShiftSerializer

    queryset = CrewShift.objects.select_related(
        'driver_shift',
        'driver_shift__truck',
        'watcher_shift',
        'allocation',
        'allocation__team',
        'allocation__schedule',
        'allocation__truck',
        'schedule',
        'team',
        'team_leader',
        'attendance_submitted_by',
    ).order_by('-service_date', '-started_at', '-id')
    serializer_class = CrewShiftSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]
    pagination_class = StandardResultsSetPagination
    allow_unpaginated = True

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        is_active = params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ('true', '1'))
        team_id = params.get('team_id')
        if team_id:
            qs = qs.filter(Q(team_id=team_id) | Q(allocation__team_id=team_id))
        schedule_id = params.get('schedule_id')
        if schedule_id:
            qs = qs.filter(Q(schedule_id=schedule_id) | Q(allocation__schedule_id=schedule_id))
        service_date = params.get('service_date')
        if service_date:
            qs = qs.filter(service_date=service_date)
        standalone_only = params.get('standalone_only')
        if standalone_only and standalone_only.lower() in ('true', '1'):
            qs = qs.filter(driver_shift__isnull=True)
        return qs

    @action(detail=True, methods=['get'], url_path='attendance')
    def attendance(self, request, pk=None):
        from .shift_service import ShiftService
        cs = self.get_object()
        effective = ShiftService.get_effective_shift_attendance(
            driver_shift_id=cs.driver_shift_id,
            crew_shift_id=cs.id,
        )
        return Response(effective, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='roster-snapshot')
    def roster_snapshot(self, request, pk=None):
        from .serializers import ShiftCrewRosterSnapshotSerializer
        cs = self.get_object()
        snap_q = Q(crew_shift=cs)
        if cs.driver_shift_id:
            snap_q |= Q(driver_shift_id=cs.driver_shift_id)
        snapshot = (
            ShiftCrewRosterSnapshot.objects.filter(snap_q)
            .order_by('-snapshot_timestamp', '-id')
            .first()
        )
        if not snapshot:
            return Response(None, status=status.HTTP_200_OK)
        return Response(ShiftCrewRosterSnapshotSerializer(snapshot).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='attendance-correction')
    def attendance_correction(self, request, pk=None):
        from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
        from .serializers import CrewAttendanceCorrectionSerializer
        from .shift_service import ShiftService

        cs = self.get_object()
        record_id = request.data.get('record_id') or request.data.get('attendance_record_id')
        corrected_status = request.data.get('corrected_status') or request.data.get('new_status')
        reason = request.data.get('reason', '')
        if not record_id or not corrected_status or not str(reason).strip():
            return Response(
                {'error': 'record_id, corrected_status, and reason are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            correction = ShiftService.correct_attendance(
                attendance_record_id=int(record_id),
                corrected_status=corrected_status,
                reason=reason,
                corrected_by=request.user,
                crew_shift_id=cs.id,
            )
            return Response(CrewAttendanceCorrectionSerializer(correction).data, status=status.HTTP_201_CREATED)
        except DjangoPermissionDenied as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except (DjangoValidationError, ValueError) as e:
            return Response(
                e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


