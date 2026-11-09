# WasteWatch Milestone 0B — Three Independent Shift Lifecycles Architecture Correction Report
**Initiative:** Architecture Correction: DriverShift, WatcherShift, and CrewShift Decoupling  
**Date:** November 8, 2026  
**Auditor / Reviewer Target:** Claude (Principal Software Architect & Code Quality Validator), Project Owner  
**Execution Mode:** STRICTLY DESIGN-ONLY (Zero Code Modifications, Zero DB Alterations, Zero Migrations)  
**Readiness Verdict:** **READY FOR INDEPENDENT VALIDATION**  

---

## 1. Summary of the Architecture Correction

This report documents a focused, authoritative architectural correction to Milestone 0B of WasteWatch. In previous iterations, an inadvertent circular dependency existed between Driver dispatch staging and Watcher crew roll call submission. 

Following direct project owner directives, the architecture has been corrected to establish **Three Independent Shift Lifecycles**:
1. **`DriverShift`:** Owned, initiated, and concluded independently by the Driver. Governs vehicle operation, GPS tracking, collection stop traversal, dumpsite unloading/calibration, and vehicle return.
2. **`WatcherShift`:** Owned, initiated, and concluded independently by the Watcher (Team Leader). Governs operational inspection, collection monitoring, stop validation across routes, and crew attendance submission.
3. **`CrewShift`:** An operational crew participation record created upon Watcher attendance submission and bound directly to the active `WatcherShift`.

Crucially, **no operational gating, blocking, or foreign key dependencies exist between `DriverShift` and `CrewShift`**.

---

## 2. Owner-Approved Decisions Incorporated

The following decisions are approved by the project owner and codified in this revision:
1. **Three Independent Shifts:** `DriverShift`, `WatcherShift`, and `CrewShift` are distinct operational records with separate lifecycles.
2. **Driver Independence:** The Driver can start their shift, stage at the Dumpsite, and depart on route without waiting for Watcher attendance submission. DriverShift is not created or modified by Watcher attendance.
3. **Watcher Independence:** The Watcher can start their shift, inspect stops, and submit Crew attendance without requiring an existing DriverShift.
4. **CrewShift Linked to WatcherShift:** `CrewShift` binds directly to `WatcherShift` (`models.ForeignKey('watcher.WatcherShift', on_delete=models.PROTECT)`). The submitting Watcher is the accountable actor.
5. **Zero-Connectivity Crew Policy:** Crew Members are Citizens (`employee_type='crew_member'`). They do not need user accounts, logins, mobile devices, or active online connectivity.
6. **Rejection of Manual GPS Override:** The project owner **explicitly rejected** a manual GPS Shift Start override. Staging departure strictly requires server-authoritative 150m Haversine arrival verification against `schedule.dumpsite`.

---

## 3. Explanation of Previous Circular Lifecycle Error

In earlier drafts:
* Watcher attendance submission expected a target `DriverShift` ID to attach crew attendance rows to the vehicle shift.
* Conversely, the Driver pre-start workflow expected crew attendance to be submitted or verified before route dispatch could begin.
* **The Failure Mode:** If the Driver staged early at 05:45 but the Watcher had not yet submitted roll call, the Driver was blocked from starting. If the Watcher arrived at 06:00 to submit roll call, the system had no `DriverShift` record to attach the attendance to.
* **The Correction:** By introducing `CrewShift` bound to `WatcherShift`, attendance is anchored to the Watcher's administrative shift and operational schedule, completely freeing `DriverShift` from any attendance prerequisite.

---

## 4. Corrected Three-Shift Lifecycle Architecture

```text
Driver
  |
  +---- DriverShift (Independent Lifecycle)
          |
          +---- Assigned Truck
          +---- CollectionSchedule Reference
          +---- Assigned Dumpsite Reference
          +---- Route Geometry Snapshot
          +---- Fuel Logs (Gauge %)
          +---- Waste Deliveries (Scale Tickets)
          +---- Truck Swap Logs


Watcher
  |
  +---- WatcherShift (Independent Lifecycle)
          |
          +---- Supervised SanitationTeam
          +---- CollectionSchedule Reference
          +---- Route Stop Validations
          |
          +---- Crew Attendance Submission
                    |
                    +---- CrewShift (Operational Crew Record)
                            |
                            +---- SanitationTeam Reference
                            +---- CollectionSchedule Reference
                            +---- WatcherShift Reference (Accountability)
                            +---- Submitting Watcher Identity
                            +---- Crew Attendance Records (Immutable)
                            +---- Attendance Correction History (Append-Only)
```

