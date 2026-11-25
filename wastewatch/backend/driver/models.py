from django.db import models
from django.db.models import Q
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.conf import settings
from cloudinary.models import CloudinaryField

User = get_user_model()

class TruckStatus(models.TextChoices):
    ACTIVE = 'active', 'Active'
    MAINTENANCE = 'maintenance', 'Maintenance'
    INACTIVE = 'inactive', 'Inactive'


class CommissioningProvenance(models.TextChoices):
    UNCOMMISSIONED = 'uncommissioned', 'Uncommissioned'
    COMMISSIONED_VERIFIED = 'commissioned_verified', 'Commissioned (Date Verified)'
    COMMISSIONED_DATE_UNKNOWN = 'commissioned_date_unknown', 'Commissioned (Date Unknown)'
    LEGACY_UNRECONCILED = 'legacy_unreconciled', 'Legacy (Status Unreconciled)'


class TruckRetirementState(models.TextChoices):
    UNCOMMISSIONED = 'uncommissioned', 'Uncommissioned'
    OPERATIONAL = 'operational', 'Operational'
    LEGACY_RECONCILIATION = 'legacy_reconciliation', 'Legacy Reconciliation'
    RETIREMENT_IN_PROGRESS = 'retirement_in_progress', 'Retirement In Progress'
    PERMANENTLY_RETIRED = 'permanently_retired', 'Permanently Retired'


class TruckQuerySet(models.QuerySet):
    def delete(self):
        from django.db.models.deletion import ProtectedError
        raise ProtectedError(
            "Bulk deletion of Truck records via QuerySet.delete() is strictly prohibited. "
            "Eligible uncommissioned vehicles must be deleted individually via TruckService.delete_uncommissioned_truck().",
            list(self)
        )


