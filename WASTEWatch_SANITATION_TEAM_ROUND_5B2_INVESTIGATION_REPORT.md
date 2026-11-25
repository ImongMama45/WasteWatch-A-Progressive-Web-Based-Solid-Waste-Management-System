# WasteWatch Sanitation Team — Round 5B.2 Investigation Report

**Project:** WasteWatch: A Progressive Web-Based Solid Waste Management System with Hotspot Mapping, Truck Tracking, and Route Optimization for Lucena City  
**Workspace:** `D:\Coding\Waste Watch`  
**Coordinator:** Phase A Agent E (Integration and Evidence Coordinator)  
**Reconciled Specialists:** Phase A Agents A (Worker & Membership), B (Allocation & Dumpsite/Fleet), C (Shift Lifecycle & Concurrency), D (Frontend Allocation-Aware Workflow)  
**Date (UTC):** 2026-11-18  
**Authorization Mode:** Strictly Read-Only on codebase, tests, migrations, config, database, and Git state  

---

## 1. Executive Summary & Accepted vs. Unresolved Baseline

Round 5B.1.2 established a clean core baseline—specifically removing `designated_leader` and `leader_override` via forward migration `0049_decouple_crewshift_and_attendance`, fixing `DriverShiftViewSet.my_team_roster` schedule scoping and authorization (`test_14`/`test_15`), adding `of=('self',)` to `DriverShiftViewSet` nullable `select_for_update` queries, removing `Dumpsite.objects.first()` from runtime paths, and ordering `TruckService.replace_truck_assignment` locks with `allocation_already_used` enforcement.

Independent verification and cross-agent reconciliation of Agents A–D against the current codebase confirms that **32 deduplicated defects** remain across four areas:
- **B1 — Worker & Membership Integrity (10 defects, `B1-01`..`B1-10`)**: Missing `linked_user.is_active` and `worker.is_active` checks in `TeamService`; `WorkerService.merge_workers` missing locks, active-shift guards, user-conflict handling, eligibility validation, history preservation, and `ActivityLog` audit; `WorkerViewSet`/`SanitationTeamViewSet` exposing unguarded `ModelViewSet` `PATCH`/`PUT`/`DELETE` bypasses; `SanitationTeamMembership.created_by` `None` `IntegrityError`; `UserViewSet` active-shift/delete gaps; `is_worker_on_active_shift` / `get_preallocated_truck_for_driver` edge-query gaps; and `TeamManagement.jsx` Transfer Modal serializer/UI mismatch.
- **B2 — Allocation, Fleet & Dumpsite Integrity (9 defects, `B2-01`..`B2-09`)**: `CrewShift.allocation` (`on_delete=PROTECT`) unchecked in all allocation/replacement mutations; `delete_truck_allocation` / `delete_schedule_override` missing post-lock `schedule_id` revalidation and bounded retry; `CollectionScheduleViewSet.destroy` bypassing shift/allocation/request guards; `ScheduleTeamOverride` `create`/`update` missing past-date, target-date, `CrewShift`, and `ScheduleTruckAllocation` guards plus `resolve_team` queryset bypass; multi-allocation/explicit-`team_id` stale-allocation traps; `TruckReplacementRequestViewSet.approve`/`.reject` AB-BA deadlock, missing `of=('self',)`, and wildcard `schedule__isnull=True` auto-approval; `TruckService.replace_truck_assignment` missing `old_truck` ownership/active-shift/facility-isolation and driver-capacity guards; `request_truck_replacement` input/authz/visibility defects; missing facility isolation on allocation endpoints + stale `truck.op_status`; `CollectionSchedule.save()` lock-held `sync_pickup_statuses()` crash on `driver=None` + transaction-aborting `try/except`; and residual `waypoints[0]` / `schedule.driver` base/dumpsite fallbacks.
- **B3 — Shift Lifecycle, Concurrency & PostgreSQL Safety (7 defects, `B3-01`..`B3-07`)**: Unclosed orphaned prior-date pre-departure `CrewShift(driver_shift=None, is_active=True)` permanently locking Watchers and crew; `WatcherShiftViewSet.start_shift` pre-lock leadership resolution, missing `Worker`/`Membership` locks, cleanup inside atomic block, and `WatcherShift -> CrewShift` lock inversion; `ShiftService.record_deployment_attendance` inconsistent `DriverShift <-> Allocation` lock order, missing team/worker/membership locks, missing `worker.is_active`/`user.is_active`/`is_worker_on_active_shift`/`shift.schedule_id` checks; `DriverShiftViewSet.pre_start_shift`/`start_shift` split transactions, `DriverShift -> CollectionSchedule` AB-BA deadlock, skipped `allocation_id` / truck dispatchability / resolved-team / schedule-status revalidation on existing staged shifts, and `started_at`/`op_status` clobber; `ShiftService.correct_attendance` missing `of=('self',)` on nullable `crew_shift`; `stage_and_start_shift` missing crew `worker.is_active`/`user.is_active` and `existing_crew_shift` team/leader validation; and `WorkerViewSet.get_serializer_context` missing `snapshot__crew_shift__is_active=True` + `dev_reset` `CASCADE` vs PG trigger hazard.
- **B4 — Frontend Allocation-Aware Workflow (6 defects, `B4-01`..`B4-06`)**: `AssignmentModule.jsx` omitting `preallocated-truck`, `allocation_id`, and `ww_shift_updated`; `CheckInModule.jsx` posting bare `start/` twice without `schedule_id`/`allocation_id`; `resolveDriverSchedule()` (`driverSchedule.js`) and `RouteOverview.jsx` discarding team/override/allocation schedules where `s.driver !== userId` (paired with `_resolve_driver_today_schedule`/`current` and `CollectionScheduleViewSet` missing `role_in_team='leader'`); `DriverDashboard.jsx` swallowing `preallocated-truck` errors, omitting in-flight CTA lock and `activeScheduleId` dep; `useShiftTimer.js` omitting `allocationId` tracking/JSDoc; all callers dropping DRF field-keyed validation errors; and `NavigateToBaseModule.jsx` / `EndShiftModule.jsx` reading `waypoints[0]` instead of `dumpsite_detail`.

### Accepted Round 5B.1.2 Baseline (Verified Intact — Preserve)
1. **Single-tier team leadership & `0049` cleanup:** `designated_leader` and `leader_override` removed from models, services, serializers, views, frontend (`0` occurrences), and tests; `0047` and `0048` preserved intact; `0049` (`RemoveField`) depends on `0048`; `resolve_deployment_team_leader` resolves effective-team `SanitationTeamMembership(role_in_team='leader', is_active=True)` only (`driver/team_service.py:24-133`, `driver/migrations/0049_decouple_crewshift_and_attendance.py`).
2. **`DriverShiftViewSet.my_team_roster` authorization & scoping:** Strict `schedule_id` parsing (`400` on invalid/non-positive), schedule-scoped team resolution, authorization check (`is_team_member or is_resolved_leader or is_admin_user`), and unscoped personal-membership fallback restricted to omitted `schedule_id` (`driver/views.py:2625-2907`, `test_critical_invariants.py:865-1105` `test_14`/`test_15`).
3. **`DriverShiftViewSet` PostgreSQL `of=('self',)` locking:** Verified on `dev_reset`, `extended_mode`, `start_shift`, and `end_shift` (`driver/views.py:2127, 2138, 2468, 3329, 3466`).
4. **`TruckService.replace_truck_assignment` lock order & used-allocation protection:** Verified `CollectionSchedule -> SanitationTeam -> ScheduleTruckAllocation -> Truck` order and `allocation_already_used` 409 check (`driver/truck_service.py:1451-1583`, `test_critical_invariants.py` `test_14`).
5. **`Dumpsite.objects.first()` removal & admin role checks:** Zero runtime `Dumpsite.objects.first()` calls (`notify_truck_near` and `resolve_eligible_collection_stops` fail closed); `IsAppAdmin` uses `is_admin_user` (`role='admin' OR is_staff=True`) with zero DRF `IsAdminUser` usage.
6. **Coordinated shift closure & D-12 stop preservation:** `ShiftService.conclude_shift_atomic` closes `DriverShift`, linked `CrewShift`, and schedule-matching `WatcherShift` atomically/idempotently without automatic stop status mutation or driver penalties (`driver/shift_service.py:850-978`).

