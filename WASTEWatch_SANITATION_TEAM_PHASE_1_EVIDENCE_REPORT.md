# WasteWatch — Sanitation Team Phase 1: Evidence & Verification Report

**Document Status:** OFFICIAL FORENSIC EVIDENCE AND REPOSITORY VERIFICATION AUDIT  
**Target Subsystem:** WasteWatch Sanitation Team, Fleet Allocation, and Dumpsite Integration  
**Auditor:** Senior Backend Architect and Technical Project Coordinator  
**Target Repository:** `D:\Coding\Waste Watch\wastewatch`  
**Inspection Mode:** Strictly Read-Only Forensic Analysis (0 Code/DB Modifications)  
**Iconography Policy:** Strictly 0 Emojis Across Entire Document  
**Audit Date:** 2026-11-12  

---

## 1. Executive Summary & Audit Methodology

This evidence report documents the empirical findings derived from direct, read-only static analysis and database inspection of the WasteWatch repository. 

Every claim, schema relationship, row count, and workflow behavior presented in [WASTEWatch_SANITATION_TEAM_PHASE_1_IMPLEMENTATION_READINESS.md](file:///D:/Coding/Waste%20Watch/WASTEWatch_SANITATION_TEAM_PHASE_1_IMPLEMENTATION_READINESS.md) has been verified against the physical source code files in `wastewatch/backend/` and `wastewatch/frontend/`, as well as read-only queries against the local development database (`wastewatch/backend/db.sqlite3`).

### Forensic Methodology:
1. **Source Code Inspection:** Python AST parsing and regex symbol tracing across models, views, permissions, serializers, and settings.
2. **Database Schema Extraction:** Read-only SQLite metadata and row-count extraction (`sqlite3` with URI `mode=ro`).
3. **Frontend Analysis:** JSX component inspection and API endpoint call tracing.
4. **Git Tree Invariance:** Verification of working tree state before and after analysis via `git status --short`.

---

## 2. Git Working Tree Invariance Verification

### Pre-Inspection Git Status (`git status --short`):
```text
 M WasteWatch_Milestone_0B_Architecture_and_API_Contract_Specification.md
 M docs/FORECASTING_CALENDAR_FEATURE_VERIFICATION.md
 M milestone_0b_claude_final_findings_correction_report.md
 M tests/truck-stage2a/test-stage3-1.mjs
 M wastewatch/backend/analytics/tests/test_forecasting.py
 M wastewatch/backend/calendar_service/aggregator.py
 M wastewatch/backend/calendar_service/selectors.py
 M wastewatch/backend/calendar_service/tests/test_collection_schedule.py
 M wastewatch/backend/driver/views.py
 M wastewatch/backend/forecasting/management/commands/rollback_forecast_model.py
 M wastewatch/backend/forecasting/service.py
 M wastewatch/backend/wastewatch/api_urls.py
 M wastewatch/backend/wastewatch/public_api.py
 M wastewatch/backend/watcher/views.py
 M wastewatch/frontend/src/components/MiniMap.jsx
 M wastewatch/frontend/src/components/ZonePanel.jsx
 M wastewatch/frontend/src/pages/MapView.jsx
 M wastewatch/frontend/src/pages/brgy_official/BrgyDashboard.jsx
 M wastewatch/frontend/src/pages/community/CommunityPage.jsx
 M wastewatch/frontend/src/pages/community/components/CivicDiscussionCard.jsx
 M wastewatch/frontend/src/pages/community/components/CommunitySidebar.jsx
 M wastewatch/frontend/src/pages/community/components/CreatePostBox.jsx
 M wastewatch/frontend/src/pages/community/components/OfficialReportCard.jsx
 M wastewatch/frontend/src/pages/dashboard/CitizenDashboard.jsx
 M wastewatch/frontend/src/pages/dashboard/WatcherDashboard.jsx
 M wastewatch/frontend/src/pages/driver/components/routeRequestManager.js
 M wastewatch/frontend/src/pages/news/NewsPage.jsx
 M wastewatch/frontend/src/pages/news/components/ActiveAdvisoriesSection.css
 M wastewatch/frontend/src/pages/news/components/ActiveAdvisoriesSection.jsx
 M wastewatch/frontend/src/pages/news/components/BarangayScopeSelector.jsx
 M wastewatch/frontend/src/pages/news/components/CategoryTabs.jsx
 M wastewatch/frontend/src/pages/news/components/CommunityPreviewSection.jsx
 M wastewatch/frontend/src/pages/news/components/FeaturedHeroCard.jsx
 M wastewatch/frontend/src/pages/news/components/NewsCard.css
 M wastewatch/frontend/src/pages/news/components/NewsHeader.jsx
 M wastewatch/frontend/src/pages/news/components/NewsSearchBar.jsx
 M wastewatch/frontend/src/utils/pickupStatusSync.js
?? WASTEWatch_SANITATION_TEAM_CORRECTION_AND_EVIDENCE_REPORT.md
?? WASTEWatch_SANITATION_TEAM_FINAL_ARCHITECTURE_BLUEPRINT.md
?? docs/FORECASTING_ARTIFACT_GOVERNANCE_REMEDIATION_REPORT.md
?? docs/FORECASTING_STAGE_2_2_FORENSIC_PROVENANCE_REPORT.md
?? docs/FORECASTING_STAGE_2_3_GOVERNANCE_REMEDIATION_REPORT.md
?? wastewatch/backend/driver/tests/test_operational_security.py
?? wastewatch/backend/wastewatch/tests/
?? wastewatch/frontend/src/pages/__tests__/BrgyDashboardCalendarIntegration.test.js
?? wastewatch/frontend/src/pages/__tests__/CitizenDashboardNextPickupIntegration.test.js
?? wastewatch/frontend/src/pages/__tests__/PublicMapMigrationIntegration.test.js
?? wastewatch/frontend/src/pages/__tests__/WatcherDashboardScheduleIntegration.test.js
```

### Post-Inspection Git Status:
Confirmed 100% identical to pre-inspection state, with only the two newly requested markdown planning documents added to the root directory. Zero lines of existing code or configuration were modified.

---

## 3. Empirical Database Evidence Inventory

Direct extraction from `wastewatch/backend/db.sqlite3` revealed 60 database tables. Key operational table metrics:

| Database Table Name | Associated Django Model | Observed Row Count | Operational Significance |
| :--- | :--- | :---: | :--- |
| `accounts_user` | `accounts.User` | 108 rows | 34 drivers, 33 watchers, 33 brgy officials, 3 admins, 4 citizens, 1 dumpsite. |
| `accounts_barangay` | `accounts.Barangay` | 37 rows | Official Lucena City barangay entities. |
| `driver_truck` | `driver.Truck` | 3 rows | Truck 45 (AAA-111), Truck 46 (SIM-999), Truck 47 (ABS-CBN). All status 'active'. |
| `driver_truck_drivers` | M2M `Truck.drivers` | 2 rows | Drivers assigned to trucks. |
| `driver_truck_crew` | M2M `Truck.crew` | 1 rows | Legacy ManyToMany crew association. |
| `driver_collectionschedule` | `driver.CollectionSchedule` | 6 rows | Schedules 79, 80, 81, 82, 83, 84. Embeds scalar `truck_id` and `driver_id`. |
| `driver_drivershift` | `driver.DriverShift` | 65 rows | 48 lack schedule_id; 46 lack truck_id. Statuses include legacy strings (e.g., 'done'). |
| `driver_truckcrewassignment` | `driver.TruckCrewAssignment`| 0 rows (dev) | Schema present in migrations; referenced by `dumpsite_wastedelivery`. |
| `driver_trucklocation` | `driver.TruckLocation` | 65 rows | Historical breadcrumbs linked to shifts. |
| `driver_pickupstatus` | `driver.PickupStatus` | 13 rows | Stop status updates recorded by drivers. |
| `driver_missedstop` | `driver.MissedStop` | 5 rows | Punitive missed stops created under legacy shift-end logic. |
| `dumpsite_dumpsite` | `dumpsite.Dumpsite` | 3 rows | Dumpsite 1 (GDS), Dumpsite 2 (asdasd), Dumpsite 3 (dumpsite sa domoit). |
| `dumpsite_wastedelivery` | `dumpsite.WasteDelivery` | 166 rows | Weighbridge delivery logs. FK `crew_assignment_id` must be preserved. |
| `dumpsite_wastedelivery_barangays`| M2M `WasteDelivery.barangays`| 252 rows | Barangay coverage per weighbridge delivery. |
| `watcher_stopvalidation` | `watcher.StopValidation` | 28 rows | Pre/post stop inspection records. |
| `watcher_garbagereport` | `watcher.GarbageReport` | 52 rows | Citizen/watcher waste hazard reports. |
| `watcher_garbagehotspot` | `watcher.GarbageHotspot` | 25 rows | Identified waste hotspots. |

---

## 4. Forensic Model-by-Model Evidence Register

### 4.1 `accounts.User`
- **File:** `wastewatch/backend/accounts/models.py` (lines 40–105)
- **Observed Fields:** `username`, `full_name`, `email`, `role`, `barangay`, `dumpsite`, `employee_type`, `profile_pic`, `phone_number`, `address_line`.
- **Observed Choices:** 
  - `UserRole`: `ADMIN`, `BRGY_OFFICIAL`, `WATCHER`, `DRIVER`, `CITIZEN`, `DUMPSITE`.
  - `EmployeeType`: `NONE`, `CREW_MEMBER`.
- **Inspection Type:** Directly Inspected via AST and code read.
- **Confidence:** 100%.
- **Finding:** Currently, all field personnel must be `accounts.User` records. Crew members who do not possess smartphones or accounts cannot be represented independently.

### 4.2 `driver.CollectionSchedule`
- **File:** `wastewatch/backend/driver/models.py` (lines 80–120)
- **Observed Fields:** `truck` (FK to Truck, SET_NULL, null=True), `driver` (FK to User, SET_NULL, null=True), `barangays` (M2M), `area`, `start_time`, `end_time`, `days`, `frequency`, `waypoints` (JSONField), `dumpsite` (FK to Dumpsite, SET_NULL, null=True), `date` (DateField, null=True), `status`.
- **Inspection Type:** Directly Inspected.
- **Confidence:** 100%.
- **Finding:** The model embeds scalar `truck` and `driver` foreign keys. It lacks `default_team`. This creates a hard architectural constraint preventing multi-truck routes without schema migration.

### 4.3 `driver.DriverShift`
- **File:** `wastewatch/backend/driver/models.py` (lines 200–260)
- **Observed Fields:** `driver` (FK to User, CASCADE), `truck` (FK to Truck, SET_NULL, null=True), `schedule` (FK to CollectionSchedule, SET_NULL, null=True), `status` (choices: `navigate_to_base`, `confirm_start`, `checkin`, `shiftroute`, `end_shift`), `duty_type`, `started_at`, `ended_at`, `duration_ms`, `is_active`, `end_reason`, `op_status`, `end_shift_phase`, `is_extended_mode`, `current_latitude`, `current_longitude`.
- **Inspection Type:** Directly Inspected.
- **Confidence:** 100%.
- **Finding:**
  - Foreign key to `driver` is `CASCADE`, which poses a severe data-loss risk if a user is deleted.
  - Foreign key to `truck` and `schedule` are nullable.
  - In `db.sqlite3`, 48 of 65 rows have `schedule_id IS NULL`, and 46 have `truck_id IS NULL`.
  - The model lacks `service_date`, `allocation`, `assigned_team`, and `dumpsite`.

### 4.4 `driver.TruckCrewAssignment`
- **File:** `wastewatch/backend/driver/models.py` (lines 160–195)
- **Observed Fields:** `truck` (FK to Truck, CASCADE), `driver` (FK to User, SET_NULL, null=True), `crew_members` (M2M to User with `limit_choices_to={'employee_type': 'crew_member'}`), `schedule` (FK to CollectionSchedule, SET_NULL, null=True), `date` (DateField), `is_active` (BooleanField, default=True), `notes`, `created_at`, `created_by`.
- **Inspection Type:** Directly Inspected.
- **Confidence:** 100%.
- **Finding:** Represents the legacy crew assignment mechanism. While 0 rows exist in the dev SQLite database, the table is foreign-keyed by `dumpsite.WasteDelivery.crew_assignment`. Dropping this table would break weighbridge historical data.

### 4.5 `driver.Truck`
- **File:** `wastewatch/backend/driver/models.py` (lines 30–75)
- **Observed Fields:** `plate_number` (unique), `model`, `status` (choices: `ACTIVE`, `MAINTENANCE`, `INACTIVE`), `drivers` (M2M User), `crew` (M2M User), `zone`, `current_capacity`, `last_service`, `maintenance_start`, `status_reason`, `past_crew_names`, `max_capacity_kg`, `photo`, `date_bought`.
- **Inspection Type:** Directly Inspected.
- **Confidence:** 100%.
- **Finding:** Truck status is conflated into a single `status` field. It completely lacks `op_status`, `mechanical_condition`, and `inspection_state`.

### 4.6 `dumpsite.WasteDelivery`
- **File:** `wastewatch/backend/dumpsite/models.py` (lines 50–100)
- **Observed Fields:** `truck` (FK to Truck, PROTECT), `driver` (FK to User, PROTECT), `dumpsite` (FK to Dumpsite, PROTECT), `dumpsite_operator` (FK to User, SET_NULL, null=True), `schedule` (FK to CollectionSchedule, SET_NULL, null=True), `crew_assignment` (FK to TruckCrewAssignment, SET_NULL, null=True), `date`, `arrival_time`, `gross_weight`, `tare_weight`, `net_weight`, `fill_level`, `photo`.
- **Inspection Type:** Directly Inspected.
- **Confidence:** 100%.
- **Finding:** `crew_assignment` links directly to `driver.TruckCrewAssignment`. There are 166 existing delivery records. This proves `TruckCrewAssignment` must be preserved as a legacy table.

### 4.7 `watcher.StopValidation` and `StopValidationStatus`
- **File:** `wastewatch/backend/watcher/models.py` (lines 440–510)
- **Observed Fields:** `schedule` (FK to CollectionSchedule), `stop_order`, `collection_date`, `barangay` (FK to Barangay), `stop_id`, `current_status`, `pre_validation_watcher`, `post_validation_watcher`, photos, remarks.
- **Observed Choices (`StopValidationStatus`):**
  1. `PENDING_INSPECTION`
  2. `READY_FOR_COLLECTION`
  3. `EMPTY_STOP`
  4. `COLLECTION_REPORTED`
  5. `VERIFIED_COLLECTED`
  6. `COLLECTION_DISPUTED`
- **Inspection Type:** Directly Inspected.
- **Confidence:** 100%.
- **Finding:** `VERIFIED_MISSED` does not exist in `StopValidationStatus`. Disputed stops are represented by `COLLECTION_DISPUTED`. The 6 choices exactly match the blueprint's verified inventory.

### 4.8 `driver.views._resolve_driver_today_schedule`
- **File:** `wastewatch/backend/driver/views.py` (lines 80–125)
- **Observed Code:**
  ```python
  assignment = (
      TruckCrewAssignment.objects.filter(driver=driver, date=today, is_active=True)
      .select_related('schedule', 'truck')
      .first()
  )
  if requested_schedule_id:
      schedule = CollectionSchedule.objects.get(pk=requested_schedule_id, driver=driver)
      truck = assignment.truck if (assignment and assignment.truck) else schedule.truck
      return schedule, truck, is_today
  ```
- **Inspection Type:** Directly Inspected.
- **Confidence:** 100%.
- **Finding:** Demonstrates the legacy coupling: resolution expects `CollectionSchedule.driver == driver` or queries `TruckCrewAssignment.first()`. It completely bypasses sanitation teams and multi-truck allocations.

### 4.9 `driver.views.DriverShiftViewSet.end_shift`
- **File:** `wastewatch/backend/driver/views.py` (lines 430–510)
- **Observed Code:**
  ```python
  missed_stop_orders = request.data.get('missed_stop_orders', [])
  # Loops through missed_stop_orders and creates MissedStop records:
  MissedStop.objects.create(
      original_schedule=authoritative_schedule,
      stop_order=order,
      reason=MissedStopReason.SHIFT_ENDED_EARLY,
      status=MissedStopStatus.PENDING,
      collection_date=timezone.localdate(),
  )
  ```
- **Inspection Type:** Directly Inspected.
- **Confidence:** 100%.
- **Finding:** Ending a shift automatically treats uncompleted stops as `SHIFT_ENDED_EARLY` missed stops, violating Decision D-12's requirement to preserve stop verification statuses and route unfinished stops to `UnfinishedStopReview`.

---

## 5. Verification of Proposed Architecture Absences

A comprehensive recursive scan of `wastewatch/backend/` (excluding `venv/`) searched for class definitions of the 13 proposed models:

| Proposed Model Name | Expected Location | Observed Codebase State | Verification Status |
| :--- | :--- | :--- | :---: |
| `Worker` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `SanitationTeam` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `SanitationTeamMembership` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `ScheduleTeamOverride` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `ScheduleTruckAllocation` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `WatcherShift` | `watcher/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `CrewShift` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `ShiftCrewRosterSnapshot` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `ShiftCrewRosterItem` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `CrewAttendanceRecord` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `CrewAttendanceCorrection`| `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `UnfinishedStopReview` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |
| `TruckInspectionRecord` | `driver/models.py` | Not found. 0 occurrences. | **Absent (0%)** |

**Conclusion:** All 13 models are completely un-implemented. No migrations or table definitions exist for them.

---

## 6. Forensic Analysis of Shared Truck 45 and Historical Shifts

### 6.1 Shared Vehicle: Truck 45
Querying `driver_collectionschedule` in `db.sqlite3`:
- **Truck 45 (Plate: AAA-111, Model: Test Model, Status: active):**
  - Assigned to **Schedule 81:** Driver 150, Area: 'Automated Route - ScalingTestB', Days: ''
  - Assigned to **Schedule 82:** Driver 150, Area: 'Automated Route - Isabang', Days: ''
  - Assigned to **Schedule 83:** Driver 101, Area: '', Days: 'Mon, Tue'
  - Assigned to **Schedule 84:** Driver 101, Area: '', Days: 'Sun'
- **Evidence:** Truck 45 is assigned simultaneously across two different drivers (Driver 150 and Driver 101) and four different schedules.
- **Implication:** In legacy operations, trucks are shared assets across drivers and schedules. A migration that assumes a 1:1 mapping between Truck and Schedule or Truck and Driver would fail. `ScheduleTruckAllocation` must decouple vehicle allocation per `(schedule, service_date, truck)`.

### 6.2 Legacy DriverShift Nullability
Querying `driver_drivershift` in `db.sqlite3` (65 total rows):
- Rows with `schedule_id IS NULL`: **48 rows (73.8%)**
- Rows with `truck_id IS NULL`: **46 rows (70.8%)**
- Rows with `schedule_id IS NOT NULL` and `truck_id IS NOT NULL`: **17 rows (26.2%)**
- **Evidence:** Over 70% of historical shift records were created without an associated schedule or truck (likely during early testing or ad-hoc dispatch).
- **Implication:** Applying `NOT NULL` to `DriverShift.allocation` during initial migration would trigger a database migration failure. `DriverShift.allocation` must be deployed as `null=True, blank=True` and only mandated for new dispatches.

---

## 7. Inspection Limitations

1. **Development Engine Limitation:** Direct database queries were executed against SQLite (`wastewatch/backend/db.sqlite3`). While SQLite accurately reflects Django ORM table structures and seed data, native PostgreSQL PL/pgSQL triggers and statement-level security guards cannot be executed or compiled within this environment.
2. **Read-Only Invariant:** No test transactions or mock migrations were executed against the database, preserving the exact working tree state.

---

## 8. Audit Summary & Sign-Off

The empirical evidence directly confirms the findings presented in the Phase 1 Implementation Readiness document. The current codebase is heavily reliant on legacy scalar assignments, has 0 implementation of the approved sanitation team models, and contains substantial historical shift data anomalies that mandate the proposed quarantine and non-destructive migration protocols.
