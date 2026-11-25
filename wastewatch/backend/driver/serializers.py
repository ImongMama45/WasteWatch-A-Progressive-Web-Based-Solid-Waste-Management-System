from rest_framework import serializers
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
    ShiftCrewRosterItem,
    CrewAttendanceRecord,
    CrewAttendanceCorrection,
    UnfinishedStopReview,
    TruckReplacementRequest,
    TruckOperationalHoldLog,
    TruckMaintenanceRecord,
    FuelLog,
    is_truck_dispatchable,
)
from dumpsite.serializers import TruckFillEstimateSerializer
from django.contrib.auth import get_user_model
from accounts.models import UserRole, EmployeeType
from .models import TruckStatus

User = get_user_model()


def _user_display_name(user):
    if not user:
        return None
    full_name = (getattr(user, 'full_name', '') or '').strip()
    return full_name or getattr(user, 'username', None)

class TruckSerializer(serializers.ModelSerializer):
    driver_details = serializers.SerializerMethodField()
    crew_names = serializers.SlugRelatedField(
        many=True,
        read_only=True,
        slug_field='full_name',
        source='crew'
    )
    drivers = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=User.objects.filter(role=UserRole.DRIVER),
        required=False
    )
    crew = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=User.objects.filter(employee_type=EmployeeType.CREW_MEMBER),
        required=False
    )
    fill_estimates = TruckFillEstimateSerializer(many=True, read_only=True)
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Truck
        fields = '__all__'
        read_only_fields = [
            'maintenance_start',
            'past_crew_names',
            'created_at',
            'current_capacity',
            'commissioning_provenance',
            'retirement_state',
            'commissioned_at',
            'is_retired',
            'mechanical_status',
            'maintenance_status',
            'is_operational_hold',
            'last_inspected_dumpsite',
            'hold_dumpsite',
            'hold_placed_by',
            'hold_placed_at',
            'hold_reason',
        ]

    def validate(self, attrs):
        from rest_framework.exceptions import ValidationError
        
        instance = self.instance
        old_status = instance.status if instance else None
        new_status = attrs.get('status', old_status or TruckStatus.ACTIVE)

        if instance and instance.is_retired:
            if new_status == TruckStatus.ACTIVE or attrs.get('drivers') or attrs.get('crew'):
                raise ValidationError('Retired trucks cannot be reactivated or assigned drivers or crew.')
        
        if 'drivers' in attrs and len(attrs['drivers']) > 2:
            raise ValidationError({'drivers': 'A truck can have at most 2 drivers.'})
            
        if new_status == TruckStatus.INACTIVE and (attrs.get('drivers') or attrs.get('crew')):
            raise ValidationError('Inactive trucks cannot have drivers or crew assigned.')
            
        # Skip conflict check unless active AND (people changed OR reactivating)
        if new_status != TruckStatus.ACTIVE:
            return attrs
        if not ('drivers' in attrs or 'crew' in attrs or (old_status is not None and old_status != TruckStatus.ACTIVE)):
            return attrs
            
        drivers = attrs['drivers'] if 'drivers' in attrs else (list(instance.drivers.all()) if instance else [])
        crew = attrs['crew'] if 'crew' in attrs else (list(instance.crew.all()) if instance else [])
        
        # Lock user rows
        ids = set(d.pk for d in drivers) | set(c.pk for c in crew)
        if ids:
            list(User.objects.select_for_update().filter(pk__in=ids).order_by('pk').values_list('pk', flat=True))
            
        errors = {}
        # Rule: at most 1 active truck
        if drivers:
            driver_errs = []
            for d in drivers:
                clash = Truck.objects.filter(status=TruckStatus.ACTIVE, drivers=d)
                if instance:
                    clash = clash.exclude(pk=instance.pk)
                clash = clash.first()
                if clash:
                    driver_errs.append(f"{d.full_name} is already assigned to active truck {clash.plate_number}.")
            if driver_errs:
                errors['drivers'] = driver_errs
                
        if crew:
            crew_errs = []
            for c in crew:
                clash = Truck.objects.filter(status=TruckStatus.ACTIVE, crew=c)
                if instance:
                    clash = clash.exclude(pk=instance.pk)
                clash = clash.first()
                if clash:
                    crew_errs.append(f"{c.full_name} is already assigned to active truck {clash.plate_number}.")
            if crew_errs:
                errors['crew'] = crew_errs
                
        if errors:
            raise ValidationError(errors)
            
        return attrs

    def get_photo_url(self, obj):
        if obj.photo:
            try:
                return obj.photo.url
            except Exception:
                return None
        return None

    def get_driver_details(self, obj):
        details = []
        # Pre-fetch might be needed here, but since it's a small app, this is fine.
        for d in obj.drivers.all():
            # last service
            last_shift = obj.shifts.filter(driver=d, is_active=False, ended_at__isnull=False).order_by('-ended_at').first()
            last_service = last_shift.ended_at.strftime('%Y-%m-%d') if last_shift else None
            
            # barangays
            barangays = set()
            for schedule in obj.schedules.filter(driver=d):
                for b in schedule.barangays.all():
                    barangays.add(b.name)
            assigned_barangays = ", ".join(sorted(list(barangays))) if barangays else "No routes assigned"
            
            # schedules
            descs = []
            for s in obj.schedules.filter(driver=d):
                days = s.days or "Daily"
                start = s.start_time.strftime('%I:%M %p') if s.start_time else ''
                end = s.end_time.strftime('%I:%M %p') if s.end_time else ''
                if start and end:
                    descs.append(f"{days} | {start} - {end}")
                else:
                    descs.append(f"{days} | OFF")
            
            details.append({
                'id': d.id,
                'full_name': d.full_name,
                'last_service': last_service,
                'assigned_barangays': assigned_barangays,
                'schedule_description': descs
            })
        return details

class HomeBaseSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(max_length=120, required=False, allow_blank=True, default='')
    apply_to_existing = serializers.BooleanField(required=False, default=False)

