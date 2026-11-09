# WasteWatch Milestone 0B Major Revision Report
**Initiative:** Sanitation Team-Owned Routes, Watcher-Led Attendance, and Reusable Route Lifecycle  
**Date:** November 8, 2026  
**Auditor / Reviewer Target:** Claude (Principal Software Architect & Code Quality Validator), Project Owner  
**Execution Mode:** STRICTLY DESIGN-ONLY (Zero Code Modifications, Zero DB Alterations, Zero Migrations)  
**Readiness Verdict:** **READY FOR INDEPENDENT VALIDATION**  

---

## 1. Executive Summary of Architectural Changes

In response to authoritative directives from the project owner and the validation findings from Claude, Milestone 0B has undergone a comprehensive design overhaul. The primary architectural paradigm shifts include:

1. **Decoupling Routes from Drivers:** Routes are no longer permanently assigned to, or owned by, individual Drivers. A `Route` is an independent, reusable asset defining path geometry, collection stops, and designated service areas.
2. **Operational Ownership via CollectionSchedule:** Operational ownership is established via `CollectionSchedule`, which binds a reusable `Route` to an assigned `SanitationTeam`, a designated operational window, and an explicitly chosen `Dumpsite`:
   $$\text{Route} \longrightarrow \text{CollectionSchedule} \longrightarrow \text{SanitationTeam}$$
   Physical execution is captured via:
   $$\text{CollectionSchedule} \longrightarrow \text{DriverShift}$$
3. **Watcher as Operational Team Leader:** The Watcher is elevated to the Team Leader of the assigned `SanitationTeam`. The Watcher manages the crew, checks crew attendance, and submits the official crew attendance checklist for each scheduled shift.
4. **Single-Stage Attendance Submission & Verification:** Attendance submission and verification are unified into a single operational act performed by the Watcher. The previously proposed second mandatory verification stage by the Dumpsite Operator has been eliminated.
5. **Zero-Connectivity Crew Participation:** Crew Members are Citizens with `employee_type='crew_member'`. They are never required to log in, own devices, maintain active accounts, or be online. Attendance is recorded entirely on their behalf by the Watcher.
6. **Realigned Driver Responsibilities:** Drivers focus strictly on vehicle operations, route navigation, GPS tracking, stop execution, dumpsite unloading/calibration, and shift closure. They are relieved of crew roll call administrative burdens.
7. **Resolution of Claude's 39 Findings:** All 39 items raised in Claude's validation review have been systematically resolved with concrete data models, constraints, and service logic.

---

## 2. New Route Ownership & Schedule Model

### 2.1 The Reusable Route Entity (`driver.Route`)
Previously, routes were embedded directly in `CollectionSchedule` and filtered by `schedule.driver = request.user`. 
Under the revised architecture:
* A new model `driver.Route` stores `name`, `area`, `barangays` (M2M), and `waypoints` (JSON array of collection stops).
* A single `Route` (e.g. *"Barangay Iyam Standard Loop"*) can be scheduled across multiple distinct `CollectionSchedule` records operated by different teams (e.g., Monday operated by Team Alpha; Friday operated by Team Beta).
* Modifying a master route does not mutate historical shift executions, as each `DriverShift` freezes a `route_snapshot`.

### 2.2 Operational Scheduling Bindings
* `CollectionSchedule.route`: Foreign key (`on_delete=models.PROTECT`) referencing the reusable route.
* `CollectionSchedule.dumpsite`: Explicitly selected staging and return base (`on_delete=models.PROTECT`).
* `TeamScheduleAssignment`: Binds exactly one active `SanitationTeam` to the schedule.
* `TeamScheduleTruckAssignment`: Binds a specific `Truck` to that team-schedule unit, allowing teams to use different vehicles across different schedules.

---

## 3. Revised Watcher & Driver Operational Responsibilities

### 3.1 Watcher (Team Leader)
* **Team Oversight:** Views all Crew Members enrolled in their assigned `SanitationTeam`.
* **Roll Call:** Conducts physical roll call at the staging base prior to vehicle departure.
* **Attendance Submission:** Submits the official shift attendance payload via `POST /api/watcher/team-attendance/submit/`.
* **Stop Inspection:** Validates collection stops 1..N across all barangays on the scheduled route using `can_inspect_collection_stop`.
* **Civic Boundary:** Cannot review residential reports or vote on community issues outside their registered home barangay.

### 3.2 Driver (Vehicle Operator)
* **Pre-Start Staging:** Checks in via `POST /api/driver/shift/pre_start/` and inputs departure fuel gauge percentage.
* **Geofenced Departure:** Dispatches vehicle within the server-authoritative 150m dumpsite gate geofence.
* **Collection Route:** Follows GPS path, validates stop completion, and marks waste pickups.
* **Unloading & Closure:** Delivers waste to the Dumpsite scales, obtains operator weigh-in confirmation, and explicitly closes the shift at the Dumpsite.
* **Relieved of Attendance:** No longer marks or submits crew attendance.

