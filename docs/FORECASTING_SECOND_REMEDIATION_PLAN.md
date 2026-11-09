# WASTEWATCH — SECOND FORECASTING REMEDIATION PLAN

**Document Version:** 2.0  
**Date:** 2026-11-02  
**Author:** Gemini Antigravity — Lead Implementer  
**Authority:** ChatGPT — Project Manager / Architecture Authority  
**Independent Reviewer:** Claude — Independent Technical Auditor  
**Project:** WasteWatch — CENRO Lucena City  
**Status:** Approved Implementation Plan for N-01 through N-12  

---

## 1. Executive Summary & Architecture Governance

Following Claude's independent technical re-audit (`REJECT — REMEDIATION INCOMPLETE`), this remediation plan establishes the precise root causes, code changes, architectural guarantees, and retest procedures for all 12 re-audit findings (N-01 through N-12), as well as remaining F-findings.

### Strict Architectural Boundaries
1. **Model Discipline**: Ridge Regression remains the **sole supervised ML algorithm** ($h=1..7$ direct multi-horizon). No Random Forest, XGBoost, LightGBM, Gradient Boosting, or ensembles will be introduced.
2. **Authoritative Forecast**: The **Weekday-Adjusted Seasonal Heuristic** remains the operational primary forecasting method.
3. **No Premature Promotion**: `FORECAST_ML_ENABLED = False` remains in effect. Ridge will **not** be promoted to production-primary until at least 12 weeks (84 distinct days) of genuine historical data are collected, followed by 8 weeks of shadow evaluation against forward observations.
4. **Real Shadow Mode**: A dedicated `ShadowForecastPrediction` model and management command `record_shadow_forecast` will run Ridge in parallel with the heuristic, storing predictions side-by-side without serving Ridge on the public analytics endpoint.

---

## 2. Re-Audit Findings & Implementation Matrix (N-01 to N-12)