class Truck(models.Model):
    plate_number = models.CharField(max_length=20, unique=True)
    model = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=TruckStatus.choices, default=TruckStatus.ACTIVE)
    op_status = models.CharField(
        max_length=25,
        default='AVAILABLE',
        choices=[
            ('AVAILABLE', 'Available'),
            ('ASSIGNED', 'Assigned'),
            ('IN_TRANSIT', 'In Transit'),
            ('BREAKDOWN', 'Breakdown'),
            ('MAINTENANCE', 'Maintenance'),
        ]
    )
    mechanical_condition = models.CharField(
        max_length=25,
        default='OPERATIONAL',
        choices=[
            ('OPERATIONAL', 'Operational'),
            ('NEEDS_REPAIR', 'Needs Repair'),
            ('CRITICAL', 'Critical'),
        ]
    )
    inspection_state = models.CharField(
        max_length=25,
        default='PASSED',
        choices=[
            ('PASSED', 'Passed Inspection'),
            ('PENDING_INSPECTION', 'Pending Inspection'),
            ('FAILED', 'Failed Inspection'),
        ]
    )
    drivers = models.ManyToManyField(User, related_name='assigned_trucks', blank=True)
    crew = models.ManyToManyField(User, related_name='crew_trucks', blank=True)
    zone = models.CharField(max_length=100, blank=True)
    current_capacity = models.IntegerField(default=0) # 0-100%
    last_service = models.DateField(null=True, blank=True)
    maintenance_start = models.DateTimeField(null=True, blank=True)
    status_reason = models.TextField(blank=True, null=True, help_text="Reason for maintenance or inactive status")
    past_crew_names = models.TextField(blank=True, null=True, help_text="Stores the names of the last assigned crew when the truck becomes inactive.")
    max_capacity_kg = models.DecimalField(
        max_digits=8, decimal_places=2, default=1000.00,
        help_text="Rated maximum payload in kg. Used by dumpsite fill slider."
    )
    photo = CloudinaryField('image', null=True, blank=True)
    date_bought = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # Milestone 0B Stage 1: Fleet Commissioning, Retirement Lifecycle & Operational Hold Fields
    mechanical_status = models.CharField(
        max_length=30,
        default='serviceable',
        choices=[
            ('serviceable', 'Serviceable'),
            ('needs_inspection', 'Needs Inspection'),
            ('disabled', 'Disabled'),
        ]
    )
    maintenance_status = models.CharField(
        max_length=30,
        default='available',
        choices=[
            ('available', 'Available'),
            ('scheduled_maintenance', 'Scheduled Maintenance'),
            ('under_repair', 'Under Repair'),
        ]
    )
    is_operational_hold = models.BooleanField(default=False, null=False, db_index=True)
    is_retired = models.BooleanField(default=False, null=False, db_index=True)
    commissioned_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Timestamp when vehicle was formally commissioned into active municipal fleet service. NULL if uncommissioned or date unknown."
    )
    commissioning_provenance = models.CharField(
        max_length=40,
        choices=CommissioningProvenance.choices,
        default=CommissioningProvenance.UNCOMMISSIONED,
        null=False,
        db_index=True,
        help_text="Authoritative provenance and evidence classification of vehicle commissioning."
    )
    retirement_state = models.CharField(
        max_length=30,
        choices=TruckRetirementState.choices,
        default=TruckRetirementState.UNCOMMISSIONED,
        null=False,
        db_index=True,
        help_text="Explicit workflow lifecycle state for vehicle commissioning and retirement."
    )
    last_inspected_dumpsite = models.ForeignKey(
        'dumpsite.Dumpsite',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inspected_trucks'
    )
    hold_dumpsite = models.ForeignKey(
        'dumpsite.Dumpsite',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='held_trucks',
        help_text="Authoritative Dumpsite facility that placed the operational hold"
    )
    hold_placed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
        help_text="Actor who placed the truck on hold"
    )
    hold_placed_at = models.DateTimeField(null=True, blank=True)
    hold_reason = models.CharField(max_length=255, blank=True, default='')

    objects = TruckQuerySet.as_manager()

    class Meta:
        constraints = [
            # C0a. Database-level value restriction: commissioning_provenance must be a valid enum choice
            models.CheckConstraint(
                check=Q(commissioning_provenance__in=[
                    'uncommissioned',
                    'commissioned_verified',
                    'commissioned_date_unknown',
                    'legacy_unreconciled',
                ]),
                name='chk_truck_provenance_valid_values',
            ),
            # C0b. Database-level value restriction: retirement_state must be a valid enum choice
            models.CheckConstraint(
                check=Q(retirement_state__in=[
                    'uncommissioned',
                    'operational',
                    'legacy_reconciliation',
                    'retirement_in_progress',
                    'permanently_retired',
                ]),
                name='chk_truck_retirement_state_valid_values',
            ),
            # C1. Uncommissioned retirement_state requires uncommissioned provenance, NULL date, and is_retired=False
            models.CheckConstraint(
                check=(
                    ~Q(retirement_state='uncommissioned') |
                    (Q(commissioning_provenance='uncommissioned') & Q(commissioned_at__isnull=True) & Q(is_retired=False))
                ),
                name='chk_truck_uncommissioned_state_integrity',
            ),
            # C2. Uncommissioned provenance requires uncommissioned retirement_state, NULL date, and is_retired=False
            models.CheckConstraint(
                check=(
                    ~Q(commissioning_provenance='uncommissioned') |
                    (Q(retirement_state='uncommissioned') & Q(commissioned_at__isnull=True) & Q(is_retired=False))
                ),
                name='chk_truck_uncommissioned_provenance_integrity',
            ),
            # C3. Commissioned verified assets must have a non-null commissioning timestamp and valid lifecycle state
            models.CheckConstraint(
                check=(
                    ~Q(commissioning_provenance='commissioned_verified') |
                    (Q(commissioned_at__isnull=False) & Q(retirement_state__in=['operational', 'retirement_in_progress', 'permanently_retired']))
                ),
                name='chk_truck_verified_requires_timestamp',
            ),
            # C4. Commissioned date unknown assets must have NULL commissioning timestamp and valid lifecycle state
            models.CheckConstraint(
                check=(
                    ~Q(commissioning_provenance='commissioned_date_unknown') |
                    (Q(commissioned_at__isnull=True) & Q(retirement_state__in=['operational', 'retirement_in_progress', 'permanently_retired']))
                ),
                name='chk_truck_date_unknown_requires_null_timestamp',
            ),
            # C5a. Legacy unreconciled provenance requires legacy_reconciliation state, NULL timestamp, and is_retired=False
            models.CheckConstraint(
                check=(
                    ~Q(commissioning_provenance='legacy_unreconciled') |
                    (Q(commissioned_at__isnull=True) & Q(retirement_state='legacy_reconciliation') & Q(is_retired=False))
                ),
                name='chk_truck_legacy_unreconciled_state',
            ),
            # C5b. Legacy reconciliation retirement_state requires legacy_unreconciled provenance, NULL timestamp, and is_retired=False
            models.CheckConstraint(
                check=(
                    ~Q(retirement_state='legacy_reconciliation') |
                    (Q(commissioning_provenance='legacy_unreconciled') & Q(commissioned_at__isnull=True) & Q(is_retired=False))
                ),
                name='chk_truck_legacy_reconciliation_provenance',
            ),
            # C6. Operational state requires is_retired=False (operational trucks cannot be retired)
            models.CheckConstraint(
                check=(
                    ~Q(retirement_state='operational') |
                    Q(is_retired=False)
                ),
                name='chk_truck_operational_not_retired',
            ),
            # C7. Retired flag consistency: is_retired=True if and only if retirement_state is in progress or permanent
            models.CheckConstraint(
                check=(
                    (Q(is_retired=False) & ~Q(retirement_state__in=['retirement_in_progress', 'permanently_retired'])) |
                    (Q(is_retired=True) & Q(retirement_state__in=['retirement_in_progress', 'permanently_retired']))
                ),
                name='chk_truck_retirement_flag_consistency',
            ),
        ]

    def __str__(self):
        return f"{self.plate_number} ({self.model})"

    def save(self, *args, **kwargs):
        from django.utils import timezone
        if self.pk:
            try:
                orig = Truck.objects.get(pk=self.pk)
                if orig.status != TruckStatus.MAINTENANCE and self.status == TruckStatus.MAINTENANCE:
                    self.maintenance_start = timezone.now()
                if orig.status == TruckStatus.MAINTENANCE and self.status != TruckStatus.MAINTENANCE:
                    self.maintenance_start = None
                
                if orig.status == TruckStatus.ACTIVE and self.status == TruckStatus.INACTIVE:
                    # Capture past crew names before they are cleared
                    past_names = [f"{c.first_name} {c.last_name}".strip() for c in self.crew.all()]
                    past_names = [n for n in past_names if n]
                    if not past_names:
                        past_names = [c.username for c in self.crew.all()]
                    if past_names:
                        self.past_crew_names = ", ".join(past_names)

                if (
                    orig.status != TruckStatus.INACTIVE
                    and self.status == TruckStatus.INACTIVE
                    and self.retirement_state not in (
                        TruckRetirementState.RETIREMENT_IN_PROGRESS,
                        TruckRetirementState.PERMANENTLY_RETIRED,
                    )
                ):
                    self.schedules.update(driver=None, truck=None)
                    # Driver/crew are no longer cleared by the frontend now that
                    # "edit truck" and "assign driver/crew" are separate modals —
                    # this must be authoritative here instead.
                    self.drivers.clear()
                    self.crew.clear()

            except Truck.DoesNotExist:
                if self.status == TruckStatus.MAINTENANCE:
                    self.maintenance_start = timezone.now()
        else:
            if self.status == TruckStatus.MAINTENANCE:
                self.maintenance_start = timezone.now()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        # Physical deletion is strictly guarded by pre_delete signal (guard_truck_pre_delete)
        # and TruckService.delete_uncommissioned_truck. Never silently mutate schedules here.
        super().delete(*args, **kwargs)