---

## 2. Initial Git Baseline (`git status --short`)

Captured verbatim at the start of Phase A (`2026-11-18T10:47:50Z`) prior to any Round 5B.2 work (191 lines total; staged migrations `0036`–`0050`, Round 5B.1.2 edits, and unrelated `dumpsite/` / `.unlighthouse/` entries preserved untouched):

```text
A  WASTEWatch_SANITATION_TEAM_CORRECTION_AND_EVIDENCE_REPORT.md
A  WASTEWatch_SANITATION_TEAM_FINAL_ARCHITECTURE_BLUEPRINT.md
A  WASTEWatch_SANITATION_TEAM_PHASE_1_EVIDENCE_REPORT.md
A  WASTEWatch_SANITATION_TEAM_PHASE_1_IMPLEMENTATION_READINESS.md
A  WASTEWatch_SANITATION_TEAM_ROUND_5A_EVIDENCE_MATRIX.md
A  WASTEWatch_SANITATION_TEAM_ROUND_5A_INVESTIGATION_REPORT.md
M  WasteWatch_Milestone_0B_Architecture_and_API_Contract_Specification.md
A  docs/FORECASTING_ARTIFACT_GOVERNANCE_REMEDIATION_REPORT.md
M  docs/FORECASTING_CALENDAR_FEATURE_VERIFICATION.md
A  docs/FORECASTING_STAGE_2_2_FORENSIC_PROVENANCE_REPORT.md
A  docs/FORECASTING_STAGE_2_3_GOVERNANCE_REMEDIATION_REPORT.md
M  milestone_0b_claude_final_findings_correction_report.md
M  tests/truck-stage2a/test-stage3-1.mjs
MM wastewatch/backend/accounts/api_views.py
MM wastewatch/backend/accounts/serializers.py
M  wastewatch/backend/analytics/tests/test_forecasting.py
MM wastewatch/backend/analytics/views.py
M  wastewatch/backend/calendar_service/aggregator.py
M  wastewatch/backend/calendar_service/selectors.py
M  wastewatch/backend/calendar_service/tests/test_collection_schedule.py
M  wastewatch/backend/community/tests.py
M  wastewatch/backend/community/views.py
M  wastewatch/backend/driver/admin.py
A  wastewatch/backend/driver/allocation_service.py
M  wastewatch/backend/driver/management/commands/sweep_stale_shifts.py
A  wastewatch/backend/driver/migrations/0036_worker_legacycrewreconciliationaudit.py
A  wastewatch/backend/driver/migrations/0037_backfill_workers_and_legacy_crew.py
A  wastewatch/backend/driver/migrations/0038_sanitationteam_sanitationteammembership_and_more.py
A  wastewatch/backend/driver/migrations/0039_seed_baseline_sanitation_teams.py
A  wastewatch/backend/driver/migrations/0040_collectionschedule_default_team_and_more.py
A  wastewatch/backend/driver/migrations/0041_drivershift_allocation_watchershift_and_more.py
A  wastewatch/backend/driver/migrations/0042_alter_crewattendancecorrection_options_and_more.py
A  wastewatch/backend/driver/migrations/0043_truck_lifecycle_and_deletion_boundary.py
A  wastewatch/backend/driver/migrations/0044_drivershift_end_reason_notes_and_more.py
A  wastewatch/backend/driver/migrations/0045_crewshift_attendance_submitted_by_and_more.py
A  wastewatch/backend/driver/migrations/0046_watchershift_end_reason.py
A  wastewatch/backend/driver/migrations/0047_collectionschedule_designated_leader_and_more.py
A  wastewatch/backend/driver/migrations/0048_collectionschedule_is_available.py
A  wastewatch/backend/driver/migrations/0049_decouple_crewshift_and_attendance.py
A  wastewatch/backend/driver/migrations/0050_truck_records_and_fuel.py
M  wastewatch/backend/driver/models.py
A  wastewatch/backend/driver/pagination.py
M  wastewatch/backend/driver/serializers.py
A  wastewatch/backend/driver/shift_service.py
M  wastewatch/backend/driver/signals.py
A  wastewatch/backend/driver/team_service.py
A  wastewatch/backend/driver/tests/test_allocation_service.py
AM wastewatch/backend/driver/tests/test_critical_invariants.py
A  wastewatch/backend/driver/tests/test_operational_security.py
A  wastewatch/backend/driver/tests/test_shift_attendance_workflow.py
A  wastewatch/backend/driver/tests/test_shift_lifecycle.py
M  wastewatch/backend/driver/tests/test_shift_schedule_guards.py
M  wastewatch/backend/driver/tests/test_shift_schedule_resolution.py
A  wastewatch/backend/driver/tests/test_team_fleet_operational_closure.py
A  wastewatch/backend/driver/tests/test_team_leader_attendance.py
A  wastewatch/backend/driver/tests/test_team_management.py
A  wastewatch/backend/driver/tests/test_truck_lifecycle_stage1.py
A  wastewatch/backend/driver/tests/test_truck_retirement_closure_and_authz.py
A  wastewatch/backend/driver/tests/test_worker_foundation.py
A  wastewatch/backend/driver/truck_service.py
M  wastewatch/backend/driver/urls.py
MM wastewatch/backend/driver/views.py
A  wastewatch/backend/driver/worker_service.py
A  wastewatch/backend/dumpsite/inspection_serializers.py
A  wastewatch/backend/dumpsite/inspection_views.py
A  wastewatch/backend/dumpsite/migrations/0006_dumpsite_truck_inspection.py
M  wastewatch/backend/dumpsite/models.py
 M wastewatch/backend/dumpsite/serializers.py
M  wastewatch/backend/dumpsite/urls.py
 M wastewatch/backend/dumpsite/views.py
M  wastewatch/backend/forecasting/management/commands/rollback_forecast_model.py
M  wastewatch/backend/forecasting/service.py
M  wastewatch/backend/news/admin.py
M  wastewatch/backend/news/tests.py
M  wastewatch/backend/news/views.py
A  wastewatch/backend/notifications/management/__init__.py
A  wastewatch/backend/notifications/management/commands/__init__.py
A  wastewatch/backend/notifications/management/commands/backfill_notification_receipts.py
A  wastewatch/backend/notifications/management/commands/set_notification_cutover.py
A  wastewatch/backend/notifications/migrations/0007_notificationreadreceipt_and_more.py
A  wastewatch/backend/notifications/migrations/0008_emergencyactivationevent.py
M  wastewatch/backend/notifications/models.py
A  wastewatch/backend/notifications/receipts.py
M  wastewatch/backend/notifications/serializers.py
M  wastewatch/backend/notifications/services.py
M  wastewatch/backend/notifications/tests.py
A  wastewatch/backend/notifications/tests_phase1_receipts.py
A  wastewatch/backend/notifications/tests_phase2_emergency.py
A  wastewatch/backend/notifications/tests_phase2_postgres_concurrency.py
A  wastewatch/backend/notifications/tests_phase3_schedule.py
M  wastewatch/backend/notifications/tests_truck_near.py
M  wastewatch/backend/notifications/urls.py
M  wastewatch/backend/notifications/views.py
M  wastewatch/backend/wastewatch/api_urls.py
M  wastewatch/backend/wastewatch/public_api.py
M  wastewatch/backend/wastewatch/settings.py
A  wastewatch/backend/wastewatch/tests/__init__.py
A  wastewatch/backend/wastewatch/tests/test_public_map_api.py
A  wastewatch/backend/wastewatch/tests/test_public_stop_statuses.py
M  wastewatch/backend/watcher/signals.py
M  wastewatch/backend/watcher/urls.py
M  wastewatch/backend/watcher/views.py
M  wastewatch/frontend/src/App.jsx
A  wastewatch/frontend/src/api/driverWorkflowApi.js
A  wastewatch/frontend/src/api/dumpsiteApi.js
M  wastewatch/frontend/src/api/navConfig.jsx
A  wastewatch/frontend/src/api/watcherAttendanceApi.js
A  wastewatch/frontend/src/components/CrewAttendanceBoard.jsx
A  wastewatch/frontend/src/components/MapSpotlightMask.jsx
M  wastewatch/frontend/src/components/MiniMap.jsx
M  wastewatch/frontend/src/components/ZonePanel.jsx
M  wastewatch/frontend/src/components/community/ReportVoting.jsx
M  wastewatch/frontend/src/hooks/useCommunityPosts.js
M  wastewatch/frontend/src/hooks/useShiftTimer.js
M  wastewatch/frontend/src/index.css
M  wastewatch/frontend/src/pages/MapView.jsx
M  wastewatch/frontend/src/pages/PublicMap.jsx
A  wastewatch/frontend/src/pages/__tests__/BrgyDashboardCalendarIntegration.test.js
A  wastewatch/frontend/src/pages/__tests__/CitizenDashboardNextPickupIntegration.test.js
A  wastewatch/frontend/src/pages/__tests__/PublicMapMigrationIntegration.test.js
A  wastewatch/frontend/src/pages/__tests__/WatcherDashboardScheduleIntegration.test.js
M  wastewatch/frontend/src/pages/admin/AdminContentManagement.jsx
M  wastewatch/frontend/src/pages/admin/DumpsiteManagement.jsx
M  wastewatch/frontend/src/pages/admin/RouteBuilder.jsx
A  wastewatch/frontend/src/pages/admin/TeamManagement.css
A  wastewatch/frontend/src/pages/admin/TeamManagement.jsx
M  wastewatch/frontend/src/pages/admin/TruckManagement.jsx
M  wastewatch/frontend/src/pages/admin/UserManagement.jsx
A  wastewatch/frontend/src/pages/admin/WorkerManagement.jsx
A  wastewatch/frontend/src/pages/admin/__tests__/teamManagementChallenge.test.js
M  wastewatch/frontend/src/pages/brgy_official/BrgyDashboard.jsx
M  wastewatch/frontend/src/pages/community/CommunityPage.jsx
M  wastewatch/frontend/src/pages/community/components/CivicDiscussionCard.jsx
M  wastewatch/frontend/src/pages/community/components/CommunityFeed.jsx
M  wastewatch/frontend/src/pages/community/components/CommunitySidebar.jsx
M  wastewatch/frontend/src/pages/community/components/CreatePostBox.jsx
M  wastewatch/frontend/src/pages/community/components/OfficialReportCard.jsx
M  wastewatch/frontend/src/pages/dashboard/CitizenDashboard.jsx
M  wastewatch/frontend/src/pages/dashboard/DriverDashboard.jsx
M  wastewatch/frontend/src/pages/dashboard/DumpsiteDashboard.jsx
M  wastewatch/frontend/src/pages/dashboard/WatcherDashboard.jsx
M  wastewatch/frontend/src/pages/driver/DriverRouteFlow.jsx
M  wastewatch/frontend/src/pages/driver/DriverStatusPanel.jsx
M  wastewatch/frontend/src/pages/driver/components/AssignmentModule.jsx
A  wastewatch/frontend/src/pages/driver/components/CrewAttendanceModal.jsx
M  wastewatch/frontend/src/pages/driver/components/routeRequestManager.js
M  wastewatch/frontend/src/pages/dumpsite/ArrivalLogger.jsx
M  wastewatch/frontend/src/pages/dumpsite/BarangayBreakdown.jsx
M  wastewatch/frontend/src/pages/dumpsite/CollectionLogs.jsx
A  wastewatch/frontend/src/pages/dumpsite/FacilityActivity.jsx
A  wastewatch/frontend/src/pages/dumpsite/FacilityMaintenance.jsx
AM wastewatch/frontend/src/pages/dumpsite/FuelManagement.jsx
A  wastewatch/frontend/src/pages/dumpsite/OperationalHolds.jsx
A  wastewatch/frontend/src/pages/dumpsite/ShiftMonitoring.jsx
AM wastewatch/frontend/src/pages/dumpsite/TruckAllocations.jsx
A  wastewatch/frontend/src/pages/dumpsite/TruckInspections.jsx
M  wastewatch/frontend/src/pages/dumpsite/TruckQueue.jsx
A  wastewatch/frontend/src/pages/dumpsite/components/ConfirmActionDialog.jsx
M  wastewatch/frontend/src/pages/dumpsite/components/DumpsiteArrivalAlert.jsx
A  wastewatch/frontend/src/pages/dumpsite/components/FacilityWorkspaceHeader.jsx
AM wastewatch/frontend/src/pages/dumpsite/components/TruckStatusPills.jsx
M  wastewatch/frontend/src/pages/dumpsite/components/TrucksOverlay.jsx
A  wastewatch/frontend/src/pages/dumpsite/components/useFacilityScope.js
M  wastewatch/frontend/src/pages/news/NewsPage.jsx
M  wastewatch/frontend/src/pages/news/components/ActiveAdvisoriesSection.css
M  wastewatch/frontend/src/pages/news/components/ActiveAdvisoriesSection.jsx
M  wastewatch/frontend/src/pages/news/components/BarangayScopeSelector.jsx
M  wastewatch/frontend/src/pages/news/components/CategoryTabs.jsx
M  wastewatch/frontend/src/pages/news/components/CommunityPreviewSection.jsx
M  wastewatch/frontend/src/pages/news/components/FeaturedHeroCard.jsx
M  wastewatch/frontend/src/pages/news/components/NewsCard.css
M  wastewatch/frontend/src/pages/news/components/NewsFeed.jsx
M  wastewatch/frontend/src/pages/news/components/NewsHeader.jsx
M  wastewatch/frontend/src/pages/news/components/NewsSearchBar.jsx
M  wastewatch/frontend/src/pages/news/hooks/useNewsItems.js
M  wastewatch/frontend/src/pages/news/utils/newsUtils.js
A  wastewatch/frontend/src/pages/watcher/WatcherAttendance.jsx
M  wastewatch/frontend/src/pages/watcher/WatcherTasksHub.jsx
M  wastewatch/frontend/src/pages/watcher/components/StopCompletedOverlay.jsx
M  wastewatch/frontend/src/styles/pages/AnalyticsCenter.css
M  wastewatch/frontend/src/utils/__tests__/reportVoting.test.js
A  wastewatch/frontend/src/utils/crewAttendanceHelpers.js
M  wastewatch/frontend/src/utils/driverFlowGuard.js
M  wastewatch/frontend/src/utils/pickupStatusSync.js
A  wastewatch/frontend/src/utils/routeBaseHelpers.js
?? wastewatch/.unlighthouse/
?? wastewatch/backend/driver/tests/test_m4_truck_records_and_fuel.py
?? wastewatch/backend/dumpsite/permissions.py
?? wastewatch/backend/dumpsite/tests_facility_operations.py
?? wastewatch/backend/notifications/tests_phase4_integration.py
?? wastewatch/unlighthouse.config.ts
```