| Finding | Severity | Audit Concern | Root Cause in Source | Planned Implementation & Fix | Target Files | Verification Test |
|---|---|---|---|---|---|---|
| **N-01** | CRITICAL | Horizon-specific training features misaligned; calendar features for $h=1$ used for all $h=1..7$. | `generate_training_matrix` called `build_feature_vector_for_origin` with `target_date = origin + 1` once, pairing that single feature row with targets $y_{T+1}..y_{T+7}$. | Generate dedicated feature matrix $X^{(h)}$ for each horizon $h$ with `target_date = origin + timedelta(days=h)`. Pair $X^{(h)}$ with $y_h$ in training and validation. | `forecasting/features.py`, `forecasting/models.py`, `forecasting/management/commands/train_waste_forecast.py` | `test_25_horizon_specific_calendar_features` |
| **N-02** | CRITICAL | Pseudo-embargoes; split skipped 1 index instead of 7 calendar days; target date overlap. | `fit_and_calibrate` partitioned by origin indices `split_train + 1`, which is only a 1-day step, allowing targets $T_{\text{train}}+7$ to overlap calibration origins. | Sort unique origin dates; enforce $\min(\text{Cal Origins}) \ge \max(\text{Train Origins}) + 8$ days and $\min(\text{Test Origins}) \ge \max(\text{Cal Origins}) + 8$ days. Error out if insufficient data. | `forecasting/models.py` | `test_26_strict_seven_day_embargo_isolation` |
| **N-03** | CRITICAL | Artifact governance did not fail closed; missing keys permitted; unverified unpickling. | `service.py` checked `synthetic_records > 0`, but if the key was missing or None, it proceeded to unpickle; hash checked after reading file path. | Require metadata to contain valid `synthetic_records == 0`, valid `model_sha256`, and valid schema. Compute SHA-256 on byte buffer and unpickle from the exact verified bytes. Quarantine all unverified artifacts. | `forecasting/service.py` | `test_27_fail_closed_artifact_governance` |
| **N-04** | CRITICAL | Disabling Ridge prevents shadow evaluation; no persistence of forward predictions. | Setting `FORECAST_ML_ENABLED = False` short-circuited all Ridge inference; no database model existed to store shadow predictions. | Create Django model `ShadowForecastPrediction` in `analytics/models.py`. Implement `record_shadow_forecast` management command to store Ridge + Heuristic predictions and join actuals. | `analytics/models.py`, `forecasting/management/commands/record_shadow_forecast.py` | `test_28_shadow_prediction_persistence` |
| **N-05** | HIGH | Canonical heuristic behavior altered; inconsistency between serving and baseline. | `train_waste_forecast.py` and `service.py` had divergent heuristic implementations; hardcoded Sunday=0 without checking schedules. | Unify into single canonical `forecast_weight_heuristic` function; check `CollectionSchedule` for scheduled Sunday routes; test baseline and serving consistency. | `forecasting/service.py`, `forecasting/management/commands/train_waste_forecast.py` | `test_29_heuristic_serving_and_baseline_consistency` |
| **N-06** | HIGH | In-sample / contaminated hyperparameter selection. | Alpha grid search was performed over validation fold instead of nested inner training folds. | Implement nested chronological inner splits within Train partition for $\alpha$ selection; keep Cal and Test strictly out-of-fold. | `forecasting/models.py` | `test_30_nested_alpha_selection_isolation` |
| **N-07** | HIGH | Unmeasured test coverage reported as nominal or fabricated; sample counts omitted. | When test partition had sparse samples, coverage was defaulted to 0.80 instead of null. | Store `test_coverage: null` when test samples are insufficient ($< 15$). Report exact sample counts $N_{\text{cal}}$ and $N_{\text{test}}$ per horizon and segment. | `forecasting/models.py` | `test_31_unmeasured_test_coverage_null` |
| **N-08** | MEDIUM | Sunday collection hardcoded to zero; non-collection days assigned zero-width interval. | `target_is_sunday` forced expected=0 and width=0 regardless of whether collection was scheduled. | Consult `CollectionSchedule` and `DriverShift`: if Sunday collection is scheduled/active, predict normally; if non-collection, mark status clearly without false interval claims. | `forecasting/features.py`, `forecasting/models.py`, `forecasting/service.py` | `test_32_sunday_schedule_aware_forecasting` |
| **N-09** | MEDIUM | Artifact rollback inconsistent; model and metadata decoupled. | Separate `.joblib` and `.json` files could be updated non-atomically or partially rolled back. | Atomic manifest pointer (`manifest.json` pointing to active version ID) or version directory swap; verify digest and metadata together. | `forecasting/management/commands/rollback_forecast_model.py`, `forecasting/service.py` | `test_33_atomic_manifest_rollback` |
| **N-10** | MEDIUM | Eligibility based on record counts instead of distinct collection days. | Threshold checked `WasteDelivery.objects.count() >= 28`, which multiple deliveries per day can satisfy in 7 days. | Enforce minimum of **84 distinct genuine collection days** ($12 \text{ weeks}$) in training window for production eligibility. | `forecasting/management/commands/train_waste_forecast.py` | `test_34_distinct_genuine_days_eligibility` |
| **N-11** | MEDIUM | Sparse barangays qualify via zero-padding. | Zero-filling created 60 rows for barangays with only 2 actual delivery days, qualifying them for ML. | Require at least 28 distinct *active delivery days* ($w > 0$) for barangay-level ML forecasting; fall back to heuristic otherwise. | `forecasting/service.py` | `test_35_sparse_barangay_heuristic_fallback` |
| **N-12** | LOW | Documentation claimed 100% resolution without independent audit evidence. | Remediation report marked items resolved before independent re-audit. | Follow strict protocol: report actual code diffs, raw terminal outputs, and mark findings as "Remediated in source, pending Claude re-audit". | `docs/FORECASTING_SECOND_REMEDIATION_REPORT.md` | Verification checklist |

---

## 3. Implementation Plan & Execution Order