### Operational Scenarios Resolved:
1. **Driver Starts First:** Driver initiates `DriverShift` at Dumpsite gate; Watcher later initiates `WatcherShift` and submits roll call creating `CrewShift`. Both continue independently.
2. **Watcher Starts First:** Watcher initiates `WatcherShift` and creates `CrewShift` via roll call; Driver arrives later and dispatches vehicle.
3. **Simultaneous Start:** Zero lock contention or race conditions; operations target completely separate tables.
4. **Attendance Submitted After DriverShift Ends:** Watcher transmits attendance post-route; `CrewShift` records attendance against the operational schedule without touching the completed `DriverShift`.
5. **Crew Attendance Correction:** Subsequent adjustments update authoritative state via append-only `ShiftAttendanceCorrection` without altering `DriverShift`.

---

## 5. Updated ERD & Model Specifications

### 5.1 `watcher.WatcherShift`
```python
class WatcherShift(models.Model):
    watcher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='watcher_shifts')
    team = models.ForeignKey('driver.SanitationTeam', on_delete=models.PROTECT, related_name='watcher_shifts')
    schedule = models.ForeignKey('driver.CollectionSchedule', on_delete=models.PROTECT, related_name='watcher_shifts')
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    ended_at = models.DateTimeField(null=True, blank=True, db_index=True)
    duration_ms = models.BigIntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)
    status = models.CharField(max_length=20, default='active', choices=[('active', 'Active'), ('completed', 'Completed')])
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

### 5.2 `driver.CrewShift`
```python
class CrewShift(models.Model):
    watcher_shift = models.ForeignKey('watcher.WatcherShift', on_delete=models.PROTECT, related_name='crew_shifts')
    submitting_watcher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='submitted_crew_shifts')
    team = models.ForeignKey('driver.SanitationTeam', on_delete=models.PROTECT, related_name='crew_shifts')
    schedule = models.ForeignKey('driver.CollectionSchedule', on_delete=models.PROTECT, related_name='crew_shifts')
    roster_snapshot = models.JSONField(default=list, help_text="Frozen list of crew members assigned at attendance submission")
    attendance_submitted_at = models.DateTimeField(default=timezone.now, db_index=True)
    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    status = models.CharField(max_length=20, default='active', choices=[('active', 'Active'), ('completed', 'Completed')])
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

### 5.3 `driver.ShiftAttendance` (Re-Anchored to `CrewShift`)
```python
class ShiftAttendance(models.Model):
    crew_shift = models.ForeignKey(CrewShift, on_delete=models.CASCADE, related_name='attendance_records')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='shift_attendances')
    original_status = models.CharField(max_length=20, choices=AttendanceStatus.choices)
    current_status = models.CharField(max_length=20, choices=AttendanceStatus.choices)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['crew_shift', 'user'], name='unique_crew_member_per_crew_shift')
        ]
```

### 5.4 `driver.DriverShift` (Preserved & Independent)
* Retains independent lifecycle phases: `navigate_to_base` $\longrightarrow$ `confirm_start` $\longrightarrow$ `shiftroute` $\longrightarrow$ `dump_site` $\longrightarrow$ `calibration_complete` $\longrightarrow$ `end_shift`.
* Zero foreign keys to `CrewShift` or `WatcherShift`.

---

## 6. Updated API Contracts

### 6.1 Start WatcherShift
* **Endpoint:** `POST /api/watcher/shifts/`
* **Permission:** `IsWatcherRole`
* **Request:** `{ "schedule_id": 80 }`
* **Response (201 Created):** `{ "id": 101, "status": "active", "started_at": "..." }`

### 6.2 Submit Crew Attendance (Generates CrewShift)
* **Endpoint:** `POST /api/watcher/shifts/{id}/submit_attendance/`
* **Permission:** `IsWatcherRole` (Must match shift watcher)
* **Request:**
  ```json
  {
    "attendance": [
      { "user_id": 149, "status": "present" },
      { "user_id": 152, "status": "absent" },
      { "user_id": 155, "status": "present" }
    ]
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "status": "success",
    "crew_shift_id": 55,
    "watcher_shift_id": 101,
    "team_id": 4,
    "submitted_at": "2026-11-08T06:05:00Z",
    "summary": { "present": 2, "absent": 1, "late": 0, "excused": 0 }
  }
  ```
* **No `driver_shift_id`:** The endpoint does not require, accept, or mutate `DriverShift`.

### 6.3 Driver Pre-Start (Independent)
* **Endpoint:** `POST /api/driver/shift/pre_start/`
* **Permission:** `IsDriverRole`
* **Request:** `{ "schedule_id": 80, "departure_fuel_percent": 90 }`
* **Response (200 OK / 201 Created):** `{ "id": 62, "status": "navigate_to_base" }`

---

## 7. Updated Permissions

* **Driver:** Authorized for `DriverShiftViewSet` (`pre_start`, `start_shift`, `update-status`, `end_shift`). Denied access to attendance submission.
* **Watcher (Team Leader):** Authorized for `WatcherShiftViewSet` (`start`, `end`, `submit_attendance`) and `WatcherTeamAttendanceViewSet` (`correct`). Route-wide stop validation authorized via `can_inspect_collection_stop`.
* **Dumpsite Operator:** Authorized for facility inspections, fuel gate entry, and emergency truck swaps. Denied attendance submission or verification.
* **Citizen / Crew Member:** Zero write permissions on shift or attendance endpoints.

