from django.db import models
from django.db.models import Q
from django.contrib.auth import get_user_model
from django.db import transaction
from cloudinary.models import CloudinaryField

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
    barangays = models.ManyToManyField('accounts.Barangay', related_name='collection_schedules', blank=True)
    area = models.CharField(max_length=255, blank=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    days = models.CharField(max_length=100, help_text="e.g. Mon, Wed, Fri", blank=True)
    frequency = models.CharField(max_length=100, blank=True)
    
    # Route specifics
    waypoints = models.JSONField(default=list, blank=True)
    dumpsite = models.ForeignKey('driver.Dumpsite', on_delete=models.SET_NULL, null=True, blank=True, related_name='collection_schedules')

    # Specific date if it's a one-time thing, otherwise can be null for recurring
    date = models.DateField(null=True, blank=True)

    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING')

    def save(self, *args, **kwargs):
        creating = self.pk is None
        super().save(*args, **kwargs)
        self.sync_pickup_statuses()

    def sync_pickup_statuses(self):
        if not self.pk:
            return

        try:
            from watcher.stop_validation_service import ensure_stop_validations_for_schedule
            ensure_stop_validations_for_schedule(self)
        except Exception:
            pass

        stops = [wp for idx, wp in enumerate(self.waypoints or []) if idx > 0]
        desired_order_set = set(range(1, len(stops) + 1))
        existing_statuses = {ps.stop_order: ps for ps in self.pickups.all()}

        with transaction.atomic():
            for order, waypoint in enumerate(stops, start=1):
                address = ''
                if isinstance(waypoint, dict):
                    address = waypoint.get('label') or waypoint.get('address') or ''
                if order in existing_statuses:
                    ps = existing_statuses[order]
                    ps.driver = self.driver
                    ps.schedule = self
                    ps.address = address
                    ps.save(update_fields=['driver', 'schedule', 'address'])
                else:
                    self.pickups.create(
                        driver=self.driver,
                        status='EN_ROUTE',
                        stop_order=order,
                        address=address,
                    )

            stale_ids = [ps.id for order, ps in existing_statuses.items() if order not in desired_order_set]
            if stale_ids:
                PickupStatus.objects.filter(id__in=stale_ids).delete()

    def __str__(self):
        names = ', '.join(b.name for b in self.barangays.all()[:3])
        return f"Schedule {self.id} - {names or 'City-wide'}"

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
    # Stop detail fields — used by the driver collection log UI
    stop_order  = models.PositiveIntegerField(default=0, help_text='Order of this stop in the route')
    address     = models.CharField(max_length=255, blank=True)
    note        = models.TextField(blank=True)
    photo_url   = CloudinaryField('collection proof', folder='pickup-proofs/', null=True, blank=True)
    collected_at = models.DateTimeField(null=True, blank=True, help_text='When the driver marked this stop collected')
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['stop_order']

    def __str__(self):
        return f"Pickup {self.id} - {self.status}"

class TruckLocation(models.Model):
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='truck_locations')
    truck = models.ForeignKey(Truck, on_delete=models.CASCADE, related_name='locations', null=True, blank=True)
    shift = models.ForeignKey('DriverShift', on_delete=models.CASCADE, related_name='locations', null=True, blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    accuracy = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True,
                                   help_text='GPS accuracy radius in metres')
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            # Hot path: fetch latest location per shift for replay/history
            models.Index(fields=['shift', '-timestamp'], name='truckloc_shift_ts_idx'),
            # Hot path: per-driver location history
            models.Index(fields=['driver', '-timestamp'], name='truckloc_driver_ts_idx'),
        ]

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


