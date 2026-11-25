# WasteWatch — PostgreSQL Test Isolation and Concurrency Cleanup Correction Report

**Project:** WasteWatch — Progressive Web-Based Solid Waste Management System (Lucena City)  
**Workspace:** `D:\Coding\Waste Watch\wastewatch`  
**Branch:** `codex-refactored`  
**Date (UTC):** 2026-11-20  
**Database Engine Verified:** PostgreSQL (`django.db.backends.postgresql`, configured DB `wastewatch_test`, ephemeral test DB `test_wastewatch_test`)  
**Final Status:** **PASS**

---

## 1. Original Failures and Root Causes

### 1.1 Failing Test Targets (Pre-Fix Gate A Baseline)
Before the correction, executing Gate A on PostgreSQL (`test_wastewatch_test`) produced **3 errors** across **3 discovered tests**, while every test method body printed `ok` before teardown:

1. `notifications.tests_truck_near.PostgreSQLTruckNearIntegrationTests.test_concurrent_truck_near_pings_postgresql` — method body assertions passed (`ok`), then `_fixture_teardown()` failed (`ERROR`).
2. `notifications.tests_deduplication.PostgreSQLIntegrationTests.test_concurrent_expired_key_replacement_postgresql` — method body assertions passed (`ok`), then `_fixture_teardown()` failed (`ERROR`).
3. `notifications.tests_deduplication.PostgreSQLIntegrationTests.test_pruning_savepoint_recovery_aborted_transaction_postgresql` — method body assertions passed (`ok`), then `_fixture_teardown()` failed (`ERROR`).

### 1.2 Root Cause Analysis
- **Missing `_fixture_teardown()` Override on `TransactionTestCase` Subclasses:** Both [tests_truck_near.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/notifications/tests_truck_near.py) (`PostgreSQLTruckNearIntegrationTests`) and [tests_deduplication.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/notifications/tests_deduplication.py) (`PostgreSQLIntegrationTests`) inherited directly from `django.test.TransactionTestCase` without overriding `_fixture_teardown()`.
- **Django `flush` Generates Whole-Schema `TRUNCATE`:** After each `TransactionTestCase` method returns, `TransactionTestCase._post_teardown()` invokes `_fixture_teardown()`, which runs `call_command('flush', ...)`. On PostgreSQL, `sql_flush()` generates a single `TRUNCATE` statement spanning all Django-managed tables, including `crew_attendance_record`, `crew_attendance_correction`, `shift_crew_roster_snapshot`, and `shift_crew_roster_item`.
- **Statement-Level `BEFORE TRUNCATE` Immutability Triggers:**
  - Migration [0042_alter_crewattendancecorrection_options_and_more.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/driver/migrations/0042_alter_crewattendancecorrection_options_and_more.py) installs `prevent_attendance_mutation()` with `BEFORE UPDATE OR DELETE` (row) and `BEFORE TRUNCATE ... FOR EACH STATEMENT` triggers on `crew_attendance_record` and `crew_attendance_correction`.
  - Migration [0044_drivershift_end_reason_notes_and_more.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/driver/migrations/0044_drivershift_end_reason_notes_and_more.py) installs `prevent_roster_mutation()` with `BEFORE UPDATE OR DELETE` (row) and `BEFORE TRUNCATE ... FOR EACH STATEMENT` triggers on `shift_crew_roster_snapshot` and `shift_crew_roster_item`.
  - In PostgreSQL, `BEFORE TRUNCATE ... FOR EACH STATEMENT` triggers fire even when the target tables contain zero rows. Consequently, `flush` aborted unconditionally with `psycopg2.errors.RaiseException` wrapped as `CommandError: Database test_wastewatch_test couldn't be flushed.`
