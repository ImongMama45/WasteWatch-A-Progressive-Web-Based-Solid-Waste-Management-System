# WASTEWatch SANITATION TEAM FINAL ARCHITECTURE BLUEPRINT

**Document Status:** OFFICIAL ARCHITECTURAL SPECIFICATION AND RECOVERY BLUEPRINT (FINAL TARGETED CORRECTION ROUND)  
**Target Subsystem:** WasteWatch Sanitation Team, Watcher-Led Field Operations, Fleet Allocation, and Dumpsite Integration  
**Lead Architectural Authority:** WasteWatch System Architecture & Engineering Review Board  
**Target Repository:** D:\Coding\Waste Watch\wastewatch  
**Execution Phase:** Strictly Pre-Implementation (0 Code Modifications, 0 Migrations, 0 DB Changes)  
**Working Tree Invariant:** Fully Preserved (git status --porcelain verified)  
**Iconography Policy:** Strictly 0 Emojis Across Entire Document  
**Final Architecture Verdict:** READY FOR ANOTHER INDEPENDENT REVIEW  

---

## 1. Executive Architecture Summary

The WasteWatch Sanitation Team architecture establishes an enterprise-grade operational foundation for solid waste collection management in Lucena City. By decoupling collection logistics from legacy single-driver assumptions, this design introduces dynamic, coordinated sanitation teams led by Watcher team leaders, executed by certified drivers, and supported by registered collection crew members.

### Core Architectural Invariants:

1. **Hybrid Schedule/Team Assignment (Decision D-10):** Every CollectionSchedule defines a baseline operational team via default_team. Date-specific operational deviations (e.g., driver illness, team rotation, equipment adjustments) are managed through ScheduleTeamOverride. When neither is configured, the shift staging service halts with an explicit configuration error rather than falling back to unassigned defaults.
2. **Peer-Truck Real-Time Visibility (Decision D-11):** Drivers actively executing collection routes receive live telemetry coordinates of peer trucks operating on the same schedule or shared route corridor. Telemetry feeds are isolated within a dedicated Leaflet LayerGroup, ensuring peer coordinate updates never trigger routing recalibrations in OpenRouteService (ORS) algorithms.
3. **Preservation of Unfinished Stops with Traceable Reviews (Decision D-12):** Stops left uncollected at shift conclusion strictly preserve their operational status (PENDING_INSPECTION or READY_FOR_COLLECTION) and automatically generate an audit record in UnfinishedStopReview. This preserves the historical record for administrative review and enables subsequent Watcher verification (RESOLVED_BY_WATCHER) without penalty or silent data modification.
4. **Canonical Worker Identity & Shift Protection (Decision D-13):** A first-class Worker entity represents the physical human worker independently of system user authentication. Active team membership is strictly 1:1 per worker. During active shift execution, worker memberships are locked: transfers, reassignments, or deactivations are rejected at the database and API level.
5. **Deterministic Locking Protocol:** All concurrent multi-entity operations (staging, dispatch, and membership transfer) adhere to a single canonical lock order: SanitationTeam (ascending ID) -> Truck (ascending ID) -> Worker (ascending ID), preventing race conditions, phantoms, and deadlocks under PostgreSQL READ COMMITTED transaction isolation.
6. **Unified Shift Trio Architecture:** A single operational dispatch binds exactly one DriverShift, one WatcherShift, and one CrewShift in a 1-to-1-to-1 relationship. Individual crew workers are manifested as immutable items in ShiftCrewRosterItem linked to the canonical Worker, requiring explicit Watcher confirmation before operational activation.
7. **Database-Enforced Immutability:** Write-once integrity for attendance records, attendance corrections, roster snapshots, and team membership history is enforced directly within the PostgreSQL engine using PL/pgSQL triggers, guaranteeing auditability against direct SQL manipulation.
8. **Three-Dimensional Fleet Tracking:** Truck availability is separated into three independent persisted dimensions: Operational Availability (AVAILABLE, ALLOCATED, DISPATCHED, OUT_OF_SERVICE), Mechanical Condition (CLEARED, NEEDS_REPAIR, MAINTENANCE, DECOMMISSIONED), and Inspection State (PENDING_INSPECTION, INSPECTED_PASSED, INSPECTED_FAILED).

---

## 2. Repository Findings and Verified Current-State Inventory

A thorough, read-only inspection of the WasteWatch repository established the following architectural facts and constraints:

1. **driver/models.py:**
   - CollectionSchedule: Defines collection routes, recurring frequencies, assigned barangay, and currently contains legacy single-driver and single-truck fields (driver, 	ruck).
   - DriverShift: Tracks driver operational route execution (driver, 	ruck, schedule, status, started_at, ended_at). Currently lacks linkage to multi-truck allocations, teams, and dumpsites.
   - Truck: Represents collection vehicles. Fields include plate_number, model, capacity_tons, status (operational status), and ManyToMany fields (drivers, crew).
   - TruckCrewAssignment: Historical table mapping drivers, trucks, crew members, and schedules. Crucially, foreign keys in dumpsite.WasteDelivery.crew_assignment reference this model, requiring that legacy assignment records remain intact for weighbridge audit integrity.
2. **watcher/models.py:**
   - WatcherShift: Tracks field observation sessions (watcher, arangay, started_at, ended_at, is_active).
   - StopValidation: Records waste collection stop inspections (schedule, stop_number, status, 
otes, photo_url, 	imestamp).
   - StopValidationStatus: Verified choices are:
     - PENDING_INSPECTION (Initial state prior to arrival)
     - READY_FOR_COLLECTION (Watcher confirmed waste set out for pickup)
     - EMPTY_STOP (No waste set out)
     - COLLECTION_REPORTED (Driver reported collection completed)
     - VERIFIED_COLLECTED (Watcher verified waste collected)
     - COLLECTION_DISPUTED (Reported collected but waste remains on site)
     *(Note: VERIFIED_MISSED does not exist in the codebase; disputed stops are represented by COLLECTION_DISPUTED)*.
3. **dumpsite/models.py:**
   - Dumpsite: Solid waste processing facilities in Lucena City (
ame, code, latitude, longitude, geofence_radius, is_active).
   - WasteDelivery: Records weighbridge arrivals and net weight metrics. It explicitly links to TruckCrewAssignment (crew_assignment = models.ForeignKey('driver.TruckCrewAssignment', on_delete=models.SET_NULL, null=True, blank=True)).
4. **ccounts/models.py & ccounts/permissions.py:**
   - User: Standard user model supporting roles: citizen, watcher, driver, rgy_official, dmin.
   - is_admin_user(user): Evaluates user.role == 'admin' or user.is_staff.
5. **wastewatch/settings.py:**
   - TIME_ZONE = 'Asia/Manila'. All service-date calculations and timestamps must be localized to Asia/Manila.
   - Redis is not configured in INSTALLED_APPS or CACHES. PostgreSQL is the primary durable transactional store.

---

## 3. Final Owner Decision Register (D-10 through D-13)

The architecture strictly adheres to four authoritative, non-negotiable owner decisions:

### Decision D-10: Hybrid Schedule/Team Assignment
- **Policy:** The operational team for any collection run is resolved using a two-tier hybrid model:
  1. Primary Default: Every CollectionSchedule specifies a permanent default_team.
  2. Operational Override: A specific operational date may specify a ScheduleTeamOverride.
- **Precedence:** The active override takes precedence over the default team for the specified date. If neither exists, the staging transaction raises a validation error.
- **Dumpsite Decoupling:** Sanitation teams are not permanently tied to a dumpsite. The operational dumpsite is determined by the CollectionSchedule or explicit ScheduleTruckAllocation.

### Decision D-11: Peer-Truck Map Visibility
- **Policy:** Drivers actively on duty can view the real-time positions of peer collection trucks operating on the same schedule or shared route corridor.
- **Technical Separation:** Peer truck telemetry is isolated to a distinct Leaflet LayerGroup and polled over HTTP or WebSocket. Peer positions are visual-only markers and are strictly isolated from the driver's personal turn-by-turn routing engine, avoiding routing loops.

### Decision D-12: Preserve and Review Unfinished Stops
- **Policy:** Stops that remain uncollected or unverified when a driver concludes their shift must never be silently marked as completed, skipped, or defaulted to missed.
- **Lifecycle Integrity:** Unfinished stops retain their recorded status (PENDING_INSPECTION or READY_FOR_COLLECTION). The shift completion transaction automatically generates an UnfinishedStopReview ticket. The ticket can be audited by an administrator or resolved through subsequent Watcher post-shift verification (RESOLVED_BY_WATCHER).

### Decision D-13: Single Active Team Membership and Shift Protection
- **Policy:** A physical worker may belong to at most one active SanitationTeam at any given time.
- **Active Shift Lock:** A worker participating in an active shift cannot be removed from their team, transferred to another team, or deactivated until all linked shifts (DriverShift, WatcherShift, CrewShift) have formally concluded.

