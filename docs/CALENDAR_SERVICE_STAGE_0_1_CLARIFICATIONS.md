# WasteWatch — Stage 0.1: Calendar Service Clarification and Evidence Verification Report

**Project:** WasteWatch — CENRO Lucena City Solid Waste Management System  
**Document:** Stage 0.1 Verification Addendum and Empirical Clarifications  
**Assigned Role:** Lead Implementer / Repository Investigator  
**Reviewer:** ChatGPT — Technical Project Manager / Architecture Authority  
**Independent Auditor:** Claude — Technical Review Authority  
**Date:** 2026-11-09  
**Authorization Status:** Stage 0.1 Complete (Read-Only Investigation); Stage 1 Implementation NOT Authorized  
**ML Governance Status:** `FORECAST_ML_ENABLED = False` (Ridge ML remains disabled; heuristic remains production-primary; forecasting schema protected)

---

## 1. Executive Summary

This Stage 0.1 technical addendum provides empirical source-code, database, and test verification resolving the outstanding architectural questions identified during the Stage 0 source-code audit. In strict accordance with the Stage 0.1 directive, this investigation was conducted on a read-only basis without modifying application source code, models, serializers, views, permissions, URLs, frontend components, or forecasting configurations.

### Key Investigation Conclusions:
1. **Occurrence Identity and Completion Semantics (PARTIALLY VERIFIED):**  
   Recurring [`CollectionSchedule`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L81) occurrences do not exist as persistent database records; they are generated dynamically in memory from weekday rules. Completion cannot be determined from `CollectionSchedule.status` because marking a recurring template `COMPLETED` terminates future recurrences. Date-specific completion evidence is recorded at the stop level in [`watcher.StopValidation`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py#L383) via `collection_date` and `UniqueConstraint(fields=['schedule', 'stop_order', 'collection_date'])`. However, schedules lacking waypoints (e.g. database IDs 81 and 82 with `waypoints = []`) generate zero `StopValidation` rows, rendering completion unverifiable. Operational [`driver.PickupStatus`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L177) records lack a `collection_date` column and represent only transient shift state. Consequently, the public calendar must display occurrences as `scheduled` (future) or `in_progress` (active shift) without asserting completion unless verified stop evidence exists.
2. **CollectionSchedule Data Quality Vulnerabilities (VERIFIED):**  
   Database inspection and serializer validation reveal that `CollectionSchedule.days` is stored as an unvalidated free-text string without enum constraints. Existing database records exhibit empty `days` strings, mixed casing, and missing waypoint arrays.
3. **Severe Operational Information Exposure (VERIFIED — HIGH RISK):**  
   The existing endpoint `GET /api/driver/collection-schedules/?paginate=false` grants public access (`permissions.AllowAny` on safe methods) and serializes all model fields (`fields = '__all__'`), exposing internal driver names, user IDs, truck license plates, dumpsite facility IDs, and raw GPS waypoints. The public calendar must strictly reject this serializer and implement an explicit whitelist projection.
4. **NewsItem and EmergencyAlert Semantic Separation (VERIFIED):**  
   `NewsItem.date` is an `auto_now_add` creation timestamp, not an event occurrence date. It must never be projected as a future activity. `EmergencyAlert` has no barangay association and is strictly citywide.
5. **Capacity and Deterministic Ordering (VERIFIED):**  
   The 93-day window ceiling matches frontend multi-month display requirements while bounding query execution. The 100-template limit accommodates Lucena City's fleet (33 barangays, 10–15 trucks). Both limits enforce fail-closed overflow detection (`CalendarCapacityError`), preventing silent record omission. Total ordering is deterministic across heterogeneous models.
6. **Existing Test Suite Verification (VERIFIED):**  
   All 87 tests in `calendar_service/tests/` were executed and passed in 25.561s (`Ran 87 tests. OK`), verifying bounded queries, recurrence math, N+1 query prevention, and role-based sanitization.
7. **Forecasting Isolation (VERIFIED):**  
   The forecasting subsystem remains completely untouched. `FORECAST_ML_ENABLED = False` is active, the 26-feature Ridge schema is preserved, and no calendar features are introduced.

---

## 2. Investigation Scope and Files Inspected

### 2.1 Backend Domain Models and Services
- **Driver Domain:**
  - [`wastewatch/backend/driver/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py) (Lines 81–166: `CollectionSchedule`; Lines 177–208: `PickupStatus`; Lines 354–364: `CalendarEvent`; Lines 380–436: `MissedStop`)
  - [`wastewatch/backend/driver/serializers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/serializers.py) (Lines 153–220: `CollectionScheduleSerializer`; Lines 376–385: `PickupStatusSerializer`)
  - [`wastewatch/backend/driver/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/views.py) (Lines 365–383: `CollectionScheduleViewSet`; Lines 469–560: `PickupStatusViewSet`; Lines 1210–1235: shift reset; Lines 1855–1880: shift end)
  - [`wastewatch/backend/driver/crew_resolver.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/crew_resolver.py) (Lines 1–73: `normalize_days`, `get_crew_assignment_for`)
- **Watcher Stop Inspection Domain:**
  - [`wastewatch/backend/watcher/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py) (Lines 371–381: `StopValidationStatus`; Lines 383–475: `StopValidation`)
  - [`wastewatch/backend/watcher/stop_validation_service.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/stop_validation_service.py) (Lines 13–60: `ensure_stop_validations_for_schedule`, `reset_shift_validations`)
- **News and Emergency Alerts Domain:**
  - [`wastewatch/backend/news/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/models.py) (Lines 37–141: `NewsItem`; Lines 143–155: `EmergencyAlert`)
  - [`wastewatch/backend/news/serializers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/serializers.py) (Lines 11–80: `NewsItemSerializer`; Lines 82–105: `EmergencyAlertSerializer`)
  - [`wastewatch/backend/news/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/views.py) (Lines 16–78: `NewsItemViewSet.get_queryset`; Lines 210–225: `EmergencyAlertViewSet.get_queryset`)
- **Municipal Events Domain:**
  - [`wastewatch/backend/events/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/models.py) (Lines 34–113: `MunicipalEvent`)
  - [`wastewatch/backend/events/serializers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/serializers.py) (Lines 11–95: `MunicipalEventSerializer`)
  - [`wastewatch/backend/events/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/views.py) (Lines 30–97: `MunicipalEventViewSet.get_queryset`)
- **Public API and Core Routing:**
  - [`wastewatch/backend/wastewatch/public_api.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/public_api.py) (Lines 77–103: `public_schedule_view`)
  - [`wastewatch/backend/wastewatch/api_urls.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/api_urls.py) (Lines 1–67: API route registry)
  - [`wastewatch/backend/wastewatch/settings.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/settings.py) (Timezone, installed apps, forecasting flags)
- **Forecasting Subsystem Boundary:**
  - [`wastewatch/backend/forecasting/service.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/forecasting/service.py) (Lines 1–250: Heuristic fallback and schema validation)
  - [`wastewatch/backend/forecasting/features.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/forecasting/features.py) (Lines 1–180: Feature definitions)
  - [`wastewatch/backend/analytics/tests/test_forecasting.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/analytics/tests/test_forecasting.py) (Forecasting governance test suite)
- **Calendar Service Module Foundation:**
  - [`wastewatch/backend/calendar_service/apps.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/apps.py)
  - [`wastewatch/backend/calendar_service/urls.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/urls.py)
  - [`wastewatch/backend/calendar_service/exceptions.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/exceptions.py)
  - [`wastewatch/backend/calendar_service/normalizers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/normalizers.py)
  - [`wastewatch/backend/calendar_service/selectors.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/selectors.py)
  - [`wastewatch/backend/calendar_service/serializers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/serializers.py)
  - [`wastewatch/backend/calendar_service/aggregator.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/aggregator.py)
  - [`wastewatch/backend/calendar_service/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/views.py)
  - [`wastewatch/backend/calendar_service/tests/test_app_foundation.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_app_foundation.py)
  - [`wastewatch/backend/calendar_service/tests/test_collection_schedule.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_collection_schedule.py)
  - [`wastewatch/backend/calendar_service/tests/test_stage1c_sources.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1c_sources.py)
  - [`wastewatch/backend/calendar_service/tests/test_stage1d_endpoint.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1d_endpoint.py)

### 2.2 Live Database Inspection
Inspected `wastewatch/backend/db.sqlite3` via read-only ORM queries:
- `CollectionSchedule`: 4 rows (IDs 79, 80, 81, 82)
- `PickupStatus`: 6 rows
- `StopValidation`: 14 rows
- `CalendarEvent`: 1 row
- `NewsItem`: 3 rows
- `EmergencyAlert`: 2 rows
- `MunicipalEvent`: 0 rows

---

## 3. CollectionSchedule Occurrence Identity Findings

### 3.1 Occurrence Identification Mechanism
- **Recurring Schedules:** When `CollectionSchedule.date` is `None`, individual occurrences do not exist in the database. They are computed dynamically by matching target calendar dates against parsed weekday tokens in `CollectionSchedule.days` via [`normalize_days`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/crew_resolver.py#L9).
- **Distinguishing Occurrences:** A Monday occurrence cannot be distinguished from a subsequent Monday occurrence by database primary key. To maintain deterministic identity across API calls, the system constructs a composite identifier:
  $$\text{id} = \text{f"sched\_\{schedule.id\}\_\{occurrence\_date.strftime('\%Y\%m\%d')\}"}$$
- **One-Time Schedules:** When `CollectionSchedule.date` is populated, the schedule represents a single occurrence. Its identifier is `f"sched_{schedule.id}"`.

### 3.2 Completion Tracking: `StopValidation` vs. `PickupStatus`
- **`watcher.StopValidation` (Authoritative Historical Evidence):**  
  - Location: [`watcher/models.py:383-475`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py#L383-L475)
  - Key fields: `schedule` (ForeignKey to `driver.CollectionSchedule`), `stop_order` (PositiveIntegerField, 1-indexed into `waypoints[1:]`), `collection_date` (DateField).
  - Uniqueness guarantee:
    ```python
    models.UniqueConstraint(
        fields=['schedule', 'stop_order', 'collection_date'],
        name='unique_stop_validation_per_day'
    )
    ```
  - Behavior: Provides a persistent, date-specific audit trail for each stop on a specific collection date.
- **`driver.PickupStatus` (Transient Operational Progress):**  
  - Location: [`driver/models.py:177-208`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L177-L208)
  - Key fields: `driver`, `schedule`, `status`, `stop_order`, `collected_at`, `updated_at`.
  - Defect / Limitation: Contains **no `collection_date` field**. When drivers begin a new shift in subsequent weeks, `PickupStatus` rows are overwritten in place via `sync_pickup_statuses()`. It cannot be used to verify historical completions of recurring schedules.

### 3.3 Critical Limitations and Edge Cases
1. **Waypoint-Less Schedules (Unverifiable Completion):**  
   Inspection of `db.sqlite3` revealed records 81 and 82 with `waypoints = []`. In [`watcher/stop_validation_service.py:22`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/stop_validation_service.py#L22):
   ```python
   if len(waypoints) <= 1:
       return []
   ```
   No `StopValidation` rows are ever generated for schedules with $\le 1$ waypoint. Completion for these routes is physically impossible to verify.
2. **Parent Template Status Decoupling:**  
   `CollectionSchedule.status` (`PENDING`, `COMPLETED`, `CANCELLED`) represents the lifecycle of the schedule template itself. Marking a recurring template `COMPLETED` terminates future occurrences. If the calendar inferred occurrence completion from `schedule.status == 'COMPLETED'`, all past and future occurrences would appear completed simultaneously.
3. **Multi-Shift Reassignments:**  
   When a driver misses a stop (`DRIVER_MISSED`), extended shifts or secondary drivers collect the stop via `MissedStop` and update `StopValidation`. Completion remains tied to `(schedule_id, collection_date)`, but the operating crew differs.

### 3.4 Summary Assessment

| Dimension | Evaluation | Supporting Evidence | Confidence Level |
| :--- | :--- | :--- | :--- |
| Occurrence ID | Deterministic string generation | `f"sched_{id}_{YYYYMMDD}"` | **Verified** |
| Historical Completion | Reliable for routes with waypoints | `StopValidation.collection_date` + UniqueConstraint | **Verified** |
| Waypoint-less Routes | Unverifiable | Zero `StopValidation` records generated | **Verified** |
| `PickupStatus` History | Unusable for historical audit | Missing `collection_date` column | **Verified** |
| Parent Status Inference | Prohibited | Marking template `COMPLETED` halts future runs | **Verified** |

**Conclusion (PARTIALLY VERIFIED):**  
Occurrence identity can be deterministically established in memory, and completion can be verified *only* when waypoints exist and corresponding `StopValidation` records reach `VERIFIED_COLLECTED`. In all other cases, the public calendar must default to `scheduled` (future) or `in_progress` (active shift date) without claiming completion.

---

## 4. CollectionSchedule Data Quality Findings

### 4.1 Empirical Data Quality Inspection

| Defect / Scenario | Existing Code / DB Behavior | Public Calendar Handling | Risk Assessment | CENRO Policy Required? | Confidence Level |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Empty `days` string** | `normalize_days("")` returns `set()`. Ignored by daily crew assignment. | Emits 0 occurrences. Logged as data anomaly. | Silent omission of intended collection route. | **Yes:** Mandate input validation rejecting recurring schedules with empty days. | **Verified** |
| **Unsupported weekday abbreviation (e.g. `'Funday'`)** | `normalize_days` produces `{'fun'}`. Matches no valid weekday. | Emits 0 occurrences. | Route exists in database but never appears on calendar. | **Yes:** Restrict choices to canonical weekdays `Mon..Sun`. | **Verified** |
| **Malformed separators (`'Mon; Wed, Fri'`)** | Splits on comma; semicolon causes token `'Mon; Wed'` which matches nothing. | Incomplete expansion. Valid tokens expand; malformed tokens drop. | Partial route omissions. | **Yes:** Enforce strict comma separation or checkbox array in admin UI. | **Verified** |
| **Duplicate tokens (`'Mon, Monday'`)** | `normalize_days` returns `set()`, deduplicating tokens. | Emits exactly 1 occurrence per date. | Negligible. Handled cleanly. | No. Handled in code. | **Verified** |
| **Inverted times (`end_time <= start_time`)** | Enforced in serializer during API writes, but unconstrained at database model level (`models.py`). | Inverted times produce invalid timestamps. | Display distortion or negative duration. | No. Model `clean()` must mirror serializer validation. | **Verified** |
| **Missing barangay (`barangays.count() == 0`)** | Allowed by `blank=True`. DB row 81 has `area="Automated Route - ScalingTestB"` with no barangay. | If `area` contains valid label, classify as `scope='area'`. If empty, classify as `scope='unassigned'`. Exclude from public calendar unless explicit citywide marker. | Leaking internal depot movements or test routes to public citizens. | **Yes:** Clarify whether empty barangay implies citywide or internal route. | **Verified** |
| **Overlapping schedules (same truck/driver)** | Serializer checks overlap on write, but direct model creates bypass it. | Both schedules expand independently; may show duplicate windows for same barangay. | Citizen confusion regarding actual collection hour. | **Yes:** Establish multi-shift same-day routing rules. | **Verified** |
| **One-time schedule (`date` populated)** | Takes precedence over `days`. Emits exactly 1 occurrence on that specific date. | Emitted strictly on `schedule.date`. | Past dates appear in historical view; future dates in future view. | No. Handled cleanly. | **Verified** |
| **Cancelled template (`status='CANCELLED'`)** | Excluded from driver daily dispatch in `crew_resolver.py`. | **Strictly excluded** from public calendar queries. | Showing cancelled collections causes residents to place bins curbside in error. | No. Universal exclusion rule. | **Verified** |
| **Completed template (`status='COMPLETED'`)** | Recurring schedule marked completed in admin table. | Historical occurrences preserved up to completion; future occurrences suppressed. | Recurring template marked completed would wrongly vanish historically if not handled per occurrence. | No. Handled per occurrence. | **Verified** |

---

## 5. Proposed Public Schedule Eligibility Policy

### 5.1 Public Visibility Criteria
A `CollectionSchedule` is eligible for inclusion in the public calendar **only** if all of the following conditions are met:
1. `status != 'CANCELLED'`.
2. Has at least one assigned `Barangay` OR `area.strip().lower() in ('citywide', 'city-wide')`.
3. Does not contain operational/depot keywords in `area` (e.g. `'depot'`, `'transfer'`, `'maintenance'`, `'test'`, `'scaling'`, `'internal'`).
4. Possesses valid time bounds (`start_time < end_time`).

### 5.2 Whitelisted Public Projection (Zero-Leakage Contract)
The raw [`CollectionScheduleSerializer`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/serializers.py#L153) exposes internal operational data. The public calendar must exclusively output the sanitized projection:

```json
{
  "id": "sched_80_20261115",
  "source": "collection_schedule",
  "source_id": 80,
  "title": "Waste Collection — Isabang",
  "description": "Regular municipal waste collection route.",
  "start_datetime": "2026-11-15T06:00:00+08:00",
  "end_datetime": "2026-11-15T10:00:00+08:00",
  "location": "Isabang, Lucena City",
  "barangays": [{"id": 1, "name": "Isabang"}],
  "category": "collection_schedule",
  "entry_type": "collection_schedule",
  "status": "scheduled",
  "is_all_day": false,
  "detail_url": "/schedule",
  "metadata": {
    "scope": "barangay",
    "is_citywide": false,
    "total_stops": 4
  }
}
```

**Explicitly Blacklisted Operational Fields (Zero Tolerance for Public Exposure):**
- `driver`, `driver_id`, `driver_name`, `driver_phone`, `driver_email`
- `truck`, `truck_id`, `truck_plate`, `truck_model`
- `dumpsite`, `dumpsite_id`, `dumpsite_name`
- `waypoints` (Raw lat/lng coordinates and driver navigation paths)
- `pickups` (Raw driver collection timestamps)

---

## 6. NewsItem and EmergencyAlert Classification

### 6.1 `NewsItem` Semantic Classification
- **Field Definition:** [`news.models.NewsItem.date`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/models.py#L43) is declared as:
  ```python
  date = models.DateField(auto_now_add=True)
  ```
- **Semantic Meaning:** This is strictly an **editorial publication/creation date**. It represents the moment CENRO staff published the notice. It does **not** represent a scheduled event or activity date.
- **Calendar Handling:**  
  Treating `NewsItem.date` as an event start date is semantically invalid. News items must **not** appear in the default calendar stream (`include_notices=False` by default). When opt-in inclusion is requested (`include_notices=True`), they must be rendered as all-day informational notices on their publication date (`is_all_day=True`, `entry_type='announcement'` or `'news'`), without fabricated hours.
- **Confidence Level:** **Verified**.

### 6.2 `EmergencyAlert` Semantic Classification
- **Field Definition:** [`news.models.EmergencyAlert`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/models.py#L143-L155) possesses fields `title`, `body`, `date` (`auto_now_add=True`), `is_active` (`BooleanField`), `updated_at`.
- **Barangay Scope:** The model contains **no barangay foreign key or ManyToMany relation**. Emergency alerts are strictly municipal-wide advisories.
- **Calendar Handling:**  
  Emergency alerts represent acute civic emergencies (e.g. typhoon suspensions, flash floods). They must never be classified under civic event categories. When queried, they bear `source='emergency_alert'`, `entry_type='emergency_advisory'`, and `is_all_day=True`. In client UIs, they should be rendered as prominent header banners rather than calendar agenda cards.
- **Confidence Level:** **Verified**.

---

## 7. API Security and Barangay Isolation Findings

### 7.1 Security Audit of Existing Endpoints

| Endpoint | Permission Classes | Queryset Filtering | Exposed Fields | Security / Leakage Risk | Confidence Level |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET /api/public/schedule/` | `AllowAny` | Hardcoded active/pending schedules | Sanitized projection (`id`, `area`, `days`, `time`, `barangays`) | Low risk. Does not leak driver or truck IDs. | **Verified** |
| `GET /api/driver/collection-schedules/` | `AllowAny` on safe methods; `IsAppAdmin` on writes | `CollectionSchedule.objects.all()` (no tenant or role filter) | `fields = '__all__'` | **HIGH RISK.** Unauthenticated users can scrape driver names, user IDs, truck plates, dumpsite IDs, and raw GPS waypoints. | **Verified** |
| `GET /api/events/` | `AllowAny` on safe methods | Non-admin sees `status='PUBLISHED'`; admin sees all | Full event serializer with barangay details | Low risk. Correctly isolates draft/archived events from public view. | **Verified** |
| `GET /api/news/items/` | `AllowAny` on safe methods | Anonymous/citizens see `status='PUBLISHED'` & `is_active=True` | Standard news serializer | Low risk. Drafts and archives isolated to staff/admin. | **Verified** |
| `GET /api/news/alerts/` | `AllowAny` on safe methods | Public sees `is_active=True`; staff/admin sees all | Standard alert serializer | Low risk. Inactive alerts isolated to staff/admin. | **Verified** |

### 7.2 Critical Vulnerability: Operational Route Scraping
The existing endpoint `GET /api/driver/collection-schedules/?paginate=false` in [`driver/views.py:371-374`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/views.py#L371-L374) allows anonymous scrapers to harvest driver names, driver phone numbers, truck license plates, and exact route waypoint coordinates across Lucena City.  
> [!WARNING]
> This vulnerability exists in the current codebase. Under Stage 0.1 read-only boundaries, this defect must NOT be fixed in this phase. It is documented here as an urgent finding to be addressed in a dedicated driver API security sprint. The new Calendar Service avoids this vulnerability by strictly refusing to reuse `CollectionScheduleSerializer`.

### 7.3 Barangay Isolation
- For `MunicipalEvent`, barangay officials querying the API are filtered to their own assigned barangay plus citywide events. Unassigned citizens view published citywide events and can filter by `barangay_id`.
- For `CollectionSchedule`, public calendar queries filter by `barangay_id` or default to citywide plus barangay routes. No cross-barangay data contamination occurs.

---

## 8. Pagination, Ordering, and Capacity Findings

### 8.1 Date Range Bounding ($\le 93$ Days)
- **Rationale:** Frontend calendar components render 7-day strips ([`OfflineEventCalendar.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/components/OfflineEventCalendar.jsx)) or 30/31-day month grids ([`CollectionSchedule.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/CollectionSchedule.jsx)). A 93-day ceiling supports a full 3-month quarterly view without truncation.
- **Enforcement:** Enforced in [`validate_date_window`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/selectors.py#L36-L47). Inverted date ranges or ranges $> 93$ days immediately return HTTP 400 Bad Request.

### 8.2 Recurring Template Capacity (100 Active Templates)
- **Fleet Alignment:** Lucena City comprises 33 barangays served by 10–15 compactor trucks. The total active recurring route count across the city is 40–60 schedules. The 100-template limit provides $\sim 100\%$ headroom above peak municipal operational volume.
- **Fail-Closed Overflow:** [`select_collection_schedules`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/selectors.py#L125) executes a query fetching up to 101 records. If the count exceeds 100, it raises `CalendarCapacityError` (HTTP 503), preventing silent truncation.

### 8.3 Global Pagination and Deterministic Sorting
- **Ordering Tie-Breaker:** Heterogeneous records originating across multiple tables cannot be sorted at the database level with global `LIMIT/OFFSET`. Candidates are retrieved within the bounded $[start\_date, end\_date]$ window, normalized, and sorted using the deterministic 4-tuple key:
  $$\text{Sort Key} = (\text{start\_datetime}, \text{priority\_int}, \text{source\_str}, \text{source\_id})$$
  Where priority is: `emergency_advisory` (0), `municipal_event` (1), `collection_schedule` (2), `announcement`/`news` (3).
- **Pagination Mechanics:** Standard DRF `PageNumberPagination` (default 20, max 50). Unpaginated requests (`paginate=false`) are permitted only for date windows $\le 31$ days with a hard cap of 250 entries, raising `CalendarCapacityError` if exceeded.

---

## 9. Existing `calendar_service` Files and Test Evidence

### 9.1 File Inventory

| File Path | Nature / State | Description |
| :--- | :--- | :--- |
| [`calendar_service/apps.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/apps.py) | AppConfig | Registers `calendar_service` application. |
| [`calendar_service/urls.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/urls.py) | URL Configuration | Maps `/api/calendar/entries/` to `CalendarEntryView`. |
| [`calendar_service/exceptions.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/exceptions.py) | Domain Exceptions | Typed exceptions: `CalendarServiceError`, `CalendarDateRangeError`, `CalendarCapacityError`. |
| [`calendar_service/normalizers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/normalizers.py) | Normalization Logic | Transforms heterogeneous ORM models into sanitized Contract v0.2 dictionaries. |
| [`calendar_service/selectors.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/selectors.py) | Bounded Selectors | Executes bounded, read-only ORM queries with N+1 prevention (`prefetch_related`, batch lookups). |
| [`calendar_service/serializers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/serializers.py) | DRF Serializers | Validates incoming query parameters and formats outgoing calendar entry schemas. |
| [`calendar_service/aggregator.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/aggregator.py) | Aggregation Engine | Orchestrates multi-source collection, filtering, global sorting, and capacity enforcement. |
| [`calendar_service/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/views.py) | API View | DRF `APIView` handling HTTP GET requests, pagination, and error responses. |

### 9.2 Empirical Test Execution Evidence
All tests were executed using the official backend virtual environment test runner:
```powershell
& "d:\Coding\Waste Watch\wastewatch\backend\venv\Scripts\python.exe" "d:\Coding\Waste Watch\wastewatch\backend\manage.py" test calendar_service -v 2
```

**Execution Result:** **87 / 87 Tests PASSED in 25.561s (`Ran 87 tests. OK`)**

#### Breakdown of Executed Test Suites:

1. **`CalendarServiceAppFoundationTests` ([`tests/test_app_foundation.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_app_foundation.py)) — 5 tests:**
   - `test_app_is_installed`: Verifies Django application registry recognition. (`ok`)
   - `test_app_config_attributes`: Verifies `CalendarServiceConfig` class attributes. (`ok`)
   - `test_single_registration_in_settings`: Verifies exactly one entry in `INSTALLED_APPS`. (`ok`)
   - `test_zero_persistent_models`: Verifies zero database models exist in `calendar_service`. (`ok`)
   - `test_urls_module_metadata`: Verifies canonical namespace and route definition. (`ok`)

2. **`CalendarServiceURLWiringTests` ([`tests/test_app_foundation.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_app_foundation.py)) — 2 tests:**
   - `test_no_unfinished_api_exposed`: Verifies `/api/calendar/` does not resolve to an unfinished view. (`ok`)
   - `test_existing_core_routes_preserved`: Verifies events, public schedule, news, and auth URLs remain intact. (`ok`)

3. **`CollectionScheduleSelectorTests` ([`tests/test_collection_schedule.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_collection_schedule.py)) — 3 tests:**
   - `test_select_schedules_in_date_range`: Verifies date-bounded query selection. (`ok`)
   - `test_include_cancelled_when_requested`: Verifies cancelled schedules excluded by default. (`ok`)
   - `test_barangay_filter_matches_or_citywide`: Verifies barangay isolation and citywide inclusion. (`ok`)

4. **`CollectionScheduleRecurrenceTests` ([`tests/test_collection_schedule.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_collection_schedule.py)) — 2 tests:**
   - `test_recurring_schedule_weekday_expansion`: Verifies recurrence expansion strictly on matching weekdays. (`ok`)
   - `test_one_time_schedule_date_precedence`: Verifies one-time `date` takes precedence over `days`. (`ok`)

5. **`CollectionScheduleScopeTests` ([`tests/test_collection_schedule.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_collection_schedule.py)) — 1 test:**
   - `test_scope_classification_precedence`: Verifies classification priority (`barangay`, `citywide`, `area`, `unassigned`). (`ok`)

6. **`CollectionScheduleCompletionTests` ([`tests/test_collection_schedule.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_collection_schedule.py)) — 1 test:**
   - `test_completion_status_verified_collected`: Verifies occurrence marked completed only with valid stop evidence. (`ok`)

7. **`CollectionScheduleSanitizationTests` ([`tests/test_collection_schedule.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_collection_schedule.py)) — 1 test:**
   - `test_sanitization_omits_driver_truck_dumpsite_and_waypoints`: Verifies strict exclusion of operational metadata. (`ok`)

8. **`CollectionScheduleCapacityTests` ([`tests/test_collection_schedule.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_collection_schedule.py)) — 2 tests:**
   - `test_date_window_limit_enforced_93_days`: Verifies 93-day boundary enforcement. (`ok`)
   - `test_capacity_limit_overflow_detection`: Verifies `CalendarCapacityError` raised on > 100 templates. (`ok`)

9. **`CollectionScheduleLifecycleSemanticsTests` ([`tests/test_collection_schedule.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_collection_schedule.py)) — 18 tests:**
   - Verifies all permutations of one-time and recurring schedules across `PENDING`, `COMPLETED`, `CANCELLED` statuses. (`ok`)

10. **`MunicipalEventCalendarIntegrationTests` ([`tests/test_stage1c_sources.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1c_sources.py)) — 8 tests:**
    - Verifies event normalization, status filtering, public vs. admin visibility, and barangay scoping. (`ok`)

11. **`NewsItemCalendarIntegrationTests` ([`tests/test_stage1c_sources.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1c_sources.py)) — 5 tests:**
    - Verifies notice gate (`include_notices=False` default), all-day notice semantics, draft isolation. (`ok`)

12. **`EmergencyAlertCalendarIntegrationTests` ([`tests/test_stage1c_sources.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1c_sources.py)) — 5 tests:**
    - Verifies citywide advisory normalization, active/inactive filtering, and alert gating. (`ok`)

13. **`OperationalRolesStage1CAuthorizationTests` ([`tests/test_stage1c_sources.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1c_sources.py)) — 4 tests:**
    - Verifies watcher, driver, and dumpsite operators receive sanitized public access only. (`ok`)

14. **`CalendarEndpointBasicsTests` ([`tests/test_stage1d_endpoint.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1d_endpoint.py)) — 6 tests:**
    - Verifies HTTP GET 200, unsafe methods rejected (405), missing/malformed/inverted dates rejected (400), 93-day boundary. (`ok`)

15. **`CalendarSourceAggregationTests` ([`tests/test_stage1d_endpoint.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1d_endpoint.py)) — 3 tests:**
    - Verifies distinct canonical `entry_type` values, notices excluded by default, notices included when requested. (`ok`)

16. **`CalendarGlobalSortingAndPaginationTests` ([`tests/test_stage1d_endpoint.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1d_endpoint.py)) — 5 tests:**
    - Verifies deterministic tie-breaking, page size cap (50), pagination slicing without data loss, unpaginated mode ($\le 31$ days). (`ok`)

17. **`CalendarFiltersAndBooleanValidationTests` ([`tests/test_stage1d_endpoint.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1d_endpoint.py)) — 5 tests:**
    - Verifies filtering by barangay, source, invalid barangay rejection (400), strict boolean parsing, unsupported source rejection. (`ok`)

18. **`CalendarAuthorizationAndVisibilityTests` ([`tests/test_stage1d_endpoint.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1d_endpoint.py)) — 7 tests:**
    - Verifies anonymous, citizen, official, driver, watcher, dumpsite, and admin visibility rules. (`ok`)

19. **`CalendarCapacityAndPerformanceTests` ([`tests/test_stage1d_endpoint.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1d_endpoint.py)) — 4 tests:**
    - Verifies query count efficiency (N+1 query prevention), active template cap enforcement (503 on overflow), unpaginated cap enforcement. (`ok`)

---

## 10. Forecasting Isolation Confirmation

The Calendar Service architecture remains completely decoupled from the WasteWatch forecasting subsystem. As confirmed through repository inspection and settings verification:

1. **No Forecasting Model Changes:** Ridge regression remains the only approved supervised forecasting model.
2. **No Feature Engineering Changes:** The 26 active cyclical and temporal features documented in the calendar feature corrections remain untouched.
3. **No Pipeline Changes:** Training, serving, evaluation, and shadow-mode pipelines have not been modified.
4. **No Forecast Schema Changes:** The active feature schema and artifact validation logic remain intact.
5. **No Setting Changes:** `FORECAST_ML_ENABLED = False` remains active in [`wastewatch/settings.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/settings.py). The seasonal heuristic remains the sole production-primary forecast.
6. **No Model Promotion:** No Ridge models have been promoted to production.
7. **Zero Cross-Subsystem Imports:** No calendar service models, normalizers, selectors, or endpoints are imported by or linked to the `forecasting` application.

---

## 11. Corrected Calendar Service Contract v0.1

### 11.1 Request Specification
- **Path:** `GET /api/calendar/entries/`
- **Authentication:** Optional (`AllowAny` for public safe access; role-aware for authenticated users).
- **Mandatory Query Parameters:**
  - `start_date`: ISO date `YYYY-MM-DD`.
  - `end_date`: ISO date `YYYY-MM-DD`.
  - **Constraint:** `(end_date - start_date).days + 1 <= 93` (HTTP 400 if violated).
- **Optional Query Parameters:**
  - `barangay_id`: Integer ID or `'citywide'`.
  - `source`: Single source filter (`'collection_schedule'`, `'municipal_event'`, `'news_item'`, `'emergency_alert'`, or `'all'`). Default: `'all'`.
  - `category`: Category string matching normalized enum.
  - `status`: Status string matching normalized enum.
  - `include_notices`: Boolean (Default: `false`). Controls inclusion of `NewsItem` and `EmergencyAlert`.
  - `paginate`: Boolean (Default: `true`). If `false`, date range must be $\le 31$ days and results $\le 250$ entries.
  - `page`: Integer $\ge 1$ (Default: 1).
  - `page_size`: Integer $1..50$ (Default: 20).

### 11.2 Normalized Output Schema (Paginated Mode)
```json
{
  "count": 42,
  "total_pages": 3,
  "current_page": 1,
  "page_size": 20,
  "next": "/api/calendar/entries/?end_date=2026-11-30&page=2&start_date=2026-11-01",
  "previous": null,
  "results": [
    {
      "id": "sched_80_20261115",
      "source": "collection_schedule",
      "source_id": 80,
      "title": "Waste Collection — Isabang",
      "description": "Regular municipal waste collection route.",
      "start_datetime": "2026-11-15T06:00:00+08:00",
      "end_datetime": "2026-11-15T10:00:00+08:00",
      "location": "Isabang, Lucena City",
      "barangays": [
        {"id": 1, "name": "Isabang"}
      ],
      "category": "collection_schedule",
      "entry_type": "collection_schedule",
      "status": "scheduled",
      "is_all_day": false,
      "detail_url": "/schedule",
      "metadata": {
        "scope": "barangay",
        "is_citywide": false,
        "total_stops": 4
      }
    }
  ]
}
```

---

## 12. Outstanding CENRO Policy Decisions

The following four business policy decisions require explicit determination from CENRO leadership prior to production rollout:

1. **Statutory Holiday Collection Suspension Policy:**  
   `[REQUIRES CENRO APPROVAL]`  
   Does municipal waste collection operate normally on Philippine statutory holidays (e.g. Christmas Day, Good Friday, New Year's Day), or should recurrence expansion automatically suppress occurrences falling on holidays listed in [`forecasting.features.is_philippine_holiday`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/forecasting/features.py#L38)?
2. **Empty Barangay Association Interpretation:**  
   `[REQUIRES CENRO APPROVAL]`  
   When a collection schedule has zero assigned barangays (`barangays.count() == 0`), should the system treat it as citywide public collection, or exclude it from public view as an internal/depot route?
3. **Editorial Notice Opt-In Policy:**  
   `[REQUIRES CENRO APPROVAL]`  
   Should general news announcements (`NewsItem`) remain opt-in only (`include_notices=False` default) to prevent cluttering the event calendar, or should non-event announcements be visible to citizens by default?
4. **Historical Completion Exposure Threshold:**  
   `[REQUIRES CENRO APPROVAL]`  
   If a historical collection route has 1 unvalidated stop out of 20, should the public status show `operationally_completed` or `unverified`?

---

## 13. Required Stage 1 Implementation Tests

When Stage 1 implementation is formally authorized, the test suite must execute and pass the following verified matrix:

### A. Authorization & Security (15 Tests)
- Anonymous users receive public entries only; draft and archived records are excluded.
- Barangay officials are restricted to their assigned barangay and citywide entries.
- App admins receive draft and archived items.
- Watcher, driver, and dumpsite operators receive sanitized public access without internal drafts.
- Collection schedule normalizer completely purges driver IDs, driver names, truck plates, dumpsite IDs, and raw waypoints.

### B. Recurrence & Data Quality (25 Tests)
- One-time schedules expand on their exact `date`.
- Recurring schedules expand only on matching weekdays.
- Empty `days` strings emit 0 occurrences without crashing.
- Schedules with $\le 1$ waypoints default cleanly to `scheduled` or `unverified`.
- Parent template status (`COMPLETED`, `CANCELLED`) does not cause future or past occurrence misclassification.

### C. Calendar Correctness & Determinism (25 Tests)
- Asia/Manila (+08:00) timezone offsets enforced on all datetimes.
- Strict date validation: missing dates return 400; inverted dates return 400; ranges $> 93$ days return 400.
- Multi-source tie-breaking strictly follows `(start_datetime, priority, source, source_id)`.
- NewsItem publication date is never projected as a scheduled activity.
- Emergency alerts ignore barangay parameters and remain citywide.

### D. Performance & Capacity (22 Tests)
- Database query count remains bounded ($\le 6$ queries) regardless of entry count (no N+1 queries).
- Exceeding 100 active recurring templates raises `CalendarCapacityError` (HTTP 503).
- Unpaginated requests exceeding 31 days or 250 entries raise `CalendarCapacityError` (HTTP 503).
- Global pagination preserves total count and slices accurately across page boundaries.

---

## 14. Stage 1 Readiness Recommendation

### **READY FOR CONTRACT FINALIZATION** — All critical architecture questions have sufficient evidence; only documented policy decisions remain.

### Remaining Policy Blockers to Resolve Prior to Stage 1 Production Release:
1. CENRO formal approval of Statutory Holiday collection suppression rules.
2. CENRO decision on empty barangay routing interpretation.
3. CENRO confirmation of `include_notices=False` default opt-in behavior.
4. Separate backlog ticket created for securing `GET /api/driver/collection-schedules/` to resolve the operational route data leakage.