---

## 3. Deduplicated Confirmed Defects (Verified in Current Source)

### B1 — Worker & Membership Integrity

| ID | Agent Refs | Exact Location & Symbol | Verified Failure Mechanism |
|---|---|---|---|
| **B1-01** | `CD-A1` | `driver/team_service.py:220-252` (`TeamService._validate_worker_role_eligibility`) | Checks `linked_user.role` and `linked_user.employee_type`, never checking `linked_user.is_active`. Allows assigning/transferring a Worker linked to a deactivated `User`, which then fails at `resolve_deployment_team_leader` (`:107-110`). |
| **B1-02** | `CD-A2` | `driver/team_service.py:351-355` (`TeamService.transfer_member`) | Locks `worker` at `:351` and skips `if not worker.is_active:` (unlike `assign_member` at `:272-273`), allowing transfer of an inactive `Worker`. |
| **B1-03** | `CD-A3`, `C-3`, `C-6` | `driver/shift_service.py:177-215, 258-289` (`stage_and_start_shift`), `:503-524, 638-650` (`record_deployment_attendance`); `driver/views.py:2757-2761, 2849-2860` (`my_team_roster`); `watcher/views.py:2706-2723` | `stage_and_start_shift` reads `driver_worker_id` with `is_active=True` *before* locking `Worker` (`:178 -> :189`) without rechecking `driver_worker.is_active` / `driver_user.is_active` / `role == 'driver'` (when `role_in_team == 'driver'`), and never checks `worker.is_active` or `linked_user.is_active` for manifested/team crew (`:258-267`). `record_deployment_attendance` manifests inactive `Worker`/`User` from `SanitationTeamMembership` (`:504-524, 644-650`). Roster endpoints render inactive crew workers. |
| **B1-04** | `CD-A4` | `driver/worker_service.py:37-107` (`WorkerService.merge_workers`, `update_employee_id`); `driver/views.py:4311-4329` (`WorkerViewSet.merge`) | `merge_workers` (1) omits `source_worker.is_active` check (`:70-77`); (2) omits `TeamService.is_worker_on_active_shift` for source & target; (3) locks only `Worker` (`:64`) without `SanitationTeam -> Worker -> SanitationTeamMembership`; (4) leaves `source_worker.user` stranded and moves source membership onto `target_worker`'s distinct `User` when both have distinct users (`:80-84`); (5) skips `_validate_worker_role_eligibility` & `target_worker.user.is_active`; (6) mutates `membership.worker` in place (`:96-97`) instead of deactivating source membership (`left_at=now`) + creating target membership; (7) ignores `resolved_by`/`notes` (and `update_employee_id` drops `authorized_by`). `WorkerViewSet.merge` (`views.py:4325`) returns HTTP 400 instead of 409 on `ActiveShiftConflictError`. |
| **B1-05** | `CD-A5` | `driver/views.py:4144-4349` (`WorkerViewSet`), `:4394-4530` (`SanitationTeamViewSet`), `:4484-4502` (`assign_member`), `:4333-4348` (`update_employee_id`) | Inherit `ModelViewSet` `update`/`partial_update`/`destroy` without service guards: `PATCH /api/driver/workers/{id}/` can set `is_active=False`, swap `user`, or mutate `employee_id` while on active shift or in active membership; `PATCH /api/driver/teams/{id}/` can set `is_active=False` while active shifts/memberships/schedules exist (trapping members as `is_available=True` in `WorkerViewSet`/`WorkerSerializer` while `unique_active_worker_team_membership` blocks reassignment); `DELETE` raises unhandled `ProtectedError` (500); `assign_member` (`:4498`) omits `ActiveShiftConflictError` -> 409; `update_employee_id` (`:4344`) omits `ValueError`. |
| **B1-06** | `CD-A6` | `driver/models.py:738-767, 786-823`; `driver/team_service.py:255, 310, 314, 402, 413-455` | `SanitationTeamMembership` (and `Worker`) lacks `clean()` validation; `created_by` (`models.py:799`) is non-nullable yet `assign_member`/`transfer_member` default `created_by`/`authorized_by` to `None` (raising `IntegrityError` instead of `ValidationError`); `assign_member`, `transfer_member`, `deactivate_member` emit no `analytics.ActivityLog` audit records (`deactivate_member` ignores `authorized_by`). |
| **B1-07** | `CD-A7`, `D-F7` | `driver/serializers.py:784-800, 820-832`; `frontend/src/pages/admin/TeamManagement.jsx:717-724, 1898, 2360-2370` | `_serialize_member` (`:828`) emits `'system_role': 'crew_member'` for `user=None`, breaking `TeamManagement.jsx:722` (`!sysRole \|\| ...`) and hiding `'crew'` in Tab 1 Transfer Modal; `SanitationTeamMembershipSerializer` omits `system_role`/`employee_type`, hiding `'leader'`/`'driver'` in Tab 2 Transfer Modal (`TeamManagement.jsx:1898`). |
| **B1-08** | `CD-A9` | `accounts/serializers.py:212-235` (`AdminUserSerializer.update`); `accounts/api_views.py:110-156` (`UserViewSet`) | Updating a `User` (`is_active=False`, `role`, `employee_type`) never checks `is_worker_on_active_shift` and leaves incompatible active `SanitationTeamMembership` rows intact; deleting a `User` linked to a `Worker` (`on_delete=PROTECT` at `driver/models.py:752`) raises unhandled `ProtectedError` (HTTP 500). *(Note: non-active-shift policy between reject vs auto-deactivate is triaged as `OD-1`.)* |
| **B1-09** | `CD-A10` | `driver/team_service.py:206-214` (`is_worker_on_active_shift`); `driver/allocation_service.py:491-494` (`get_preallocated_truck_for_driver`) | `is_worker_on_active_shift` omits `Q(snapshot__crew_shift__driver_shift__is_active=True)` (contrast `:195`); `get_preallocated_truck_for_driver` filters `SanitationTeamMembership(worker=worker, is_active=True)` without `team__is_active=True`. |
| **B1-10** | `C-7` | `driver/views.py:4281-4285` (`WorkerViewSet.get_serializer_context`) | Queries `ShiftCrewRosterItem.objects.filter(snapshot__driver_shift__is_active=True)` without `Q(snapshot__crew_shift__is_active=True)`, reporting `on_active_shift=False` for crew on pre-departure `CrewShift` rosters. |

