from rest_framework import serializers
from .models import (
    Dumpsite,
    WasteDelivery,
    TruckFillEstimate,
    DumpsiteIncident,
)

class TruckFillEstimateSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TruckFillEstimate
        fields = ['fill_level', 'estimated_kg', 'is_custom']

class DumpsiteSerializer(serializers.ModelSerializer):
    barangay_name  = serializers.CharField(source='barangay.name', read_only=True)
    operator_name  = serializers.CharField(source='operator.full_name', read_only=True, default=None)
    fill_percent   = serializers.SerializerMethodField()
    staff_accounts = serializers.SerializerMethodField()

    def get_fill_percent(self, obj):
        if obj.max_capacity_kg:
            return round((float(obj.current_fill_kg) / float(obj.max_capacity_kg)) * 100, 1)
        return 0.0

    def get_staff_accounts(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None) if request else None
        if not user or not user.is_authenticated:
            return []

        from django.db.models import Q
        from accounts.models import User
        from accounts.permissions import is_admin_user
        from driver.truck_service import TruckService

        allowed = is_admin_user(user) or (
            getattr(user, 'role', None) == 'dumpsite'
            and TruckService.get_operator_dumpsite_id(user) == obj.id
        )
        if not allowed:
            return []

        users = (
            User.objects.filter(Q(dumpsite=obj) | Q(operated_dumpsite=obj))
            .select_related('barangay')
            .distinct()
            .order_by('id')
        )
        return [
            {
                'id': u.id,
                'full_name': u.full_name,
                'email': u.email,
                'role': u.role,
                'barangay': u.barangay.name if u.barangay else None,
                'is_active': u.is_active,
                'is_primary_operator': u.id == obj.operator_id,
                'created_at': u.created_at.strftime('%b %d, %Y') if u.created_at else None,
            }
            for u in users
        ]

    def to_internal_value(self, data):
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
            'max_capacity_kg', 'current_fill_kg', 'fill_percent',
            'operator', 'operator_name',
            'staff_accounts',
        ]

class WasteDeliverySerializer(serializers.ModelSerializer):
    truck_plate       = serializers.CharField(source='truck.plate_number',          read_only=True)
    driver_name       = serializers.CharField(source='driver.full_name',            read_only=True)
    dumpsite_name     = serializers.CharField(source='dumpsite.name',               read_only=True)
    operator_name     = serializers.CharField(source='dumpsite_operator.full_name', read_only=True)
    barangay_names    = serializers.SerializerMethodField()
    barangay_name     = serializers.SerializerMethodField()
    schedule_area     = serializers.CharField(source='schedule.area',               read_only=True)
    incident_count    = serializers.SerializerMethodField()

    def get_incident_count(self, obj):
        return obj.incidents.count()

    def get_barangay_names(self, obj):
        return [b.name for b in obj.barangays.all()]

    def get_barangay_name(self, obj):
        names = [b.name for b in obj.barangays.all()]
        return ', '.join(names) if names else None

    def validate_estimated_kg(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Estimated weight (kg) cannot be negative.')
        return value

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
            'estimated_kg', 'fill_level',
            'photo',
            'barangays', 'barangay_names', 'barangay_name',
            'remarks', 'is_validated', 'created_at',
            'incident_count',
        ]
        read_only_fields = ['net_weight', 'created_at', 'dumpsite_operator']

class DumpsiteIncidentSerializer(serializers.ModelSerializer):
    reported_by_name = serializers.CharField(source='reported_by.full_name', read_only=True)
    delivery_truck   = serializers.CharField(source='delivery.truck.plate_number', read_only=True)

    class Meta:
        model  = DumpsiteIncident
        fields = [
            'id', 'delivery', 'delivery_truck',
            'reason', 'notes',
            'reported_by', 'reported_by_name',
            'timestamp',
        ]
        read_only_fields = ['timestamp']
