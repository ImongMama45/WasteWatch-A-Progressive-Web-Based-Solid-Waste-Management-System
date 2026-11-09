# WasteWatch Forecasting Engine — Third Remediation Plan
## Critical Heuristic Correction and Forecasting Integrity

**To:** ChatGPT (Project Manager / Architecture Authority)  
**From:** Gemini Antigravity (Lead Implementer)  
**CC:** Claude (Independent Technical Auditor)  
**Project:** WasteWatch — CENRO Lucena City  
**Date:** 2026-11-03  
**Status:** Approved for Execution — Production Promotion Prohibited  

---

## 1. Governance & Architectural Boundaries

Per Project Manager directives and Claude's Third Independent Audit:
1. **Ridge Regression Remains Sole Supervised ML Model:** 7 direct multi-horizon estimators ($h=1..7$). No XGBoost, Random Forest, LightGBM, Gradient Boosting, or ensembles.
2. **Seasonal Heuristic Remains Intended Production-Primary:** Public API continues serving the canonical seasonal heuristic.
3. **`FORECAST_ML_ENABLED=False` Remains Hardcoded:** Ridge is experimental and non-authoritative. Production promotion is strictly prohibited.
4. **Shadow Mode Is Not Yet Operational:** It will be formally corrected and verified in Phase 4. No claim will be made that the 8-week shadow evaluation has started or completed.
5. **No Synthetic Training Data Promoted:** `synthetic_records` must be an integer equal to 0.
6. **Zero Emojis:** Strictly prohibited across all code, tests, and documentation.

---

## 2. Phase-by-Phase Remediation Roadmap

### Phase 1: Fix T-01 — Critical Heuristic Aggregation Defect
- **Defect Analysis:** In `forecasting/service.py` (`forecast_weight_heuristic`) and `record_shadow_forecast.py` (`compute_heuristic_points_for_origin`), the daily weight mapping was implemented as:
  ```python
  by_day = {
      row['date']: float(row['kg'] or 0.0)
      for row in qs.values('date').annotate(kg=WEIGHT_EXPR)
  }
  ```
  Because `WEIGHT_EXPR` is an individual row expression without `Sum()`, `qs.values('date').annotate(kg=WEIGHT_EXPR)` returns multiple rows per date. The dictionary comprehension keeps only the last row for each date, discarding all previous deliveries on that date!
- **Root Cause Resolution:** Replace all ad-hoc dictionary comprehensions with the canonical aggregation function `build_daily_aggregation()` from `forecasting/aggregation.py`.
- **Properties of Canonical Aggregation:**
  - Sums all deliveries for each date.
  - Divides shared-route deliveries proportionally ($w / N$) across served barangays.
  - Sums full weighbridge weight for city-wide aggregation and tracks unattributed tonnage.
  - Distinguishes active delivery days (`delivery_count > 0`), scheduled non-collections, and missing records.
- **Mandatory Regression Tests:**
  - Multiple deliveries on the same date (e.g. 4,000 kg + 6,000 kg + 5,000 kg = 15,000 kg).
  - Multiple barangays on shared routes.
  - City-wide totals vs barangay allocations.
  - Verification of public API endpoint `GET /api/analytics/live/`.

---

### Phase 2: Fix T-02 — City Population Train/Serve Feature Alignment
- **Defect Analysis:** In `train_waste_forecast.py`, city-wide population was set to `sum(b.population)`. In `service.py` (`get_waste_forecast`) and `record_shadow_forecast.py`, city-wide population was hardcoded to `0.0`. This created a critical feature distribution mismatch between training and inference.
- **Root Cause Resolution:**
  - Implement `get_canonical_city_population()` in `forecasting/features.py`. It calculates the sum of all active barangay populations or returns the canonical CENRO Lucena City census baseline.
  - Standardize population calculation across:
    1. Training matrix construction (`train_waste_forecast.py`).
    2. Serving inference (`service.py`).
    3. Shadow prediction pipeline (`record_shadow_forecast.py`).
    4. Feature vector builders (`build_feature_vector_for_origin`).
- **Tests Added:** Deterministic parity tests comparing training feature vectors and serving feature vectors for city-wide series.

---

### Phase 3: Fix N-08 & T-05 — Safe Schedule & Sunday Behavior
- **Defect Analysis:** `is_collection_scheduled` caught database exceptions and returned `False`, falsely interpreting database errors as proof of non-collection and clamping Sunday to zero. Additionally, it used naive substring matching.
- **Root Cause Resolution:**
  - Refactor schedule checking in `forecasting/features.py` to use strict word-boundary token matching (`\b(Sun|Sunday)\b`).
  - Differentiate three schedule states: `SCHEDULED`, `CONFIRMED_NON_COLLECTION`, and `UNKNOWN`.
  - When schedule state is `UNKNOWN` (e.g. database error), fail safe: do NOT force Sunday to zero and do NOT assign a zero-width interval. Instead, apply normal baseline extrapolation with clear uncertainty disclosures.
  - Check truck active status and route status (`status != 'CANCELLED'`).
  - Do not apply today's schedule retroactively to historical training partitions.

