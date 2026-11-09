# WasteWatch Milestone 0A — Baseline Investigation & Evidence Report
**Project Name:** WasteWatch: A Progressive Web-Based Solid Waste Management System with Hotspot Mapping, Truck Tracking, and Route Optimization for Lucena City  
**Investigation Phase:** Milestone 0A — Baseline Investigation & Evidence Collection (Read-Only Diagnostic)  
**Date of Inspection:** November 7, 2026  
**Auditor / Analyst:** Senior Full-Stack Software Architect and Technical Implementation Analyst  
**Investigation Mode:** Strict Read-Only (Zero Code, Zero Migrations, Zero DB Changes, Working Tree Intact)  

---

## A. Executive Summary

### 1. Overall Baseline Status
The WasteWatch codebase and local runtime environment are fundamentally sound, coherent, and ready for methodical workforce architecture design, subject to specific known historical gaps.
* **Django Health:** `python manage.py check` executes cleanly with **0 issues**.
* **Migration Integrity:** All **77 migrations** across all 11 Django apps are completely applied (`[X]`), and `makemigrations --check --dry-run` reports **No changes detected**.
* **Test Suite Health:** The existing automated test suite for driver operations (`driver.tests`) contains **27 tests**, all of which execute in an isolated test database and **pass completely (27 passed, 0 failures, 0 errors, exit code 0)**.
* **Resolution of Prior Reported Failures:** The failures reported during preliminary inspection were operational/pathing errors rather than system bugs:
  1. `showmigrations` exited with code 1 because the command was previously run from the repository root instead of the backend folder containing `manage.py`.
  2. The shift test failure occurred because the command targeted a nonexistent module name `test_shift` instead of the actual file `test_shift_schedule_resolution`.

### 2. Environment Health
The local development environment uses **Python 3.13.1**, **Django 4.2.30**, **DRF 3.17.1**, **SQLite 3.45.3** (as the active local database engine), **Node.js v22.14.0**, and **npm 11.6.0**.

### 3. Critical Blockers (P0)
* **P0-1: Schedule Orphan Dumpsites:** In the active database, CollectionSchedules 79 and 81 have `dumpsite_id = None`. Rerouting pre-shift navigation from "Base" to "Assigned Dumpsite" will raise null-pointer / 404 errors for drivers on those routes unless a formal schedule-to-dumpsite mapping or fallback rule is established.
* **P0-2: Truck Inactive Transition Cascade Bug:** In `driver/models.py:Truck.save()`, when a truck transitions to `inactive`, it executes `self.schedules.update(driver=None, truck=None)`. If `schedule.save()` or `sync_pickup_statuses()` is subsequently called, it attempts to insert into `PickupStatus.driver` which has `null=False`, triggering an uncaught `IntegrityError: NOT NULL constraint failed: driver_pickupstatus.driver_id`.
* **P0-3: Post-Collection Verification Foreign Key Vulnerability:** In `watcher/models.py:GarbageReport.approved_by`, the field uses `on_delete=models.CASCADE`. Deleting an administrator account would delete approved civic waste reports. (Similarly, `DriverShift.truck` uses `SET_NULL`, severing historical vehicle allocation audits).

### 4. Readiness for Milestone 0B
Milestone 0B (Architecture Specification & Contract Design) **can safely begin** once the project owner confirms the business decisions for unresolved questions U1, U3, and U4.

---

## B. Repository and Environment Inventory

### 1. Git State
* **Current Branch:** `codex-refactored`
* **Upstream Status:** Ahead of `origin/codex-refactored` by 7 commits.
* **Current Commit Hash:** `650486c fix(reliability): notification deduplication and active-shift schedule resolution`
* **Working Tree State:** Contains pre-existing unstaged modifications in 73 files and untracked files from earlier refactoring steps (including `PROJECT_HANDOVER.md`, `community/`, `forecasting/`). **All working tree files remain 100% untouched and preserved.**

### 2. Runtime and Dependency Versions
* **Python:** `3.13.1 (tags/v3.13.1:0671451, Dec  3 2024, 19:06:28) [MSC v.1942 64 bit (AMD64)]`
* **Django:** `4.2.30`
* **Django REST Framework:** `3.17.1`
* **PostgreSQL Driver:** `psycopg2 2.9.11` (installed and available in Python environment)
* **Active Database Engine:** `SQLite 3.45.3` (via Django `django.db.backends.sqlite3`)
* **Node.js:** `v22.14.0`
* **Package Manager:** `npm 11.6.0`