class CollectionScheduleSerializer(serializers.ModelSerializer):
    truck_plate    = serializers.CharField(source='truck.plate_number', read_only=True)
    driver_name    = serializers.CharField(source='driver.full_name',   read_only=True)
    default_team_name = serializers.CharField(source='default_team.name', read_only=True)
    default_team_code = serializers.CharField(source='default_team.code', read_only=True)
    effective_team_leader_id = serializers.SerializerMethodField()
    effective_team_leader_name = serializers.SerializerMethodField()
    effective_team_leader_role = serializers.SerializerMethodField()
    dumpsite_name  = serializers.CharField(source='dumpsite.name',      read_only=True)
    dumpsite_detail = serializers.SerializerMethodField()
    barangay_names = serializers.SerializerMethodField()
    waypoints_display = serializers.SerializerMethodField()  # renamed — read-only enriched version
    completed_stops = serializers.SerializerMethodField()
    total_stops = serializers.SerializerMethodField()
    truck_status = serializers.SerializerMethodField()
    missed_stops_collected = serializers.SerializerMethodField()

    class Meta:
        model  = CollectionSchedule
        fields = '__all__'  # 'waypoints' (the raw JSONField) is now included automatically
        read_only_fields = ['default_team']

    def validate(self, attrs):
        from rest_framework.exceptions import ValidationError
        from django.contrib.auth import get_user_model
        from django.db.models import Q
        from .models import Truck
        from .crew_resolver import normalize_days
        
        User = get_user_model()
        instance = self.instance
        
        truck = attrs.get('truck', getattr(instance, 'truck', None)) if 'truck' in attrs else getattr(instance, 'truck', None)
        driver = attrs.get('driver', getattr(instance, 'driver', None)) if 'driver' in attrs else getattr(instance, 'driver', None)
        days = attrs.get('days', getattr(instance, 'days', '')) if 'days' in attrs else getattr(instance, 'days', '')
        start_time = attrs.get('start_time', getattr(instance, 'start_time', None)) if 'start_time' in attrs else getattr(instance, 'start_time', None)
        end_time = attrs.get('end_time', getattr(instance, 'end_time', None)) if 'end_time' in attrs else getattr(instance, 'end_time', None)
        
        truck_changed = not instance or ('truck' in attrs and attrs['truck'] != instance.truck)
        driver_changed = not instance or ('driver' in attrs and attrs['driver'] != instance.driver)
        
        errors = {}
        
        if not instance:
            if not truck:
                errors['truck'] = 'Select a truck.'
            if not driver:
                errors['driver'] = 'Select a driver.'
                
        if truck and truck_changed and not is_truck_dispatchable(truck):
            errors['truck'] = (
                f"Truck {truck.plate_number} is not dispatchable and cannot be scheduled "
                f"(status={truck.status}, retirement_state={truck.retirement_state}, "
                f"hold={truck.is_operational_hold}, mechanical_status={truck.mechanical_status}, "
                f"maintenance_status={truck.maintenance_status})."
            )
            
        if truck and driver and (truck_changed or driver_changed):
            if not truck.drivers.filter(id=driver.id).exists():
                errors['driver'] = f"{driver.full_name} is not assigned to truck {truck.plate_number}. Assign them in Truck Management first."
                
        if start_time and end_time and end_time <= start_time:
            errors['end_time'] = 'End time must be after start time.'

        if instance is not None and 'dumpsite' in attrs:
            new_dumpsite = attrs.get('dumpsite')
            if new_dumpsite != instance.dumpsite:
                from django.utils import timezone
                has_active_or_today = (
                    ScheduleTruckAllocation.objects.filter(
                        schedule=instance,
                        allocation_date__gte=timezone.localdate(),
                    ).exists()
                    or DriverShift.objects.filter(
                        Q(schedule=instance) | Q(allocation__schedule=instance),
                        is_active=True,
                    ).exists()
                )
                if has_active_or_today:
                    errors['dumpsite'] = (
                        'Cannot change or clear dumpsite on a schedule with active shifts or current/upcoming truck allocations.'
                    )

        if errors:
            raise ValidationError(errors)
            
        # Overlap check
        if not instance or any(k in attrs for k in ['truck', 'driver', 'days', 'start_time', 'end_time']):
            if truck and driver:
                list(Truck.objects.select_for_update().filter(pk=truck.pk).values_list('pk', flat=True))
                list(User.objects.select_for_update().filter(pk=driver.pk).values_list('pk', flat=True))
                
                new_days = normalize_days(days)
                if new_days and start_time and end_time:
                    qs = CollectionSchedule.objects.exclude(status='CANCELLED').filter(
                        Q(truck=truck) | Q(driver=driver)
                    )
                    if instance:
                        qs = qs.exclude(pk=instance.pk)
                    
                    for ex in qs:
                        ex_days = normalize_days(ex.days)
                        shared = new_days.intersection(ex_days)
                        if not shared:
                            continue
                        
                        if not (ex.start_time and ex.end_time):
                            continue
                            
                        if start_time < ex.end_time and end_time > ex.start_time:
                            shared_str = ', '.join([d.title() for d in shared])
                            ex_time = f"{ex.start_time.strftime('%I:%M %p').lstrip('0')} \u2013 {ex.end_time.strftime('%I:%M %p').lstrip('0')}"
                            if ex.truck == truck:
                                errors['truck'] = [f"Truck {truck.plate_number} is already scheduled on {shared_str} ({ex_time})."]
                            if ex.driver == driver:
                                errors['driver'] = [f"Driver {driver.full_name} is already scheduled on {shared_str} ({ex_time})."]
                                
                    if errors:
                        raise ValidationError(errors)

        return attrs

    def _get_resolved_deployment_leader(self, obj):
        if not obj or not getattr(obj, 'pk', None):
            return None
        cache = getattr(self, '_resolved_leader_cache', None)
        if cache is None:
            cache = {}
            self._resolved_leader_cache = cache
        if obj.pk not in cache:
            from django.core.exceptions import ValidationError as DjangoValidationError
            from django.utils import timezone
            from .team_service import resolve_deployment_team_leader
            try:
                cache[obj.pk] = resolve_deployment_team_leader(obj, service_date=timezone.localdate())
            except DjangoValidationError:
                cache[obj.pk] = None
        return cache[obj.pk]

    def get_effective_team_leader_id(self, obj):
        res = self._get_resolved_deployment_leader(obj)
        return res.user.id if res else None

    def get_effective_team_leader_name(self, obj):
        res = self._get_resolved_deployment_leader(obj)
        return (res.worker.full_name or _user_display_name(res.user)) if res else None

    def get_effective_team_leader_role(self, obj):
        res = self._get_resolved_deployment_leader(obj)
        return res.leadership_mode if res else None

    def get_dumpsite_detail(self, obj):
        ds = obj.dumpsite
        if ds:
            return {
                'id': ds.id,
                'name': ds.name,
                'latitude': ds.latitude,
                'longitude': ds.longitude,
            }
        return None

    def get_completed_stops(self, obj):
        from django.utils import timezone
        today = timezone.localdate()
        # Only count stops the driver actually collected — DRIVER_MISSED is
        # explicitly excluded so missed stops don't inflate the completed counter.
        pickup_completed_orders = set(obj.pickups.filter(
            status='COMPLETED',
            collected_at__date=today,
        ).values_list('stop_order', flat=True))
        
        try:
            from watcher.models import StopValidation
            empty_stop_orders = set(StopValidation.objects.filter(
                schedule=obj,
                collection_date=today,
                current_status='EMPTY_STOP'
            ).values_list('stop_order', flat=True))
        except Exception:
            empty_stop_orders = set()

        return len(pickup_completed_orders | empty_stop_orders)

    def get_missed_stops_collected(self, obj):
        from driver.models import MissedStop, MissedStopStatus
        from django.utils import timezone
        today = timezone.localdate()
        return MissedStop.objects.filter(
            resolved_by_shift__driver=obj.driver,
            resolved_at__date=today,
            status=MissedStopStatus.RESOLVED
        ).count()

    def get_total_stops(self, obj):
        count = obj.pickups.count()
        return count if count > 0 else max(0, len(obj.waypoints or []) - 1)

    def get_truck_status(self, obj):
        from .views import compute_schedule_truck_status
        return compute_schedule_truck_status(obj)

    def _legacy_get_truck_status(self, obj):
        from driver.models import DriverShift
        from django.utils import timezone
        today = timezone.localdate()
        
        # Check for active shift today
        active_shift = DriverShift.objects.filter(driver=obj.driver, is_active=True).first()
        if active_shift:
            # Only consider it active if it was started today
            if active_shift.started_at and active_shift.started_at.date() == today:
                return active_shift.op_status
            
        # Check for ended shift today
        ended_shift = DriverShift.objects.filter(driver=obj.driver, is_active=False, started_at__date=today).order_by('-ended_at').first()
        if ended_shift:
            count = obj.pickups.count()
            total_stops = count if count > 0 else max(0, len(obj.waypoints or []) - 1)
            # Same rule as get_completed_stops: DRIVER_MISSED stops are not
            # collected — exclude them so a partial route isn't labeled 'completed'.
            pickup_completed_orders = set(obj.pickups.filter(
                status='COMPLETED',
                collected_at__date=today,
            ).values_list('stop_order', flat=True))
            
            try:
                from watcher.models import StopValidation
                empty_stop_orders = set(StopValidation.objects.filter(
                    schedule=obj,
                    collection_date=today,
                    current_status='EMPTY_STOP'
                ).values_list('stop_order', flat=True))
            except Exception:
                empty_stop_orders = set()
                
            completed_stops = len(pickup_completed_orders | empty_stop_orders)
            if total_stops > 0 and completed_stops >= total_stops:
                return 'completed'
            else:
                return 'returning_unfinished'
                
        return 'unassigned'

    def get_barangay_names(self, obj):
        return ", ".join([b.name for b in obj.barangays.all()])

    def get_waypoints_display(self, obj):
        from accounts.models import User
        wps = obj.waypoints or []
        barangay_ids = [wp.get('barangay_id') for wp in wps if wp.get('barangay_id')]

        watcher_map = {}
        if barangay_ids:
            watchers = User.objects.filter(
                role='watcher', barangay_id__in=barangay_ids
            ).values('barangay_id', 'full_name')
            for w in watchers:
                bid = w['barangay_id']
                if bid not in watcher_map:
                    watcher_map[bid] = []
                watcher_map[bid].append(w['full_name'])

        result = []
        for wp in wps:
            wp = dict(wp)  # don't mutate original
            bid = wp.get('barangay_id')
            wp['watcher_names'] = (
                ", ".join(watcher_map[bid]) if bid and bid in watcher_map
                else "No assigned watcher"
            )
            result.append(wp)
        return result

class RouteAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteAssignment
        fields = '__all__'

class PickupStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = PickupStatus
        fields = '__all__'

class TruckLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = TruckLocation
        fields = ['id', 'latitude', 'longitude', 'accuracy', 'timestamp', 'driver', 'truck', 'shift']
        read_only_fields = ['driver', 'truck', 'shift', 'timestamp']

class CompletionReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompletionReport
        fields = '__all__'



class TruckCrewAssignmentSerializer(serializers.ModelSerializer):
    truck_plate    = serializers.CharField(source='truck.plate_number', read_only=True)
    truck_model    = serializers.CharField(source='truck.model',        read_only=True)
    driver_name    = serializers.CharField(source='driver.full_name',   read_only=True, allow_null=True)
    # Crew member names
    crew_names     = serializers.SerializerMethodField()
    # Schedule details for shift/time display
    schedule_area  = serializers.CharField(source='schedule.area',              read_only=True, allow_null=True)
    schedule_days  = serializers.CharField(source='schedule.days',              read_only=True, allow_null=True)
    schedule_start = serializers.TimeField(source='schedule.start_time',        read_only=True, allow_null=True)
    schedule_end   = serializers.TimeField(source='schedule.end_time',          read_only=True, allow_null=True)
    barangay_name  = serializers.SerializerMethodField()

    def get_crew_names(self, obj):
        return [
            {'id': u.id, 'full_name': u.full_name, 'email': u.email}
            for u in obj.crew_members.all()
        ]

    def get_barangay_name(self, obj):
        if not obj.schedule_id or not obj.schedule:
            return None
        names = [b.name for b in obj.schedule.barangays.all()[:3]]
        return ', '.join(names) if names else None

    def validate(self, attrs):
        truck = attrs.get('truck', getattr(self.instance, 'truck', None))
        driver = attrs.get('driver', getattr(self.instance, 'driver', None))
        schedule = attrs.get('schedule', getattr(self.instance, 'schedule', None))
        is_active = attrs.get('is_active', getattr(self.instance, 'is_active', True))
        crew_members = attrs.get('crew_members', None)

        if is_active:
            if not truck or not is_truck_dispatchable(truck):
                raise serializers.ValidationError({
                    'truck': (
                        f"Truck {getattr(truck, 'plate_number', truck)} is not dispatchable."
                    )
                })
            if driver is not None:
                profile = getattr(driver, 'driverprofile', None)
                is_suspended = bool(
                    getattr(driver, 'is_suspended', False)
                    or (profile and getattr(profile, 'is_suspended', False))
                )
                if (
                    not getattr(driver, 'is_active', False)
                    or getattr(driver, 'role', None) != UserRole.DRIVER
                    or is_suspended
                ):
                    raise serializers.ValidationError({
                        'driver': 'Assigned driver must be an active, non-suspended user with role driver.'
                    })
            if crew_members is not None:
                invalid_crew = [
                    u.username for u in crew_members
                    if not getattr(u, 'is_active', False)
                    or getattr(u, 'role', None) != UserRole.CITIZEN
                    or getattr(u, 'employee_type', '') != EmployeeType.CREW_MEMBER
                ]
                if invalid_crew:
                    raise serializers.ValidationError({
                        'crew_members': (
                            f"Crew members {invalid_crew} must be active citizen crew_member accounts."
                        )
                    })
            if schedule is not None:
                if (
                    getattr(schedule, 'status', None) in ('CANCELLED', 'COMPLETED')
                    or not getattr(schedule, 'is_available', True)
                ):
                    raise serializers.ValidationError({
                        'schedule': f"Schedule #{schedule.id} is not active or available for assignment."
                    })

        return attrs

    class Meta:
        model  = TruckCrewAssignment
        fields = [
            'id', 'truck', 'truck_plate', 'truck_model',
            'driver', 'driver_name',
            'crew_members', 'crew_names',
            'schedule', 'schedule_area', 'schedule_days',
            'schedule_start', 'schedule_end', 'barangay_name',
            'date', 'is_active', 'notes', 'created_at',
        ]




class CalendarEventSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.CharField(source='assigned_to.full_name', read_only=True)

    class Meta:
        model = CalendarEvent
        fields = '__all__'

class DriverShiftSerializer(serializers.ModelSerializer):
    truck_id        = serializers.SerializerMethodField()
    truck_plate     = serializers.CharField(source='truck.plate_number', read_only=True)
    truck_model     = serializers.CharField(source='truck.model', read_only=True)
    driver_name     = serializers.CharField(source='driver.full_name', read_only=True)
    team_name       = serializers.CharField(source='effective_team.name', read_only=True)
    team_code       = serializers.CharField(source='effective_team.code', read_only=True)
    schedule_id     = serializers.SerializerMethodField()
    route_id        = serializers.SerializerMethodField()  # kept as alias for backward compat
    barangay_names  = serializers.SerializerMethodField()
    elapsed_ms      = serializers.SerializerMethodField()
    crew_shift_info = serializers.SerializerMethodField()

    class Meta:
        model = DriverShift
        fields = [
            'id', 'status', 'started_at', 'ended_at',
            'truck', 'truck_id', 'truck_plate', 'truck_model',
            'allocation', 'team_name', 'team_code',
            'schedule', 'schedule_id', 'route_id', 'barangay_names',
            'driver', 'driver_name', 'is_active', 'op_status', 'end_shift_phase', 'elapsed_ms', 'duration_ms', 'end_reason',
            'crew_shift_info',
        ]
        read_only_fields = [
            'id', 'status', 'started_at', 'ended_at',
            'truck', 'truck_id', 'truck_plate', 'truck_model',
            'allocation', 'team_name', 'team_code',
            'schedule', 'schedule_id', 'route_id', 'barangay_names',
            'driver', 'driver_name', 'is_active', 'op_status', 'end_shift_phase',
            'elapsed_ms', 'duration_ms', 'end_reason', 'crew_shift_info',
        ]

    def get_truck_id(self, obj):
        return obj.truck_id  # Django gives you the FK id without a join

    def get_crew_shift_info(self, obj):
        cs = getattr(obj, 'crew_shift', None)
        if not cs:
            return None
        return {
            'id': cs.id,
            'is_active': cs.is_active,
            'started_at': cs.started_at,
            'ended_at': cs.ended_at,
            'allocation_id': cs.allocation_id,
            'schedule_id': cs.schedule_id,
            'service_date': cs.service_date.isoformat() if cs.service_date else None,
            'watcher_shift_id': cs.watcher_shift_id,
            'team_leader_username': cs.team_leader.username if cs.team_leader_id else None,
            'team_leader_role': getattr(cs.team_leader, 'role', None) if cs.team_leader_id else None,
            'attendance_submitted_by_username': (
                cs.attendance_submitted_by.username if cs.attendance_submitted_by_id else None
            ),
            'attendance_submitted_at': cs.attendance_submitted_at,
        }

    def _resolve_schedule(self, obj):
        """
        Prefer the FK set at shift-start. Only fall back to the old
        heuristic lookup for legacy shifts created before this field existed.
        """
        if obj.schedule_id:
            return obj.schedule

        from .models import TruckCrewAssignment, CollectionSchedule
        from django.utils import timezone
        today = timezone.localdate()
        assignment = TruckCrewAssignment.objects.filter(
            driver=obj.driver, date=today, is_active=True
        ).select_related('schedule').first()
        schedule = assignment.schedule if assignment else None
        if not schedule:
            schedule = CollectionSchedule.objects.filter(driver=obj.driver, date=today).first()
        if not schedule:
            schedule = CollectionSchedule.objects.filter(driver=obj.driver).first()
        return schedule

    def get_schedule_id(self, obj):
        schedule = self._resolve_schedule(obj)
        return schedule.id if schedule else None

    def get_route_id(self, obj):
        return self.get_schedule_id(obj)

    def get_barangay_names(self, obj):
        schedule = self._resolve_schedule(obj)
        if schedule:
            return ", ".join([b.name for b in schedule.barangays.all()])
        return ''

    def get_elapsed_ms(self, obj):
        from django.utils import timezone
        if not obj.is_active or not obj.started_at:
            return 0
        return int((timezone.now() - obj.started_at).total_seconds() * 1000)


class WorkerSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source='user.username', read_only=True)
    user_role = serializers.CharField(source='user.role', read_only=True)
    employee_type = serializers.SerializerMethodField()
    is_provisional = serializers.SerializerMethodField()
    is_available = serializers.SerializerMethodField()
    active_team = serializers.SerializerMethodField()
    team_schedule_count = serializers.SerializerMethodField()
    direct_driver_schedules_count = serializers.SerializerMethodField()
    workload = serializers.SerializerMethodField()
    active_deployments_count = serializers.SerializerMethodField()
    on_active_shift = serializers.SerializerMethodField()

    class Meta:
        model = Worker
        fields = [
            'id', 'employee_id', 'full_name', 'user',
            'user_username', 'user_role', 'employee_type', 'is_active',
            'is_provisional', 'is_available', 'active_team',
            'team_schedule_count', 'direct_driver_schedules_count',
            'workload', 'active_deployments_count',
            'on_active_shift', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_is_provisional(self, obj):
        return obj.employee_id.startswith('PROV-')

    def get_employee_type(self, obj):
        if obj.user_id:
            return getattr(obj.user, 'employee_type', None)
        return 'crew_member'

    def _get_active_membership(self, obj):
        membership_map = self.context.get('active_membership_by_worker')
        if membership_map is not None:
            return membership_map.get(obj.id)
        return (
            obj.team_memberships
            .filter(is_active=True, team__is_active=True)
            .select_related('team')
            .first()
        )

    def get_is_available(self, obj):
        membership = self._get_active_membership(obj)
        return membership is None and bool(obj.is_active)

    def get_active_team(self, obj):
        m = self._get_active_membership(obj)
        if not m:
            return None
        return {
            'id': m.team_id,
            'code': m.team.code,
            'name': m.team.name,
            'role_in_team': m.role_in_team,
            'membership_id': m.id,
        }

    def get_team_schedule_count(self, obj):
        m = self._get_active_membership(obj)
        if not m:
            return 0
        team_sched_map = self.context.get('schedule_ids_by_team')
        if team_sched_map is not None:
            return len(team_sched_map.get(m.team_id, set()))
        from django.utils import timezone
        from django.db.models import Q
        today = timezone.localdate()
        from .models import CollectionSchedule
        return CollectionSchedule.objects.filter(
            Q(default_team_id=m.team_id) |
            Q(team_overrides__team_id=m.team_id, team_overrides__effective_date__gte=today)
        ).exclude(status__in=['CANCELLED', 'COMPLETED']).filter(
            Q(date__isnull=True) | Q(date__gte=today)
        ).distinct().count()

    def get_direct_driver_schedules_count(self, obj):
        if not obj.user_id or getattr(obj.user, 'role', None) != 'driver':
            return 0
        driver_sched_map = self.context.get('schedule_ids_by_driver_user')
        if driver_sched_map is not None:
            return len(driver_sched_map.get(obj.user_id, set()))
        from django.utils import timezone
        from django.db.models import Q
        today = timezone.localdate()
        from .models import CollectionSchedule
        return CollectionSchedule.objects.filter(
            driver_id=obj.user_id
        ).exclude(status__in=['CANCELLED', 'COMPLETED']).filter(
            Q(date__isnull=True) | Q(date__gte=today)
        ).distinct().count()

    def get_workload(self, obj):
        m = self._get_active_membership(obj)
        team_count = 1 if m else 0
        team_schedules = self.get_team_schedule_count(obj)
        driver_schedules = self.get_direct_driver_schedules_count(obj)

        team_sched_map = self.context.get('schedule_ids_by_team')
        driver_sched_map = self.context.get('schedule_ids_by_driver_user')
        if team_sched_map is not None and driver_sched_map is not None:
            sched_ids = set()
            if m:
                sched_ids.update(team_sched_map.get(m.team_id, set()))
            if obj.user_id and getattr(obj.user, 'role', None) == 'driver':
                sched_ids.update(driver_sched_map.get(obj.user_id, set()))
            total_unique = len(sched_ids)
        else:
            from django.utils import timezone
            from django.db.models import Q
            today = timezone.localdate()
            from .models import CollectionSchedule
            q = Q()
            if m:
                q |= Q(default_team_id=m.team_id)
                q |= Q(team_overrides__team_id=m.team_id, team_overrides__effective_date__gte=today)
            if obj.user_id and getattr(obj.user, 'role', None) == 'driver':
                q |= Q(driver_id=obj.user_id)
            if not q:
                total_unique = 0
            else:
                total_unique = CollectionSchedule.objects.filter(q).exclude(
                    status__in=['CANCELLED', 'COMPLETED']
                ).filter(
                    Q(date__isnull=True) | Q(date__gte=today)
                ).distinct().count()

        return {
            'team_membership_count': team_count,
            'team_schedule_count': team_schedules,
            'direct_driver_schedules_count': driver_schedules,
            'total_schedule_count': total_unique,
        }

    def get_active_deployments_count(self, obj):
        workload = self.get_workload(obj)
        return workload['total_schedule_count']

    def get_on_active_shift(self, obj):
        active_shift_workers = self.context.get('active_shift_worker_ids')
        if active_shift_workers is not None:
            return obj.id in active_shift_workers
        from .team_service import TeamService
        if TeamService.is_worker_on_active_shift(obj.id):
            return True
        if obj.user_id and getattr(obj.user, 'role', None) == 'watcher':
            from .models import WatcherShift
            return WatcherShift.objects.filter(watcher_id=obj.user_id, is_active=True).exists()
        return False


class LegacyCrewReconciliationAuditSerializer(serializers.ModelSerializer):
    provisional_worker_name = serializers.CharField(source='provisional_worker.full_name', read_only=True)
    provisional_worker_employee_id = serializers.CharField(source='provisional_worker.employee_id', read_only=True)
    resolved_by_username = serializers.CharField(source='resolved_by.username', read_only=True)

    class Meta:
        model = LegacyCrewReconciliationAudit
        fields = [
            'id', 'provisional_worker', 'provisional_worker_name',
            'provisional_worker_employee_id', 'source_assignment_id',
            'raw_name_string', 'detected_conflicts', 'reconciliation_status',
            'notes', 'resolved_by', 'resolved_by_username',
            'resolved_at', 'created_at',
        ]
        read_only_fields = ['id', 'resolved_at', 'created_at']


class SanitationTeamMembershipSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source='team.name', read_only=True)
    team_code = serializers.CharField(source='team.code', read_only=True)
    worker_name = serializers.CharField(source='worker.full_name', read_only=True)
    worker_employee_id = serializers.CharField(source='worker.employee_id', read_only=True)
    worker_system_role = serializers.SerializerMethodField()
    worker_employee_type = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = SanitationTeamMembership
        fields = [
            'id', 'team', 'team_name', 'team_code',
            'worker', 'worker_name', 'worker_employee_id',
            'worker_system_role', 'worker_employee_type',
            'role_in_team', 'is_active', 'joined_at',
            'left_at', 'created_by', 'created_by_username',
        ]
        read_only_fields = ['id', 'joined_at', 'left_at', 'created_by']

    def get_worker_system_role(self, obj):
        user = obj.worker.user if obj.worker_id and obj.worker.user_id else None
        return getattr(user, 'role', None) if user else None

    def get_worker_employee_type(self, obj):
        user = obj.worker.user if obj.worker_id and obj.worker.user_id else None
        return getattr(user, 'employee_type', None) if user else None


