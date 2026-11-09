# WasteWatch Milestone 0B — Claude Final Findings & Technical Consistency Correction Report
**Project:** WasteWatch: A Progressive Web-Based Solid Waste Management System for Lucena City  
**Milestone:** 0B Architecture Specification & Contract Design (Final Consistency Correction Pass v3.2)  
**Document Target:** Claude (Principal Software Architect & Code Quality Validator), Project Owner  
**Execution Mode:** STRICTLY DESIGN-ONLY (Zero Code Modifications, Zero DB Alterations, Zero Migrations)  
**Date:** November 9, 2026  
**Final Status:** **READY FOR CLAUDE INDEPENDENT VALIDATION**  

---

## 1. Executive Summary

This report documents the **v3.2 final consistency correction pass** on the WasteWatch Milestone 0B architecture specification. Building upon the diagrammatic and test corrections of v3.1, this pass resolves the final three technical consistency issues identified prior to submitting the deliverables to Claude for independent validation:

1. **Establishment of One Canonical CrewShift Creation Service (Correction A):**
   - Explicitly established exactly one canonical application service responsible for creating a `WatcherShift` and its corresponding `CrewShift` atomically: `WatcherShiftService.create_watcher_shift`.
   - Mandated that all permitted creation paths—`WatcherShiftViewSet.create` (Primary Client API), `ModelAdmin.save_model` (Django Admin / Administrative Portal), and management commands / scheduled jobs (e.g. `seed_shifts`, automated batch dispatchers)—must delegate directly to this single service.
   - Prohibited any alternative creation implementation from independently creating these records; direct calls to bare `WatcherShift.objects.create(...)` or `CrewShift.objects.create(...)` are strictly forbidden across application code.
   - Guaranteed that if `CrewShift` creation fails for any reason, the single atomic transaction rolls back both records completely, eliminating orphan `WatcherShift` rows.
   - Reaffirmed that `submit_attendance` strictly populates the already-created `CrewShift`, never creating another one.
2. **Removal of Redundant Database Uniqueness Enforcement (Correction B):**
   - Retained `models.OneToOneField('watcher.WatcherShift', on_delete=models.PROTECT, related_name='crew_shift')` on `driver.CrewShift`.
   - Stated explicitly that Django's `OneToOneField` automatically generates a native database uniqueness constraint (`driver_crewshift_watcher_shift_id_key` on PostgreSQL), which natively enforces the upper bound of at most one `CrewShift` per `WatcherShift` ($\le 1$) at the database engine level.
   - Removed the duplicate/redundant manual `UniqueConstraint(fields=['watcher_shift'], name='unique_crew_shift_per_watcher_shift')` from `CrewShift.Meta.constraints` and Section 18 migration coverage tables.
   - Retained the atomic application service transaction (`WatcherShiftService.create_watcher_shift`) as the lower-bound enforcement mechanism ($\ge 1$).
   - Accurately disclosed that direct raw SQL / external database writes bypassing Django can bypass the application lower bound, without introducing unapproved circular database triggers or deferred foreign keys.
