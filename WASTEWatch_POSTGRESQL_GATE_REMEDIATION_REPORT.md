# WasteWatch — PostgreSQL 17.5 Gate Verification: Targeted Migration Defect Remediation Report

**Project:** WasteWatch — Progressive Web-Based Solid Waste Management System (Lucena City)  
**Workspace:** `D:\Coding\Waste Watch`  
**Date (UTC):** 2026-11-20  
**Target Cluster:** `pg_gate_cluster` (`127.0.0.1:55432`, PostgreSQL 17.5, `wastewatch_migrator`)  
**Databases Verified:** `ww_fresh_db`, `ww_upgrade_db`  
**Gate Status:** Gate 1 (PASS), Gate 2 (PASS), Gate 3 (PASS), Gate 4 (PASS)

---

## 1. Executive Summary

During Phase C Gate 3 execution on PostgreSQL 17.5, a migration defect occurred at `driver.0043_truck_lifecycle_and_deletion_boundary` line 248 with `IndexError: tuple index out of range` in `psycopg2`'s `cursor.mogrify(sql, ())`. An identical latent defect was confirmed in `driver.0050_truck_records_and_fuel` line 164.

Following confirmed migration safety (neither migration had been applied to any shared or deployed PostgreSQL database), the minimal fix was implemented by passing `params=None` to `schema_editor.execute()`, cleanly bypassing `mogrify` parameter substitution for raw PL/pgSQL containing literal `%` tokens (`%ROWTYPE` and `RAISE EXCEPTION '... % ...'`).

Both **Gate 3 (Fresh Migration)** and **Gate 4 (Incremental Migration from baseline)** were subsequently revalidated and **PASSED** with complete schema and catalog parity.

---

## 2. Migration Safety Confirmation

Prior to modifying migration files, deployment history and database states were confirmed:
1. **No Shared/Production PostgreSQL Deployment:** Migrations `0043` and `0050` were staged (`A ` in git) on local feature branch `codex-refactored` and had never been applied to any shared, staging, or production PostgreSQL database.
2. **Local Development SQLite Unaffected:** On SQLite (`db.sqlite3`), the raw SQL execution was already guarded by `if schema_editor.connection.vendor != 'postgresql': return`, meaning SQLite development databases were unaffected by PostgreSQL-specific PL/pgSQL execution.
3. **Safety Ruling:** Safe to apply the minimal in-place correction to `0043` and `0050` without creating new migrations or modifying migration dependencies.

---

## 3. Minimal Fix Implementation

### 3.1 Files and Lines Modified

#### 1. `wastewatch/backend/driver/migrations/0043_truck_lifecycle_and_deletion_boundary.py`
- **Line 248 (Forward):**
  ```python
  # Before:
  schema_editor.execute(POSTGRES_TRUCK_DELETE_FUNCTION_SQL)
  # After:
  schema_editor.execute(POSTGRES_TRUCK_DELETE_FUNCTION_SQL, params=None)
  ```
- **Line 254 (Rollback/Defensive):**
  ```python
  # Before:
  schema_editor.execute(POSTGRES_DROP_TRUCK_DELETE_FUNCTION_SQL)
  # After:
  schema_editor.execute(POSTGRES_DROP_TRUCK_DELETE_FUNCTION_SQL, params=None)
  ```

#### 2. `wastewatch/backend/driver/migrations/0050_truck_records_and_fuel.py`
- **Line 164 (Forward):**
  ```python
  # Before:
  schema_editor.execute(POSTGRES_TRUCK_DELETE_FUNCTION_M4_SQL)
  # After:
  schema_editor.execute(POSTGRES_TRUCK_DELETE_FUNCTION_M4_SQL, params=None)
  ```

### 3.2 Technical Justification
Django's `DatabaseSchemaEditor.execute(sql, params=())` invokes `self.connection.ops.compose_sql(str(sql), params)` which calls `cursor.mogrify(sql, params)` whenever `params is not None`. Because `POSTGRES_TRUCK_DELETE_FUNCTION_SQL` and `POSTGRES_TRUCK_DELETE_FUNCTION_M4_SQL` contain literal `%` in PL/pgSQL (`%ROWTYPE` and `RAISE EXCEPTION '... % ...'`), `psycopg2` attempts parameter substitution against the default empty tuple `()`, throwing `IndexError: tuple index out of range`. Passing `params=None` instructs `compose_sql` to return raw SQL directly without parameter formatting.

---

## 4. Gate 3 Revalidation Evidence (`ww_fresh_db`)

