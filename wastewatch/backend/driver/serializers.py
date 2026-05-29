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
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    
    class Meta:
        model = Dumpsite
        fields = '__all__'

class CollectionScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = CollectionSchedule
        fields = '__all__'

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