def is_truck_dispatchable(truck) -> bool:
    """
    Canonical predicate evaluating whether a Truck can be assigned or dispatched.
    Evaluates operational availability, commissioning provenance, retirement state,
    operational hold, and mechanical/maintenance status.
    Supports both commissioned_verified (commissioned_at is not None) and
    commissioned_date_unknown (commissioned_at is None).
    """
    if truck is None:
        return False
    return (
        truck.status == TruckStatus.ACTIVE
        and not truck.is_retired
        and truck.retirement_state == TruckRetirementState.OPERATIONAL
        and truck.commissioning_provenance in (
            CommissioningProvenance.COMMISSIONED_VERIFIED,
            CommissioningProvenance.COMMISSIONED_DATE_UNKNOWN,
        )
        and (
            (truck.commissioning_provenance == CommissioningProvenance.COMMISSIONED_VERIFIED and truck.commissioned_at is not None)
            or (truck.commissioning_provenance == CommissioningProvenance.COMMISSIONED_DATE_UNKNOWN and truck.commissioned_at is None)
        )
        and not truck.is_operational_hold
        and truck.mechanical_status == 'serviceable'
        and truck.maintenance_status == 'available'
        and truck.mechanical_condition == 'OPERATIONAL'
    )


class CollectionSchedule(models.Model):
    truck = models.ForeignKey(Truck, on_delete=models.SET_NULL, null=True, blank=True, related_name='schedules')
    driver = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='collection_schedules')
    default_team = models.ForeignKey(
        'SanitationTeam',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='default_schedules',
        help_text='D-10 baseline team responsible for this schedule route.'
    )
    barangays = models.ManyToManyField('accounts.Barangay', related_name='collection_schedules', blank=True)
    area = models.CharField(max_length=255, blank=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    days = models.CharField(max_length=100, help_text="e.g. Mon, Wed, Fri", blank=True)
    frequency = models.CharField(max_length=100, blank=True)
    
    # Route specifics
    waypoints = models.JSONField(default=list, blank=True)
    dumpsite = models.ForeignKey('dumpsite.Dumpsite', on_delete=models.SET_NULL, null=True, blank=True, related_name='collection_schedules')

    # Specific date if it's a one-time thing, otherwise can be null for recurring
    date = models.DateField(null=True, blank=True)

    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING')
    is_available = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Resident-facing availability and publication status of this collection schedule."
    )

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        update_fields = kwargs.get('update_fields')
        if update_fields is not None:
            relevant_fields = {'waypoints', 'driver', 'days', 'date', 'status'}
            if not (set(update_fields) & relevant_fields):
                return
        self.sync_pickup_statuses()

    def sync_pickup_statuses(self):
        if not self.pk:
            return

        try:
            from watcher.stop_validation_service import ensure_stop_validations_for_schedule
            with transaction.atomic():
                ensure_stop_validations_for_schedule(self)
        except Exception:
            pass

        stops = [wp for idx, wp in enumerate(self.waypoints or []) if idx > 0]
        desired_order_set = set(range(1, len(stops) + 1))
        existing_statuses = {ps.stop_order: ps for ps in self.pickups.all()}

        with transaction.atomic():
            if self.driver_id is not None:
                for order, waypoint in enumerate(stops, start=1):
                    address = ''
                    barangay_id = None
                    stop_id = None
                    if isinstance(waypoint, dict):
                        address = waypoint.get('label') or waypoint.get('address') or ''
                        barangay_id = waypoint.get('barangay_id')
                        stop_id = waypoint.get('stop_id')
                    
                    if order in existing_statuses:
                        ps = existing_statuses[order]
                        ps.driver = self.driver
                        ps.schedule = self
                        ps.address = address
                        ps.barangay_id = barangay_id
                        ps.stop_id = stop_id
                        ps.save(update_fields=['driver', 'schedule', 'address', 'barangay_id', 'stop_id'])
                    else:
                        self.pickups.create(
                            driver=self.driver,
                            status='EN_ROUTE',
                            stop_order=order,
                            address=address,
                            barangay_id=barangay_id,
                            stop_id=stop_id,
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
        ('DRIVER_MISSED', 'Driver Missed'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='EN_ROUTE')
    barangay = models.ForeignKey(
        'accounts.Barangay',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='pickups'
    )
    stop_id = models.CharField(max_length=100, blank=True, null=True, help_text='Stable stop ID from route builder')
    # Stop detail fields — used by the driver collection log UI
    stop_order  = models.PositiveIntegerField(default=0, help_text='Order of this stop in the route')
    address     = models.CharField(max_length=255, blank=True)
    note        = models.TextField(blank=True)
    photo_url   = CloudinaryField('image', null=True, blank=True)
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




class DriverShift(models.Model):
    PHASE_CHOICES = [
        ('navigate_to_base', 'Navigating to base'),
        ('confirm_start',    'Confirming start'),
        ('checkin',          'Check-in'),
        ('shiftroute',       'On route'),
        ('end_shift',        'Ending shift'),
    ]

    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='shifts')
    truck = models.ForeignKey(Truck, on_delete=models.SET_NULL, null=True, blank=True, related_name='shifts')
    allocation = models.ForeignKey(
        'ScheduleTruckAllocation',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='driver_shifts',
        help_text='D-11 Authoritative pre-allocated truck and sanitation team anchor.'
    )
    
    # ── NEW: direct link to the route this shift is running ──────────────
    schedule = models.ForeignKey(
        'CollectionSchedule',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='driver_shifts',
        help_text='The specific route/schedule this shift is executing. '
                   'Set at shift-start time so schedule_id is authoritative, '
                   'not re-derived on every request.',
    )

    status = models.CharField(max_length=32, choices=PHASE_CHOICES, default='navigate_to_base')
    duty_type = models.CharField(max_length=50, default='normal')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.BigIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    end_reason = models.CharField(
        max_length=20,
        blank=True,
        default='',
        help_text='completed | driver_ended | admin_override | admin_force_ended | truck_retired | heartbeat_timeout | truck_deleted (legacy)'
    )
    end_reason_notes = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text='Optional bounded explanatory text when ending a shift.'
    )
    op_status = models.CharField(
        max_length=20,
        default='on_duty',
        help_text="Operational status: on_duty | on_route | heading_to_dumpsite | at_dumpsite | returning_to_base | delayed"
    )
    end_shift_phase = models.CharField(
        max_length=40,
        blank=True, default='',
        help_text="EndShiftModule sub-phase: dump_site | waiting_dump_confirmation | returning | at_base | calibration_complete"
    )
    is_extended_mode = models.BooleanField(default=False, help_text="True if driver opted to take missed stops")
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

    @property
    def effective_schedule(self):
        if self.allocation_id and self.allocation.schedule:
            return self.allocation.schedule
        return self.schedule

    @property
    def effective_truck(self):
        if self.allocation_id and self.allocation.truck:
            return self.allocation.truck
        return self.truck

    @property
    def effective_team(self):
        if self.allocation_id:
            return self.allocation.team
        return None

    @property
    def effective_dumpsite(self):
        sched = self.effective_schedule
        return getattr(sched, 'dumpsite', None) if sched else None


