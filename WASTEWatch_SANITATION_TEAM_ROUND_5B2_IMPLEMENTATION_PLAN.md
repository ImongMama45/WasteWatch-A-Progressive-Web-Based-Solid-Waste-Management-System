# WasteWatch Sanitation Team — Round 5B.2 Implementation Plan

**Workspace:** `D:\Coding\Waste Watch`  
**Execution Model:** Phase B coordinator-sequenced single designated implementation worker (with read-only specialist guidance), followed by Phase C focused SQLite + frontend verification and Phase D independent read-only Reviewers 1–3 & Challenger  
**Migration Policy:** **Zero new model/migration changes required.** Migrations `0047`, `0048`, `0049`, and `0050` remain untouched, and `makemigrations`/`migrate` must NOT be executed against the database (`makemigrations --check --dry-run` only if models change, which is not planned).  

---

## 1. Canonical Lock Hierarchy (Deadlock-Free Across All Services & Views)

Every `transaction.atomic()` path acquiring more than one row lock MUST acquire `select_for_update()` locks strictly in ascending order of the 12-level hierarchy below (and in ascending primary-key `order_by('id')` / `sorted(...)` order when locking multiple rows of the same model):

```text
Level 1:  CollectionSchedule (asc id)
Level 2:  SanitationTeam (asc id)
Level 3:  ScheduleTeamOverride (asc id)
Level 4:  ScheduleTruckAllocation (asc id)
Level 5:  Truck (asc id)
Level 6:  Worker (asc id)
Level 7:  SanitationTeamMembership (asc id)
Level 8:  DriverShift (asc id)
Level 9:  CrewShift (asc id)
Level 10: WatcherShift (asc id)
Level 11: TruckReplacementRequest (asc id)
Level 12: CrewAttendanceRecord (asc id)
```

### Mandatory Lock-Order Rules & Audit