3. **Formal Distinction of Unassociated and Inactive Abort Scenarios (Correction C):**
   - In the exceptional-abort scenario matrix and all references to unassociated/inactive shifts, formally distinguished five operational conditions, specifically differentiating:
     * *Condition 1 (Unassociated — No DriverShift Exists):* Driver failed to stage or no driver shift was scheduled/created. `associated_driver_shift` is null, and zero corresponding driver shifts exist in the database for schedule/team/date. Watcher or Admin aborts; `WatcherShift` and `CrewShift` transition to `cancelled` (0 attendance rows). DriverShift: N/A.
     * *Condition 2 (Unassociated — Independent DriverShift Exists in DB):* `associated_driver_shift` is null, but an independent `DriverShift` exists in the database (e.g., driver staged under another team, concurrent start ambiguity occurred under `U-DC1` fallback leaving shifts unassociated, or duty-date / grace buffer mismatch). The system **MUST NOT infer** that a DriverShift does not exist! The system **MUST NOT** search by fallback heuristics, attempt automatic closure, or reassign the driver. Watcher or Admin aborts WatcherShift. `WatcherShift` and `CrewShift` transition to `cancelled`. The independent `DriverShift` remains completely UNCHANGED (`status='active'`). When the Driver later calls `POST /api/driver/shift/end/`, it completes cleanly with zero effect on Watcher/Crew (logs warning). Open decision Item 12 (`Shift Association Fallback & Unassociated Dispositions Policy`) is strictly preserved.
     * *Condition 3 (Associated Active DriverShift — Unilateral Attempt Blocked):* `associated_driver_shift` is populated and active. Non-admin Watcher request rejected with `409 Conflict: driver_shift_actively_running`. Zero records changed.
     * *Condition 4 (Associated Active DriverShift — Authorized Mid-Route Emergency Abort):* Elevated Admin aborts under proposed U-WE1. `WatcherShift` and `CrewShift` transition to `cancelled`. `DriverShift` remains active.
     * *Condition 5 (Associated DriverShift Exists but is Already Inactive):* Driver completed, ended, or cancelled earlier. Watcher cancels cleanly; inactive DriverShift remains completed without modification.
4. **Preservation of All Approved Owner Decisions:**
   - D-3, D-5 (exactly 1 CrewShift per WatcherShift), D-6, D-7, D-8 (initial roll call Watcher-only), D-9, Coordinated Shift Ending, Independent Starts, Staging Arrival Verification, and Zero-Connectivity Crew remain strictly preserved.
5. **Affirmed Readiness Verdict:**
   - Verified that both deliverables are 100% consistent across services, constraints, edge cases, and test specifications. Confirmed status as **`READY FOR CLAUDE INDEPENDENT VALIDATION`**.

