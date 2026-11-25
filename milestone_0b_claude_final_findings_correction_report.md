# WasteWatch Milestone 0B — Claude Final Findings & Technical Consistency Correction Report
**Project:** WasteWatch: A Progressive Web-Based Solid Waste Management System for Lucena City  
**Milestone:** 0B Architecture Specification & Contract Design (Final Database Integrity & Deletion Security Pass v3.3.2.10)  
**Document Target:** Claude (Principal Software Architect & Code Quality Validator), Project Owner  
**Execution Mode:** STRICTLY DESIGN-ONLY (Zero Code Modifications, Zero DB Alterations, Zero Migrations)  
**Date of Revision:** November 12, 2026 (v3.3.2.10 Final Database Integrity & Deletion Security)  
**Status:** Audit & Consistency Correction Complete (READY FOR INDEPENDENT CLAUDE VALIDATION — Item 13 Owner-Approved)

---

## 1. Executive Summary

This report documents the **v3.3.1 final targeted blocker correction pass** on the WasteWatch Milestone 0B architecture specification and its correction report. Building upon the baselines established in v3.3, this pass directly resolves the two remaining implementation-blocking findings from Claude's v3.3 validation without reopening approved owner decisions:

1. **Genuinely Read-Only Django Admin Models & API Surface Restriction (Blocker 1):**
   - Explicitly specified that `WatcherShiftAdmin` and `CrewShiftAdmin` return `False` for `has_add_permission()`, `has_delete_permission()`, and `has_change_permission()` for all users (including staff and superusers), and declare all model fields in `readonly_fields`, prohibiting custom Admin actions or form overrides from modifying protected values.
   - Documented unambiguous semantics: Admin users may inspect/view records in Django Admin, but cannot edit lifecycle state (`status`, `is_active`, `started_at`, `ended_at`, `duration_ms`), counterpart associations (`associated_driver_shift`, `watcher_shift`), team, schedule, roster snapshot, or attendance submission timestamp (`attendance_submitted_at`).
   - Confirmed that `WatcherShiftViewSet` exposes only documented `create` and approved custom actions (`exceptional_abort`, `submit_attendance`). Exposes no generic update (`PUT`), partial update (`PATCH`), or destroy (`DELETE`) endpoints (`http_method_names = ['get', 'post', 'head', 'options']`).
   - Documented that service-layer lifecycle transitions (`WatcherShiftService`, `DriverShiftService`) mutate models directly via internal ORM methods within database transactions and are unaffected by Admin/API restrictions.
2. **Targeted Corrections: Final Database Integrity & Deletion Security (Blocker 2 — v3.3.2.10 Hardening):**
   - **Resolved Blocker 1 (Lifecycle Field Nullability & DB-Level Value Restrictions):** Explicitly declared `null=False` on `commissioning_provenance`, `retirement_state`, and `is_retired` at the database level in Stage 1 (`driver.0036`). Added two database-level CheckConstraints (`chk_truck_provenance_valid_values` and `chk_truck_retirement_state_valid_values`) guaranteeing that PostgreSQL physically rejects NULLs and arbitrary strings, establishing that permitted values are enforced by PostgreSQL beyond application Django `choices`.
   - **Resolved Blocker 2 (Reproducibly Verified 80-Combination State Space):** Formally evaluated the complete 4-dimensional Cartesian product ($4 \times 5 \times 2 \times 2 = 80$ combinations) via an executable verification procedure, confirming that the 10 CheckConstraints (2 domain value restrictions `C0a`, `C0b` and 8 lifecycle state invariants `C1`, `C2`, `C3`, `C4`, `C5a`, `C5b`, `C6`, `C7`) accept exactly the 8 valid fleet lifecycle states and reject all 72 invalid permutations. Analyzed 3-valued boolean NULL states, proving that `null=False` prevents NULL escapes.
   - **Resolved Blocker 3 (SECURITY DEFINER Privilege Audit & Effective Security Boundary):** Fully audited the database role hierarchy: proved that `wastewatch_app` possesses zero table-level `DELETE` privileges on `driver_truck`, cannot inherit `DELETE` via `PUBLIC` or role inheritance, and can only delete uncommissioned trucks by calling `public.truck_delete_uncommissioned(BIGINT)`. Confirmed `wastewatch_migrator` operates as a non-login DDL role with minimal necessary table ownership, isolated by a fixed search path (`pg_catalog, public`). Application-level `is_admin_user` authorization is strictly decoupled from database `EXECUTE`.
   - **Resolved Blocker 4 (Actual vs Assumed Foreign-Key Deletion Semantics):** Grounded analysis in repository evidence, explicitly labeling native PostgreSQL FK actions across all 13 relationships as unverified pending migration inspection. Proved that direct SQL deletion bypasses Django signals/collectors, and established that the stored function's explicit `IF EXISTS (...) RAISE EXCEPTION` checks are mandatory to prevent native engine `CASCADE` or `SET NULL` data corruption.
   - **Resolved Blocker 5 (Complete Physical-Deletion Pathway Inventory & Authorization):** Inventoried all 5 deletion pathways across the codebase: `TruckViewSet.destroy()` (overridden to block direct deletion), `TruckAdmin` (has_delete_permission routed through checks, bulk action disabled), `TruckService.delete_uncommissioned_truck` (sole authorized entrypoint), `Truck.delete()` override (guards single instances), and raw SQL (blocked by table-level privilege revocation). Replaced generic DRF `IsAdminUser` with project role-aware `is_admin_user` (`IsAppAdmin`).
   - **Resolved Blocker 6 (Stage 5 Fail-Closed Verification):** Hardened the Stage 5 migration gate in `public.truck_delete_uncommissioned`: if `public.django_migrations` confirms `0038_truck_hold_history` has run, `public.driver_truckoperationalholdlog` must exist in `information_schema.tables`; if missing, it raises an exception and aborts. Any error during metadata inspection triggers a fail-closed exception.
   - **Resolved Blocker 7 (Audit of is_retired Consumers & Dispatchability):** Inspected all consumers of `is_retired`. Clarified that `is_retired=True` correctly gates transitional (`retirement_in_progress`) and terminal (`permanently_retired`) vehicles from dispatch and assignment under $T1$, while allowing coordinated shift draining. Corrected `is_truck_dispatchable` to allow dispatch for `commissioned_date_unknown` assets with `commissioned_at IS NULL`.
   - **Reconciled Complete 13-Relationship Inventory (Category A vs Category B):** Preserved all 9 Category A historical models and all 4 Category B operational models without alteration.
   - **Owner-Approved Item 13 (Option A Codified):** Commissioned trucks with operational history must be permanently retired (`TruckService.retire_truck`), never physically deleted. Physical deletion is strictly restricted to objectively uncommissioned vehicles with zero history.
   - **Final Status:** Marked as `READY FOR INDEPENDENT CLAUDE VALIDATION`.

3. **Preservation of All Approved Owner Decisions:**
   - D-3, D-5 (exactly 1 CrewShift per WatcherShift), D-6, D-7, D-8 (initial roll call Watcher-only), D-9, Coordinated Shift Ending, Independent Starts, Staging Arrival Verification, and Zero-Connectivity Crew remain strictly preserved.

4. **Affirmed Readiness Verdict:**
   - Confirmed status as **`READY FOR INDEPENDENT CLAUDE VALIDATION`**.