- **Verification of `SELECT 1 / 0;` Savepoint Recovery:** In `test_pruning_savepoint_recovery_aborted_transaction_postgresql`, the `DivisionByZero` SQL error is deliberately injected by `rejected_sql_filter` (`cursor.execute("SELECT 1 / 0;")`) when `_maybe_prune_expired_records()` queries `NotificationDeduplication.objects.filter(expires_at__lt=...)` inside a nested `with transaction.atomic():` savepoint in [deduplication.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/notifications/deduplication.py). The inner savepoint rolls back, `except Exception:` logs the expected traceback, and the outer transaction continues cleanly (`b.save()`, `Barangay.objects.get(...)`, and `NotificationDeduplication.objects.filter(...)` all succeed). This is intentional test coverage, not a production defect.
- **Cross-Suite Coexistence Constraint (Gate B):** In Gate B, [test_pg_concurrency.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/driver/tests/test_pg_concurrency.py) (`DriverRound5B2ConflictAndPGConcurrencyTests`) intentionally leaves its own UUID-tagged rows (including immutable `CrewAttendanceRecord` and `ShiftCrewRosterSnapshot` rows) in PostgreSQL. Broad `.all().delete()` calls on shared tables (`User`, `Barangay`, `DriverShift`, `CollectionSchedule`) inside notification teardown would collide with those rows (`ProtectedError` or trigger exceptions). Cleanup in both notification classes therefore had to be strictly scoped to each class's own records.

---

## 2. Files Inspected and Modified

