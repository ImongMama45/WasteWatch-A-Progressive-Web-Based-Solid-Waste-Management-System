# WasteWatch Sanitation Team — Round 5B.2 Completion Report

**Project:** WasteWatch — A Progressive Web-Based Solid Waste Management System with Hotspot Mapping, Truck Tracking, and Route Optimization for Lucena City  
**Workspace:** `D:\Coding\Waste Watch`  
**Round:** Round 5B.2 — Remaining Worker, Allocation, Shift Lifecycle & Frontend Integration Remediation  
**Date (UTC):** 2026-11-19  
**Final Verdict:** **APPROVED WITH LIMITATIONS** *(All 32 Phase A confirmed defects and all Phase D Wave 1 findings are resolved, regression-tested, and independently approved in Wave 2 on SQLite + Node test runner + Vite production build; live PostgreSQL 14+ concurrency and migration execution remain unverified and the system is not declared production-ready until that PostgreSQL gate is executed.)*

---

## 1. Final Verdict & Summary

- **Verdict:** **APPROVED WITH LIMITATIONS**
- **Scope Completed:**
  - **Phase A (Parallel Read-Only Investigation & Planning):** Completed by Agents A–E, producing [WASTEWatch_SANITATION_TEAM_ROUND_5B2_INVESTIGATION_REPORT.md](file:///d:/Coding/Waste%20Watch/WASTEWatch_SANITATION_TEAM_ROUND_5B2_INVESTIGATION_REPORT.md) and [WASTEWatch_SANITATION_TEAM_ROUND_5B2_IMPLEMENTATION_PLAN.md](file:///d:/Coding/Waste%20Watch/WASTEWatch_SANITATION_TEAM_ROUND_5B2_IMPLEMENTATION_PLAN.md), identifying 32 deduplicated defects across B1 (10), B2 (9), B3 (7), and B4 (6) and defining a 12-level canonical lock hierarchy with **zero new database migrations**.
  - **Phase B & Phase C (Controlled Implementation & Focused Verification):** Implemented all 32 confirmed defects across backend and frontend without introducing unapproved business policies, and verified across the 17-module focused backend regression batch (`206/207` passed, `1` PostgreSQL-only skip), `makemigrations --check --dry-run` (`No changes detected`), 22 frontend `node --test` suites (`413/413` passed), and `npm run build` (`2054 modules`).
  - **Phase D Wave 1 (Independent Review & Adversarial Challenge):** Independent Reviewers 1–3, Challenger, and Forensic Auditor inspected the codebase and ran empirical probes (`Forensic Auditor` returned `CLEAN`; Reviewers 1–3 and Challenger surfaced 2 High, 6 Medium, and 3 Low findings).
  - **Phase D Remediation & Wave 2 Re-Verification:** All Wave 1 findings were remediated, regression-tested (`70/70` runnable tests in the 6-module post-remediation batch + `413/413` frontend tests + `vite build`), and independently re-verified by Wave 2 Reviewers 1–3 and Wave 2 Adversarial Challenger & Victory Auditor, who unanimously returned **`APPROVE` / `VICTORY CONFIRMED`** with zero remaining Critical, High, Medium, or Low defects in the implemented scope.

---

## 2. Phase A Findings & Implementation Decisions

### 2.1 Canonical 12-Level Lock Hierarchy Enforced
All multi-lock transactional paths across `driver/`, `watcher/`, and `accounts/` now acquire `select_for_update()` locks strictly in ascending hierarchy order (and ascending primary-key `order_by('id')` order within each level), using `of=('self',)` whenever `select_for_update()` is combined with nullable `select_related` joins:

```text
Level 1:  CollectionSchedule (asc id)
Level 2:  SanitationTeam (asc id)
Level 3:  ScheduleTeamOverride (asc id)
Level 4:  ScheduleTruckAllocation (asc id)
Level 5:  Truck (asc id)
Level 6:  Worker (asc id, of=('self',))
Level 7:  SanitationTeamMembership (asc id, of=('self',))
Level 8:  DriverShift (asc id, of=('self',))
Level 9:  CrewShift (asc id)
Level 10: WatcherShift (asc id, of=('self',))
Level 11: TruckReplacementRequest (asc id, of=('self',))
Level 12: CrewAttendanceRecord (asc id, of=('self',))
```

### 2.2 Technical Resolutions Without New Migrations or Unapproved Policies
1. **Audit Trail (`B1-04`, `B1-06`):** Used the existing `analytics.ActivityLog` model (`module='Teams'` and `module='Workers'`) to audit `TEAM_MEMBER_ASSIGNED`, `TEAM_MEMBER_TRANSFERRED`, `TEAM_MEMBER_DEACTIVATED`, `WORKER_MERGED`, and `WORKER_EMPLOYEE_ID_UPDATED` with zero schema changes.
2. **`CollectionSchedule.save()` & `sync_pickup_statuses()` (`B2-08`):** Skipped `sync_pickup_statuses()` when `update_fields` excludes `{'waypoints', 'driver', 'days', 'date', 'status'}`; wrapped `ensure_stop_validations_for_schedule(self)` in a nested `with transaction.atomic():` savepoint to prevent PostgreSQL `InFailedSqlTransaction`; and skipped legacy `PickupStatus` creation when `self.driver_id is None`.
3. **Prior-Date Orphaned `CrewShift` Cleanup (`B3-01`):** Extended `ShiftService.cleanup_stale_unlinked_watcher_shifts()` (invoked by `sweep_stale_shifts` and `WatcherShiftViewSet.{current, start_shift}`) to close prior-date (`service_date < today`) `CrewShift(driver_shift__isnull=True, is_active=True)` rows and their linked prior-date `WatcherShift` (`end_reason='stale_unlinked_cleanup'`), while preserving same-day shifts and immutable `CrewAttendanceRecord` / `ShiftCrewRosterSnapshot` rows.

---

## 3. Exact Files Changed and Purpose

### 3.1 Backend Production Files
| File | Purpose of Changes |
| :--- | :--- |
| [team_service.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/team_service.py) | Enforced `linked_user.is_active` in `_validate_worker_role_eligibility` (`B1-01`); enforced `worker.is_active` under lock in `transfer_member` (`B1-02`); required non-null `created_by`/`authorized_by` (`B1-06`); added `_record_team_audit_log` (`B1-06`); added `Q(snapshot__crew_shift__driver_shift__is_active=True)` and `exclude_driver_shift_schedule_id` to `is_worker_on_active_shift` (`B1-09`, `D-L2`). |
| [worker_service.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/worker_service.py) | Hardened `merge_workers` (`B1-04`, `D-M2`) with `source_worker.is_active` check, canonical `SanitationTeam (2) -> Worker (6, of=('self',)) -> SanitationTeamMembership (7, of=('self',))` locking + 3-attempt retry, `ActiveShiftConflictError` on source & target, distinct-user rejection, role-eligibility validation on both carried-over source memberships and existing target memberships after user transfer, history-preserving deactivation (`left_at=now`), and `WORKER_MERGED` / `WORKER_EMPLOYEE_ID_UPDATED` `ActivityLog` auditing. |
| [allocation_service.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/allocation_service.py) | Added `team__is_active=True` to `get_preallocated_truck_for_driver` (`B1-09`); added `CrewShift(allocation=...)` protection to `allocate_truck_for_schedule`, `update_truck_allocation`, and `delete_truck_allocation` (`B2-01`); added post-lock `schedule_id`/`truck_id` revalidation + 3-attempt retry and idle `truck.op_status='AVAILABLE'` release (`B2-02`, `B2-07`, `D-H1`); added past-date, target-date, `CANCELLED`/`COMPLETED`, `CrewShift`, and conflicting allocation guards + canonical `1 -> 2 -> 3` lock order to `create_schedule_override` and `update_schedule_override` (`B2-04`, `B2-05`). |
| [truck_service.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/truck_service.py) | Updated `replace_truck_assignment` (`B2-01`, `B2-06`, `B2-07`, `D-M4`) to reject `CANCELLED`/`COMPLETED` schedules (`code='schedule_not_active'`), check `CrewShift(allocation=existing_alloc)`, validate `old_truck` ownership/active-shift/facility isolation/driver capacity, revert idle `old_truck.op_status` to `'AVAILABLE'`, and lock `TruckReplacementRequest` (`of=('self',)`) at Level 11 without wildcard `schedule__isnull=True` matching; hardened `request_truck_replacement` against retired/uncommissioned trucks, invalid `schedule_id`, and cross-schedule spoofing. |
| [shift_service.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/shift_service.py) | Extended `cleanup_stale_unlinked_watcher_shifts` to close prior-date orphaned `CrewShift` rows (`B3-01`); enforced canonical `1 -> 2 -> 4 -> 6 -> 7 -> 8 -> 9 -> 10` locking, `CANCELLED`/`COMPLETED`/`is_available=False` rejection, active worker/user filtering, and `is_worker_on_active_shift` conflict checks (on both snapshot and non-snapshot paths with `exclude_driver_shift_schedule_id=schedule.id`) in `record_deployment_attendance` (`B1-03`, `B3-03`, `D-H2`, `D-M5`); added `exclude_driver_shift_schedule_id=schedule.id`, active crew validation, and `existing_crew_shift` team/leader verification in `stage_and_start_shift` (`B1-03`, `B3-06`); added `of=('self',)` in `correct_attendance` (`B3-05`). |
| [models.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py) | Added `SanitationTeamMembership.clean()` (`B1-06`); updated `CollectionSchedule.save()` and `sync_pickup_statuses()` (`B2-08`) to skip irrelevant `update_fields`, wrap `ensure_stop_validations_for_schedule` in a savepoint, and skip legacy `PickupStatus` creation when `driver_id is None`. |
| [serializers.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/serializers.py) | Exposed `worker_system_role` and `worker_employee_type` on `SanitationTeamMembershipSerializer` and returned `system_role=None, employee_type=None` for unlinked crew in `SanitationTeamSerializer._serialize_member` (`B1-07`). |
| [views.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/views.py) | Hardened `WorkerViewSet`, `SanitationTeamViewSet`, and `SanitationTeamMembershipViewSet` (`B1-05`, `B1-10`, `D-M3`); hardened `CollectionScheduleViewSet.{destroy, resolve_team, allocate_truck, get_queryset}` (`B2-03`, `B2-04`, `B2-07`, `B4-03`); removed outer `ScheduleTruckAllocation` lock from `ScheduleTruckAllocationViewSet.{update, destroy}` (`D-H1`); fixed `TruckReplacementRequestViewSet.{get_queryset, approve, reject}` (`B2-06`, `B2-07`, `D-L1`); unified `DriverShiftViewSet.{pre_start_shift, start_shift}` locking and revalidation (`B3-04`); fixed `WatcherShiftViewSet.start_shift` canonical lock order and `is_worker_on_active_shift` check (`B3-02`, `D-L2`); mapped `ActiveShiftConflictError` to 409 in `DriverShiftViewSet.attendance` (`D-M5`); protected `dev_reset` from deleting snapshot/attendance-backed shifts (`B3-07`); updated `shift_status`, `_check_home_base_proximity`, `HomeBaseView.put`, and `_resolve_driver_today_schedule` (`B2-09`, `B4-03`). |
| [views.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/views.py) | Filtered inactive workers/users out of `_build_watcher_deployment_detail` (`B1-03`); rejected `CANCELLED`/`COMPLETED`/`is_available=False` schedules in `_resolve_watcher_deployment_context(..., require_dispatchable=True)` and mapped `ActiveShiftConflictError` to HTTP 409 in `WatcherCrewAttendanceSubmitView.post` (`D-H2`, `D-M5`). |
| [api_views.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/accounts/api_views.py) & [serializers.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/accounts/serializers.py) | Added `Worker` and `SanitationTeamMembership` (`select_for_update(of=('self',))`) locking and `ActiveShiftConflictError` (`409`) / `ProtectedError` (`409`) guards in `AdminUserSerializer.update` and `UserViewSet.{update, partial_update, destroy}` (`B1-08`, `D-M1`). |
| [sweep_stale_shifts.py](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/management/commands/sweep_stale_shifts.py) | Invoked `ShiftService.cleanup_stale_unlinked_watcher_shifts()` during stale shift sweeps (`B3-01`). |

### 3.2 Frontend Production Files
| File | Purpose of Changes |
| :--- | :--- |
| [AssignmentModule.jsx](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/driver/components/AssignmentModule.jsx) | Added `getPreallocatedTruck(schedule.id)` lookup, `Truck Allocation Required` error card, `#start-duty-btn` readiness gating, `allocation_id` submission to `pre_start/`, `ww_shift_updated` dispatch, and `getApiErrorMessage` error formatting (`B4-01`). |
| [CheckInModule.jsx](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/driver/components/CheckInModule.jsx) | Removed bare `startShift()` and dead `ww_shift_start_*` `localStorage` usage; submitted `schedule_id` + `allocation_id` to `start/`; synced timer via `syncShiftPayload` / `refreshShiftTimer` (`B4-02`). |
| [DriverDashboard.jsx](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/dashboard/DriverDashboard.jsx) | Added `allocationLoading`, `allocationError`, and `starting` guards; unified `isStartBlocked`, `isCtaDisabled`, and `ctaLabel` across `#driver-main-cta` (mobile) and `#driver-desktop-cta` (desktop); rendered `#driver-allocation-summary` and `#driver-allocation-error` outside `.status-card-mobile-only` (`B4-04`, `D-M6`). |
| [useShiftTimer.js](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/hooks/useShiftTimer.js) | Added `allocationId` state tracking, exported `syncShiftPayload`, and blocked bare `startShift()` calls when both `scheduleId` and `allocationId` are null (`B4-05`). |
| [driverSchedule.js](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/utils/driverSchedule.js) & [RouteOverview.jsx](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/driver/RouteOverview.jsx) | Removed legacy `String(s.driver) === String(userId)` client-side filtering so team/override/allocation schedules (`s.driver === null`) resolve properly (`B4-03`). |
| [NavigateToBaseModule.jsx](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/driver/components/NavigateToBaseModule.jsx) & [EndShiftModule.jsx](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/driver/components/EndShiftModule.jsx) | Resolved schedule base origin/return from `dumpsite_detail` via `routeBaseHelpers.js` before falling back to `waypoints[0]`; removed comment emoji `🏠` from `EndShiftModule.jsx:11` (`B2-09`, `D-L3`). |
| [TeamManagement.jsx](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/admin/TeamManagement.jsx) | Wired `worker_system_role` and `worker_employee_type` into Tab 2 transfer modal state (`B1-07`). |

### 3.3 Backend & Frontend Test Files Updated/Added
- Backend: `wastewatch/backend/accounts/tests.py`, `driver/tests/test_allocation_service.py`, `driver/tests/test_critical_invariants.py`, `driver/tests/test_pg_concurrency.py`, `driver/tests/test_schedule_api.py`, `driver/tests/test_shift_attendance_workflow.py`, `driver/tests/test_shift_lifecycle.py`, `driver/tests/test_shift_schedule_guards.py`, `driver/tests/test_team_fleet_operational_closure.py`, `driver/tests/test_team_leader_attendance.py`, `driver/tests/test_team_management.py`, `driver/tests/test_truck_retirement_closure_and_authz.py`, `driver/tests/test_worker_foundation.py`.
- Frontend: `wastewatch/frontend/src/utils/__tests__/driverSchedule.test.js`, `wastewatch/frontend/src/pages/driver/__tests__/allocationShiftFlow.test.js`.

---

## 4. Focused Tests Run and Actual Results

1. **Phase C Full 17-Module Focused Backend Regression Batch (SQLite In-Memory):**
   - **Command (`D:\Coding\Waste Watch\wastewatch\backend`):**
     ```powershell
     .\venv\Scripts\python.exe manage.py test driver.tests.test_worker_foundation driver.tests.test_team_management driver.tests.test_team_leader_attendance driver.tests.test_allocation_service driver.tests.test_shift_lifecycle driver.tests.test_shift_attendance_workflow driver.tests.test_shift_schedule_guards driver.tests.test_shift_schedule_resolution driver.tests.test_critical_invariants driver.tests.test_team_fleet_operational_closure driver.tests.test_truck_lifecycle_stage1 driver.tests.test_truck_retirement_closure_and_authz driver.tests.test_operational_security driver.tests.test_schedule_api driver.tests.test_truck_api accounts.tests dumpsite.tests_facility_operations --verbosity=2
     ```
   - **Result:** Exit code `0` — `Ran 207 tests in 1133.010s — OK (skipped=1)` (`206` passed, `0` failures, `0` errors, `1` PostgreSQL-only skip: `test_postgres_security_definer_function_and_privilege_boundary`).

2. **Phase D Post-Remediation 5-Test Targeted Verification (SQLite In-Memory):**
   - **Command (`D:\Coding\Waste Watch\wastewatch\backend`):**
     ```powershell
     .\venv\Scripts\python.exe manage.py test driver.tests.test_allocation_service.AllocationServiceTestCase.test_delete_allocation_and_override_guards_and_idle_truck_release driver.tests.test_team_fleet_operational_closure.TeamFleetOperationalClosureTests.test_8_replacement_request_guards_approve_reject_of_self_and_old_truck_release driver.tests.test_team_fleet_operational_closure.TeamFleetOperationalClosureTests.test_replace_truck_assignment_rejects_cancelled_completed_and_queryset_uses_facility_trucks_q driver.tests.test_shift_attendance_workflow.ShiftAttendanceWorkflowTests.test_3_independent_shift_starts_and_no_fabricated_crew_shift driver.tests.test_shift_attendance_workflow.ShiftAttendanceWorkflowTests.test_15_active_shift_conflict_returns_409_on_both_initial_attendance_endpoints_and_watcher_start --verbosity=2
     ```
   - **Result:** Exit code `0` — `Ran 5 tests in 21.811s — OK` (`5` passed, `0` failures, `0` errors, `0` skipped).

3. **Phase D Post-Remediation 6-Module Backend Regression Batch (SQLite In-Memory):**
   - **Command (`D:\Coding\Waste Watch\wastewatch\backend`):**
     ```powershell
     .\venv\Scripts\python.exe manage.py test driver.tests.test_allocation_service driver.tests.test_shift_attendance_workflow driver.tests.test_worker_foundation driver.tests.test_team_fleet_operational_closure accounts.tests driver.tests.test_pg_concurrency --verbosity=2
     ```
   - **Result:** Exit code `0` — `Ran 70 tests in 260.187s — OK (skipped=3)` (`67` passed, `0` failures, `0` errors, `3` PostgreSQL-only two-connection barrier concurrency tests skipped on SQLite).

4. **Pending Migration Check (Read-Only Dry Run):**
   - **Command (`D:\Coding\Waste Watch\wastewatch\backend`):**
     ```powershell
     .\venv\Scripts\python.exe manage.py makemigrations --check --dry-run
     ```
   - **Result:** Exit code `0` — `No changes detected`.

5. **All Frontend `node --test` Suites (22 Files):**
   - **Command (`D:\Coding\Waste Watch`):**
     ```powershell
     $files = Get-ChildItem -Path wastewatch\frontend\src -Recurse -Filter "*.test.js" | ForEach-Object { $_.FullName }; node --test @files
     ```
   - **Result:** Exit code `0` — `tests 413, suites 51, pass 413, fail 0, cancelled 0, skipped 0, todo 0` (`duration_ms 7756.2254`).

6. **Frontend Production Build (`vite build`):**
   - **Command (`D:\Coding\Waste Watch\wastewatch\frontend`):**
     ```powershell
     npm run build
     ```
   - **Result:** Exit code `0` — `vite v5.4.21 building for production... ✓ 2054 modules transformed.`.

---

## 5. Independent Reviewer & Challenger Verdicts (Wave 1 vs. Wave 2)

| Review Role | Wave 1 Verdict | Wave 1 Findings | Wave 2 Verdict (Post-Remediation) |
| :--- | :--- | :--- | :--- |
| **Reviewer 1 — Backend Integrity (B1 & B2)** | `REQUEST_CHANGES` | 1 High (`D-H1`), 2 Medium (`D-M1`, `D-M2`), 1 Low (`D-L1`) | **`APPROVE`** (0C, 0H, 0M, 0L) |
| **Reviewer 2 — Shift Lifecycle & Concurrency (B3)** | `REQUEST_CHANGES` | 1 High (`D-H1`), 1 Medium (`D-M5`), 1 Low (`D-L2`) | **`APPROVE`** (0C, 0H, 0M, 0L) |
| **Reviewer 3 — Frontend & API Integration (B4)** | `REQUEST_CHANGES` | 0 High, 1 Medium (`D-M6`), 1 Low (`D-L3`) | **`APPROVE`** (0C, 0H, 0M, 0L) |
| **Adversarial Challenger & Victory Auditor** | `REQUEST_CHANGES` | 2 High (`D-H1`, `D-H2`), 2 Medium (`D-M3`, `D-M4`) | **`APPROVE / VICTORY CONFIRMED`** (0C, 0H, 0M, 0L) |
| **Forensic Auditor** | `CLEAN` | 0 findings | **`CLEAN`** |

---

## 6. Initial vs. Final Git Status Comparison & Migration Confirmation

- **Migration Preservation Confirmation:**
  - `git diff -- wastewatch/backend/driver/migrations/` returned empty output (exit code `0`).
  - All 15 staged driver migrations `0036_worker_legacycrewreconciliationaudit.py` through `0050_truck_records_and_fuel.py` (including `0047`, `0048`, and `0049`) remain untouched (`A ` in `git status --short`).
  - Zero new migrations were created and **no migrations were applied** (`python manage.py migrate` was never executed against `db.sqlite3`).
- **Workspace & Baseline Preservation:**
  - All pre-existing modified (`M` / `MM` / `AM`) and untracked (`??`) files from the initial baseline—including the Round 5B.1.2 changes (`driver/views.py` `my_team_roster`, `driver/tests/test_critical_invariants.py` `test_14` and `test_15`), `dumpsite/` changes, and `.unlighthouse/` / `unlighthouse.config.ts`—are preserved intact.
  - No `git add`, `git commit`, `git stash`, `git reset`, `git checkout`, `git clean`, or `git revert` commands were executed.

---

## 7. SQLite-Verified vs. PostgreSQL-Unverified Behavior

### Verified on SQLite + Source/Query Inspection + Node Test Runner
- Worker role/active eligibility (`B1-01`..`B1-10`), `merge_workers` active-shift/distinct-user/role-eligibility/history/audit rules, `SanitationTeamMembership.clean()`, and `WorkerViewSet` / `SanitationTeamViewSet` / `UserViewSet` mutation guards.
- Allocation lifecycle protections (`B2-01`..`B2-09`), including `CrewShift(allocation=...)` conflict blocks, past-date/cancelled-schedule/mismatched-team rejection, `CollectionSchedule.save()` savepoint and `driver=None` safety, idle truck `op_status='AVAILABLE'` release, and `TruckReplacementRequest` approval/rejection guards.
- Shift lifecycle & lock ordering (`B3-01`..`B3-07`), verified empirically by monkeypatching `QuerySet.select_for_update` to assert canonical acquisition order (`1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12`) and inspecting `qs.query.select_for_update_of == ('self',)` across nullable outer-join lock queries.
- Frontend allocation-aware shift staging and starting (`B4-01`..`B4-06`), desktop/mobile CTA parity (`#driver-main-cta` and `#driver-desktop-cta`), DRF field error surfacing, `s.driver === null` schedule resolution, dumpsite base resolution, and zero-emoji compliance.

### Unverified on SQLite (Requires Live PostgreSQL 14+ Verification)
- Execution of `python manage.py migrate` from scratch and through `0036`–`0050` against a live PostgreSQL 14+ engine (including PL/pgSQL `SECURITY DEFINER` functions and `BEFORE UPDATE OR DELETE` / `BEFORE TRUNCATE` triggers in `0042`–`0044` and `0050`).
- Live PostgreSQL `READ COMMITTED` multi-connection row-lock contention, deadlock absence, and partial unique index race handling across the 3 `@unittest.skipUnless(connection.vendor == 'postgresql', ...)` barrier tests in `driver/tests/test_pg_concurrency.py` and `test_postgres_security_definer_function_and_privilege_boundary` in `driver/tests/test_truck_lifecycle_stage1.py`.

---

## 8. Remaining Defects, Deferred Items & Owner Decisions

- **Remaining Defects in Round 5B.2 Scope:** **None** (0 Critical, 0 High, 0 Medium, 0 Low).
- **Deferred Out-of-Scope Observation (per Section 8 Exclusions):**
  - `TruckViewSet.audit_history` `ActivityLog` timestamp formatting (explicitly excluded by Section 8 of the Round 5B.2 prompt as not blocking any scoped workflow).
- **Safe Fail-Closed Boundaries Preserved Pending Optional Future Owner Policy Decisions (`OD-1`..`OD-4`):**
  1. **`OD-1` (`UserViewSet` role/active changes when user has an active `SanitationTeamMembership` outside an active shift):** Currently fails closed with HTTP `409 Conflict` requiring Admin to remove or transfer the Worker from their team first (rather than silently auto-deactivating team memberships).
  2. **`OD-2` (`TruckReplacementRequestViewSet.approve` when an allocation is already referenced by a `DriverShift`):** Currently fails closed with HTTP `409 Conflict` (`code='allocation_already_used'`, preserving Round 5B.1.2 `test_14` immutability) until the active shift is ended.
  3. **`OD-3` (Legacy test fixtures creating `CollectionSchedule` with `dumpsite=None`):** Runtime allocation and dispatch enforce explicit `Dumpsite` assignment while legacy non-dumpsite test fixtures remain compatible.
  4. **`OD-4` (`GET` permissions on `/api/driver/workers/`, `/api/driver/teams/`, `/api/driver/team-memberships/`):** Currently restricted to `IsOperationalStaffOrAdmin` (`admin`, `dumpsite`, `watcher`, `driver` — denying `citizen` and `brgy_official`).

---

## 9. Recommended Next Step

Execute a dedicated **PostgreSQL 14+ Staging & Concurrency Verification Gate** against an isolated PostgreSQL test database: run `python manage.py migrate` through `0050_truck_records_and_fuel` and execute `driver.tests.test_pg_concurrency` and `driver.tests.test_truck_lifecycle_stage1` on PostgreSQL to verify the 4 PostgreSQL-only tests (`test_pg_concurrent_*` and `test_postgres_security_definer_function_and_privilege_boundary`) under real PostgreSQL row locking and triggers.

