import datetime
import json
from decimal import Decimal

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied, ValidationError as DjangoValidationError
from django.core.paginator import Paginator
from django.db import models, transaction
from django.db.models import Count, Q, Sum, Value
from django.db.models.functions import Greatest
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.models import User, UserRole
from analytics.models import ActivityLog
from driver.models import (
    CollectionSchedule,
    DriverShift,
    FuelLog,
    MaintenanceRecordStatus,
    ScheduleTruckAllocation,
    Truck,
    TruckCrewAssignment,
    TruckMaintenanceRecord,
    TruckOperationalHoldLog,
    TruckReplacementRequest,
)
from driver.truck_service import TruckService
from wastewatch.pagination import StandardResultsSetPagination

from .models import Dumpsite, DumpsiteIncident, DumpsiteTruckInspection, WasteDelivery
from .permissions import (
    IsAdminOrAssignedDumpsiteOperator,
    IsAdminRole,
    IsAssignedDumpsiteOperatorOnly,
    is_admin_user,
)
from .serializers import DumpsiteIncidentSerializer, DumpsiteSerializer, WasteDeliverySerializer


def _facility_shift_q(site_id: int) -> Q:
    return Q(allocation__isnull=False, allocation__schedule__dumpsite_id=site_id) | Q(
        allocation__isnull=True, schedule__dumpsite_id=site_id
    )


def _actor_display(user_obj) -> str:
    if not user_obj:
        return 'System'
    full_name = (getattr(user_obj, 'full_name', '') or '').strip()
    return full_name or getattr(user_obj, 'username', None) or 'System'


def _project_monitoring_state(shift, shift_inspections, eff_truck):
    if shift.is_active:
        if shift.status in ('navigate_to_base', 'confirm_start', 'checkin', 'assignment') or shift.op_status in (
            'heading_to_start',
            'at_base',
            'checking_in',
        ):
            return 'preparing'
        if (
            shift.status == 'end_shift'
            or shift.op_status in ('heading_to_dumpsite', 'at_dumpsite', 'returning_to_base')
            or bool(shift.end_shift_phase)
        ):
            return 'returning'
        return 'operating'

    has_resolved_shift_inspection = any(
        insp.inspection_state in ('PASSED', 'FAILED') for insp in shift_inspections
    )
    truck_pending = bool(eff_truck and eff_truck.inspection_state == 'PENDING_INSPECTION')
    if not has_resolved_shift_inspection or truck_pending:
        return 'awaiting_post_shift_inspection'
    return 'shift_completed'


def _get_awaiting_inspection_trucks(site_id: int, operational_date: datetime.date):
    facility_trucks = list(
        Truck.objects.filter(
            TruckService.facility_trucks_q(site_id, today=operational_date),
            is_retired=False,
        ).order_by('plate_number')
    )
    closed_shifts = list(
        DriverShift.objects.filter(_facility_shift_q(site_id), is_active=False)
        .filter(Q(ended_at__date=operational_date) | Q(ended_at__isnull=True, started_at__date=operational_date))
        .select_related('truck', 'allocation__truck')
    )
    shift_ids = [s.id for s in closed_shifts]
    resolved_shift_ids = set(
        DumpsiteTruckInspection.objects.filter(
            driver_shift_id__in=shift_ids,
            inspection_state__in=['PASSED', 'FAILED'],
        ).values_list('driver_shift_id', flat=True)
    )
    pending_truck_ids_from_shifts = set()
    for shift in closed_shifts:
        if shift.id not in resolved_shift_ids:
            t = shift.effective_truck
            if t and not t.is_retired:
                pending_truck_ids_from_shifts.add(t.id)

    awaiting = []
    seen_ids = set()
    for t in facility_trucks:
        if t.inspection_state == 'PENDING_INSPECTION' or t.id in pending_truck_ids_from_shifts:
            seen_ids.add(t.id)
            awaiting.append(
                {
                    'id': t.id,
                    'truck_id': t.id,
                    'plate_number': t.plate_number,
                    'model': t.model,
                    'inspection_state': t.inspection_state,
                    'mechanical_condition': t.mechanical_condition,
                    'is_operational_hold': t.is_operational_hold,
                }
            )
    if pending_truck_ids_from_shifts - seen_ids:
        extra_trucks = Truck.objects.filter(
            pk__in=(pending_truck_ids_from_shifts - seen_ids),
            is_retired=False,
        ).order_by('plate_number')
        for t in extra_trucks:
            awaiting.append(
                {
                    'id': t.id,
                    'truck_id': t.id,
                    'plate_number': t.plate_number,
                    'model': t.model,
                    'inspection_state': t.inspection_state,
                    'mechanical_condition': t.mechanical_condition,
                    'is_operational_hold': t.is_operational_hold,
                }
            )
    return awaiting