### 3. Active Applications
1. `accounts` (Authentication, Users, Roles, Barangays)
2. `admin` (Django Admin)
3. `analytics` (Forecasting, Performance, Activity logs)
4. `auth` / `contenttypes` / `sessions` (Django core)
5. `community` (Civic forum, discussions, upvoting)
6. `driver` (Trucks, Schedules, DriverShifts, Pickups, Missed stops)
7. `dumpsite` (Dumpsite facilities, waste deliveries, inbound queues)
8. `forecasting` (Waste volume prediction)
9. `news` (Public announcements and news feeds)
10. `notifications` (Barangay and user alerts, deduplication)
11. `watcher` (Stop validations, civic garbage reports, escalations)

---

## C. Django and Test Baseline

### 1. System Health Check
* **Exact Command:** `python wastewatch\backend\manage.py check`
* **Exit Code:** `0`
* **Output:** `System check identified no issues (0 silenced).`
* **Status:** VERIFIED

### 2. Migration Check & Dry Run
* **Exact Command:** `python wastewatch\backend\manage.py makemigrations --check --dry-run`
* **Exit Code:** `0`
* **Output:** `No changes detected`
* **Status:** VERIFIED

### 3. Migration Plan Verification
* **Exact Command:** `python wastewatch\backend\manage.py migrate --plan`
* **Exit Code:** `0`
* **Output:**
  ```text
  Planned operations:
    No planned migration operations.
  ```
* **Status:** VERIFIED (All migrations currently applied).

### 4. Migration History Verification
* **Exact Command:** `python wastewatch\backend\manage.py showmigrations -v 3`
* **Exit Code:** `0`
* **Total Applied Migrations:** 77 across all installed apps.
* **Status:** VERIFIED

### 5. Automated Driver Test Suite Execution
* **Exact Command:** `python wastewatch\backend\manage.py test driver.tests --keepdb`
* **Exit Code:** `0`
* **Test Discovery:** Found 27 test(s) across:
  - `driver.tests.test_crew_assignment_api` (4 tests)
  - `driver.tests.test_schedule_api` (9 tests)
  - `driver.tests.test_shift_schedule_resolution` (8 tests)
  - `driver.tests.test_truck_api` (6 tests)
* **Execution Summary:**
  ```text
  Ran 27 tests in 109.701s
  OK
  Preserving test database for alias 'default'...
  ```
* **Classification of Earlier Failure:**
  The previous test run failed with `ImportError: Failed to import test module: test_shift`. There is no file named `test_shift.py`; the module was named `test_shift_schedule_resolution.py`. When discovering `driver.tests`, the test suite runs with 0 failures and 0 errors.

---

## D. Database Discovery (Read-Only Evidence)

All findings obtained via non-modifying ORM queries against `wastewatch/backend/db.sqlite3`.

### 1. Dumpsite Records (`dumpsite.Dumpsite`)
* **Total Records:** 3

| Dumpsite ID | Name | Operator Link (`Dumpsite.operator`) | Staff Link (`User.dumpsite`) | Fill (kg) / Max Capacity (kg) | Fill % |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | GDS | None | User ID 151 (`dumpsite@gmail.com`) | 22,720.00 / 50,000.00 | 45.4% |
| 2 | asdasd | None | None | 0.00 / 50,000.00 | 0.0% |
| 3 | dumpsite sa domoit | None | None | 800.00 / 50,000.00 | 1.6% |

* **Relationship Inconsistency Found:**
  - `Dumpsite.operator` is a `OneToOneField('accounts.User')` on `Dumpsite`. In all 3 records, this field is **None**.
  - `User.dumpsite` is a `ForeignKey('dumpsite.Dumpsite')` on `User`. User 151 has `dumpsite_id = 1`.
  - The two relationships do not synchronize. The application reads `User.dumpsite` to determine operator assignment, leaving `Dumpsite.operator` unpopulated.

### 2. CollectionSchedule Records & Dumpsite Linkages (`driver.CollectionSchedule`)
* **Total Schedules:** 3