class SanitationTeamSerializer(serializers.ModelSerializer):
    members_count = serializers.SerializerMethodField()
    active_leader = serializers.SerializerMethodField()
    active_driver = serializers.SerializerMethodField()
    crew_members = serializers.SerializerMethodField()
    assigned_schedules = serializers.SerializerMethodField()
    team_leader_mode = serializers.SerializerMethodField()

    class Meta:
        model = SanitationTeam
        fields = [
            'id', 'name', 'code', 'description', 'is_active',
            'members_count', 'active_leader', 'active_driver',
            'crew_members', 'assigned_schedules', 'team_leader_mode',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def _serialize_member(self, m):
        user = m.worker.user if m.worker.user_id else None
        return {
            'membership_id': m.id,
            'id': m.worker.id,
            'name': m.worker.full_name,
            'employee_id': m.worker.employee_id,
            'user_id': m.worker.user_id,
            'system_role': getattr(user, 'role', None) if user else None,
            'employee_type': getattr(user, 'employee_type', None) if user else None,
            'role_in_team': m.role_in_team,
            'joined_at': m.joined_at,
        }

    def _get_active_members(self, obj):
        if hasattr(obj, '_prefetched_objects_cache') and 'memberships' in obj._prefetched_objects_cache:
            return [m for m in obj.memberships.all() if m.is_active]
        return list(obj.memberships.filter(is_active=True).select_related('worker__user'))

    def get_members_count(self, obj):
        return len(self._get_active_members(obj))

    def get_active_leader(self, obj):
        for m in self._get_active_members(obj):
            if m.role_in_team == 'leader':
                return self._serialize_member(m)
        return None

    def get_active_driver(self, obj):
        for m in self._get_active_members(obj):
            if m.role_in_team == 'driver':
                return self._serialize_member(m)
        return None

    def get_crew_members(self, obj):
        return [self._serialize_member(m) for m in self._get_active_members(obj) if m.role_in_team == 'crew']

    def get_team_leader_mode(self, obj):
        for m in self._get_active_members(obj):
            if m.role_in_team == 'leader':
                if m.worker.user_id:
                    return getattr(m.worker.user, 'role', None)
                return None
        return None

    def get_assigned_schedules(self, obj):
        if hasattr(obj, '_prefetched_objects_cache') and 'default_schedules' in obj._prefetched_objects_cache:
            schedules = obj.default_schedules.all()
        else:
            from .models import CollectionSchedule
            schedules = CollectionSchedule.objects.filter(default_team=obj).select_related('dumpsite', 'truck').order_by('id')
        return [
            {
                'id': s.id,
                'area': s.area,
                'days': s.days,
                'dumpsite_id': s.dumpsite_id,
                'dumpsite_name': s.dumpsite.name if s.dumpsite_id else None,
                'truck_id': s.truck_id,
                'truck_plate': s.truck.plate_number if s.truck_id else None,
            }
            for s in schedules
        ]


class ScheduleTeamOverrideSerializer(serializers.ModelSerializer):
    schedule_route_area = serializers.CharField(source='schedule.area', read_only=True)
    team_name = serializers.CharField(source='team.name', read_only=True)
    team_code = serializers.CharField(source='team.code', read_only=True)
    effective_team_leader_id = serializers.SerializerMethodField()
    effective_team_leader_name = serializers.SerializerMethodField()
    effective_team_leader_role = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = ScheduleTeamOverride
        fields = [
            'id', 'schedule', 'schedule_route_area',
            'team', 'team_name', 'team_code',
            'effective_team_leader_id', 'effective_team_leader_name',
            'effective_team_leader_role',
            'effective_date', 'reason',
            'created_by', 'created_by_username', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'created_by']

    def _get_resolved_override_leader(self, obj):
        if not obj or not getattr(obj, 'schedule_id', None):
            return None
        cache = getattr(self, '_resolved_override_leader_cache', None)
        if cache is None:
            cache = {}
            self._resolved_override_leader_cache = cache
        key = (obj.pk, obj.effective_date)
        if key not in cache:
            from django.core.exceptions import ValidationError as DjangoValidationError
            from .team_service import resolve_deployment_team_leader
            try:
                cache[key] = resolve_deployment_team_leader(obj.schedule, service_date=obj.effective_date)
            except DjangoValidationError:
                cache[key] = None
        return cache[key]

    def get_effective_team_leader_id(self, obj):
        res = self._get_resolved_override_leader(obj)
        return res.user.id if res else None

    def get_effective_team_leader_name(self, obj):
        res = self._get_resolved_override_leader(obj)
        return (res.worker.full_name or _user_display_name(res.user)) if res else None

    def get_effective_team_leader_role(self, obj):
        res = self._get_resolved_override_leader(obj)
        return res.leadership_mode if res else None


class ScheduleTruckAllocationSerializer(serializers.ModelSerializer):
    schedule_area = serializers.CharField(source='schedule.area', read_only=True)
    truck_plate = serializers.CharField(source='truck.plate_number', read_only=True)
    truck_model = serializers.CharField(source='truck.model', read_only=True)
    team_name = serializers.CharField(source='team.name', read_only=True)
    team_code = serializers.CharField(source='team.code', read_only=True)
    allocated_by_username = serializers.CharField(source='allocated_by.username', read_only=True)

    class Meta:
        model = ScheduleTruckAllocation
        fields = [
            'id', 'schedule', 'schedule_area',
            'allocation_date', 'truck', 'truck_plate', 'truck_model',
            'team', 'team_name', 'team_code',
            'allocated_by', 'allocated_by_username', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'allocated_by']


class WatcherShiftSerializer(serializers.ModelSerializer):
    watcher_username = serializers.CharField(source='watcher.username', read_only=True)
    schedule_area = serializers.CharField(source='schedule.area', read_only=True)
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)

    class Meta:
        model = WatcherShift
        fields = [
            'id', 'watcher', 'watcher_username',
            'schedule', 'schedule_area',
            'barangay', 'barangay_name',
            'shift_date', 'is_active', 'end_reason',
            'started_at', 'ended_at',
        ]
        read_only_fields = [
            'id', 'watcher', 'schedule', 'barangay',
            'shift_date', 'is_active', 'end_reason', 'started_at', 'ended_at',
        ]