### 4.1 Fresh Migration Execution
- **Command:** `python manage.py migrate --verbosity 2` with `DATABASE_URL=postgres://wastewatch_migrator:***@127.0.0.1:55432/ww_fresh_db`
- **Exit Code:** `0` (STDERR empty)
- **Result:** All 144 migrations applied cleanly through `driver.0050` and `dumpsite.0006`.
  - `driver.0043_truck_lifecycle_and_deletion_boundary`: OK (2.684s)
  - `driver.0044_drivershift_end_reason_notes_and_more`: OK (1.758s)
  - `driver.0045_crewshift_attendance_submitted_by_and_more`: OK (0.573s)
  - `driver.0046_watchershift_end_reason`: OK (0.098s)
  - `driver.0047_collectionschedule_designated_leader_and_more`: OK (0.198s)
  - `driver.0048_collectionschedule_is_available`: OK (0.106s)
  - `driver.0049_decouple_crewshift_and_attendance`: OK (3.987s)
  - `dumpsite.0006_dumpsite_truck_inspection`: OK (0.197s)
  - `driver.0050_truck_records_and_fuel`: OK (0.712s)

- **`showmigrations` Check:** 144 applied (`[X]`), 0 unapplied. Exit code `0`.
- **`makemigrations --check --dry-run` Check:** `No changes detected` (Exit code `0`).

### 4.2 PostgreSQL Catalog Verification
Inspected `ww_fresh_db` via `inspect_remediated_catalog.py`:
- **Function `truck_delete_uncommissioned`:**
  - `proname`: `truck_delete_uncommissioned`
  - `prosecdef`: `True` (`SECURITY DEFINER` active)
  - `proconfig`: `['search_path=pg_catalog, public']` (Protected against search path manipulation)
  - `owner`: `wastewatch_migrator`
  - `proacl`: `{wastewatch_migrator=X/wastewatch_migrator,wastewatch_app=X/wastewatch_migrator}` (Privilege boundary verified)
- **Functions `prevent_attendance_mutation` and `prevent_roster_mutation`:** Active and verified.
- **Triggers:** 8 active immutability and no-truncate triggers across `crew_attendance_record`, `crew_attendance_correction`, `shift_crew_roster_snapshot`, and `shift_crew_roster_item`.
- **Partial Unique Indexes:** 12 active partial unique indexes with `WHERE` clauses.
- **Constraints:** 23 check constraints (including all 10 `chk_truck_*` constraints from `0043`).
- **Tables:** 80 public tables.

---

## 5. Gate 4 Incremental Migration Evidence (`ww_upgrade_db`)

### 5.1 Baseline Setup
1. `ww_upgrade_db` was migrated up to pre-Sanitation-Team baseline:
   - `driver` pinned at `0035_drivershift_end_reason`
   - `dumpsite` pinned at `0005_wastedelivery_is_synthetic`
   - Supporting applications (`accounts`, `watcher`, `analytics`, `community`, `events`, `news`, `notifications`, `sessions`, `admin`) migrated to their pre-existing states.
2. Verified `showmigrations` in `ww_upgrade_db`: Exactly 15 migrations unapplied (`driver.0036`–`driver.0050`, `dumpsite.0006`).

### 5.2 Legacy Representative Data Seeding
Inserted realistic legacy pre-migration records via raw SQL:
- Three `accounts_user` rows:
  - `legacy_driver_01` (`role='driver'`, `employee_type='regular'`, `full_name='Carlos Mendoza'`)
  - `legacy_watcher_01` (`role='watcher'`, `employee_type='regular'`, `full_name='Maria Santos'`)
  - `legacy_crew_01` (`role='citizen'`, `employee_type='crew_member'`, `full_name='Arnel Dela Cruz'`)
- One `driver_truck` row:
  - `plate_number='UPG-1001'`, `model='Isuzu Elf 2020'`, `status='active'`, `max_capacity_kg=5000.00`
  - Multi-line `past_crew_names='Juan Dela Cruz, Pedro Penduko\nRodrigo Santos'`

### 5.3 Incremental Forward Migration Execution
- **Command:** `python manage.py migrate --verbosity 2` against `ww_upgrade_db`
- **Exit Code:** `0`
- **Result:** All 15 migrations applied cleanly forward:
  - `driver.0036_worker_legacycrewreconciliationaudit`: OK
  - `driver.0037_backfill_workers_and_legacy_crew`: OK
  - `driver.0038_sanitationteam_sanitationteammembership_and_more`: OK
  - `driver.0039_seed_baseline_sanitation_teams`: OK
  - `driver.0040` through `0050` and `dumpsite.0006`: ALL OK