---

## 4. Complete Entity Relationship Design

### 4.1 Master Entity Relationship Diagram

```mermaid
erDiagram
    Worker ||--o| User : "optionally links to"
    Worker ||--o{ SanitationTeamMembership : "participates as"
    Worker ||--o{ ShiftCrewRosterItem : "manifested in"
    Worker ||--o{ CrewAttendanceRecord : "attendance logged for"

    SanitationTeam ||--o{ SanitationTeamMembership : "has members"
    SanitationTeam ||--o{ CollectionSchedule : "serves as default team"
    SanitationTeam ||--o{ ScheduleTeamOverride : "assigned as override team"
    SanitationTeam ||--o{ ScheduleTruckAllocation : "allocated to"

    CollectionSchedule ||--o{ ScheduleTeamOverride : "has overrides"
    CollectionSchedule ||--o{ ScheduleTruckAllocation : "allocates trucks"
    CollectionSchedule ||--o{ StopValidation : "defines stops"
    CollectionSchedule }o--|| Dumpsite : "assigned base"

    ScheduleTruckAllocation ||--|| DriverShift : "executes"
    ScheduleTruckAllocation }o--|| Truck : "allocates"
    ScheduleTruckAllocation }o--|| Dumpsite : "staged at"

    DriverShift ||--|| WatcherShift : "coordinates"
    DriverShift ||--|| ShiftCrewRosterSnapshot : "snapshots roster"
    WatcherShift ||--|| CrewShift : "leads"
    CrewShift ||--o{ ShiftCrewRosterItem : "manifests crew"

    ShiftCrewRosterSnapshot ||--|{ ShiftCrewRosterItem : "contains items"
    ShiftCrewRosterItem ||--o| CrewAttendanceRecord : "attendance verified"
    CrewAttendanceRecord ||--o{ CrewAttendanceCorrection : "corrected by"

    DriverShift ||--o{ UnfinishedStopReview : "generates reviews"
    StopValidation ||--o{ UnfinishedStopReview : "reviewed in"

    Truck ||--o{ DriverShift : "driven in"
    Truck ||--o{ TruckInspectionRecord : "inspected"
    DriverShift ||--o| TruckInspectionRecord : "closed by"
```

### 4.2 Relational Invariants and Cardinality Rules

1. **Canonical Worker Decoupling:** Physical humans are identified by `Worker`. The optional 1:0..1 relationship between `Worker` and `accounts.User` guarantees that crew members who do not possess smartphones, internet access, or citizen accounts can participate as registered personnel. System users cannot link to multiple `Worker` profiles (`OneToOneField`).
2. **Team Membership Constraint:** A `Worker` possesses at most one active `SanitationTeamMembership` (`is_active=True`). When transferred, the previous membership is updated with `is_active=False` and `left_at=timezone.now()` before a new membership is created.
3. **Shift Trio Cardinality:** The operational run maintains a strict 1-to-1-to-1 relationship across all three shift entities:
   - Exactly one `DriverShift` binds to one `ScheduleTruckAllocation`.
   - Exactly one `WatcherShift` coordinates with one `DriverShift`.
   - Exactly one `CrewShift` coordinates with one `WatcherShift`.
   All three shift models record identical `service_date` values derived directly from the underlying allocation.
4. **Shift Roster Snapshot:** At shift staging, the team's active crew members are snapshotted into `ShiftCrewRosterSnapshot` and `ShiftCrewRosterItem` records. Once written, roster snapshot records are database-locked against update or deletion.
5. **Attendance Cardinality:** Each `ShiftCrewRosterItem` maps to at most one `CrewAttendanceRecord` (1:0..1). Attendance records are immutable and can only be altered by appending sequentially ordered `CrewAttendanceCorrection` entries.

---

## 5. Final Model and Field Specifications

All models are defined for implementation in `wastewatch/backend/driver/` and `wastewatch/backend/watcher/`:

### 5.1 Canonical `Worker`, `SanitationTeam`, and `SanitationTeamMembership`

```python
class Worker(models.Model):
    """
    Canonical identity for physical human workers, independent of system authentication.
    Supports non-login crew members without accounts, passwords, or personal mobile devices.
    """
    employee_id = models.CharField(
        max_length=50,
        unique=True,
        db_index=True,
        help_text='Unique organizational employee identifier'
    )
    full_name = models.CharField(max_length=255)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='worker_profile',
        help_text='Optional link to system User account (for Drivers and Watchers who log in)'
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
        ('leader', 'Team Leader (Watcher)'),
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

    def __str__(self):
        return f"{self.worker.full_name} -> {self.team.name} ({self.role_in_team})"
```

#### Worker Deduplication and Merge Procedures
If duplicate worker records are erroneously introduced (e.g., during emergency offline onboarding), an administrative merge procedure is executed within an atomic transaction:
1. Acquire row-level locks on both candidate worker rows:
   ```python
   workers = Worker.objects.filter(id__in=[source_id, target_id]).order_by('id').select_for_update()
   ```
2. Verify neither worker is associated with an ongoing, active shift.
3. Repoint dependent foreign-key records (`SanitationTeamMembership`, `ShiftCrewRosterItem`, `CrewAttendanceRecord`) from the source worker to the surviving canonical target worker.
4. If the source worker possessed an attached `accounts.User` and the target does not, transfer the user link to the target worker.
5. Soft-deactivate the source worker (`is_active=False`) and append an entry in the system audit log documenting the merge event.

#### Worker Employee ID Change Policy
Because foreign keys across the application reference the surrogate primary key `Worker.id`, updating a worker's `employee_id` does not break relational integrity or cascade mutations:
- The update is executed through an administrative service endpoint that verifies the uniqueness of the new `employee_id` under row lock.
- Any change to `Worker.employee_id` is automatically logged to the audit table with timestamps, previous values, and authorizing administrative credentials.

---

### 5.2 `ScheduleTeamOverride` (Decision D-10)

```python
class ScheduleTeamOverride(models.Model):
    schedule = models.ForeignKey('driver.CollectionSchedule', on_delete=models.PROTECT, related_name='team_overrides')
    service_date = models.DateField(db_index=True)
    override_team = models.ForeignKey(SanitationTeam, on_delete=models.PROTECT, related_name='schedule_overrides')
    reason = models.TextField()
    is_cancelled = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='schedule_overrides_created')
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='schedule_overrides_cancelled')

    class Meta:
        db_table = 'schedule_team_override'
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'service_date'],
                condition=models.Q(is_cancelled=False),
                name='unique_active_override_per_schedule_date'
            )
        ]

    def __str__(self):
        return f"Override: {self.schedule.name} on {self.service_date} -> {self.override_team.name}"
```

---

### 5.3 `ScheduleTruckAllocation`

```python
class ScheduleTruckAllocation(models.Model):
    """
    Authoritative daily operational manifest binding schedule, service date, truck, team, and dumpsite.
    Pre-exists shift staging to prevent dynamic, unvalidated truck substitutions.
    """
    schedule = models.ForeignKey('driver.CollectionSchedule', on_delete=models.PROTECT, related_name='truck_allocations')
    service_date = models.DateField(db_index=True)
    truck = models.ForeignKey('driver.Truck', on_delete=models.PROTECT, related_name='daily_allocations')
    allocated_team = models.ForeignKey(SanitationTeam, on_delete=models.PROTECT, related_name='truck_allocations')
    dumpsite = models.ForeignKey('dumpsite.Dumpsite', on_delete=models.PROTECT, related_name='truck_allocations')
    is_lead_truck = models.BooleanField(default=False, help_text='Designates primary vehicle for legacy single-truck client compatibility')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'schedule_truck_allocation'
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'service_date', 'truck'],
                name='unique_truck_per_schedule_date'
            ),
            models.UniqueConstraint(
                fields=['service_date', 'truck'],
                name='unique_truck_assignment_per_date'
            )
        ]

    def __str__(self):
        return f"{self.service_date} | {self.schedule.name} -> Truck {self.truck.plate_number} (Team: {self.allocated_team.name})"
```

#### Pre-Allocated Truck Selection Protocol
When multiple trucks are assigned to a single schedule for the same service date:
1. The driver application does not present an open text input or unvalidated truck dropdown.
2. The driver queries `/api/driver/allocations/available/?service_date=YYYY-MM-DD`.
3. The response lists authorized allocations matching the driver's active team membership.
4. The driver submits `allocation_id` to start staging. If a driver attempts to stage a truck without an existing `ScheduleTruckAllocation`, the API rejects the request with HTTP 403 Forbidden.

---

### 5.4 Shift Trio Models with Authoritative `service_date`