| Service / View | Required Lock Sequence (Post-Phase B) | `of=` / Retry Notes |
|---|---|---|
| `TeamService.assign_member` | `SanitationTeam (2) -> Worker (6) -> SanitationTeamMembership (7)` | No joins on `FOR UPDATE`. |
| `TeamService.transfer_member` | `SanitationTeam (2, asc id) -> Worker (6) -> SanitationTeamMembership (7, asc id)` | 3-attempt `_ConcurrentMembershipMove` retry. |
| `TeamService.deactivate_member` | `SanitationTeam (2) -> Worker (6) -> SanitationTeamMembership (7)` | 3-attempt `_ConcurrentMembershipChange` retry. |
| `WorkerService.merge_workers` | `SanitationTeam (2, asc id) -> Worker (6, asc id) -> SanitationTeamMembership (7, asc id)` | Pre-read active `team_ids` for source & target; 3-attempt `_ConcurrentWorkerMerge` retry if memberships shift before lock. |
| `AllocationService.set_schedule_default_team` | `CollectionSchedule (1) -> SanitationTeam (2)` | Skip `sync_pickup_statuses()` via `update_fields=['default_team']`. |
| `AllocationService.create_schedule_override` | `CollectionSchedule (1) -> SanitationTeam (2) -> ScheduleTeamOverride (3)` | Reject past date and conflicts before insert. |
| `AllocationService.update_schedule_override` | `CollectionSchedule (1, asc id) -> SanitationTeam (2, asc id) -> ScheduleTeamOverride (3)` | Reorder `SanitationTeam` before `ScheduleTeamOverride` to match `create`; 3-attempt `_ConcurrentOverrideMove` retry. |
| `AllocationService.delete_schedule_override` | `CollectionSchedule (1) -> ScheduleTeamOverride (3)` | Add post-lock `override.schedule_id == observed['schedule_id']` check + 3-attempt retry. |
| `AllocationService.allocate_truck_for_schedule` | `CollectionSchedule (1) -> SanitationTeam (2) -> ScheduleTruckAllocation (4) -> Truck (5)` | Already compliant; add `CrewShift(allocation=...)` guard. |
| `AllocationService.update_truck_allocation` | `CollectionSchedule (1, asc id) -> SanitationTeam (2) -> ScheduleTruckAllocation (4) -> Truck (5)` | Already compliant; add `CrewShift(allocation=...)` guard. |
| `AllocationService.delete_truck_allocation` | `CollectionSchedule (1) -> ScheduleTruckAllocation (4) -> [Truck (5)]` | Add post-lock `schedule_id` revalidation + 3-attempt retry; lock `Truck` after `Allocation` to revert `op_status='AVAILABLE'` if idle. |
| `TruckService.replace_truck_assignment` | `CollectionSchedule (1) -> SanitationTeam (2) -> ScheduleTruckAllocation (4) -> Truck (5, asc pk) -> TruckReplacementRequest (11)` | Pre-check facility operator authz before/under `Schedule`; lock `TruckReplacementRequest` (`of=('self',)`) after `Truck` (no wildcard `schedule__isnull=True`). |
| `TruckReplacementRequestViewSet.approve` | Pre-read `req` (`schedule_id`, `truck_id`) -> delegate locking to `replace_truck_assignment` (`CollectionSchedule (1) -> ... -> Truck (5) -> TruckReplacementRequest (11, of=('self',))`) | Eliminates `TruckReplacementRequest -> CollectionSchedule` AB-BA deadlock and PG `NotSupportedError`; leaves `OD-2` `allocation_already_used` fail-closed `409`. |
| `TruckReplacementRequestViewSet.reject` | `TruckReplacementRequest (11, of=('self',))` | Add `of=('self',)` to avoid PG outer-join crash. |
| `ShiftService.stage_and_start_shift` | `CollectionSchedule (1) -> SanitationTeam (2) -> ScheduleTruckAllocation (4) -> Truck (5) -> Worker (6, asc id) -> SanitationTeamMembership (7, asc id) -> CrewShift (9) -> WatcherShift (10, of=('self',))` | Already in canonical order. |
| `ShiftService.record_deployment_attendance` | `CollectionSchedule (1) -> SanitationTeam (2) -> ScheduleTruckAllocation (4) -> Worker (6, asc id) -> SanitationTeamMembership (7, asc id) -> DriverShift (8) -> CrewShift (9) -> WatcherShift (10, of=('self',))` | Pre-read `DriverShift.allocation_id` when `driver_shift_id` is passed so `Allocation (4)` ALWAYS precedes `DriverShift (8)`; revalidate `shift.schedule_id` and `shift.allocation_id` under lock (3-attempt retry if changed). |
| `DriverShiftViewSet.pre_start_shift` & `start_shift` | Pre-read `target_schedule_id` -> single `transaction.atomic()` locking `CollectionSchedule (1)` (if known) -> `DriverShift (8, of=('self',))` -> delegate to `stage_and_start_shift` / `record_initial_attendance` | Eliminates `DriverShift -> CollectionSchedule` AB-BA deadlock and split-transaction double-click races; 3-attempt retry if active shift's schedule changed concurrently. |
| `WatcherShiftViewSet.start_shift` | *(Before `atomic`: `cleanup_stale_unlinked_watcher_shifts`)* -> `CollectionSchedule (1) -> SanitationTeam (2) -> Worker (6, asc id) -> SanitationTeamMembership (7, asc id) -> CrewShift (9, asc id) -> WatcherShift (10)` | Eliminates pre-lock leader TOCTOU and `WatcherShift -> CrewShift` inversion. |
| `ShiftService.conclude_shift_atomic` | `DriverShift (8) -> CrewShift (9, asc id) -> WatcherShift (10) -> [Truck (5)]` | Note: No service acquires `DriverShift FOR UPDATE` while holding `Truck FOR UPDATE` (`stage_and_start_shift` & `replace_truck_assignment` use unlocked `.exists()` checks on `DriverShift`), so `Truck` release at shift conclusion cannot deadlock. |
| `ShiftService.correct_attendance` | `CrewAttendanceRecord (12, of=('self',))` | Add `of=('self',)` on `.select_related('crew_shift')`. |

---

## 2. Phase B Execution Sequence (B1 -> B2 -> B3 -> B4)

A single implementation worker executes the steps below strictly in order, preserving all accepted Round 5B.1.2 invariants (`test_14`, `test_15`, `0047`–`0050`, `my_team_roster` authorization).

### Phase B1 — Worker & Membership Integrity
**Scope:** Confirmed defects `B1-01`..`B1-10` (plus `OD-1`/`OD-4` safe boundaries).

1. **`wastewatch/backend/driver/team_service.py`**:
   - `_validate_worker_role_eligibility` (`:220-252`): Require `getattr(linked_user, 'is_active', False)` whenever `linked_user` is present (`B1-01`).
   - `transfer_member` (`:351-355`): Check `if not worker.is_active:` under lock (`B1-02`).
   - `assign_member` (`:255, 310`) & `transfer_member` (`:314, 402`): Reject `None` `created_by`/`authorized_by` with `ValidationError` before `IntegrityError` (`B1-06`).
   - `assign_member`, `transfer_member`, `deactivate_member`: Emit `analytics.ActivityLog` audit entries (`module='Teams'`, action codes `'TEAM_MEMBER_ASSIGNED'`, `'TEAM_MEMBER_TRANSFERRED'`, `'TEAM_MEMBER_DEACTIVATED'`) (`B1-06` — zero migrations).
   - `is_worker_on_active_shift` (`:206-214`): Add `Q(snapshot__crew_shift__driver_shift__is_active=True)` to `ShiftCrewRosterItem` filter (`B1-09`).