| Schedule ID | Has Dumpsite | Dumpsite ID | Has Driver | Driver ID | Has Truck | Truck ID | Waypoints Count | Operating Days |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 79 | **No** | None | Yes | 150 | Yes | 46 | 3 | Saturday |
| 80 | **Yes** | 1 (GDS) | Yes | 119 | Yes | 47 | 5 | Sun, Mon, Tue, Wed, Thu, Fri, Sat |
| 81 | **No** | None | Yes | 150 | Yes | 45 | 0 | None (empty string) |

* **Critical Evidence:** Schedule IDs **79 and 81** confirm the earlier report: `dumpsite_id` is **None**.

### 3. Truck Allocation & Workforce Records (`driver.Truck`)
* **Total Trucks:** 3

| Truck ID | Plate Number | Status | Drivers (`Truck.drivers` M2M) | Crew (`Truck.crew` M2M) | Associated Schedules |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 45 | AAA-111 | active | [] (Empty) | [] (Empty) | [81] |
| 46 | SIM-999 | active | [] (Empty) | [] (Empty) | [79] |
| 47 | ABS-CBN | active | [119] | [] (Empty) | [80] |

* **`TruckCrewAssignment` Count:** **0 records**.
* **`RouteAssignment` Count:** **0 records**.
* **Finding:** While the `TruckCrewAssignment` table was created in migration `0002`, the frontend and backend bypass it. Truck 47 assigns Driver 119 via direct M2M (`Truck.drivers`), while crew assignments on trucks are currently empty.

### 4. Historical Shifts (`driver.DriverShift`)
* **Total Historical Shifts:** 59
* **Active Shifts:** 0
* **Shifts with Null Driver:** 0
* **Shifts with Null Truck:** 46
* **Shifts with Null Schedule:** 48
* **Persisted Phase Distribution:**
  - `done`: 44 (legacy completed shifts)
  - `end_shift`: 7
  - `ended`: 3
  - `shiftroute`: 3
  - `navigate_to_base`: 2
* **Operational Status (`op_status`) Distribution:**
  - `at_dumpsite`: 19
  - `on_duty`: 15
  - `on_route`: 15
  - `heading_to_start`: 4
  - `heading_to_dumpsite`: 4
  - `returning_to_base`: 2

---

## E. Existing Assignment and Workforce Dependency Map

### 1. Assignment Dependency Matrix

| Assignment Authority | Current Purpose | Read Locations | Write Locations | Historical Integrity Risk |
| :--- | :--- | :--- | :--- | :--- |
| **`Truck.drivers` (M2M)** | Assigns drivers to vehicles. | `TruckViewSet.list`, `crew_resolver.py:52`, `TruckManagement.jsx` | `TruckViewSet.update`, `Truck.save()` (cleared on inactive) | **HIGH.** Overwritten directly; history lost when truck goes inactive. |
| **`Truck.crew` (M2M)** | Assigns crew to vehicles. | `crew_resolver.py:17`, `TruckManagement.jsx`, `TrucksOverlay.jsx` | `TruckViewSet.update`, `Truck.save()` (cleared to string `past_crew_names`) | **HIGH.** Unversioned; past crew stored only as comma-separated string. |
| **`TruckCrewAssignment`** | Structured date-based driver & crew assignment. | `TruckCrewAssignmentViewSet`, `DriverShiftViewSet.pre_start_shift:1113`, `start_shift:1218` | Admin / API only (0 rows in DB) | **CRITICAL.** Completely dead code in practice; 0 rows exist. |
| **`CollectionSchedule.driver`** | Links primary driver to recurring route. | `DriverShiftViewSet.pre_start`, `PickupStatusViewSet.sync`, `AssignmentModule.jsx` | `CollectionScheduleViewSet.update`, `Truck.save()` (set to null on inactive) | **MEDIUM.** Cleared when a truck becomes inactive. |
| **`CollectionSchedule.truck`** | Links vehicle to recurring route. | `CollectionScheduleViewSet.list`, `Truck.schedules` | `CollectionScheduleViewSet.update`, `Truck.save()` (set to null on inactive) | **MEDIUM.** Cleared when a truck becomes inactive. |
| **`RouteAssignment`** | Legacy driver-route mapping. | `RouteAssignmentViewSet.today` | Admin only (0 rows in DB) | **LOW.** Legacy table; superseded by `CollectionSchedule`. |
| **`DriverShift.truck`** | Current vehicle executed during shift. | `DriverShiftViewSet.profile`, `EndShiftModule.jsx`, live map | `DriverShiftViewSet.pre_start`, `start_shift` | **HIGH.** Uses `on_delete=models.SET_NULL`. Deleting a truck severs shift history. |
| **`PickupStatus.driver`** | Driver responsible for stop collection. | `PickupStatusViewSet.current`, `DriverCollectionLog.jsx` | `CollectionSchedule.sync_pickup_statuses()`, `collect()` | **CRITICAL DEFECT.** Foreign key is `NOT NULL`. Triggers DB crash if schedule has `driver=None`. |
| **`WasteDelivery.crew_assignment`**| Links dumpsite delivery to crew assignment. | `WasteDeliveryViewSet.list`, `CollectionLogs.jsx` | `ArrivalLogger.jsx` -> `WasteDeliveryViewSet.perform_create` | **MEDIUM.** Almost always null in existing delivery records. |