```python
class DriverShift(models.Model):
    PHASE_CHOICES = [
        ('navigate_to_base', 'Navigating to Dumpsite Base'),
        ('on_duty', 'Active Collection'),
        ('en_route_dumpsite', 'En Route to Dumpsite for Offload'),
        ('at_dumpsite', 'Weighbridge / Offload Processing'),
        ('completed', 'Shift Completed'),
        ('aborted', 'Shift Aborted'),
    ]

    driver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='driver_shifts')
    allocation = models.OneToOneField(ScheduleTruckAllocation, on_delete=models.PROTECT, related_name='driver_shift')
    service_date = models.DateField(db_index=True)
    status = models.CharField(max_length=32, choices=PHASE_CHOICES, default='navigate_to_base')
    op_status = models.CharField(max_length=20, default='on_duty')
    end_shift_phase = models.CharField(max_length=40, blank=True, default='')
    is_active = models.BooleanField(default=True, db_index=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.BigIntegerField(null=True, blank=True)

    class Meta:
        db_table = 'driver_shift'
        constraints = [
            models.UniqueConstraint(
                fields=['driver'],
                condition=models.Q(is_active=True),
                name='unique_active_driver_shift'
            )
        ]

    # Delegated properties referencing the single authoritative allocation manifest
    @property
    def schedule(self):
        return self.allocation.schedule

    @property
    def truck(self):
        return self.allocation.truck

    @property
    def assigned_team(self):
        return self.allocation.allocated_team

    @property
    def dumpsite(self):
        return self.allocation.dumpsite

    def __str__(self):
        return f"DriverShift #{self.id} | {self.driver.username} | {self.service_date} ({self.status})"


class WatcherShift(models.Model):
    watcher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='watcher_shifts')
    driver_shift = models.OneToOneField(DriverShift, on_delete=models.PROTECT, related_name='watcher_shift')
    service_date = models.DateField(db_index=True)
    confirmed_by_watcher = models.BooleanField(
        default=False,
        help_text='Explicit confirmation required upon crew attendance submission before operational dispatch'
    )
    is_active = models.BooleanField(default=True, db_index=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'watcher_shift'
        constraints = [
            models.UniqueConstraint(
                fields=['watcher'],
                condition=models.Q(is_active=True),
                name='unique_active_watcher_shift'
            )
        ]

    @property
    def schedule(self):
        return self.driver_shift.allocation.schedule

    @property
    def truck(self):
        return self.driver_shift.allocation.truck

    @property
    def assigned_team(self):
        return self.driver_shift.allocation.allocated_team

    def __str__(self):
        return f"WatcherShift #{self.id} | {self.watcher.username} | {self.service_date}"


class CrewShift(models.Model):
    watcher_shift = models.OneToOneField(WatcherShift, on_delete=models.PROTECT, related_name='crew_shift')
    service_date = models.DateField(db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'crew_shift'

    @property
    def driver_shift(self):
        return self.watcher_shift.driver_shift

    @property
    def assigned_team(self):
        return self.watcher_shift.driver_shift.allocation.allocated_team

    def __str__(self):
        return f"CrewShift #{self.id} | Team {self.assigned_team.name} | {self.service_date}"
```

---

### 5.5 Immutable Shift Crew Roster Snapshot and Manifest Items

```python
class ShiftCrewRosterSnapshot(models.Model):
    driver_shift = models.OneToOneField(DriverShift, on_delete=models.PROTECT, related_name='roster_snapshot')
    service_date = models.DateField(db_index=True)
    captured_at = models.DateTimeField(auto_now_add=True)
    captured_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='rosters_captured')

    class Meta:
        db_table = 'shift_crew_roster_snapshot'

    def __str__(self):
        return f"Roster Snapshot for Shift #{self.driver_shift_id} ({self.service_date})"


class ShiftCrewRosterItem(models.Model):
    ROLE_CHOICES = [
        ('COLLECTOR', 'Waste Collector'),
        ('LOADER', 'Bin Loader'),
        ('SWEEPER', 'Street Sweeper'),
    ]

    snapshot = models.ForeignKey(ShiftCrewRosterSnapshot, on_delete=models.PROTECT, related_name='items')
    worker = models.ForeignKey(Worker, on_delete=models.PROTECT, related_name='roster_items')
    assigned_role = models.CharField(max_length=20, choices=ROLE_CHOICES)

    class Meta:
        db_table = 'shift_crew_roster_item'
        constraints = [
            models.UniqueConstraint(
                fields=['snapshot', 'worker'],
                name='unique_worker_per_roster_snapshot'
            )
        ]

    def __str__(self):
        return f"Roster Item #{self.id}: {self.worker.full_name} ({self.assigned_role})"
```

---

### 5.6 Attendance Ledger and Append-Only Corrections

```python
class CrewAttendanceRecord(models.Model):
    roster_item = models.OneToOneField(ShiftCrewRosterItem, on_delete=models.PROTECT, related_name='attendance_record')
    crew_shift = models.ForeignKey(CrewShift, on_delete=models.PROTECT, related_name='attendance_records')
    worker = models.ForeignKey(Worker, on_delete=models.PROTECT, related_name='attendance_records')
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='attendance_submitted')
    status = models.CharField(
        max_length=20,
        choices=[
            ('PRESENT', 'Present'),
            ('ABSENT', 'Absent'),
        ]
    )
    remarks = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'crew_attendance_record'
        constraints = [
            models.UniqueConstraint(
                fields=['crew_shift', 'worker'],
                name='unique_worker_attendance_per_crew_shift'
            )
        ]

    def __str__(self):
        return f"Attendance #{self.id}: {self.worker.full_name} -> {self.status}"


class CrewAttendanceCorrection(models.Model):
    attendance_record = models.ForeignKey(CrewAttendanceRecord, on_delete=models.PROTECT, related_name='corrections')
    correction_seq = models.PositiveIntegerField(editable=False, help_text='Monotonically increasing sequence number per parent record')
    previous_status = models.CharField(max_length=20, help_text='Derived on server from latest effective projection')
    corrected_status = models.CharField(
        max_length=20,
        choices=[
            ('PRESENT', 'Present'),
            ('ABSENT', 'Absent'),
        ]
    )
    correction_reason = models.TextField()
    authorized_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='attendance_corrections_authorized')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'crew_attendance_correction'
        constraints = [
            models.UniqueConstraint(
                fields=['attendance_record', 'correction_seq'],
                name='unique_correction_seq_per_record'
            )
        ]
        ordering = ['correction_seq']

    def __str__(self):
        return f"Correction #{self.correction_seq} on Record #{self.attendance_record_id}: {self.previous_status} -> {self.corrected_status}"
```

---

### 5.7 `UnfinishedStopReview` (Decision D-12)

```python
class UnfinishedStopReview(models.Model):
    RESOLUTION_CHOICES = [
        ('PENDING_ADMIN_REVIEW', 'Pending Admin Review'),
        ('RESOLVED_BY_WATCHER', 'Resolved by Watcher Verification'),
        ('CONFIRMED_MISSED', 'Confirmed Missed Collection - Driver Responsible'),
        ('ROLLED_OVER', 'Rolled Over to Next Route Cycle'),
        ('EXCUSED_OBSTRUCTION', 'Excused - Road Blocked / Inaccessible'),
    ]

    driver_shift = models.ForeignKey(DriverShift, on_delete=models.PROTECT, related_name='unfinished_stop_reviews')
    stop_validation = models.ForeignKey('watcher.StopValidation', on_delete=models.PROTECT, related_name='review_records')
    service_date = models.DateField(db_index=True)
    unresolved_status = models.CharField(max_length=30, choices=StopValidationStatus.choices)
    resolution_status = models.CharField(max_length=30, choices=RESOLUTION_CHOICES, default='PENDING_ADMIN_REVIEW', db_index=True)
    resolution_reason = models.CharField(max_length=50, blank=True, null=True)
    admin_notes = models.TextField(blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='stop_resolutions')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'unfinished_stop_review'
        constraints = [
            models.UniqueConstraint(
                fields=['driver_shift', 'stop_validation'],
                name='unique_review_per_shift_stop'
            )
        ]

    def __str__(self):
        return f"Review #{self.id} | Stop #{self.stop_validation.stop_number} | {self.resolution_status}"
```

---

### 5.8 `TruckInspectionRecord` and Persisted Fleet Dimensions

```python
class TruckInspectionRecord(models.Model):
    OUTCOME_CHOICES = [
        ('PASSED', 'Passed - Released to Available Fleet'),
        ('DEFECT_FOUND', 'Defect Found - Grounded for Maintenance'),
    ]

    truck = models.ForeignKey('driver.Truck', on_delete=models.PROTECT, related_name='inspection_records')
    driver_shift = models.OneToOneField(DriverShift, on_delete=models.PROTECT, related_name='inspection_record')
    dumpsite = models.ForeignKey('dumpsite.Dumpsite', on_delete=models.PROTECT, related_name='truck_inspections')
    inspector = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='inspections_conducted')
    
    # Checklist booleans: NONE default to True
    bed_cleaned = models.BooleanField(null=False)
    tires_inspected = models.BooleanField(null=False)
    hydraulics_checked = models.BooleanField(null=False)
    fluids_checked = models.BooleanField(null=False)
    lights_checked = models.BooleanField(null=False)
    odometer_reading = models.PositiveIntegerField()
    
    outcome = models.CharField(max_length=20, choices=OUTCOME_CHOICES)
    defect_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'truck_inspection_record'

    def __str__(self):
        return f"Inspection for Truck {self.truck.plate_number} on Shift #{self.driver_shift_id}: {self.outcome}"
```