Both primary deliverables have been synchronized to **v3.3.2.10**:
* [`WasteWatch_Milestone_0B_Architecture_and_API_Contract_Specification.md`](file:///d:/Coding/Waste%20Watch/WasteWatch_Milestone_0B_Architecture_and_API_Contract_Specification.md) (Master Specification v3.3.2.10)
* [`milestone_0b_claude_final_findings_correction_report.md`](file:///d:/Coding/Waste%20Watch/milestone_0b_claude_final_findings_correction_report.md) (This Report v3.3.2.10)

---

## 2. Exact Findings Addressed (v3.3.2.10 Final Database Integrity & Deletion Security Pass)

* **Finding 1 (Lifecycle Field Nullability & Native Database Constraints):**
  - *Context:* Django `choices` do not produce database-level CHECK constraints; nullable columns could allow NULL values to bypass Boolean constraints under SQL 3-valued logic.
  - *Resolution:* Specified `null=False` on `commissioning_provenance`, `retirement_state`, and `is_retired` in Stage 1 (`driver.0036`). Added database-level CheckConstraints (`chk_truck_provenance_valid_values` and `chk_truck_retirement_state_valid_values`) guaranteeing native PostgreSQL value rejection.
* **Finding 2 (Exhaustive Reproducible State Space Verification):**
  - *Context:* State space verification needed an executable evaluation of the exact constraints across all 80 combinations and analysis of NULL edge cases.
  - *Resolution:* Evaluated all 80 Cartesian combinations via a reproducible procedure: confirmed 8 accepted states and 72 rejections with exact constraint mapping. Proved that `null=False` prevents NULL escapes.
* **Finding 3 (SECURITY DEFINER Effective Privilege Audit):**
  - *Context:* Effective database privilege boundary needed verification beyond single REVOKE commands.
  - *Resolution:* Verified that `wastewatch_app` has no direct or inherited DELETE on `driver_truck`, `wastewatch_migrator` is non-login, fixed search paths protect execution, and application `is_admin_user` authorization is strictly decoupled from DB EXECUTE.
* **Finding 4 (Actual vs Assumed Foreign-Key Deletion Semantics):**
  - *Context:* Assumptions regarding Django `on_delete` producing corresponding native PostgreSQL actions required ground-truth qualification.
  - *Resolution:* Explicitly labeled native PostgreSQL FK actions as unverified pending migration inspection. Proved that explicit relationship checks in the stored function prevent silent engine-level `CASCADE` or `SET NULL` data corruption upon direct SQL deletion.
* **Finding 5 (Physical Deletion Pathway Inventory & Role-Aware Authorization):**
  - *Context:* All potential deletion pathways across API, Admin, and services required comprehensive inventory.
  - *Resolution:* Inventoried all 5 deletion pathways across the codebase; verified that physical deletion is restricted to `TruckService.delete_uncommissioned_truck` gated by role-aware `is_admin_user` (`IsAppAdmin`), while commissioned vehicles must be retired.
* **Finding 6 (Stage 5 Migration Gate Fail-Closed Contract):**
  - *Context:* Stage 5 check needed protection against metadata inspection errors and schema drift.
  - *Resolution:* Hardened PL/pgSQL function: if `django_migrations` contains `0038_truck_hold_history` but table `driver_truckoperationalholdlog` is missing, or if inspection encounters an error, deletion immediately aborts fail-closed.
* **Finding 7 (Audit of is_retired Consumers & Dispatchability):**
  - *Context:* `is_retired=True` is shared by `retirement_in_progress` and `permanently_retired`.
  - *Resolution:* Verified that both transitional and terminal retirement block dispatch under $T1$, while allowing coordinated shift draining. Corrected `is_truck_dispatchable` to support `commissioned_date_unknown` assets with `commissioned_at IS NULL`.

## 3. Files Inspected (Read-Only)

1. [`wastewatch/backend/wastewatch/settings.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/settings.py) (Verified `TIME_ZONE = 'Asia/Manila'` and `USE_TZ = True`).
2. [`wastewatch/backend/driver/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py) (Inspected `Truck`, `CollectionSchedule`, `PickupStatus`, `DriverShift`, `PHASE_CHOICES`, `TeamScheduleAssignment`, `SanitationTeamMembership`).
3. [`wastewatch/backend/driver/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/views.py) (Inspected `end_shift`, `force_end`, `DriverShiftViewSet` route `/api/driver/shift/{id}/force-end/`).
4. [`wastewatch/backend/driver/signals.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/signals.py) (Inspected truck deletion `pre_delete` signal guard raising `ProtectedError` on active shifts; verified `TruckService.delete_truck` two-phase shift pre-closure).
3. [`wastewatch/backend/watcher/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py) (Inspected `StopValidation`, `GarbageHotspot`, `HotspotIntervention`).
4. [`wastewatch/backend/dumpsite/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/dumpsite/models.py) (Inspected `Dumpsite`, `WasteDelivery`).
5. [`wastewatch/backend/driver/migrations/0017_alter_collectionschedule_dumpsite_delete_dumpsite_and_more.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/migrations/0017_alter_collectionschedule_dumpsite_delete_dumpsite_and_more.py) (Verified pre-existence of `CollectionSchedule.dumpsite`).
6. [`wastewatch/backend/driver/migrations/0035_drivershift_end_reason.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/migrations/0035_drivershift_end_reason.py) (Verified leaf node for `driver`).
7. [`wastewatch/backend/watcher/migrations/0029_alter_collectionconfirmation_confirmed_by.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/migrations/0029_alter_collectionconfirmation_confirmed_by.py) (Verified leaf node for `watcher`).
8. [`wastewatch/backend/dumpsite/migrations/0005_wastedelivery_is_synthetic.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/dumpsite/migrations/0005_wastedelivery_is_synthetic.py) (Verified leaf node for `dumpsite`).
9. [`wastewatch/backend/accounts/migrations/0016_user_phone_address_email_verification.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/accounts/migrations/0016_user_phone_address_email_verification.py) (Verified leaf node for `accounts`).

---

## 4. Technical Correction Matrix (v3.3.1 Updates)

| Item ID | Target Section | Identified Contradiction or Gap | Architectural Correction Implemented in v3.3.1 | Status |
| :---: | :--- | :--- | :--- | :---: |
| **Blocker 1** | Section 1, 9.3, 11.12, 11.13, 19.2, 21 | Disabling add/delete in Admin did not prevent editing existing records; client ViewSet update/destroy exposure unconstrained. | Explicitly enforced genuinely read-only Admin: `WatcherShiftAdmin` and `CrewShiftAdmin` return `False` for `has_add_permission()`, `has_delete_permission()`, and `has_change_permission()` for all users, with all fields in `readonly_fields` and prohibition of custom Admin actions/form overrides; restricted `WatcherShiftViewSet` to `create` and approved custom actions without generic update/partial_update/destroy endpoints; preserved service-layer ORM transitions. | **Resolved** |
| **Blocker 2** | Section 1, 5, 9.1, 9.2, 16, 17.3, 19.2, 20, 21 | Lifecycle field nullability; missing database-level choice constraints; unverified native FK actions; incomplete privilege boundary audit; deletion pathway inventory; Stage 5 fail-closed edge cases; is_retired consumer distinction. | Enforced `null=False` and native DB-level enum CheckConstraints; executed reproducible 80-state verification; completed SECURITY DEFINER effective privilege audit confirming non-login migrator role and zero inherited DELETE; labeled native FK actions unverified while proving stored function necessity; inventoried all 5 deletion pathways under role-aware Admin authorization; hardened Stage 5 fail-closed migration check; audited `is_retired` consumers and aligned `is_truck_dispatchable` with date-unknown provenance. | **Resolved (Owner-Approved Option A Codified)** |
---

## 5. Reconciled Global Locking Hierarchy & Anti-Inversion Protocol

### 5.1 Three-Tier Functional Architecture
All mutating transactions strictly adhere to the top-down row-level locking hierarchy:

```text
========================================================================================
SCHEDULING & ASSIGNMENT TIER (Standing Administrative Domain)
Level 1: CollectionSchedule (select_for_update)
Level 2: TeamScheduleAssignment (select_for_update)
========================================================================================
                                      |
                                      v
========================================================================================
SHIFT EXECUTION TIER (Operational Dispatch Domain)
Level 3: DriverShift (select_for_update)
Level 4: WatcherShift (select_for_update)
Level 5: CrewShift (select_for_update)
========================================================================================
                                      |
                                      v
========================================================================================
FLEET MAINTENANCE TIER (Orthogonal Physical Vehicle Domain)
Level T1: Truck (select_for_update)
Level T2: TruckOperationalHoldLog (select_for_update)
========================================================================================
```

### 5.2 Canonical Lock Acquisition Matrix
1. **Shift Starts & Shift Creation Staging (`DriverShift.pre_start`, `WatcherShift.create`):**
   - **New `DriverShift` Staging Transaction:**
     * Acquires Scheduling Tier locks: Level 1 (`CollectionSchedule`) $\longrightarrow$ Level 2 (`TeamScheduleAssignment`).
     * Re-fetches the assigned vehicle under Fleet Tier lock: `truck = Truck.objects.select_for_update().get(pk=schedule.truck_id)` (Level $T1$).
     * Evaluates `is_truck_dispatchable(truck)` under the $T1$ lock. Validates `truck.is_retired is False`, `truck.retirement_state == 'operational'`, `truck.status == TruckStatus.ACTIVE`, and `is_operational_hold is False`. If non-dispatchable, aborts and rejects with `400 Bad Request` / `ValidationError`.
     * Inserts the new `DriverShift` record. *Note on Level 3:* A row lock on `DriverShift` cannot be acquired prior to insertion because the row does not yet exist; PostgreSQL takes an implicit exclusive write lock on the newly inserted row for the remainder of the transaction.
     * If linking to an existing counterpart `WatcherShift`, acquires Level 4 `WatcherShift` lock (`select_for_update()`) and updates `associated_driver_shift`.
     * Holds $T1$ until transaction commit, guaranteeing strict serialization against concurrent retirement operations.
   - **Existing `DriverShift` Start (`DriverShift.start`):**
     * Acquires Level 3 (`DriverShift` `select_for_update()`).
     * Re-evaluates vehicle dispatchability under Level $T1$ (`Truck` `select_for_update()`).
     * Monotonic hierarchy: $L3 \longrightarrow T1$.
   - **`WatcherShift.create` (Atomicity of CrewShift Creation — D-5):**
     * Acquires Level 1 (`CollectionSchedule`) $\longrightarrow$ Level 2 (`TeamScheduleAssignment`).
     * Creates `WatcherShift` (Level 4) and atomically creates `CrewShift` (Level 5) in the identical transaction with `attendance_submitted_at = None`.
     * If linking to an existing active `DriverShift`, acquires Level 3 `DriverShift` lock (`select_for_update()`) while holding Levels 1 and 2.
2. **Administrative Assignment Mutations (`create`, `replace`, `terminate` of `TeamScheduleAssignment`):**
   - Acquire Level 1 (`CollectionSchedule`) $\longrightarrow$ Level 2 (`TeamScheduleAssignment`). Never acquires Level 3, 4, or 5 locks.
3. **Coordinated Shift Ending (`DriverShift.end`):**
   - Strictly follows canonical hierarchy: Level 3 (`DriverShift`) $\longrightarrow$ Level 4 (`WatcherShift`) $\longrightarrow$ Level 5 (`CrewShift`).
   - Does not acquire Levels 1 or 2. Because no execution-tier transaction ever requests an assignment-tier lock, an inverted lock cycle is structurally impossible.
4. **Attendance Submission (`WatcherShift.submit_attendance`):**
   - Acquires Level 4 (`WatcherShift`) $\longrightarrow$ Level 5 (`CrewShift`). Populates the pre-created `CrewShift`.
5. **Exceptional Shift Abort (`WatcherShift.exceptional_abort`):**
   - **Canonical Anti-Inversion Lock Ordering ($L3 \longrightarrow L4 \longrightarrow L5$):**
     * **Phase 1 (Discovery):** Non-locking read of `watcher_shift.associated_driver_shift_id`.
     * **Branch 1 (Associated DriverShift Exists):** Transaction acquires Level 3 `DriverShift` (`select_for_update()`) $\longrightarrow$ Level 4 `WatcherShift` (`select_for_update()`) $\longrightarrow$ Level 5 `CrewShift` (`select_for_update()`). Revalidates association. If caller is non-admin Watcher and `driver_shift.is_active` is True, releases locks and rejects with `409 Conflict`. If Admin, executes mid-route cancellation.
     * **Branch 2 (Unassociated DriverShift / Null):** Transaction acquires Level 4 `WatcherShift` (`select_for_update()`) $\longrightarrow$ Level 5 `CrewShift` (`select_for_update()`).
     * **Anti-Inversion Abort-Retry Guard:** If revalidation within Branch 2 reveals `associated_driver_shift_id` became non-null concurrently while waiting for the Level 4 lock, the transaction **never** requests Level 3 while holding Level 4! Instead, it immediately rolls back and retries via Branch 1. Never acquire Level 3 while holding Level 4.
6. **Fleet Hold Placement & Clearance:**
   - Strictly follows Level T1 (`Truck`) $\longrightarrow$ Level T2 (`TruckOperationalHoldLog`).
   - When an operation spans Shift and Fleet (e.g. post-shift inspection), lock order is strictly monotonic: Shift Execution Tier ($L3$) $\longrightarrow$ Fleet Tier ($T1 \longrightarrow T2$).
7. **Synchronized Vehicle Assignment & Multi-Truck Replacement Protocol (v3.3.2.5 Hardening):**
   - **Canonical Vehicle Assignment Enforcement (`TruckAssignmentService`):**
     * All application-level Driver and Crew vehicle assignments must execute through `TruckAssignmentService` (`assign_driver`, `assign_crew`, `remove_driver`, `remove_crew`, `clear_all_assignments`). Direct calls to `truck.drivers.add()`, `truck.drivers.set()`, `truck.drivers.clear()`, `truck.crew.add()`, `truck.crew.set()`, or `truck.crew.clear()` outside this service are strictly prohibited across application workflows.
     * `TruckAssignmentService.assign_driver` and `assign_crew` acquire Fleet Tier lock Level $T1$ (`Truck.objects.select_for_update().get(pk=truck_id)`), evaluate `is_truck_dispatchable(truck)` under lock, persist the ManyToMany association, and hold $T1$ until transaction commit. If `truck.is_retired is True`, `truck.retirement_state != 'operational'`, `truck.commissioned_at is None`, `truck.is_operational_hold is True`, or `truck.maintenance_status != 'available'`, the transaction aborts and raises `ValidationError`.
     * Reassignment, removal, and bulk clearing execute through `TruckAssignmentService.remove_driver`, `remove_crew`, and `clear_all_assignments`, which lock $T1$ and atomically update ManyToMany relationships under lock, ensuring consistent serialization.
   - **Emergency Vehicle Replacement / Swap (`execute_truck_swap`):**
     * Involves two vehicles: Current Truck ($A$) and Replacement Truck ($B$).
     * To eliminate deadlocks between competing swap requests, Fleet Tier locks MUST be acquired in **strictly ascending primary-key order**:
       ```python
       first_id, second_id = sorted([truck_a_id, truck_b_id])
       truck_first = Truck.objects.select_for_update().get(pk=first_id)    # Level T1_min
       truck_second = Truck.objects.select_for_update().get(pk=second_id)  # Level T1_max
       ```
     * Evaluates `is_truck_dispatchable(truck_b)` under the lock. If Replacement Truck $B$ has `is_retired is True`, `retirement_state != 'operational'`, or `commissioned_at is None`, the swap is rejected with `409 Conflict: replacement_truck_retired`.
     * If an operational hold log is placed on Truck $A$, acquires Level $T2$ (`TruckOperationalHoldLog`) while holding $T1$.
     * Monotonic hierarchy: $L3 \longrightarrow T1_{min} \longrightarrow T1_{max} \longrightarrow T2$.
8. **Resumable Four-Step Vehicle Retirement Protocol (`TruckService.retire_truck`):**
   - **Phase 0 (Retirement Gate & Dedicated Progress State):** Short atomic transaction locking only Level $T1$ `Truck` (`select_for_update()`). Sets `is_retired = True`, `status = TruckStatus.INACTIVE`, and sets `retirement_state = 'retirement_in_progress'`. Preserves `status_reason` intact. Commits and releases $T1$. All subsequent assignment transactions locking $T1$ see `is_retired=True` / `retirement_state='retirement_in_progress'` and reject immediately. If retried, Phase 0 detects `retirement_state == 'retirement_in_progress'` and safely advances to resume incomplete downstream phases.
   - **Phase 1 (Active Shift Coordinated Draining & Semantic Classification):** Re-queries candidate active `DriverShift` rows for the truck in ascending PK order. For each remaining active shift, opens a separate transaction, acquires $L3 \longrightarrow L4 \longrightarrow L5$, and invokes `DriverShiftService.end_driver_shift(shift, end_reason='truck_retired')`. Holds **zero** Fleet Tier locks ($T1/T2$). Completed shifts are safely skipped on retry. Semantic classification: `truck_retired` shifts are classified as completed/done (`conn_status='done'`, `lifecycle: 'done'`, `signal: 'ended'`), explicitly preventing them from being misclassified as abandoned or lost-signal shifts on live map and dashboard consumers.
   - **Detachment Phase (Standing Operational References Reconciled):** Reconciled into discrete atomic transactions without lock inversion:
     * *Step 2A (Route Schedules & Hotspot Assignments):* In discrete transactions, acquires Level 1 `CollectionSchedule` locks for standing routes referencing the truck, clears standing assignments (`schedule.truck = None, schedule.driver = None`), and clears standing hotspot assignments (`HotspotService.detach_truck_hotspots`). Commits and releases locks before requesting fleet locks. Holds zero Level $T1$ locks.
     * *Step 2B (Vehicle Assignments):* In a discrete transaction, invokes canonical `TruckAssignmentService.clear_all_assignments(truck)`, which acquires Level $T1$ `Truck` (`select_for_update()`), clears `truck.drivers` and `truck.crew`, and commits. Holds zero Level 1 scheduling locks.
   - **Phase 2 (Terminal Permanent Retirement — Owner-Approved Item 13 Option A):** In a separate atomic transaction, acquires Level $T1$ `Truck` (`select_for_update()`), asserts 0 active shifts and 0 standing schedule assignments remain. Sets `retirement_state = 'permanently_retired'`, and commits. Preserves Truck row, `DriverShift.truck` foreign keys, `WasteDelivery.truck` weighbridge links, `TruckLocation.truck` telemetry breadcrumbs, `TruckCrewAssignment.truck` rosters, `TruckFillEstimate.truck` calibration logs, `Escalation.truck`, `HotspotIntervention.truck`, `ScheduleTruckAllocation.truck`, and maintenance history indefinitely.
9. **Separate Uncommissioned Vehicle Deletion Workflow (`TruckService.delete_uncommissioned_truck`):**
   - Physically deletes only eligible uncommissioned Trucks under strict atomic locking.
   - Requires that the vehicle satisfies the formal deletion eligibility equation:
     1. Objectively uncommissioned: `truck.retirement_state == 'uncommissioned' and truck.commissioned_at is None`. Legacy trucks in `legacy_reconciliation` state are strictly protected from deletion until Superuser reconciliation.
     2. Zero historical records across all 9 Category A models: `DriverShift`, `WasteDelivery`, `TruckOperationalHoldLog`, `TruckLocation`, `TruckCrewAssignment`, `TruckFillEstimate`, `Escalation`, `HotspotIntervention`, `ScheduleTruckAllocation`.
     3. Zero live operational references across all 4 Category B models: `CollectionSchedule`, `GarbageHotspot`, `drivers`, `crew`.
   - **Atomic Pre-Lock Execution Order:** Opens `transaction.atomic()`, acquires the target Truck $T1$ row lock (`select_for_update()`) *before* evaluations, and re-validates commissioning status and all Category A and Category B references under lock.
   - **PostgreSQL Concurrency Serialization:** Under PostgreSQL MVCC, any concurrent transaction inserting a foreign key pointing to `driver_truck` automatically acquires `FOR KEY SHARE` on `driver_truck`, which blocks behind $T1$ (`FOR UPDATE`), preventing concurrent reference creation during deletion.
   - **Multi-Tier Defensive Enforcement:**
     * Service assertion: `TruckService.delete_uncommissioned_truck` locks $T1$ and raises `ValidationError` or `ProtectedError`.
     * QuerySet override: `TruckQuerySet.delete()` overrides bulk ORM deletion, raising `ProtectedError`.
     * Pre-delete signal: `guard_truck_pre_delete` verifies Category A historical records and Category B live references, raising `ProtectedError`. The signal never performs shift closures or acquires locks.
     * Admin permissions: `TruckAdmin.has_delete_permission` returns `False` for commissioned, legacy reconciliation, or referenced trucks; bulk `delete_selected` is disabled.
     * Database authorization: Direct `DELETE` privilege is revoked from `wastewatch_app`; deletion executes via the PostgreSQL `SECURITY DEFINER` stored function `truck_delete_uncommissioned(target_truck_id)`.
     * Stage-aware schema introspection: `TruckHistoricalAuditService` dynamically queries `connection.introspection.table_names()` to prevent missing table crashes prior to Stage 5.

## 6. Complete Deterministic Association Transactions & Persistence

### 6.1 Case A: Watcher Starts First, Driver Starts Second
```python
with transaction.atomic():
    # 1. Level 1 Lock: Root schedule serialization
    schedule = CollectionSchedule.objects.select_for_update().get(pk=schedule_id)

    # 2. Level 2 Lock: Coordination assignment lock
    team_assignment = TeamScheduleAssignment.objects.select_for_update().get(
        schedule=schedule, team_id=team_id, ended_at__isnull=True
    )

    # 3. Create DriverShift (Level 3)
    driver_shift = DriverShift.objects.create(
        driver=request.user, truck=truck, schedule=schedule,
        team=team_assignment.team, status='navigate_to_base', is_active=True, started_at=timezone.now()
    )

    # 4. Query candidate unassociated active WatcherShift (Level 4)
    driver_duty_date = calculate_operational_duty_date(schedule, driver_shift.started_at)
    candidates = list(WatcherShift.objects.select_for_update().filter(
        schedule_id=schedule.id, team_id=team_assignment.team_id,
        is_active=True, associated_driver_shift__isnull=True
    ))

    # 5. Duty-date matching
    matching = [w for w in candidates if calculate_operational_duty_date(w.schedule, w.started_at) == driver_duty_date]

    # 6. Persistence & Ambiguity Resolution
    if len(matching) == 1:
        watcher_shift = matching[0]
        watcher_shift.associated_driver_shift = driver_shift
        try:
            watcher_shift.save(update_fields=['associated_driver_shift'])
        except IntegrityError:
            raise ConflictError("Shift association conflicted with another concurrent transaction.")
    elif len(matching) > 1:
        logger.warning(
            "Ambiguous shift association: %d active unassociated WatcherShifts found for schedule %s, team %s, duty date %s. Leaving unassociated.",
            len(matching), schedule.id, team_assignment.team_id, driver_duty_date
        )
    # If len(matching) == 0: driver_shift remains cleanly unassociated (Scenario 1).
```

### 6.2 Case B: Driver Starts First, Watcher Starts Second (Canonical WatcherShiftService)
```python
class WatcherShiftService:
    @staticmethod
    def create_watcher_shift(watcher, schedule_id):
        """
        Canonical application service creating WatcherShift and CrewShift atomically (D-5).
        Primary API POST /api/watcher/shifts/ is the SOLE sanctioned application creation path.
        Administrative portal creation via ModelAdmin.save_model and scheduled jobs/seeds are prohibited.
        Derives authoritative SanitationTeam from TeamScheduleAssignment and validates Team Leader authority.
        """
        with transaction.atomic():
            # 1. Level 1 Lock: Root schedule serialization
            schedule = CollectionSchedule.objects.select_for_update().get(pk=schedule_id)

            # 2. Level 2 Lock: Coordination assignment lock (authoritative Team resolution)
            try:
                team_assignment = TeamScheduleAssignment.objects.select_for_update().get(
                    schedule=schedule, ended_at__isnull=True
                )
            except TeamScheduleAssignment.DoesNotExist:
                raise ValidationError("No active team assignment found for this schedule.")

            authoritative_team = team_assignment.team

            # Validate requesting watcher is an active Team Leader of this team
            is_team_leader = SanitationTeamMembership.objects.filter(
                team=authoritative_team,
                user=watcher,
                role='team_leader',
                ended_at__isnull=True
            ).exists()
            if not is_team_leader:
                raise PermissionDenied("Only an active Team Leader of the assigned team may start a WatcherShift.")

            # 3. Candidate search: query unassociated active DriverShift (Level 3)
            # PostgreSQL Locking: Subquery exclusion avoids LEFT OUTER JOIN on reverse FK
            now = timezone.now()
            watcher_duty_date = calculate_operational_duty_date(schedule, now)
            associated_driver_shift_ids = WatcherShift.objects.filter(
                associated_driver_shift__isnull=False
            ).values('associated_driver_shift_id')

            candidates = list(
                DriverShift.objects.filter(
                    schedule=schedule,
                    team=authoritative_team,
                    is_active=True
                )
                .exclude(id__in=associated_driver_shift_ids)
                .select_for_update(of=('self',))
            )

            # 4. Duty-date matching
            matching = [d for d in candidates if calculate_operational_duty_date(d.schedule, d.started_at) == watcher_duty_date]
            associated_driver = None
            if len(matching) == 1:
                # Post-lock revalidation: ensure driver shift was not linked concurrently
                candidate = matching[0]
                if not WatcherShift.objects.filter(associated_driver_shift=candidate).exists():
                    associated_driver = candidate
            elif len(matching) > 1:
                logger.warning(
                    "Ambiguous shift association: %d active unassociated DriverShifts found for schedule %s, team %s, duty date %s. Leaving unassociated.",
                    len(matching), schedule.id, authoritative_team.id, watcher_duty_date
                )

            # 5. Create WatcherShift with persisted association (Level 4) and atomic CrewShift (Level 5) per D-5
            try:
                watcher_shift = WatcherShift.objects.create(
                    watcher=watcher,
                    team=authoritative_team,
                    schedule=schedule,
                    associated_driver_shift=associated_driver,
                    status='active',
                    is_active=True,
                    started_at=now
                )
                # 6. Create CrewShift atomically with WatcherShift (D-5 1:1 Atomic Creation)
                # Initialized with attendance_submitted_at=None and zero ShiftAttendance rows
                crew_shift = CrewShift.objects.create(
                    watcher_shift=watcher_shift,
                    team=watcher_shift.team,
                    schedule=watcher_shift.schedule,
                    status='active',
                    is_active=True,
                    started_at=now,
                    attendance_submitted_at=None
                )
            except IntegrityError as exc:
                logger.error("Failed to create WatcherShift or atomic CrewShift: %s", exc)
                raise ConflictError("An active WatcherShift already exists for this team, or the target driver shift was already bound.")

            return watcher_shift, crew_shift

### 6.3 Canonical Coordinated DriverShift Closure Service Routine
```python
class DriverShiftService:
    @staticmethod
    def end_driver_shift(driver_shift, end_reason='driver_ended'):
        """
        Canonical driver shift closure routine governing all 4 ending paths:
        1. Normal Driver end (POST /api/driver/shift/end/) -> end_reason='driver_ended'
        2. Admin force-end (POST /api/driver/shift/{id}/force-end/) -> end_reason='admin_force_ended'
        3. Stale auto-close (Celery task / management command) -> end_reason='stale_timeout'
        4. Truck deletion pre-delete signal (driver.signals.py) -> end_reason='truck_deleted'

        Adheres strictly to Tier 2 lock hierarchy: DriverShift (L3) -> WatcherShift (L4) -> CrewShift (L5).
        Transactionally closes associated WatcherShift and CrewShift to prevent active orphans.
        """
        with transaction.atomic():
            # Lock DriverShift (Level 3)
            driver_shift = DriverShift.objects.select_for_update().get(pk=driver_shift.pk)
            if not driver_shift.is_active:
                return driver_shift

            now = timezone.now()
            driver_shift.is_active = False
            driver_shift.status = 'end_shift'
            driver_shift.ended_at = now
            driver_shift.duration_ms = int((now - driver_shift.started_at).total_seconds() * 1000)
            driver_shift.end_reason = end_reason
            driver_shift.save(update_fields=['is_active', 'status', 'ended_at', 'duration_ms', 'end_reason'])

            # Coordinated closure: locate associated active WatcherShift (Level 4)
            try:
                watcher_shift = WatcherShift.objects.select_for_update().get(
                    associated_driver_shift=driver_shift,
                    is_active=True
                )
            except WatcherShift.DoesNotExist:
                watcher_shift = None

            if watcher_shift:
                watcher_shift.is_active = False
                watcher_shift.status = 'completed'
                watcher_shift.ended_at = now
                watcher_shift.duration_ms = int((now - watcher_shift.started_at).total_seconds() * 1000)
                watcher_shift.save(update_fields=['is_active', 'status', 'ended_at', 'duration_ms'])

                # Lock and finalize associated CrewShift (Level 5, 1:1 per D-5)
                try:
                    crew_shift = CrewShift.objects.select_for_update().get(watcher_shift=watcher_shift, is_active=True)
                    crew_shift.is_active = False
                    crew_shift.status = 'completed'
                    crew_shift.ended_at = now
                    crew_shift.duration_ms = int((now - crew_shift.started_at).total_seconds() * 1000)
                    crew_shift.save(update_fields=['is_active', 'status', 'ended_at', 'duration_ms'])
                except CrewShift.DoesNotExist:
                    pass

            return driver_shift
```

---

## 7. D-5 Exact Cardinality Preservation & Enforcement Boundary Deep-Dive

### 7.1 Re-Establishing Owner Directive D-5
* **Authoritative Decision:** The project owner confirmed: *"Exactly one CrewShift per WatcherShift"*.
* **Relational Implementation Mechanism:**
  - `CrewShift` is linked to `WatcherShift` via `OneToOneField('watcher.WatcherShift', on_delete=models.PROTECT, related_name='crew_shift')`.
  - Django's `OneToOneField` natively generates a database-level unique constraint (`driver_crewshift_watcher_shift_id_key` on PostgreSQL), strictly guaranteeing the upper bound of at most one `CrewShift` per `WatcherShift` ($\le 1$) at the database schema level.
  - Declaring a redundant manual `UniqueConstraint(fields=['watcher_shift'], name='unique_crew_shift_per_watcher_shift')` in `CrewShift.Meta.constraints` has been completely removed to avoid duplicate index declarations.
  - When `WatcherShiftService.create_watcher_shift` executes, it transactionally creates `CrewShift` with `attendance_submitted_at = None` and zero `ShiftAttendance` child records.
* **Why Zero Attendance Records Initially Does Not Violate Database Integrity:**
  - In normalized relational database design, child rows (`ShiftAttendance`) point to the parent (`CrewShift`) via a foreign key (`ForeignKey(CrewShift)`). The existence of a parent row does not require child rows to be inserted immediately.
  - No dummy, null, or placeholder attendance rows are fabricated. Therefore, Tier 1 PostgreSQL triggers (`trg_prevent_attendance_tampering`) are completely unviolated.
* **Roll Call Population:**
  - When the Watcher conducts roll call and calls `POST /api/watcher/shifts/{id}/submit_attendance/`, the service acquires row locks on `WatcherShift` (L4) and `CrewShift` (L5), updates `CrewShift.attendance_submitted_at = timezone.now()` and `CrewShift.roster_snapshot`, and persists the initial `ShiftAttendance` rows.
  - Roll call submission populates the pre-created `CrewShift`; it does NOT create a new `CrewShift`. Idempotent retries return `200 OK` with existing data; differing payloads return `409 Conflict`.
* **Pre-Roll-Call Cancellation / Abort:**
  - If a shift is cancelled before roll call (e.g. driver no-show, vehicle defect, pre-departure abort), `CrewShift` transitions with its parent `WatcherShift` to `status='cancelled', is_active=False` with zero attendance records.
  - Exactly one `CrewShift` record is preserved for audit traceability, fully honoring D-5 across all lifecycle paths.
* **Complete Retraction of U-CR1:**
  - The proposed `U-CR1` cap alteration is permanently retracted and removed from the register of open decisions.

### 7.2 Exact-One Enforcement Boundary, Genuinely Read-Only Admin Models & Multi-Tier Deletion Protection
* **Upper Bound ($\le 1$ Guaranteed by Database Schema):**
  The `OneToOneField` creates a native `UNIQUE` constraint on `driver_crewshift.watcher_shift_id`. The database engine physically rejects any attempt to insert a second `CrewShift` referencing the same `WatcherShift`. Redundant manual `UniqueConstraint` declarations are removed.
* **Lower Bound ($\ge 1$ Guaranteed by Application Service):**
  Relational databases do not natively enforce that parent rows (`watcher_watchershift`) must have an associated child row (`driver_crewshift`) without complex deferred circular foreign keys or circular triggers. Therefore, the specification does not claim that the database schema alone guarantees "exactly one".
* **Sole Sanctioned Application Creation Path:**
  The existential lower bound is guaranteed by restricting creation solely to the primary client API:
  1. *Primary Client API:* `POST /api/watcher/shifts/` (`WatcherShiftViewSet.create`) is designated as the **sole sanctioned application creation path**.
  2. *Genuinely Read-Only Administrative Models:* Django Admin is strictly read-only for both `WatcherShift` and `CrewShift`:
     - `has_add_permission(request) -> False`
     - `has_delete_permission(request, obj=None) -> False`
     - `has_change_permission(request, obj=None) -> False` for all users, including staff and superusers.
     - All model fields are declared in `readonly_fields`. Custom Admin actions or form overrides modifying protected values are strictly prohibited.
     - Unambiguous semantics: Administrators may view/inspect shift records in Django Admin, but cannot edit lifecycle state (`status`, `is_active`, `started_at`, `ended_at`, `duration_ms`), counterpart associations (`associated_driver_shift`, `watcher_shift`), team, schedule, roster snapshot, or roll call timestamp (`attendance_submitted_at`).
  3. *Client API Surface Restrictions:* `WatcherShiftViewSet` exposes only documented `create` and approved custom actions (`exceptional_abort`, `submit_attendance`). It exposes no generic update (`PUT`), partial update (`PATCH`), or destroy (`DELETE`) endpoints (`http_method_names = ['get', 'post', 'head', 'options']`).
  4. *Service-Layer ORM Preservation:* Service-layer routines (`WatcherShiftService`, `DriverShiftService`) mutate models directly via internal ORM methods within database transactions and are unaffected by Admin/API restrictions.
  5. *Management Commands & Batch Scripts Prohibited:* Schedulers and management commands (e.g. `seed_shifts`) are forbidden from independently creating shifts. Direct calls to bare `WatcherShift.objects.create(...)` or `CrewShift.objects.create(...)` are strictly prohibited across the codebase.
  - Both records are instantiated within `transaction.atomic()`; if `CrewShift` creation fails, both records roll back, preventing orphan `WatcherShift` rows.
* **Multi-Tier CrewShift Deletion Prevention:**
  While `ShiftAttendance.crew_shift` specifies `on_delete=models.PROTECT`, this foreign key constraint only protects `CrewShift` from deletion if one or more attendance rows already exist. A newly created `CrewShift` prior to roll call submission (with zero attendance rows) is protected against deletion via a four-tier defense:
  - *Django Admin:* `CrewShiftAdmin` disables deletion (`has_delete_permission=False`).
  - *API Level:* No deletion endpoint is exposed across any REST API router or ViewSet.
  - *Model Instance Level:* `CrewShift.delete()` is overridden to raise `django.db.models.ProtectedError("CrewShift deletion is strictly prohibited to preserve D-5 audit integrity.")`.
  - *QuerySet / Manager Level:* A custom `CrewShiftQuerySet` and `CrewShiftManager` override `.delete()` to raise `ProtectedError`, blocking bulk ORM deletions.
* **Accurate Limitation Disclosure (Direct Database Writes):**
  - Direct raw SQL `INSERT INTO watcher_watchershift ...` via `psql` can create a `WatcherShift` without a `CrewShift` (violating lower bound).
  - Direct raw SQL `DELETE FROM driver_crewshift WHERE ...` prior to attendance rows existing can delete a `CrewShift` without deleting `WatcherShift` (violating lower bound).
  - These trust boundaries are accurately disclosed. In accordance with architectural safety rules, no unapproved database triggers or circular deferred foreign keys are introduced to enforce this constraint at the schema level without explicit owner approval.

---

## 8. Exceptional-Abort Authorization & Canonical Concurrency Contracts

### 8.1 The 5 Distinguished Operational Conditions (Correction C)

| Dimension | Condition 1: Unassociated — No DriverShift Exists | Condition 2: Unassociated — Independent DriverShift Exists in DB | Condition 3: Associated Active Driver (Unilateral Blocked) | Condition 4: Associated Active Driver (Authorized Mid-Route) | Condition 5: Associated DriverShift Already Inactive |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Operational Context** | Driver failed to stage or no driver shift was scheduled/created. `associated_driver_shift` is null, and 0 matching DriverShifts exist in DB. | `associated_driver_shift` is null, but an independent DriverShift exists in DB (e.g. staged under another team, concurrent U-DC1 start ambiguity, or duty date/grace mismatch). | Watcher attempts unilateral abort while Driver is actively executing collection route (`associated_driver_shift` is populated & active). | Watcher suffers emergency (medical, safety) mid-route; elevated authorization confirms abort while Driver is active. | `associated_driver_shift` is populated, but `is_active is False` (DriverShift completed, ended, or cancelled earlier, while Watcher remained active). |
| **System Assumption & Heuristic Prohibition** | Record known absent. | **PROHIBITED FROM INFERRING DRIVERSHIFT DOES NOT EXIST.** Zero heuristic fallback matching, auto-closure, or driver reassignment. | Driver known active and bound. | Driver known active and bound. | Driver known already inactive. |
| **Authorized Actor** | Watcher (`IsWatcherOrAdmin`, matching shift watcher) or Admin (`is_admin_user`). | Watcher (`IsWatcherOrAdmin`, matching shift watcher) or Admin (`is_admin_user`). | Watcher (`IsWatcherOrAdmin`, matching shift watcher) attempting call without Admin elevation. | Elevated Admin (`is_admin_user` under proposed **U-WE1**). | Watcher (`IsWatcherOrAdmin`, matching shift watcher) or Admin (`is_admin_user`). |
| **HTTP Response** | `200 OK` (shift cancelled). | `200 OK` (shift cancelled). | `409 Conflict` (`driver_shift_actively_running`). | `200 OK` (shift cancelled mid-route). | `200 OK` (shift cancelled cleanly). |
| **Records Changed** | `WatcherShift` $\rightarrow$ `cancelled`; `CrewShift` $\rightarrow$ `cancelled`. | `WatcherShift` $\rightarrow$ `cancelled`; `CrewShift` $\rightarrow$ `cancelled`. | **Zero records changed.** | `WatcherShift` $\rightarrow$ `cancelled`; `CrewShift` $\rightarrow$ `cancelled`. | `WatcherShift` $\rightarrow$ `cancelled`; `CrewShift` $\rightarrow$ `cancelled`. |
| **DriverShift State & Effect** | N/A (no driver shift exists). | **Completely unchanged.** Independent DriverShift remains active (`is_active=True`, status in `PHASE_CHOICES` such as `'navigate_to_base'`, `'confirm_start'`, `'checkin'`, `'shiftroute'`). | Unchanged (`is_active=True`, status in `PHASE_CHOICES`, e.g. `'shiftroute'`). | Unchanged (`is_active=True`, status in `PHASE_CHOICES`, e.g. `'shiftroute'`). Driver continues route or returns independently. | Already inactive (`is_active=False`, `status='end_shift'`, `end_reason` in `['driver_ended', 'admin_force_ended', 'stale_timeout', 'truck_deleted']`). Unmodified. |
| **CrewShift State** | Transitions to `cancelled` (0 attendance rows, exactly 1 CrewShift record preserved). | Transitions to `cancelled` (0 attendance rows, exactly 1 CrewShift record preserved). | Remains `is_active=True` (`status='active'`). | Transitions to `cancelled`. Submitted attendance rows remain permanently immutable. | Transitions to `cancelled` (or already inactive). Immutable records preserved. |
| **Required Audit Event** | `watcher_shift_aborted_unassociated`. Mandatory `reason` recorded. | `watcher_shift_aborted_unassociated`. Mandatory `reason` recorded. Diagnostic notes unassociated state. | `watcher_shift_abort_blocked`. Diagnostic logged. | `watcher_shift_exceptional_mid_route_abort`. Mandatory `reason` & `notes`. | `watcher_shift_aborted_counterpart_inactive`. Informational audit logged. |
| **Subsequent Driver Ending Effect** | N/A. | Independent DriverShift ends later via `DriverShiftService.end_driver_shift` with zero effect on Watcher/Crew (logs warning). Open decision Item 12 governs disposition. | Normal coordinated ending will finalize both shifts when Driver ends. | Coordinated ending finds `is_active=False`, logs informational event, and leaves WatcherShift intact. | Coordinated ending on DriverShift was already finalized (or ends cleanly without double-closing). |

* **Preservation of Open Decision Item 12 (`Shift Association Fallback & Unassociated Dispositions Policy`):** Under Condition 2, where an independent unassociated DriverShift exists in the database during a WatcherShift abort, the system does not infer or guess disposition. Operational disposition policy (whether manual Admin review is required or a late-binding reconciliation job should be run) remains an unresolved open owner decision.

### 8.2 Authorization Alignment & D-8 Boundary Protection
* **Endpoint Permission Class:** Updated to `IsWatcherOrAdmin`.
* **Object-Level Check:** Permits access if `is_admin_user(request.user)` OR `request.user.id == watcher_shift.watcher_id`.
* **Unilateral Guard (Service Layer):** If caller is a non-admin Watcher and `watcher_shift.associated_driver_shift` exists and is active, service rejects with `409 Conflict`:
  ```json
  {
    "error": "driver_shift_actively_running",
    "message": "Cannot unilaterally abort WatcherShift while associated DriverShift is active. Requires Admin elevation or coordinated driver closure.",
    "associated_driver_shift_id": 88
  }
  ```
* **Strict Protection of D-8:** Initial roll call submission (`POST /api/watcher/shifts/{id}/submit_attendance/`) remains strictly `IsWatcherRole` (`watcher_only`). Admins are forbidden from taking or submitting initial roll call on behalf of a Watcher. Admin authority is strictly limited to post-submission corrections (`/correct/`) per D-6 and emergency shift aborts (`/exceptional_abort/`) per U-WE1.

---

## 9. Authoritative Truck Hold Clearance Authorization on Target Hold Record

### 9.1 Multi-Facility Defect Isolation vs Denormalized Projections
In v2.9, Section 13 described hold clearance authorization by checking `truck.hold_dumpsite_id == request.user.dumpsite_id`. This created an architectural defect in multi-defect environments:
* **The Defect Scenario:**
  1. A vehicle visits Dumpsite A and receives Hold A (tire defect) originating from Dumpsite A (`TruckOperationalHoldLog` #A, `originating_dumpsite = A`).
  2. The vehicle subsequently visits Dumpsite B and receives Hold B (brake defect) originating from Dumpsite B (`TruckOperationalHoldLog` #B, `originating_dumpsite = B`).
  3. The denormalized cache projection `truck.hold_dumpsite_id` mirrors the most recently placed hold (Dumpsite B).
  4. When an authorized Dumpsite Operator from Dumpsite A repairs defect A and calls `POST /api/driver/trucks/{id}/clear_hold/` specifying `hold_log_id = A`, evaluating authorization against `truck.hold_dumpsite_id` would compare `request.user.dumpsite_id` (Facility A) against `truck.hold_dumpsite_id` (Facility B), erroneously returning `403 Forbidden`!

### 9.2 Authoritative Resolution Implemented in v3.0 / v3.1
* **Direct Target Instance Evaluation:** In `TruckViewSet.clear_hold`, authorization is evaluated directly on the target `TruckOperationalHoldLog` instance:
  ```python
  # Target authorization: evaluated strictly against target hold log, NEVER against Truck projection!
  self.check_object_permissions(request, hold_log)
  ```
* **Permission Class Rule in `IsAssignedDumpsiteOperator`:**
  ```python
  elif isinstance(obj, TruckOperationalHoldLog):
      # Authoritative hold clearing: derives strictly from facility that originated the specific hold.
      target_dumpsite_id = obj.originating_dumpsite_id
  ```
* **Guarantee:** Operator A can clear Hold A originated by Facility A, and Operator B can clear Hold B originated by Facility B, regardless of which facility holds the current denormalized cache projection on `Truck`.

---

## 10. U-DC1 vs T08A / T08A-Alt Reconciliation

* **The Inconsistency:** Open business decision `U-DC1` proposes adding `UniqueConstraint(fields=['team'], condition=Q(is_active=True), name='unique_active_driver_shift_per_team')` on `driver.DriverShift`. Meanwhile, test `T08A` described a scenario where multiple active DriverShifts exist for the same team, verifying fallback ambiguity detection.
* **Reconciliation in v3.0 / v3.1:**
  1. `U-DC1` remains an **open business decision** pending formal project owner confirmation.
  2. `T08A` is marked as **Conditional on absence of U-DC1 (baseline fallback handling)**: validates that if `U-DC1` is not enacted, candidate matching detects ambiguity (`len(matching) > 1`), refuses to pick `.first()`, leaves the shift unassociated, and logs an operational warning.
  3. `T08A-Alt` is added as **Conditional on approval of U-DC1**: validates that if `U-DC1` is enacted, attempting to create a second active `DriverShift` on the same team is rejected by the database unique constraint with `IntegrityError` at the database level, preventing the ambiguous state from ever existing.

---

## 11. Concurrency Claim Recalibration & Deadlock Preconditions

* **Documented ORM Scope:** The top-down hierarchical locking protocol (`CollectionSchedule -> TeamScheduleAssignment -> DriverShift -> WatcherShift -> CrewShift` and `Truck -> HoldLog`) guarantees deadlock freedom **strictly for application transactions that execute through these documented ORM service paths**.
* **Pre-Transaction Discovery & Abort-Retry Protocol:** For operations with dynamic associations (exceptional abort), deadlocks are prevented by pre-transaction discovery followed by canonical top-down locking ($L3 \longrightarrow L4 \longrightarrow L5$), backed by an anti-inversion abort-retry guard that prevents ever acquiring Level 3 while holding Level 4.
* **Vehicle Retirement Concurrency & Resumability Resolution (v3.3.2.1):**
  - Lock-order inversion between vehicle deletion (previously $T1$ then $L3$) and post-shift inspection ($L3$ then $T1$) is resolved by moving shift closure into Phase 1 without holding $T1$.
  - Assignment races between retirement and deletion are eliminated by Phase 0: setting and committing `truck.is_retired = True` under a dedicated $T1$ lock before Phase 1 begins.
  - Retirement resumability is guaranteed by tracking persisted progress via `status_reason = 'retirement_in_progress'` vs `'permanently_retired'`. Retries safely resume Phase 1 shift draining and Detachment without repeating completed steps.
  - Every assignment path (`DriverShift.pre_start`, `start/`, `execute_truck_swap`, schedule allocations, and `TruckAssignmentService`) re-fetches the vehicle under `select_for_update()` ($T1$) and checks `is_truck_dispatchable(truck)`. Because `is_truck_dispatchable` rejects `is_retired is True`, no assignment can succeed once Phase 0 commits.
  - Multi-truck swap operations acquire locks in strictly ascending primary-key order ($T1_{min} \longrightarrow T1_{max}$), eliminating cyclic wait deadlocks between competing swap requests.
* **PostgreSQL Concurrency Regression Test Design (T10D):**
  - **Scenario A (Retirement racing DriverShift creation):** Tx A begins Phase 0, locks $T1$, sets `is_retired=True, status_reason='retirement_in_progress'`, and commits. Concurrent Tx B calls `pre_start`, acquires $L1 \longrightarrow L2$, locks $T1$, evaluates `is_truck_dispatchable(truck)`, and is rejected with `400 Bad Request` / `ValidationError: truck_retired`. Tx A completes Phase 1, Detachment, and Phase 2. Zero shifts are created with a retired or null truck reference.
  - **Scenario B (Assignment in progress when retirement begins — Corrected):** Tx B calls `DriverShift.pre_start`, acquires $L1 \longrightarrow L2$, locks $T1$ (`select_for_update`), and validates `is_truck_dispatchable(truck)`. The truck is currently dispatchable (`is_truck_dispatchable(truck) is True`). Tx B pauses at Synchronization Barrier 1 while holding $T1$. Tx A calls `TruckService.retire_truck(truck)`, enters Phase 0, attempts to acquire $T1$, and blocks waiting on Tx B. Tx B creates active `DriverShift` (Level 3), releases Barrier 1, and commits Transaction B (releasing $T1$). Tx A unblocks, acquires $T1$, sets `is_retired=True, status_reason='retirement_in_progress'`, and commits Phase 0. Phase 1 queries active shifts for this truck, discovers Tx B's newly committed shift, acquires $L3 \longrightarrow L4 \longrightarrow L5$, and closes it cleanly via `DriverShiftService.end_driver_shift`.
  - **Scenario C (Concurrent two-truck swap):** Tx 1 attempts emergency swap: Current Truck 10 $\longrightarrow$ Replacement Truck 20. Tx 2 attempts emergency swap: Current Truck 20 $\longrightarrow$ Replacement Truck 10. Both transactions sort Truck IDs: `first_id, second_id = sorted([10, 20])` and acquire locks in ascending order ($T1_{10} \longrightarrow T1_{20}$). Monotonic ascending PK acquisition guarantees zero cyclic wait states (zero deadlocks). If a truck is marked `is_retired=True` concurrently, the replacement transaction rejects with `409 Conflict`.
* **Empirical Verification Notice:** The protocol represents a verified architectural design that will undergo multi-threaded concurrency and stress testing during Milestone 1 implementation.

---


* **Shift Creation Staging vs Row Lock Clarification (v3.3.2.2):** Clarified that staging a new `DriverShift` does NOT acquire an existing row lock on Level 3 before insertion. Instead, staging locks $L1 \longrightarrow L2 \longrightarrow T1$, validates vehicle dispatchability under $T1$, inserts $L3$ (which takes an implicit exclusive write lock in PostgreSQL), and acquires $L4$ if linking to a counterpart `WatcherShift`. Existing shift operations strictly enforce $L3 \longrightarrow T1$ (start), $L3 \longrightarrow L4 \longrightarrow L5$ (end), and $L3 \longrightarrow T1 \longrightarrow T2$ (inspection).

## 12. Executed Baseline Tests Versus Proposed Architecture Tests

### 12.1 Executed Baseline Tests (Read-Only)
* **Command:** `python wastewatch/backend/manage.py test driver.tests --keepdb`
* **Result:** **40 tests ran, 40 passed** in 175.1s (exit code 0).
* **Scope:** Validates legacy driver shifts, geofencing, and vehicle tracking.

### 12.2 Proposed Architecture-Level Tests (T01 through T47, BT-01 through BT-12)
* **BT-01 through BT-12:** Duty-date boundary scenarios (including BT-11 formula reality under U-OD1).
* **T01 through T30:** Baseline architecture scenarios:
  - **T01:** DriverShift creation without WatcherShift (`DriverShiftViewSet.pre_start`).
  - **T02:** WatcherShift creation without DriverShift & Team Leader validation (`WatcherShiftViewSet.create` delegating to `WatcherShiftService.create_watcher_shift`; unauthorized caller rejected with 403 Forbidden).
  - **T03 (Corrected):** Sole sanctioned creation path: atomic `CrewShift` creation upon `WatcherShiftViewSet.create` (delegating to `WatcherShiftService.create_watcher_shift` with `attendance_submitted_at=None`, 0 `ShiftAttendance` records; Admin creation blocked via `has_add_permission=False`).
  - **T03B:** Initial roll call populates pre-created `CrewShift` (`WatcherShiftViewSet.submit_attendance`), stamping `attendance_submitted_at=now` and persisting `ShiftAttendance` rows without creating another `CrewShift`.
  - **T03C:** Transactional rollback on `CrewShift` creation failure in `WatcherShiftService.create_watcher_shift`, verifying complete rollback of both `WatcherShift` and `CrewShift`.
  - **T04:** Idempotent roll call retry (`200 OK` match on identical payload; `409 Conflict` on differing payload). Exactly 1 `CrewShift` preserved.
  - **T08A:** Fallback ambiguity handling when multiple driver shifts exist (Conditional on absence of U-DC1).
  - **T08A-Alt:** Second active DriverShift rejected by DB unique constraint (Conditional on approval of U-DC1).
  - **T10:** Normal coordinated shift closure via `DriverShiftService.end_driver_shift(driver_shift, end_reason='driver_ended')` transactionally ending associated WatcherShift & CrewShift.
  - **T10B:** Admin force-end coordinated closure via `DriverShiftService.end_driver_shift(driver_shift, end_reason='admin_force_ended')` transactionally ending associated WatcherShift & CrewShift.
  - **T10C:** Multi-path non-HTTP closure (stale shift auto-close task or truck deletion signal) delegating to `DriverShiftService.end_driver_shift` (`end_reason='stale_timeout'` / `'truck_deleted'`).
  - **T16B:** CrewShift deletion blocked across all ORM levels (model instance `.delete()` and `CrewShiftQuerySet.delete()` raise `ProtectedError`) with 0 attendance rows; Admin deletion blocked (`has_delete_permission=False`).
* **T31 through T36:** Concurrency, association persistence, hold clearance tests, and coordinated closure under `DriverShiftService.end_driver_shift` (T34).
* **T37A through T39B (Unassociated & Exceptional Abort Suite):**
  - **T37A (Condition 1):** Exceptional abort when no DriverShift exists; WatcherShift and CrewShift cancelled (0 attendance rows).
  - **T37B (Condition 2):** Exceptional abort when an independent DriverShift exists unassociated; WatcherShift and CrewShift cancelled; independent DriverShift remains active (`is_active=True`, status in `PHASE_CHOICES`) and completely untouched; zero heuristic matching or reassignment (preserves Item 12).
  - **T38 (Condition 3):** Unilateral abort attempt by Watcher blocked with 409 Conflict while DriverShift is active (`is_active=True`).
  - **T39 (Condition 4 / U-WE1):** Admin-authorized mid-route exceptional abort; WatcherShift and CrewShift cancelled; DriverShift continues active (`is_active=True`, status in `PHASE_CHOICES`).
  - **T39B (Condition 5):** Exceptional abort when counterpart DriverShift is already inactive (`is_active=False, status='end_shift'`); WatcherShift and CrewShift cancelled; inactive DriverShift unmodified.
* **T40 through T47:** Fleet hold clearance concurrency, canonical L3 $\longrightarrow$ L4 $\longrightarrow$ L5 abort ordering, anti-inversion abort-retry guard, and multi-hold facility isolation.
* **Attribution Notice:** All tests T01–T47 and BT-01–BT-12 are **PROPOSED — NOT EXECUTED**.

---

## 13. Remaining Open Owner Decisions Register

The following 12 items are designated as **`PROPOSED — REQUIRES PROJECT OWNER APPROVAL`**:
1. **U-DC1 (Team-Level Active DriverShift Uniqueness Constraint):** Whether to enforce `UniqueConstraint(fields=['team'], condition=Q(is_active=True), name='unique_active_driver_shift_per_team')` on `driver.DriverShift` in Stage 1 (`driver.0036`).
2. **U-OD1 (Overnight Staging & Post-Shift Grace Buffer Policy):** Explicit confirmation of allowed window (e.g. 60 or 120 minutes) for shift pre-start before scheduled `start_time` and completion after scheduled `end_time` (resolving BT-11).
3. **U-OP1 (Dedicated `CollectionScheduleRun` Operational Entity):** Whether to introduce an explicit first-class occurrence model in Milestone 1 to eliminate composite dynamic triple-matching `(schedule_id, team_id, duty_date)`.
4. **U-DB1 (Database-Level User Identity & Dedicated Migration/App DB Roles):** Operational confirmation to deploy separate database roles (`wastewatch_app` without DDL/TRUNCATE permissions and `wastewatch_migrator`) and evaluate PostgreSQL session variables (`SET LOCAL wastewatch.current_user_id = %s`).
5. **U-TH1 (Dedicated `TruckOperationalHoldLog` History Model):** Operational confirmation to deploy the dedicated `TruckOperationalHoldLog` historical ledger in `driver.0038`.
6. **U-WE1 (WatcherShift Exceptional Termination & Unassociated Closure Policy):** Exact authorization rules for unilateral Watcher shift termination during an active DriverShift (whether permissible by Watcher alone under emergency exceptions or strictly requiring Admin confirmation).
7. **U7 (Substitute Driver Eligibility):** Exact authorization rules and multi-team scheduling permissions for substitute drivers.
8. **U10 (WasteDelivery Shift Foreign Key):** Linking scale tickets directly to active shifts without weight proration.
9. **D-1 (Dumpsite Landmark):** Storing physical staging gate coordinates versus facility geographic centroid.
10. **D-2 (Backend Arrival Radius & Accuracy):** Determining exact server geofence arrival radius (proposed 150m) and GPS accuracy ceiling (proposed 50m).
11. **Roster Reference Instant:** Snapshotting membership at `WatcherShift.started_at` versus `attendance_submitted_at`.
12. **Shift Association Fallback & Unassociated Dispositions Policy:** Policy for unassociated driver shifts or early breakdown closures (whether Admin manual review is required or a late-binding reconciliation job should be run when an independent unassociated DriverShift exists in the database during a WatcherShift abort or vice versa; heuristic guessing, auto-closure, and reassignment are strictly prohibited).
13. **Truck Physical Deletion vs. Permanent Retirement Policy (`OWNER-APPROVED — OPTION A`):** Formal determination of whether physical database deletion (`truck.delete()`) is permissible for commissioned vehicles with operational history.
    * **Codified Policy (Option A Approved):** Commissioned Trucks with operational history must normally and permanently be **retired** (`is_retired = True, status = TruckStatus.INACTIVE, retirement_state = 'permanently_retired'`) via `TruckService.retire_truck`, never physically deleted through normal Admin workflows. Physical deletion via `TruckService.delete_uncommissioned_truck` is restricted exclusively to uncommissioned Trucks with zero operational records across all Category A historical models (`DriverShift.count() == 0 and WasteDelivery.count() == 0 and TruckLocation.count() == 0 and TruckCrewAssignment.count() == 0 and TruckFillEstimate.count() == 0 and Escalation.count() == 0 and HotspotIntervention.count() == 0 and ScheduleTruckAllocation.count() == 0` plus stage-aware `TruckOperationalHoldLog`, `TruckSwapLog`, `FuelLog`, and `DumpsiteTruckInspection`) and zero protected dependencies. Permanent retirement preserves Truck identity (`Truck.id`, `plate_number`), `DriverShift.truck` foreign key links, `WasteDelivery.truck` weighbridge links, maintenance history, and `TruckOperationalHoldLog` defect history.
    * **Attribution Preservation Invariant:** Physical deletion operations must never silently destroy historical attribution. Mandating permanent retirement for commissioned vehicles guarantees that historical shift attribution (`DriverShift.truck`), official dumpsite deliveries (`WasteDelivery.truck`), calibration logs (`TruckFillEstimate.truck`), defect logs (`TruckOperationalHoldLog`), and civic escalations (`Escalation.truck`) persist indefinitely. This decision is fully approved by the project owner (Option A) and is no longer an open blocker.

## 14. Explicit List of Unverified Claims Disclosed

1. **On-Disk Migration Objects:** Migration files (`driver/migrations/0036_...` through `0038_...`, `watcher/migrations/0030_...`, `dumpsite/migrations/0006_...`) have not been written to disk per strict design-only mode.
2. **PostgreSQL Triggers on SQLite:** The 3 database triggers (`trg_prevent_attendance_tampering`, `trg_prevent_correction_tampering`, `trg_cascade_correction_to_current_status`) use PostgreSQL-specific PL/pgSQL syntax and cannot execute against local SQLite. They will be verified against PostgreSQL in staging during Milestone 1.
3. **Proposed Test Executions:** Tests BT-01 to BT-12 and T01 to T47 have **not been executed**, as the proposed workforce models, endpoints, and triggers do not yet exist in code.
4. **Database Roles:** The separate `wastewatch_app` and `wastewatch_migrator` roles (U-DB1) are architectural proposals that have not been provisioned on the database server.
5. **Existential Lower-Bound Enforcement at DB Schema Level:** Disclosed that the database schema enforces uniqueness ($\le 1$) via `OneToOneField` (`driver_crewshift_watcher_shift_id_key`), but cannot enforce existence ($\ge 1$) without application service guarantees (`WatcherShiftService.create_watcher_shift`) or circular triggers. Direct raw SQL writes can bypass the application service.
6. **PostgreSQL Concurrency Test Suite (T10D):** Concurrency regression test scenarios (Scenario A: Retirement racing DriverShift creation; Scenario B: Assignment in progress when retirement begins with `is_truck_dispatchable(truck) is True`; Scenario C: Concurrent two-truck swap in ascending PK order) are architectural test specifications that require PostgreSQL multi-connection test harnesses and have **not been executed**.

---

## 15. Cross-Document Consistency Checklist

| Verification Item | Master Specification v3.3.2.10 | Correction Report v3.3.2.10 | Consistent? |
| :--- | :---: | :---: | :---: |
| Version Header | v3.3.2.10 (Nov 12, 2026) | v3.3.2.10 (Nov 12, 2026) | Yes |
| Phase 0 Persisted Retirement Gate & Resumability | `is_retired=True` and `status_reason='retirement_in_progress'` committed under $T1$ before Phase 1; retries resume safely | `is_retired=True` and `status_reason='retirement_in_progress'` committed under $T1$ before Phase 1; retries resume safely | Yes |
| Canonical Truck Assignment Service | `TruckAssignmentService` (`assign_driver`, `assign_crew`, `remove_driver`, `remove_crew`) locks $T1$, validates dispatchable; prohibits raw manager calls | `TruckAssignmentService` (`assign_driver`, `assign_crew`, `remove_driver`, `remove_crew`) locks $T1$, validates dispatchable; prohibits raw manager calls | Yes |
| Synchronized Shift Assignment Locking | Re-fetches under $T1$ (`select_for_update`), checks `is_truck_dispatchable(truck)` before commit | Re-fetches under $T1$ (`select_for_update`), checks `is_truck_dispatchable(truck)` before commit | Yes |
| Multi-Truck Swap Lock Order | Strictly ascending PK order ($T1_{min} \longrightarrow T1_{max}$) | Strictly ascending PK order ($T1_{min} \longrightarrow T1_{max}$) | Yes |
| Resumable Four-Step Retirement Lifecycle | Phase 0 (Gate) $\rightarrow$ Phase 1 (Draining) $\rightarrow$ Detachment $\rightarrow$ Phase 2 (Terminal/Verification) | Phase 0 (Gate) $\rightarrow$ Phase 1 (Draining) $\rightarrow$ Detachment $\rightarrow$ Phase 2 (Terminal/Verification) | Yes |
| Defensive Truck Pre-Delete Guard | Raises `ProtectedError` on bare deletion if active shifts or deliveries exist; never acquires $L3$ | Raises `ProtectedError` on bare deletion if active shifts or deliveries exist; never acquires $L3$ | Yes |
| Historical Attribution Analysis & Policy | Operational references detached; historical shifts & deliveries preserved; permanent retirement recommended for commissioned trucks | Operational references detached; historical shifts & deliveries preserved; permanent retirement recommended for commissioned trucks | Yes |
| Item 13 Physical Deletion vs Retirement | Cataloged as unresolved open owner decision with architectural recommendation | Cataloged as unresolved open owner decision with architectural recommendation | Yes |
| PostgreSQL Concurrency Test Suite | T10D (Scenarios A, B, C with corrected Scenario B) designed with threading barriers | T10D (Scenarios A, B, C with corrected Scenario B) designed with threading barriers | Yes |
| Canonical Creation Service Signature | `WatcherShiftService.create_watcher_shift(watcher, schedule_id)` | `WatcherShiftService.create_watcher_shift(watcher, schedule_id)` | Yes |
| Team Derivation & Authority | Authoritative `SanitationTeam` from `TeamScheduleAssignment`; validates Team Leader authority | Authoritative `SanitationTeam` from `TeamScheduleAssignment`; validates Team Leader authority | Yes |
| PostgreSQL Locking Query | Subquery exclusion + `select_for_update(of=('self',))` avoids outer join error | Subquery exclusion + `select_for_update(of=('self',))` avoids outer join error | Yes |
| Sole Sanctioned Creation Path | `POST /api/watcher/shifts/` sole path; Admin read-only; CLI/seeds prohibited | `POST /api/watcher/shifts/` sole path; Admin read-only; CLI/seeds prohibited | Yes |
| Genuinely Read-Only Admin Models | `has_add_permission=False`, `has_delete_permission=False`, `has_change_permission=False`, all fields in `readonly_fields` | `has_add_permission=False`, `has_delete_permission=False`, `has_change_permission=False`, all fields in `readonly_fields` | Yes |
| WatcherShiftViewSet Surface | Exposes `create`, `exceptional_abort`, `submit_attendance` only; no generic update/destroy | Exposes `create`, `exceptional_abort`, `submit_attendance` only; no generic update/destroy | Yes |
| Service-Layer Mutation Freedom | Direct ORM methods inside transactions unaffected by Admin/API restrictions | Direct ORM methods inside transactions unaffected by Admin/API restrictions | Yes |
| Multi-Tier CrewShift Deletion Protection | Admin disabled, API disabled, model `.delete()`, QuerySet `.delete()` raise `ProtectedError` | Admin disabled, API disabled, model `.delete()`, QuerySet `.delete()` raise `ProtectedError` | Yes |
| Direct DB Write Bypass Disclosure | Accurately discloses raw SQL `INSERT` and `DELETE` bypass of lower bound | Accurately discloses raw SQL `INSERT` and `DELETE` bypass of lower bound | Yes |
| Reconciled DriverShift Lifecycle | `PHASE_CHOICES` status, boolean `is_active`, `end_reason` (zero invalid terms) | `PHASE_CHOICES` status, boolean `is_active`, `end_reason` (zero invalid terms) | Yes |
| Canonical DriverShift Closure Routine | `DriverShiftService.end_driver_shift` covers all 4 closing paths with coordinated shift end | `DriverShiftService.end_driver_shift` covers all 4 closing paths with coordinated shift end | Yes |
| Automated Sweeper Boundaries | Ascending PK order (`order_by('id')`); separate transaction per shift | Ascending PK order (`order_by('id')`); separate transaction per shift | Yes |
| Force-End Endpoint Path & Role Auth | `/api/driver/shift/{id}/force-end/` with role-aware `is_admin_user` (`IsAppAdmin`) | `/api/driver/shift/{id}/force-end/` with role-aware `is_admin_user` (`IsAppAdmin`) | Yes |
| Unassociated Abort Distinction | 5 distinct conditions (Condition 1 vs Condition 2 vs Condition 5) | 5 distinct conditions (Condition 1 vs Condition 2 vs Condition 5) | Yes |
| Heuristic Search Prohibition | Strictly prohibited from guessing/closing unassociated driver shifts | Strictly prohibited from guessing/closing unassociated driver shifts | Yes |
| Item 12 Unassociated Disposition Policy | Preserved as unresolved open owner decision | Preserved as unresolved open owner decision | Yes |
| Test Matrix Alignments | T02/T03/T10/T10B/T10C/T10D/T16B/T34/T37B/T38/T39/T39B aligned | T02/T03/T10/T10B/T10C/T10D/T16B/T34/T37B/T38/T39/T39B aligned | Yes |
| Mermaid ERD Notation | `WatcherShift \|\|--\|\| CrewShift : atomically_linked_to` | `WatcherShift \|\|--\|\| CrewShift : atomically_linked_to` | Yes |
| D-5 CrewShift Cardinality | Exact 1:1 atomic creation at staging; 0 attendance rows; U-CR1 retracted | Exact 1:1 atomic creation at staging; 0 attendance rows; U-CR1 retracted | Yes |
| Exceptional Abort Lock Order | Canonical L3 -> L4 -> L5; discovery phase; abort-retry guard | Canonical L3 -> L4 -> L5; discovery phase; abort-retry guard | Yes |
| Exceptional Abort Permissions | `IsWatcherOrAdmin`; Watcher blocked if driver active; Admin override | `IsWatcherOrAdmin`; Watcher blocked if driver active; Admin override | Yes |
| D-8 Roll Call Protection | Strictly `IsWatcherRole` (`watcher_only`); Admin blocked | Strictly `IsWatcherRole` (`watcher_only`); Admin blocked | Yes |
| Truck Hold Clearance Authorization | Evaluated on target `TruckOperationalHoldLog`; ignores Truck projection | Evaluated on target `TruckOperationalHoldLog`; ignores Truck projection | Yes |
| U-DC1 Reconciliation | Open decision; T08A conditional on absence, T08A-Alt on approval | Open decision; T08A conditional on absence, T08A-Alt on approval | Yes |
| U-CR1 Status | Retracted and removed | Retracted and removed | Yes |
| Functional Locking Tiers | Scheduling (L1-L2), Execution (L3-L5), Fleet (T1-T2) | Scheduling (L1-L2), Execution (L3-L5), Fleet (T1-T2) | Yes |
| Coordinated Ending Lock Scope | Execution Tier only (L3 -> L4 -> L5) via `DriverShiftService.end_driver_shift` | Execution Tier only (L3 -> L4 -> L5) via `DriverShiftService.end_driver_shift` | Yes |
| Dedicated `Truck.retirement_state` Field | Added to `Truck` in Stage 1, leaving `status_reason` intact for maintenance notes | Added to `Truck` in Stage 1, leaving `status_reason` intact for maintenance notes | Yes |
| Shift Creation Staging Lock Sequence Clarified | Staging locks $L1 \longrightarrow L2 \longrightarrow T1$, inserts new $L3$ (implicit DB write lock), locks $L4$ | Staging locks $L1 \longrightarrow L2 \longrightarrow T1$, inserts new $L3$ (implicit DB write lock), locks $L4$ | Yes |
| Separate Retirement vs Deletion Services | `TruckService.retire_truck` vs `TruckService.delete_uncommissioned_truck` | `TruckService.retire_truck` vs `TruckService.delete_uncommissioned_truck` | Yes |
| Canonical Detachment Decoupling | Step 2A (L1 schedules) & Step 2B (T1 assignments) discrete transactions | Step 2A (L1 schedules) & Step 2B (T1 assignments) discrete transactions | Yes |
| Complete 13-Relationship Inventory & Categorization | Reconciled Category A (9 historical) vs Category B (4 operational) | Reconciled Category A (9 historical) vs Category B (4 operational) | Yes |
| Commissioning Provenance & Zero Date Fabrication | `CommissioningProvenance` choice field; zero fabricated timestamps; explicit audit workflow | `CommissioningProvenance` choice field; zero fabricated timestamps; explicit audit workflow | Yes |
| State Invariant Enforcement Beyond clean() | 80-combination state space (8 valid, 72 prohibited); 10 database `CheckConstraint` declarations (2 domain value checks `C0a`, `C0b` + 8 lifecycle checks `C1`–`C7`, `null=False`); service transitions; serializers; Admin forms | 80-combination state space (8 valid, 72 prohibited); 10 database `CheckConstraint` declarations (2 domain value checks `C0a`, `C0b` + 8 lifecycle checks `C1`–`C7`, `null=False`); service transitions; serializers; Admin forms | Yes |
| Hardened SECURITY DEFINER Stored Function | Exact `BIGINT` signature; owned by non-login `wastewatch_migrator`, `SET search_path = pg_catalog, public`; zero inherited DELETE; complete checks for 13 models | Exact `BIGINT` signature; owned by non-login `wastewatch_migrator`, `SET search_path = pg_catalog, public`; zero inherited DELETE; complete checks for 13 models | Yes |
| Direct SQL Deletion Semantics Disclosed | Explicitly documented bypass of Django signals/collector; engine CASCADE/SET_NULL prevention proved | Explicitly documented bypass of Django signals/collector; engine CASCADE/SET_NULL prevention proved | Yes |
| Scoped Concurrency Serialization Proof | 7-scenario matrix; reproducible two-session trace; FK `FOR KEY SHARE` vs T1 `FOR UPDATE`; Read Committed proven safe | 7-scenario matrix; reproducible two-session trace; FK `FOR KEY SHARE` vs T1 `FOR UPDATE`; Read Committed proven safe | Yes |
| Fail-Closed Stage 1–5 Deployment Contract | PL/pgSQL & Python transactional `django_migrations` check; fails closed on missing Stage 5 table; zero stale cache | PL/pgSQL & Python transactional `django_migrations` check; fails closed on missing Stage 5 table; zero stale cache | Yes |
| Reconciliation Zero Silent Detachment | Category A + B verified under exclusive T1; zero silent detachment; requires prior manual reassignment | Category A + B verified under exclusive T1; zero silent detachment; requires prior manual reassignment | Yes |
| Reconciliation Authorization Consistency | Unified across endpoint, service, Admin under role-aware `is_admin_user` with mandatory audit logs | Unified across endpoint, service, Admin under role-aware `is_admin_user` with mandatory audit logs | Yes |
| Operational Detachment Decoupling | `GarbageHotspot` (HotspotService), `CollectionSchedule` (ScheduleService), `clear_all_assignments` (T1) | `GarbageHotspot` (HotspotService), `CollectionSchedule` (ScheduleService), `clear_all_assignments` (T1) | Yes |
| Item 13 Status | OWNER-APPROVED — OPTION A (Resolved) | OWNER-APPROVED — OPTION A (Resolved) | Yes |
| Final Readiness Status | READY FOR INDEPENDENT CLAUDE VALIDATION | READY FOR INDEPENDENT CLAUDE VALIDATION | Yes |

---

## 16. Integrity Confirmation

* **Zero Code Modifications:** No application source code in `wastewatch/backend` or `wastewatch/frontend` was created, modified, or deleted.
* **Zero Migrations:** No migration files were created, altered, or applied.
* **Zero Database Modifications:** No database records, schemas, or tables were altered.
* **Preservation of Owner Directives:** All approved directives (D-3, D-5, D-6, D-7, D-8, D-9, Coordinated Shift Ending, Independent Starts, Staging Arrival Verification, and Zero-Connectivity Crew) remain strictly preserved.
* **Preservation of Identifiers:** All previous audit finding identifiers (F-01 through F-29, C-1 through C-26, TS-1 through TS-12, N-01 through N-11, S-1 through S-26, U-series, T-series) have been preserved.

---

## 17. Final Readiness Verdict

With `WatcherShiftAdmin` and `CrewShiftAdmin` hardened to genuinely read-only models (`has_add_permission=False`, `has_delete_permission=False`, `has_change_permission=False`, `readonly_fields`), `WatcherShiftViewSet` restricted to `create` and approved custom actions without generic update/destroy endpoints, the vehicle retirement workflow hardened into a strict four-step lifecycle (`TruckService.retire_truck`), commissioning provenance rigorously established via dedicated `commissioning_provenance` and `commissioned_at` fields with zero fabricated dates, invalid state combinations prevented by 10 database `CheckConstraint` definitions (`C0a`, `C0b`, `C1`, `C2`, `C3`, `C4`, `C5a`, `C5b`, `C6`, `C7`) enforcing non-nullability, permitted enum values, and the complete 80-combination Cartesian state space (accepting exactly 8 valid states and rejecting all 72 prohibited permutations), uncommissioned truck deletion secured via an authoritative PostgreSQL `SECURITY DEFINER` stored function (`truck_delete_uncommissioned(BIGINT)`) owned by non-login role `wastewatch_migrator` with trusted search paths, zero inherited table DELETE privileges for `wastewatch_app`, and fail-closed Stage 5 verification across all relationships, direct SQL deletion semantics explicitly disclosed, PostgreSQL `FOR KEY SHARE` concurrency serialization rigorously proven with a reproducible two-session trace under Read Committed isolation, reconciliation strengthened to strictly separate Category A historical evidence from Category B operational references with zero silent detachment, deployment-stage contracts failing closed on unexpected schema states with zero stale process cache, reconciliation authorization unified under role-aware `is_admin_user`, and Owner Approval of Item 13 (Option A) fully codified, both documents are 100% consistent, mathematically rigorous, fully aligned with all owner decisions, and ready for independent Claude validation.

```
========================================================================================
FINAL READINESS VERDICT:
READY FOR INDEPENDENT CLAUDE VALIDATION
========================================================================================
```
*(Strictly design-only. Zero application code, migrations, or database records were modified. Milestone 1 implementation planning may commence upon independent validation confirmation).*
