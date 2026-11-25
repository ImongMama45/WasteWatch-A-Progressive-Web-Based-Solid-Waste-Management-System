# WasteWatch — PostgreSQL 17.5 Gate Verification: Phase B Environment Report

**Project:** WasteWatch — Progressive Web-Based Solid Waste Management System (Lucena City)  
**Workspace:** `D:\Coding\Waste Watch`  
**Date (UTC):** 2026-11-19  
**Phase:** Phase B — Isolated PostgreSQL 17.5 Provisioning & Django Isolation (Gates 1–2)  
**Overall Phase B Verdict:** **PASS** (`Gate 1: PASS`, `Gate 2: PASS`)

---

## 1. Executive Summary

Phase B established a clean, isolated PostgreSQL 17.5 cluster (`pg_gate_cluster`) on `127.0.0.1:55432` completely separated from the host PostgreSQL service on port `5432` (PID `6276`) and from the prior conversation's unstarted `pg_cluster_probe` directory. Dedicated passworded non-superuser roles (`wastewatch_migrator`, `wastewatch_app`) and empty verification databases (`ww_fresh_db`, `ww_upgrade_db`) were created, and Django was verified in-process via `manage.py shell` to target PostgreSQL 17.5 on `127.0.0.1:55432` (`ww_fresh_db`) as `wastewatch_migrator` without falling back to `db.sqlite3` or touching port `5432`.

---

## 2. Discrepancy Reconciliation (Phase A vs. Actual Scratch State)

### 2.1 `pg_staging_cluster` vs. `pg_cluster_probe` vs. `pg_gate_cluster`
- **Phase A Claim (`WASTEWatch_POSTGRESQL_GATE_PHASE_A_DISCOVERY.md`, lines 29, 124–136, 214–223, 249):** Asserted an isolated cluster at `C:\Users\USER\.gemini\antigravity\brain\61a450de-e22f-4611-af12-b9abf6602652\scratch\pg_staging_cluster` with `trust` authentication, databases `ww_fresh_db`, `ww_upgrade_db`, `ww_concurrency_db`, roles `postgres`, `ww_operator`, `ww_unprivileged`, and `"Isolation Verified: Yes"`.
- **Actual Finding:** Inspection of `61a450de-...\scratch\` revealed **no** `pg_staging_cluster` directory. Instead, only `pg_cluster_probe` existed—an unstarted, abruptly terminated cluster (`pg_ctl: no server running`, stale `postmaster.pid` PID `9760`, `pg_controldata` state `in production`, `server.log` showing a Windows file-sharing violation and `FATAL: role "USER" does not exist`, default `base/{1,4,5}` databases only, and `trust` auth).
- **Resolution:** `61a450de-...\scratch\pg_cluster_probe` was left completely untouched. Phase B initialized a brand-new, clean cluster **`pg_gate_cluster`** inside the current run's scratch directory:
  `C:\Users\USER\.gemini\antigravity\brain\7c273de3-0021-4212-ac96-f599b6fdac73\scratch\pg_gate_cluster`.

### 2.2 Trigger Table-Name Discrepancy (`driver_`-Prefixed vs. Unprefixed)
- **Phase A Claim (`WASTEWatch_POSTGRESQL_GATE_PHASE_A_DISCOVERY.md`, Section 6.1, lines 144–157):** Listed triggers from `0042` and `0044` on `driver_crewattendancerecord`, `driver_crewattendancecorrection`, `driver_shiftcrewrostersnapshot`, and `driver_shiftcrewrosteritem`.
- **Actual Finding (`driver/models.py:1094, 1141, 1204, 1255`, `0042`, `0044`, and live `ww_fresh_db` `pg_trigger`):** The actual `Meta.db_table` and PostgreSQL relation names are **unprefixed**: `crew_attendance_record`, `crew_attendance_correction`, `shift_crew_roster_snapshot`, and `shift_crew_roster_item`.

---

## 3. Gate 1 — Isolated PostgreSQL 17.5 Startup (`PASS`)

### 3.1 Initialization & Configuration
- **Cluster Data Directory:** `C:\Users\USER\.gemini\antigravity\brain\7c273de3-0021-4212-ac96-f599b6fdac73\scratch\pg_gate_cluster`
- **Init Command (exit code `0`):**
  ```powershell
  & "C:\Program Files\PostgreSQL\17\bin\initdb.exe" -D "C:\Users\USER\.gemini\antigravity\brain\7c273de3-0021-4212-ac96-f599b6fdac73\scratch\pg_gate_cluster" -U postgres --auth=scram-sha-256 --pwfile="...\scratch\_initdb_pw.tmp" -E UTF8 --locale=C
  ```
  *(Temporary `_initdb_pw.tmp` was deleted immediately after `initdb.exe`; credentials are stored solely in `C:\Users\USER\.gemini\antigravity\brain\7c273de3-0021-4212-ac96-f599b6fdac73\scratch\pg_gate_secrets.json`.)*
- **`postgresql.conf` Overrides Applied:**
  - `port = 55432`
  - `listen_addresses = '127.0.0.1'`
  - `logging_collector = on`
  - `log_directory = 'log'`
  - `log_filename = 'postgresql.log'`

### 3.2 Windows Process Survival Finding & Startup Method
1. Initial launch via `start_pg_gate.ps1` (`pg_ctl.exe -D ... -w -t 30 start`) returned exit code `0` (`PID 12296`, `database system is ready to accept connections`).
2. However, checking in a subsequent command (`pg_ctl.exe status -D ...`) returned exit code `3` (`pg_ctl: no server running`) because the Windows command runner job object reaps detached child processes when a normal `run_command` finishes.
3. Launching `postgres.exe` directly as a managed daemon (`IsDaemon=true`):
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\postgres.exe" -D "C:\Users\USER\.gemini\antigravity\brain\7c273de3-0021-4212-ac96-f599b6fdac73\scratch\pg_gate_cluster" -p 55432
   ```
   kept the isolated postmaster (`PID 5656`) alive cleanly across all subsequent commands, with `logging_collector = on` writing to `pg_gate_cluster\log\postgresql.log` without Windows file-sharing conflicts.

