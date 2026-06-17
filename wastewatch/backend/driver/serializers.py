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

    class Meta:
        model = Truck
        fields = '__all__'

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
    class Meta:
        model = DriverShift
        fields = '__all__'