class CrewShiftSerializer(serializers.ModelSerializer):
    team_name = serializers.SerializerMethodField()
    team_code = serializers.SerializerMethodField()
    schedule_area = serializers.SerializerMethodField()
    truck_plate = serializers.SerializerMethodField()
    team_leader_username = serializers.CharField(source='team_leader.username', read_only=True, default=None)
    team_leader_role = serializers.CharField(source='team_leader.role', read_only=True, default=None)
    attendance_submitted_by_username = serializers.CharField(
        source='attendance_submitted_by.username', read_only=True, default=None
    )
    attendance_submitted_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CrewShift
        fields = [
            'id', 'driver_shift', 'watcher_shift', 'allocation', 'schedule', 'schedule_area', 'service_date',
            'team', 'team_name', 'team_code', 'truck_plate',
            'team_leader', 'team_leader_username', 'team_leader_role',
            'attendance_submitted_by', 'attendance_submitted_by_username', 'attendance_submitted_by_name',
            'attendance_submitted_at', 'is_active', 'started_at', 'ended_at',
        ]
        read_only_fields = ['id', 'started_at']

    def get_team_name(self, obj):
        if obj.team_id and obj.team:
            return obj.team.name
        if obj.allocation_id and obj.allocation and obj.allocation.team_id:
            return obj.allocation.team.name
        return None

    def get_team_code(self, obj):
        if obj.team_id and obj.team:
            return obj.team.code
        if obj.allocation_id and obj.allocation and obj.allocation.team_id:
            return obj.allocation.team.code
        return None

    def get_schedule_area(self, obj):
        if obj.schedule_id and obj.schedule:
            return obj.schedule.area
        if obj.allocation_id and obj.allocation and obj.allocation.schedule_id:
            return obj.allocation.schedule.area
        return None

    def get_truck_plate(self, obj):
        if obj.allocation_id and obj.allocation and obj.allocation.truck_id:
            return obj.allocation.truck.plate_number
        if obj.driver_shift_id and obj.driver_shift and obj.driver_shift.truck_id:
            return obj.driver_shift.truck.plate_number
        return None

    def get_attendance_submitted_by_name(self, obj):
        return _user_display_name(obj.attendance_submitted_by) if obj.attendance_submitted_by_id else None


class ShiftCrewRosterItemSerializer(serializers.ModelSerializer):
    worker_name = serializers.CharField(source='worker.full_name', read_only=True)
    worker_employee_id = serializers.CharField(source='worker.employee_id', read_only=True)

    class Meta:
        model = ShiftCrewRosterItem
        fields = ['id', 'snapshot', 'worker', 'worker_name', 'worker_employee_id', 'role_in_roster', 'is_present']


class ShiftCrewRosterSnapshotSerializer(serializers.ModelSerializer):
    items = ShiftCrewRosterItemSerializer(many=True, read_only=True)
    staged_by_username = serializers.CharField(source='staged_by.username', read_only=True)

    class Meta:
        model = ShiftCrewRosterSnapshot
        fields = ['id', 'driver_shift', 'crew_shift', 'staged_by', 'staged_by_username', 'snapshot_timestamp', 'items']
        read_only_fields = ['id', 'snapshot_timestamp']


class CrewAttendanceCorrectionSerializer(serializers.ModelSerializer):
    corrected_by_username = serializers.CharField(source='corrected_by.username', read_only=True)
    corrected_by_name = serializers.SerializerMethodField()
    new_status = serializers.CharField(source='corrected_status', read_only=True)

    class Meta:
        model = CrewAttendanceCorrection
        fields = [
            'id', 'original_record', 'correction_sequence', 'previous_status',
            'corrected_status', 'new_status', 'reason',
            'corrected_by', 'corrected_by_username', 'corrected_by_name',
            'corrected_at',
        ]
        read_only_fields = ['id', 'corrected_at', 'corrected_by']

    def get_corrected_by_name(self, obj):
        return _user_display_name(obj.corrected_by)