### 2. Runtime Assignment Cascade & Defect Verification
1. **The Inactive Truck Cascade Defect:**
   - In `driver/models.py:Truck.save()`, line 60 executes:
     `self.schedules.update(driver=None, truck=None)`
   - In `driver/models.py:CollectionSchedule.sync_pickup_statuses()`, line 150 executes:
     `self.pickups.create(driver=self.driver, status='EN_ROUTE', ...)`
   - In `driver/models.py:PickupStatus`, line 178 defines:
     `driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='pickup_statuses')` (Note: `null=True` is **absent**).
   - **Verification:** When a truck goes inactive, its schedules lose their driver. If `CollectionSchedule.save()` is executed subsequently, `self.driver` is `None`, causing SQLite / PostgreSQL to reject the query with an uncaught `IntegrityError`.

---

## F. Driver Shift State Machine and Dumpsite Staging Investigation

### 1. State Machine Lifecycle
* **Persisted Phases (`DriverShift.status`):**
  1. `navigate_to_base`: Driver dispatched, traveling to staging hub. (Default model value).
  2. `confirm_start`: Driver has arrived at staging hub and confirmed readiness.
  3. `checkin`: Automated system boot, GPS permission acquisition, and timestamp logging.
  4. `shiftroute`: Active waste collection across route waypoints.
  5. `end_shift`: Collection finished, driver returning to dumpsite for weigh-in and shift closure.
* **Phase Enforcement:**
  - Persisted in database via `DriverShift.status = models.CharField(max_length=32, choices=PHASE_CHOICES, default='navigate_to_base')`.
  - Validated on state changes in `DriverShiftViewSet.update_status()` (lines 996–1004) via `VALID_TRANSITIONS`.
  - **Verdict on Renaming:** Changing the persisted string `'navigate_to_base'` in the database would break historical shift queries, existing database migrations, and active client state. The transition to Dumpsite Staging must be implemented by modifying the **UI label** ("Navigate to Dumpsite") and the **navigation target** (`schedule.dumpsite`), preserving the database enum string or establishing a transparent backward-compatible alias.

### 2. Dumpsite Staging & Geofence Discrepancy

| Validation Location | Purpose | Current Threshold | Conditions & Behavior | Source File |
| :--- | :--- | :--- | :--- | :--- |
| **Backend `DriverShiftViewSet.start_shift()`** | Geofence gate before starting duty. | **1000 meters** | Computed via Haversine against `schedule.waypoints[0]`. Bypassed if `DEBUG=True` or if `waypoints[0]` coordinates are missing. | `driver/views.py:1250` |
| **Frontend `NavigateToBaseModule.jsx`** | Auto-advances to `confirm_start` upon arrival. | **150 meters** | Computed via Haversine against `baseLocation` (`schedule.waypoints[0]`). Requires GPS accuracy < 50m. | `NavigateToBaseModule.jsx:40, 169` |
| **Backend `TruckLocationViewSet.create()`** | Filters inaccurate GPS tracking telemetry. | **150 meters** | Drops incoming location pings if GPS accuracy radius > 150m (`ACCURACY_THRESHOLD`). Does not gate shift transitions. | `driver/views.py:677, 751` |
| **Frontend `EndShiftModule.jsx` (Dumpsite Arrival)** | Detects arrival at dumpsite facility for weigh-in. | **150 meters** | Computed against `schedule.dumpsite_detail` (`latitude`, `longitude`). | `EndShiftModule.jsx:473` |