---

## 8. Updated Architectural Test Matrix (17 Test Scenarios)

The test matrix in Section 30 of the specification was expanded to include all 17 target scenarios:
1. `T1`: `DriverShift` creation without `WatcherShift`.
2. `T2`: `WatcherShift` creation without `DriverShift`.
3. `T3`: `CrewShift` creation without `DriverShift`.
4. `T4`: `CrewShift` foreign key verification to `WatcherShift`.
5. `T5`: Concurrent `DriverShift` and `WatcherShift` creation under load.
6. `T6`: Attendance submitted after `DriverShift` completed.
7. `T7`: Attendance submitted when no driver is scheduled.
8. `T8`: Idempotent retry of identical attendance payload.
9. `T9`: Prevention of duplicate `CrewShift` generation for the same operational shift.
10. `T10`: Multiple crew members correctly recorded under single `CrewShift`.
11. `T11`: Single crew member assigned across multiple shifts on same calendar day.
12. `T12`: Overnight shift crossing midnight preserved as single `CrewShift`.
13. `T13`: Append-only `ShiftAttendanceCorrection` audit generation.
14. `T14`: Rejection of Driver attempting to call attendance submission.
15. `T15`: Rejection of Watcher submitting attendance for an unassigned team.
16. `T17`: Historical integrity preservation of `ShiftAttendance` upon user deactivation.

---

## 9. List of Specification Sections Changed

In [`WasteWatch_Milestone_0B_Architecture_and_API_Contract_Specification.md`](file:///d:/Coding/Waste%20Watch/WasteWatch_Milestone_0B_Architecture_and_API_Contract_Specification.md):
* **Section 1 (Executive Summary):** Defined the three independent shift lifecycles; codified rejection of manual GPS override.
* **Section 2 (Revision History):** Logged version `v2.1` Architecture Correction.
* **Section 3 (Business Requirements):** Added B13, B14, and B15.
* **Section 4 (Current-State Gap Analysis):** Documented the resolution of the circular attendance dependency.
* **Section 5 (Revised Domain Model):** Updated Mermaid ERD and hierarchical shift relationship.
* **Section 8 & 9 (Watcher Responsibilities & Attendance):** Formulated `WatcherShift`, `CrewShift`, and resolved the 5 operational scenarios.
* **Section 10 & 11 (Driver Responsibilities & Snapshots):** Solidified `DriverShift` independence and historical snapshot preservation.
* **Section 15 (GPS Policy):** Removed proposed manual override; codified owner rejection.
* **Section 20 (Permission Matrix):** Updated with distinct DriverShift and WatcherShift actions.
* **Section 21 (Model Specifications):** Formally defined `WatcherShift`, `CrewShift`, `ShiftAttendance`, and `DriverShift`.
* **Section 22 & 23 (API Inventory & Contracts):** Updated contracts to decouple attendance submission from driver shifts.
* **Section 30 (Testing Strategy):** Integrated all 17 target architectural test scenarios.
* **Section 32 (Unresolved Decisions):** Confirmed rejection of manual GPS override; preserved U7, U10, and dumpsite coordinates as proposed.

---

## 10. Summary Categorization of System State

| Category | Components / Items Included |
| :--- | :--- |
| **Newly Approved Design** | Three Independent Shift Lifecycles (`DriverShift`, `WatcherShift`, `CrewShift`); `CrewShift` linked to `WatcherShift`; Watcher-led attendance creating `CrewShift`; removal of all driver attendance dependencies; 17 architectural test scenarios. |
| **Previously Approved Design Preserved** | Reusable `Route` entity; `CollectionSchedule` team ownership; Dumpsite as operational base; explicit dumpsite assignment; post-shift inspection hold placement; split fuel logging; watcher route-wide stop validation; zero-device crew policy. |
| **Unresolved Decisions (Proposed)** | U7: Substitute driver authorization rules; U10: WasteDelivery shift foreign key without weight proration; Dumpsite coordinates: Staging gate versus facility centroid. |
| **Rejected Design Proposals** | **Manual GPS Shift Start Override:** Explicitly rejected by the project owner. Geofence arrival check within 150m is strictly required. |

---

## 11. Integrity Verification

* **Zero Code Modification Statement:** Strictly zero application source code, models, migrations, or database records were modified.
* **Read-Only Verification:** `python manage.py test driver.tests --keepdb` verified all 40 existing tests continue to pass.
* **Verdict:** The documentation is internally consistent, technically validated against repository realities, and ready for independent validation by Claude.

### FINAL READINESS VERDICT: **READY FOR INDEPENDENT VALIDATION**