class CalendarEvent(models.Model):
    title = models.CharField(max_length=200)
    date = models.DateField()
    location = models.CharField(max_length=255, blank=True)
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='calendar_events')
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.title} on {self.date}"

# ---------------------------------------------------------------------------
# Missed Stops & Extended Mode
# ---------------------------------------------------------------------------
class MissedStopReason(models.TextChoices):
    TRUCK_FULL         = 'TRUCK_FULL',         'Truck was full'
    EXPIRED_TIME       = 'EXPIRED_TIME',       'Time expired without visit'
    WATCHER_FLAG       = 'WATCHER_FLAG',       'Falsely reported collected (Watcher flagged)'
    DRIVER_SKIP        = 'DRIVER_SKIP',        'Driver intentionally skipped'
    SHIFT_ENDED_EARLY  = 'SHIFT_ENDED_EARLY',  'Shift ended early (Breakdown, weather, etc)'

class MissedStopStatus(models.TextChoices):
    PENDING      = 'PENDING',   'Pending reassignment'
    RESOLVED     = 'RESOLVED',  'Collected by extended driver'
    EXPIRED      = 'EXPIRED',   'Not collected (day ended)'

class MissedStop(models.Model):
    original_schedule  = models.ForeignKey(CollectionSchedule, on_delete=models.CASCADE, related_name='missed_stops')
    stop_order         = models.PositiveIntegerField()
    waypoint_data      = models.JSONField(help_text="Stores lat, lng, label, barangay_id, stop_id")
    reason             = models.CharField(max_length=20, choices=MissedStopReason.choices)
    early_end_reason   = models.CharField(max_length=255, blank=True, null=True, help_text="Specific reason if SHIFT_ENDED_EARLY")
    status             = models.CharField(max_length=15, choices=MissedStopStatus.choices, default=MissedStopStatus.PENDING)
    collection_date    = models.DateField()
    created_at         = models.DateTimeField(auto_now_add=True)
    resolved_at        = models.DateTimeField(null=True, blank=True)
    resolved_by_shift  = models.ForeignKey('DriverShift', null=True, blank=True, on_delete=models.SET_NULL, related_name='resolved_missed_stops')
    escalation         = models.ForeignKey('watcher.Escalation', null=True, blank=True, on_delete=models.SET_NULL, related_name='missed_stops')

    class Meta:
        ordering = ['collection_date', 'original_schedule', 'stop_order']
        constraints = [
            models.UniqueConstraint(
                fields=['original_schedule', 'stop_order', 'collection_date'], 
                name='unique_missed_stop'
            )
        ]

    def __str__(self):
        return f"MissedStop {self.id}: Stop {self.stop_order} on {self.collection_date} ({self.status})"