def _collect_facility_activity(
    site: Dumpsite,
    *,
    category: str = 'all',
    date_from=None,
    date_to=None,
    truck_id=None,
    search: str = '',
):
    cat = (category or 'all').strip().lower()
    search_l = (search or '').strip().lower()
    today = timezone.localdate()

    facility_truck_ids = list(
        Truck.objects.filter(TruckService.facility_trucks_q(site.id, today=today)).values_list('id', flat=True)
    )

    events = []

    def _in_window(ts):
        if ts is None:
            return False
        local_dt = timezone.localtime(ts) if timezone.is_aware(ts) else ts
        d = local_dt.date() if hasattr(local_dt, 'date') else local_dt
        if date_from and d < date_from:
            return False
        if date_to and d > date_to:
            return False
        return True

    def _push(event_id, ev_category, ev_action, summary, actor_name, truck_obj, ts):
        if not ts or not _in_window(ts):
            return
        t_id = truck_obj.id if truck_obj else None
        t_plate = truck_obj.plate_number if truck_obj else None
        if truck_id is not None and t_id != truck_id:
            return
        if search_l:
            haystack = ' '.join(
                str(x or '') for x in (ev_category, ev_action, summary, actor_name, t_plate)
            ).lower()
            if search_l not in haystack:
                return
        events.append(
            {
                'id': event_id,
                'category': ev_category,
                'action': ev_action,
                'summary': summary,
                'actor_name': actor_name or 'System',
                'truck_id': t_id,
                'truck_plate': t_plate,
                'timestamp': ts.isoformat(),
                '_sort_ts': ts,
            }
        )

    if cat in ('all', 'delivery'):
        deliveries = (
            WasteDelivery.objects.filter(dumpsite=site)
            .select_related('truck', 'driver', 'dumpsite_operator')
            .order_by('-created_at')
        )
        if truck_id is not None:
            deliveries = deliveries.filter(truck_id=truck_id)
        for d in deliveries[:200]:
            actor = _actor_display(d.dumpsite_operator or d.driver)
            fill_lbl = d.fill_level.replace('_', ' ') if d.fill_level else 'unspecified fill'
            _push(
                f'delivery-{d.id}',
                'delivery',
                'DELIVERY_LOGGED',
                f'Waste delivery logged ({float(d.estimated_kg):g} kg, {fill_lbl})',
                actor,
                d.truck,
                d.created_at,
            )

    if cat in ('all', 'inspection'):
        inspections = (
            DumpsiteTruckInspection.objects.filter(dumpsite=site)
            .select_related('truck', 'submitted_by')
            .order_by('-inspected_at', '-id')
        )
        if truck_id is not None:
            inspections = inspections.filter(truck_id=truck_id)
        for insp in inspections[:200]:
            itype = (insp.inspection_type or 'POST_SHIFT').replace('_', ' ').title()
            note_part = f' - {insp.notes}' if insp.notes else ''
            _push(
                f'inspection-{insp.id}',
                'inspection',
                f'INSPECTION_{insp.inspection_state}',
                f'{itype}: {insp.inspection_state} ({insp.mechanical_condition}){note_part}',
                _actor_display(insp.submitted_by),
                insp.truck,
                insp.inspected_at,
            )

    if cat in ('all', 'hold'):
        holds = (
            TruckOperationalHoldLog.objects.filter(dumpsite=site)
            .select_related('truck', 'placed_by', 'cleared_by')
            .order_by('-placed_at', '-id')
        )
        if truck_id is not None:
            holds = holds.filter(truck_id=truck_id)
        for h in holds[:200]:
            _push(
                f'hold-placed-{h.id}',
                'hold',
                'HOLD_PLACED',
                f'Operational hold placed: {h.reason or "Inspection failure"}',
                _actor_display(h.placed_by),
                h.truck,
                h.placed_at,
            )
            if not h.is_active and h.cleared_at:
                _push(
                    f'hold-cleared-{h.id}',
                    'hold',
                    'HOLD_CLEARED',
                    f'Operational hold cleared: {h.resolution_notes or h.reason}',
                    _actor_display(h.cleared_by),
                    h.truck,
                    h.cleared_at,
                )

    if cat in ('all', 'maintenance'):
        maint_qs = (
            TruckMaintenanceRecord.objects.filter(
                Q(dumpsite=site) | Q(dumpsite__isnull=True, truck_id__in=facility_truck_ids)
            )
            .select_related('truck', 'created_by', 'started_by', 'completed_by')
            .distinct()
            .order_by('-created_at', '-id')
        )
        if truck_id is not None:
            maint_qs = maint_qs.filter(truck_id=truck_id)
        for m in maint_qs[:200]:
            actor = _actor_display(m.completed_by or m.started_by or m.created_by)
            ts = m.completed_at or m.started_at or m.created_at
            _push(
                f'maintenance-{m.id}',
                'maintenance',
                f'MAINTENANCE_{m.status}',
                f'{m.title} ({m.status})',
                actor,
                m.truck,
                ts,
            )

    if cat in ('all', 'fuel'):
        fuels = (
            FuelLog.objects.filter(dumpsite=site)
            .select_related('truck', 'driver', 'gauge_submitted_by', 'recorded_by')
            .order_by('-created_at', '-id')
        )
        if truck_id is not None:
            fuels = fuels.filter(truck_id=truck_id)
        for f in fuels[:200]:
            if f.recorded_at and f.liters_added is not None:
                summary = f'Fuel refill recorded: {float(f.liters_added):g}L (PHP {float(f.fuel_cost or 0):,.2f}, {float(f.odometer_km or 0):g} km)'
                actor = _actor_display(f.recorded_by or f.driver)
                ts = f.recorded_at
            else:
                pct = f'{float(f.gauge_percentage):g}%' if f.gauge_percentage is not None else 'N/A'
                summary = f'Fuel gauge submitted: {pct}'
                actor = _actor_display(f.gauge_submitted_by or f.driver)
                ts = f.gauge_submitted_at or f.created_at
            _push(
                f'fuel-{f.id}',
                'fuel',
                f'FUEL_{f.status}',
                summary,
                actor,
                f.truck,
                ts,
            )

    if cat in ('all', 'allocation'):
        allocs = (
            ScheduleTruckAllocation.objects.filter(schedule__dumpsite=site)
            .select_related('truck', 'schedule', 'allocated_by')
            .order_by('-created_at', '-id')
        )
        if truck_id is not None:
            allocs = allocs.filter(truck_id=truck_id)
        for a in allocs[:200]:
            _push(
                f'alloc-{a.id}',
                'allocation',
                'TRUCK_ALLOCATED',
                f'Truck allocated to {a.schedule.area} for {a.allocation_date}',
                _actor_display(a.allocated_by),
                a.truck,
                a.created_at,
            )

        reps = (
            TruckReplacementRequest.objects.filter(schedule__dumpsite=site)
            .select_related('truck', 'schedule', 'requested_by', 'resolved_by')
            .order_by('-created_at', '-id')
        )
        if truck_id is not None:
            reps = reps.filter(truck_id=truck_id)
        for r in reps[:200]:
            ts = r.resolved_at or r.created_at
            actor = _actor_display(r.resolved_by if r.resolved_at and r.resolved_by else r.requested_by)
            _push(
                f'replacement-{r.id}',
                'allocation',
                f'REPLACEMENT_{r.status}',
                f'Truck replacement {r.status.lower()}: {r.reason}',
                actor,
                r.truck,
                ts,
            )

        # Operator assignment logs for this facility
        op_logs = ActivityLog.objects.filter(module='Dumpsite').select_related('admin').order_by('-timestamp')[:100]
        for log in op_logs:
            try:
                parsed = json.loads(log.details) if log.details else {}
            except Exception:
                parsed = {}
            if parsed.get('dumpsite_id') == site.id:
                ev_name = parsed.get('event', log.action.upper())
                user_email = parsed.get('user_email') or f"User #{parsed.get('user_id')}"
                _push(
                    f'activitylog-{log.id}',
                    'allocation',
                    ev_name,
                    f"{ev_name.replace('_', ' ').title()}: {user_email}",
                    _actor_display(log.admin),
                    None,
                    log.timestamp,
                )

    if cat in ('all', 'shift'):
        shifts = (
            DriverShift.objects.filter(_facility_shift_q(site.id))
            .select_related('truck', 'allocation__truck', 'driver', 'schedule', 'allocation__schedule')
            .order_by('-started_at', '-id')
        )
        if truck_id is not None:
            shifts = shifts.filter(Q(truck_id=truck_id) | Q(allocation__truck_id=truck_id))
        for s in shifts[:200]:
            eff_truck = s.effective_truck
            eff_sched = s.effective_schedule
            area_lbl = eff_sched.area if eff_sched else 'Schedule'
            if s.is_active:
                _push(
                    f'shift-{s.id}',
                    'shift',
                    'SHIFT_ACTIVE',
                    f'Driver shift active on {area_lbl} ({s.op_status})',
                    _actor_display(s.driver),
                    eff_truck,
                    s.started_at,
                )
            else:
                _push(
                    f'shift-{s.id}',
                    'shift',
                    'SHIFT_ENDED',
                    f'Driver shift ended on {area_lbl} ({s.end_reason or "completed"})',
                    _actor_display(s.driver),
                    eff_truck,
                    s.ended_at or s.started_at,
                )

    events.sort(key=lambda item: item['_sort_ts'], reverse=True)
    for item in events:
        item.pop('_sort_ts', None)
    return events


