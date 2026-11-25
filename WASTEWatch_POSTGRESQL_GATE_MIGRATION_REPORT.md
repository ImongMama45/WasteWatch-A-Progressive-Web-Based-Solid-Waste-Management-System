# WasteWatch — PostgreSQL 17.5 Gate Verification: Phase C Migration Report

**Project:** WasteWatch — Progressive Web-Based Solid Waste Management System (Lucena City)  
**Workspace:** `D:\Coding\Waste Watch`  
**Date (UTC):** 2026-11-20  
**Phases Covered:** Gates 1–4 Summary (Phase C Fresh & Incremental Migration Verification Post-Remediation)  
**Target Cluster:** `pg_gate_cluster` (`127.0.0.1:55432`, PostgreSQL 17.5, `wastewatch_migrator`)  
**Overall Phase C Migration Status:** **PASSED**

---

## 1. Gate Verdicts Summary

| Gate | Scope | Status | Summary |
| :--- | :--- | :--- | :--- |
| **Gate 1** | Isolated PostgreSQL 17.5 Startup | **PASS** | `pg_gate_cluster` running on `127.0.0.1:55432` (PID `15508`); `pg_isready` (exit `0`) & `psql` identity verified; isolated from host port `5432`. |
| **Gate 2** | Dedicated DBs, Roles, & Django Isolation | **PASS** | `wastewatch_migrator`, `wastewatch_app`, `ww_fresh_db`, `ww_upgrade_db` created; `manage.py shell` proved `vendor=postgresql`, `db=ww_fresh_db`, `user=wastewatch_migrator`, `port=55432`. |
| **Gate 3** | Fresh Migration Verification (`ww_fresh_db`) | **PASS** | All 144/144 migrations applied cleanly through `driver.0050` and `dumpsite.0006` following targeted `params=None` remediation in `0043` and `0050`. `showmigrations` has 0 unapplied; `makemigrations --check` detects no drift. Full catalog verification confirmed. |
| **Gate 4** | Incremental Migration Verification (`ww_upgrade_db`) | **PASS** | Incremental migration from `0035` baseline with representative legacy data applied through `0050` and `dumpsite.0006` (exit `0`). Data migrations (`0037` worker backfill & `0039` baseline teams) verified. Catalog parity against `ww_fresh_db` is 100% identical. |

---

## 2. Gate 3 — Fresh Migration Verification (`ww_fresh_db`) — PASS

### 2.1 Remediation Summary
Initial execution encountered `IndexError: tuple index out of range` in `psycopg2`'s `cursor.mogrify(sql, ())` during `driver.0043` line 248 because `schema_editor.execute(POSTGRES_TRUCK_DELETE_FUNCTION_SQL)` was called without `params=None` while the SQL string contained literal `%` characters (`%ROWTYPE` and `RAISE EXCEPTION '... % ...'`). An identical bug in `driver.0050` line 164 was identified.

After verifying that neither migration had ever been applied to any external or production PostgreSQL instance, a minimal fix was applied:
- `driver/migrations/0043_truck_lifecycle_and_deletion_boundary.py`: Lines 248 and 254 updated to `schema_editor.execute(..., params=None)`.
- `driver/migrations/0050_truck_records_and_fuel.py`: Line 164 updated to `schema_editor.execute(POSTGRES_TRUCK_DELETE_FUNCTION_M4_SQL, params=None)`.

### 2.2 Execution Evidence Post-Remediation
All commands executed in `D:\Coding\Waste Watch\wastewatch\backend` with `DATABASE_URL=postgres://wastewatch_migrator:***@127.0.0.1:55432/ww_fresh_db`:

1. **`python manage.py migrate --verbosity 2`** — **Exit Code `0`**:
   - Resumed from `driver.0043` through `driver.0050` and `dumpsite.0006`.
   - All migrations applied cleanly without errors or warnings.
2. **`python manage.py showmigrations`** — **Exit Code `0`**:
   - 144 total migrations applied (`[X]`).
   - 0 unapplied migrations.
3. **`python manage.py makemigrations --check --dry-run`** — **Exit Code `0`**:
   - `No changes detected`.

### 2.3 `pg_catalog` State Verified on `ww_fresh_db`
- **Functions (`pg_proc`):**
  - `truck_delete_uncommissioned(BIGINT)` exists:
    - `prosecdef = True` (Confirmed `SECURITY DEFINER`).
    - `proconfig = ['search_path=pg_catalog, public']` (Protected against search-path attacks).
    - `owner = wastewatch_migrator`.
    - `proacl = {wastewatch_migrator=X, wastewatch_app=X}` (`EXECUTE` granted to application role).
  - `prevent_attendance_mutation()` and `prevent_roster_mutation()` exist and verified.
