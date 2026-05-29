from django.db import models
from django.conf import settings

class PerformancePeriod(models.TextChoices):
    THIS_WEEK = 'This Week', 'This Week'
    LAST_WEEK = 'Last Week', 'Last Week'
    THIS_MONTH = 'This Month', 'This Month'
    LAST_MONTH = 'Last Month', 'Last Month'

class SystemKPI(models.Model):
    period = models.CharField(max_length=20, choices=PerformancePeriod.choices)
    collected_kg = models.IntegerField(default=0)
    total_routes = models.IntegerField(default=0)
    completed_routes = models.IntegerField(default=0)
    missed_stops = models.IntegerField(default=0)
    avg_fill_rate = models.IntegerField(default=0) # Percentage
    total_reports = models.IntegerField(default=0)
    resolved_reports = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'System KPI'
        verbose_name_plural = 'System KPIs'

    def __str__(self):
        return self.period

class TruckPerformance(models.Model):
    truck_id = models.CharField(max_length=50) # e.g., LCN-001
    driver_name = models.CharField(max_length=255) # Can be linked to User later
    period = models.CharField(max_length=20, choices=PerformancePeriod.choices)
    routes = models.IntegerField(default=0)
    completed = models.IntegerField(default=0)
    missed = models.IntegerField(default=0)
    avg_fill = models.IntegerField(default=0) # Percentage
    total_km = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.truck_id} - {self.period}"

class BarangayPerformance(models.Model):
    barangay = models.ForeignKey('accounts.Barangay', on_delete=models.CASCADE)
    period = models.CharField(max_length=20, choices=PerformancePeriod.choices)
    reports = models.IntegerField(default=0)
    resolved = models.IntegerField(default=0)
    waste_collected_kg = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.barangay.name} - {self.period}"

class IssueTrend(models.Model):
    date = models.DateField()
    report_count = models.IntegerField(default=0)

    class Meta:
        ordering = ['date']

    def __str__(self):
        return f"{self.date}: {self.report_count} reports"

class ActivityLog(models.Model):
    ACTION_CHOICES = [
        ('create', 'Create'),
        ('update', 'Update'),
        ('delete', 'Delete'),
        ('system', 'System'),
    ]
    
    admin = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=10, choices=ACTION_CHOICES)
    module = models.CharField(max_length=50) # e.g., Users, Trucks
    details = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.action} on {self.module} at {self.timestamp}"
