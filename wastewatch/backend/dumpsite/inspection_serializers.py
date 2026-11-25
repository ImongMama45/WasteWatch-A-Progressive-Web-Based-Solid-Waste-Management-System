from rest_framework import serializers
from .models import DumpsiteTruckInspection


class DumpsiteTruckInspectionSerializer(serializers.ModelSerializer):
    truck_id = serializers.IntegerField(read_only=True)
    truck_plate = serializers.CharField(source='truck.plate_number', read_only=True)
    truck_model = serializers.CharField(source='truck.model', read_only=True)
    dumpsite_id = serializers.IntegerField(read_only=True)
    dumpsite_name = serializers.CharField(source='dumpsite.name', read_only=True, default=None)
    driver_shift_id = serializers.IntegerField(read_only=True)
    submitted_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DumpsiteTruckInspection
        fields = [
            'id',
            'truck',
            'truck_id',
            'truck_plate',
            'truck_model',
            'dumpsite',
            'dumpsite_id',
            'dumpsite_name',
            'driver_shift',
            'driver_shift_id',
            'submitted_by',
            'submitted_by_name',
            'inspection_type',
            'inspection_state',
            'mechanical_condition',
            'notes',
            'checklist_data',
            'hold_created',
            'inspected_at',
        ]
        read_only_fields = fields

    def get_submitted_by_name(self, obj):
        u = getattr(obj, 'submitted_by', None)
        if not u:
            return None
        full_name = (getattr(u, 'full_name', '') or '').strip()
        return full_name or getattr(u, 'username', None)