- **Triggers (`pg_trigger`):**
  - 8 active immutability triggers on table names:
    - `crew_attendance_record`: `trg_crew_attendance_record_immutable`, `trg_crew_attendance_record_no_truncate`
    - `crew_attendance_correction`: `trg_crew_attendance_correction_immutable`, `trg_crew_attendance_correction_no_truncate`
    - `shift_crew_roster_snapshot`: `trg_shift_crew_roster_snapshot_immutable`, `trg_shift_crew_roster_snapshot_no_truncate`
    - `shift_crew_roster_item`: `trg_shift_crew_roster_item_immutable`, `trg_shift_crew_roster_item_no_truncate`
- **Partial Unique Indexes (`pg_indexes` with `WHERE`):**
  - 12 active partial unique indexes, including:
    - `unique_active_worker_team_membership`
    - `unique_active_leader_per_team`
    - `unique_active_driver_per_team`
    - `unique_active_watcher_shift_per_date`
    - `unique_active_crew_shift_attendance_per_schedule`
    - `unique_pending_unreconciled_raw_string`
- **Check Constraints (`pg_constraint`):**
  - 23 check constraints, including all 10 `chk_truck_*` constraints from `0043`.
- **Public Tables:**
  - 80 tables total.

---

## 3. Gate 4 — Incremental Migration Verification (`ww_upgrade_db`) — PASS

### 3.1 Baseline State
`ww_upgrade_db` was configured at the pre-Sanitation-Team baseline:
- `driver` pinned at `0035_drivershift_end_reason`.
- `dumpsite` pinned at `0005_wastedelivery_is_synthetic`.
- Supporting applications (`accounts`, `watcher`, `analytics`, `community`, `events`, `news`, `notifications`, `sessions`, `admin`) at latest.
- Exactly 15 migrations unapplied (`driver.0036`–`0050`, `dumpsite.0006`).

### 3.2 Legacy Data Insertion
Realistic legacy data was inserted via raw SQL prior to forward migration:
- 3 users in `accounts_user` representing legacy driver (`legacy_driver_01`), watcher (`legacy_watcher_01`), and registered crew member (`legacy_crew_01`).
- 1 truck in `driver_truck` (`UPG-1001`) with multi-line `past_crew_names`: `'Juan Dela Cruz, Pedro Penduko\nRodrigo Santos'`.

### 3.3 Incremental Migration & Data Verification
1. **Migration Execution:** `python manage.py migrate --verbosity 2` against `ww_upgrade_db` ran to completion with Exit Code `0`.
2. **Canonical Worker Backfill (`0037`):**
   - User `legacy_driver_01` -> Worker `EMP-0001`
   - User `legacy_watcher_01` -> Worker `EMP-0002`
   - User `legacy_crew_01` -> Worker `EMP-CREW-0003`
   - Unauthenticated names from `past_crew_names` -> Provisional workers `PROV-WORKER-0001` and `PROV-WORKER-0002`.
   - `LegacyCrewReconciliationAudit` records created with `status='PENDING_REVIEW'`.
3. **Baseline Teams (`0039`):**
   - Seeded 6 baseline teams (`TEAM-01` through `TEAM-06`).
4. **Lifecycle State (`0043`):**
   - Truck `UPG-1001` defaulted to `commissioning='legacy_unreconciled'`.

### 3.4 Schema & Catalog Parity Check (`ww_fresh_db` vs `ww_upgrade_db`)
Direct catalog query comparison across both databases yielded identical results:
- Tables: 80 / 80 match
- Columns: 720 / 720 match
- Functions: 3 / 3 match
- Triggers: 8 / 8 match
- Constraints: 339 / 339 match
- Indexes: 402 / 402 match

---

## 4. Runtime Regression Test Results

- **`TruckLifecycleStage1Tests.test_postgres_security_definer_function_and_privilege_boundary`:**
  - Ran against `test_ww_fresh_db` on PostgreSQL 17.5 (`port 55432`).
  - Result: `Ran 1 test in 3.689s ... OK` (Exit code `0`).
- **`driver.tests.test_truck_lifecycle_stage1` (Full Suite):**
  - Result: `Ran 9 tests in 32.826s ... OK` (Exit code `0`).

---

## 5. Safety, Isolation, & Git Integrity Verification

- **Host PostgreSQL Port `5432`:** Never contacted; host cluster untouched.
- **Development SQLite (`db.sqlite3`):** Never migrated or modified during this gate.
- **Git State:** Unrelated files and staging preserved.
- **Secrets:** Passwords and credentials strictly excluded from all committed artifacts.