#### Persisted Fleet Lifecycle Dimensions on `driver.Truck`
To prevent conflating operational dispatch states with mechanical roadworthiness, the `Truck` model implements three independent persisted fields:
1. `op_status`: Tracks daily dispatch readiness: `AVAILABLE`, `ALLOCATED`, `DISPATCHED`, `OUT_OF_SERVICE`.
2. `mechanical_condition`: Tracks physical roadworthiness: `CLEARED`, `NEEDS_REPAIR`, `MAINTENANCE`, `DECOMMISSIONED`.
3. `inspection_state`: Tracks inspection cycle state: `PENDING_INSPECTION`, `INSPECTED_PASSED`, `INSPECTED_FAILED`.

---

## 6. Database Constraints and PostgreSQL Trigger Specifications

### 6.1 Native PostgreSQL PL/pgSQL Triggers

To prevent unauthorized tampering, direct SQL mutations, or accidental bulk updates through the Django ORM, PostgreSQL database-level triggers enforce write-once and append-only constraints directly at the database engine layer.

```sql
-- 1. Trigger Function: Block UPDATE and DELETE on Base Attendance Records
CREATE OR REPLACE FUNCTION prevent_attendance_record_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        RAISE EXCEPTION 'PERMISSION DENIED: CrewAttendanceRecord entries are strictly immutable. Correction ledger must be used.';
    ELSIF (TG_OP = 'DELETE') THEN
        RAISE EXCEPTION 'PERMISSION DENIED: Historical attendance records cannot be deleted.';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_immutable_crew_attendance
BEFORE UPDATE OR DELETE ON crew_attendance_record
FOR EACH ROW EXECUTE FUNCTION prevent_attendance_record_mutation();


-- 2. Trigger Function: Block UPDATE and DELETE on Attendance Corrections
CREATE OR REPLACE FUNCTION prevent_attendance_correction_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        RAISE EXCEPTION 'PERMISSION DENIED: CrewAttendanceCorrection entries are write-once audit logs and cannot be modified.';
    ELSIF (TG_OP = 'DELETE') THEN
        RAISE EXCEPTION 'PERMISSION DENIED: Attendance correction history cannot be deleted.';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_immutable_crew_attendance_correction
BEFORE UPDATE OR DELETE ON crew_attendance_correction
FOR EACH ROW EXECUTE FUNCTION prevent_attendance_correction_mutation();


-- 3. Trigger Function: Block UPDATE and DELETE on Shift Crew Roster Snapshots and Items
CREATE OR REPLACE FUNCTION prevent_roster_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'PERMISSION DENIED: Shift crew roster snapshots and manifested items are immutable historical records.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_immutable_roster_snapshot
BEFORE UPDATE OR DELETE ON shift_crew_roster_snapshot
FOR EACH ROW EXECUTE FUNCTION prevent_roster_snapshot_mutation();

CREATE TRIGGER trg_immutable_roster_item
BEFORE UPDATE OR DELETE ON shift_crew_roster_item
FOR EACH ROW EXECUTE FUNCTION prevent_roster_snapshot_mutation();


-- 4. Trigger Function: Block Hard Deletion on Sanitation Team Memberships
CREATE OR REPLACE FUNCTION prevent_membership_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'PERMISSION DENIED: Team membership history cannot be deleted. Deactivate by setting is_active=FALSE.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_membership_delete
BEFORE DELETE ON sanitation_team_membership
FOR EACH ROW EXECUTE FUNCTION prevent_membership_deletion();


-- 5. Trigger Function: Enforce Active Shift Transfer Lock (Decision D-13)
CREATE OR REPLACE FUNCTION fn_enforce_active_shift_transfer_lock()
RETURNS TRIGGER AS $$
DECLARE
    v_active_shift_count INTEGER;
BEGIN
    -- Only evaluate when an active membership is being deactivated or transferred to a new team
    IF (OLD.is_active = TRUE AND (NEW.is_active = FALSE OR NEW.team_id <> OLD.team_id)) THEN
        -- Query active shifts across DriverShift, WatcherShift, and manifested CrewShift
        SELECT COUNT(*) INTO v_active_shift_count
        FROM (
            -- Check if worker's linked user is an active driver
            SELECT ds.id 
            FROM driver_shift ds
            JOIN driver_worker w ON w.user_id = ds.driver_id
            WHERE w.id = OLD.worker_id AND ds.is_active = TRUE

            UNION ALL

            -- Check if worker's linked user is an active watcher
            SELECT ws.id 
            FROM watcher_shift ws
            JOIN driver_worker w ON w.user_id = ws.watcher_id
            WHERE w.id = OLD.worker_id AND ws.is_active = TRUE

            UNION ALL

            -- Check if worker is manifested on an active shift crew roster
            SELECT r.id 
            FROM shift_crew_roster_item r
            JOIN shift_crew_roster_snapshot s ON r.snapshot_id = s.id
            JOIN driver_shift ds ON s.driver_shift_id = ds.id
            WHERE r.worker_id = OLD.worker_id AND ds.is_active = TRUE
        ) active_shifts;

        IF v_active_shift_count > 0 THEN
            RAISE EXCEPTION 'INTEGRITY ERROR: Worker ID % is currently on an active shift. Personnel transfers or deactivations are strictly locked during active operations.', OLD.worker_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_membership_active_shift_lock
BEFORE UPDATE ON sanitation_team_membership
FOR EACH ROW EXECUTE FUNCTION fn_enforce_active_shift_transfer_lock();


-- 6. Trigger Function: Prevent Table Truncation on Immutable Tables
CREATE OR REPLACE FUNCTION prevent_table_truncation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SECURITY VIOLATION: TRUNCATE is strictly prohibited on operational audit tables.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_truncate_guard_attendance
BEFORE TRUNCATE ON crew_attendance_record
FOR EACH STATEMENT EXECUTE FUNCTION prevent_table_truncation();

CREATE TRIGGER trg_truncate_guard_correction
BEFORE TRUNCATE ON crew_attendance_correction
FOR EACH STATEMENT EXECUTE FUNCTION prevent_table_truncation();
```

### 6.2 Architectural Distinction: Database Invariants vs. Service Layer Guards

| Invariant | Database Engine Enforcement (PostgreSQL) | Application / Service Layer Guard |
| :--- | :--- | :--- |
| **Write-Once Attendance Records** | `BEFORE UPDATE OR DELETE` trigger aborts with exception | API endpoints lack `PUT`, `PATCH`, and `DELETE` handlers |
| **Monotonic Correction Sequencing** | Composite `UniqueConstraint(attendance_record, correction_seq)` | Service calculates `MAX(correction_seq) + 1` under row lock |
| **Active Shift Transfer Lock** | Trigger queries active shifts across trio before update | Service acquires locks and rejects transfer with HTTP 409 |
| **Immutable Roster Snapshot** | Trigger aborts any mutation on snapshot or item tables | Service serializer provides read-only viewsets post-staging |
| **Single Active Team Membership** | Partial unique constraint `UniqueConstraint(worker, condition=is_active)` | Admin service validates existing memberships before insert |
| **TRUNCATE Prevention** | Statement-level `BEFORE TRUNCATE` trigger | Application database user permissions revoke `TRUNCATE` |

### 6.3 Test Database Mock and Engine Execution Caveats
- **Production PostgreSQL:** PL/pgSQL triggers execute natively. Database triggers are compiled and verified inside migration `RunSQL` operations with explicit reverse SQL drops.
- **SQLite Local Testing:** SQLite does not support PL/pgSQL stored procedures. For local test runners executing against SQLite, model-level `delete()` and `save()` overrides raise `PermissionDenied` exceptions. Automated integration tests in CI execute against a real PostgreSQL container to assert trigger rejections directly.

---

## 7. Sanitation Team Membership and Transfer Workflow

### 7.1 Canonical Lock Acquisition Protocol (Decision D-13 & Priority 3)

All multi-entity mutations affecting teams, fleet, and personnel must execute under strict canonical row-level lock ordering to eliminate deadlocks and race conditions:
```text
Canonical Lock Ordering:
1. SanitationTeam records in ascending primary key order:  ORDER BY id ASC FOR UPDATE
2. Truck records in ascending primary key order:           ORDER BY id ASC FOR UPDATE
3. Worker records in ascending primary key order:          ORDER BY id ASC FOR UPDATE
4. SanitationTeamMembership records in ascending PK order: ORDER BY id ASC FOR UPDATE
```