* **Analysis:** The backend 1000m threshold at `waypoints[0]` was originally a coarse sanity check. Re-anchoring staging to the Dumpsite requires targeting `schedule.dumpsite` coordinates on both frontend and backend, with a unified 150m–200m arrival radius.

---

## G. Watcher and Dumpsite Operator Permissions

### 1. Watcher Operational Scope
* **Current Task Retrieval:**
  In `watcher/views.py:StopValidationViewSet.get_queryset()`:
  ```python
  user = self.request.user
  if user.is_authenticated and getattr(user, 'role', None) == 'watcher' and getattr(user, 'barangay', None):
      qs = qs.filter(barangay=user.barangay)
  ```
* **Client-Side Filter:**
  In `WatcherMapTaskModule.jsx` (lines 142–150), tasks are filtered by matching `stop.barangay_id === user.barangay`.
* **Inspection Actions (`pre_inspect` and `post_verify`):**
  Lines 1767 & 1849 verify `request.user.role in ('watcher', 'admin', 'brgy_official')`. They validate physical GPS proximity (150m) to the stop, but **do not check barangay ownership**.
* **Route Scope Feasibility:**
  A Watcher assigned as a Sanitation Team Leader can be granted access to all stop validations along the team's route (`schedule_id = user.led_teams.first().schedule_id`) without altering civic voting permissions (`can_vote_on_report`), which remain strictly locked to the residential barangay.

### 2. Dumpsite Operator Authorization
* **Assignment Mechanism:**
  - An operator is assigned via `User.dumpsite_id = dumpsite.id`.
  - The reverse field `Dumpsite.operator` is unpopulated across all database records.
* **Security Gap Identified:**
  In `dumpsite/views.py:DumpsiteViewSet`, methods (`dashboard`, `inbound_queue`, `deliveries`, `log_arrival`) check `IsAdminOrDumpsiteRole()`, but use `pk` directly from the URL (`dumpsite = self.get_object()`).
  **There is no object-level permission check.** Any user with `role='dumpsite'` can read and log arrivals for any dumpsite ID in the system.

---

## H. Truck Lifecycle and Operational Status

### 1. Representation of Vehicle State
* **Physical Location:** Ephemeral; stored as time-series points in `TruckLocation` and live cache.
* **Operational Availability & Condition:** Conflated into `Truck.status` (`active`, `maintenance`, `inactive`).
  - A truck under scheduled maintenance is marked `maintenance`.
  - A retired or de-allocated truck is marked `inactive`.
  - There is no independent field separating **physical site presence** from **mechanical readiness**.

### 2. Assignment & Shift Constraints
* `DriverShift` enforces `UniqueConstraint(fields=['truck'], condition=Q(is_active=True))`. A truck cannot be allocated to multiple active shifts simultaneously.
* `pre_start_shift()` and `start_shift()` block initialization if `truck.status == 'maintenance'`.

### 3. Deletion and Historical Integrity
* `driver.Truck.delete()` executes `self.schedules.update(driver=None)`.
* `WasteDelivery.truck` uses `on_delete=models.PROTECT` (prevents deletion of trucks with waste delivery history).
* `DriverShift.truck` uses `on_delete=models.SET_NULL`. Deleting a truck nullifies the foreign key on completed shifts, degrading historical audit integrity.

---

## I. Unresolved Business Decisions (U1–U10)

### U1 — Dumpsite Mapping for Schedules Lacking Dumpsites
* **Source Code:** `CollectionSchedule.dumpsite` is nullable (`null=True, blank=True`).
* **Database Evidence:** Schedules 79 and 81 have `dumpsite_id = None`. Schedule 80 is linked to Dumpsite 1 (`GDS`).
* **Unknown:** Which physical dumpsite do routes 79 and 81 utilize?
* **Action Required:** Project owner must confirm whether all city routes default to Dumpsite 1 (`GDS`) or if specific routes map to Dumpsite 3 (`dumpsite sa domoit`).

### U2 — Operator Personnel Transfer Authority
* **Source Code:** Dumpsite operators currently have no transfer endpoints.
* **Database Evidence:** Operators have a single `User.dumpsite_id`.
* **Unknown:** Should operators transfer staff across all teams city-wide, or only teams operating through their specific facility?
* **Action Required:** Project owner must confirm authorization boundary.