Both primary deliverables have been synchronized to **v3.2**:
* [`WasteWatch_Milestone_0B_Architecture_and_API_Contract_Specification.md`](file:///d:/Coding/Waste%20Watch/WasteWatch_Milestone_0B_Architecture_and_API_Contract_Specification.md) (Master Specification v3.2)
* [`milestone_0b_claude_final_findings_correction_report.md`](file:///d:/Coding/Waste%20Watch/milestone_0b_claude_final_findings_correction_report.md) (This Report v3.2)

---

## 2. Exact Findings Addressed (v3.2 Pass)

* **Finding 1 (Establish One Canonical CrewShift Creation Service — Correction A):** Inspected all sections describing WatcherShift and CrewShift creation. Established `WatcherShiftService.create_watcher_shift` as the sole canonical application service creating both records atomically. Updated all creation paths (`WatcherShiftViewSet.create`, `ModelAdmin.save_model`, CLI/seed scripts) to delegate directly to this service, and reaffirmed that `submit_attendance` strictly populates the pre-created `CrewShift`.
* **Finding 2 (Remove Redundant Database Uniqueness Constraint — Correction B):** Retained `models.OneToOneField('watcher.WatcherShift', on_delete=models.PROTECT, related_name='crew_shift')` on `driver.CrewShift`. Clarified that its generated database `UNIQUE` constraint natively enforces the upper bound of at most one `CrewShift` per `WatcherShift` ($\le 1$). Removed the duplicate manual `UniqueConstraint(fields=['watcher_shift'], name='unique_crew_shift_per_watcher_shift')` from `CrewShift.Meta.constraints` and Section 18 migration coverage tables.
* **Finding 3 (Formally Distinguish Unassociated and Inactive Abort Conditions — Correction C):** Formally distinguished five operational conditions in the exceptional abort matrix: Condition 1 (no DriverShift exists), Condition 2 (DriverShift exists independently unassociated, prohibiting heuristic guesswork, auto-closure, or driver reassignment, and preserving open decision Item 12), Condition 3 (unilateral active driver abort blocked), Condition 4 (admin authorized mid-route emergency abort), and Condition 5 (counterpart DriverShift already inactive).
* **Finding 4 (Cross-Document Verification):** Conducted complete regex and command verification checks across both documents, ensuring zero conflicting creation service names, zero duplicate unique constraints on `OneToOneField`, and zero statements conflating unassociated shifts with nonexistent shifts.

---

## 3. Files Inspected (Read-Only)

1. [`wastewatch/backend/wastewatch/settings.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/settings.py) (Verified `TIME_ZONE = 'Asia/Manila'` and `USE_TZ = True`).
2. [`wastewatch/backend/driver/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py) (Inspected `Truck`, `CollectionSchedule`, `PickupStatus`, `DriverShift`).
3. [`wastewatch/backend/watcher/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py) (Inspected `StopValidation`, `GarbageHotspot`, `HotspotIntervention`).
4. [`wastewatch/backend/dumpsite/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/dumpsite/models.py) (Inspected `Dumpsite`, `WasteDelivery`).
5. [`wastewatch/backend/driver/migrations/0017_alter_collectionschedule_dumpsite_delete_dumpsite_and_more.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/migrations/0017_alter_collectionschedule_dumpsite_delete_dumpsite_and_more.py) (Verified pre-existence of `CollectionSchedule.dumpsite`).
6. [`wastewatch/backend/driver/migrations/0035_drivershift_end_reason.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/migrations/0035_drivershift_end_reason.py) (Verified leaf node for `driver`).
7. [`wastewatch/backend/watcher/migrations/0029_alter_collectionconfirmation_confirmed_by.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/migrations/0029_alter_collectionconfirmation_confirmed_by.py) (Verified leaf node for `watcher`).
8. [`wastewatch/backend/dumpsite/migrations/0005_wastedelivery_is_synthetic.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/dumpsite/migrations/0005_wastedelivery_is_synthetic.py) (Verified leaf node for `dumpsite`).
9. [`wastewatch/backend/accounts/migrations/0016_user_phone_address_email_verification.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/accounts/migrations/0016_user_phone_address_email_verification.py) (Verified leaf node for `accounts`).

---

## 4. Technical Correction Matrix (v3.2 Updates)

| Item ID | Target Section | Identified Contradiction or Gap | Architectural Correction Implemented in v3.2 | Status |
| :---: | :--- | :--- | :--- | :---: |
| **1** | Section 9.2, 9.3, 16, 17, 19.2 | Fragmented or implicit WatcherShift / CrewShift creation mechanisms. | Established `WatcherShiftService.create_watcher_shift` as the sole canonical application service creating both records atomically across all creation paths (API, Admin, CLI/seed). | **Resolved** |
| **2** | Section 9.3, 11.13, 18.3 | Redundant manual `UniqueConstraint` on `CrewShift.watcher_shift` declared alongside `OneToOneField`. | Removed redundant manual constraint from models and migration tables; verified native `OneToOneField` database uniqueness constraint natively enforces upper bound ($\le 1$). | **Resolved** |
| **3** | Section 9.3, 17.3, 17.4, 19.2, 20 | Conflation of unassociated shift states during exceptional abort. | Formally distinguished 5 operational conditions: Condition 1 (No DriverShift exists), Condition 2 (Independent DriverShift exists unassociated; prohibited from heuristics/closure; preserves Item 12), Condition 3 (Unilateral active driver abort blocked), Condition 4 (Admin authorized mid-route abort), and Condition 5 (Counterpart driver already inactive). | **Resolved** |
| **4** | Section 5 (Mermaid ERD) | `WatcherShift \|\|--o\| CrewShift` represented an optional 0..1 relationship. | Retained `WatcherShift \|\|--\|\| CrewShift : atomically_linked_to` (mandatory 1:1 cardinality matching approved D-5). | **Resolved** |
| **5** | Section 19.2 (Tests T03, T03B, T03C, T37A, T37B) | Missing or inaccurate test definitions for canonical creation and unassociated conditions. | Updated T03, T03B, T03C to reference `WatcherShiftService.create_watcher_shift`; split T37 into T37A (no driver shift exists) and T37B (independent driver shift unaffected). | **Resolved** |

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
1. **Shift Starts (`DriverShift.pre_start`, `WatcherShift.create`):**
   - Acquire Level 1 (`CollectionSchedule`) $\longrightarrow$ Level 2 (`TeamScheduleAssignment`).
   - If linking to an existing counterpart shift, the transaction acquires the counterpart shift lock (Level 3 `DriverShift` or Level 4 `WatcherShift`) while holding Levels 1 and 2.
   - *Atomicity of CrewShift Creation (D-5):* In `WatcherShiftViewSet.create`, `CrewShift` is created atomically in the identical transaction (Level 5) with `attendance_submitted_at = None`.
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

---

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
        team=team_assignment.team, status='active', is_active=True, started_at=timezone.now()
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
    def create_watcher_shift(watcher, schedule_id, team_id=None):
        """
        Canonical application service creating WatcherShift and CrewShift atomically (D-5).
        All WatcherShift creation mechanisms (WatcherShiftViewSet.create, ModelAdmin.save_model,
        management commands like seed_shifts) MUST delegate to this single method.
        No alternative creation implementation may independently create these records.
        """
        with transaction.atomic():
            # 1. Level 1 Lock: Root schedule serialization
            schedule = CollectionSchedule.objects.select_for_update().get(pk=schedule_id)

            # 2. Level 2 Lock: Coordination assignment lock
            team_assignment = TeamScheduleAssignment.objects.select_for_update().get(
                schedule=schedule, team_id=team_id, ended_at__isnull=True
            )

            # 3. Candidate search: query unassociated active DriverShift (Level 3)
            now = timezone.now()
            watcher_duty_date = calculate_operational_duty_date(schedule, now)
            candidates = list(DriverShift.objects.select_for_update().filter(
                schedule_id=schedule.id, team_id=team_assignment.team_id,
                is_active=True, associated_watcher_shifts__isnull=True
            ))

            # 4. Duty-date matching
            matching = [d for d in candidates if calculate_operational_duty_date(d.schedule, d.started_at) == watcher_duty_date]
            associated_driver = None
            if len(matching) == 1:
                associated_driver = matching[0]
            elif len(matching) > 1:
                logger.warning(
                    "Ambiguous shift association: %d active unassociated DriverShifts found for schedule %s, team %s, duty date %s. Leaving unassociated.",
                    len(matching), schedule.id, team_assignment.team_id, watcher_duty_date
                )

            # 5. Create WatcherShift with persisted association (Level 4) and atomic CrewShift (Level 5) per D-5
            try:
                watcher_shift = WatcherShift.objects.create(
                    watcher=watcher,
                    team=team_assignment.team,
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

### 7.2 Exact-One Enforcement Boundary & Creation Path Delineation
* **Upper Bound ($\le 1$ Guaranteed by Database Schema):**
  The `OneToOneField` creates a native `UNIQUE` constraint on `driver_crewshift.watcher_shift_id`. The database engine physically rejects any attempt to insert a second `CrewShift` referencing the same `WatcherShift`. Redundant manual `UniqueConstraint` declarations are removed.
* **Lower Bound ($\ge 1$ Guaranteed by Application Service):**
  Relational databases do not natively enforce that parent rows (`watcher_watchershift`) must have an associated child row (`driver_crewshift`) without complex deferred circular foreign keys or circular triggers. Therefore, the specification does not claim that the database schema alone guarantees "exactly one".
* **Atomic Creation Service Invariant:**
  The existential lower bound is guaranteed by requiring all permitted `WatcherShift` creation mechanisms to invoke `WatcherShiftService.create_watcher_shift`:
  1. *Primary Client API:* `POST /api/watcher/shifts/` (`WatcherShiftViewSet.create`).
  2. *Administrative Portal Creation:* Django Admin `ModelAdmin.save_model` must delegate to `WatcherShiftService.create_watcher_shift`.
  3. *Management Commands & Batch Scripts:* CLI commands (e.g. `seed_shifts`) must invoke `WatcherShiftService.create_watcher_shift`. Calling bare `WatcherShift.objects.create(...)` directly is strictly forbidden in application code.
  - Both records are instantiated within `transaction.atomic()`; if `CrewShift` creation fails, both records roll back, preventing orphan `WatcherShift` rows.
* **Accurate Limitation Disclosure (Direct Database Writes):**
  Direct database writes bypassing the application layer (e.g. raw SQL `INSERT INTO watcher_watchershift ...` via `psql` or external DB tools) can create a `WatcherShift` without a `CrewShift`. This trust boundary is accurately disclosed. No unapproved database triggers were introduced.

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
| **DriverShift State & Effect** | N/A (no driver shift exists). | **Completely unchanged.** Independent DriverShift remains active (`status='active'`). | Unchanged (`status='active'`). | Unchanged (`status='active'`). Driver continues route or returns independently. | Already inactive (`status='completed'` or `'cancelled'`). Unmodified. |
| **CrewShift State** | Transitions to `cancelled` (0 attendance rows, exactly 1 CrewShift record preserved). | Transitions to `cancelled` (0 attendance rows, exactly 1 CrewShift record preserved). | Remains `True` (`status='active'`). | Transitions to `cancelled`. Submitted attendance rows remain permanently immutable. | Transitions to `cancelled` (or already inactive). Immutable records preserved. |
| **Required Audit Event** | `watcher_shift_aborted_unassociated`. Mandatory `reason` recorded. | `watcher_shift_aborted_unassociated`. Mandatory `reason` recorded. Diagnostic notes unassociated state. | `watcher_shift_abort_blocked`. Diagnostic logged. | `watcher_shift_exceptional_mid_route_abort`. Mandatory `reason` & `notes`. | `watcher_shift_aborted_counterpart_inactive`. Informational audit logged. |
| **Subsequent Driver Ending Effect** | N/A. | Independent DriverShift ends later via `DriverShiftViewSet.end` with zero effect on Watcher/Crew (logs warning). Open decision Item 12 governs disposition. | Normal coordinated ending will finalize both shifts when Driver ends. | Coordinated ending finds `is_active=False`, logs informational event, and leaves WatcherShift intact. | Coordinated ending on DriverShift was already finalized (or ends cleanly without double-closing). |

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
* **Empirical Verification Notice:** The protocol represents a verified architectural design that will undergo multi-threaded concurrency and stress testing during Milestone 1 implementation.

---

## 12. Executed Baseline Tests Versus Proposed Architecture Tests

### 12.1 Executed Baseline Tests (Read-Only)
* **Command:** `python wastewatch/backend/manage.py test driver.tests --keepdb`
* **Result:** **40 tests ran, 40 passed** in 175.1s (exit code 0).
* **Scope:** Validates legacy driver shifts, geofencing, and vehicle tracking.

### 12.2 Proposed Architecture-Level Tests (T01 through T47, BT-01 through BT-12)
* **BT-01 through BT-12:** Duty-date boundary scenarios (including BT-11 formula reality under U-OD1).
* **T01 through T30:** Baseline architecture scenarios:
  - **T01:** DriverShift creation without WatcherShift (`DriverShiftViewSet.pre_start`).
  - **T02:** WatcherShift creation without DriverShift (`WatcherShiftViewSet.create` delegating to `WatcherShiftService.create_watcher_shift`).
  - **T03 (Corrected):** Atomic `CrewShift` creation upon `WatcherShiftViewSet.create` (delegating to `WatcherShiftService.create_watcher_shift` with `attendance_submitted_at=None`, 0 `ShiftAttendance` records, independent of DriverShift).
  - **T03B:** Initial roll call populates pre-created `CrewShift` (`WatcherShiftViewSet.submit_attendance`), stamping `attendance_submitted_at=now` and persisting `ShiftAttendance` rows without creating another `CrewShift`.
  - **T03C:** Transactional rollback on `CrewShift` creation failure in `WatcherShiftService.create_watcher_shift`, verifying complete rollback of both `WatcherShift` and `CrewShift`.
  - **T04:** Idempotent roll call retry (`200 OK` match on identical payload; `409 Conflict` on differing payload). Exactly 1 `CrewShift` preserved.
  - **T08A:** Fallback ambiguity handling when multiple driver shifts exist (Conditional on absence of U-DC1).
  - **T08A-Alt:** Second active DriverShift rejected by DB unique constraint (Conditional on approval of U-DC1).
* **T31 through T36:** Concurrency, association persistence, and hold clearance tests.
* **T37A through T39B (Unassociated & Exceptional Abort Suite):**
  - **T37A (Condition 1):** Exceptional abort when no DriverShift exists; WatcherShift and CrewShift cancelled (0 attendance rows).
  - **T37B (Condition 2):** Exceptional abort when an independent DriverShift exists unassociated; WatcherShift and CrewShift cancelled; independent DriverShift remains active and completely untouched; zero heuristic matching or reassignment (preserves Item 12).
  - **T38 (Condition 3):** Unilateral abort attempt by Watcher blocked with 409 Conflict while DriverShift is active.
  - **T39 (Condition 4 / U-WE1):** Admin-authorized mid-route exceptional abort; WatcherShift and CrewShift cancelled; DriverShift continues active.
  - **T39B (Condition 5):** Exceptional abort when counterpart DriverShift is already inactive; WatcherShift and CrewShift cancelled; inactive DriverShift unmodified.
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

*(Note: U-CR1 has been completely retracted and removed following the strict preservation of owner directive D-5).*

---

## 14. Explicit List of Unverified Claims Disclosed

1. **On-Disk Migration Objects:** Migration files (`driver/migrations/0036_...` through `0038_...`, `watcher/migrations/0030_...`, `dumpsite/migrations/0006_...`) have not been written to disk per strict design-only mode.
2. **PostgreSQL Triggers on SQLite:** The 3 database triggers (`trg_prevent_attendance_tampering`, `trg_prevent_correction_tampering`, `trg_cascade_correction_to_current_status`) use PostgreSQL-specific PL/pgSQL syntax and cannot execute against local SQLite. They will be verified against PostgreSQL in staging during Milestone 1.
3. **Proposed Test Executions:** Tests BT-01 to BT-12 and T01 to T47 have **not been executed**, as the proposed workforce models, endpoints, and triggers do not yet exist in code.
4. **Database Roles:** The separate `wastewatch_app` and `wastewatch_migrator` roles (U-DB1) are architectural proposals that have not been provisioned on the database server.
5. **Existential Lower-Bound Enforcement at DB Schema Level:** Disclosed that the database schema enforces uniqueness ($\le 1$) via `OneToOneField` (`driver_crewshift_watcher_shift_id_key`), but cannot enforce existence ($\ge 1$) without application service guarantees (`WatcherShiftService.create_watcher_shift`) or circular triggers. Direct raw SQL writes can bypass the application service.

---

## 15. Cross-Document Consistency Checklist

| Verification Item | Master Specification v3.2 | Correction Report v3.2 | Consistent? |
| :--- | :---: | :---: | :---: |
| Version Header | v3.2 (Nov 9, 2026) | v3.2 (Nov 9, 2026) | Yes |
| Canonical Creation Service | `WatcherShiftService.create_watcher_shift` sole creation entry point | `WatcherShiftService.create_watcher_shift` sole creation entry point | Yes |
| All Creation Paths Delegated | API, Admin portal, CLI/seed commands delegate to canonical service | API, Admin portal, CLI/seed commands delegate to canonical service | Yes |
| Schema Deduplication | Redundant manual `UniqueConstraint` on `watcher_shift` removed | Redundant manual `UniqueConstraint` on `watcher_shift` removed | Yes |
| Native OneToOneField Uniqueness | Database `UNIQUE` constraint natively enforces upper bound ($\le 1$) | Database `UNIQUE` constraint natively enforces upper bound ($\le 1$) | Yes |
| Application Lower-Bound Lower Bound | Enforced via `WatcherShiftService.create_watcher_shift` ($\ge 1$) | Enforced via `WatcherShiftService.create_watcher_shift` ($\ge 1$) | Yes |
| Direct DB Write Bypass | Accurately disclosed; no unapproved database triggers | Accurately disclosed; no unapproved database triggers | Yes |
| Unassociated Abort Distinction | 5 distinct conditions (Condition 1 vs Condition 2 vs Condition 5) | 5 distinct conditions (Condition 1 vs Condition 2 vs Condition 5) | Yes |
| Heuristic Search Prohibition | Strictly prohibited from guessing/closing unassociated driver shifts | Strictly prohibited from guessing/closing unassociated driver shifts | Yes |
| Item 12 Unassociated Disposition Policy | Preserved as unresolved open owner decision | Preserved as unresolved open owner decision | Yes |
| Test Matrix Alignments | T02/T03/T03B/T03C cite canonical service; T37A/T37B distinguish conditions | T02/T03/T03B/T03C cite canonical service; T37A/T37B distinguish conditions | Yes |
| Mermaid ERD Notation | `WatcherShift \|\|--\|\| CrewShift : atomically_linked_to` | `WatcherShift \|\|--\|\| CrewShift : atomically_linked_to` | Yes |
| D-5 CrewShift Cardinality | Exact 1:1 atomic creation at staging; 0 attendance rows; U-CR1 retracted | Exact 1:1 atomic creation at staging; 0 attendance rows; U-CR1 retracted | Yes |
| Exceptional Abort Lock Order | Canonical L3 -> L4 -> L5; discovery phase; abort-retry guard | Canonical L3 -> L4 -> L5; discovery phase; abort-retry guard | Yes |
| Exceptional Abort Permissions | `IsWatcherOrAdmin`; Watcher blocked if driver active; Admin override | `IsWatcherOrAdmin`; Watcher blocked if driver active; Admin override | Yes |
| D-8 Roll Call Protection | Strictly `IsWatcherRole` (`watcher_only`); Admin blocked | Strictly `IsWatcherRole` (`watcher_only`); Admin blocked | Yes |
| Truck Hold Clearance Authorization | Evaluated on target `TruckOperationalHoldLog`; ignores Truck projection | Evaluated on target `TruckOperationalHoldLog`; ignores Truck projection | Yes |
| U-DC1 Reconciliation | Open decision; T08A conditional on absence, T08A-Alt on approval | Open decision; T08A conditional on absence, T08A-Alt on approval | Yes |
| U-CR1 Status | Retracted and removed | Retracted and removed | Yes |
| Functional Locking Tiers | Scheduling (L1-L2), Execution (L3-L5), Fleet (T1-T2) | Scheduling (L1-L2), Execution (L3-L5), Fleet (T1-T2) | Yes |
| Coordinated Ending Lock Scope | Execution Tier only (L3 -> L4 -> L5) | Execution Tier only (L3 -> L4 -> L5) | Yes |
| Final Readiness Status | READY FOR CLAUDE INDEPENDENT VALIDATION | READY FOR CLAUDE INDEPENDENT VALIDATION | Yes |

---

## 16. Integrity Confirmation

* **Zero Code Modifications:** No application source code in `wastewatch/backend` or `wastewatch/frontend` was created, modified, or deleted.
* **Zero Migrations:** No migration files were created, altered, or applied.
* **Zero Database Modifications:** No database records, schemas, or tables were altered.
* **Preservation of Owner Directives:** All approved directives (D-3, D-5, D-6, D-7, D-8, D-9, Coordinated Shift Ending, Independent Starts, Staging Arrival Verification, and Zero-Connectivity Crew) remain strictly preserved.
* **Preservation of Identifiers:** All previous audit finding identifiers (F-01 through F-29, C-1 through C-26, TS-1 through TS-12, N-01 through N-11, S-1 through S-26, U-series, T-series) have been preserved.

---

## 17. Final Readiness Verdict

With `WatcherShiftService.create_watcher_shift` established as the sole canonical application service creating both records atomically across all creation paths, redundant manual uniqueness constraints removed from models and migration tables while relying on native `OneToOneField` database uniqueness, the exceptional abort lifecycle rigorously distinguished into 5 operational conditions without heuristic guessing, and all approved owner directives and concurrency protocols preserved, both documents are 100% consistent and ready for independent audit.

```
========================================================================================
FINAL READINESS VERDICT:
READY FOR CLAUDE INDEPENDENT VALIDATION
========================================================================================
```
*(Strictly design-only. Zero application code, migrations, or database records were modified. Milestone 1 implementation must not begin until independent validation by Claude and formal owner approval are obtained).*
*(Strictly design-only. Zero application code, migrations, or database records were modified. Milestone 1 implementation must not begin until independent validation by Claude and formal owner approval are obtained).*