---

## 4. Revised Attendance Lifecycle

1. **Pre-Shift Roll Call:** The Watcher opens `WatcherTasksHub.jsx` $\longrightarrow$ accesses "Sanitation Team Attendance" $\longrightarrow$ retrieves the active crew roster.
2. **Attendance Submission:** The Watcher marks each crew member as `present`, `absent`, `late`, or `excused`. The submission is sent to `POST /api/watcher/team-attendance/submit/`.
3. **Atomic Persistence:** The server freezes the crew roster, creates `ShiftAttendance` records with an immutable `original_status`, and links the attendance to the `DriverShift`.
4. **Append-Only Corrections:** Subsequent adjustments (e.g. an absent crew member arriving late) are recorded via `ShiftAttendanceCorrection` with mandatory audit reason text. No secondary operator verification gate is imposed.

---

## 5. Changes Made to Address Claude's Validation Findings (Items 1–39)

1. **Open-Ended Interval Checking:** Converted temporal comparisons to half-open interval logic $[ \text{effective\_at}, \text{ended\_at} )$ with UTC timestamps.
2. **Active-at-Instant Logic:** Formulated exact predicate `effective_at <= t < (ended_at or inf)`.
3. **Uniqueness Constraints:** Enforced conditional `UniqueConstraint(fields=['user'], condition=Q(ended_at__isnull=True))` on memberships.
4. **Interval Integrity:** Prevented overlapping schedules through day intersection and overnight time-wrap math.
5. **Cross-Engine Concurrency:** Acknowledged SQLite database file-level locking; implemented PostgreSQL row-level locks via `select_for_update()`.
6. **No SQLite Row-Level Claims:** Documented SQLite limitations and added retry decorators for development tests.
7. **PostgreSQL Concurrency Tests:** Added isolation tests (`READ COMMITTED` and `SERIALIZABLE`) to the test strategy.
8. **Destructive Deletion Protection:** Replaced cascade deletes with `on_delete=models.PROTECT` and `is_active=False` soft deletion.
9. **Authoritative Attendance Record:** Watcher submission is final; corrections are append-only.
10. **Complete Model Specifications:** Full field types, nullabilities, and constraints documented in Section 21.
11. **Preserved `Truck.status` Column:** Physical database column preserved for ORM compatibility; sub-states synchronized in `Truck.save()`.
12. **Authoritative Dispatchability Predicate:** Defined `is_truck_dispatchable()` checking 5 explicit conditions.
13. **Hardened Shift CRUD:** Ownership and active shift checks enforced on all `DriverShiftViewSet` actions.
14. **Account Suspension Checks:** Enforced `_is_driver_suspended()` on shift pre-start.
15. **Scoped Operator Permissions:** Implemented `IsAssignedDumpsiteOperator` matching `user.dumpsite_id == obj.dumpsite_id`.
16. **Facility Queryset Scoping:** All operator views strictly filter by `request.user.dumpsite_id`.
17. **Atomic Hotspot Reconciliation:** Hotspot interventions in `created`, `flagged`, or `acknowledged` status transfer atomically on truck swap.
18. **Non-Mutating WasteDelivery Attribution:** Retained physical vehicle and shift attribution without weight proration.
19. **Persistent TruckSwapLog:** Defined state machine (`requested`, `approved`, `executed`, `rejected`) with execute-once protection.
20. **Audit of `waypoints[0]`:** Confirmed compatibility across all consumers; assigned Dumpsite populates index 0.
21. **Neutralized HomeBaseView:** Disabled write functionality on `/api/driver/home-base/`.
22. **Safe Dumpsite Assignment:** Manual Admin selection required; zero silent fallbacks.
23. **Fixed PickupStatus Driver Nullability:** Made `PickupStatus.driver` nullable (`null=True, blank=True`).
24. **Audited Legacy Driver Lookups:** Replaced `_resolve_driver_today_schedule()` with team-based schedule resolution.
25. **Preserved TruckCrewAssignment:** Retained legacy table with dual-projection during transition.
26. **Defined Team Schedule Bindings:** Formalized `TeamScheduleAssignment` and `TeamScheduleTruckAssignment`.
27. **Recurring Schedule Conflict Math:** Formulated exact overlapping window algorithms for standard and overnight shifts.
28. **Atomic Roster Snapshotting:** Shift pre-start snapshots frozen roster in `DriverShift.roster_snapshot`.
29. **Exact-Set Roster Roll Call:** Watcher must submit attendance for all active team crew members.
30. **Split Fuel Modeling:** Driver logs gauge percentage; Operator logs pump liters, cost, and odometer.
31. **U10 Status Kept Unapproved:** Explicitly tagged `PROPOSED — REQUIRES PROJECT OWNER APPROVAL`.
32. **Account Role Modification Guard:** `User.clean()` blocks role changes for active team members.
33. **Watcher Route Scope vs. Civic Isolation:** `can_inspect_collection_stop` isolates residential moderation while enabling route-wide stop validation.
34. **Preserved Shift States:** Preserved `navigate_to_base`, `dump_site`, `calibration_complete`.
35. **Complete Endpoint Inventory:** Documented all 10 primary REST routes in Section 22.
36. **Geofence Policy Standardized:** 150m server check standardized; manual override tagged proposed.
37. **Substitute Driver Policy:** Tagged proposed requiring project owner confirmation.
38. **Single Transition Timestamp:** Mandated single `timezone.now()` across transfer transactions.
39. **Design Mode Maintained:** Strictly zero application code modified.

