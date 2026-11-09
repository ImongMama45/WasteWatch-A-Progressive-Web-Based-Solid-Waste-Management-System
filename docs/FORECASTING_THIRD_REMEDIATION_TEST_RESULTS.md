# WasteWatch Forecasting Engine — Third Remediation Test Results
## Deterministic Test Execution and Regression Verification

**Project:** WasteWatch — CENRO Lucena City  
**Date:** 2026-11-03  
**Environment:** Python 3.13.0, Django 5.1.2, SQLite (In-Memory for test isolation), Windows 10  
**Test Suite:** `analytics.tests.test_forecasting.WasteForecastingComprehensiveTests`  
**Total Tests:** 40  
**Result:** 40 PASSED, 0 FAILED, 0 ERRORS  

---

## 1. Raw Test Execution Output

```text
(venv) D:\Coding\Waste Watch\wastewatch\backend>python manage.py test analytics.tests.test_forecasting -v 2
Creating test database for alias 'default' ('file:memorydb_default?mode=memory&cache=shared')...
Operations to perform:
  Synchronize unmigrated apps: messages, staticfiles
  Apply all migrations: accounts, admin, analytics, auth, authtoken, contenttypes, driver, dumpsite, notifications, sessions, watcher
Synchronizing apps without migrations:
  Creating tables...
    Running deferred SQL...
Running migrations:
  Applying contenttypes.0001_initial... OK
  Applying auth.0001_initial... OK
  Applying accounts.0001_initial... OK
  Applying admin.0001_initial... OK
  Applying admin.0002_logentry_remove_auto_add... OK
  Applying admin.0003_logentry_add_action_flag_choices... OK
  Applying analytics.0001_initial... OK
  Applying analytics.0002_wastereporthotspot_and_more... OK
  Applying analytics.0003_routeoptimizationmetrics... OK
  Applying analytics.0004_shadowforecastprediction_and_more... OK
  Applying analytics.0005_remove_shadowforecastprediction_unique_shadow_forecast_prediction_and_more... OK
  Applying contenttypes.0002_remove_content_type_name... OK
  Applying auth.0002_alter_permission_name_max_length... OK
  Applying auth.0003_alter_user_email_max_length... OK
  Applying auth.0004_alter_user_username_opts... OK
  Applying auth.0005_alter_user_last_login_null... OK
  Applying auth.0006_require_contenttypes_0002... OK
  Applying auth.0007_alter_validators_add_error_messages... OK
  Applying auth.0008_alter_user_username_max_length... OK
  Applying auth.0009_alter_user_last_name_max_length... OK
  Applying auth.0010_alter_group_name_max_length... OK
  Applying auth.0011_update_proxy_permissions... OK
  Applying auth.0012_alter_user_first_name_max_length... OK
  Applying authtoken.0001_initial... OK
  Applying authtoken.0002_auto_20160226_1747... OK
  Applying authtoken.0003_extend_digest_prefix... OK
  Applying authtoken.0004_alter_tokenproxy_options... OK
  Applying driver.0001_initial... OK
  Applying dumpsite.0001_initial... OK
  Applying dumpsite.0002_alter_wastedelivery_options_and_more... OK
  Applying dumpsite.0003_dumpsitelog_route_alter_wastedelivery_driver_and_more... OK
  Applying dumpsite.0004_add_truck_type_to_wastedelivery... OK
  Applying dumpsite.0005_wastedelivery_is_synthetic... OK
  Applying notifications.0001_initial... OK
  Applying sessions.0001_initial... OK
  Applying watcher.0001_initial... OK
  Applying watcher.0002_garbagereport_is_cluster_parent_and_more... OK
  Applying watcher.0003_garbagereport_is_hazardous_garbagereport_volume_kg_and_more... OK
  Applying watcher.0004_garbagehotspot_cleanupintervention... OK
  Applying watcher.0005_alter_cleanupintervention_options_and_more... OK
  Applying watcher.0006_garbagereport_address_text... OK
  Applying watcher.0007_cleanupintervention_route_plan... OK
  Applying watcher.0008_garbagereport_is_priority_flagged_and_more... OK
  Applying watcher.0009_alter_garbagereport_assigned_crew... OK
  Applying watcher.0010_garbagereport_resolved_by_role... OK
  Applying watcher.0011_add_collection_confirmation... OK
  Applying watcher.0012_alter_collectionconfirmation_options_and_more... OK
  Applying watcher.0013_alter_collectionconfirmation_rating... OK
  Applying watcher.0014_garbagereport_source... OK
  Applying watcher.0015_add_offline_report_hash... OK
  Applying watcher.0016_add_resolution_proof... OK
  Applying watcher.0017_merge_0015_0016... OK
  Applying watcher.0018_garbagereport_notes... OK
  Applying watcher.0019_collectionschedule... OK
  Applying watcher.0020_alter_collectionschedule_start_time... OK
  Applying watcher.0021_alter_garbagereport_options_and_more... OK
  Applying watcher.0022_alter_collectionschedule_driver... OK
  Applying watcher.0023_alter_collectionschedule_barangays... OK
  Applying watcher.0024_garbagereport_report_type... OK
  Applying watcher.0025_reportvote_reportvote_unique_report_vote_per_user_and_more... OK
  Applying watcher.0026_garbagehotspot_is_active_garbagereport_resolved_at_and_more... OK
  Applying watcher.0027_reconcile_inactive_hotspots_and_interventions... OK
  Applying watcher.0028_cleanup_inactive_hotspot_dispatch_state... OK
  Applying watcher.0029_alter_collectionconfirmation_confirmed_by... OK

test_01_feature_engineering_no_future_leakage (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_01_feature_engineering_no_future_leakage) ... ok
test_02_purged_kfold_split_integrity (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_02_purged_kfold_split_integrity) ... ok
test_03_ridge_multi_horizon_training_and_calibration (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_03_ridge_multi_horizon_training_and_calibration) ... ok
test_04_prediction_intervals_valid_bounds (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_04_prediction_intervals_valid_bounds) ... ok
test_05_conformal_interval_monotonicity (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_05_conformal_interval_monotonicity) ... ok
test_06_heuristic_fallback_when_disabled (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_06_heuristic_fallback_when_disabled) ... ok
test_07_insufficient_data_heuristic_fallback (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_07_insufficient_data_heuristic_fallback) ... ok
test_08_corrupted_model_artifact_graceful_fallback (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_08_corrupted_model_artifact_graceful_fallback) ... ok
test_09_model_cache_invalidation_on_new_artifact (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_09_model_cache_invalidation_on_new_artifact) ... ok
test_10_missing_history_gap_filling (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_10_missing_history_gap_filling) ... ok
test_11_sunday_schedule_heuristic_adjustment (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_11_sunday_schedule_heuristic_adjustment) ... ok
test_12_non_negative_predictions_enforced (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_12_non_negative_predictions_enforced) ... ok
test_13_multi_horizon_feature_variation (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_13_multi_horizon_feature_variation) ... ok
test_14_live_analytics_api_contract (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_14_live_analytics_api_contract) ... ok
test_15_live_analytics_response_time_under_100ms (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_15_live_analytics_response_time_under_100ms) ... ok
test_16_per_barangay_forecast_breakdown (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_16_per_barangay_forecast_breakdown) ... ok
test_17_conformal_prediction_coverage_rate (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_17_conformal_prediction_coverage_rate) ... ok
test_18_data_leakage_in_daily_aggregation (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_18_data_leakage_in_daily_aggregation) ... ok
test_19_empty_database_heuristic_safety (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_19_empty_database_heuristic_safety) ... ok
test_20_all_zero_history_safety (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_20_all_zero_history_safety) ... ok
test_21_synthetic_flag_filtration_in_training (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_21_synthetic_flag_filtration_in_training) ... ok
test_22_artifact_metadata_synthetic_record_count (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_22_artifact_metadata_synthetic_record_count) ... ok
test_23_production_serving_synthetic_exclusion (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_23_production_serving_synthetic_exclusion) ... ok
test_24_force_promote_blocked_with_synthetic (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_24_force_promote_blocked_with_synthetic) ... ok
test_25_pipeline_metrics_calculation_genuine_only (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_25_pipeline_metrics_calculation_genuine_only) ... ok
test_26_backfill_skips_within_grace_period (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_26_backfill_skips_within_grace_period) ... ok
test_27_backfill_updates_past_grace_period (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_27_backfill_updates_past_grace_period) ... ok
test_28_shadow_record_idempotent_and_immutable (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_28_shadow_record_idempotent_and_immutable) ... ok
test_29_forecast_weight_heuristic_uses_genuine_only (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_29_forecast_weight_heuristic_uses_genuine_only) ... ok
test_30_shadow_forecast_prediction_schema_and_types (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_30_shadow_forecast_prediction_schema_and_types) ... ok
test_31_unmeasured_test_coverage_null (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_31_unmeasured_test_coverage_null) ... ok
test_32_sunday_scheduled_collection_behavior (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_32_sunday_scheduled_collection_behavior) ... ok
test_33_atomic_manifest_rollback (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_33_atomic_manifest_rollback) ... ok
test_34_distinct_genuine_days_eligibility (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_34_distinct_genuine_days_eligibility) ... ok
test_35_sparse_barangay_heuristic_fallback (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_35_sparse_barangay_heuristic_fallback) ... ok
test_36_multi_delivery_same_date_aggregation (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_36_multi_delivery_same_date_aggregation)
MANDATORY T-01 REGRESSION TEST: ... ok
test_37_shared_route_proportional_allocation (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_37_shared_route_proportional_allocation) ... ok
test_38_city_population_train_serve_alignment (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_38_city_population_train_serve_alignment) ... ok
test_39_shadow_candidate_registration (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_39_shadow_candidate_registration) ... ok
test_40_shadow_grace_period_and_actuals (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_40_shadow_grace_period_and_actuals) ... ok

----------------------------------------------------------------------
Ran 40 tests in 40.702s

OK
Destroying test database for alias 'default' ('file:memorydb_default?mode=memory&cache=shared')...
```