### B2 — Allocation, Fleet & Dumpsite Integrity

| ID | Agent Refs | Exact Location & Symbol | Verified Failure Mechanism |
|---|---|---|---|
| **B2-01** | `CD-1`, `C-6` | `driver/models.py:985-991`; `driver/allocation_service.py:283-289, 316-320, 430-433, 476-480`; `driver/truck_service.py:1473-1477, 1540-1548` | `CrewShift.allocation` (`on_delete=PROTECT` from `0049`) is unchecked in `allocate_truck_for_schedule`, `update_truck_allocation`, `delete_truck_allocation`, and `TruckService.replace_truck_assignment` (which only check `DriverShift(allocation=...)`). Causes unhandled 500 `ProtectedError` on delete and silent team/truck/schedule corruption under active pre-departure `CrewShift`s. |
| **B2-02** | `CD-2`, `C-8` | `driver/allocation_service.py:219-241` (`delete_schedule_override`), `:468-480` (`delete_truck_allocation`) | Read `observed['schedule_id']` unlocked and lock `CollectionSchedule` -> target row without post-lock `schedule_id == observed['schedule_id']` revalidation or 3-attempt `_Concurrent*Move` retry. |
| **B2-03** | `CD-3`, `C-8` | `driver/views.py:917-934` (`CollectionScheduleViewSet.destroy`); `driver/models.py:553-571, 870-874, 985-998, 1382-1388` | Deletes schedule unconditionally (`super().destroy()`), cascading `ScheduleTruckAllocation` -> `SET_NULL` on `DriverShift.allocation`/`schedule` (erasing shift lineage) or raising unhandled 500 `ProtectedError` on `CrewShift`/`TruckReplacementRequest`. |
| **B2-04** | `CD-5` | `driver/allocation_service.py:83-108` (`create_schedule_override`), `:159-206` (`update_schedule_override`); `driver/views.py:936-946` (`resolve_team`) | `create_schedule_override` uses `update_or_create` without rejecting past `effective_date < today` or existing `DriverShift`/`CrewShift`/`ScheduleTruckAllocation`. `update_schedule_override` omits `target_date < today`, `ScheduleTruckAllocation`, `CrewShift`, and target `(schedule, target_date)` conflict checks (and locks `ScheduleTeamOverride` before `SanitationTeam`). `resolve_team` bypasses `self.get_queryset()` scoping (`int(pk)` instead of `self.get_object()`). |
| **B2-05** | `CD-6` | `driver/allocation_service.py:244-328` (`allocate_truck_for_schedule`), `:380-450` (`update_truck_allocation`) | Passing explicit `team_id != resolve_schedule_team(...)` or `allocation_date < today` or inactive/cancelled schedule succeeds at allocation time, creating permanently un-dispatchable allocations (`stage_and_start_shift:147`). *(Multi-allocation per `(schedule, date)` DB uniqueness vs explicit `allocation_id` is triaged in Section 5.)* |
| **B2-06** | `CD-7`, `C-5`, `PG-1`, `PG-2` | `driver/views.py:5100-5235` (`TruckReplacementRequestViewSet.approve`, `.reject`); `driver/truck_service.py:1451-1583` (`replace_truck_assignment`) | (1) `approve` and `reject` combine `select_for_update()` without `of=('self',)` with nullable `select_related('schedule', 'driver_shift')`, causing PostgreSQL `NotSupportedError`; (2) `approve` locks `TruckReplacementRequest` before `replace_truck_assignment` (`CollectionSchedule -> ... -> Truck -> TruckReplacementRequest` UPDATE), causing AB-BA deadlock with `TruckViewSet.replace_truck`; (3) `replace_truck_assignment:1573-1583` runs wildcard bulk approval across `Q(schedule=schedule) \| Q(schedule__isnull=True)` requests. *(Mid-shift approval of `req.driver_shift.allocation` colliding with `test_14` `allocation_already_used` is `OD-2`.)* |
| **B2-07** | `CD-8`, `CD-9`, `CD-10`, `PG-5` | `driver/truck_service.py:1453-1655`; `driver/views.py:997, 3035-3075, 4740, 4782, 5060-5065`; `driver/allocation_service.py:331-333, 452-454, 480` | `replace_truck_assignment`: (1) never verifies `old_truck` is assigned to `schedule` or checks active `DriverShift(truck=old_truck)`; (2) checks only `hold_dumpsite_id` on `old_truck` instead of `_current_other_facility_q`; (3) removes drivers from `old_truck` even when `new_truck.drivers.count() >= 2`; (4) locks `CollectionSchedule` before `require_admin_or_facility_operator`. `allocate_truck` & `ScheduleTruckAllocationViewSet.{create, update}` omit `truck=` in `require_admin_or_facility_operator` (cross-facility truck hijack); `delete_truck_allocation` / truck-swap never revert `op_status` to `'AVAILABLE'` when idle. `request_truck_replacement` accepts ended `driver_shift_id`, passes unvalidated IDs (500), lacks driver role/schedule cross-check, accepts retired/uncommissioned trucks, and `TruckReplacementRequestViewSet.get_queryset` hides `schedule=None` operator-truck requests. |
| **B2-08** | `CD-11`, `PG-3` | `driver/models.py:369-418, 434` (`CollectionSchedule.save`, `sync_pickup_statuses`, `PickupStatus.driver`) | `CollectionSchedule.save()` invokes `sync_pickup_statuses()` unconditionally even on `update_fields=['default_team']`/`['truck']` under held locks; crashes with `IntegrityError` on team-only schedules (`driver=None`, `len(waypoints) > 1`); and `except Exception: pass` without savepoint aborts PG transactions. *(Resolved with zero migrations per Section 5.)* |
| **B2-09** | `CD-12` | `driver/views.py:3308-3325, 3752-3762, 4127-4135`; `NavigateToBaseModule.jsx:157-160`; `EndShiftModule.jsx:372-375` | `shift_status` (`heading_to_dumpsite`) queries `CollectionSchedule(driver=request.user)` ignoring `shift.effective_dumpsite`; `_check_home_base_proximity` reads `waypoints[0]` instead of `schedule.dumpsite`; `HomeBaseView.put(apply_to_existing=True)` overwrites `waypoints[0]` on dumpsite-anchored schedules via `bulk_update`; frontend `NavigateToBaseModule`/`EndShiftModule` read `waypoints[0]` before `dumpsite_detail`. *(Making `CollectionSchedule.dumpsite` globally mandatory vs legacy test fixtures is `OD-3`.)* |