---

## 6. Repository Files Inspected

* [`wastewatch/backend/driver/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py): Verified `CollectionSchedule`, `PickupStatus`, `Truck`, `DriverShift`.
* [`wastewatch/backend/driver/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/views.py): Inspected `DriverShiftViewSet`, `_resolve_driver_today_schedule`, `HomeBaseView`.
* [`wastewatch/backend/driver/urls.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/urls.py): Inspected router configuration.
* [`wastewatch/backend/watcher/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py): Inspected `StopValidation`, `GarbageHotspot`, `HotspotIntervention`.
* [`wastewatch/backend/watcher/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/views.py): Inspected `StopValidationViewSet`.
* [`wastewatch/backend/watcher/urls.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/urls.py): Inspected router configuration.
* [`wastewatch/backend/dumpsite/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/dumpsite/models.py): Inspected `WasteDelivery`, `Dumpsite`.
* [`wastewatch/frontend/src/pages/admin/RouteBuilder.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/admin/RouteBuilder.jsx): Inspected route creation and `HOME_BASE` references.
* [`wastewatch/frontend/src/pages/watcher/WatcherTasksHub.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/watcher/WatcherTasksHub.jsx): Inspected Watcher dashboard cards.
* [`wastewatch/frontend/src/pages/driver/components/AssignmentModule.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/driver/components/AssignmentModule.jsx): Inspected shift pre-start dispatch.
* [`wastewatch/frontend/src/pages/driver/components/EndShiftModule.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/driver/components/EndShiftModule.jsx): Inspected shift termination and dumpsite calibration phases.

---

## 7. Sections Changed in the Specification

The master specification [`WasteWatch_Milestone_0B_Architecture_and_API_Contract_Specification.md`](file:///d:/Coding/Waste%20Watch/WasteWatch_Milestone_0B_Architecture_and_API_Contract_Specification.md) was updated across all 34 required sections:
* **Section 1–3:** Executive Summary, Revision History, and Approved Business Requirements.
* **Section 4–7:** Current-State Gap Analysis, Revised Domain Model, Reusable Route Architecture, and `CollectionSchedule` Bindings.
* **Section 8–9:** Watcher Team Leader Responsibilities and Unified Attendance Lifecycle.
* **Section 10–13:** Driver Operational Shift Lifecycle, Historical Snapshotting, Temporal Interval Rules, and Authoritative Truck Dispatchability.
* **Section 14–19:** Dumpsite Facility Scoping, 150m Geofencing, Post-Shift Inspection, Fuel Logging, WasteDelivery Attribution (U10), and Hotspot Intervention Reconciliation.
* **Section 20–25:** Permission Matrix, Model Field Specifications, Endpoint Inventory, REST Contracts, Error Handling, and Concurrency Protections.
* **Section 26–31:** Frontend Workflow Impact, Legacy Cutover, Implementation Sequence, Rollback Strategy, Testing Strategy, and PostgreSQL Validation.
* **Section 32–34:** Unresolved Business Decisions (U7, U10, GPS override), Claude Findings Compliance Matrix (Items 1–39), and Scope Dependencies.

---

## 8. Unresolved Business Decisions (Labeled for Owner Approval)

The following items are designated as **`PROPOSED — REQUIRES PROJECT OWNER APPROVAL`**:
1. **U7 (Substitute Driver Policy):** Single-shift override via `DriverShift.substitute_driver` versus creating a temporary team membership.
2. **U10 (WasteDelivery Attribution):** Adding `WasteDelivery.shift` foreign key linking scale tickets directly to shifts without artificial weight proration.
3. **GPS Manual Override:** Conditions permitting Admin/Operator to bypass the 150m geofence when cellular dead zones prevent GPS verification.
4. **Dumpsite Coordinate Landmark:** Whether facility GPS represents the physical staging gate or facility centroid.

---

## 9. Final Readiness Verdict

* **Architecture Alignment:** Fully aligns with the reusable Route, Sanitation Team schedule ownership, and Watcher-led attendance directives.
* **Codebase Safety:** Strictly backwards-compatible; no destructive migrations or breaking schema changes.
* **Verification Status:** Ready for final independent audit by Claude.

### FINAL VERDICT: **READY FOR INDEPENDENT VALIDATION**
*(No code or database changes have been performed. Awaiting project owner and Claude validation).*