class DriverPerformance(models.Model):
    driver = models.OneToOneField(User, on_delete=models.CASCADE, related_name='performance')
    total_points = models.IntegerField(default=0)
    missed_stops_recovered = models.IntegerField(default=0)
    missed_stops_caused = models.IntegerField(default=0, help_text="Increments only for penalized reasons (e.g. WATCHER_FLAG, DRIVER_SKIP)")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Performance for {self.driver.username} - {self.total_points} pts"

class SystemSetting(models.Model):
    """Singleton row (pk=1) holding system-wide settings."""
    home_base_lat = models.FloatField(default=13.9373)
    home_base_lng = models.FloatField(default=121.617)
    home_base_label = models.CharField(max_length=120, default='City Hall — Home Base')
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='+',
    )

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass  # singleton, never deleted

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Worker(models.Model):
    """
    Canonical identity for physical human workers, independent of authentication.
    Supports non-login crew members without accounts, passwords, or personal mobile devices.
    """
    employee_id = models.CharField(
        max_length=50,
        unique=True,
        db_index=True,
        help_text='Unique organizational employee identifier',
    )
    full_name = models.CharField(max_length=255)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='worker_profile',
        help_text='Optional link to system User account (for Drivers and Watchers who log in)',
    )
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'driver_worker'
        ordering = ['full_name']

    def __str__(self):
        return f"{self.full_name} ({self.employee_id})"


class SanitationTeam(models.Model):
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=20, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sanitation_team'
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.code})"


class SanitationTeamMembership(models.Model):
    ROLE_CHOICES = [
        ('leader', 'Team Leader'),
        ('driver', 'Driver'),
        ('crew', 'Crew Member'),
    ]

    team = models.ForeignKey(SanitationTeam, on_delete=models.PROTECT, related_name='memberships')
    worker = models.ForeignKey(Worker, on_delete=models.PROTECT, related_name='team_memberships')
    role_in_team = models.CharField(max_length=20, choices=ROLE_CHOICES)
    is_active = models.BooleanField(default=True, db_index=True)
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='membership_grants')

    class Meta:
        db_table = 'sanitation_team_membership'
        constraints = [
            models.UniqueConstraint(
                fields=['worker'],
                condition=models.Q(is_active=True),
                name='unique_active_worker_team_membership'
            ),
            models.UniqueConstraint(
                fields=['team'],
                condition=models.Q(is_active=True, role_in_team='leader'),
                name='unique_active_leader_per_team'
            ),
            models.UniqueConstraint(
                fields=['team'],
                condition=models.Q(is_active=True, role_in_team='driver'),
                name='unique_active_driver_per_team'
            )
        ]

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.is_active:
            if self.left_at is not None:
                raise ValidationError({'left_at': 'Active team membership cannot have left_at set.'})
            if self.pk:
                prev = SanitationTeamMembership.objects.filter(pk=self.pk).values('is_active', 'left_at').first()
                if prev and (not prev['is_active'] or prev['left_at'] is not None):
                    raise ValidationError({
                        'is_active': 'Historical team memberships cannot be reactivated; create a new membership instead.'
                    })
            if self.team_id and not self.team.is_active:
                raise ValidationError({'team': 'Cannot maintain an active membership on an inactive team.'})
            if self.worker_id:
                if not self.worker.is_active:
                    raise ValidationError({'worker': 'Cannot maintain an active membership for an inactive worker.'})
                from .team_service import TeamService
                TeamService._validate_worker_role_eligibility(self.worker, self.role_in_team)

    def __str__(self):
        return f"{self.worker.full_name} -> {self.team.name} ({self.role_in_team})"


class ScheduleTeamOverride(models.Model):
    """
    D-10 schedule-level team override for a specific date.
    Leaves the baseline schedule's default_team untouched.
    """
    schedule = models.ForeignKey(
        CollectionSchedule,
        on_delete=models.CASCADE,
        related_name='team_overrides'
    )
    team = models.ForeignKey(
        SanitationTeam,
        on_delete=models.PROTECT,
        related_name='schedule_overrides'
    )
    effective_date = models.DateField(db_index=True)
    reason = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='schedule_team_overrides'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'schedule_team_override'
        ordering = ['-effective_date']
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'effective_date'],
                name='unique_schedule_team_override_per_date'
            )
        ]

    def __str__(self):
        return f"Override for Schedule #{self.schedule_id} on {self.effective_date} -> Team {self.team.code}"


class ScheduleTruckAllocation(models.Model):
    """
    D-11 Pre-allocated truck and team anchor for a schedule date.
    Provides the single source of truth for shift staging and truck availability.
    """
    schedule = models.ForeignKey(
        CollectionSchedule,
        on_delete=models.CASCADE,
        related_name='truck_allocations'
    )
    allocation_date = models.DateField(db_index=True)
    truck = models.ForeignKey(
        Truck,
        on_delete=models.PROTECT,
        related_name='schedule_allocations'
    )
    team = models.ForeignKey(
        SanitationTeam,
        on_delete=models.PROTECT,
        related_name='schedule_allocations'
    )
    allocated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_truck_allocations'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'schedule_truck_allocation'
        ordering = ['-allocation_date']
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'truck', 'allocation_date'],
                name='unique_schedule_truck_allocation_per_date'
            ),
            models.UniqueConstraint(
                fields=['truck', 'allocation_date'],
                name='unique_truck_allocation_per_date'
            )
        ]

    def __str__(self):
        return f"Allocation: Schedule #{self.schedule_id} on {self.allocation_date} -> Truck {self.truck.plate_number} (Team {self.team.code})"