2. **`wastewatch/backend/driver/worker_service.py`**:
   - `merge_workers` (`:56-107`):
     - Reject inactive `source_worker` (`not source_worker.is_active`) (`B1-04`).
     - Acquire locks in canonical `SanitationTeam (asc id) -> Worker (asc id) -> SanitationTeamMembership (asc id)` order with 3-attempt `_ConcurrentWorkerMerge` retry (`B1-04`).
     - Reject with `ActiveShiftConflictError` if either `source_worker` or `target_worker` is on an active shift (`TeamService.is_worker_on_active_shift`) (`B1-04`).
     - Reject if both `source_worker.user_id` and `target_worker.user_id` are non-null and distinct (`B1-04`).
     - When `source_worker` has an active `SanitationTeamMembership`: if `target_worker` has no active membership, validate `TeamService._validate_worker_role_eligibility(target_worker, src_membership.role_in_team)` (against target's effective `User` after any user transfer) and `target_worker.user.is_active`, deactivate `src_membership` (`is_active=False, left_at=now`), and create a new `SanitationTeamMembership` for `target_worker` (preserving membership history; requiring `resolved_by` non-null if creating membership) (`B1-04`).
     - Record `analytics.ActivityLog` audit entry (`'WORKER_MERGED'` with `notes`, `resolved_by`, `source_worker_id`, `target_worker_id`) and in `update_employee_id` (`'WORKER_EMPLOYEE_ID_UPDATED'` with `old_id`, `new_id`, `authorized_by`) (`B1-04`).
3. **`wastewatch/backend/driver/models.py`** (`Worker`, `SanitationTeamMembership`):
   - Add `clean()` on `SanitationTeamMembership` validating `team.is_active` (on active membership creation), `worker.is_active` (on active membership), `linked_user.is_active`, role eligibility, and blocking reactivation of an inactive historical row (`is_active: False -> True` with `left_at` set) (`B1-06`).
4. **`wastewatch/backend/driver/serializers.py`**:
   - `SanitationTeamSerializer._serialize_member` (`:828-829`): Return `'system_role': None` and `'employee_type': None` when `user is None` (`B1-07`).
   - `SanitationTeamMembershipSerializer` (`:784-799`): Add read-only `worker_system_role` (`source='worker.user.role'`, default `None`) and `worker_employee_type` (`source='worker.user.employee_type'`, default `None`) (`B1-07`).
5. **`wastewatch/backend/driver/views.py`**:
   - `WorkerViewSet` (`:4144-4349`): Restrict `GET` permissions to operational roles (`admin`, `dumpsite`, `watcher`, `driver`) per `OD-4` boundary; block direct `update`/`partial_update`/`destroy` bypasses (`405` or service-routed guards rejecting `is_active=False`/user swap/delete when on active shift or active membership, catching `ProtectedError` -> `409`); catch `ActiveShiftConflictError` -> `409` in `merge` (`:4325`); catch `ValueError` in `update_employee_id` (`:4344`); add `Q(snapshot__crew_shift__is_active=True)` in `get_serializer_context` (`:4283`) (`B1-04`, `B1-05`, `B1-10`).
   - `SanitationTeamViewSet` (`:4394-4530`): Restrict `GET` to operational roles; in `update`/`partial_update`, block `is_active=False` with `409` if team has active shifts, active memberships, or active non-cancelled default/override schedules; block `destroy` (`405`/`409` instead of `ProtectedError` 500); catch `ActiveShiftConflictError` -> `409` in `assign_member` (`:4498`) (`B1-05`).
   - `SanitationTeamMembershipViewSet` (`:4533-4571`): Restrict `GET` to operational roles.
6. **`wastewatch/backend/accounts/api_views.py` & `accounts/serializers.py`**:
   - On `UserViewSet.{update, partial_update, destroy}` (`:110-156`) and `AdminUserSerializer.update` (`:212-235`):
     - Under lock on `Worker` (`select_for_update`), block `is_active=False`, incompatible `role`/`employee_type` changes, or `destroy` if `TeamService.is_worker_on_active_shift(worker.id)` is `True` (`409 Conflict`).
     - Catch `ProtectedError` on `UserViewSet.destroy` and return `409 Conflict` (`B1-08`).
     - **STOP boundary (`OD-1`):** Outside an active shift, fail closed (`409` if user has an active `SanitationTeamMembership` incompatible with `is_active=False` or new `role`/`employee_type`, requiring team removal first) unless Owner approves auto-deactivation. *(Verify `accounts/tests.py` to confirm no existing test is broken by fail-closed rejection; if an existing test expects auto-deactivation, flag `OD-1` explicitly.)*
7. **`wastewatch/frontend/src/pages/admin/TeamManagement.jsx`**:
   - Update Tab 2 transfer payload (`:1898`) to read `worker_system_role` / `worker_employee_type` from `SanitationTeamMembershipSerializer` so `'leader'`, `'driver'`, and `'crew'` options render accurately in both Tab 1 and Tab 2 Transfer modals (`B1-07`).

---

### Phase B2 — Allocation, Fleet & Dumpsite Integrity
**Scope:** Confirmed defects `B2-01`..`B2-09` (preserving `OD-2` & `OD-3` boundaries).

1. **`wastewatch/backend/driver/models.py`** (`CollectionSchedule.save`, `sync_pickup_statuses`):
   - In `CollectionSchedule.save()` (`:369-371`): Inspect `update_fields = kwargs.get('update_fields')`; skip `self.sync_pickup_statuses()` when `update_fields is not None` and `not (set(update_fields) & {'waypoints', 'driver', 'days', 'date', 'status'})` (`B2-08`).
   - In `sync_pickup_statuses()` (`:373-418`): Wrap `ensure_stop_validations_for_schedule(self)` in `with transaction.atomic():` inside `try ... except Exception:` (preventing PostgreSQL `InFailedSqlTransaction`); if `self.driver_id is None`, skip legacy `PickupStatus` creation/update while still cleaning stale rows if any (`B2-08`, zero migrations).
2. **`wastewatch/backend/driver/allocation_service.py`**:
   - `get_preallocated_truck_for_driver` (`:491-494`): Add `team__is_active=True` filter (`B1-09`).
   - `create_schedule_override` (`:83-108`): Reject `effective_date < timezone.localdate()`, reject cancelled/completed schedules, and reject overwriting an existing `(schedule, effective_date)` override when `DriverShift`, `CrewShift(schedule=..., service_date=...)`, or `ScheduleTruckAllocation(schedule=..., allocation_date=...)` exists (`ActiveShiftConflictError` 409) (`B2-04`).
   - `update_schedule_override` (`:111-212`): Pre-read `team_id` and lock `CollectionSchedule (1) -> SanitationTeam (2) -> ScheduleTeamOverride (3)` in canonical order; reject `target_date < today`; check `DriverShift`, `CrewShift`, and `ScheduleTruckAllocation` on **both** old `(override.schedule_id, override.effective_date)` and target `(schedule.id, target_date)` (`B2-04`).
   - `delete_schedule_override` (`:214-242`) & `delete_truck_allocation` (`:464-480`): Add post-lock `schedule_id == observed['schedule_id']` check + 3-attempt `_Concurrent*Move` retry (`B2-02`); check `CrewShift(allocation=...)` in `delete_truck_allocation` (`B2-01`) and `CrewShift(schedule=..., service_date=...)` in `delete_schedule_override` (`B2-04`); after deleting allocation, lock `Truck (5)` and revert `truck.op_status = 'AVAILABLE'` if currently `'ASSIGNED'` with no active `DriverShift` and no remaining `ScheduleTruckAllocation(allocation_date__gte=today)` (`B2-07`).
   - `allocate_truck_for_schedule` (`:244-335`) & `update_truck_allocation` (`:338-461`):
     - Reject `allocation_date < today` (`effective_date`/`target_date < today` — wait: verify `test_allocation_service.py` dates `2026-11-20`/`2026-11-25` >= `2026-11-18`) and reject `schedule.status in ('CANCELLED', 'COMPLETED')` (`B2-05`).
     - Validate explicit `team_id` against `resolve_schedule_team(schedule_id, allocation_date)` so allocations cannot diverge from effective team (`B2-05`). *(Check `test_allocation_service.py:102-114` `sched_2` — it asserts generic `ValidationError`, which still passes!)*
     - Check `CrewShift.objects.filter(allocation=...)` alongside `DriverShift(allocation=...)` (`B2-01`).
     - When `update_truck_allocation` swaps `old_truck -> new_truck`, lock both trucks in ascending PK order and revert `old_truck.op_status` to `'AVAILABLE'` if idle (`B2-07`).
3. **`wastewatch/backend/driver/truck_service.py`**:
   - `replace_truck_assignment` (`:1451-1607`):
     - Add optional `replacement_request_id: int = None` parameter and perform facility-operator authz pre-check cleanly.
     - Check `CrewShift.objects.filter(allocation=existing_alloc).exists()` alongside `DriverShift(allocation=existing_alloc)` (`B2-01`).
     - Validate `old_truck` actually belongs to the deployment (`existing_alloc is not None or schedule.truck_id == old_truck.id`) and reject if `DriverShift.objects.filter(truck=old_truck, is_active=True).exists()` (`B2-07`).
     - Enforce `cls._current_other_facility_q(operator_facility_id, today=target_date)` on `old_truck` as well as `new_truck` (`B2-07`).
     - When `transfer_drivers=True`, validate `new_truck` driver capacity (`len <= 2`) *before* removing drivers from `old_truck` so drivers are never silently dropped (`B2-07`).
     - Replace wildcard `Q(schedule=schedule) | Q(schedule__isnull=True)` bulk update (`:1573-1583`) with canonical post-`Truck` `TruckReplacementRequest.objects.select_for_update(of=('self',))` scoping ONLY to `pk=replacement_request_id` (when called from `approve()`) or `schedule=schedule, truck=old_truck, status='PENDING'` (never matching `schedule__isnull=True` globally!) (`B2-06`).
   - `request_truck_replacement` (`:1610-1670`):
     - Reject retired or uncommissioned trucks (`TruckLifecycleConflictError` / `ValidationError`) (`B2-07`).
     - Validate `resolved_schedule_id` parses as positive `int` and exists in `CollectionSchedule` (returning `ValidationError`, never FK `IntegrityError` 500) (`B2-07`).
     - For `role == 'driver'`, require `role_in_team in ('driver', 'leader')` on `ScheduleTruckAllocation` team check and verify `resolved_schedule_id` (if supplied) matches the driver's active `DriverShift`, `ScheduleTruckAllocation`, or `CollectionSchedule(driver=user)` (`PermissionDenied` on cross-schedule spoofing) (`B2-07`).
4. **`wastewatch/backend/driver/views.py`**:
   - `CollectionScheduleViewSet.destroy` (`:917-934`): Lock `CollectionSchedule` -> check for `DriverShift(schedule=...)`, `DriverShift(allocation__schedule=...)`, `ScheduleTruckAllocation(schedule=...)`, `CrewShift(schedule=...)`, `CrewShift(allocation__schedule=...)`, or `TruckReplacementRequest(schedule=...)`; reject with `409 Conflict` instead of cascading `SET_NULL` or raising 500 `ProtectedError` (`B2-03`).
   - `CollectionScheduleViewSet.resolve_team` (`:936-946`): Use `schedule = self.get_object()` instead of `int(pk)` so queryset scoping is enforced (`B2-04`).
   - `CollectionScheduleViewSet.allocate_truck` (`:997`) & `ScheduleTruckAllocationViewSet.{create, update}` (`:4740, 4782`): Pass `truck=truck_obj` to `TruckService.require_admin_or_facility_operator(...)` (and validate `truck_id` exists -> `404`/`400`) to enforce cross-facility truck isolation (`B2-07`).
   - `DriverShiftViewSet.request_truck_replacement` (`:3035-3075`): Parse `driver_shift_id` and `schedule_id` safely (`400` on invalid int), require `is_active=True` when `driver_shift_id` is supplied (`B2-07`).
   - `TruckReplacementRequestViewSet.get_queryset` (`:5060-5065`): For `UserRole.DUMPSITE`, include `Q(schedule__dumpsite_id=fac_id) | Q(schedule__isnull=True, truck__in=...)` (matching `TruckService.get_operator_dumpsite_id` facility scoping without exposing other facilities) (`B2-07`).
   - `TruckReplacementRequestViewSet.approve` (`:5100-5198`) & `.reject` (`:5206-5235`):
     - In `reject`: add `of=('self',)` (`TruckReplacementRequest.objects.select_for_update(of=('self',)).select_related('schedule', 'truck')`) (`B2-06`).
     - In `approve`: Do NOT lock `TruckReplacementRequest` before `replace_truck_assignment`! Pre-read `req_meta = TruckReplacementRequest.objects.select_related('schedule', 'truck', 'driver_shift__allocation').filter(pk=pk).first()` unlocked, validate `req_meta` status/authz/schedule pre-checks, and execute `TruckService.replace_truck_assignment(..., replacement_request_id=req_meta.id)` which locks `CollectionSchedule -> SanitationTeam -> ScheduleTruckAllocation -> Truck -> TruckReplacementRequest (of=('self',))` inside a single `transaction.atomic()` (`B2-06`). **STOP boundary (`OD-2`):** Continue returning `409 allocation_already_used` when `req.driver_shift.allocation` is already referenced by a `DriverShift`.
   - Residual `Dumpsite` fallbacks (`B2-09`):
     - `DriverShiftViewSet.shift_status` (`:3752-3762`): Resolve dumpsite from `shift.effective_dumpsite` (falling back to `shift.schedule.dumpsite` only if `effective_dumpsite` is `None`; do NOT search arbitrary `CollectionSchedule(driver=request.user)`!).
     - `_check_home_base_proximity` (`:3308-3325`): Check `target_schedule.dumpsite` coordinates first before `waypoints[0]`.
     - `HomeBaseView.put` (`:4127-4135`): When `apply_to_existing=True`, skip schedules with `dumpsite__isnull=False` so dumpsite-anchored route bases are never clobbered.

---

### Phase B3 — Shift Lifecycle, Concurrency & PostgreSQL Safety
**Scope:** Confirmed defects `B3-01`..`B3-07` (plus `B1-03` & `B4-03` backend parts).

1. **`wastewatch/backend/driver/shift_service.py`**:
   - `stage_and_start_shift`:
     - Validate `schedule.status not in ('CANCELLED', 'COMPLETED')` and `schedule.is_available` (`B3-04`).
     - Recheck `driver_worker.is_active`, `driver_user.is_active`, and (when `driver_membership.role_in_team == 'driver'`) `getattr(driver_user, 'role', '') == 'driver'` under lock (`B1-03`).
     - Validate all crew/manifested workers (`m.worker.is_active` and `not m.worker.user_id or getattr(m.worker.user, 'is_active', False)`) under lock (`B1-03`).
     - When `existing_crew_shift` is found on `allocation` (`:226-230, 309-325`), assert `existing_crew_shift.team_id == effective_team.id` and `existing_crew_shift.team_leader_id == team_leader_user.id` (`B3-06`).
   - `record_deployment_attendance` (`:363-663`):
     - Enforce canonical lock order: `CollectionSchedule (1) -> SanitationTeam (2) -> ScheduleTruckAllocation (4) -> Worker (6, asc id) -> SanitationTeamMembership (7, asc id) -> DriverShift (8) -> CrewShift (9) -> WatcherShift (10, of=('self',))` (if `driver_shift_id` is passed, pre-read `allocation_id` / `schedule_id` to lock `Allocation` before `DriverShift`, then revalidate `shift.schedule_id == schedule.id` and `shift.allocation_id == allocation.id` under lock with 3-attempt retry) (`B3-03`).
     - Re-resolve `resolve_deployment_team_leader(schedule, target_date)` *after* locking `SanitationTeam -> Worker -> SanitationTeamMembership` (`B3-03`).
     - Filter `all_memberships` for active `Worker` (`m.worker.is_active`) and active linked `User` (`not m.worker.user_id or getattr(m.worker.user, 'is_active', False)`), and reject if any crew member is already on another active shift (`is_worker_on_active_shift`) (`B1-03`, `B3-03`).
   - `correct_attendance` (`:738-741`): Add `of=('self',)` to `CrewAttendanceRecord.objects.select_related('crew_shift').filter(id=attendance_record_id).select_for_update(of=('self',))` (`B3-05`).
   - `cleanup_stale_unlinked_watcher_shifts` (`:981-1026`): Extend to close orphaned prior-date pre-departure `CrewShift(driver_shift__isnull=True, is_active=True, service_date__lt=today)` (and their linked prior-date `WatcherShift` with `end_reason='stale_unlinked_cleanup'`), leaving `CrewAttendanceRecord` and `ShiftCrewRosterSnapshot` untouched and never touching same-day (`service_date >= today`) `CrewShift`s (`B3-01`).
2. **`wastewatch/backend/driver/views.py`**:
   - `WatcherShiftViewSet.start_shift` (`:4875-4969`):
     - Move `cleanup_stale_unlinked_watcher_shifts` *before* `with transaction.atomic():` (`B3-02`).
     - Parse `schedule_id` as positive `int` (`400` on invalid) (`B3-02`).
     - Inside `transaction.atomic()`, follow canonical lock order `CollectionSchedule (1) -> SanitationTeam (2) -> Worker (6, asc id) -> SanitationTeamMembership (7, asc id) -> CrewShift (9, asc id) -> WatcherShift (10)` and resolve/revalidate `resolve_deployment_team_leader(schedule, today)` *under lock* (`B3-02`).
   - `DriverShiftViewSet.pre_start_shift` (`:3091-3238`) & `start_shift` (`:3284-3456`):
     - Execute active-shift check and staging/starting inside a **single** `with transaction.atomic():`, locking `CollectionSchedule` before `DriverShift` (via pre-read `observed_schedule_id` + 3-attempt retry if shift changed concurrently) so `DriverShift -> CollectionSchedule` AB-BA deadlock and double-click `400` races are eliminated (`B3-04`).
     - On existing active `DriverShift`, validate: `shift.schedule_id is not None` (if `requested_schedule_id` given), `allocation_id` matches `shift.allocation_id` (`409` on mismatch), `is_truck_dispatchable(shift.effective_truck)`, `resolve_schedule_team(shift.schedule_id, today)` matches `shift.effective_team`, and `schedule.status not in ('CANCELLED', 'COMPLETED')` & `schedule.is_available` (`B3-04`).
     - In `start_shift` (`:3348-3356`), do not overwrite `started_at` or reset `op_status='on_duty'` if `shift.status == 'shiftroute'` and `shift.started_at` is already set (`B3-04`).
     - On initial paths (`:3168-3206, 3388-3430`), reject `schedule.status in ('CANCELLED', 'COMPLETED')` or `not schedule.is_available` (`B3-04`).
   - `DriverShiftViewSet.dev_reset` (`:2204-2210`): Skip `DriverShift.delete()` (or raise `409` in non-SQLite/protected-audit cases) when `ShiftCrewRosterSnapshot` / `CrewAttendanceRecord` rows exist on those shifts (`B3-07`).
   - `CollectionScheduleViewSet.get_queryset` (`:848-850`): Include `role_in_team__in=('driver', 'leader')` for Driver-Team Leaders (`B4-03`).
   - `_resolve_driver_today_schedule` (`:261-327`) & `DriverShiftViewSet.current` (`:2248-2297`): Support team/allocation/override-assigned schedules via `ScheduleTruckAllocation` / `SanitationTeamMembership(role_in_team__in=('driver', 'leader'))` / `ScheduleTeamOverride` when `CollectionSchedule.driver` is `None` or different, while preserving legacy `TruckCrewAssignment` / `CollectionSchedule.driver` compatibility (`B4-03`).

---

### Phase B4 — Frontend Allocation-Aware Workflow
**Scope:** Confirmed defects `B4-01`..`B4-06` + `B2-09` frontend base resolution.

1. **`wastewatch/frontend/src/utils/driverSchedule.js`** & **`wastewatch/frontend/src/pages/driver/RouteOverview.jsx`**:
   - `resolveDriverSchedule()` (`driverSchedule.js:121-133`): Remove the strict `String(s.driver) === String(userId)` filter (since `CollectionScheduleViewSet.get_queryset` already scopes returned schedules to the authenticated driver's active shifts, crew assignments, allocations, overrides, default teams, and legacy `driver` field); filter only `s && s.status !== 'CANCELLED'` (`B4-03`).
   - `RouteOverview.jsx:459`: Remove `.filter(s => String(s.driver) === String(user.id))` for the same reason (`B4-03`).
2. **`wastewatch/frontend/src/hooks/useShiftTimer.js`**:
   - Track `allocationId` in `EMPTY_STATE` and `applyShiftPayload` (`shift.allocation_id ?? shift.allocation ?? null`), update `startShift` JSDoc (`:132`), and add `syncShiftPayload` / expose `refresh` cleanly without firing duplicate bare `start/` calls (`B4-05`).
3. **`wastewatch/frontend/src/pages/driver/components/AssignmentModule.jsx`**:
   - Query `getPreallocatedTruck(schedule.id)` (`driverWorkflowApi.js`) whenever `schedule?.id` changes (`B4-01`).
   - Gate `#start-duty-btn` (fail closed) and show clear inline error if allocation lookup fails (e.g., `400` multiple allocations) or `has_allocation === false` (`B4-01`).
   - Include `allocation_id: allocation.id` in `POST /api/driver/shift/pre_start/` (`:627-637`), dispatch `window.dispatchEvent(new Event('ww_shift_updated'))` on success, use `getApiErrorMessage(err)` (`notificationHelpers.js`) to surface DRF field-keyed errors (`allocation_id`, `team`, `truck`, `worker_id`), and refresh `getPreallocatedTruck` on `400`/`409` errors (`B4-01`).
4. **`wastewatch/frontend/src/pages/driver/components/CheckInModule.jsx`**:
   - Pass `schedule_id: shift?.schedule_id ?? shift?.schedule ?? null` and `allocation_id: shift?.allocation_id ?? shift?.allocation ?? null` to `POST /api/driver/shift/start/` (refusing to fire if `schedule_id` is missing rather than posting a bare shift start) (`B4-02`).
   - Remove the duplicate unawaited bare `startShift()` calls (`:271, 279, 557`) and dead `ww_shift_start_*` `localStorage` check (`:262`), syncing `useShiftTimer` instead via `refresh()` / `window.dispatchEvent(new Event('ww_shift_updated'))` (`B4-02`).
   - Use `getApiErrorMessage(err)` (`:282`) so DRF field errors surface cleanly (`B4-02`).
5. **`wastewatch/frontend/src/pages/dashboard/DriverDashboard.jsx`**:
   - Track `allocationLoading` and `allocationError`; do NOT swallow `preallocated-truck` `400` errors into `allocation = null` with an enabled start button (`B4-04`).
   - Surface DRF field-keyed errors via `getApiErrorMessage(err)` and re-fetch `preallocated-truck` & `collection-schedules` on start failure (`B4-04`).
   - Add an in-flight `starting` state guard to `handleShiftToggle` and `#driver-main-cta` (`disabled={starting || loading || ...}`) for parity with `handleCarouselStartRoute` (`B4-04`).
   - Include `activeScheduleId` cleanly in initial schedule resolution (`B4-04`).
6. **`wastewatch/frontend/src/pages/driver/components/NavigateToBaseModule.jsx` & `EndShiftModule.jsx`**:
   - Resolve base location using `routeBaseHelpers.js` / `match.dumpsite_detail` first before falling back to `match.waypoints[0]` (`B2-09`).

---

## 3. Phase C Focused Verification Plan

Run strictly after Phase B1–B4 edits (SQLite only; PostgreSQL concurrency/triggers explicitly documented as unverified).

### Backend Focused Test Suites (from `wastewatch/backend`)
```powershell
.\venv\Scripts\python.exe manage.py test driver.tests.test_worker_foundation driver.tests.test_team_management driver.tests.test_team_leader_attendance driver.tests.test_allocation_service driver.tests.test_shift_lifecycle driver.tests.test_shift_attendance_workflow driver.tests.test_shift_schedule_guards driver.tests.test_shift_schedule_resolution driver.tests.test_critical_invariants driver.tests.test_team_fleet_operational_closure driver.tests.test_truck_lifecycle_stage1 driver.tests.test_truck_retirement_closure_and_authz driver.tests.test_operational_security driver.tests.test_schedule_api driver.tests.test_truck_api accounts.tests dumpsite.tests_facility_operations
```
- **New/Extended Regression Tests Required in Phase B:**
  1. `driver/tests/test_team_management.py` & `test_worker_foundation.py`: `assign_member`/`transfer_member` rejecting inactive `User` and inactive `Worker`; `created_by=None` raising `ValidationError`; `merge_workers` active-shift `409`, distinct-user block, eligibility check, history (`left_at`), and `ActivityLog` creation; `WorkerViewSet`/`SanitationTeamViewSet` `PATCH`/`DELETE` bypass protection; `SanitationTeamSerializer` `system_role=None` for unlinked crew & `SanitationTeamMembershipSerializer` role fields; `UserViewSet` active-shift `409` and `ProtectedError` -> `409`.
  2. `driver/tests/test_allocation_service.py` & `test_team_fleet_operational_closure.py`: `CrewShift(allocation=...)` blocking allocation update/upsert/delete/replace (`409`); `delete_truck_allocation`/`delete_schedule_override` retry; `create_schedule_override`/`update_schedule_override` past-date/target-date/allocation/CrewShift blocks; `CollectionScheduleViewSet.destroy` `409` when shifts/allocations/requests exist; `resolve_team` queryset scoping; cross-facility truck isolation in `allocate_truck` & `ScheduleTruckAllocationViewSet`; `CollectionSchedule.save()` with `driver=None` & `len(waypoints) > 1` not crashing; `request_truck_replacement` active-shift/invalid-ID/cross-schedule/retired-truck guards; `approve`/`reject` `of=('self',)` SQL inspection + lock-order inspection.
  3. `driver/tests/test_shift_lifecycle.py`, `test_shift_schedule_guards.py`, & `test_critical_invariants.py`: prior-date pre-departure `CrewShift` closed by `cleanup_stale_unlinked_watcher_shifts`/`sweep_stale_shifts` (unblocking next-day `WatcherShiftViewSet.start_shift` and `transfer_member`); `WatcherShiftViewSet.start_shift` lock order (`CrewShift -> WatcherShift`), invalid `schedule_id` (`400`), under-lock leader revalidation; `record_deployment_attendance` inactive crew rejection, active-shift conflict, `shift.schedule_id` check; `pre_start_shift`/`start_shift` mismatched `allocation_id` (`409`), post-stage truck-hold/inactive-team/cancelled-schedule rejection, `started_at` preservation; `WorkerViewSet` `on_active_shift=True` for pre-departure `CrewShift` crew; `shift_status` `heading_to_dumpsite` using `effective_dumpsite`.
  4. `test_critical_invariants.py`: Fix `test_13` docstring/call parity (or add explicit `my_team_roster` `RuntimeError` propagation check alongside `test_14`/`test_15`).

### Frontend Focused Tests & Build (from `wastewatch/frontend`)
- Add `wastewatch/frontend/src/utils/__tests__/driverSchedule.test.js` (`node --test`) verifying team/override/allocation schedules (`s.driver === null`).
- Add `wastewatch/frontend/src/pages/driver/__tests__/allocationShiftFlow.test.js` (`node --test`) verifying `AssignmentModule.jsx`, `CheckInModule.jsx`, `DriverDashboard.jsx`, `useShiftTimer.js`, `NavigateToBaseModule.jsx`, and `EndShiftModule.jsx` allocation/dumpsite/error contracts.
- Execute all `node --test` files under `wastewatch/frontend/src/**/__tests__/*.test.js` and `npm run build` (`vite build`).
- **Condition:** Run `makemigrations --check --dry-run` ONLY if any model definition changed (none planned).

---

## 4. Phase D Independent Review Gate

After Phase C passes, assign independent read-only reviewers inspecting actual changed files and test results:
- **Reviewer 1 (Backend Integrity):** B1 & B2 (`team_service.py`, `worker_service.py`, `allocation_service.py`, `truck_service.py`, `models.py`, `serializers.py`, `accounts/`).
- **Reviewer 2 (Shift Lifecycle & Concurrency):** B3 (`shift_service.py`, `sweep_stale_shifts.py`, `views.py` shift/watcher/replacement locking & `of=('self',)`).
- **Reviewer 3 (Frontend & API Integration):** B4 (`driverSchedule.js`, `RouteOverview.jsx`, `useShiftTimer.js`, `AssignmentModule.jsx`, `CheckInModule.jsx`, `DriverDashboard.jsx`, `TeamManagement.jsx`, `NavigateToBaseModule.jsx`, `EndShiftModule.jsx`, plus backend API contract).
- **Challenger (Adversarial Review):** Attempt to bypass B1–B4 invariants, verify zero unapproved business policies (`OD-1`..`OD-4` respected), verify initial vs final `git status --short` preserves staged `0036`–`0050`, Round 5B.1.2 baseline, and unrelated workspace files.