### U3 — Team, Schedule, and Truck Cardinality
* **Source Code:** Existing `CollectionSchedule` has 1 driver and 1 truck.
* **Database Evidence:** Truck 47 is linked to Schedule 80 and Driver 119.
* **Unknown:** Can one Sanitation Team operate multiple schedules (e.g. morning vs. afternoon routes)? Can a truck be the default vehicle for more than one team?
* **Action Required:** Project owner must confirm 1:1 vs 1:N cardinality between Team and Schedule.

### U4 — Team Leader Attendance Submission
* **Source Code:** Drivers submit shift roll call. Watchers currently have no attendance model.
* **Database Evidence:** No attendance ledger exists.
* **Unknown:** Should the Driver mark the Watcher (Team Leader) as Present/Absent during pre-shift roll call, or does the Watcher self-check in?
* **Action Required:** Project owner must confirm if Driver roll call includes the Team Leader or strictly Crew Members.

### U5 — Maintenance Authority & Status Toggles
* **Source Code:** Only admins can edit trucks via `TruckViewSet`.
* **Database Evidence:** No inspection records exist.
* **Unknown:** Can a Dumpsite Operator directly toggle a truck to `maintenance`, or does an inspection log merely notify Admin for approval?
* **Action Required:** Project owner must confirm operator write authority on fleet status.

### U6 — Dumpsite Geofence & Staging Coordinates
* **Source Code:** `Dumpsite` model stores one `latitude`/`longitude` pair.
* **Database Evidence:** Dumpsite 1 has coordinates `(13.944758, 121.623473)`.
* **Unknown:** Do these coordinates represent the entrance gate/weighbridge? Is a 150m radius acceptable for arrival detection?
* **Action Required:** Project owner confirmation of geofence radius.

### U7 — Temporary Same-Day Replacements
* **Source Code:** No temporary replacement workflow exists.
* **Database Evidence:** 0 rows in `TruckCrewAssignment`.
* **Unknown:** How should a substitute driver be assigned if the primary driver is absent on shift morning?
* **Action Required:** Project owner confirmation of dispatch fallback workflow.

### U8 — Fuel Logging Actors and Timing
* **Source Code:** No fuel models exist.
* **Database Evidence:** No fuel records.
* **Unknown:** Who is responsible for logging fuel: Driver in mobile app, or Dumpsite Operator on facility desktop? At what shift milestone?
* **Action Required:** Project owner confirmation of operational responsibility.

### U9 — Shift Attendance Status Vocabulary
* **Source Code:** No attendance status enum exists.
* **Database Evidence:** None.
* **Unknown:** Does the driver's roll call only need `Present` and `Absent`? Are `Late` and `Excused` reserved for subsequent Dumpsite Operator corrections?
* **Action Required:** Project owner confirmation of status enum.

### U10 — Waste Weight Attribution During Mid-Route Truck Swaps
* **Source Code:** `WasteDelivery` links to `truck` and `driver`, but not directly to `DriverShift`.
* **Database Evidence:** Historical deliveries reference the delivering truck only.
* **Unknown:** If Truck A breaks down and Truck B completes the route, how is delivered weight attributed?
* **Action Required:** Project owner confirmation of delivery-to-shift linking.

---

## J. Technical Risks and Priority Classification

