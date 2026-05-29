from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()

class CollectionSchedule(models.Model):
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='collection_schedules')
    date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING')

    def __str__(self):
        return f"Schedule {self.id} for {self.driver}" 

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