# Canonical alias reconciling specification §11.6 TeamScheduleTruckAssignment with implemented ScheduleTruckAllocation
TeamScheduleTruckAssignment = ScheduleTruckAllocation


class WatcherShift(models.Model):
    """
    Tracks watcher on-duty shifts synchronized with the scheduled collection route.
    """
    watcher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='watcher_shifts'
    )
    schedule = models.ForeignKey(
        CollectionSchedule,
        on_delete=models.CASCADE,
        related_name='watcher_shifts'
    )
    barangay = models.ForeignKey(
        'accounts.Barangay',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='watcher_shifts'
    )
    shift_date = models.DateField(db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    end_reason = models.CharField(
        max_length=50,
        blank=True,
        default='',
        help_text='completed | watcher_ended | stale_unlinked_cleanup | heartbeat_timeout | driver_ended | admin_force_ended',
    )
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'watcher_shift'
        ordering = ['-shift_date', '-started_at']
        constraints = [
            models.UniqueConstraint(
                fields=['watcher', 'shift_date'],
                condition=models.Q(is_active=True),
                name='unique_active_watcher_shift_per_date'
            )
        ]

    def __str__(self):
        return f"Watcher Shift #{self.id} for {self.watcher.username} ({self.shift_date})"


class CrewShift(models.Model):
    """
    Crew duty session linked explicitly to its ScheduleTruckAllocation / CollectionSchedule /
    service_date, and optionally 1:1 with DriverShift and WatcherShift.
    Originates from the official Team Leader attendance workflow.
    Individual crew members are represented exclusively through ShiftCrewRosterSnapshot / ShiftCrewRosterItem.
    """
    driver_shift = models.OneToOneField(
        DriverShift,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='crew_shift'
    )
    watcher_shift = models.OneToOneField(
        WatcherShift,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='crew_shift'
    )
    allocation = models.OneToOneField(
        'ScheduleTruckAllocation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='crew_shift'
    )
    schedule = models.ForeignKey(
        'CollectionSchedule',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='crew_shifts'
    )
    service_date = models.DateField(null=True, blank=True, db_index=True)
    team = models.ForeignKey(
        SanitationTeam,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='crew_shifts'
    )
    team_leader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='led_crew_shifts',
        help_text="Designated Team Leader (Watcher or Driver) responsible for this crew shift.",
    )
    attendance_submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='submitted_crew_attendances',
        help_text="Team Leader user who submitted the initial crew attendance.",
    )
    attendance_submitted_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'crew_shift'
        ordering = ['-started_at']

    def __str__(self):
        return (
            f"CrewShift #{self.id} (DriverShift #{self.driver_shift_id}, "
            f"WatcherShift #{self.watcher_shift_id}, Allocation #{self.allocation_id})"
        )