### 7.2 Step-by-Step Personnel Transfer Algorithm

When an administrator transfers a worker from Team A to Team B:
1. **Request Intake:** Admin submits `POST /api/admin/workers/{worker_id}/transfer/` with payload `{"target_team_id": B, "role_in_team": "crew"}`.
2. **Transaction Scope & Lock Acquisition:**
   - Begin database transaction.
   - Acquire locks on Team A and Team B in ascending order:
     ```python
     teams = list(SanitationTeam.objects.filter(id__in=[team_a_id, team_b_id]).order_by('id').select_for_update())
     ```
   - Acquire lock on the canonical `Worker`:
     ```python
     worker = Worker.objects.filter(id=worker_id).select_for_update().get()
     ```
   - Acquire lock on the worker's active membership in Team A:
     ```python
     membership = SanitationTeamMembership.objects.filter(worker=worker, is_active=True).select_for_update().get()
     ```
3. **Active Shift Participation Check:**
   - Execute query asserting that the worker is not participating in any active operational shift:
     ```python
     is_on_duty = (
         DriverShift.objects.filter(driver__worker_profile=worker, is_active=True).exists() or
         WatcherShift.objects.filter(watcher__worker_profile=worker, is_active=True).exists() or
         ShiftCrewRosterItem.objects.filter(worker=worker, snapshot__driver_shift__is_active=True).exists()
     )
     if is_on_duty:
         raise ActiveShiftConflictError(f"Worker {worker.full_name} is currently on an active shift. Transfer locked.")
     ```
4. **Membership Transition:**
   - Deactivate current membership:
     ```python
     membership.is_active = False
     membership.left_at = timezone.now()
     membership.save(update_fields=['is_active', 'left_at'])
     ```
   - Create new membership in Team B:
     ```python
     SanitationTeamMembership.objects.create(
         team_id=team_b_id,
         worker=worker,
         role_in_team=new_role,
         is_active=True,
         created_by=request.user
     )
     ```
5. **Commit:** Commit transaction. All row locks released.

### 7.3 Concurrency Handling: Staging vs. Transfer Under READ COMMITTED

Under PostgreSQL `READ COMMITTED` isolation, if Shift Staging for Team A and Membership Transfer for Worker W occur simultaneously:
- **Scenario 1 (Staging acquires locks first):**
  1. Staging acquires `SanitationTeam(A)` lock, then `Worker(W)` lock.
  2. Staging creates `DriverShift` and snapshots Worker W into `ShiftCrewRosterItem`.
  3. Transfer transaction attempts to acquire `SanitationTeam(A)` and blocks.
  4. Staging commits.
  5. Transfer unblocks, reads committed state, evaluates `ShiftCrewRosterItem`, detects active shift, and aborts with HTTP 409 Conflict.
- **Scenario 2 (Transfer acquires locks first):**
  1. Transfer acquires `SanitationTeam(A)` lock, then `Worker(W)` lock.
  2. Evaluates active shifts (none active).
  3. Deactivates membership in Team A and assigns to Team B.
  4. Staging transaction attempts to acquire `SanitationTeam(A)` and blocks.
  5. Transfer commits.
  6. Staging unblocks, reads committed state, and finds Worker W is no longer an active member of Team A. Worker W is excluded from Team A's roster snapshot.

---

## 8. Hybrid Team Resolution Service (Decision D-10)

### 8.1 Resolution Logic and Algorithm

The operational team assigned to service a `CollectionSchedule` on a given `service_date` is determined through a deterministic two-tier resolution service:

```python
def resolve_schedule_team(schedule_id: int, service_date: datetime.date) -> SanitationTeam:
    """
    Authoritative resolution of operational team for a schedule and service date.
    Adheres to Decision D-10: ScheduleTeamOverride takes precedence over CollectionSchedule.default_team.
    """
    with transaction.atomic():
        # 1. Acquire row lock on CollectionSchedule to prevent concurrent default_team reassignments
        schedule = (
            CollectionSchedule.objects
            .select_for_update()
            .select_related('default_team')
            .get(id=schedule_id)
        )

        # 2. Check for an active date-specific override
        override = (
            ScheduleTeamOverride.objects
            .filter(schedule=schedule, service_date=service_date, is_cancelled=False)
            .select_related('override_team')
            .first()
        )

        if override:
            if not override.override_team.is_active:
                raise ScheduleConfigurationError(
                    f"Active override team {override.override_team.name} is deactivated."
                )
            return override.override_team

        # 3. Fall back to CollectionSchedule.default_team
        if schedule.default_team:
            if not schedule.default_team.is_active:
                raise ScheduleConfigurationError(
                    f"Default team {schedule.default_team.name} for schedule {schedule.name} is deactivated."
                )
            return schedule.default_team

        # 4. If neither is configured, raise hard operational failure
        raise ScheduleConfigurationError(
            f"CollectionSchedule '{schedule.name}' (ID: {schedule.id}) has no default team or active override for {service_date}."
        )
```

### 8.2 Integration with Daily `ScheduleTruckAllocation`

1. **Pre-Staging Generation:** The administrative scheduling service generates `ScheduleTruckAllocation` records 24 to 48 hours prior to the operational service date.
2. **Team Binding:** The generation task calls `resolve_schedule_team(schedule.id, service_date)` and populates `ScheduleTruckAllocation.allocated_team`.
3. **Multi-Truck Allocations:** When a large barangay route requires multiple collection vehicles (e.g., Schedule S servicing Gulang-Gulang requires 3 trucks):
   - Three distinct `ScheduleTruckAllocation` rows are generated for that `service_date`.
   - Each row links to `(schedule=S, service_date=D, truck=T1, allocated_team=Team_A, dumpsite=Base_1, is_lead_truck=True)`.
   - Additional rows link `truck=T2` and `truck=T3` with `is_lead_truck=False`.
4. **Immutability During Execution:** Once a `DriverShift` is staged against an allocation, `ScheduleTruckAllocation` cannot be modified or re-pointed to another team or truck.

---

## 9. Truck Allocation and Fleet Availability Lifecycle

### 9.1 Separate Dimensions of Fleet Lifecycle (Finding H-N7)

The fleet lifecycle cleanly decouples operational dispatch readiness, mechanical roadworthiness, and post-shift inspection into three independently managed persisted attributes on `driver.Truck`:
- **Operational Availability (`op_status`):** `AVAILABLE`, `ALLOCATED`, `DISPATCHED`, `OUT_OF_SERVICE`.
- **Mechanical Condition (`mechanical_condition`):** `CLEARED`, `NEEDS_REPAIR`, `MAINTENANCE`, `DECOMMISSIONED`.
- **Inspection State (`inspection_state`):** `PENDING_INSPECTION`, `INSPECTED_PASSED`, `INSPECTED_FAILED`.

```mermaid
stateDiagram-v2
    [*] --> Available: Truck Created or Shift Inspection Cleared
    Available --> Allocated: ScheduleTruckAllocation Staged
    Allocated --> Dispatched: DriverShift Activated upon Watcher Confirmation
    Dispatched --> PendingInspection: Shift Concluded at Dumpsite Base
    PendingInspection --> Cleared: Inspection Outcome PASSED
    Cleared --> Available: Operator Releases to Active Fleet Pool
    PendingInspection --> NeedsRepair: Inspection Outcome DEFECT_FOUND
    NeedsRepair --> Maintenance: Grounded by Operator/Admin
    Maintenance --> Cleared: Repairs Completed and Certified
    Maintenance --> Decommissioned: Irreparable Fleet Retirement
    Decommissioned --> [*]
```

### 9.2 Staging and Allocation Validation Rules

Before a truck can be assigned to a daily allocation or staged for an operational shift:
1. **Readiness Invariant:** The truck must possess `op_status == 'AVAILABLE'` and `mechanical_condition == 'CLEARED'`.
2. **Allocation Binding:** When staging occurs, `Truck.op_status` transitions to `ALLOCATED`.
3. **Dispatch Transition:** When the Watcher confirms the shift and crew attendance, `Truck.op_status` transitions to `DISPATCHED`.
4. **Post-Shift Lockout:** Concluding a shift sets `Truck.op_status = 'OUT_OF_SERVICE'` and `Truck.inspection_state = 'PENDING_INSPECTION'`. The vehicle cannot be restaged until a certified Dumpsite Operator submits a passing inspection report.

---

## 10. Coordinated Shift Lifecycle and Atomic Transactions

