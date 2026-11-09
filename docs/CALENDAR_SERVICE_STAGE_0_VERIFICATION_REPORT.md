# WasteWatch — Stage 0: Calendar Service Source-Code Verification Report

**Project:** WasteWatch — CENRO Lucena City Solid Waste Management System  
**Document:** Stage 0 Architecture and Source-Code Verification Report  
**Assigned Role:** Lead Implementer / Repository Investigator  
**Reviewer:** ChatGPT — Project Manager / Architecture Authority  
**Independent Auditor:** Claude — Technical Review Authority  
**Date:** 2026-11-09  
**Authorization Status:** Stage 0 Complete (Read-Only Verification); Stage 1 Implementation NOT Authorized  
**ML Governance Status:** `FORECAST_ML_ENABLED = False` (Ridge ML disabled; forecasting feature schema protected)

---

## Section 1 — Executive Summary

### 1.1 Overall Repository Findings
An exhaustive, read-only inspection of the WasteWatch repository was conducted across all calendar-related Django applications ([`events`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events), [`driver`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver), [`news`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news), [`watcher`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher), [`accounts`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/accounts), [`calendar_service`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service)) and frontend React components ([`OfflineEventCalendar.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/components/OfflineEventCalendar.jsx), [`AdminEventManagement.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/admin/events/AdminEventManagement.jsx), [`CollectionSchedule.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/CollectionSchedule.jsx), [`NewsPage.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/news/NewsPage.jsx), [`CommunitySidebar.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/community/components/CommunitySidebar.jsx)).

The inspection confirms that the five domain models identified in the architectural charter exist, are distinct, and possess clearly demarcated domain responsibilities:
1. [`MunicipalEvent`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/models.py#L34-L113) manages scheduled environmental, civic, and municipal activities with explicit start/end datetimes, categories, and formal lifecycle state transitions.
2. [`CollectionSchedule`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L81-L166) stores waste collection routing templates (both recurring weekday rules and one-time date assignments) paired with vehicle, driver, dumpsite, and waypoint configurations.
3. [`NewsItem`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/models.py#L37-L141) manages editorial content, general news, and targeted community announcements with barangay-level visibility rules.
4. [`EmergencyAlert`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/models.py#L143-L155) manages urgent, citywide emergency advisories.
5. [`driver.CalendarEvent`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L354-L364) manages internal driver assignments and operational reminders, mounted strictly behind authenticated driver/admin endpoints.

### 1.2 Current Calendar Implementation Maturity
The maturity of calendar-related components in the codebase is heterogeneous:
- **Administrative Municipal Events:** Highly mature. Features row-level locking, atomic state transitions, strict validation against illegal status regressions, and complete DRF test coverage ([`events/tests.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/tests.py)).
- **Driver Collection Scheduling:** Highly mature for operational routing and dispatching, but semantically dual: it acts simultaneously as a recurring day-of-week template generator and a one-time date-specific record. Actual completion tracking is externalized in [`watcher.StopValidation`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py#L383-L445) and [`driver.PickupStatus`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L177-L208).
- **Public Calendar Consumer:** Severely disconnected. The current citizen-facing calendar component ([`OfflineEventCalendar.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/components/OfflineEventCalendar.jsx)) attempts to query a non-existent endpoint (`/api/public/events/`) and expects mock schema fields (`wasteImpact`, `surge`, `action`, `type='fiesta'|'market'`). Because that endpoint returns 404, the component permanently falls back to hardcoded mock events stored in `localStorage`.
- **Public Schedule Consumer:** [`wastewatch/public_api.py:public_schedule_view`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/public_api.py#L136-L160) provides an unpaginated, simplified summary of collection schedules for the citizen dashboard, but performs no bounded date expansion.

### 1.3 Main Architectural Risks
1. **N+1 Query Explosion:** Without aggressive `select_related` and `prefetch_related` on ManyToMany barangay associations and ForeignKey lookups across multiple querysets, aggregating records over a multi-week calendar window will cause severe query amplification.
2. **Operational Data Leakage:** Exposing [`CollectionSchedule`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L81) directly through a public calendar risks leaking internal operational data, including driver names, user IDs, truck plate numbers, dumpsite facility IDs, and raw GPS waypoints.
3. **Cross-Barangay Information Exposure:** Filtering by barangay must not inadvertently leak draft municipal events, archived announcements, or restricted barangay-specific notices to unauthorized users or residents of other barangays.
4. **Unbounded Date-Range DOS:** Allowing clients to supply arbitrary `start_date` and `end_date` parameters without server-enforced bounding risks memory exhaustion and CPU saturation during recurring template expansion.
5. **False Recurrence Assumptions:** [`CollectionSchedule`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L81) stores recurring days as a loose comma-separated string (e.g., `'Mon, Wed, Fri'`) without an RFC 5545 recurrence rule engine, recurrence end dates, or an exception/cancellation model for individual dates.

### 1.4 Feasibility Assessment
The proposed architecture — consolidating records from existing domain models into a unified, read-only [`calendar_service`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service) without creating duplicate persistent database models — is **completely feasible and architecturally sound**. Prototype foundational tests and selectors in `calendar_service/` confirm that read-only aggregation can be achieved cleanly in memory with zero database migrations and strict fail-closed security.

---

## Section 2 — Exact Files Inspected

### 2.1 Backend Django Applications
- **Events Application:**
  - [`events/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/models.py) (Lines 1–113: `EventStatus`, `EventCategory`, `VALID_EVENT_TRANSITIONS`, `MunicipalEvent`)
  - [`events/serializers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/serializers.py) (Lines 1–118: `MunicipalEventSerializer`)
  - [`events/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/views.py) (Lines 1–287: `MunicipalEventViewSet`, actions `admin_stats`, `publish`, `cancel`, `complete`, `archive`, `restore`)
  - [`events/urls.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/urls.py) (Lines 1–10: DefaultRouter registration)
  - [`events/services.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/services.py) (Notification dispatch for publication and cancellation)
  - [`events/tests.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/tests.py) (Lines 1–615: `MunicipalEventBackendTests`)
- **Driver Application:**
  - [`driver/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py) (Lines 81–166: `CollectionSchedule`, Lines 167–176: `RouteAssignment`, Lines 177–208: `PickupStatus`, Lines 354–364: `CalendarEvent`, Lines 380–436: `MissedStop`)
  - [`driver/serializers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/serializers.py) (Lines 153–220: `CollectionScheduleSerializer`, Lines 427–433: `CalendarEventSerializer`)
  - [`driver/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/views.py) (Lines 365–383: `CollectionScheduleViewSet`, Lines 2448–2452: `CalendarEventViewSet`)
  - [`driver/urls.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/urls.py) (Lines 1–15: URL router registrations)
  - [`driver/crew_resolver.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/crew_resolver.py) (Lines 1–73: `normalize_days`, `get_crew_assignment_for`)
  - [`driver/tests/test_schedule_api.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/tests/test_schedule_api.py) (Lines 1–160: `ScheduleAPITests`)
- **News Application:**
  - [`news/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/models.py) (Lines 1–142: `NewsItem`, `ContentStatus`, `NewsType`, `NewsCategory`, `Priority`; Lines 143–155: `EmergencyAlert`)
  - [`news/serializers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/serializers.py) (Lines 1–85: `NewsItemSerializer`, Lines 87–91: `EmergencyAlertSerializer`)
  - [`news/views.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/views.py) (Lines 16–209: `NewsItemViewSet`, Lines 210–245: `EmergencyAlertViewSet`)
  - [`news/urls.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/urls.py) (Lines 1–12: router registrations)
  - [`news/tests.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/tests.py) (Lines 1–469: `NewsContentManagementComprehensiveTests`)
- **Watcher Application:**
  - [`watcher/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py) (Lines 371–381: `StopValidationStatus`, Lines 383–445: `StopValidation`)
- **Accounts & Shared Infrastructure:**
  - [`accounts/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/accounts/models.py) (Lines 91–98: `UserRole`, Lines 103–160: `User`)
  - [`accounts/permissions.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/accounts/permissions.py) (Lines 18–40: `is_admin_user`, `IsAdminRole`, `IsAdminRoleOrReadOnly`)
  - [`wastewatch/api_urls.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/api_urls.py) (Lines 1–67: root API dispatch)
  - [`wastewatch/public_api.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/public_api.py) (Lines 21–40: `announcements_view`, Lines 136–160: `public_schedule_view`)
  - [`wastewatch/settings.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/settings.py) (Lines 164–166: `TIME_ZONE = 'Asia/Manila'`, `USE_TZ = True`)
- **Calendar Service Foundation (In-Progress Stage 1 Prototype):**
  - [`calendar_service/apps.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/apps.py) (`CalendarServiceConfig`)
  - [`calendar_service/urls.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/urls.py) (Empty route configuration)
  - [`calendar_service/exceptions.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/exceptions.py) (`CalendarServiceError`, `CalendarDateRangeError`, `CalendarCapacityError`)
  - [`calendar_service/normalizers.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/normalizers.py) (Occurrence expansion, scope classification, completion status evaluation)
  - [`calendar_service/selectors.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/selectors.py) (Bounded database selectors)
  - [`calendar_service/tests/test_app_foundation.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_app_foundation.py)
  - [`calendar_service/tests/test_collection_schedule.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_collection_schedule.py)
  - [`calendar_service/tests/test_stage1c_sources.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service/tests/test_stage1c_sources.py)

### 2.2 Frontend Modules
- [`wastewatch/frontend/src/components/OfflineEventCalendar.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/components/OfflineEventCalendar.jsx)
- [`wastewatch/frontend/src/pages/admin/events/AdminEventManagement.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/admin/events/AdminEventManagement.jsx)
- [`wastewatch/frontend/src/pages/admin/events/EventTable.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/admin/events/EventTable.jsx)
- [`wastewatch/frontend/src/pages/admin/events/EventEditorModal.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/admin/events/EventEditorModal.jsx)
- [`wastewatch/frontend/src/pages/admin/events/EventFiltersToolbar.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/admin/events/EventFiltersToolbar.jsx)
- [`wastewatch/frontend/src/pages/CollectionSchedule.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/CollectionSchedule.jsx)
- [`wastewatch/frontend/src/pages/community/components/CommunitySidebar.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/community/components/CommunitySidebar.jsx)
- [`wastewatch/frontend/src/pages/news/hooks/useNewsItems.js`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/news/hooks/useNewsItems.js)
- [`wastewatch/frontend/src/hooks/useEmergencyAlerts.js`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/hooks/useEmergencyAlerts.js)

---

## Section 3 — Existing Model Verification

### 3.1 `MunicipalEvent` ([`events/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/models.py#L34-L113))

| Attribute / Field | Database Type | Constraints & Defaults | Domain Semantics |
| :--- | :--- | :--- | :--- |
| `id` | `BigAutoField` | Primary Key, Auto-increment | Unique event record identifier |
| `title` | `CharField(255)` | Non-null | Name of the civic or environmental event |
| `description` | `TextField` | Non-null | Full event agenda, description, and guidelines |
| `start_datetime` | `DateTimeField` | Non-null, Indexed (`db_index=True`) | Start timestamp (with timezone, Asia/Manila) |
| `end_datetime` | `DateTimeField` | Non-null, Indexed (`db_index=True`) | End timestamp (strictly > `start_datetime`) |
| `location` | `CharField(255)` | Non-null | Venue, facility, or street address |
| `barangays` | `ManyToManyField` | `accounts.Barangay`, `blank=True` | Associated barangays. **Empty = Citywide** |
| `category` | `CharField(50)` | Choices: `EventCategory`, Default: `general` | Category enum (see below) |
| `organizer` | `CharField(255)` | Default: `'Lucena City CENRO'` | Hosting department or community organizer |
| `status` | `CharField(20)` | Choices: `EventStatus`, Default: `draft` | Lifecycle status enum (see below) |
| `cover_image` | `CloudinaryField` | `null=True, blank=True` | Event promotional image stored in Cloudinary |
| `created_by` | `ForeignKey` | `AUTH_USER_MODEL`, `SET_NULL`, `null=True` | Creating administrative user |
| `created_at` | `DateTimeField` | `auto_now_add=True` | Audit timestamp |
| `updated_at` | `DateTimeField` | `auto_now=True` | Mutation audit timestamp |

- **Categories (`EventCategory`):** `cleanup` (Cleanup Drive), `community_meeting` (Community Meeting), `hazardous_waste` (Special Waste Collection), `tree_planting` (Tree Planting), `workshop` (Public Orientation & Seminar), `general` (General Municipal Event).
- **Statuses (`EventStatus`):** `draft`, `published`, `cancelled`, `completed`, `archived`.
- **State Transitions:** Strictly enforced in `clean()`. Transitions outside `VALID_EVENT_TRANSITIONS` raise `ValidationError`.
- **Citywide Determination:** Derived via `@property is_citywide` which evaluates `not self.barangays.exists()`.
- **Calendar Suitability:** 100% compatible. Can support calendar aggregation immediately via `select_related('created_by')` and `prefetch_related('barangays')` without model mutation.

### 3.2 `CollectionSchedule` ([`driver/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L81-L166))

| Attribute / Field | Database Type | Constraints & Defaults | Domain Semantics |
| :--- | :--- | :--- | :--- |
| `id` | `BigAutoField` | Primary Key, Auto-increment | Schedule template/record identifier |
| `truck` | `ForeignKey` | `driver.Truck`, `SET_NULL`, `null=True` | Assigned waste collection vehicle |
| `driver` | `ForeignKey` | `AUTH_USER_MODEL`, `SET_NULL`, `null=True` | Assigned driver |
| `barangays` | `ManyToManyField` | `accounts.Barangay`, `blank=True` | Assigned service barangays |
| `area` | `CharField(255)` | `blank=True` | Free-text zone/route label (e.g. `'Zone 1'`) |
| `start_time` | `TimeField` | Non-null | Scheduled collection window start |
| `end_time` | `TimeField` | Non-null | Scheduled collection window end |
| `days` | `CharField(100)` | `blank=True`, e.g. `'Mon, Wed, Fri'` | Recurring collection day-of-week rule |
| `frequency` | `CharField(100)` | `blank=True` | Informational frequency text |
| `waypoints` | `JSONField` | `default=list, blank=True` | Ordered route waypoints (lat/lng/label) |
| `dumpsite` | `ForeignKey` | `dumpsite.Dumpsite`, `SET_NULL`, `null=True` | Destination unloading dumpsite |
| `date` | `DateField` | `null=True, blank=True` | Specific date for one-time schedule |
| `status` | `CharField(10)` | Choices: `PENDING`, `COMPLETED`, `CANCELLED` | Schedule lifecycle status |

- **Operational Coupling:** On `save()`, automatically calls `self.sync_pickup_statuses()`, synchronizing [`driver.PickupStatus`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L177) and calling [`watcher.stop_validation_service`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py) for all stops (`waypoints[1:]`).
- **Calendar Suitability:** Requires normalized occurrence expansion across requested dates, plus strict sanitization to omit `driver`, `truck`, `dumpsite`, and `waypoints`.

### 3.3 `NewsItem` ([`news/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/models.py#L37-L141))

| Attribute / Field | Database Type | Constraints & Defaults | Domain Semantics |
| :--- | :--- | :--- | :--- |
| `id` | `BigAutoField` | Primary Key, Auto-increment | News/announcement identifier |
| `title` | `CharField(255)` | Non-null | Announcement headline |
| `description` | `TextField` | Non-null | Full body / article markdown |
| `type` | `CharField(20)` | Choices: `announcement`, `news`, `emergency` | Editorial publication type |
| `category` | `CharField(30)` | Choices: `NewsCategory` (10 choices) | Content taxonomy category |
| `priority` | `CharField(10)` | Choices: `low`, `medium`, `high` | Visual priority / prominence |
| `date` | `DateField` | `auto_now_add=True` | Publication / creation calendar date |
| `barangay` | `ForeignKey` | `accounts.Barangay`, `SET_NULL`, `null=True` | Target barangay (**null = citywide**) |
| `is_featured` | `BooleanField` | Default: `False` | Pin to hero carousel |
| `is_pinned` | `BooleanField` | Default: `False` | Pin to top of newsfeed |
| `is_active` | `BooleanField` | Default: `True` | Visibility flag (synchronized with `status`) |
| `status` | `CharField(20)` | Choices: `draft`, `published`, `archived` | Content status enum |
| `author` | `ForeignKey` | `AUTH_USER_MODEL`, `SET_NULL`, `null=True` | Publishing staff user |
| `image` | `CloudinaryField` | `null=True, blank=True` | Cover/card image |
| `updated_at` | `DateTimeField` | `auto_now=True` | Last modification timestamp |

- **Calendar Suitability:** Can be included as an optional overlay (`source='announcement'`), using `date` as an all-day event (`is_all_day=True`).

### 3.4 `EmergencyAlert` ([`news/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/models.py#L143-L155))

| Attribute / Field | Database Type | Constraints & Defaults | Domain Semantics |
| :--- | :--- | :--- | :--- |
| `id` | `BigAutoField` | Primary Key, Auto-increment | Emergency alert identifier |
| `title` | `CharField(255)` | Non-null | Advisory headline |
| `body` | `TextField` | Non-null | Urgent instructions / advisory text |
| `date` | `DateField` | `auto_now_add=True` | Issued date |
| `is_active` | `BooleanField` | Default: `True` | Active status flag |
| `updated_at` | `DateTimeField` | `auto_now=True` | Last update timestamp |

- **Critical Structural Characteristic:** Does **NOT** have a `barangay` foreign key. Emergency alerts are strictly citywide.
- **Calendar Suitability:** Must be classified distinctly as `category='emergency_advisory'` (never conflated with municipal events).

### 3.5 `driver.CalendarEvent` ([`driver/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L354-L364))

| Attribute / Field | Database Type | Constraints & Defaults | Domain Semantics |
| :--- | :--- | :--- | :--- |
| `id` | `BigAutoField` | Primary Key, Auto-increment | Internal operational calendar ID |
| `title` | `CharField(200)` | Non-null | Shift or operational event title |
| `date` | `DateField` | Non-null | Operational date |
| `location` | `CharField(255)` | `blank=True` | Operational site or garage |
| `assigned_to` | `ForeignKey` | `AUTH_USER_MODEL`, `SET_NULL`, `null=True` | Assigned driver or crew member |
| `description` | `TextField` | `blank=True` | Internal instructions or shift notes |
| `created_at` | `DateTimeField` | `auto_now_add=True` | Record creation timestamp |

- **Calendar Boundary:** Internal operational tool. Must **NOT** be included in the public calendar service.

---

## Section 4 — Existing API Verification

| Endpoint | Method(s) | View / ViewSet | Permissions | Filtering / Parameters | Pagination |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/events/` | GET, POST | [`MunicipalEventViewSet`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/events/views.py#L16) | `IsAdminRoleOrReadOnly` | `status`, `category`, `barangay`, `start_date`, `end_date`, `search`, `ordering` | Default DRF pagination |
| `/api/events/<id>/` | GET, PUT, PATCH, DELETE | `MunicipalEventViewSet` | `IsAdminRoleOrReadOnly` | Object lookup by PK | None |
| `/api/events/<id>/publish/` | POST | `MunicipalEventViewSet` | `IsAdminRole` | Row-level locked transition | None |
| `/api/events/<id>/cancel/` | POST | `MunicipalEventViewSet` | `IsAdminRole` | Row-level locked transition | None |
| `/api/events/<id>/complete/` | POST | `MunicipalEventViewSet` | `IsAdminRole` | Row-level locked transition | None |
| `/api/events/<id>/archive/` | POST | `MunicipalEventViewSet` | `IsAdminRole` | Row-level locked transition | None |
| `/api/events/<id>/restore/` | POST | `MunicipalEventViewSet` | `IsAdminRole` | Row-level locked transition | None |
| `/api/events/admin-stats/` | GET | `MunicipalEventViewSet` | `IsAdminRole` | Aggregates counts | None |
| `/api/driver/collection-schedules/` | GET, POST | [`CollectionScheduleViewSet`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/views.py#L365) | GET: `AllowAny`, Write: `IsAppAdmin` | `allow_unpaginated=True` (`?paginate=false`) | `StandardResultsSetPagination` |
| `/api/driver/calendar-events/` | GET, POST, PUT, DELETE | [`CalendarEventViewSet`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/views.py#L2448) | `IsAuthenticated` | None | Default DRF pagination |
| `/api/news/items/` | GET, POST | [`NewsItemViewSet`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/views.py#L16) | `IsAdminRoleOrReadOnly` | `barangay_id`, `city_wide`, `type`, `category`, `priority`, `pinned`, `search`, `status`, `admin_mode` | Default DRF pagination |
| `/api/news/alerts/` | GET, POST | [`EmergencyAlertViewSet`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/news/views.py#L210) | `IsAdminRoleOrReadOnly` | `include_inactive`, `admin_mode` | Default DRF pagination |
| `/api/public/schedule/` | GET | [`public_schedule_view`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/public_api.py#L136) | `AllowAny` | Unfiltered, unpaginated summary | None |
| `/api/public/announcements/` | GET | [`announcements_view`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/public_api.py#L21) | `AllowAny` | Limits to 10 featured items | None |
| `/api/public/events/` | **NONE** | **DOES NOT EXIST** | N/A | Front-end 404 target | N/A |

---

## Section 5 — Authorization Matrix

Verified access behavior across all four user roles and source models:

| Source Model | Anonymous Public Users | Authenticated Citizens | Barangay Officials | CENRO Administrators |
| :--- | :--- | :--- | :--- | :--- |
| **MunicipalEvent** | Published, Cancelled, Completed only. Citywide + any queried barangay. Drafts/Archived strictly hidden. | Published, Cancelled, Completed only. Citywide + any queried barangay. Drafts/Archived strictly hidden. | Published, Cancelled, Completed only. Citywide + user's assigned barangay. Cannot view other barangays' exclusive events. | All records (Draft, Published, Cancelled, Completed, Archived). All barangay scopes. Full CRUD. |
| **CollectionSchedule** | PENDING and COMPLETED schedules via unpaginated API. Full internal data currently leaked (vulnerability). | Same as Anonymous. | Same as Anonymous. | Full CRUD. Route builder and reassignment permissions. |
| **NewsItem** | Active (`is_active=True`) and Published (`status='published'`) only. Citywide + queried barangay. | Same as Anonymous. | Can create announcements for own barangay. Citywide + own barangay. Drafts/Archived hidden. | All records (Draft, Published, Archived). Can publish/archive. Full CRUD across all barangays. |
| **EmergencyAlert** | Active alerts (`is_active=True`) only. Strictly citywide. | Active alerts only. Strictly citywide. | Active alerts only. Strictly citywide. | All alerts (Active + Inactive). Full CRUD. Toggle active state. |
| **driver.CalendarEvent** | **FORBIDDEN (401/403)** | **FORBIDDEN (Filtered / Hidden)** | **FORBIDDEN (Filtered / Hidden)** | Full CRUD for operational dispatch. |

---

## Section 6 — CollectionSchedule Semantics

Inspection of [`CollectionSchedule`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L81-L166), [`driver/crew_resolver.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/crew_resolver.py), and [`watcher/models.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py) resolves the critical semantic question:

### 6.1 Dual Representation: Recurring Rule vs. One-Time Assignment
1. **Recurring Collection Plans (`date is Null`):**
   When `date` is `Null`, the row represents a standing, permanent collection rule defined by `days` (e.g. `'Mon, Wed, Fri'`) and time bounds (`start_time`, `end_time`).
2. **One-Time Collection Events (`date is not Null`):**
   When `date` is populated, the row represents a single specific collection event for that calendar date.
3. **Absence of RFC 5545 Semantics:**
   The model has no recurrence rule grammar (RRULE), no recurrence interval (`every 2 weeks`), and no end date (`UNTIL`). It continues indefinitely until deleted or marked `CANCELLED`.
4. **No Exception Dates (`EXDATE`):**
   There is no mechanism to cancel or reschedule a single occurrence of a recurring schedule (e.g., skip Christmas Day). Marking `CollectionSchedule.status = 'CANCELLED'` cancels the entire template across all past and future dates.

### 6.2 Completed Collection Semantics
- A recurring `CollectionSchedule` maintains `status = 'PENDING'` indefinitely. Marking it `COMPLETED` terminates future occurrences.
- Actual completion evidence is recorded on each date through two downstream entities:
  - [`driver.PickupStatus`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/driver/models.py#L177): driver-side stop progress (`EN_ROUTE`, `ARRIVED`, `COMPLETED`, `DRIVER_MISSED`).
  - [`watcher.StopValidation`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/watcher/models.py#L383): independent watcher verification (`VERIFIED_COLLECTED`, `COLLECTION_REPORTED`, `COLLECTION_DISPUTED`).
- Therefore, calendar completion status must be dynamically evaluated per occurrence date by cross-referencing `StopValidation` records for that specific date.

---

## Section 7 — Frontend Reuse Assessment

1. **[`OfflineEventCalendar.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/components/OfflineEventCalendar.jsx):**
   - **Status:** **Cannot be reused without major refactoring.**
   - **Reason:** Built against mock schema (`name`, `surge`, `action`, `wasteImpact`) and hits `/api/public/events/` (404). Permanently renders hardcoded local mock data.
   - **Recommendation:** Implement a clean, modern `PublicEventCalendar` component or adapt the view to consume the standardized `/api/calendar/` response.
2. **[`AdminEventManagement.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/admin/events/AdminEventManagement.jsx):**
   - **Status:** **Fully reusable and highly mature.**
   - **Reason:** Integrates cleanly with `/api/events/`, handles full lifecycle mutations atomically, zero emojis, clean design. Retain as authoritative admin workspace.
3. **[`CollectionSchedule.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/CollectionSchedule.jsx):**
   - **Status:** **Reusable for route and map visualization.**
   - **Reason:** Parses `days` strings into weekday grids and links to Leaflet polygons. Can be augmented with calendar integration.
4. **[`CommunitySidebar.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/community/components/CommunitySidebar.jsx) & [`NewsPage.jsx`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/news/NewsPage.jsx):**
   - **Status:** **Reusable.**
   - **Reason:** Use mature hooks ([`useNewsItems`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/pages/news/hooks/useNewsItems.js), [`useEmergencyAlerts`](file:///d:/Coding/Waste%20Watch/wastewatch/frontend/src/hooks/useEmergencyAlerts.js)) that enforce scope isolation cleanly.

---

## Section 8 — Proposed Calendar Service Architecture

### 8.1 Django App Structure (`calendar_service/`)
The dedicated application [`calendar_service`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/calendar_service) will contain:
- `apps.py`: AppConfig with **zero persistent database models**.
- `exceptions.py`: Custom typed errors (`CalendarDateRangeError`, `CalendarCapacityError`).
- `selectors.py`: Read-only, bounded database query functions.
- `normalizers.py`: Pure mapping functions translating source models to standardized calendar dictionaries.
- `views.py`: `CalendarView` (APIView) implementing `GET /api/calendar/`.
- `urls.py`: URL wiring for `/api/calendar/`.

### 8.2 Proposed Endpoint Contract
- **Endpoint:** `GET /api/calendar/`
- **Query Parameters:**
  - `start_date` (ISO date `YYYY-MM-DD`, required): Start of query window.
  - `end_date` (ISO date `YYYY-MM-DD`, required): End of query window (window $\le 93$ calendar days).
  - `barangay_id` (int | `'citywide'`, optional): Target scope.
  - `sources` (comma-separated string, optional): e.g. `'events,schedules,announcements,alerts'`. Default: `'events,schedules'`.
  - `category` (string, optional): Filter by category.
  - `page` (int, default: 1) and `page_size` (int, default: 20, max: 100).
- **Ordering:** Deterministic multi-tier sort:
  $$\text{start\_datetime ASC} \rightarrow \text{source ASC} \rightarrow \text{source\_id ASC}$$
- **Global Pagination Strategy:** Because events originate across four heterogeneous database tables, source-specific SQL `LIMIT/OFFSET` cannot produce global chronological pagination. The service will fetch bounded candidate records within the $[start\_date, end\_date]$ window, normalize and sort in memory, and apply global slicing for pagination.

### 8.3 Normalized Response Schema
```json
{
  "id": "event_14",
  "source": "event",
  "source_id": 14,
  "title": "Lucena Coastal Clean-up Drive",
  "description": "Citywide cleanup drive along Tayabas Bay shoreline.",
  "start_datetime": "2026-11-15T08:00:00+08:00",
  "end_datetime": "2026-11-15T12:00:00+08:00",
  "location": "Dalahican Fish Port, Lucena City",
  "barangays": [{"id": 3, "name": "Dalahican"}],
  "category": "cleanup",
  "status": "published",
  "is_all_day": false,
  "detail_url": "/events/14",
  "metadata": {
    "organizer": "Lucena City CENRO",
    "is_citywide": false
  }
}
```

---

## Section 9 — Performance and Security Risks

1. **N+1 Query Hazards:**
   - `MunicipalEvent`: Must prefetch `barangays`.
   - `CollectionSchedule`: Must prefetch `barangays` and execute single grouped batch lookup for `StopValidation` records across the date window.
   - `NewsItem`: Must select `barangay` and `author`.
2. **Operational Data Leakage:**
   - Raw `CollectionSchedule` contains internal IDs and GPS coordinates. `normalizers.py` must explicitly whitelist output fields, stripping `truck`, `driver`, `dumpsite`, and `waypoints`.
3. **Cross-Barangay Leakage:**
   - Queries by Barangay Officials must strictly enforce `Q(barangays__isnull=True) | Q(barangays__id=user.barangay_id)`.
4. **Capacity Limits:**
   - Enforce hard limit of 93 days per request. Enforce cap of 100 active recurring templates to protect against unbounded expansion.

---

## Section 10 — Testing Strategy for Stage 1

1. **Anonymous Public Access:** Assert drafts and archived items are completely omitted.
2. **Barangay Isolation:** Assert Barangay Official for Barangay A cannot view private notices of Barangay B.
3. **Administrator Access:** Assert admins can view drafts and archived items when requested.
4. **CollectionSchedule Sanitization:** Explicitly assert `'driver'`, `'truck'`, and `'waypoints'` keys are absent from JSON output.
5. **Internal Calendar Exclusion:** Assert `driver.CalendarEvent` is never emitted.
6. **Date Range Validation:** Assert requests >93 days or inverted ranges return HTTP 400.
7. **Deterministic Ordering:** Assert exact tie-breaking on identical timestamps.
8. **Timezone Correctness:** Assert all timestamps strictly output `+08:00` offset.
9. **Query Count Assertions:** Assert total query count remains $\le 6$ regardless of result count.

---

## Section 11 — Contract v0.1 Discrepancies

1. **EmergencyAlert Scope Discrepancy:**
   - *Contract v0.1 Assumption:* Emergency alerts can be filtered by `barangay_id`.
   - *Actual Repository:* `EmergencyAlert` model has **no** `barangay` foreign key; it is strictly citywide.
2. **MunicipalEvent Category Discrepancy:**
   - *Contract v0.1 / Mockup Assumption:* Event categories include `fiesta`, `market`, `holiday`.
   - *Actual Repository:* `EventCategory` choices are `cleanup`, `community_meeting`, `hazardous_waste`, `tree_planting`, `workshop`, `general`.
3. **Non-Existent Public Events Route:**
   - *Frontend Assumption:* `OfflineEventCalendar.jsx` queries `/api/public/events/`.
   - *Actual Repository:* The route does not exist. The real endpoint is `/api/events/`.
4. **NewsItem All-Day Datetime Discrepancy:**
   - *Contract v0.1 Assumption:* News items possess start/end timestamps.
   - *Actual Repository:* `NewsItem` has only a single `date = models.DateField(auto_now_add=True)`. Normalization must synthesize start (00:00:00) and end (23:59:59) datetimes.

---

## Section 12 — Final Recommendation

### 12.1 Verified Capabilities
- All 5 authoritative models exist and function cleanly.
- Strict state machines and atomic notification workflows exist in `events`.
- Timezone is uniformly configured to `'Asia/Manila'`.
- Prototype selectors and normalizers in `calendar_service/` prove that read-only aggregation with zero models is feasible.

### 12.2 Unverified Assumptions Corrected
- `EmergencyAlert` is verified as citywide-only (no barangay scoping).
- `CollectionSchedule` is verified as recurring rules + one-time dates, with completion externalized in `StopValidation`.

### 12.3 Outstanding Blockers
- None on the backend.
- Frontend `OfflineEventCalendar.jsx` will require replacement or significant adapter refactoring during subsequent stages.

### 12.4 Stage 1 Readiness Verdict
**STAGE 0 COMPLETE — ARCHITECTURALLY VERIFIED.**  
The repository is fully inspected and ready for Stage 1 implementation pending architectural approval from ChatGPT and review by Claude. **No Stage 1 code has been implemented.**

