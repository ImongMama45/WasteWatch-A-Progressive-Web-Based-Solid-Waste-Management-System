from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()

class TruckStatus(models.TextChoices):
    ACTIVE = 'active', 'Active'
    MAINTENANCE = 'maintenance', 'Maintenance'
    INACTIVE = 'inactive', 'Inactive'

class Truck(models.Model):
    plate_number = models.CharField(max_length=20, unique=True)
    model = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=TruckStatus.choices, default=TruckStatus.ACTIVE)
    driver = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_truck')
    crew = models.ManyToManyField(User, related_name='crew_trucks', blank=True)
    zone = models.CharField(max_length=100, blank=True)
    current_capacity = models.IntegerField(default=0) # 0-100%
    last_service = models.DateField(null=True, blank=True)

    def __str__(self):
        return f"{self.plate_number} ({self.model})"

class DumpsiteType(models.TextChoices):
    LANDFILL = 'landfill', 'Landfill'
    DUMPSITE = 'dumpsite', 'Open Dumpsite'
    TRANSFER = 'transfer', 'Transfer Station'
    COMPOSTING = 'composting', 'Composting Area'

class Dumpsite(models.Model):
    name = models.CharField(max_length=100)
    type = models.CharField(max_length=20, choices=DumpsiteType.choices, default=DumpsiteType.DUMPSITE)
    barangay = models.ForeignKey('accounts.Barangay', on_delete=models.CASCADE, related_name='dumpsites')
    capacity_used = models.IntegerField(default=0) # 0-100%
    notes = models.TextField(blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)

    def __str__(self):
        return self.name

class CollectionSchedule(models.Model):
    truck = models.ForeignKey(Truck, on_delete=models.SET_NULL, null=True, blank=True, related_name='schedules')
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='collection_schedules')
    barangay = models.ForeignKey('accounts.Barangay', on_delete=models.CASCADE, related_name='collection_schedules', null=True)
    area = models.CharField(max_length=255, blank=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    days = models.CharField(max_length=100, help_text="e.g. Mon, Wed, Fri", blank=True)
    frequency = models.CharField(max_length=100, blank=True)
    
    # Specific date if it's a one-time thing, otherwise can be null for recurring
    date = models.DateField(null=True, blank=True)

    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING')

    def __str__(self):
        return f"Schedule {self.id} - {self.barangay.name if self.barangay else 'City-wide'}"

class RouteAssignment(models.Model):
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='route_assignments')
    schedule = models.ForeignKey(CollectionSchedule, on_delete=models.CASCADE, related_name='assignments')
    route_name = models.CharField(max_length=100)
    # Store waypoints as JSON list of lat/lng pairs
    waypoints = models.JSONField(default=list, blank=True)

    def __str__(self):
        return f"Route {self.route_name} (Driver: {self.driver})"

class PickupStatus(models.Model):
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='pickup_statuses')
    schedule = models.ForeignKey(CollectionSchedule, on_delete=models.CASCADE, related_name='pickups')
    STATUS_CHOICES = [
        ('EN_ROUTE', 'En route'),
        ('ARRIVED', 'Arrived'),
        ('COMPLETED', 'Completed'),
        ('FAILED', 'Failed'),
    ]
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='EN_ROUTE')
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Pickup {self.id} - {self.status}"

class TruckLocation(models.Model):
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='truck_locations')
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    timestamp = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.driver} @ ({self.latitude}, {self.longitude})"

class CompletionReport(models.Model):
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='completion_reports')
    schedule = models.ForeignKey(CollectionSchedule, on_delete=models.CASCADE, related_name='reports')
    report_file = models.FileField(upload_to='reports/')
    generated_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Report {self.id} for {self.driver} ({self.generated_at.date()})"

class DriverNotification(models.Model):
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    title = models.CharField(max_length=150)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    read = models.BooleanField(default=False)

    def __str__(self):
        return f"Notification for {self.driver} – {'Read' if self.read else 'Unread'}"