---

## 2. In-Depth Regression Verification for Mandatory Defects

### Test 36: T-01 Daily Aggregation Verification
- **Scenario:** 3 deliveries on the same date (`2026-10-15`):
  - Delivery A: 4,000 kg
  - Delivery B: 6,000 kg
  - Delivery C: 5,000 kg
- **Verification Assertions:**
  1. `build_daily_aggregation` daily total for `2026-10-15` equals exactly `15,000.0 kg` (proves all rows summed, not overwritten).
  2. `forecast_weight_heuristic` history series for `2026-10-15` equals `15,000.0 kg`.
  3. `client.get('/api/analytics/live/')` returns 200 OK and historical series reflects the full 15,000.0 kg daily collection.
- **Result:** PASSED.

### Test 37: Shared-Route Proportional Allocation
- **Scenario:** Single delivery of 12,000 kg on shared route visiting 3 barangays (`Barangay 1`, `Barangay 2`, `Barangay 3`).
- **Verification Assertions:**
  1. City-wide aggregation equals `12,000.0 kg` without duplication.
  2. Each barangay's attributed allocation equals exactly `4,000.0 kg` ($12,000 / 3$).
  3. Sum of all barangay allocations ($\sum 4,000 = 12,000$) matches total city-wide weight.
- **Result:** PASSED.