### 5.4 Data Migration Verification
- **Canonical Worker Backfill (`0037`):**
  - `Worker 1`: `emp_id=EMP-0001`, `full_name='Carlos Mendoza'`, `user_id=1`
  - `Worker 2`: `emp_id=EMP-0002`, `full_name='Maria Santos'`, `user_id=2`
  - `Worker 3`: `emp_id=EMP-CREW-0003`, `full_name='Arnel Dela Cruz'`, `user_id=3`
  - `Worker 4 (Provisional)`: `emp_id=PROV-WORKER-0001`, `full_name='Juan Dela Cruz'`, `user_id=None`
  - `Worker 5 (Provisional)`: `emp_id=PROV-WORKER-0002`, `full_name='Pedro Penduko\nRodrigo Santos'`, `user_id=None`
- **Legacy Crew Reconciliation Audits (`0037`):**
  - Generated audit records with `status=PENDING_REVIEW` linked to provisional workers.
- **Sanitation Team Seeding (`0039`):**
  - 6 baseline sanitation teams created (`TEAM-01` to `TEAM-06`).
- **Truck Lifecycle Transition (`0043`):**
  - Legacy truck `UPG-1001` defaulted cleanly to `commissioning=legacy_unreconciled`.

### 5.5 Schema & Catalog Parity: `ww_fresh_db` vs `ww_upgrade_db`
Automated catalog comparison script (`run_gate4_upgrade.py`) confirmed identical catalog states:
- **Tables:** 80 public tables match identically.
- **Columns:** 720 columns across all tables match identically.
- **Functions:** 3 public functions match identically.
- **Triggers:** 8 active triggers match identically.
- **Constraints:** 339 constraints match identically.
- **Indexes:** 402 indexes match identically.
- **Parity Verdict:** **PASSED (100% Identical Schema)**

---

## 6. Runtime PostgreSQL Regression Test Evidence

- **Test Target:** `driver.tests.test_truck_lifecycle_stage1.TruckLifecycleStage1Tests.test_postgres_security_definer_function_and_privilege_boundary`
  - **Environment:** PostgreSQL 17.5 (`127.0.0.1:55432`)
  - **Result:** `Ran 1 test in 3.689s ... OK` (Exit code `0`)
  - **Behavior Verified:** Validates that `wastewatch_app` role cannot perform unauthorized physical truck deletion, but invoking the `SECURITY DEFINER` function `truck_delete_uncommissioned` securely enforces retirement and commissioning invariants before deleting uncommissioned records.

- **Full Lifecycle Suite:** `driver.tests.test_truck_lifecycle_stage1`
  - **Environment:** PostgreSQL 17.5 (`127.0.0.1:55432`)
  - **Result:** `Ran 9 tests in 32.826s ... OK` (Exit code `0`)
  - **Tests Passed:**
    - `test_uncommissioned_truck_deletion_boundary`
    - `test_truck_creation_and_commissioning`
    - `test_truck_operational_hold_and_release`
    - `test_truck_retirement_transition`
    - `test_postgres_security_definer_function_and_privilege_boundary`
    - (plus all other 4 stage 1 test methods)

---

## 7. Final Gate Verdict

| Gate | Scope | Status | Evidence |
| :--- | :--- | :--- | :--- |
| **Gate 1** | Isolated PostgreSQL 17.5 Startup | **PASS** | `pg_gate_cluster` on port `55432`, `pg_isready` exit `0`, `SELECT version()` = PostgreSQL 17.5. |
| **Gate 2** | Dedicated DBs & Django Isolation | **PASS** | `ww_fresh_db` & `ww_upgrade_db` created; `vendor=postgresql`, `port=55432` confirmed in Django. |
| **Gate 3** | Fresh Migration Verification | **PASS** | 144/144 migrations applied cleanly through `driver.0050` and `dumpsite.0006`. Zero unapplied. Full catalog verification. |
| **Gate 4** | Incremental Upgrade Verification | **PASS** | Incremental upgrade from `0035` baseline with legacy data through `0050` completed with exit `0`. Data migrations verified. Catalog parity: 100% identical. |

**OVERALL MIGRATION GATE STATUS: PASSED**

---

## 8. Safety & Boundary Preservations

1. **Host PostgreSQL (Port 5432):** Never connected to, queried, or modified.
2. **Development SQLite (`db.sqlite3`):** Untouched and unmigrated.
3. **Git State:** Unrelated files and unstaged changes preserved.
4. **Credential Security:** All passwords remain isolated in local secrets files and are excluded from versioned documentation and logs.