# ---------------------------------------------------------------------------
# Truck Crew Assignment
# Replaces the loose Truck.crew M2M with a timestamped, auditable model.
# One record = one truck on one date+shift, with a driver and N crew members.
# ---------------------------------------------------------------------------
class TruckCrewAssignment(models.Model):
    truck  = models.ForeignKey(Truck, on_delete=models.CASCADE, related_name='crew_assignments')
    driver = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='driven_assignments',
        limit_choices_to={'role': 'driver'},
    )
    crew_members = models.ManyToManyField(
        User, related_name='crew_assignments', blank=True,
        limit_choices_to={'employee_type': 'crew_member'},
    )
    # Reference CollectionSchedule for shift/date context — avoids duplicating shift info
    schedule   = models.ForeignKey(
        CollectionSchedule, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='crew_assignments',
    )
    date       = models.DateField()
    is_active  = models.BooleanField(default=True, help_text='False = historical record')
    notes      = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='assignments_created',
    )

    class Meta:
        ordering = ['-date']
        constraints = [
            models.UniqueConstraint(
                fields=['truck', 'date', 'schedule'],
                condition=models.Q(is_active=True),
                name='unique_active_assignment_per_truck_date_schedule',
            )
        ]

    def __str__(self):
        return f"{self.truck} — {self.date} (Driver: {self.driver})"


# ---------------------------------------------------------------------------
# Waste Delivery
# Records each truck trip to a dumpsite.
# net_weight is auto-computed: gross_weight - tare_weight.
# Shift context comes from the linked CollectionSchedule (no separate field).
# No waste_type — system only handles solid waste.
# ---------------------------------------------------------------------------
class WasteDelivery(models.Model):
    # Core actors
    truck             = models.ForeignKey(Truck,    on_delete=models.PROTECT, related_name='deliveries')
    driver            = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name='deliveries_as_driver',
        limit_choices_to={'role': 'driver'},
    )
    dumpsite          = models.ForeignKey(Dumpsite, on_delete=models.PROTECT, related_name='deliveries')
    dumpsite_operator = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='deliveries_received',
        limit_choices_to={'role': 'dumpsite'},
    )

    # Shift context — reuse CollectionSchedule (has start_time, end_time, days, barangay)
    schedule        = models.ForeignKey(
        CollectionSchedule, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='deliveries',
    )
    crew_assignment = models.ForeignKey(
        TruckCrewAssignment, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='deliveries',
    )

    # Timing
    date         = models.DateField()
    arrival_time = models.TimeField(null=True, blank=True)

    # Weight — all in kilograms; net auto-computed on save
    gross_weight = models.DecimalField(max_digits=10, decimal_places=2)
    tare_weight  = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    net_weight   = models.DecimalField(max_digits=10, decimal_places=2, editable=False, default=0)

    # Barangay served (for per-barangay analytics)
    barangay = models.ForeignKey(
        'accounts.Barangay', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='waste_deliveries',
    )

    # Metadata
    remarks      = models.TextField(blank=True)
    is_validated = models.BooleanField(default=False, help_text='Dumpsite operator confirmed this record')
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering        = ['-date', '-arrival_time']
        verbose_name    = 'Waste Delivery'
        verbose_name_plural = 'Waste Deliveries'

    def save(self, *args, **kwargs):
        self.net_weight = self.gross_weight - self.tare_weight
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.truck} → {self.dumpsite} | {self.date} | {self.net_weight} kg"

class DriverShift(models.Model):
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='shifts')
    truck = models.ForeignKey(Truck, on_delete=models.SET_NULL, null=True, blank=True, related_name='shifts')
    duty_type = models.CharField(max_length=50, default='normal')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.BigIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    op_status = models.CharField(
        max_length=20,
        default='on_duty',
        help_text="Operational status: on_duty | on_route | delayed"
    )
    current_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    current_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    last_location_update = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['driver'],
                condition=Q(is_active=True),
                name='unique_active_shift_per_driver'
            ),
            models.UniqueConstraint(
                fields=['truck'],
                condition=Q(is_active=True),
                name='unique_active_shift_per_truck'
            )
        ]
        indexes = [
            # Hot path: live map — filter all active shifts fast
            models.Index(fields=['is_active'], name='drivershift_is_active_idx'),
            # Hot path: analytics — driver shift history ordered by time
            models.Index(fields=['driver', '-started_at'], name='drivershift_driver_started_idx'),
        ]

    def __str__(self):
        return f"Shift for {self.driver} - Active: {self.is_active}"

class CalendarEvent(models.Model):
    title = models.CharField(max_length=200)
    date = models.DateField()
    location = models.CharField(max_length=255, blank=True)
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='calendar_events')
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.title} on {self.date}"
