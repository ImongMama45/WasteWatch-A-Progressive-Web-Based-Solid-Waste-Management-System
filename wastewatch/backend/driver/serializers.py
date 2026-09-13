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
)
from dumpsite.serializers import TruckFillEstimateSerializer


class TruckSerializer(serializers.ModelSerializer):
    driver_details = serializers.SerializerMethodField()
    crew_names = serializers.SlugRelatedField(
        many=True,
        read_only=True,
        slug_field='full_name',
        source='crew'
    )
    fill_estimates = TruckFillEstimateSerializer(many=True, read_only=True)
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Truck
        fields = '__all__'

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

class CollectionScheduleSerializer(serializers.ModelSerializer):
    truck_plate    = serializers.CharField(source='truck.plate_number', read_only=True)
    driver_name    = serializers.CharField(source='driver.full_name',   read_only=True)
    dumpsite_name  = serializers.CharField(source='dumpsite.name',      read_only=True)
    dumpsite_detail = serializers.SerializerMethodField()
    barangay_names = serializers.SerializerMethodField()
    waypoints_display = serializers.SerializerMethodField()  # renamed — read-only enriched version
    completed_stops = serializers.SerializerMethodField()
    total_stops = serializers.SerializerMethodField()
    truck_status = serializers.SerializerMethodField()

    class Meta:
        model  = CollectionSchedule
        fields = '__all__'  # 'waypoints' (the raw JSONField) is now included automatically

    def get_dumpsite_detail(self, obj):
        ds = obj.dumpsite
        if not ds:
            from dumpsite.models import Dumpsite
            ds = Dumpsite.objects.first()
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
        from django.db.models import Q
        pickup_completed_orders = set(obj.pickups.filter(
            Q(status='COMPLETED', collected_at__date=today) |
            Q(status='DRIVER_MISSED', updated_at__date=today)
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

    def get_total_stops(self, obj):
        count = obj.pickups.count()
        return count if count > 0 else max(0, len(obj.waypoints or []) - 1)

    def get_truck_status(self, obj):
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
            from django.db.models import Q
            pickup_completed_orders = set(obj.pickups.filter(
                Q(status='COMPLETED', collected_at__date=today) |
                Q(status='DRIVER_MISSED', updated_at__date=today)
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
    driver_name    = serializers.CharField(source='driver.full_name',   read_only=True)
    # Crew member names
    crew_names     = serializers.SerializerMethodField()
    # Schedule details for shift/time display
    schedule_area  = serializers.CharField(source='schedule.area',              read_only=True)
    schedule_days  = serializers.CharField(source='schedule.days',              read_only=True)
    schedule_start = serializers.TimeField(source='schedule.start_time',        read_only=True)
    schedule_end   = serializers.TimeField(source='schedule.end_time',          read_only=True)
    barangay_name  = serializers.CharField(source='schedule.barangay.name',     read_only=True)

    def get_crew_names(self, obj):
        return [
            {'id': u.id, 'full_name': u.full_name, 'email': u.email}
            for u in obj.crew_members.all()
        ]

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
    schedule_id     = serializers.SerializerMethodField()
    route_id        = serializers.SerializerMethodField()  # kept as alias for backward compat
    barangay_names  = serializers.SerializerMethodField()
    elapsed_ms      = serializers.SerializerMethodField()

    class Meta:
        model = DriverShift
        fields = [
            'id', 'status', 'started_at', 'ended_at',
            'truck', 'truck_id', 'truck_plate', 'truck_model',
            'schedule', 'schedule_id', 'route_id', 'barangay_names',
            'driver', 'is_active', 'op_status', 'end_shift_phase', 'elapsed_ms',
        ]

    def get_truck_id(self, obj):
        return obj.truck_id  # Django gives you the FK id without a join

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