### 10.1 Coordinated Shift Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor D as Driver
    actor W as Watcher (Leader)
    participant API as WasteWatch API
    participant DB as PostgreSQL Database
    actor O as Dumpsite Operator

    Note over D,API: Phase 1: Truck Staging & Pre-Activation
    D->>API: POST /api/driver/shifts/stage/ (allocation_id)
    API->>DB: Lock Team, Truck, Worker (ascending ID) FOR UPDATE
    API->>DB: Validate Allocation & Absence of Active Shift
    API->>DB: Create DriverShift (status='navigate_to_base', is_active=True)
    API->>DB: Snapshot ShiftCrewRosterSnapshot & Items
    API->>DB: Update Truck op_status='allocated'
    API-->>D: Return staged shift details

    Note over W,API: Phase 2: Watcher Attendance & Operational Dispatch
    W->>API: POST /api/watcher/shifts/confirm-attendance/ (roster_items, statuses)
    API->>DB: Lock Attendance Records FOR UPDATE
    API->>DB: Create WatcherShift & CrewShift (1:1:1 trio link)
    API->>DB: Insert Immutable CrewAttendanceRecord per Worker
    API->>DB: Set WatcherShift.confirmed_by_watcher=True
    API->>DB: Transition DriverShift status='on_duty', Truck op_status='dispatched'
    API-->>W: Shift Active & Confirmed
    API-->>D: Driver Dashboard updates to 'on_duty'

    Note over D,W: Phase 3: Route Execution & Stop Collection
    D->>API: Execute route & GPS breadcrumbs
    W->>API: Verify stops (StopValidation)

    Note over D,O: Phase 4: Facility Arrival & Shift Conclusion
    D->>API: POST /api/driver/shifts/arrive-dumpsite/ (geofence verified)
    D->>API: POST /api/driver/shifts/end/ (odometer, end_phase)
    API->>DB: Query Unfinished Stops -> Generate UnfinishedStopReview records
    API->>DB: Transition Truck op_status='out_of_service', inspection_state='pending_inspection'
    API->>DB: Close DriverShift, WatcherShift, CrewShift atomically (is_active=False)

    Note over O,API: Phase 5: Post-Shift Inspection
    O->>API: POST /api/dumpsite/trucks/{id}/inspect/ (checklist, outcome)
    API->>DB: Validate Operator Facility Scope
    API->>DB: Create TruckInspectionRecord
    alt Outcome == PASSED
        API->>DB: Update Truck op_status='available', mechanical_condition='cleared', inspection_state='inspected_passed'
    else Outcome == DEFECT_FOUND
        API->>DB: Update Truck op_status='out_of_service', mechanical_condition='maintenance', inspection_state='inspected_failed'
    end
    API-->>O: Inspection recorded & Truck status updated
```

### 10.2 Unified Shift Trio Closure Protocol

The operational shift binds `DriverShift`, `WatcherShift`, and `CrewShift` in lockstep:
1. **Single Transaction Boundary:** When the driver concludes the shift via `/api/driver/shifts/end/`:
   - All three shifts are locked via `select_for_update()`.
   - `ended_at` is stamped with identical timestamps (`timezone.now()`).
   - `is_active` is toggled to `False` across all three records.
2. **Missing Linked Shift Handling:** If an operational error left a linked shift uncreated or disconnected, the closure service performs a defensive reconciliation:
   - Locates any unclosed `WatcherShift` or `CrewShift` matching the `service_date` and `ScheduleTruckAllocation`.
   - Closes them within the same transaction.
   - If an unlinked orphan is detected, logs a structured critical alert in the administrative audit log.
3. **Emergency Shift Termination:** If an emergency (vehicle breakdown, extreme weather, medical incident) requires aborting a shift:
   - The Driver or Admin calls `/api/driver/shifts/abort/`.
   - All three shifts transition to `status='aborted'` and `is_active=False` in unison.
   - Any unfinished stops generate `UnfinishedStopReview` tickets tagged with `resolution_reason='EMERGENCY_ABORT'`.

---

## 11. Dumpsite Staging and Geofence Workflow

### 11.1 Geofence Boundaries and GPS Validation
- **Operational Dumpsites:** Lucena City Landfill / Mayao Crossing Facility.
- **Geofence Radius:** 150-meter circular geofence centered on facility weighbridge coordinates.
- **GPS Accuracy Invariant:** Client location telemetry must report accuracy `<= 50` meters. Telemetry exceeding 50m accuracy is rejected with HTTP 422 Unprocessable Entity, preventing coordinate spoofing or multipath signal errors.

### 11.2 Weighbridge Verification and WasteDelivery Association
1. Upon entering the dumpsite geofence, the driver submits `/api/driver/shifts/arrive-dumpsite/`.
2. The dumpsite weighbridge operator records gross weight and tare weight.
3. A `WasteDelivery` record is created, capturing net tonnage. The system links `WasteDelivery.driver_shift` to the active `DriverShift` and preserves historical `crew_assignment` foreign keys for weighbridge audit integrity.

---

## 12. Attendance Submission and Append-Only Correction Architecture

### 12.1 Watcher-Led Attendance Submission and Shift Confirmation

1. **Exclusive Submission Authority:** Only the assigned Watcher team leader is authorized to record initial crew attendance. Drivers and crew members cannot submit attendance.
2. **Complete Roster Manifest Requirement:** When submitting attendance via `POST /api/watcher/shifts/confirm-attendance/`, the Watcher must provide attendance statuses (`PRESENT` or `ABSENT`) for 100% of the manifested workers in `ShiftCrewRosterSnapshot`. Submissions with missing workers are rejected with HTTP 422 Unprocessable Entity.
3. **Operational Dispatch Trigger:** Successful attendance submission automatically sets `WatcherShift.confirmed_by_watcher = True`, activates `CrewShift`, and transitions `DriverShift` to `status='on_duty'`.

### 12.2 Append-Only Correction Flow and Sequence Diagram

Once recorded, `CrewAttendanceRecord` entries cannot be modified or deleted. Any status correction must be appended as a sequentially numbered `CrewAttendanceCorrection` entry.

```mermaid
sequenceDiagram
    autonumber
    actor W as Submitting Watcher / Admin
    participant API as Attendance API
    participant DB as PostgreSQL Database

    W->>API: POST /api/watcher/shifts/attendance/{id}/correct/
    Note over API,DB: Canonical Parent-Row Locking
    API->>DB: BEGIN TRANSACTION
    API->>DB: SELECT * FROM crew_attendance_record WHERE id = {id} FOR UPDATE
    API->>DB: Verify Actor == original recorded_by OR User.role == 'admin'
    API->>DB: SELECT MAX(correction_seq) FROM crew_attendance_correction WHERE attendance_record_id = {id}
    API->>DB: Calculate new_seq = COALESCE(max_seq, 0) + 1
    API->>DB: Derive previous_status from latest projection
    API->>DB: INSERT INTO crew_attendance_correction (attendance_record_id, correction_seq, previous_status, corrected_status, reason, authorized_by)
    API->>DB: COMMIT TRANSACTION
    API-->>W: Return corrected projection & audit trail
```

### 12.3 Lateral SQL Projection Query for Effective Attendance Status

To retrieve the current effective attendance status without mutating base records, the application executes a lateral join query:

```sql
SELECT 
    ar.id AS attendance_record_id,
    ar.crew_shift_id,
    w.id AS worker_id,
    w.full_name AS worker_name,
    w.employee_id,
    COALESCE(latest_corr.corrected_status, ar.status) AS effective_status,
    ar.status AS initial_status,
    latest_corr.correction_seq AS latest_correction_seq,
    latest_corr.correction_reason AS latest_correction_reason,
    latest_corr.authorized_by_id AS latest_corrected_by
FROM crew_attendance_record ar
JOIN driver_worker w ON ar.worker_id = w.id
LEFT JOIN LATERAL (
    SELECT 
        c.corrected_status,
        c.correction_seq,
        c.correction_reason,
        c.authorized_by_id
    FROM crew_attendance_correction c
    WHERE c.attendance_record_id = ar.id
    ORDER BY c.correction_seq DESC
    LIMIT 1
) latest_corr ON TRUE
WHERE ar.crew_shift_id = :shift_id;
```

---

## 13. Watcher Permissions and Multi-Barangay Scope

### 13.1 Team-Based Cross-Barangay Authorization
In legacy WasteWatch workflows, Watchers were restricted to their assigned home barangay (`WatcherProfile.barangay`). Under the Sanitation Team architecture:
- Watcher operational jurisdiction is determined by the **team assignment**, not their residential barangay.
- When Team A is assigned to a collection schedule traversing multiple barangays (e.g., Ilayang Dupay and Ibabang Dupay), the Watcher team leader is authorized to validate stops across the entirety of the route.
- The authorization check in `watcher/permissions.py` verifies:
  ```python
  def has_stop_validation_permission(user, stop_validation):
      if is_admin_user(user):
          return True
      # Check if watcher is the active leader of the team executing the stop's schedule
      return WatcherShift.objects.filter(
          watcher=user,
          driver_shift__allocation__schedule=stop_validation.schedule,
          is_active=True
      ).exists()
  ```

---

## 14. Unfinished-Stop Review Workflow (Decision D-12 and Finding H-N6)

### 14.1 Unfinished-Stop Review State Machine

```mermaid
stateDiagram-v2
    [*] --> PendingAdminReview: Shift Ended with Stop Unfinished
    PendingAdminReview --> ResolvedByWatcher: Watcher Validates Stop Post-Shift
    PendingAdminReview --> ConfirmedMissed: Admin Determines Driver Omission
    PendingAdminReview --> RolledOver: Admin Reschedules for Next Route Cycle
    PendingAdminReview --> ExcusedObstruction: Admin Confirms Road Blockage / Inaccessible
    ResolvedByWatcher --> [*]: Review Resolved
    ConfirmedMissed --> [*]: Review Resolved
    RolledOver --> [*]: Review Resolved
    ExcusedObstruction --> [*]: Review Resolved