### 3.3 Gate 1 Verification Evidence (`gate1_proof.log`)
- **`pg_ctl.exe status -D ...\pg_gate_cluster`** (exit code `0`):
  `pg_ctl: server is running (PID: 5656)`
- **`pg_isready.exe -h 127.0.0.1 -p 55432 -U postgres`** (exit code `0`):
  `127.0.0.1:55432 - accepting connections`
- **`psql.exe -h 127.0.0.1 -p 55432 -U postgres -d postgres -c "SELECT version(), current_database(), current_user, inet_server_port();"`** (exit code `0`):
  - `version`: `PostgreSQL 17.5 on x86_64-windows, compiled by msvc-19.43.34808, 64-bit`
  - `current_database`: `postgres`
  - `current_user`: `postgres`
  - `inet_server_port`: `55432`
- **Process & Port Isolation (`postmaster.pid`, `Win32_Process`, `Get-NetTCPConnection`):**
  - Isolated cluster: `postgres.exe` PID `5656` (children `7892` syslogger, `5644` checkpointer, `6624` bgwriter, `6164` wal_writer, `20608` autovacuum launcher, `8716` bgworker) listening exclusively on `127.0.0.1:55432`.
  - Host service (untouched): `pg_ctl.exe` PID `4436` -> `postgres.exe` PID `6276` (children `6732`, `6776`, `6784`, `7268`, `7276`, `7284`) listening on `0.0.0.0:5432` and `:::5432`.

---

## 4. Gate 2 — Dedicated Verification Databases, Roles, & Django Isolation (`PASS`)

