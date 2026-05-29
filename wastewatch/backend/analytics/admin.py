from django.contrib import admin
from .models import SystemKPI, TruckPerformance, BarangayPerformance, IssueTrend

@admin.register(SystemKPI)
class SystemKPIAdmin(admin.ModelAdmin):
    list_display = ('period', 'collected_kg', 'total_routes', 'completed_routes', 'total_reports', 'resolved_reports')
    list_filter = ('period',)

@admin.register(TruckPerformance)
class TruckPerformanceAdmin(admin.ModelAdmin):
    list_display = ('truck_id', 'driver_name', 'period', 'routes', 'completed', 'missed', 'avg_fill')
    list_filter = ('period',)
    search_fields = ('truck_id', 'driver_name')

@admin.register(BarangayPerformance)
class BarangayPerformanceAdmin(admin.ModelAdmin):
    list_display = ('barangay', 'period', 'reports', 'resolved', 'waste_collected_kg')
    list_filter = ('period', 'barangay')
    search_fields = ('barangay__name',)

@admin.register(IssueTrend)
class IssueTrendAdmin(admin.ModelAdmin):
    list_display = ('date', 'report_count')