```

### 14.2 Concurrency & Verification Reconciled

When a driver concludes their shift while stops remain in `PENDING_INSPECTION` or `READY_FOR_COLLECTION`:
1. **Preservation of Stop Status:** The stops retain their status. They are **not** overwritten to missed or completed.
2. **Review Ticket Creation:** The shift conclusion service creates an `UnfinishedStopReview` record for each unfinished stop, defaulting to `resolution_status = 'PENDING_ADMIN_REVIEW'`.
3. **Subsequent Watcher Post-Shift Verification:**
   - If the Watcher verifies the stop after shift conclusion, the verification service acquires row locks:
     ```python
     stop = StopValidation.objects.select_for_update().get(id=stop_id)
     review = UnfinishedStopReview.objects.filter(stop_validation=stop, resolution_status='PENDING_ADMIN_REVIEW').select_for_update().first()
     ```
   - `StopValidation` transitions to `VERIFIED_COLLECTED`.
   - The review ticket automatically updates to `resolution_status = 'RESOLVED_BY_WATCHER'`, with `resolved_at = timezone.now()` and `resolved_by = request.user`.
4. **Concurrent Admin Review and Watcher Verification:**
   - Row-level locking on `UnfinishedStopReview` ensures that if an Admin audits the ticket at the exact moment a Watcher submits verification, one transaction serializes before the other.
   - If Admin resolves the ticket first, Watcher verification succeeds on `StopValidation` while noting the ticket is already audited.
   - If Watcher verifies first, the Admin dashboard reflects `RESOLVED_BY_WATCHER`.

---

## 15. Post-Shift Truck Inspection and Fleet Availability

### 15.1 Physical Safety Checklist Invariants
The post-shift inspection enforces physical roadworthiness standards. All 5 boolean checklist items (`bed_cleaned`, `tires_inspected`, `hydraulics_checked`, `fluids_checked`, `lights_checked`) have `null=False` with **zero** default values. The inspector must explicitly affirm each condition.

### 15.2 Facility-Scoped Inspector Permissions
Inspections can only be performed by a certified `dumpsite_operator` assigned to the dumpsite where the truck completed its shift, or by a system `admin`:
```python
def can_inspect_truck(user, dumpsite):
    if is_admin_user(user):
        return True
    return (
        user.role == 'dumpsite_operator' and 
        user.dumpsite_profile.assigned_dumpsite == dumpsite
    )