| Priority | Risk / Finding | Evidence | Affected Component | Recommended Next Action | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0** | **Schedules Lacking Dumpsite:** Schedules 79 and 81 have null `dumpsite_id`. Rerouting to dumpsite causes fatal navigation failure. | Database inspection: Schedules 79, 81. | `CollectionSchedule`, `NavigateToBaseModule` | Map orphan routes to primary dumpsite (Dumpsite 1) upon confirmation. | VERIFIED |
| **P0** | **Inactive Truck Cascade Defect:** Setting truck inactive sets `schedule.driver=None`, causing subsequent `sync_pickup_statuses()` to fail on `NOT NULL` constraint. | `Truck.save():60` vs `PickupStatus.driver` (null=False). | `Truck`, `CollectionSchedule`, `PickupStatus` | In Milestone 0B/1, make `PickupStatus.driver` nullable or guard sync when driver is None. | VERIFIED |
| **P1** | **Dumpsite Operator Scope Vulnerability:** Any authenticated dumpsite operator can access and mutate data for any dumpsite ID. | `DumpsiteViewSet` lacks object-level permission check against `request.user.dumpsite`. | `DumpsiteViewSet` (`inbound_queue`, `log_arrival`) | Implement `IsDumpsiteAssignedOperator` object-level permission. | VERIFIED |
| **P1** | **Shift Truck Audit Loss:** Deleting a truck sets `DriverShift.truck = None` (`SET_NULL`), destroying vehicle audit records. | `driver/models.py:296` (`on_delete=models.SET_NULL`). | `DriverShift`, `Truck` | Change to `PROTECT` or implement soft-delete for fleet assets. | VERIFIED |
| **P1** | **SQLite vs PostgreSQL Constraint Divergence:** PostgreSQL exclusion constraints (`btree_gist`) cannot run on SQLite without breaking local development and test suites. | Test suite runs on SQLite; `psycopg2` installed but no local DB connection configured. | Database models, migrations | Use standard Django transactions and `UniqueConstraint` with condition expressions. | VERIFIED |
| **P2** | **Geofence Threshold Discrepancy:** Backend checks 1000m against waypoints[0]; frontend checks 150m. | `driver/views.py:1250` vs `NavigateToBaseModule.jsx:40`. | Driver shift dispatch flow | Unify arrival geofence to 150m–200m targeting `schedule.dumpsite`. | VERIFIED |
| **P2** | **Dumpsite vs Operator M2M Desynchronization:** `Dumpsite.operator` is None on all records, while `User.dumpsite` is populated. | Database inspection of Dumpsite 1, 2, 3. | `Dumpsite`, `User` | Standardize `User.dumpsite` as canonical assignment source. | VERIFIED |
| **P3** | **Stale Table `TruckCrewAssignment`:** Exists in schema with 0 rows; bypassed by `Truck.crew`. | Database inspection: 0 rows in `TruckCrewAssignment`. | `driver/models.py:245` | Deprecate in Milestone 1 in favor of `SanitationTeamMembership`. | VERIFIED |

---

## K. Milestone 0A Exit Assessment

| Assessment Question | Status | Evidence / Justification |
| :--- | :---: | :--- |
| **1. Is the current database baseline understood?** | **VERIFIED** | Full audit completed: 3 Dumpsites, 3 Trucks, 3 Schedules, 59 Shifts, 0 Active shifts. |
| **2. Are migration and test failures classified?** | **VERIFIED** | Confirmed both failures were pathing/naming artifacts; actual baseline is 77/77 migrations applied and 27/27 tests passing. |
| **3. Is the production database engine confirmed?** | **UNVERIFIED** | Development uses SQLite 3.45.3. Production PostgreSQL deployment is configured in `settings.py` via `DATABASE_URL` but unverified in live environment. |
| **4. Are existing assignment authorities fully mapped?** | **VERIFIED** | Dependency matrix established for `Truck.drivers`, `Truck.crew`, `CollectionSchedule`, and `DriverShift`. |
| **5. Are the shift lifecycle and persisted phases understood?** | **VERIFIED** | Lifecycle analyzed across all 5 persisted phases; `navigate_to_base` confirmed as persisted default. |
| **6. Are Dumpsite relationships understood?** | **VERIFIED** | Mismatch identified between `Dumpsite.operator` (None) and `User.dumpsite` (User 151). Schedules 79 & 81 identified as lacking dumpsites. |
| **7. Are security gaps identified?** | **VERIFIED** | Lack of object-level authorization on `DumpsiteViewSet` verified from source code. |
| **8. Are the unresolved business decisions clearly documented?** | **VERIFIED** | Complete catalog of U1–U10 documented with source code and database evidence. |
| **9. Is the project ready for Milestone 0B?** | **VERIFIED** | The diagnostic baseline is solid; specification of data contracts can proceed without guessing. |
| **10. What must be resolved before Milestone 1 architecture approval?** | **BLOCKED** | Project owner must resolve U1 (orphan dumpsite mapping), U3 (team cardinality), and U4 (team leader roll call inclusion). |

---

## Confirmation Statement
**Confirmed:** No source files were modified, created, deleted, or moved. No migrations were created or applied. No database records were altered. No packages were installed or removed. Git working tree state was preserved exactly as found.