### Phase 1: Critical Correctness (N-01, N-02, N-03, N-06, N-07)
1. **Horizon-Specific Feature Matrices (`features.py`, `models.py`)**:
   - Refactor `generate_training_matrix` to return `X_dict: Dict[int, pd.DataFrame]` and `y_dict: Dict[int, pd.Series]`.
   - For each horizon $h \in \{1..7\}$, compute calendar features for `target_date = origin_date + timedelta(days=h)`.
   - Update `RidgeMultiHorizonForecaster.fit_and_calibrate` to fit model $h$ on $X^{(h)}$ and $y_h$.
   - Ensure inference `predict_7_days` builds matching feature rows for horizon $h$.
2. **Strict Chronological 7-Day Embargoes (`models.py`)**:
   - Extract unique origin dates.
   - Compute date boundaries:
     $$\text{Train Origins} \le D_{\text{train\_end}}$$
     $$D_{\text{cal\_start}} \ge D_{\text{train\_end}} + \text{timedelta(days=8)}$$
     $$\text{Cal Origins} \le D_{\text{cal\_end}}$$
     $$D_{\text{test\_start}} \ge D_{\text{cal\_end}} + \text{timedelta(days=8)}$$
   - If total available origin span is less than 35 days, abort with explicit error or set test metrics to `None`.
3. **Fail-Closed Artifact Governance (`service.py`)**:
   - In `load_latest_forecaster`, read file bytes, compute SHA-256 digest, and compare with `metadata['model_sha256']`.
   - Require `metadata['synthetic_records'] == 0`, `metadata['promoted_to_production'] is True`, and all required keys.
   - If any validation fails, return `(None, None)` and fall back to heuristic.

### Phase 2: Real Shadow Mode Infrastructure (N-04)
1. **Shadow Prediction Model (`analytics/models.py`)**:
   - Define `ShadowForecastPrediction` with fields:
     - `origin_date`, `target_date`, `horizon_step`
     - `barangay` (nullable for city-wide)
     - `model_type`, `model_version`
     - `expected_kg`, `low_kg`, `high_kg`
     - `heuristic_expected_kg`, `heuristic_low_kg`, `heuristic_high_kg`
     - `actual_kg` (nullable), `is_actual_complete`
     - Unique constraint on `[origin_date, target_date, horizon_step, barangay, model_version]`.
   - Create and run migration `analytics.0004_shadowforecastprediction`.
2. **Management Command (`record_shadow_forecast.py`)**:
   - Executes offline Ridge forecaster on yesterday's origin date.
   - Computes corresponding heuristic baseline for identical origin/target.
   - Stores shadow prediction records.
   - Backfills `actual_kg` for past target dates as weighbridge records arrive.

### Phase 3: Data Integrity, Heuristic Consistency & Rollback (N-05, N-08, N-09, N-10, N-11)
1. **Heuristic Unification (`service.py`, `train_waste_forecast.py`)**:
   - Canonical `forecast_weight_heuristic` imported and used by baseline CV.
   - Schedule-aware: inspect `CollectionSchedule` for day-of-week active routes before forcing zero.
2. **Manifest-Based Atomic Rollback (`rollback_forecast_model.py`)**:
   - Store `active_manifest.json` pointing to `current_version` and `previous_version`.
   - Rollback atomically updates `active_manifest.json` via `os.replace`.
3. **84 Distinct Days & Sparse Barangay Eligibility (`aggregation.py`, `service.py`)**:
   - Verify `WasteDelivery.objects.filter(is_synthetic=False).values('date').distinct().count() >= 84`.
   - For barangays, require $\ge 28$ active delivery days ($w > 0$) to serve ML predictions.

### Phase 4: Test Suite & Documentation (N-12)
1. Expand `analytics/tests/test_forecasting.py` to cover tests 25 through 35.
2. Run test suite and capture exact raw terminal output.
3. Generate `docs/FORECASTING_SECOND_REMEDIATION_REPORT.md` and `docs/FORECASTING_SECOND_REMEDIATION_TEST_RESULTS.md`.