### 2.1 Files Inspected (Read-Only)
- [tests_truck_near.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/notifications/tests_truck_near.py)
- [tests_deduplication.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/notifications/tests_deduplication.py)
- [tests_phase2_postgres_concurrency.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/notifications/tests_phase2_postgres_concurrency.py)
- [deduplication.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/notifications/deduplication.py)
- [services.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/notifications/services.py)
- [test_pg_concurrency.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/driver/tests/test_pg_concurrency.py)
- [0042_alter_crewattendancecorrection_options_and_more.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/driver/migrations/0042_alter_crewattendancecorrection_options_and_more.py)
- [0044_drivershift_end_reason_notes_and_more.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/driver/migrations/0044_drivershift_end_reason_notes_and_more.py)
- [models.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py)
- [WASTEWatch_POSTGRESQL_GATE_REMEDIATION_REPORT.md](file:///D:/Coding/Waste%20Watch/WASTEWatch_POSTGRESQL_GATE_REMEDIATION_REPORT.md)
- [WASTEWatch_SANITATION_TEAM_ROUND_5B2_COMPLETION_REPORT.md](file:///D:/Coding/Waste%20Watch/WASTEWatch_SANITATION_TEAM_ROUND_5B2_COMPLETION_REPORT.md)

### 2.2 Files Modified
| File | Scope of Change |
| :--- | :--- |
| [tests_truck_near.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/notifications/tests_truck_near.py) | Updated `PostgreSQLTruckNearIntegrationTests` with `_reset_prune_throttle_for_testing()` in `setUp`/`tearDown`, tracked IDs and thread-join guarantees (`try ... finally` around start/join + `tearDown` join safety + `connections['default'].close()` in worker `finally:`), and scoped reverse-FK `_fixture_teardown()` on PostgreSQL. |
| [tests_deduplication.py](file:///D:/Coding/Waste%20Watch/wastewatch/backend/notifications/tests_deduplication.py) | Updated `PostgreSQLIntegrationTests` with `_reset_prune_throttle_for_testing()` in `setUp`/`tearDown`, guaranteed thread join and `assertFalse(t1.is_alive())` / `assertFalse(t2.is_alive())` in `test_concurrent_expired_key_replacement_postgresql`, and scoped `_fixture_teardown()` on PostgreSQL. |
| [WASTEWatch_POSTGRESQL_CONCURRENCY_CORRECTION_REPORT.md](file:///D:/Coding/Waste%20Watch/wastewatch/WASTEWatch_POSTGRESQL_CONCURRENCY_CORRECTION_REPORT.md) | Created this PostgreSQL concurrency test isolation and cleanup correction report. |

---

## 3. Exact Cleanup Correction

### 3.1 `PostgreSQLTruckNearIntegrationTests` (`tests_truck_near.py`)
- Added class-scoped constants (`_SCOPED_USERNAME = 'driver_pg_conc'`, `_SCOPED_BARANGAY_NAMES = ('Barangay PG 1', 'Barangay PG 2')`, `_SCOPED_DUMPSITE_NAME = 'Central Dumpsite PG'`).
- Added `setUp(self)` calling `_reset_prune_throttle_for_testing()` and initializing `self._created_shift_ids`, `self._created_schedule_ids`, `self._created_dedup_keys`, and `self._worker_threads`.
- Added `tearDown(self)` joining any started live worker threads in `self._worker_threads` before resetting the prune throttle via `_reset_prune_throttle_for_testing()`.
- Wrapped worker thread startup and joins (`t1`, `t2`) in `try ... finally:` (checking `t.ident is not None` before `t.join(timeout=10)`) while retaining `connections['default'].close()` in worker `finally:` and `self.assertFalse(t1.is_alive())` / `self.assertFalse(t2.is_alive())` before assertions and teardown.
- Overrode `_fixture_teardown(self)`:
  - When `connection.vendor != 'postgresql'`, delegates to `super()._fixture_teardown()` and returns.
  - On PostgreSQL, avoids `call_command('flush')` (`TRUNCATE`), never disables triggers or constraints, and deletes only records belonging to `PostgreSQLTruckNearIntegrationTests` in reverse FK order:
    1. `Notification.objects.filter(type=NotificationType.TRUCK_NEAR, barangay__name__in=self._SCOPED_BARANGAY_NAMES).delete()`
    2. `NotificationDeduplication.objects.filter(key__in=dedup_keys).delete()` (covering tracked keys and `truck_near_{shift_id}_{schedule_id}_1` combinations for scoped shifts/schedules)
    3. `StopValidation.objects.filter(schedule_id__in=schedule_ids).delete()` (created implicitly by `CollectionSchedule.save()` -> `sync_pickup_statuses()`)
    4. `PickupStatus.objects.filter(schedule_id__in=schedule_ids).delete()` and `PickupStatus.objects.filter(driver__username=self._SCOPED_USERNAME).delete()`
    5. `DriverShift.objects.filter(id__in=shift_ids).delete()`
    6. `CollectionSchedule.objects.filter(id__in=schedule_ids).delete()`
    7. `Dumpsite.objects.filter(name=self._SCOPED_DUMPSITE_NAME).delete()`
    8. `Barangay.objects.filter(name__in=self._SCOPED_BARANGAY_NAMES).delete()`
    9. `User.objects.filter(username=self._SCOPED_USERNAME).delete()`

### 3.2 `PostgreSQLIntegrationTests` (`tests_deduplication.py`)
- Added class-scoped constants (`_SCOPED_DEDUP_KEYS = ('pg_savepoint_recovery_key', 'concurrent_expired_key')`, `_SCOPED_BARANGAY_NAMES = ('Barangay PG Savepoint', 'Barangay PG Savepoint Renamed')`).
- Added `setUp(self)` and `tearDown(self)` calling `_reset_prune_throttle_for_testing()` and ensuring any started worker threads in `self._worker_threads` are joined.
- Wrapped worker thread startup and joins (`t1`, `t2`) in `test_concurrent_expired_key_replacement_postgresql` in `try ... finally:` and added `self.assertFalse(t1.is_alive(), ...)` / `self.assertFalse(t2.is_alive(), ...)` before result assertions and teardown.
- Overrode `_fixture_teardown(self)`:
  - When `connection.vendor != 'postgresql'`, delegates to `super()._fixture_teardown()` and returns.
  - On PostgreSQL, avoids `flush` (`TRUNCATE`) and deletes only records created by `PostgreSQLIntegrationTests`:
    1. `NotificationDeduplication.objects.filter(key__in=self._SCOPED_DEDUP_KEYS).delete()`
    2. `Barangay.objects.filter(name__in=self._SCOPED_BARANGAY_NAMES).delete()`

---

## 4. Confirmation That Attendance Immutability Triggers Remain Active

Verified on the migrated PostgreSQL test database (`test_wastewatch_test`) after running `PostgreSQLTruckNearIntegrationTests` and `PostgreSQLIntegrationTests`:

1. **`pg_trigger` Catalog Verification (8 of 8 active triggers enabled with `tgenabled = 'O'`):**
   - `trg_crew_attendance_correction_immutable` on `crew_attendance_correction` -> `prevent_attendance_mutation` (`O`)
   - `trg_crew_attendance_correction_no_truncate` on `crew_attendance_correction` -> `prevent_attendance_mutation` (`O`)
   - `trg_crew_attendance_record_immutable` on `crew_attendance_record` -> `prevent_attendance_mutation` (`O`)
   - `trg_crew_attendance_record_no_truncate` on `crew_attendance_record` -> `prevent_attendance_mutation` (`O`)
   - `trg_shift_crew_roster_item_immutable` on `shift_crew_roster_item` -> `prevent_roster_mutation` (`O`)
   - `trg_shift_crew_roster_item_no_truncate` on `shift_crew_roster_item` -> `prevent_roster_mutation` (`O`)
   - `trg_shift_crew_roster_snapshot_immutable` on `shift_crew_roster_snapshot` -> `prevent_roster_mutation` (`O`)
   - `trg_shift_crew_roster_snapshot_no_truncate` on `shift_crew_roster_snapshot` -> `prevent_roster_mutation` (`O`)
2. **Live `TRUNCATE` Enforcement Check:** Executing `TRUNCATE` inside a rolled-back `transaction.atomic()` block confirmed `prevent_attendance_mutation()` and `prevent_roster_mutation()` continue to block `TRUNCATE` (`Attendance records and corrections are immutable and cannot be updated, deleted, or truncated.` / `Shift crew roster snapshots and items are immutable and cannot be updated, deleted, or truncated.`).
3. **Post-Teardown Clean State Verification:** Inspected all affected tables in `test_wastewatch_test` immediately after the 3 tests completed and confirmed **0** leftover rows across `User(username='driver_pg_conc')`, `Barangay` (`Barangay PG 1`, `Barangay PG 2`, `Barangay PG Savepoint`, `Barangay PG Savepoint Renamed`), `Dumpsite(name='Central Dumpsite PG')`, `CollectionSchedule`, `DriverShift`, `PickupStatus`, `StopValidation`, `Notification(type=TRUCK_NEAR)`, and `NotificationDeduplication`.

---

## 5. Targeted Gate A Results

- **Working Directory:** `D:\Coding\Waste Watch\wastewatch\backend`
- **Command:**
  ```powershell
  .\venv\Scripts\python.exe manage.py test notifications.tests_truck_near.PostgreSQLTruckNearIntegrationTests notifications.tests_deduplication.PostgreSQLIntegrationTests -v 2
  ```
- **Exit Code:** `0`
- **Counts:** Discovered `3`, Ran `3`, Passed `3`, Failed `0`, Errors `0`, Skipped `0` (`Ran 3 tests in 4.259s`, `OK`)
- **Test Outcomes:**
  - `test_concurrent_truck_near_pings_postgresql`: `ok`
  - `test_concurrent_expired_key_replacement_postgresql`: `ok`
  - `test_pruning_savepoint_recovery_aborted_transaction_postgresql`: `ok` (deliberate `SELECT 1 / 0;` `DivisionByZero` caught in nested savepoint, outer transaction remained healthy)
- **Database Lifecycle:** `Creating test database for alias 'default' ('test_wastewatch_test')...` -> `OK` -> `Destroying test database for alias 'default' ('test_wastewatch_test')...`

---

## 6. Full Gate B Results

Gate B was executed only after Gate A passed:

- **Working Directory:** `D:\Coding\Waste Watch\wastewatch\backend`
- **Command:**
  ```powershell
  .\venv\Scripts\python.exe manage.py test driver.tests.test_pg_concurrency notifications.tests_truck_near.PostgreSQLTruckNearIntegrationTests notifications.tests_deduplication.PostgreSQLIntegrationTests notifications.tests_phase2_postgres_concurrency -v 2
  ```
- **Exit Code:** `0`
- **Counts:** Discovered `11`, Ran `11`, Passed `11`, Failed `0`, Errors `0`, Skipped `0` (`Ran 11 tests in 95.130s`, `OK`)
- **Test Outcomes (11/11 Passed, 0 Skipped):**
  1. `driver.tests.test_pg_concurrency.DriverRound5B2ConflictAndPGConcurrencyTests.test_group2_and_group3_eligibility_accounts_and_merge_guards`: `ok`
  2. `driver.tests.test_pg_concurrency.DriverRound5B2ConflictAndPGConcurrencyTests.test_group4_allocation_validation_past_delete_default_team_and_legacy_tca`: `ok`
  3. `driver.tests.test_pg_concurrency.DriverRound5B2ConflictAndPGConcurrencyTests.test_group5_watcher_and_driver_shift_guards_and_integrity_409`: `ok`
  4. `driver.tests.test_pg_concurrency.DriverRound5B2ConflictAndPGConcurrencyTests.test_pg_concurrent_driver_shift_start_across_schedules_no_500_and_single_active`: `ok`
  5. `driver.tests.test_pg_concurrency.DriverRound5B2ConflictAndPGConcurrencyTests.test_pg_concurrent_membership_transfer_and_allocation_delete_vs_shift_start`: `ok`
  6. `driver.tests.test_pg_concurrency.DriverRound5B2ConflictAndPGConcurrencyTests.test_pg_concurrent_watcher_shift_start_across_schedules_single_active`: `ok`
  7. `notifications.tests_truck_near.PostgreSQLTruckNearIntegrationTests.test_concurrent_truck_near_pings_postgresql`: `ok`
  8. `notifications.tests_deduplication.PostgreSQLIntegrationTests.test_concurrent_expired_key_replacement_postgresql`: `ok`
  9. `notifications.tests_deduplication.PostgreSQLIntegrationTests.test_pruning_savepoint_recovery_aborted_transaction_postgresql`: `ok`
  10. `notifications.tests_phase2_postgres_concurrency.PostgreSQLConcurrencyActivationTests.test_simultaneous_drf_patch_activations_produce_exactly_one_event_and_one_notification`: `ok`
  11. `notifications.tests_phase2_postgres_concurrency.PostgreSQLConcurrencyActivationTests.test_simultaneous_service_calls_produce_exactly_one_event_and_one_notification`: `ok`

### 6.1 Additional Full-File Regression Verification
- **Command:** `.\venv\Scripts\python.exe manage.py test notifications.tests_truck_near notifications.tests_deduplication -v 2`
- **Exit Code:** `0`
- **Counts:** Discovered `37`, Ran `37`, Passed `35`, Failed `0`, Errors `0`, Skipped `2` (`Ran 37 tests in 49.002s`, `OK (skipped=2)` — only the two explicitly SQLite-only tests `test_sqlite_classifier_behavior_live` and `test_pruning_failure_recovers_savepoint_live_sqlite` skipped on PostgreSQL; 0 PostgreSQL tests skipped).

---

## 7. Confirmation That Tests Executed on PostgreSQL

1. **Runtime Django DB Configuration Check:**
   - `ENGINE`: `django.db.backends.postgresql`
   - `NAME`: `wastewatch_test`
   - `TEST`: `{'CHARSET': None, 'COLLATION': None, 'MIGRATE': True, 'MIRROR': None, 'NAME': None}`
   - `connection.vendor`: `postgresql`
2. **Test Runner Output:** Both Gate A and Gate B created and migrated `test_wastewatch_test` on PostgreSQL (`Applying driver.0042... OK`, `Applying driver.0044... OK`, ..., `Applying driver.0050... OK`) and destroyed `test_wastewatch_test` upon completion, leaving `wastewatch_test` untouched.
3. **Skip Count Verification:** All 3 Gate A tests and all 11 Gate B tests executed without skipping (`Skipped: 0`), including `PostgreSQLConcurrencyActivationTests` (which fails hard in `setUp` if `connection.vendor != 'postgresql'`) and all `@unittest.skipUnless(connection.vendor == 'postgresql', ...)` tests.

---

## 8. Migration and Git Workspace Integrity

- **Migration Schema Check:** `.\venv\Scripts\python.exe manage.py makemigrations --check --dry-run` returned `No changes detected` (Exit code `0`).
- **Migrations Preserved:** `driver/migrations/0042`, `0044`, `0047`, `0048`, `0049`, `0050` (and all other migrations) were not modified by this task (existing pre-task `params=None` remediation in `0043` and `0050` remains untouched).
- **Production and Sibling Files Preserved:** `git diff` confirms zero changes to `notifications/deduplication.py`, `notifications/services.py`, `driver/tests/test_pg_concurrency.py`, or any Round 5B.2 / Notifications Phase 1-4 / Truck-Near Phase 4.1/4.2 production code.
- **Configured Dev Database Preserved:** `wastewatch_test` was never reset, dropped, flushed, or queried directly.

---

## 9. Remaining Blockers and Exact Next Action

- **Blockers for Gate A / Gate B PostgreSQL Concurrency Scope:** None.
- **Out-of-Scope Note:** `community.tests.CommunityConcurrencyTests` (`community/tests.py`) also subclasses `TransactionTestCase` without a custom `_fixture_teardown()` override; it is outside Gate A/B scope and was left untouched per minimal-change constraints.
- **Exact Next Action:** Review and verify this correction report and the two modified test files, then proceed with authorized release/stage-gate review (do not advance to Notifications Phase 5 staging without explicit approval).

---

## 10. Final Status

**PASS**