class ShiftCrewRosterSnapshot(models.Model):
    """
    Append-only snapshot of manifested crew members at shift staging or pre-departure attendance.
    Immutable representation of the physical team roster.
    """
    driver_shift = models.ForeignKey(
        DriverShift,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='roster_snapshots'
    )
    crew_shift = models.ForeignKey(
        CrewShift,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='roster_snapshots'
    )
    staged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='staged_rosters'
    )
    snapshot_timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'shift_crew_roster_snapshot'
        ordering = ['-snapshot_timestamp']
        constraints = [
            models.UniqueConstraint(
                fields=['driver_shift'],
                condition=Q(driver_shift__isnull=False),
                name='unique_roster_snapshot_per_shift'
            ),
            models.UniqueConstraint(
                fields=['crew_shift'],
                condition=Q(crew_shift__isnull=False),
                name='unique_roster_snapshot_per_crew_shift'
            ),
        ]

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            from django.core.exceptions import ValidationError
            raise ValidationError("Shift crew roster snapshots are immutable once created.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        from django.core.exceptions import ValidationError
        raise ValidationError("Shift crew roster snapshots cannot be deleted.")

    def __str__(self):
        return f"Roster Snapshot #{self.id} (Shift #{self.driver_shift_id}, CrewShift #{self.crew_shift_id})"


class ShiftCrewRosterItem(models.Model):
    """
    Individual crew member entry within a ShiftCrewRosterSnapshot.
    """
    snapshot = models.ForeignKey(
        ShiftCrewRosterSnapshot,
        on_delete=models.CASCADE,
        related_name='items'
    )
    worker = models.ForeignKey(
        Worker,
        on_delete=models.PROTECT,
        related_name='roster_items'
    )
    role_in_roster = models.CharField(max_length=20)
    is_present = models.BooleanField(default=True)

    class Meta:
        db_table = 'shift_crew_roster_item'
        constraints = [
            models.UniqueConstraint(
                fields=['snapshot', 'worker'],
                name='unique_worker_per_roster_snapshot'
            )
        ]

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            from django.core.exceptions import ValidationError
            raise ValidationError("Shift crew roster items are immutable once finalized.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        from django.core.exceptions import ValidationError
        raise ValidationError("Shift crew roster items cannot be deleted.")

    def __str__(self):
        return f"{self.worker.full_name} in Snapshot #{self.snapshot_id} ({self.role_in_roster})"


class CrewAttendanceRecord(models.Model):
    """
    C1 Safeguard: Immutable attendance log for crew members during shift check-in.
    Updates and deletes are strictly prohibited at model and database levels.
    """
    STATUS_CHOICES = [
        ('PRESENT', 'Present'),
        ('ABSENT', 'Absent'),
        ('LATE', 'Late'),
        ('EXCUSED', 'Excused'),
        ('SUBSTITUTE', 'Substitute Worker'),
    ]

    driver_shift = models.ForeignKey(
        DriverShift,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='attendance_records'
    )
    crew_shift = models.ForeignKey(
        CrewShift,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='attendance_records'
    )
    worker = models.ForeignKey(
        Worker,
        on_delete=models.PROTECT,
        related_name='attendance_records'
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)
    checked_in_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='attendance_checkins'
    )
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'crew_attendance_record'
        ordering = ['-recorded_at']
        constraints = [
            models.UniqueConstraint(
                fields=['driver_shift', 'worker'],
                condition=Q(driver_shift__isnull=False),
                name='unique_worker_attendance_per_shift'
            ),
            models.UniqueConstraint(
                fields=['crew_shift', 'worker'],
                condition=Q(crew_shift__isnull=False),
                name='unique_worker_attendance_per_crew_shift'
            ),
        ]

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            from django.core.exceptions import ValidationError
            raise ValidationError("Crew attendance records are immutable. Use CrewAttendanceCorrection to amend.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        from django.core.exceptions import ValidationError
        raise ValidationError("Crew attendance records cannot be deleted.")

    def __str__(self):
        return f"Attendance #{self.id}: {self.worker.full_name} -> {self.status} (Shift #{self.driver_shift_id}, CrewShift #{self.crew_shift_id})"


class CrewAttendanceCorrection(models.Model):
    """
    C1 Safeguard: Authorized append-only correction to an initial CrewAttendanceRecord.
    Maintains an unbroken audit trail of attendance amendments.
    """
    original_record = models.ForeignKey(
        CrewAttendanceRecord,
        on_delete=models.PROTECT,
        related_name='corrections'
    )
    correction_sequence = models.PositiveIntegerField(default=1)
    previous_status = models.CharField(max_length=20)
    corrected_status = models.CharField(max_length=20)
    reason = models.TextField()
    corrected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='attendance_corrections'
    )
    corrected_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'crew_attendance_correction'
        ordering = ['-correction_sequence', '-corrected_at']
        constraints = [
            models.UniqueConstraint(
                fields=['original_record', 'correction_sequence'],
                name='unique_correction_sequence_per_record'
            )
        ]

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            from django.core.exceptions import ValidationError
            raise ValidationError("Crew attendance corrections are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        from django.core.exceptions import ValidationError
        raise ValidationError("Crew attendance corrections cannot be deleted.")

    def __str__(self):
        return f"Correction #{self.id} for Record #{self.original_record_id}: {self.previous_status} -> {self.corrected_status}"


class UnfinishedStopReview(models.Model):
    """
    D-12 Stop Status Preservation:
    Logs and reviews incomplete stops when a shift ends early or incompletely,
    preserving collected stops and StopValidation evidence immutably.
    """
    RESOLUTION_STATUS_CHOICES = [
        ('PENDING', 'Pending Admin Review'),
        ('RESOLVED', 'Resolved'),
        ('DISMISSED', 'Dismissed'),
    ]

    shift = models.ForeignKey(
        DriverShift,
        on_delete=models.CASCADE,
        related_name='unfinished_stop_reviews'
    )
    stop_validation = models.ForeignKey(
        'watcher.StopValidation',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='unfinished_reviews'
    )
    pickup_status = models.ForeignKey(
        'PickupStatus',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='unfinished_reviews'
    )
    service_date = models.DateField(null=True, blank=True, db_index=True)
    stop_order = models.PositiveIntegerField()
    recorded_status = models.CharField(max_length=50)
    reason = models.CharField(max_length=255, blank=True)
    resolution_status = models.CharField(
        max_length=20,
        choices=RESOLUTION_STATUS_CHOICES,
        default='PENDING',
        db_index=True,
    )
    resolution_notes = models.TextField(blank=True, default='')
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_unfinished_stops'
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'unfinished_stop_review'
        ordering = ['stop_order']
        constraints = [
            models.UniqueConstraint(
                fields=['shift', 'stop_order'],
                name='unique_unfinished_review_per_shift_stop'
            )
        ]

    def __str__(self):
        return f"Unfinished Stop #{self.stop_order} on Shift #{self.shift_id} ({self.recorded_status})"



class LegacyCrewReconciliationAudit(models.Model):
    """
    Quarantine and audit trail for ambiguous legacy crew records.
    Prevents automated name-based worker merging.
    """
    STATUS_CHOICES = [
        ('PENDING_REVIEW', 'Pending Review'),
        ('MERGED', 'Merged with Existing Worker'),
        ('PROMOTED', 'Promoted to Permanent Worker'),
        ('DISMISSED', 'Dismissed Invalid'),
    ]

    provisional_worker = models.ForeignKey(
        Worker,
        on_delete=models.CASCADE,
        related_name='reconciliation_records',
    )
    source_assignment_id = models.IntegerField(null=True, blank=True)
    raw_name_string = models.CharField(max_length=255)
    detected_conflicts = models.JSONField(default=dict, blank=True)
    reconciliation_status = models.CharField(
        max_length=30,
        choices=STATUS_CHOICES,
        default='PENDING_REVIEW',
        db_index=True,
    )
    notes = models.TextField(blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reconciled_workers',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'legacy_crew_reconciliation_audit'
        ordering = ['-created_at']

    def __str__(self):
        return f"Reconciliation #{self.id} for {self.raw_name_string} ({self.reconciliation_status})"


class TruckReplacementRequest(models.Model):
    """
    Persisted truck replacement request submitted by an assigned Driver (or Operator/Admin).
    Replacement execution remains restricted to Admin or authorized Facility Operator.
    """
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
    ]

    driver_shift = models.ForeignKey(
        DriverShift,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='truck_replacement_requests',
    )
    schedule = models.ForeignKey(
        CollectionSchedule,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='truck_replacement_requests',
    )
    truck = models.ForeignKey(
        Truck,
        on_delete=models.PROTECT,
        related_name='replacement_requests',
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='truck_replacement_requests',
    )
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING', db_index=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='resolved_truck_replacement_requests',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'driver_truckreplacementrequest'
        ordering = ['-created_at']

    def __str__(self):
        return f"TruckReplacementRequest #{self.id} for Truck #{self.truck_id} ({self.status})"


class TruckOperationalHoldLog(models.Model):
    """
    Persistent audit log of operational holds placed on Trucks (e.g. failed post-shift
    or facility inspections) and subsequent clearances.
    """
    truck = models.ForeignKey(
        Truck,
        on_delete=models.PROTECT,
        related_name='operational_hold_logs',
    )
    dumpsite = models.ForeignKey(
        'dumpsite.Dumpsite',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='operational_hold_logs',
    )
    inspection = models.ForeignKey(
        'dumpsite.DumpsiteTruckInspection',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='hold_logs',
    )
    is_active = models.BooleanField(default=True, db_index=True)
    reason = models.TextField(blank=True, default='')
    placed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='placed_truck_holds',
    )
    placed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    cleared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cleared_truck_holds',
    )
    cleared_at = models.DateTimeField(null=True, blank=True)
    resolution_notes = models.TextField(blank=True, default='')

    class Meta:
        db_table = 'driver_truckoperationalholdlog'
        ordering = ['-placed_at', '-id']

    def __str__(self):
        state = 'ACTIVE' if self.is_active else 'CLEARED'
        return f"TruckOperationalHoldLog #{self.id} for Truck #{self.truck_id} ({state})"