### B3 — Shift Lifecycle, Concurrency & PostgreSQL Safety

| ID | Agent Refs | Exact Location & Symbol | Verified Failure Mechanism |
|---|---|---|---|
| **B3-01** | `C-1` | `driver/shift_service.py:592-604, 981-1026`; `sweep_stale_shifts.py:17-52`; `driver/views.py:4924-4932, 4979-4993` | Pre-departure `CrewShift(driver_shift=None, is_active=True)` is skipped by `cleanup_stale_unlinked_watcher_shifts` (`if CrewShift.objects.filter(watcher_shift=ws).exists(): continue`) and `sweep_stale_shifts` (`DriverShift` only), while `WatcherShiftViewSet.end_shift` blocks ending with 409. Permanently locks out Watcher (`start_shift` 409) and crew (`is_worker_on_active_shift == True`) across subsequent days. *(Prior-date sweeper is policy-free; same-day manual cancel is `OD-4`.)* |
| **B3-02** | `C-2`, `CD-A8` | `driver/views.py:4875-4969` (`WatcherShiftViewSet.start_shift`) | Runs `cleanup_stale_unlinked_watcher_shifts` inside outer `transaction.atomic()` (`:4900`), fails to parse `schedule_id` (`ValueError` 500), resolves `resolve_deployment_team_leader` (`:4908`) before locking `SanitationTeam` (`:4917`), never locks `Worker` or `SanitationTeamMembership` or revalidates under lock, and locks `WatcherShift` (`:4924`) before `CrewShift` (`:4940, 4963`). |
| **B3-03** | `C-3`, `CD-A8` | `driver/shift_service.py:393-527, 644-650` (`ShiftService.record_deployment_attendance`) | Locks `DriverShift -> Allocation` when `driver_shift_id` is passed vs `Allocation -> DriverShift` when `None`; omits `SanitationTeam`, `Worker`, and `SanitationTeamMembership` locks around `resolve_deployment_team_leader` (`:404`) and roster fetch (`:504`); omits `is_worker_on_active_shift` check; omits `shift.schedule_id == schedule.id` check when `driver_shift_id` is passed. |
| **B3-04** | `C-4`, `CD-4`, `D-F6` | `driver/views.py:3091-3238` (`pre_start_shift`), `:3284-3456` (`start_shift`); `driver/shift_service.py:87-162` | (1) `pre_start_shift` holds `DriverShift` lock (`:3114`) while calling `record_initial_attendance` -> `record_deployment_attendance` (`CollectionSchedule` lock at `shift_service.py:394`) — AB-BA deadlock; (2) both views close `transaction.atomic()` (`:3137`, `:3357`) before unlocked resolution + second `atomic()` in `stage_and_start_shift` (concurrent double-click 400 race); (3) active-shift short-circuit skips `allocation_id != shift.allocation_id`, `shift.schedule_id is None`, `is_truck_dispatchable(shift.effective_truck)`, `resolve_schedule_team`, and `schedule.status`/`is_available`; (4) initial paths skip `schedule.status` (`CANCELLED`/`COMPLETED`) and `schedule.is_available`; (5) `start_shift` (`:3348-3356`) clobbers `started_at` and resets `op_status='on_duty'` if already `shiftroute`. |
| **B3-05** | `C-5` | `driver/shift_service.py:736-742` (`ShiftService.correct_attendance`) | `CrewAttendanceRecord.objects.select_related('crew_shift')...select_for_update()` omits `of=('self',)` on nullable `crew_shift` (`models.py:1158-1161`), raising PostgreSQL `NotSupportedError`. |
| **B3-06** | `C-6` | `driver/shift_service.py:309-325` (`stage_and_start_shift`) | Links `existing_crew_shift` to `DriverShift` without verifying `existing_crew_shift.team_id == effective_team.id` and `existing_crew_shift.team_leader_id == team_leader_user.id`. |
| **B3-07** | `C-8` | `driver/views.py:2204-2210` (`DriverShiftViewSet.dev_reset`) | Calls `DriverShift.objects.filter(...).delete()`, cascading into `shift_crew_roster_snapshot` / `crew_attendance_record` and hitting PostgreSQL `0042`/`0044` `BEFORE DELETE` triggers. |