class DumpsiteViewSet(viewsets.ModelViewSet):
    queryset = Dumpsite.objects.select_related('barangay', 'operator').all()
    serializer_class = DumpsiteSerializer

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [permissions.IsAuthenticated()]
        if self.action in [
            'create',
            'update',
            'partial_update',
            'destroy',
            'create_account',
            'reset_capacity',
            'assign_operator',
            'remove_operator',
        ]:
            return [IsAdminRole()]
        if self.action == 'log_arrival':
            return [IsAssignedDumpsiteOperatorOnly()]
        if self.action in [
            'inbound_queue',
            'dashboard',
            'monitoring',
            'activity',
            'deliveries',
            'barangay_breakdown',
        ]:
            return [IsAdminOrAssignedDumpsiteOperator()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        qs = Dumpsite.objects.select_related('barangay', 'operator').all()
        if is_admin_user(user):
            return qs
        if getattr(user, 'role', None) == UserRole.DUMPSITE:
            facility_id = TruckService.get_operator_dumpsite_id(user)
            if not facility_id:
                return qs.none()
            return qs.filter(pk=facility_id)
        return qs

    @action(detail=True, methods=['post'], url_path='create-account', permission_classes=[IsAdminRole])
    def create_account(self, request, pk=None):
        """Create a dumpsite-role user account linked to this site."""
        site = self.get_object()
        data = request.data

        full_name = (data.get('full_name') or '').strip()
        email = (data.get('email') or '').strip().lower()
        password = data.get('password') or ''

        if not full_name:
            return Response({'error': 'Full name is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not email:
            return Response({'error': 'Email is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not password or len(password) < 6:
            return Response({'error': 'Password must be at least 6 characters.'}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(email__iexact=email).exists():
            return Response({'error': 'An account with this email already exists.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            locked_site = Dumpsite.objects.select_for_update().get(pk=site.pk)
            user = User(
                full_name=full_name,
                email=email,
                role=UserRole.DUMPSITE,
                dumpsite=locked_site,
                barangay=locked_site.barangay,
                email_verified=True,
                email_verified_at=timezone.now(),
            )
            user.set_password(password)
            user.save()
            if not locked_site.operator:
                locked_site.operator = user
                locked_site.save(update_fields=['operator'])

        return Response(
            {
                'id': user.id,
                'full_name': user.full_name,
                'email': user.email,
                'role': user.role,
                'dumpsite': site.id,
                'barangay': site.barangay.name if site.barangay else None,
                'is_active': user.is_active,
                'created_at': user.created_at.strftime('%b %d, %Y'),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'], url_path='assign-operator', permission_classes=[IsAdminRole])
    def assign_operator(self, request, pk=None):
        """Admin-only: assign or reassign a dumpsite-role user to this facility."""
        raw_user_id = request.data.get('user_id')
        if raw_user_id in (None, ''):
            return Response({'error': 'user_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            user_id = int(raw_user_id)
        except (TypeError, ValueError):
            return Response({'error': 'Invalid user_id.'}, status=status.HTTP_400_BAD_REQUEST)

        raw_make_primary = request.data.get('make_primary', True)
        if isinstance(raw_make_primary, str):
            make_primary = raw_make_primary.strip().lower() not in ('false', '0', 'no')
        else:
            make_primary = bool(raw_make_primary)

        with transaction.atomic():
            site = (
                Dumpsite.objects.select_for_update()
                .select_related('barangay', 'operator')
                .filter(pk=pk)
                .first()
            )
            if not site:
                return Response({'error': 'Dumpsite not found.'}, status=status.HTTP_404_NOT_FOUND)

            target_user = User.objects.select_for_update().filter(pk=user_id).first()
            if not target_user:
                return Response({'error': f'User #{user_id} not found.'}, status=status.HTTP_404_NOT_FOUND)

            if target_user.role != UserRole.DUMPSITE:
                return Response(
                    {'error': 'Only users with role "dumpsite" may be assigned as dumpsite operators.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            Dumpsite.objects.select_for_update().filter(operator=target_user).exclude(pk=site.pk).update(operator=None)
            target_user.dumpsite = site
            target_user.save(update_fields=['dumpsite'])

            if make_primary or site.operator_id is None:
                site.operator = target_user
                site.save(update_fields=['operator'])

            ActivityLog.objects.create(
                admin=request.user,
                action='update',
                module='Dumpsite',
                details=json.dumps(
                    {
                        'event': 'DUMPSITE_OPERATOR_ASSIGNED',
                        'dumpsite_id': site.id,
                        'dumpsite_name': site.name,
                        'user_id': target_user.id,
                        'user_email': target_user.email,
                        'make_primary': make_primary,
                        'primary_operator_id': site.operator_id,
                    }
                ),
            )

            site.refresh_from_db()
            return Response(
                DumpsiteSerializer(site, context=self.get_serializer_context()).data,
                status=status.HTTP_200_OK,
            )

    @action(detail=True, methods=['post'], url_path='remove-operator', permission_classes=[IsAdminRole])
    def remove_operator(self, request, pk=None):
        """Admin-only: unassign a dumpsite-role user from this facility."""
        raw_user_id = request.data.get('user_id')
        if raw_user_id in (None, ''):
            return Response({'error': 'user_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            user_id = int(raw_user_id)
        except (TypeError, ValueError):
            return Response({'error': 'Invalid user_id.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            site = (
                Dumpsite.objects.select_for_update()
                .select_related('barangay', 'operator')
                .filter(pk=pk)
                .first()
            )
            if not site:
                return Response({'error': 'Dumpsite not found.'}, status=status.HTTP_404_NOT_FOUND)

            target_user = User.objects.select_for_update().filter(pk=user_id).first()
            if not target_user:
                return Response({'error': f'User #{user_id} not found.'}, status=status.HTTP_404_NOT_FOUND)

            if target_user.dumpsite_id != site.id and site.operator_id != target_user.id:
                return Response(
                    {'error': 'User is not assigned to this dumpsite.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if target_user.dumpsite_id == site.id:
                target_user.dumpsite = None
                target_user.save(update_fields=['dumpsite'])

            if site.operator_id == target_user.id:
                site.operator = None
                site.save(update_fields=['operator'])

            ActivityLog.objects.create(
                admin=request.user,
                action='update',
                module='Dumpsite',
                details=json.dumps(
                    {
                        'event': 'DUMPSITE_OPERATOR_REMOVED',
                        'dumpsite_id': site.id,
                        'dumpsite_name': site.name,
                        'user_id': target_user.id,
                        'user_email': target_user.email,
                    }
                ),
            )

            site.refresh_from_db()
            return Response(
                DumpsiteSerializer(site, context=self.get_serializer_context()).data,
                status=status.HTTP_200_OK,
            )

    @action(detail=True, methods=['get'], url_path='dashboard')
    def dashboard(self, request, pk=None):
        """Real facility KPIs, fleet counts, recent deliveries, and recent activity."""
        site = self.get_object()
        today = timezone.localdate()

        today_qs = WasteDelivery.objects.filter(dumpsite=site, date=today)
        today_kg = float(today_qs.aggregate(t=Sum('estimated_kg'))['t'] or 0)
        deliveries_today = today_qs.count()
        trucks_today = today_qs.values('truck').distinct().count()
        barangays_today = today_qs.filter(barangays__isnull=False).values('barangays__name').distinct().count()

        facility_shifts = DriverShift.objects.filter(_facility_shift_q(site.id))
        incoming_trucks = facility_shifts.filter(is_active=True, op_status='heading_to_dumpsite').count()
        returned_trucks = (
            facility_shifts.filter(
                Q(is_active=True, op_status__in=['at_dumpsite', 'returning_to_base'])
                | Q(is_active=False, ended_at__date=today)
            )
            .distinct()
            .count()
        )
        active_driver_shifts = facility_shifts.filter(is_active=True).count()
        completed_driver_shifts_today = (
            facility_shifts.filter(is_active=False)
            .filter(Q(ended_at__date=today) | Q(ended_at__isnull=True, started_at__date=today))
            .distinct()
            .count()
        )

        facility_trucks = Truck.objects.filter(TruckService.facility_trucks_q(site.id, today=today))
        awaiting_trucks = _get_awaiting_inspection_trucks(site.id, today)
        operational_holds = (
            Truck.objects.filter(
                Q(hold_dumpsite=site) | TruckService.facility_trucks_q(site.id, today=today),
                is_operational_hold=True,
            )
            .distinct()
            .count()
        )
        active_maintenance = (
            TruckMaintenanceRecord.objects.filter(
                Q(dumpsite=site) | Q(dumpsite__isnull=True, truck__in=facility_trucks),
                status__in=[MaintenanceRecordStatus.SCHEDULED, MaintenanceRecordStatus.IN_PROGRESS],
            )
            .distinct()
            .count()
        )

        recent = (
            WasteDelivery.objects.filter(dumpsite=site)
            .select_related('truck', 'driver')
            .prefetch_related('barangays')
            .order_by('-created_at')[:5]
        )
        recent_activity = _collect_facility_activity(site)[:8]

        return Response(
            {
                'dumpsite': {
                    'id': site.id,
                    'name': site.name,
                    'type': site.type,
                    'barangay_name': site.barangay.name if site.barangay else None,
                    'latitude': float(site.latitude) if site.latitude is not None else None,
                    'longitude': float(site.longitude) if site.longitude is not None else None,
                    'max_capacity_kg': float(site.max_capacity_kg),
                    'current_fill_kg': float(site.current_fill_kg),
                    'capacity_used': site.fill_percent,
                    'fill_percent': site.fill_percent,
                    'notes': site.notes,
                },
                'operational_date': str(today),
                'summary': {
                    'incoming_trucks': incoming_trucks,
                    'returned_trucks': returned_trucks,
                    'active_driver_shifts': active_driver_shifts,
                    'completed_driver_shifts_today': completed_driver_shifts_today,
                    'awaiting_post_shift_inspection': len(awaiting_trucks),
                    'operational_holds': operational_holds,
                    'active_maintenance': active_maintenance,
                    'deliveries_today': deliveries_today,
                    'kg_received_today': today_kg,
                    'barangays_covered_today': barangays_today,
                },
                'site_name': site.name,
                'fill_percent': site.fill_percent,
                'current_fill_kg': float(site.current_fill_kg),
                'max_capacity_kg': float(site.max_capacity_kg),
                'today_kg': today_kg,
                'trucks_today': trucks_today,
                'barangays_today': barangays_today,
                'recent_deliveries': [
                    {
                        'id': d.id,
                        'truck': d.truck.plate_number,
                        'truck_plate': d.truck.plate_number,
                        'driver': d.driver.full_name,
                        'driver_name': d.driver.full_name,
                        'fill_level': d.fill_level,
                        'estimated_kg': float(d.estimated_kg),
                        'barangay': ', '.join(b.name for b in d.barangays.all()) if d.barangays.exists() else None,
                        'time': d.arrival_time.strftime('%I:%M %p') if d.arrival_time else None,
                        'created_at': d.created_at.isoformat(),
                    }
                    for d in recent
                ],
                'recent_activity': recent_activity,
            }
        )

    @action(detail=True, methods=['get'], url_path='monitoring')
    def monitoring(self, request, pk=None):
        """Read-only incoming truck & DriverShift monitoring across lifecycle states."""
        site = self.get_object()
        today = timezone.localdate()

        raw_date = (request.query_params.get('date') or '').strip()
        if raw_date:
            target_date = parse_date(raw_date)
            if not target_date:
                return Response({'date': 'Invalid date format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            target_date = today

        state_filter = (request.query_params.get('state') or 'all').strip().lower()
        search_q = (request.query_params.get('search') or '').strip().lower()

        date_q = (
            Q(allocation__allocation_date=target_date)
            | Q(started_at__date=target_date)
            | Q(ended_at__date=target_date)
        )
        if target_date == today:
            date_q |= Q(is_active=True)

        shifts = list(
            DriverShift.objects.filter(_facility_shift_q(site.id))
            .filter(date_q)
            .select_related(
                'driver',
                'truck',
                'schedule',
                'allocation',
                'allocation__truck',
                'allocation__schedule',
            )
            .distinct()
            .order_by('-is_active', '-started_at', '-id')
        )

        shift_ids = [s.id for s in shifts]
        inspections_by_shift = {}
        for insp in DumpsiteTruckInspection.objects.filter(driver_shift_id__in=shift_ids).order_by('-inspected_at', '-id'):
            inspections_by_shift.setdefault(insp.driver_shift_id, []).append(insp)

        fuel_by_shift = {
            fl.driver_shift_id: fl
            for fl in FuelLog.objects.filter(driver_shift_id__in=shift_ids)
        }

        counts = {
            'preparing': 0,
            'operating': 0,
            'returning': 0,
            'shift_completed': 0,
            'awaiting_post_shift_inspection': 0,
        }

        projected_rows = []
        for shift in shifts:
            eff_truck = shift.effective_truck
            eff_schedule = shift.effective_schedule
            shift_insps = inspections_by_shift.get(shift.id, [])
            m_state = _project_monitoring_state(shift, shift_insps, eff_truck)

            if search_q:
                haystack = ' '.join(
                    str(v or '')
                    for v in (
                        eff_truck.plate_number if eff_truck else '',
                        eff_truck.model if eff_truck else '',
                        shift.driver.full_name if shift.driver else '',
                        shift.driver.email if shift.driver else '',
                        eff_schedule.area if eff_schedule else '',
                    )
                ).lower()
                if search_q not in haystack:
                    continue

            counts[m_state] += 1
            if state_filter != 'all' and m_state != state_filter:
                continue

            latest_insp = shift_insps[0] if shift_insps else None
            fuel_log = fuel_by_shift.get(shift.id)

            projected_rows.append(
                {
                    'shift_id': shift.id,
                    'monitoring_state': m_state,
                    'shift_status': shift.status,
                    'op_status': shift.op_status,
                    'end_shift_phase': shift.end_shift_phase,
                    'is_active': shift.is_active,
                    'started_at': shift.started_at.isoformat() if shift.started_at else None,
                    'ended_at': shift.ended_at.isoformat() if shift.ended_at else None,
                    'schedule_id': eff_schedule.id if eff_schedule else None,
                    'schedule_name': eff_schedule.area if eff_schedule else None,
                    'truck': {
                        'id': eff_truck.id,
                        'plate_number': eff_truck.plate_number,
                        'model': eff_truck.model,
                        'op_status': eff_truck.op_status,
                        'inspection_state': eff_truck.inspection_state,
                        'mechanical_condition': eff_truck.mechanical_condition,
                        'is_operational_hold': eff_truck.is_operational_hold,
                        'maintenance_status': eff_truck.maintenance_status,
                    }
                    if eff_truck
                    else None,
                    'driver': {
                        'id': shift.driver.id,
                        'full_name': shift.driver.full_name or shift.driver.username,
                        'email': shift.driver.email,
                    }
                    if shift.driver
                    else None,
                    'latest_inspection': {
                        'id': latest_insp.id,
                        'inspection_type': latest_insp.inspection_type,
                        'inspection_state': latest_insp.inspection_state,
                        'mechanical_condition': latest_insp.mechanical_condition,
                        'inspected_at': latest_insp.inspected_at.isoformat() if latest_insp.inspected_at else None,
                    }
                    if latest_insp
                    else None,
                    'latest_fuel_log': {
                        'id': fuel_log.id,
                        'status': fuel_log.status,
                        'gauge_percentage': float(fuel_log.gauge_percentage) if fuel_log.gauge_percentage is not None else None,
                        'liters_added': float(fuel_log.liters_added) if fuel_log.liters_added is not None else None,
                        'fuel_cost': float(fuel_log.fuel_cost) if fuel_log.fuel_cost is not None else None,
                        'odometer_km': float(fuel_log.odometer_km) if fuel_log.odometer_km is not None else None,
                    }
                    if fuel_log
                    else None,
                }
            )

        try:
            page_size = min(max(int(request.query_params.get('page_size', 10)), 1), 100)
        except (TypeError, ValueError):
            page_size = 10
        try:
            page_num = max(int(request.query_params.get('page', 1)), 1)
        except (TypeError, ValueError):
            page_num = 1

        paginator = Paginator(projected_rows, page_size)
        page_obj = paginator.get_page(page_num)

        return Response(
            {
                'operational_date': str(target_date),
                'counts': counts,
                'awaiting_inspection_trucks': _get_awaiting_inspection_trucks(site.id, target_date),
                'count': paginator.count,
                'total_pages': paginator.num_pages,
                'current_page': page_obj.number,
                'page_size': page_size,
                'results': list(page_obj.object_list),
            }
        )

    @action(detail=True, methods=['get'], url_path='activity')
    def activity(self, request, pk=None):
        """Paginated, filterable facility activity timeline."""
        site = self.get_object()
        params = request.query_params

        category = (params.get('category') or 'all').strip().lower()
        search = (params.get('search') or '').strip()

        raw_from = (params.get('date_from') or '').strip()
        raw_to = (params.get('date_to') or '').strip()
        date_from = parse_date(raw_from) if raw_from else None
        date_to = parse_date(raw_to) if raw_to else None
        if raw_from and not date_from:
            return Response({'date_from': 'Invalid date_from format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
        if raw_to and not date_to:
            return Response({'date_to': 'Invalid date_to format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)

        raw_truck_id = (params.get('truck_id') or '').strip()
        truck_id = None
        if raw_truck_id:
            try:
                truck_id = int(raw_truck_id)
            except (TypeError, ValueError):
                return Response({'truck_id': 'Invalid truck_id.'}, status=status.HTTP_400_BAD_REQUEST)

        events = _collect_facility_activity(
            site,
            category=category,
            date_from=date_from,
            date_to=date_to,
            truck_id=truck_id,
            search=search,
        )

        try:
            page_size = min(max(int(params.get('page_size', 10)), 1), 100)
        except (TypeError, ValueError):
            page_size = 10
        try:
            page_num = max(int(params.get('page', 1)), 1)
        except (TypeError, ValueError):
            page_num = 1

        paginator = Paginator(events, page_size)
        page_obj = paginator.get_page(page_num)

        return Response(
            {
                'count': paginator.count,
                'total_pages': paginator.num_pages,
                'current_page': page_obj.number,
                'page_size': page_size,
                'next': None,
                'previous': None,
                'results': list(page_obj.object_list),
            }
        )

    @action(detail=True, methods=['get'], url_path='inbound_queue')
    def inbound_queue(self, request, pk=None):
        """Trucks with op_status in ('heading_to_dumpsite', 'at_dumpsite') — the incoming queue."""
        site = self.get_object()

        if getattr(request.user, 'role', None) == UserRole.DUMPSITE and not is_admin_user(request.user):
            facility_id = TruckService.get_operator_dumpsite_id(request.user)
            if facility_id != site.id:
                return Response({'detail': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        from datetime import timedelta
        from watcher.stop_validation_utils import haversine_m

        cutoff_heading = timezone.now() - timedelta(minutes=5)
        cutoff_at = timezone.now() - timedelta(minutes=60)
        shifts = DriverShift.objects.filter(
            _facility_shift_q(site.id),
            Q(op_status='heading_to_dumpsite', last_location_update__gte=cutoff_heading)
            | Q(op_status='at_dumpsite', last_location_update__gte=cutoff_at),
            is_active=True,
            is_extended_mode=False,
        ).select_related(
            'driver',
            'truck',
            'schedule',
            'allocation',
            'allocation__truck',
            'allocation__schedule',
        ).prefetch_related(
            'schedule__barangays',
            'allocation__schedule__barangays',
        )

        data = []
        for shift in shifts:
            schedule = shift.effective_schedule
            eff_truck = shift.effective_truck

            eta_min = eta_max = None
            if shift.current_latitude and shift.current_longitude and site.latitude and site.longitude:
                try:
                    dist_m = haversine_m(
                        float(shift.current_latitude),
                        float(shift.current_longitude),
                        float(site.latitude),
                        float(site.longitude),
                    )
                    if dist_m <= 300 or shift.op_status == 'at_dumpsite':
                        eta_min = eta_max = 0
                    else:
                        dist_km = (dist_m / 1000.0) * 1.3
                        mins = dist_km / 20.0 * 60
                        if mins < 5:
                            eta_min, eta_max = 0, 5
                        else:
                            eta_min, eta_max = round(mins * 0.85), round(mins * 1.15)
                except (ValueError, TypeError):
                    pass

            data.append(
                {
                    'shift_id': shift.id,
                    'driver': shift.driver.full_name,
                    'driver_id': shift.driver.id,
                    'truck_plate': eff_truck.plate_number if eff_truck else 'Unknown',
                    'truck_id': eff_truck.id if eff_truck else None,
                    'truck_max_capacity_kg': float(eff_truck.max_capacity_kg) if eff_truck else 1000.0,
                    'truck_lat': float(shift.current_latitude) if shift.current_latitude else None,
                    'truck_lng': float(shift.current_longitude) if shift.current_longitude else None,
                    'site_lat': float(site.latitude) if site.latitude else None,
                    'site_lng': float(site.longitude) if site.longitude else None,
                    'barangays': [b.name for b in schedule.barangays.all()] if schedule else [],
                    'barangay_ids': [b.id for b in schedule.barangays.all()] if schedule else [],
                    'schedule_id': schedule.id if schedule else None,
                    'op_status': shift.op_status,
                    'started_at': shift.started_at.isoformat(),
                    'eta_min': eta_min,
                    'eta_max': eta_max,
                    'last_fix': shift.last_location_update.isoformat() if shift.last_location_update else None,
                }
            )

        data.sort(key=lambda x: x['eta_min'] if x['eta_min'] is not None else 999)
        return Response(data)

    @action(detail=True, methods=['get'], url_path='deliveries')
    def deliveries(self, request, pk=None):
        """Paginated + filtered WasteDelivery records for this dumpsite."""
        site = self.get_object()
        qs = (
            WasteDelivery.objects.filter(dumpsite=site)
            .select_related('truck', 'driver')
            .prefetch_related('barangays')
            .order_by('-created_at')
        )

        p = request.query_params
        if p.get('date_from'):
            qs = qs.filter(date__gte=p['date_from'])
        if p.get('date_to'):
            qs = qs.filter(date__lte=p['date_to'])
        if p.get('truck'):
            qs = qs.filter(truck__plate_number__icontains=p['truck'])
        if p.get('barangay'):
            qs = qs.filter(barangays__name__icontains=p['barangay'])
        if p.get('fill_level'):
            qs = qs.filter(fill_level=p['fill_level'])

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            serializer = WasteDeliverySerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)
        serializer = WasteDeliverySerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='log_arrival')
    def log_arrival(self, request, pk=None):
        """Create a WasteDelivery, atomically increment dumpsite fill."""
        if getattr(request.user, 'role', None) != UserRole.DUMPSITE or is_admin_user(request.user):
            return Response(
                {'detail': 'Only assigned Dumpsite Operators can log truck arrivals. Administrators have read-only monitoring access.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        site = get_object_or_404(Dumpsite.objects.select_related('barangay', 'operator'), pk=pk)
        self.check_object_permissions(request, site)
        data = request.data.copy()
        data['dumpsite'] = site.id
        data['dumpsite_operator'] = request.user.id

        date_str = str(timezone.localdate())
        data.setdefault('date', date_str)
        data.setdefault('arrival_time', timezone.now().strftime('%H:%M:%S'))

        truck_obj = None
        if data.get('truck'):
            try:
                truck_obj = Truck.objects.filter(pk=int(data['truck'])).first()
            except (TypeError, ValueError):
                return Response({'truck': 'Invalid truck ID.'}, status=status.HTTP_400_BAD_REQUEST)
            if not truck_obj:
                return Response({'truck': f"Truck #{data['truck']} not found."}, status=status.HTTP_404_NOT_FOUND)

        sched_obj = None
        if data.get('schedule'):
            try:
                sched_obj = CollectionSchedule.objects.filter(pk=int(data['schedule'])).first()
            except (TypeError, ValueError):
                return Response({'schedule': 'Invalid schedule ID.'}, status=status.HTTP_400_BAD_REQUEST)
            if not sched_obj:
                return Response({'schedule': f"Schedule #{data['schedule']} not found."}, status=status.HTTP_404_NOT_FOUND)
            if sched_obj.dumpsite_id is None:
                return Response(
                    {'schedule': 'Schedule has no assigned dumpsite facility.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if sched_obj.dumpsite_id != site.id:
                return Response(
                    {'error': 'Cross-Dumpsite access denied: schedule belongs to another facility.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if not is_admin_user(request.user):
            try:
                TruckService.require_admin_or_facility_operator(
                    request.user, truck=truck_obj, schedule=sched_obj
                )
            except DjangoPermissionDenied as e:
                return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)

        if truck_obj:
            active_shift = (
                DriverShift.objects.filter(
                    Q(truck=truck_obj) | Q(allocation__truck=truck_obj),
                    is_active=True,
                )
                .select_related('driver', 'schedule', 'allocation__schedule')
                .first()
            )
            assignment = TruckCrewAssignment.objects.filter(
                truck=truck_obj, date=date_str, is_active=True
            ).first()

            # Driver resolution order: explicit param -> active DriverShift -> TruckCrewAssignment -> truck.drivers.first()
            if not data.get('driver'):
                if active_shift and active_shift.driver_id:
                    data['driver'] = active_shift.driver_id
                elif assignment and assignment.driver_id:
                    data['driver'] = assignment.driver_id
                else:
                    first_driver = truck_obj.drivers.order_by('id').first()
                    if first_driver:
                        data['driver'] = first_driver.id

            if not data.get('schedule'):
                if active_shift and active_shift.effective_schedule and (
                    active_shift.effective_schedule.dumpsite_id == site.id
                ):
                    data['schedule'] = active_shift.effective_schedule.id
                elif assignment and assignment.schedule_id and (
                    assignment.schedule.dumpsite_id == site.id
                ):
                    data['schedule'] = assignment.schedule_id

            if assignment and not data.get('crew_assignment'):
                data['crew_assignment'] = assignment.id

            if not data.get('schedule') and data.get('driver'):
                sched = (
                    CollectionSchedule.objects.filter(
                        driver_id=data['driver'], dumpsite=site, date=date_str
                    ).first()
                    or CollectionSchedule.objects.filter(
                        driver_id=data['driver'], dumpsite=site
                    ).first()
                )
                if sched:
                    data['schedule'] = sched.id

        serializer = WasteDeliverySerializer(data=data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            locked_site = Dumpsite.objects.select_for_update().get(pk=site.pk)
            delivery = serializer.save(dumpsite_operator=request.user)
            Dumpsite.objects.filter(pk=locked_site.pk).update(
                current_fill_kg=models.F('current_fill_kg') + delivery.estimated_kg
            )
            shift = (
                DriverShift.objects.select_for_update()
                .filter(driver=delivery.driver, is_active=True)
                .first()
            )
            if shift and shift.op_status in ['heading_to_dumpsite', 'at_dumpsite']:
                shift.op_status = 'returning_to_base'
                shift.save(update_fields=['op_status'])
        return Response(WasteDeliverySerializer(delivery).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='barangay_breakdown')
    def barangay_breakdown(self, request, pk=None):
        """Per-barangay estimated_kg totals for day / week / month."""
        site = self.get_object()
        period = request.query_params.get('period', 'day')
        today = timezone.localdate()

        if period == 'week':
            start = today - datetime.timedelta(days=today.weekday())
        elif period == 'month':
            start = today.replace(day=1)
        else:
            start = today

        rows = (
            WasteDelivery.objects.filter(dumpsite=site, date__gte=start)
            .values('barangays__name')
            .annotate(total_kg=Sum('estimated_kg'), truck_count=Count('truck', distinct=True))
            .order_by('-total_kg')
        )
        return Response(
            [
                {
                    'barangay': r['barangays__name'] or 'Unknown',
                    'total_kg': float(r['total_kg'] or 0),
                    'truck_count': r['truck_count'],
                }
                for r in rows
            ]
        )

    @action(detail=True, methods=['post'], url_path='reset_capacity', permission_classes=[IsAdminRole])
    def reset_capacity(self, request, pk=None):
        """Admin-only: reset current_fill_kg to 0 (dumpsite cleared)."""
        site = self.get_object()
        site.current_fill_kg = 0
        site.capacity_used = 0
        site.save(update_fields=['current_fill_kg', 'capacity_used'])
        return Response({'status': 'reset', 'current_fill_kg': 0})


class WasteDeliveryViewSet(viewsets.ModelViewSet):
    queryset = WasteDelivery.objects.select_related(
        'truck', 'driver', 'dumpsite', 'dumpsite_operator', 'schedule'
    ).prefetch_related('barangays').all()
    serializer_class = WasteDeliverySerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAssignedDumpsiteOperatorOnly()]
        if self.action == 'analytics':
            return [IsAdminOrAssignedDumpsiteOperator()]
        return [permissions.IsAuthenticated()]

    def get_object(self):
        if self.action in ('update', 'partial_update', 'destroy'):
            lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
            filter_kwargs = {self.lookup_field: self.kwargs[lookup_url_kwarg]}
            obj = get_object_or_404(self.queryset, **filter_kwargs)
            self.check_object_permissions(self.request, obj)
            return obj
        return super().get_object()

    def get_queryset(self):
        qs, u = super().get_queryset(), self.request.user
        if is_admin_user(u):
            return qs.order_by('-created_at')
        role = getattr(u, 'role', None)
        if role == UserRole.DUMPSITE:
            facility_id = TruckService.get_operator_dumpsite_id(u)
            return qs.filter(dumpsite_id=facility_id).order_by('-created_at') if facility_id else qs.none()
        if role == UserRole.DRIVER:
            return qs.filter(driver=u).order_by('-created_at')
        return qs.none()

    def perform_create(self, serializer):
        u = self.request.user
        if getattr(u, 'role', None) != UserRole.DUMPSITE or is_admin_user(u):
            raise PermissionDenied('Only assigned Dumpsite Operators can log waste deliveries. Administrators have read-only access.')
        vdata = serializer.validated_data
        target_dumpsite = vdata.get('dumpsite')
        target_schedule = vdata.get('schedule')
        target_truck = vdata.get('truck')

        facility_id = TruckService.get_operator_dumpsite_id(u)
        if not facility_id:
            raise PermissionDenied('Assigned Dumpsite Operator role required.')
        if target_dumpsite and target_dumpsite.id != facility_id:
            raise PermissionDenied('Cross-Dumpsite access denied: delivery belongs to another facility.')
        if target_schedule and target_schedule.dumpsite_id is not None and target_schedule.dumpsite_id != facility_id:
            raise PermissionDenied('Cross-Dumpsite access denied: schedule belongs to another facility.')
        try:
            TruckService.require_admin_or_facility_operator(
                u, truck=target_truck, schedule=target_schedule
            )
        except DjangoPermissionDenied as e:
            raise PermissionDenied(str(e))

        extra = {'dumpsite_id': facility_id, 'dumpsite_operator': u}

        with transaction.atomic():
            locked_site = Dumpsite.objects.select_for_update().get(pk=facility_id)
            delivery = serializer.save(**extra)
            added_kg = delivery.estimated_kg or Decimal('0.00')
            if added_kg != Decimal('0.00'):
                Dumpsite.objects.filter(pk=locked_site.pk).update(
                    current_fill_kg=models.F('current_fill_kg') + added_kg
                )
            shift = (
                DriverShift.objects.select_for_update()
                .filter(driver=delivery.driver, is_active=True)
                .first()
            )
            if shift and shift.op_status in ['heading_to_dumpsite', 'at_dumpsite']:
                shift.op_status = 'returning_to_base'
                shift.save(update_fields=['op_status'])

    def perform_update(self, serializer):
        u = self.request.user
        if getattr(u, 'role', None) != UserRole.DUMPSITE or is_admin_user(u):
            raise PermissionDenied('Only assigned Dumpsite Operators can modify waste deliveries. Administrators have read-only access.')
        instance = serializer.instance
        vdata = serializer.validated_data
        target_dumpsite = vdata.get('dumpsite', instance.dumpsite)
        target_schedule = vdata.get('schedule', instance.schedule)
        target_truck = vdata.get('truck', instance.truck)

        facility_id = TruckService.get_operator_dumpsite_id(u)
        if not facility_id or instance.dumpsite_id != facility_id:
            raise PermissionDenied('Cross-Dumpsite access denied.')
        if target_dumpsite and target_dumpsite.id != facility_id:
            raise PermissionDenied('Cross-Dumpsite access denied: cannot reassign delivery to another facility.')
        if target_schedule and target_schedule.dumpsite_id is not None and target_schedule.dumpsite_id != facility_id:
            raise PermissionDenied('Cross-Dumpsite access denied: schedule belongs to another facility.')
        try:
            TruckService.require_admin_or_facility_operator(
                u, truck=target_truck, schedule=target_schedule
            )
        except DjangoPermissionDenied as e:
            raise PermissionDenied(str(e))

        with transaction.atomic():
            locked_site = Dumpsite.objects.select_for_update().get(pk=instance.dumpsite_id)
            old_kg = instance.estimated_kg or Decimal('0.00')
            updated = serializer.save(
                dumpsite_id=facility_id,
                dumpsite_operator=instance.dumpsite_operator or u,
            )
            new_kg = updated.estimated_kg or Decimal('0.00')
            delta = new_kg - old_kg
            if delta != Decimal('0.00'):
                Dumpsite.objects.filter(pk=locked_site.pk).update(
                    current_fill_kg=Greatest(models.F('current_fill_kg') + delta, Value(Decimal('0.00')))
                )

    def perform_destroy(self, instance):
        u = self.request.user
        if getattr(u, 'role', None) != UserRole.DUMPSITE or is_admin_user(u):
            raise PermissionDenied('Only assigned Dumpsite Operators can delete waste deliveries. Administrators have read-only access.')
        facility_id = TruckService.get_operator_dumpsite_id(u)
        if not facility_id or instance.dumpsite_id != facility_id:
            raise PermissionDenied('Cross-Dumpsite access denied.')
        with transaction.atomic():
            locked_site = Dumpsite.objects.select_for_update().get(pk=instance.dumpsite_id)
            old_kg = instance.estimated_kg or Decimal('0.00')
            instance.delete()
            if old_kg != Decimal('0.00'):
                Dumpsite.objects.filter(pk=locked_site.pk).update(
                    current_fill_kg=Greatest(models.F('current_fill_kg') - old_kg, Value(Decimal('0.00')))
                )

    @action(detail=False, methods=['get'], url_path='analytics')
    def analytics(self, request):
        """Aggregated net_weight by day/week/month for dashboard charts."""
        today = timezone.localdate()
        start_week = today - datetime.timedelta(days=today.weekday())
        start_month = today.replace(day=1)

        u = request.user
        base = WasteDelivery.objects.filter(is_validated=True)
        if not is_admin_user(u):
            facility_id = TruckService.get_operator_dumpsite_id(u)
            if not facility_id:
                base = base.none()
            else:
                base = base.filter(dumpsite_id=facility_id)

        return Response(
            {
                'today': base.filter(date=today).aggregate(kg=Sum('net_weight'), trips=Count('id')),
                'week': base.filter(date__gte=start_week).aggregate(kg=Sum('net_weight'), trips=Count('id')),
                'month': base.filter(date__gte=start_month).aggregate(kg=Sum('net_weight'), trips=Count('id')),
                'by_barangay': list(
                    base.filter(date__gte=start_month)
                    .values('barangays__name')
                    .annotate(kg=Sum('net_weight'), trips=Count('id'))
                    .order_by('-kg')[:10]
                ),
                'by_truck': list(
                    base.filter(date__gte=start_month)
                    .values('truck__plate_number', 'driver__full_name')
                    .annotate(kg=Sum('net_weight'), trips=Count('id'))
                    .order_by('-kg')[:10]
                ),
            }
        )


class DumpsiteIncidentViewSet(viewsets.ModelViewSet):
    queryset = DumpsiteIncident.objects.select_related('delivery', 'delivery__dumpsite', 'reported_by').all()
    serializer_class = DumpsiteIncidentSerializer

    def get_permissions(self):
        return [IsAdminOrAssignedDumpsiteOperator()]

    def get_queryset(self):
        qs = super().get_queryset()
        u = self.request.user
        if is_admin_user(u):
            pass
        elif getattr(u, 'role', None) == UserRole.DUMPSITE:
            facility_id = TruckService.get_operator_dumpsite_id(u)
            if facility_id:
                qs = qs.filter(delivery__dumpsite_id=facility_id)
            else:
                qs = qs.none()
        else:
            qs = qs.none()

        delivery_id = self.request.query_params.get('delivery')
        if delivery_id:
            qs = qs.filter(delivery_id=delivery_id)
        return qs

    def perform_create(self, serializer):
        u = self.request.user
        delivery = serializer.validated_data.get('delivery')
        if not is_admin_user(u):
            facility_id = TruckService.get_operator_dumpsite_id(u)
            if not facility_id or not delivery or delivery.dumpsite_id != facility_id:
                raise PermissionDenied('Cross-Dumpsite access denied: delivery belongs to another facility.')
        serializer.save(reported_by=u)

    def perform_update(self, serializer):
        u = self.request.user
        instance = serializer.instance
        delivery = serializer.validated_data.get('delivery', instance.delivery)
        if not is_admin_user(u):
            facility_id = TruckService.get_operator_dumpsite_id(u)
            if (
                not facility_id
                or instance.delivery.dumpsite_id != facility_id
                or not delivery
                or delivery.dumpsite_id != facility_id
            ):
                raise PermissionDenied('Cross-Dumpsite access denied.')
        serializer.save()

    def perform_destroy(self, instance):
        u = self.request.user
        if not is_admin_user(u):
            facility_id = TruckService.get_operator_dumpsite_id(u)
            if not facility_id or instance.delivery.dumpsite_id != facility_id:
                raise PermissionDenied('Cross-Dumpsite access denied.')
        instance.delete()
