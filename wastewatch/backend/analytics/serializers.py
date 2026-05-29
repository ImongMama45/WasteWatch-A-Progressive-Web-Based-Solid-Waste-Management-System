from rest_framework import serializers
from .models import SystemKPI, TruckPerformance, BarangayPerformance, IssueTrend, ActivityLog

class SystemKPISerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemKPI
        fields = '__all__'

class TruckPerformanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = TruckPerformance
        fields = '__all__'

class BarangayPerformanceSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    class Meta:
        model = BarangayPerformance
        fields = '__all__'

class IssueTrendSerializer(serializers.ModelSerializer):
    class Meta:
        model = IssueTrend
        fields = '__all__'

class ActivityLogSerializer(serializers.ModelSerializer):
    admin_name = serializers.CharField(source='admin.full_name', read_only=True)
    
    class Meta:
        model = ActivityLog
        fields = '__all__'