### B4 — Frontend Allocation-Aware Workflow & Backend Driver Resolution Boundary

| ID | Agent Refs | Exact Location & Symbol | Verified Failure Mechanism |
|---|---|---|---|
| **B4-01** | `D-F1`, `P-F3` | `frontend/src/pages/driver/components/AssignmentModule.jsx:44-116, 618-650` | Never calls `/api/driver/shift/preallocated-truck/`, omits `allocation_id` on `POST /api/driver/shift/pre_start/`, displays legacy `/profile/` truck/route, drops DRF field-keyed validation errors (`{ allocation_id, team, truck }`), and never dispatches `ww_shift_updated` for sibling `useShiftTimer` consumers. |
| **B4-02** | `D-F2` | `frontend/src/pages/driver/components/CheckInModule.jsx:262-290, 552-565` | Posts directly to `/api/driver/shift/start/` omitting `schedule_id` and `allocation_id`, relies on dead `ww_shift_start_*` `localStorage`, fires a duplicate unawaited bare `startShift()` call (`:271, 279, 557`) with `schedule_id: null`, and drops DRF field errors (`:282`). |
| **B4-03** | `D-F3`, `D-F6` | `frontend/src/utils/driverSchedule.js:121-133`; `RouteOverview.jsx:459`; `driver/views.py:261-327, 848-850, 2248-2297` | `resolveDriverSchedule()` and `RouteOverview.jsx` filter `String(s.driver) === String(userId)`, discarding team/override/allocation schedules when `s.driver` is null/different; backend `CollectionScheduleViewSet:849` omits `role_in_team='leader'` for Driver-Team Leaders; `DriverShiftViewSet.current` (`_resolve_driver_today_schedule`) relies solely on `TruckCrewAssignment` and `CollectionSchedule.driver`, blocking `/driver/flow` with `no_schedule_today` for team/allocation-only drivers. |
| **B4-04** | `D-F4` | `frontend/src/pages/dashboard/DriverDashboard.jsx:210-330, 389-419, 442-482, 1076-1078` | Swallows `preallocated-truck` HTTP 400 (`>1` allocations) into `allocation = null` without gating or surfacing error; drops DRF field-keyed errors and leaves stale `allocation` on start failure; `handleShiftToggle` / `#driver-main-cta` lack in-flight `starting` lock (unlike `handleCarouselStartRoute`); mount `useEffect` omits `activeScheduleId`. |
| **B4-05** | `D-F5` | `frontend/src/hooks/useShiftTimer.js:42-49, 65-78, 131-153` | Omits `allocationId` from state (`EMPTY_STATE`/`applyShiftPayload`) and JSDoc (`:132`), and silently omits `allocation_id` when null rather than exposing allocation readiness cleanly. |
| **B4-06** | *(Overlap note)* | `NavigateToBaseModule.jsx:157-160`; `EndShiftModule.jsx:372-375`; `TeamManagement.jsx:1898, 2360-2370` | Covered under `B2-09` (dumpsite base resolution) and `B1-07` (TeamManagement Transfer Modal). |

---

## 4. Potential Defects Requiring Reproduction & Test Gaps

