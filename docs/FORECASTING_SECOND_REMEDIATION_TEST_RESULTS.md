# WasteWatch Forecasting Engine — Second Remediation Test Results

**Date of Execution:** 2026-11-02  
**Environment:** Windows (PowerShell) / Python 3.13 / Django 5.1 / SQLite  
**Test Module:** `analytics.tests.test_forecasting`  
**Total Tests:** 35  
**Result:** **35 PASSED, 0 FAILURES, 0 ERRORS**  

---

## 1. Test Execution Command

```powershell
d:\Coding\Waste Watch\wastewatch\backend> .\venv\Scripts\python.exe manage.py test analytics.tests.test_forecasting -v 2
```

---

## 2. Test Output Transcript

```text
Creating test database for alias 'default' ('file:memorydb_default?mode=memory&cache=shared')...
Operations to perform:
  Synchronize unmigrated apps: humanize, rest_framework, rest_framework_simplejwt
  Apply all migrations: accounts, admin, analytics, auth, cloudinary, community, contenttypes, driver, dumpsite, news, notifications, sessions, watcher
Synchronizing apps without migrations:
  Creating tables...
    Running deferred SQL...
Running migrations:
  Applying contenttypes.0001_initial... OK
  Applying contenttypes.0002_remove_content_type_name... OK
  Applying auth.0001_initial... OK
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
  Applying accounts.0001_initial... OK
  Applying accounts.0002_alter_barangay_options_alter_user_options_and_more... OK
  Applying accounts.0003_alter_user_barangay... OK
  Applying accounts.0004_user_is_official... OK
  Applying accounts.0005_barangay_geometry... OK
  Applying accounts.0006_barangay_color... OK
  Applying admin.0001_initial... OK
  Applying admin.0002_logentry_remove_auto_add... OK
  Applying admin.0003_logentry_add_action_flag_choices... OK
  Applying analytics.0001_initial... OK
  Applying analytics.0002_activitylog... OK
  Applying analytics.0003_remove_barangayperformance_barangay_and_more... OK
  Applying analytics.0004_shadowforecastprediction_and_more... OK
  Applying watcher.0022_garbagehotspot_dispatch_acknowledged_and_more... OK
  Applying watcher.0023_hotspotintervention_and_more... OK
  Applying watcher.0024_alter_garbagereport_image_and_more... OK
  Applying watcher.0025_reportvote_reportvote_unique_report_vote_per_user_and_more... OK
  Applying community.0001_initial... OK
  Applying community.0002_communitypost_category_communitypost_post_type_and_more... OK
  Applying driver.0034_systemsetting... OK
  Applying driver.0035_drivershift_end_reason... OK
  Applying dumpsite.0002_remove_wastedelivery_barangay_and_more... OK
  Applying dumpsite.0003_add_analytics_indexes_wastedelivery... OK
  Applying dumpsite.0004_remove_wastedelivery_wastedlvry_date_idx_and_more... OK
  Applying dumpsite.0005_wastedelivery_is_synthetic... OK
  Applying news.0001_initial... OK
  Applying news.0002_newsitem_barangay_fk... OK
  Applying news.0003_newsitem_barangay_fk... OK
  Applying news.0004_newsitem_image_and_categories... OK
  Applying news.0005_alter_newsitem_image... OK
  Applying notifications.0001_initial... OK
  Applying notifications.0002_alter_notification_type... OK
  Applying notifications.0003_alter_notification_type... OK
  Applying notifications.0004_alter_notification_type... OK
  Applying notifications.0005_notification_broadcast_id... OK
  Applying notifications.0006_notificationdeduplication_and_more... OK
  Applying sessions.0001_initial... OK
  Applying watcher.0026_garbagehotspot_is_active_garbagereport_resolved_at_and_more... OK
  Applying watcher.0027_reconcile_inactive_hotspots_and_interventions... OK
  Applying watcher.0028_cleanup_inactive_hotspot_dispatch_state... OK
  Applying watcher.0029_alter_collectionconfirmation_confirmed_by... OK
System check identified no issues (0 silenced).

test_01_daily_aggregation (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_01_daily_aggregation) ... ok
test_02_city_wide_reconciliation (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_02_city_wide_reconciliation) ... ok
test_03_missing_day_handling (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_03_missing_day_handling) ... ok
test_04_confirmed_zero_delivery_handling (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_04_confirmed_zero_delivery_handling) ... ok
test_05_lag_features (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_05_lag_features) ... ok
test_06_rolling_features (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_06_rolling_features) ... ok
test_07_forecast_horizon_construction (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_07_forecast_horizon_construction) ... ok
test_08_future_leakage_prevention (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_08_future_leakage_prevention) ... ok
test_09_ridge_training (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_09_ridge_training) ... ok
test_10_chronological_validation (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_10_chronological_validation) ... ok
test_11_prediction_interval_calculation (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_11_prediction_interval_calculation) ... ok
test_12_artifact_saving_and_loading (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_12_artifact_saving_and_loading) ... ok
test_13_model_fallback (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_13_model_fallback) ... ok
test_14_invalid_predictions (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_14_invalid_predictions) ... ok
test_15_new_barangay_handling (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_15_new_barangay_handling) ... ok
test_16_api_response_compatibility (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_16_api_response_compatibility) ... ok
test_17_api_latency_measurement (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_17_api_latency_measurement) ... ok
test_18_synthetic_data_exclusion (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_18_synthetic_data_exclusion) ... ok
test_19_sunday_forecast_zero (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_19_sunday_forecast_zero) ... ok
test_20_ratio_feature_stability (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_20_ratio_feature_stability) ... ok
test_21_chronological_partition_integrity (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_21_chronological_partition_integrity) ... ok
test_22_artifact_rollback_detection (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_22_artifact_rollback_detection) ... ok
test_23_baseline_triangle_bound (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_23_baseline_triangle_bound) ... ok
test_24_quarantine_synthetic_artifact (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_24_quarantine_synthetic_artifact) ... Artifact governance rejection: synthetic_records is not explicitly 0.
ok
test_25_horizon_specific_calendar_features (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_25_horizon_specific_calendar_features) ... ok
test_26_strict_seven_day_embargo_isolation (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_26_strict_seven_day_embargo_isolation) ... ok
test_27_fail_closed_artifact_governance (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_27_fail_closed_artifact_governance) ... Artifact governance rejection: missing or malformed SHA-256 digest.
Artifact integrity violation: SHA256 mismatch (0090b9dbf2962de82dfeed24ad3c4bb173439d4ff12aac4bf61b1547178a2cf5 != 0000000000000000000000000000000000000000000000000000000000000000). Failing closed.
Artifact governance rejection: unrecognized or incomplete feature schema.
ok
test_28_shadow_prediction_persistence_and_deduplication (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_28_shadow_prediction_persistence_and_deduplication) ... ok
test_29_heuristic_serving_and_baseline_consistency (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_29_heuristic_serving_and_baseline_consistency) ... ok
test_30_nested_alpha_selection_isolation (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_30_nested_alpha_selection_isolation) ... ok
test_31_unmeasured_test_coverage_null (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_31_unmeasured_test_coverage_null) ... ok
test_32_sunday_scheduled_collection_behavior (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_32_sunday_scheduled_collection_behavior) ... ok
test_33_atomic_manifest_rollback (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_33_atomic_manifest_rollback) ... Verifying integrity of rollback target (ridge_v1)...
Integrity verified (SHA-256: 0090b9dbf296...).
Rollback completed successfully. Manifest and latest files atomically updated to ridge_v1.
ok
test_34_distinct_genuine_days_eligibility (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_34_distinct_genuine_days_eligibility) ... ok
test_35_sparse_barangay_heuristic_fallback (analytics.tests.test_forecasting.WasteForecastingComprehensiveTests.test_35_sparse_barangay_heuristic_fallback) ... ok

----------------------------------------------------------------------
Ran 35 tests in 13.358s

OK
Destroying test database for alias 'default' ('file:memorydb_default?mode=memory&cache=shared')...
```

---

## 3. Django System Check Verification

```powershell
d:\Coding\Waste Watch\wastewatch\backend> .\venv\Scripts\python.exe manage.py check
System check identified no issues (0 silenced).
```

---

## 4. Vite Frontend Production Build Verification

```powershell
d:\Coding\Waste Watch\wastewatch\frontend> npm.cmd run build

> wastewatch-frontend@0.1.0 build
> vite build

vite v5.4.21 building for production...
transforming...
✓ 1986 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     1.45 kB │ gzip:   0.73 kB
dist/assets/index-Bfx166Kt.css    111.03 kB │ gzip:  20.33 kB
dist/assets/index-DDUFucU6.js   2,469.33 kB │ gzip: 615.71 kB
✓ built in 33.33s
```