class CrewAttendanceRecordSerializer(serializers.ModelSerializer):
    worker_name = serializers.CharField(source='worker.full_name', read_only=True)
    worker_employee_id = serializers.CharField(source='worker.employee_id', read_only=True)
    checked_in_by_username = serializers.CharField(source='checked_in_by.username', read_only=True)
    corrections = CrewAttendanceCorrectionSerializer(many=True, read_only=True)

    class Meta:
        model = CrewAttendanceRecord
        fields = [
            'id', 'driver_shift', 'crew_shift', 'worker', 'worker_name', 'worker_employee_id',
            'status', 'checked_in_by', 'checked_in_by_username',
            'recorded_at', 'corrections',
        ]
        read_only_fields = ['id', 'recorded_at', 'checked_in_by']


class TruckReplacementRequestSerializer(serializers.ModelSerializer):
    truck_plate = serializers.CharField(source='truck.plate_number', read_only=True)
    schedule_area = serializers.CharField(source='schedule.area', read_only=True, default=None)
    dumpsite_id = serializers.IntegerField(source='schedule.dumpsite_id', read_only=True, default=None)
    dumpsite_name = serializers.CharField(source='schedule.dumpsite.name', read_only=True, default=None)
    requested_by_username = serializers.CharField(source='requested_by.username', read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    resolved_by_username = serializers.CharField(source='resolved_by.username', read_only=True, default=None)
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TruckReplacementRequest
        fields = [
            'id', 'driver_shift', 'schedule', 'schedule_area',
            'dumpsite_id', 'dumpsite_name',
            'truck', 'truck_plate',
            'requested_by', 'requested_by_username', 'requested_by_name',
            'reason', 'status',
            'resolved_by', 'resolved_by_username', 'resolved_by_name',
            'resolved_at', 'resolution_notes', 'created_at',
        ]
        read_only_fields = [
            'id', 'status', 'resolved_by', 'resolved_at', 'resolution_notes', 'created_at',
        ]

    def get_requested_by_name(self, obj):
        return _user_display_name(obj.requested_by)

    def get_resolved_by_name(self, obj):
        return _user_display_name(obj.resolved_by)


class TruckOperationalHoldLogSerializer(serializers.ModelSerializer):
    truck_plate = serializers.CharField(source='truck.plate_number', read_only=True)
    truck_model = serializers.CharField(source='truck.model', read_only=True)
    dumpsite_name = serializers.CharField(source='dumpsite.name', read_only=True, default=None)
    inspection_id = serializers.IntegerField(read_only=True)
    placed_by_name = serializers.SerializerMethodField()
    cleared_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TruckOperationalHoldLog
        fields = [
            'id', 'truck', 'truck_plate', 'truck_model',
            'dumpsite', 'dumpsite_name',
            'inspection', 'inspection_id',
            'is_active', 'reason',
            'placed_by', 'placed_by_name', 'placed_at',
            'cleared_by', 'cleared_by_name', 'cleared_at',
            'resolution_notes',
        ]
        read_only_fields = fields

    def get_placed_by_name(self, obj):
        return _user_display_name(obj.placed_by)

    def get_cleared_by_name(self, obj):
        return _user_display_name(obj.cleared_by)


class TruckMaintenanceRecordSerializer(serializers.ModelSerializer):
    truck_plate = serializers.CharField(source='truck.plate_number', read_only=True)
    truck_model = serializers.CharField(source='truck.model', read_only=True)
    dumpsite_name = serializers.CharField(source='dumpsite.name', read_only=True, default=None)
    created_by_name = serializers.SerializerMethodField()
    started_by_name = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TruckMaintenanceRecord
        fields = [
            'id', 'truck', 'truck_plate', 'truck_model',
            'dumpsite', 'dumpsite_name',
            'maintenance_type', 'status', 'title', 'notes', 'completion_notes',
            'scheduled_for', 'started_at', 'completed_at',
            'cost', 'odometer_km',
            'created_by', 'created_by_name',
            'started_by', 'started_by_name',
            'completed_by', 'completed_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'status', 'started_at', 'completed_at',
            'created_by', 'started_by', 'completed_by', 'created_at', 'updated_at',
        ]

    def get_created_by_name(self, obj):
        return _user_display_name(obj.created_by)

    def get_started_by_name(self, obj):
        return _user_display_name(obj.started_by)

    def get_completed_by_name(self, obj):
        return _user_display_name(obj.completed_by)


class FuelLogSerializer(serializers.ModelSerializer):
    driver_shift_id = serializers.IntegerField(read_only=True)
    truck_plate = serializers.CharField(source='truck.plate_number', read_only=True)
    truck_model = serializers.CharField(source='truck.model', read_only=True)
    dumpsite_name = serializers.CharField(source='dumpsite.name', read_only=True)
    driver_name = serializers.SerializerMethodField()
    gauge_submitted_by_name = serializers.SerializerMethodField()
    recorded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = FuelLog
        fields = [
            'id', 'driver_shift', 'driver_shift_id',
            'truck', 'truck_plate', 'truck_model',
            'dumpsite', 'dumpsite_name',
            'driver', 'driver_name',
            'status',
            'gauge_percentage', 'gauge_submitted_by', 'gauge_submitted_by_name', 'gauge_submitted_at',
            'liters_added', 'fuel_cost', 'odometer_km',
            'recorded_by', 'recorded_by_name', 'recorded_at',
            'notes', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_driver_name(self, obj):
        return _user_display_name(obj.driver)

    def get_gauge_submitted_by_name(self, obj):
        return _user_display_name(obj.gauge_submitted_by)

    def get_recorded_by_name(self, obj):
        return _user_display_name(obj.recorded_by)


class UnfinishedStopReviewSerializer(serializers.ModelSerializer):
    reviewed_by_username = serializers.CharField(source='reviewed_by.username', read_only=True)

    class Meta:
        model = UnfinishedStopReview
        fields = [
            'id', 'shift', 'stop_validation', 'pickup_status', 'service_date',
            'stop_order', 'recorded_status', 'reason',
            'resolution_status', 'resolution_notes',
            'reviewed_by', 'reviewed_by_username',
            'reviewed_at', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'reviewed_by', 'reviewed_at']