1. **`DriverShiftViewSet.pre_start_shift` / `start_shift` concurrent double-click race (Agent C):** Two simultaneous `POST` calls can both exit the first `transaction.atomic()` and race into `stage_and_start_shift`, failing the second call with `400` instead of `200` idempotently. Resolved by unifying into a single `transaction.atomic()` in `B3-04`.
2. **`WatcherShiftViewSet.start_shift` vs `conclude_shift_atomic` deadlock (Agent C):** `WatcherShift -> CrewShift` vs `CrewShift -> WatcherShift` inversion under concurrent start + end on PostgreSQL. Resolved by fixing lock order to `CrewShift -> WatcherShift` in `B3-02`.
3. **Concurrent `allocate_truck_for_schedule` across schedules `(S1, T1)` vs `(S2, T1)` (`IntegrityError` conversion) (Agent B):** Verify under test whether `unique_truck_allocation_per_date` can raise raw `IntegrityError` if invoked concurrently, and ensure `IntegrityError` maps cleanly or serializes under `Truck` lock.
4. **Pre-commit `CollectionSchedule` lifecycle notifications (Agent B):** `CollectionScheduleViewSet.{create, update, destroy}` writes DB `Notification` rows inside `@transaction.atomic` (`views.py:884, 909, 928`), which roll back cleanly on DB failure today, but would leak if external push hooks are later added without `transaction.on_commit`.
5. **Concluding shift `Truck.op_status` reset when future allocations exist (Agent B):** Check whether `conclude_shift_atomic` sets `truck.op_status = 'AVAILABLE'` when future-date `ScheduleTruckAllocation` rows exist (`op_status = 'ASSIGNED'`).
6. **`my_team_roster` snapshot vs live membership rendering & `test_13` docstring mismatch (Agent A):** `my_team_roster` and `_build_watcher_deployment_detail` still query live `SanitationTeamMembership` instead of `ShiftCrewRosterSnapshot` once staged, and `test_critical_invariants.py:815` (`test_13`) still carries a stale `my_team_roster` docstring claim without calling it.
7. **`DriverDashboard.jsx` direct `startShift()` vs `AssignmentModule` Driver-led attendance roll-call (Agent D):** `DriverDashboard` calls `POST /api/driver/shift/start/` directly without forcing `pre_start` roll-call; kept as informational/policy observation (no unauthorized workflow change).

---

## 5. Owner Decision Triage (Round 5B.2 Phase B Gate)

Per `ORIGINAL_REQUEST.md` R1 & R3, every candidate Owner Decision raised by Agents A–D was evaluated to separate **policy-free, fail-closed, zero-migration technical resolutions** from **genuine business-policy questions requiring Owner approval before Phase B mutation**:

### A. Resolved Technically Without New Business Policy (Proceed in Phase B)

| Candidate Item | Triage Verdict & Rationale |
|---|---|
| **`ActivityLog` vs new columns on `SanitationTeamMembership`** (`team_service.py:413`, `worker_service.py:56`) | **No Owner Decision needed.** `analytics.ActivityLog` is already the codebase's established audit trail (`truck_service.py:33-36`, `views.py:750`), and R3 mandates avoiding unnecessary model/migration changes. Log `assign`, `transfer`, `deactivate`, `merge`, and `update_employee_id` via `analytics.ActivityLog` with **zero migrations**. |
| **`PickupStatus.driver` when `CollectionSchedule.driver` is `None`** (`driver/models.py:369-418, 434`) | **No Owner Decision needed & zero migrations.** `PickupStatus` is the legacy per-driver stop table (`StopValidation` is the authoritative per-service-date model). In `CollectionSchedule.save()`, skip `sync_pickup_statuses()` when `update_fields` is passed and excludes `{'waypoints', 'driver', 'days', 'date', 'status'}`. In `sync_pickup_statuses()`, wrap `ensure_stop_validations_for_schedule` in a savepoint (`with transaction.atomic():`) and skip legacy `PickupStatus` row creation/update when `self.driver_id is None`. |
| **Multi-allocation per `(schedule, allocation_date)` vs unique constraint** (`driver/models.py:898-907`) | **No Owner Decision needed & zero migrations.** Existing DB constraints intentionally allow multi-truck allocations per `(schedule, date)` and `AllocationService`/`ShiftService` already fail closed (`"Multiple truck allocations exist... Explicit allocation_id is required."`). Do **not** add a new unique constraint; instead fix `allocate_truck_for_schedule` / `update_truck_allocation` to validate `team_id == resolve_schedule_team(...)`, reject past dates / cancelled schedules, and surface the backend's 400 error clearly in the frontend. |
| **Prior-date orphaned pre-departure `CrewShift` sweeper** (`shift_service.py:592-604, 981-1026`, `sweep_stale_shifts.py`) | **No Owner Decision needed.** Extending `cleanup_stale_unlinked_watcher_shifts` / `sweep_stale_shifts` to close prior-date (`service_date < today`) `CrewShift(driver_shift__isnull=True, is_active=True)` and their linked prior-date `WatcherShift` (`end_reason='stale_unlinked_cleanup'`) while preserving immutable `CrewAttendanceRecord`/`ShiftCrewRosterSnapshot` rows directly applies the existing prior-date cleanup invariant without inventing a new policy. |

### B. Genuine Owner Decisions Required (STOP / Defer Policy Branches in Phase B)