class MaintenanceRecordStatus(models.TextChoices):
    SCHEDULED = 'SCHEDULED', 'Scheduled'
    IN_PROGRESS = 'IN_PROGRESS', 'In Progress'
    COMPLETED = 'COMPLETED', 'Completed'
    CANCELLED = 'CANCELLED', 'Cancelled'


class MaintenanceType(models.TextChoices):
    PREVENTIVE = 'PREVENTIVE', 'Preventive Maintenance'
    CORRECTIVE = 'CORRECTIVE', 'Corrective Repair'
    EMERGENCY = 'EMERGENCY', 'Emergency Repair'
    INSPECTION_FOLLOWUP = 'INSPECTION_FOLLOWUP', 'Inspection Follow-up'
    OTHER = 'OTHER', 'Other'


class TruckMaintenanceRecord(models.Model):
    """
    Persistent facility maintenance record for Trucks.
    Preserves Truck.status_reason and does not bypass operational holds or retirement.
    """
    truck = models.ForeignKey(
        Truck,
        on_delete=models.PROTECT,
        related_name='maintenance_records',
    )
    dumpsite = models.ForeignKey(
        'dumpsite.Dumpsite',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='maintenance_records',
    )
    maintenance_type = models.CharField(
        max_length=30,
        choices=MaintenanceType.choices,
        default=MaintenanceType.CORRECTIVE,
    )
    status = models.CharField(
        max_length=20,
        choices=MaintenanceRecordStatus.choices,
        default=MaintenanceRecordStatus.SCHEDULED,
        db_index=True,
    )
    title = models.CharField(max_length=200)
    notes = models.TextField(blank=True, default='')
    completion_notes = models.TextField(blank=True, default='')
    scheduled_for = models.DateField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    odometer_km = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_maintenance_records',
    )
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='started_maintenance_records',
    )
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_maintenance_records',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'driver_truckmaintenancerecord'
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f"TruckMaintenanceRecord #{self.id} for Truck #{self.truck_id} ({self.status})"


class FuelLogStatus(models.TextChoices):
    GAUGE_SUBMITTED = 'GAUGE_SUBMITTED', 'Gauge Submitted'
    REFILL_RECORDED = 'REFILL_RECORDED', 'Refill Recorded'


class FuelLog(models.Model):
    """
    Per-DriverShift fuel gauge and refill record.
    Truck and Dumpsite are always resolved server-side from DriverShift.
    """
    driver_shift = models.OneToOneField(
        DriverShift,
        on_delete=models.PROTECT,
        related_name='fuel_log',
    )
    truck = models.ForeignKey(
        Truck,
        on_delete=models.PROTECT,
        related_name='fuel_logs',
    )
    dumpsite = models.ForeignKey(
        'dumpsite.Dumpsite',
        on_delete=models.PROTECT,
        related_name='fuel_logs',
    )
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='driver_fuel_logs',
    )
    status = models.CharField(
        max_length=25,
        choices=FuelLogStatus.choices,
        default=FuelLogStatus.GAUGE_SUBMITTED,
        db_index=True,
    )
    gauge_percentage = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text='Driver-submitted fuel gauge percentage (0-100).',
    )
    gauge_submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='submitted_fuel_gauges',
    )
    gauge_submitted_at = models.DateTimeField(null=True, blank=True)
    liters_added = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    fuel_cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    odometer_km = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='recorded_fuel_refills',
    )
    recorded_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'driver_fuellog'
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f"FuelLog #{self.id} for Shift #{self.driver_shift_id} / Truck #{self.truck_id} ({self.status})"