### Test 38: T-02 City Population Train/Serve Alignment
- **Scenario:** Inspect feature matrix generated during model training vs feature vector built during live inference for city series.
- **Verification Assertions:**
  1. `train_pop_feature == serve_pop_feature`.
  2. `serve_pop_feature == get_canonical_city_population()`.
  3. `serve_pop_feature != 0.0` (eliminates previous zero fallback defect).
- **Result:** PASSED.

### Test 39: Shadow Candidate Registration Without Circular Gating
- **Scenario:** Run `train_waste_forecast` pipeline on genuine dataset without promotion flag.
- **Verification Assertions:**
  1. Candidate manifest `candidate_manifest.json` is created and registered with SHA-256 and model version.
  2. `active_manifest.json` is NOT created or modified (production serving untouched).
  3. Candidate model can be loaded by `load_candidate_forecaster()` for shadow evaluation.
- **Result:** PASSED.

### Test 40: Shadow Grace Period & Missing Data Handling
- **Scenario:** Record shadow prediction on date $T$. Run evaluation on date $T+1$ (within 2-day grace period) vs $T+3$ (past grace period) with unrecorded dumpsite actuals.
- **Verification Assertions:**
  1. Within grace period ($T+1$), status is marked `in_grace_period` and `actual_kg` remains `None`.
  2. Past grace period ($T+3$), status transitions to `missing_unrecorded` and `actual_kg` is recorded as `0.0`.
- **Result:** PASSED.

---

## 3. Rewritten Test Integrity Proofs

The following tests, previously flagged as false-positive or non-exercising, were completely rewritten:
- `test_13`: Recomputed feature matrices across horizons $h=1$ and $h=7$ and asserted non-identity of lag feature columns ($X_{h=1} \neq X_{h=7}$).
- `test_17`: Generated 100 genuine synthetic calibration and test residuals and verified empirical non-parametric coverage bounds.
- `test_21`: Seeded database with mixed genuine and synthetic records; executed training pipeline; asserted `genuine_records == count(genuine)` and `synthetic_records == 0`.
- `test_23`: Mocked ML forecaster to return distinct identifiable weight; called `get_waste_forecast` with `FORECAST_ML_ENABLED = False`; verified returned values match `forecast_weight_heuristic` and not ML output.
- `test_26` & `test_27`: Directly exercised `record_shadow_forecast` management command with mock dates to verify grace period skipping and resolution.
- `test_28`: Attempted to mutate an existing `ShadowForecastPrediction` instance and asserted `IntegrityError` is raised.
- `test_29`: Inserted synthetic delivery on origin date; called `forecast_weight_heuristic`; asserted synthetic delivery weight is completely ignored in baseline historical aggregation.
- `test_32`: Created Sunday schedule with active truck; called `get_waste_forecast`; verified Sunday prediction remains non-zero.
- `test_34`: Evaluated dataset with 47 distinct delivery dates; verified training pipeline validates against distinct active collection days.
- `test_35`: Tested sparse barangay (< 14 distinct days); asserted system falls back to city-wide per-capita scaled heuristic.

---

## 4. Frontend Build Validation

```text
C:\Program Files\nodejs\node.exe
> wastewatch-frontend@0.1.0 build
> vite build

vite v5.4.21 building for production...
transforming...
✓ 1989 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     1.45 kB │ gzip:   0.73 kB
dist/assets/index-DYHxGeNM.css    112.10 kB │ gzip:  20.49 kB
dist/assets/index-CHIeO0AJ.js   2,504.68 kB │ gzip: 624.81 kB
✓ built in 39.04s
```
**Status:** 0 compilation errors, 0 lint warnings.
