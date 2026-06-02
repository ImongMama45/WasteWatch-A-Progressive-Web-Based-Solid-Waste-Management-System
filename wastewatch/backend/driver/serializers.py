from rest_framework import serializers
from .models import (
    Truck,
    Dumpsite,
    CollectionSchedule,
    RouteAssignment,
    PickupStatus,
    TruckLocation,
    CompletionReport,
    DriverNotification,
    TruckCrewAssignment,
    WasteDelivery,
    CalendarEvent,
)

class TruckSerializer(serializers.ModelSerializer):
    driver_name = serializers.CharField(source='driver.full_name', read_only=True)
    crew_names = serializers.SlugRelatedField(
        many=True,
        read_only=True,
        slug_field='full_name',
        source='crew'
    )
    
    class Meta:
        model = Truck
        fields = '__all__'

class DumpsiteSerializer(serializers.ModelSerializer):
    barangay_name  = serializers.CharField(source='barangay.name', read_only=True)
    staff_accounts = serializers.SerializerMethodField()

    def get_staff_accounts(self, obj):
        from accounts.models import User
        users = User.objects.filter(dumpsite=obj).select_related('barangay')
        return [
            {
                'id':         u.id,
                'full_name':  u.full_name,
                'email':      u.email,
                'role':       u.role,
                'barangay':   u.barangay.name if u.barangay else None,
                'is_active':  u.is_active,
                'created_at': u.created_at.strftime('%b %d, %Y') if u.created_at else None,
            }
            for u in users
        ]

    def to_internal_value(self, data):
        # Remap frontend short aliases → real model field names before DRF validates
        data = data.copy()
        if 'lat' in data:
            data['latitude']  = round(float(data.pop('lat')), 6)
        if 'lng' in data:
            data['longitude'] = round(float(data.pop('lng')), 6)
        if 'capacity' in data:
            data['capacity_used'] = data.pop('capacity')
        return super().to_internal_value(data)

    class Meta:
        model  = Dumpsite
        fields = [
            'id', 'name', 'type', 'barangay', 'barangay_name',
            'capacity_used', 'notes', 'latitude', 'longitude',
            'staff_accounts',
        ]



class CollectionScheduleSerializer(serializers.ModelSerializer):
    truck_plate   = serializers.CharField(source='truck.plate_number', read_only=True)
    driver_name   = serializers.CharField(source='driver.full_name', read_only=True)
    dumpsite_name = serializers.CharField(source='dumpsite.name', read_only=True)
    barangay_names = serializers.SerializerMethodField()

    class Meta:
        model = CollectionSchedule
        fields = '__all__'

    def get_barangay_names(self, obj):
        return ", ".join([b.name for b in obj.barangays.all()])

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
        fields = '__all__'

class CompletionReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompletionReport
        fields = '__all__'

class DriverNotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriverNotification
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


class WasteDeliverySerializer(serializers.ModelSerializer):
    truck_plate       = serializers.CharField(source='truck.plate_number',       read_only=True)
    driver_name       = serializers.CharField(source='driver.full_name',         read_only=True)
    dumpsite_name     = serializers.CharField(source='dumpsite.name',            read_only=True)
    operator_name     = serializers.CharField(source='dumpsite_operator.full_name', read_only=True)
    barangay_name     = serializers.CharField(source='barangay.name',            read_only=True)
    schedule_area     = serializers.CharField(source='schedule.area',            read_only=True)

    class Meta:
        model  = WasteDelivery
        fields = [
            'id', 'truck', 'truck_plate',
            'driver', 'driver_name',
            'dumpsite', 'dumpsite_name',
            'dumpsite_operator', 'operator_name',
            'schedule', 'schedule_area',
            'crew_assignment',
            'date', 'arrival_time',
            'gross_weight', 'tare_weight', 'net_weight',
            'barangay', 'barangay_name',
            'remarks', 'is_validated', 'created_at',
        ]
        read_only_fields = ['net_weight', 'created_at']

class CalendarEventSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.CharField(source='assigned_to.full_name', read_only=True)

    class Meta:
        model = CalendarEvent
        fields = '__all__'