```

---

## 16. Peer-Truck Visibility and Map Integration (Decision D-11)

### 16.1 UI Layer Isolation
Peer-truck coordinates are rendered within a dedicated Leaflet `LayerGroup` in `ShiftRouteModule.jsx`.
- **Routing Engine Insulation:** Peer coordinates are strictly visual markers. They are decoupled from the driver's turn-by-turn navigation engine, preventing OpenRouteService (ORS) from re-calculating routes based on peer movements.
- **Polling Cadence:** Drivers poll `/api/driver/peer-trucks/` every 10 seconds (POL-2). Markers with telemetry older than 45 seconds are rendered semi-transparent; markers older than 120 seconds are evicted from the map layer.

---

## 17. API Endpoint Inventory and Authorization Matrix

| Endpoint | Method | Permitted Roles | Description | Request Payload | Response Code |
| :--- | :---: | :--- | :--- | :--- | :---: |
| `/api/driver/shifts/stage/` | POST | Driver | Stage truck and snapshot team crew | `{"allocation_id": int}` | 201 Created |
| `/api/watcher/shifts/confirm-attendance/` | POST | Watcher | Submit attendance & confirm shift trio | `{"roster": [{"item_id": int, "status": str}]}` | 200 OK |
| `/api/watcher/shifts/attendance/{id}/correct/` | POST | Watcher, Admin | Append correction to attendance record | `{"corrected_status": str, "reason": str}` | 201 Created |
| `/api/driver/shifts/arrive-dumpsite/` | POST | Driver | Verify facility arrival via geofence | `{"latitude": float, "longitude": float, "accuracy": float}` | 200 OK |
| `/api/driver/shifts/end/` | POST | Driver | Conclude shift trio & flag unfinished stops | `{"odometer_reading": int, "end_phase": str}` | 200 OK |
| `/api/dumpsite/trucks/{id}/inspect/` | POST | Dumpsite Operator, Admin | Submit post-shift inspection report | Checklist booleans, odometer, outcome | 201 Created |
| `/api/driver/peer-trucks/` | GET | Driver | Retrieve live telemetry of peer vehicles | None (session authenticated) | 200 OK |
| `/api/admin/workers/` | GET, POST | Admin | Manage canonical Worker profiles | `{"employee_id": str, "full_name": str}` | 200/201 |
| `/api/admin/workers/{id}/transfer/` | POST | Admin | Atomically transfer worker between teams | `{"target_team_id": int, "role": str}` | 200 OK |
| `/api/admin/unfinished-stops/` | GET, POST | Admin | Audit and resolve unfinished stop reviews | `{"resolution_status": str, "notes": str}` | 200 OK |

---

## 18. Frontend Integration and Migration Requirements

### 18.1 Component Integration Plan
1. **`ShiftRouteModule.jsx`:**
   - Integrate peer truck telemetry into a separate Leaflet `LayerGroup`.
   - Prevent peer coordinate updates from triggering OpenRouteService (ORS) route recalculations.
2. **`DriverDashboard.jsx`:**
   - Replace legacy schedule dropdown with the daily `ScheduleTruckAllocation` manifest.
   - Enforce pre-allocated truck selection; prevent manual input of arbitrary truck IDs.
3. **`WatcherDashboard.jsx`:**
   - Render the complete team crew roster manifest for pre-dispatch attendance check-in.
   - Restrict operational shift confirmation until attendance is recorded for 100% of manifested workers.
4. **Offline Mobile PWA Support (IndexedDB):**
   - Store offline attendance submissions with unique client transaction UUIDs.
   - Reconcile with server upon reconnection; reject diverging payloads with HTTP 409 Conflict.

---

## 19. Redis and IndexedDB Responsibilities

1. **PostgreSQL as Primary Source of Truth:** All operational data, audit records, and shift states reside durably in PostgreSQL.
2. **Redis Evaluation:** Redis is not configured in `settings.py` (`INSTALLED_APPS` or `CACHES`). It is documented as a future performance enhancement for high-frequency GPS coordinate caching, but is not a dependency for Phase 1-5 implementation.
3. **IndexedDB:** Dedicated to local offline storage on mobile PWA field devices (Watcher stop verifications and crew attendance drafts).

---

## 20. Data Integrity, Idempotency, and Concurrency Safeguards

### 20.1 Scope-Enforced Persisted Idempotency
To prevent duplicate shift stagings or attendance submissions caused by network retries:
- Requests must supply an `X-Idempotency-Key` header.
- The system persists idempotency records in `DriverShiftIdempotencyRecord` with a composite unique constraint on `(user, endpoint, service_date, idempotency_key)`.
- The request body is hashed using SHA-256. Replays with identical keys but mismatched hashes are rejected with HTTP 409 Conflict.

### 20.2 Concurrency Safeguards under PostgreSQL READ COMMITTED
1. **Canonical Lock Sequence:** All multi-row updates acquire locks in strict ascending order:
   `SanitationTeam` (asc ID) -> `Truck` (asc ID) -> `Worker` (asc ID) -> `SanitationTeamMembership` (asc ID).
2. **Elimination of Lost Updates:** Every shift transition and attendance correction acquires an exclusive row lock (`select_for_update()`), ensuring concurrent transactions serialize deterministically.

---

## 21. Legacy Compatibility and Retirement Plan

### 21.1 Date-Aware Compatibility Adapters
To support legacy mobile clients and endpoints querying `CollectionSchedule.driver` or `CollectionSchedule.truck`:
- Dynamic database properties intercept requests and query `ScheduleTruckAllocation` for `service_date = timezone.localdate()`.
- If multiple trucks are allocated, the adapter returns the record marked `is_lead_truck=True` and appends the HTTP response header `X-Multi-Truck-Route: true`.

### 21.2 Deprecation Schedule
- **Elimination of Dual-Write Signals:** No `post_save` signals update legacy scalar schedule fields.
- **Retirement Milestone:** Legacy scalar fields on `CollectionSchedule` are formally deprecated after 60 days of stable Phase 3 operations.

---

## 22. Migration and Deployment Plan

### 22.1 Ordered, Idempotent Migration Algorithm (Priority 7)

The migration from legacy single-driver assignments to the Sanitation Team architecture executes in six strictly ordered, idempotent stages:

```text
MIGRATION EXECUTION SEQUENCE:
Stage 1: Create Worker table -> Backfill Worker profiles from User and legacy records
Stage 2: Create SanitationTeam and SanitationTeamMembership tables -> Seed baseline teams
Stage 3: Create ScheduleTruckAllocation table -> Backfill allocations from historical DriverShift
Stage 4: Create CrewShift, ShiftCrewRosterSnapshot, and ShiftCrewRosterItem tables
Stage 5: Deploy PostgreSQL PL/pgSQL database triggers via RunSQL migrations
Stage 6: Activate NOT NULL constraints and enable ENABLE_SANITATION_TEAMS feature flag
```

#### Detailed Backfill Steps:
1. **Worker Table Backfill:**
   - Query all `accounts.User` records with `role IN ('driver', 'watcher')`. Create a corresponding `Worker` row for each, setting `employee_id = f"EMP-{user.id:04d}"`, `full_name = user.get_full_name() or user.username`, and `user = user`.
   - Query distinct crew member names from historical `TruckCrewAssignment` rows. Create non-login `Worker` records (`user = None`) with generated employee IDs (`EMP-CREW-XXXX`).
2. **Sanitation Team Seeding:**
   - Create initial sanitation teams corresponding to active collection sectors.
   - Create active `SanitationTeamMembership` records linking the backfilled workers to their respective teams.
3. **Allocation Backfill & Asia/Manila Date Conversion:**
   - Query historical `DriverShift` records. Convert `started_at` to the local date:
     ```python
     service_date = timezone.localtime(shift.started_at, pytz.timezone('Asia/Manila')).date()
     ```
   - For each historical shift, create a `ScheduleTruckAllocation` row linking `(schedule=shift.schedule, service_date=service_date, truck=shift.truck, allocated_team=default_team, dumpsite=default_dumpsite, is_lead_truck=True)`.
   - Re-point `DriverShift.allocation` to the newly created allocation.
4. **Shared Truck Handling (e.g., Truck 45):**
   - When a single truck was historically utilized across multiple schedules on the same calendar date, the backfill creates separate `ScheduleTruckAllocation` records with non-conflicting time windows or flags them for administrative review. No arbitrary guessing or record truncation occurs.
5. **Legacy Table Preservation:**
   - Historical tables `Truck.crew`, `Truck.drivers`, `TruckCrewAssignment`, and `WasteDelivery.crew_assignment` are preserved intact to maintain weighbridge historical records.
6. **Safe Administrative Triage:**
   - Any historical records with missing or ambiguous schedule links are logged to `migration_triage_log` for manual administrative resolution before applying database `NOT NULL` constraints.
7. **Feature Flag & Rollback Protocol:**
   - The system introduces setting `ENABLE_SANITATION_TEAMS = False`.
   - Rollback Procedure: In the event of an operational anomaly, toggling `ENABLE_SANITATION_TEAMS = False` reverts API endpoints to legacy single-driver behavior without dropping tables or discarding new audit data. Destructive commands (`migrate zero`) are strictly forbidden.

---

## 23. Testing Strategy and Acceptance Criteria

1. **Unit Tests:**
   - Hybrid team resolution precedence (override vs default team).
   - Canonical `Worker` model and deduplication/merge service.
   - Non-login crew roster snapshot generation.
   - Lateral projection query for effective attendance status.
2. **Concurrency & Locking Tests:**
   - Multi-threaded test executing concurrent shift staging and personnel transfer under PostgreSQL isolation. Assert transfer is rejected with HTTP 409 when worker is on active duty.
3. **Database Trigger Verification Tests:**
   - Direct SQL tests asserting that `UPDATE` or `DELETE` on `crew_attendance_record` raises a database exception.
   - Assert `TRUNCATE` is rejected on audit tables.

---

## 24. Security and Operational Risk Register

| Risk Event | Likelihood | Impact | Architectural Mitigation |
| :--- | :---: | :---: | :--- |
| **GPS Spoofing at Shift Conclusion** | Low | High | Enforce `<=50m` accuracy, 150m geofence buffer, and physical operator sign-off. |
| **Stale Peer-Truck Telemetry** | Medium | Low | Client evicts markers older than 120s; decoupled Leaflet layer prevents routing engine pollution. |
| **Attendance Record Tampering** | Very Low | Critical | Native PostgreSQL PL/pgSQL triggers reject `UPDATE` and `DELETE` at engine level. |
| **Deadlocks during Dispatch** | Low | High | Enforce single canonical lock ordering: `SanitationTeam` -> `Truck` -> `Worker`. |
| **Unauthorized Personnel Transfer** | Low | High | REST API restricts transfers to verified Administrators; database trigger rejects transfers during active shifts. |

---

## 25. Pending Owner Policy Decisions (POL-1 through POL-8)

The following operational policies require explicit owner review and approval:
- **POL-1: Admin Unfinished-Stop Review SLA:** Recommended default of 24 hours for administrative audit.
- **POL-2: Peer-Truck GPS Polling Interval:** Recommended default of 10 seconds (45s stale marker fade, 120s map eviction).
- **POL-3: Cross-Facility Truck Loan Duration:** Recommended default of 1 calendar day requiring daily reauthorization.
- **POL-4: Minimum Crew Headcount:** Recommended default of 2 crew members per operational shift.
- **POL-5: Unfinished-Stop Policy for `COLLECTION_REPORTED`:** Pending owner determination whether stops reported by drivers but not verified by Watchers at shift conclusion spawn an `UnfinishedStopReview` or remain pending field inspection.
- **POL-6: Peer-Truck Dashboard Visibility Scope:** Whether Watchers or Barangay Officials are granted peer-truck map visibility.
- **POL-7: Crew Attendance Status Choices:** Whether `LATE` or `EXCUSED` are added as discrete statuses or recorded as `PRESENT`/`ABSENT` with explanatory remarks.
- **POL-8: Emergency GPS-Failure Shift Closure Policy:** Policy governing shift conclusion when mobile device hardware or GPS connectivity fails completely (recommended: manual sign-off by Dumpsite Operator or Administrator, never an unverified automated bypass).

---

## 26. Phased Implementation Roadmap

| Phase | Milestone Objective | Core Technical Deliverables | Dependencies |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Schema, Models & Triggers | `Worker`, `SanitationTeam`, `ScheduleTeamOverride`, PostgreSQL Triggers | None |
| **Phase 2** | Shift Trio & Allocation Engine | `ScheduleTruckAllocation`, `DriverShift`, `WatcherShift`, `CrewShift`, Locking Service | Phase 1 |
| **Phase 3** | Attendance Ledger & Review Workflow | Watcher Attendance API, Append-Only Corrections, `UnfinishedStopReview` | Phase 2 |
| **Phase 4** | Fleet Inspection & Dumpsite Staging | `TruckInspectionRecord`, Facility-Scoped Permissions, Geofencing | Phase 2 |
| **Phase 5** | Frontend Integration & Peer Map | Leaflet Map Layer, Driver Allocation Dashboard, Watcher Check-in UI | Phases 2-4 |
| **Phase 6** | Legacy Retirement & Final Audit | Deprecation of scalar schedule fields, Audit Trail Hardening | Phase 5 |

---

## 27. Final Unresolved-Risk Register

1. **PostgreSQL vs. SQLite Engine Differences:** Native PL/pgSQL triggers require PostgreSQL. Local developers running SQLite test suites rely on Django model-level guards, while CI pipelines execute integration suites against PostgreSQL containers.
2. **Deep Dumpsite Cellular Blindspots:** Field operations in low-connectivity landfill zones rely on IndexedDB local queueing with payload hash collision detection upon reconnection.

---

## Final Architecture Review Verdict

**READY FOR ANOTHER INDEPENDENT REVIEW**

The WasteWatch Sanitation Team Architecture Blueprint has been comprehensively recovered, verified, and hardened. All Critical and High findings from Claude's Independent Review #3, including the first-class `Worker` canonical identity, deterministic transaction locking protocols, shift trio consistency, native PostgreSQL PL/pgSQL triggers, attendance append-only ledgers, unfinished-stop review workflows, and phased legacy data migration plans, have been fully addressed and demonstrated. The specification is complete, internally consistent, and prepared for independent re-evaluation.