| ID | Candidate Item | Why Owner Approval Is Required & Safe Phase B Boundary |
|---|---|---|
| **OD-1** | **`UserViewSet` (`accounts/serializers.py:212-235`, `accounts/api_views.py:110-156`) when modifying `is_active`/`role`/`employee_type` of a `User` with an active `SanitationTeamMembership` outside an active shift** | **Phase B Safe Action:** Unconditionally block `is_active=False`, incompatible `role`/`employee_type` changes, and `DELETE` whenever `is_worker_on_active_shift(worker.id)` is `True` (`409 Conflict`), and catch `ProtectedError` on `DELETE` (`409`, never 500). **Owner Decision Needed:** Outside an active shift, should `UserViewSet` **(a)** reject deactivation/incompatible role changes (`409`) until Admin removes/transfers the Worker from their team (fail-closed default recommended), OR **(b)** auto-deactivate the incompatible `SanitationTeamMembership` (`is_active=False, left_at=now`)? *(Phase B will implement fail-closed rejection `409` or stop at active-shift guard pending confirmation; check if any existing `accounts/tests.py` tests deactivating a driver without team removal first.)* |
| **OD-2** | **`TruckReplacementRequestViewSet.approve` when `req.driver_shift.allocation` is already used (`test_14` immutability vs mid-shift replacement)** (`views.py:5150-5163`, `truck_service.py:1473-1477`) | **Genuine Business Policy Conflict:** Round 5B.1.2 (`test_14`) & R1 forbid modifying/reusing a `ScheduleTruckAllocation` once referenced by a `DriverShift`. Passing `req.driver_shift.allocation.allocation_date` to `replace_truck_assignment` therefore **always** returns `409 allocation_already_used`. **Owner Decision Needed:** Should mid-shift `approve()` **(a)** automatically conclude the active `DriverShift` (with e.g. `end_reason='truck_replaced'`) and create a *new* replacement `ScheduleTruckAllocation` (carrying over/re-staging `CrewShift`), OR **(b)** remain restricted to unused/pre-shift/next-date allocations and require ending the active shift explicitly first? **Phase B Action:** Fix the `of=('self',)` PG crash, AB-BA lock inversion, `old_truck` guards, and wildcard `schedule__isnull=True` auto-approval, while **leaving `allocation_already_used` fail-closed `409` intact** until Owner chooses (a) or (b). |
| **OD-3** | **Global mandatory `CollectionSchedule.dumpsite` on creation/allocation/dispatch vs legacy test compatibility** (`models.py:352`, `serializers.py:221-265`, `allocation_service.py`, `shift_service.py`) | **Genuine Scope/Compatibility Trade-off:** Existing baseline test suites (`test_schedule_api.py`, `test_shift_schedule_guards.py`, `test_critical_invariants.py`, `test_allocation_service.py`) create `CollectionSchedule` rows with `dumpsite=None`, and R1 forbids broad unrelated test-suite refactoring. **Owner Decision Needed:** Enforce mandatory `dumpsite` in `CollectionScheduleSerializer` / `AllocationService` / `ShiftService` now (updating legacy test fixtures), or enforce fail-closed only at dumpsite-requiring operations (`notify_dumpsite_inbound`, `notify_truck_near`, `resolve_eligible_collection_stops`)? **Phase B Action:** Fix `shift_status`, `_check_home_base_proximity`, `HomeBaseView.put`, and frontend `NavigateToBaseModule`/`EndShiftModule` to prefer `effective_dumpsite` / `schedule.dumpsite` and fail closed where a dumpsite is required, without breaking `dumpsite=None` legacy test fixtures. |
| **OD-4** | **Read (`GET`) permissions on `/api/driver/workers/`, `/api/driver/teams/`, `/api/driver/team-memberships/` (`views.py:4150, 4410, 4539`) & optional same-day pre-departure `CrewShift` manual cancel / `DriverDashboard` direct `start/`** | **Owner Decision Needed:** (1) Frontend inspection shows only Admin pages (`TeamManagement.jsx`, `WorkerManagement.jsx`) call `/workers/`, `/teams/`, `/team-memberships/`, yet `GET` currently permits `IsAuthenticated` (including `citizen`). Should `GET` be restricted to `IsAppAdmin` only, or operational roles (`admin`, `dumpsite`, `watcher`, `driver`)? (2) Does the Owner want a new same-day manual cancellation endpoint for pre-departure `CrewShift`s when a deployment is cancelled before `DriverShift` starts, or mandatory redirect from `DriverDashboard` to `/driver/flow` for Driver-led attendance? **Phase B Action:** Do NOT invent unapproved endpoints or break operational callers; tighten `GET` on `/workers/`, `/teams/`, `/team-memberships/` to operational roles (`admin`, `dumpsite`, `watcher`, `driver` — denying `citizen` & `brgy_official`) unless Owner specifies `IsAppAdmin`-only. |

---

## 6. PostgreSQL-Only Risks (Unverified on SQLite)

1. **Guaranteed PostgreSQL `NotSupportedError` (Fixed in Phase B3/B2):** `ShiftService.correct_attendance` (`shift_service.py:738-741`), `TruckReplacementRequestViewSet.approve` (`views.py:5123-5126`), and `TruckReplacementRequestViewSet.reject` (`views.py:5213-5216`) use `select_for_update()` without `of=('self',)` on nullable `select_related` joins.
2. **AB-BA Deadlocks Masked by SQLite:** SQLite ignores `select_for_update()` (`settings.py:133`). Real PostgreSQL `READ COMMITTED` lock blocking and deadlock freedom for `WatcherShiftViewSet.start_shift`, `record_deployment_attendance`, `pre_start_shift`, `TruckReplacementRequestViewSet.approve`, `WorkerService.merge_workers`, and `delete_truck_allocation`/`delete_schedule_override` cannot be verified on SQLite.
3. **Partial Unique Indexes Under Concurrent `READ COMMITTED`:** `unique_active_worker_team_membership`, `unique_active_leader_per_team`, `unique_active_driver_per_team` (`models.py:804-819`), and `unique_active_watcher_shift_per_date` (`:953-957`).
4. **PostgreSQL `0042`–`0044` `BEFORE UPDATE OR DELETE` / `BEFORE TRUNCATE` Triggers:** `dev_reset` `DriverShift.delete()` (`views.py:2204-2210`) and `TransactionTestCase._fixture_teardown` `TRUNCATE` fail on PostgreSQL even when SQLite passes.
5. **Swallowed Exception Transaction Poisoning (`PG-3`):** `CollectionSchedule.sync_pickup_statuses()` `try ... except Exception: pass` without a nested savepoint causes `InFailedSqlTransaction` on PostgreSQL.
6. **Zero Two-Connection PostgreSQL Concurrency Tests in `driver/tests/`:** Remains unverified until executed against a PostgreSQL 14+ instance.

---

## 7. Existing Test Inventory (Read-Only Scan)

### Backend (`wastewatch/backend`)
- **Primary Sanitation Team / Driver / Dumpsite / Accounts Suites (Target Phase C):**
  - `driver/tests/test_worker_foundation.py`
  - `driver/tests/test_team_management.py`
  - `driver/tests/test_team_leader_attendance.py`
  - `driver/tests/test_allocation_service.py`
  - `driver/tests/test_shift_lifecycle.py`
  - `driver/tests/test_shift_attendance_workflow.py`
  - `driver/tests/test_shift_schedule_guards.py`
  - `driver/tests/test_shift_schedule_resolution.py`
  - `driver/tests/test_critical_invariants.py` (includes `test_14` and `test_15`)
  - `driver/tests/test_team_fleet_operational_closure.py`
  - `driver/tests/test_truck_lifecycle_stage1.py`
  - `driver/tests/test_truck_retirement_closure_and_authz.py`
  - `driver/tests/test_operational_security.py`
  - `driver/tests/test_schedule_api.py`
  - `driver/tests/test_truck_api.py`
  - `driver/tests/test_crew_assignment_api.py`
  - `driver/tests/test_public_schedule_api.py`
  - `driver/tests/test_m4_truck_records_and_fuel.py`
  - `driver/tests/test_settings_debug.py`
  - `dumpsite/tests_facility_operations.py`, `dumpsite/tests.py`
  - `accounts/tests.py`, `accounts/test_auth_flow.py`
  - `watcher/tests.py`
- **Other Modules (Out of Sanitation Scope unless regression-checked):** `analytics/`, `calendar_service/`, `community/`, `events/`, `news/`, `notifications/`, `wastewatch/tests/`.

### Frontend (`wastewatch/frontend/src`)
- Uses `node --test` (`node:test` + `node:assert/strict`); **no** Vitest/Jest/RTL installed in `package.json`; `"lint"` is a no-op; `npm run build` (`vite build`) verifies bundling.
- **Relevant existing tests:**
  - `wastewatch/frontend/src/utils/__tests__/driverFlowGuard.test.js` (verified in Phase A: 12/12 passing)
  - `wastewatch/frontend/src/pages/admin/__tests__/teamManagementChallenge.test.js` (verified in Phase A: 29/29 passing)
  - Plus 16 other `*.test.js` files under `api/__tests__/`, `components/__tests__/`, `hooks/__tests__/`, `pages/__tests__/`, `pages/admin/__tests__/`, `pages/community/__tests__/`, `pages/news/utils/__tests__/`, and `utils/__tests__/`.