### 4.1 Roles, Ownership, & Privilege Rationale
Provisioned via `setup_gate2.py` connecting as bootstrap superuser `postgres` on `127.0.0.1:55432`:
- **`wastewatch_migrator`** (`LOGIN CREATEDB NOSUPERUSER NOCREATEROLE`, random hex password in `pg_gate_secrets.json`):
  - Owns `ww_fresh_db` and `ww_upgrade_db`, and owns schema `public` (`ALTER SCHEMA public OWNER TO wastewatch_migrator; GRANT ALL ON SCHEMA public TO wastewatch_migrator;`).
  - **Rationale:** Under PostgreSQL 15+ (including 17.5), `PUBLIC` lacks `CREATE` privilege on schema `public`; non-superuser migration execution requires schema ownership/grants. Furthermore, `driver.0043` conditionally runs `ALTER FUNCTION public.truck_delete_uncommissioned(BIGINT) OWNER TO wastewatch_migrator`, and `driver.0050` executes `CREATE OR REPLACE FUNCTION public.truck_delete_uncommissioned(BIGINT)` (which requires the executor to own the function or be superuser). `CREATEDB` is included to support future `manage.py test` `test_<db>` creation without granting `SUPERUSER`.
- **`wastewatch_app`** (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`, random hex password in `pg_gate_secrets.json`):
  - Unprivileged application role reserved to satisfy `driver.0043`'s `REVOKE DELETE ON TABLE public.driver_truck FROM wastewatch_app; GRANT EXECUTE ON FUNCTION public.truck_delete_uncommissioned(BIGINT) TO wastewatch_app;` checks without needing superuser.

### 4.2 Database & Role Identity Evidence (`gate2_isolation.log`)
- **`pg_roles` verification (`psql.exe`, exit code `0`):**
  - `postgres`: `rolsuper=t, rolcreaterole=t, rolcreatedb=t, rolcanlogin=t`
  - `wastewatch_migrator`: `rolsuper=f, rolcreaterole=f, rolcreatedb=t, rolcanlogin=t`
  - `wastewatch_app`: `rolsuper=f, rolcreaterole=f, rolcreatedb=f, rolcanlogin=t`
- **Empty database verification as `wastewatch_migrator` (`psql.exe`, exit code `0` each):**
  - `ww_fresh_db`: `PostgreSQL 17.5 ... | ww_fresh_db | wastewatch_migrator | 55432 | public_table_count = 0`
  - `ww_upgrade_db`: `PostgreSQL 17.5 ... | ww_upgrade_db | wastewatch_migrator | 55432 | public_table_count = 0`
- **Django same-process isolation proof (`manage.py shell`, exit code `0`):**
  - Command (with in-process `DATABASE_URL=postgres://wastewatch_migrator:***@127.0.0.1:55432/ww_fresh_db`):
    ```powershell
    python manage.py shell -c "from django.db import connection; cur = connection.cursor(); cur.execute('SELECT current_database(), current_user, inet_server_port(), version()'); row = cur.fetchone(); ..."
    ```
  - Output:
    - `vendor=postgresql`
    - `db=ww_fresh_db`
    - `user=wastewatch_migrator`
    - `port=55432`
    - `version=PostgreSQL 17.5 on x86_64-windows, compiled by msvc-19.43.34808, 64-bit`
    - `DJANGO_ISOLATION_OK`

---

## 5. Cluster Lifecycle State & Helper Scripts

- **Current Cluster State:** `pg_gate_cluster` remains **running** on `127.0.0.1:55432` (master PID `5656`) as a managed background daemon (`task-23`) for inspection or subsequent phases.
- **Helper Scripts (in `C:\Users\USER\.gemini\antigravity\brain\7c273de3-0021-4212-ac96-f599b6fdac73\scratch\`):**
  - Start (foreground / daemon): `.\start_pg_gate.ps1 -Foreground` (or `.\start_pg_gate.ps1` for interactive shells where child processes are not job-reaped)
  - Stop cleanly: `.\stop_pg_gate.ps1` (`pg_ctl.exe -D ...\pg_gate_cluster -m fast -w -t 30 stop`)
- **Log & Proof Artifacts (in `7c273de3-...\scratch\`):**
  - `gate1_proof.log`, `gate2_isolation.log`, `pg_gate_cluster\log\postgresql.log`, `pg_gate_secrets.json` (credentials only; never echoed).