---

### Phase 4: Correct Shadow Evaluation Architecture
- **Defect Analysis:**
  - Circular gating: Ridge could not enter shadow mode without passing production promotion.
  - Database uniqueness flaw: In PostgreSQL and SQLite, unique constraints on nullable foreign keys (`barangay=NULL`) allow duplicate city-wide rows unless `nulls_distinct=False` is set or a dedicated series key is used.
  - Predictions were mutable via `update_or_create`.
- **Root Cause Resolution:**
  - Add `series_id` string field (`"city"` or `"brgy_<id>"`) to `ShadowForecastPrediction` and set unique constraint on `['origin_date', 'target_date', 'horizon_step', 'series_id', 'model_version']`.
  - Add `is_backfill` boolean flag to cleanly isolate forward shadow predictions from historical backfills.
  - Allow shadow evaluations to record heuristic predictions even when no Ridge candidate artifact exists.
  - Introduce candidate artifact pointer `candidate_manifest.json` allowing experimental Ridge models to be evaluated in shadow mode without production promotion.
  - Enforce record immutability: once a prediction is logged for an origin and target, it is append-only or version-tracked, not silently overwritten.
  - Enforce documented grace period (e.g. 24 hours) before locking actual weighbridge records.

---

### Phase 5: Correct the Promotion Gating Architecture
- **Defect Analysis:** The gating comparison compared Ridge against a decoupled heuristic using different sample spaces, pooled city and barangay errors into a single ratio, and used arbitrary fallback MAE constants.
- **Root Cause Resolution:**
  - Ridge and heuristic must be evaluated on identical origin dates, identical target dates, and identical holdout observations.
  - Report city-wide MAE/RMSE/WAPE and barangay MAE/RMSE/WAPE independently.
  - Report performance horizon-by-horizon ($h=1..7$).
  - Prohibit promotion unless both city-wide and barangay segments meet accuracy thresholds.
  - Production promotion remains prohibited until 8 weeks of shadow predictions have been recorded.

---

### Phase 6: Artifact Governance (N-03, N-09, T-06)
- **Defect Analysis:** Cache keys did not include artifact version; integer typing of `synthetic_records` was not strictly checked.
- **Root Cause Resolution:**
  - Verify `isinstance(synthetic_records, int) and synthetic_records == 0`.
  - Validate exact scikit-learn and Python versions.
  - Cache key incorporates target directory, model version, and SHA-256 digest.
  - Rollback command rejects ineligible or corrupted artifacts prior to activation.

---

### Phase 7: Data Integrity, Frontend & Semantic Disclosures
- Explicitly disclose uncalibrated Gaussian standard deviation intervals on the frontend (`GlobalInsights.jsx`).
- Distinguish weighbridge scale readings (`net_weight > 0`) from driver estimates (`estimated_kg`).
- Keep unattributed city-wide tonnage visible in reports.

---

### Phase 8 & 9: Test Suite Rewrite & Validation
Completely rewrite the 11 tests flagged by Claude:
- `test_13`: exercises real fallback paths with broken/corrupt model.
- `test_17`: robust latency benchmark with statistical bounds.
- `test_21`: genuine multi-series embargo validation.
- `test_23`: strict mathematical triangle bound on actual aggregations.
- `test_26`: embargo partition validation with real target date checks.
- `test_28`: shadow prediction immutability, uniqueness, and candidate artifact evaluation.
- `test_29`: heuristic serving and baseline consistency using canonical aggregation.
- `test_30`: nested alpha tuning proof with no calibration leakage.
- `test_32`: safe schedule behavior and uncertainty handling.
- `test_34`: genuine distinct collection days count verification.
- `test_35`: sparse barangay fallback on active delivery days.

---

## 3. Verification & Execution Order

1. Fix T-01 in `aggregation.py`, `service.py`, and `record_shadow_forecast.py`.
2. Implement regression tests proving multi-delivery summation (4000 + 6000 + 5000 = 15000 kg).
3. Fix T-02 (city population) across all modules.
4. Fix N-08/T-05 (safe schedule behavior).
5. Implement shadow evaluation architecture updates and database migration.
6. Correct promotion gating logic in `train_waste_forecast.py`.
7. Rewrite test suite in `analytics/tests/test_forecasting.py`.
8. Execute full test suite and build verification.
9. Author `FORECASTING_THIRD_REMEDIATION_REPORT.md` and `FORECASTING_THIRD_REMEDIATION_TEST_RESULTS.md`.
