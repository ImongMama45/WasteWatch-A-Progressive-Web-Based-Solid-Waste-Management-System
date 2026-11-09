"""
analytics/tests/test_forecasting.py
-----------------------------------
Comprehensive test suite for WasteWatch Ridge Regression Forecasting Engine.

Remediated per Independent Technical Audit (Claude) & Directive:
- F-14: Date-independent tests; test_02 selects deterministic active delivery day.
- F-13: test_08 rewritten to test real leakage prevention on generate_training_matrix.
- F-13: test_13 exercises actual get_waste_forecast fallback path.
- F-13: test_16 asserts non-vacuously on API payload structure.
- F-01 & F-10: test_18 verifies synthetic data exclusion.
- F-03: test_19 verifies deterministic Sunday zero forecasts.
- F-06: test_20 verifies ratio feature numerical stability on zero denominators.
- F-05: test_21 verifies chronological partition integrity with 7-day embargo.
- F-15: test_22 verifies artifact rollback detection.
- F-04: test_23 verifies heuristic baseline satisfies mathematical triangle bound.
- F-01: test_24 verifies quarantine of synthetic-trained artifacts.
"""

import os
import time
import json
import shutil
import tempfile
import hashlib
import math
from datetime import date, timedelta
from decimal import Decimal

import numpy as np
import pandas as pd
from django.test import TestCase, override_settings
from django.utils import timezone
from django.conf import settings

from accounts.models import Barangay, User
from dumpsite.models import Dumpsite, WasteDelivery
from driver.models import Truck, CollectionSchedule
from analytics.models import ShadowForecastPrediction
from forecasting.aggregation import (
    build_daily_aggregation,
    extract_raw_deliveries,
)
from forecasting.features import (
    extract_calendar_features,
    extract_origin_lag_and_rolling_features,
    build_feature_vector_for_origin,
    generate_training_matrix,
    HorizonFeatureDict,
    is_collection_scheduled,
    check_collection_schedule,
    ScheduleStatus,
    get_canonical_city_population,
    get_series_population,
)
from forecasting.models import (
    RidgeMultiHorizonForecaster,
    create_ridge_pipeline,
    NUMERIC_FEATURES,
    CATEGORICAL_FEATURES,
)
from forecasting.service import (
    get_waste_forecast,
    forecast_weight_heuristic,
    load_latest_forecaster,
    load_candidate_forecaster,
    _CACHED_FORECASTER,
)
from analytics.services import build_live_payload
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import transaction


class WasteForecastingComprehensiveTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        # Create driver, dumpsite, truck, and barangays
        cls.driver = User.objects.create_user(
            username="test_driver_forecast",
            email="driver_fc@example.com",
            password="pass",
            role="driver"
        )
        cls.brgy1 = Barangay.objects.create(name="Barangay 1", population=15000, latitude=13.93, longitude=121.61)
        cls.brgy2 = Barangay.objects.create(name="Barangay 2", population=22000, latitude=13.94, longitude=121.62)
        cls.brgy3 = Barangay.objects.create(name="Barangay 3", population=8000, latitude=13.95, longitude=121.63)

        cls.dumpsite = Dumpsite.objects.create(
            name="Test Sanitary Landfill",
            type="dumpsite",
            barangay=cls.brgy1,
            latitude=13.93,
            longitude=121.61,
            max_capacity_kg=100000.0
        )
        cls.truck = Truck.objects.create(
            plate_number="WW-FC-01",
            model="Isuzu Compactor 8T",
            max_capacity_kg=8000,
            status="active"
        )

        # Create 60 days of genuine deliveries
        cls.base_date = timezone.localdate() - timedelta(days=65)
        cls.delivery_dates = []
        for i in range(60):
            d = cls.base_date + timedelta(days=i)
            # Skip Sundays for scheduled non-collection
            if d.weekday() == 6:
                continue

            deliv = WasteDelivery.objects.create(
                truck=cls.truck,
                driver=cls.driver,
                dumpsite=cls.dumpsite,
                date=d,
                gross_weight=7500.0,
                tare_weight=4000.0,
                estimated_kg=3500.0,
                is_validated=True,
                is_synthetic=False
            )
            # Delivery serves brgy1 and brgy2 equally
            deliv.barangays.set([cls.brgy1, cls.brgy2])
            cls.delivery_dates.append(d)

        # First guaranteed active delivery day (F-14 fix)
        cls.active_date = cls.delivery_dates[0]

    # 1. Daily Aggregation
    def test_01_daily_aggregation(self):
        start = self.base_date
        end = self.base_date + timedelta(days=14)
        df = build_daily_aggregation(start, end, brgy_id=None)

        self.assertEqual(len(df), 15)
        self.assertIn('date', df.columns)
        self.assertIn('weight_kg', df.columns)
        self.assertIn('delivery_count', df.columns)
        self.assertIn('day_type', df.columns)

    # 2. City-Wide Reconciliation (F-14 fixed: date-independent non-Sunday selection)
    def test_02_city_wide_reconciliation(self):
        target_date = self.active_date
        city_df = build_daily_aggregation(target_date, target_date, brgy_id=None)
        city_weight = city_df['weight_kg'].iloc[0]

        b1_df = build_daily_aggregation(target_date, target_date, brgy_id=self.brgy1.id)
        b2_df = build_daily_aggregation(target_date, target_date, brgy_id=self.brgy2.id)
        b3_df = build_daily_aggregation(target_date, target_date, brgy_id=self.brgy3.id)

        sum_brgys = b1_df['weight_kg'].iloc[0] + b2_df['weight_kg'].iloc[0] + b3_df['weight_kg'].iloc[0]

        self.assertEqual(city_weight, 3500.0)
        self.assertEqual(b1_df['weight_kg'].iloc[0], 1750.0)
        self.assertEqual(b2_df['weight_kg'].iloc[0], 1750.0)
        self.assertEqual(b3_df['weight_kg'].iloc[0], 0.0)
        self.assertAlmostEqual(city_weight, sum_brgys, places=2)

    # 3. Missing-Day Handling
    def test_03_missing_day_handling(self):
        start = self.base_date
        end = self.base_date + timedelta(days=20)
        df = build_daily_aggregation(start, end, fill_zeros=True)

        expected_dates = [start + timedelta(days=i) for i in range(21)]
        actual_dates = df['date'].tolist()
        self.assertEqual(actual_dates, expected_dates)

    # 4. Confirmed Zero-Delivery Handling
    def test_04_confirmed_zero_delivery_handling(self):
        start = self.base_date
        end = self.base_date + timedelta(days=10)
        df = build_daily_aggregation(start, end, fill_zeros=True)

        for _, row in df.iterrows():
            d = row['date']
            if row['delivery_count'] > 0:
                self.assertEqual(row['day_type'], 'ACTIVE_DELIVERY')
            elif d.weekday() == 6:
                self.assertEqual(row['day_type'], 'SCHEDULED_NON_COLLECTION')
            else:
                self.assertIn(row['day_type'], ['CONFIRMED_ZERO', 'UNRECORDED_OR_MISSING'])

    # 5. Lag Features
    def test_05_lag_features(self):
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(35)]
        vals = [100.0 + i * 5 for i in range(35)]
        series = pd.Series(vals, index=dates)

        feats = extract_origin_lag_and_rolling_features(series)
        self.assertEqual(feats['lag_1'], vals[-1])
        self.assertEqual(feats['lag_2'], vals[-2])
        self.assertEqual(feats['lag_7'], vals[-7])
        self.assertEqual(feats['lag_14'], vals[-14])
        self.assertEqual(feats['lag_21'], vals[-21])

    # 6. Rolling Features
    def test_06_rolling_features(self):
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(35)]
        vals = [10.0] * 35
        series = pd.Series(vals, index=dates)

        feats = extract_origin_lag_and_rolling_features(series)
        self.assertEqual(feats['rolling_mean_7'], 10.0)
        self.assertEqual(feats['rolling_mean_14'], 10.0)
        self.assertEqual(feats['rolling_mean_28'], 10.0)
        self.assertEqual(feats['rolling_std_7'], 0.0)
        self.assertEqual(feats['rolling_max_14'], 10.0)
        self.assertEqual(feats['rolling_min_14'], 10.0)
        self.assertEqual(feats['rolling_median_14'], 10.0)

    # 7. Forecast Horizon Construction
    def test_07_forecast_horizon_construction(self):
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(50)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [2000.0 + (i % 7) * 200 for i in range(50)],
            'barangay_id': 1,
            'population': 15000.0
        })

        X_df, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
        self.assertEqual(len(y_dict), 7)
        for h in range(1, 8):
            self.assertIn(h, y_dict)
            self.assertEqual(len(y_dict[h]), len(X_df))

    # 8. Future Leakage Prevention (F-13 fix: non-vacuous matrix generation check)
    def test_08_future_leakage_prevention(self):
        dates_clean = [date(2026, 1, 1) + timedelta(days=i) for i in range(50)]
        df_clean = pd.DataFrame({
            'date': dates_clean,
            'weight_kg': [3000.0 + (i % 7) * 100 for i in range(50)],
            'barangay_id': 1,
            'population': 15000.0
        })
        X_clean, _ = generate_training_matrix(df_clean, horizon=7, min_history_required=28)

        # Append future records with massive spikes
        dates_future = dates_clean + [date(2026, 1, 1) + timedelta(days=50 + i) for i in range(20)]
        df_future = pd.DataFrame({
            'date': dates_future,
            'weight_kg': list(df_clean['weight_kg']) + [9999999.0] * 20,
            'barangay_id': 1,
            'population': 15000.0
        })
        X_future, _ = generate_training_matrix(df_future, horizon=7, min_history_required=28)

        # Rows corresponding to origins present in df_clean must have identical feature values
        n_origins_clean = len(X_clean)
        X_clean_df = X_clean[1]
        X_future_subset = X_future[1].iloc[:n_origins_clean]

        for col in ['lag_1', 'lag_7', 'rolling_mean_7', 'rolling_mean_28', 'trend_7_vs_28']:
            diffs = np.abs(X_clean_df[col].values - X_future_subset[col].values)
            self.assertAlmostEqual(float(np.max(diffs)), 0.0, places=5)

    # 9. Ridge Training
    def test_09_ridge_training(self):
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(65)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [3000.0 + (i % 7) * 300 for i in range(65)],
            'barangay_id': 1,
            'population': 15000.0
        })

        X_df, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
        forecaster = RidgeMultiHorizonForecaster(horizon=7)
        metrics = forecaster.fit_and_calibrate(X_df, y_dict, n_cv_splits=3)

        self.assertTrue(forecaster.is_fitted)
        self.assertEqual(len(forecaster.models), 7)
        self.assertIn('overall_mae', metrics)
        self.assertGreater(metrics['overall_mae'], 0)

    # 10. Chronological Validation
    def test_10_chronological_validation(self):
        from sklearn.model_selection import TimeSeriesSplit
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(40)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [2500.0] * 40,
            'barangay_id': 1,
            'population': 10000.0
        })
        X_df, _ = generate_training_matrix(df, horizon=7, min_history_required=28)

        tscv = TimeSeriesSplit(n_splits=3)
        for train_idx, val_idx in tscv.split(X_df):
            self.assertLess(max(train_idx), min(val_idx))

    # 11. Prediction Interval Calculation
    def test_11_prediction_interval_calculation(self):
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(65)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [4000.0 + (i % 5) * 200 for i in range(65)],
            'barangay_id': 1,
            'population': 15000.0
        })

        X_df, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
        forecaster = RidgeMultiHorizonForecaster(horizon=7)
        forecaster.fit_and_calibrate(X_df, y_dict, n_cv_splits=3)

        history_s = pd.Series(df['weight_kg'].values, index=df['date'])
        points = forecaster.predict_7_days(
            origin_date=dates[-1],
            history_weights=history_s,
            barangay_id=1,
            population=15000.0
        )

        self.assertEqual(len(points), 7)
        for p in points:
            self.assertGreaterEqual(p['low_kg'], 0)
            self.assertLessEqual(p['low_kg'], p['expected_kg'])
            self.assertGreaterEqual(p['high_kg'], p['expected_kg'])

    # 12. Artifact Saving and Loading
    def test_12_artifact_saving_and_loading(self):
        import joblib
        with tempfile.TemporaryDirectory() as temp_dir:
            forecaster = RidgeMultiHorizonForecaster(horizon=7)
            dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(65)]
            df = pd.DataFrame({
                'date': dates,
                'weight_kg': [3000.0] * 65,
                'barangay_id': 1,
                'population': 15000.0
            })
            X_df, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
            forecaster.fit_and_calibrate(X_df, y_dict, n_cv_splits=3)

            model_file = os.path.join(temp_dir, 'waste_forecast_model_latest.joblib')
            meta_file = os.path.join(temp_dir, 'waste_forecast_metadata_latest.json')

            joblib.dump(forecaster, model_file)
            with open(model_file, 'rb') as f:
                sha = hashlib.sha256(f.read()).hexdigest()

            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'test_v1',
                    'synthetic_records': 0,
                    'sha256': sha,
                    'model_sha256': sha,
                    'validation_status': 'PASSED',
                    'feature_schema': forecaster.feature_names,
                    'validation_metrics': {'overall_mae': 123.4}
                }, f)

            loaded_model, loaded_meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNotNone(loaded_model)
            self.assertTrue(loaded_model.is_fitted)
            self.assertEqual(loaded_meta['model_version'], 'test_v1')

    # 13. Model Fallback (Directive: exercises actual get_waste_forecast fail-closed fallback)
    @override_settings(FORECAST_ML_ENABLED=True)
    def test_13_model_fallback(self):
        with tempfile.TemporaryDirectory() as empty_dir:
            res = get_waste_forecast(brgy_obj=self.brgy1, artifacts_dir=empty_dir)
            self.assertEqual(res['model_type'], 'heuristic')
            self.assertTrue(res['is_fallback'])
            self.assertTrue(res['sufficient'])
            self.assertEqual(len(res['points']), 7)
            self.assertIn("no trained ridge regression model artifact", res.get('fallback_reason', '').lower())

    # 14. Invalid Predictions Handling
    def test_14_invalid_predictions(self):
        forecaster = RidgeMultiHorizonForecaster(horizon=7)
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(65)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [10.0] * 65,
            'barangay_id': 1,
            'population': 1000.0
        })
        X_df, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
        forecaster.fit_and_calibrate(X_df, y_dict, n_cv_splits=3)

        history_s = pd.Series(df['weight_kg'].values, index=df['date'])
        points = forecaster.predict_7_days(
            origin_date=dates[-1],
            history_weights=history_s,
            barangay_id=1,
            population=1000.0
        )
        for p in points:
            self.assertGreaterEqual(p['expected_kg'], 0)
            self.assertGreaterEqual(p['low_kg'], 0)

    # 15. New Barangays Handling
    def test_15_new_barangay_handling(self):
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(65)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [3500.0] * 65,
            'barangay_id': 1,
            'population': 15000.0
        })
        X_df, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
        forecaster = RidgeMultiHorizonForecaster(horizon=7)
        forecaster.fit_and_calibrate(X_df, y_dict, n_cv_splits=3)

        history_s = pd.Series(df['weight_kg'].values, index=df['date'])
        points = forecaster.predict_7_days(
            origin_date=dates[-1],
            history_weights=history_s,
            barangay_id=9999,
            population=25000.0
        )
        self.assertEqual(len(points), 7)
        self.assertTrue(all(p['expected_kg'] >= 0 for p in points))

    # 16. API Response Compatibility (F-13 fix: asserts non-vacuously on payload)
    def test_16_api_response_compatibility(self):
        payload = build_live_payload(
            date_from=timezone.localdate() - timedelta(days=14),
            date_to=timezone.localdate(),
            brgy_obj=None
        )
        self.assertIn('forecast', payload)
        fc = payload['forecast']
        self.assertTrue(fc['sufficient'], "Forecast should be marked sufficient given 60 days of deliveries.")
        self.assertEqual(fc['band_pct'], 80)
        self.assertIn('history', fc)
        self.assertIn('points', fc)
        self.assertEqual(len(fc['points']), 7)
        self.assertIn(fc['model_type'], ['heuristic', 'ridge'])
        first_pt = fc['points'][0]
        self.assertIn('date', first_pt)
        self.assertIn('expected_kg', first_pt)
        self.assertIn('low_kg', first_pt)
        self.assertIn('high_kg', first_pt)

    # 17. API Latency Measurement
    def test_17_api_latency_measurement(self):
        _ = get_waste_forecast(brgy_obj=None)
        latencies = []
        for _ in range(25):
            t0 = time.perf_counter()
            _ = get_waste_forecast(brgy_obj=None)
            t1 = time.perf_counter()
            latencies.append((t1 - t0) * 1000.0)

        p95_latency = float(np.percentile(latencies, 95))
        self.assertLess(p95_latency, 250.0, f"P95 latency {p95_latency:.2f} ms exceeded threshold.")

    # 18. Synthetic Data Exclusion (F-01 & F-10 fix)
    def test_18_synthetic_data_exclusion(self):
        test_d = self.active_date
        # Create a synthetic delivery with 50,000 kg on the active date
        synth_deliv = WasteDelivery.objects.create(
            truck=self.truck,
            driver=self.driver,
            dumpsite=self.dumpsite,
            date=test_d,
            gross_weight=54000.0,
            tare_weight=4000.0,
            estimated_kg=50000.0,
            is_validated=True,
            is_synthetic=True
        )
        synth_deliv.barangays.set([self.brgy1])

        # By default (include_synthetic=False), daily aggregation MUST completely ignore this row
        df_clean = build_daily_aggregation(test_d, test_d, brgy_id=None, include_synthetic=False)
        self.assertEqual(df_clean['weight_kg'].iloc[0], 3500.0)

        # When include_synthetic=True is explicitly passed, it is included
        df_with_synth = build_daily_aggregation(test_d, test_d, brgy_id=None, include_synthetic=True)
        self.assertEqual(df_with_synth['weight_kg'].iloc[0], 53500.0)

    # 19. Sunday Forecast Zero (F-03 fix)
    def test_19_sunday_forecast_zero(self):
        # Origin is Saturday; h=1 is Sunday
        saturday_origin = date(2026, 10, 17)
        dates = [saturday_origin - timedelta(days=60 - i) for i in range(60)]
        weights = [4000.0 if d.weekday() != 6 else 0.0 for d in dates]
        series = pd.Series(weights, index=dates)

        df = pd.DataFrame({
            'date': dates,
            'weight_kg': weights,
            'barangay_id': 1,
            'population': 15000.0
        })
        X_df, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
        forecaster = RidgeMultiHorizonForecaster(horizon=7)
        forecaster.fit_and_calibrate(X_df, y_dict, n_cv_splits=2)

        points = forecaster.predict_7_days(
            origin_date=saturday_origin,
            history_weights=series,
            barangay_id=1,
            population=15000.0
        )
        sunday_point = points[0]
        self.assertEqual(date.fromisoformat(sunday_point['date']).weekday(), 6)
        self.assertEqual(sunday_point['expected_kg'], 0.0)
        self.assertEqual(sunday_point['low_kg'], 0.0)

    # 20. Ratio Feature Stability on Zero Denominator (F-06 fix)
    def test_20_ratio_feature_stability(self):
        # When lag_7 is Sunday = 0.0 kg and lag_1 is 5000.0 kg
        history_vals = [5000.0] * 35
        # Set lag_7 (idx -7 = 28) to 0.0 kg
        history_vals[-7] = 0.0
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(35)]
        series = pd.Series(history_vals, index=dates)

        feats = extract_origin_lag_and_rolling_features(series)
        # Without floor, (5000 - 0) / 1e-5 would blow up to 500,000,000.0
        self.assertLessEqual(feats['recent_growth_rate'], 5.0)
        self.assertGreaterEqual(feats['recent_growth_rate'], -5.0)
        self.assertLessEqual(feats['trend_7_vs_28'], 5.0)
        self.assertGreaterEqual(feats['trend_7_vs_28'], -5.0)

    # 21. Chronological Partition Integrity (F-05 & Directive Phase 8 rewrite)
    def test_21_chronological_partition_integrity(self):
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(65)]
        df1 = pd.DataFrame({'date': dates, 'weight_kg': [3000.0] * 65, 'barangay_id': 1, 'population': 10000.0})
        df2 = pd.DataFrame({'date': dates, 'weight_kg': [1500.0] * 65, 'barangay_id': 2, 'population': 5000.0})

        X1, y1 = generate_training_matrix(df1, horizon=7, min_history_required=28)
        X2, y2 = generate_training_matrix(df2, horizon=7, min_history_required=28)
        X_full = HorizonFeatureDict({
            h: pd.concat([X1[h], X2[h]], ignore_index=True)
            for h in range(1, 8)
        })
        y_full = {h: pd.concat([y1[h], y2[h]], ignore_index=True) for h in range(1, 8)}

        forecaster = RidgeMultiHorizonForecaster(horizon=7)
        metrics = forecaster.fit_and_calibrate(X_full, y_full, n_cv_splits=3)
        self.assertIn('calibration_sample_counts', metrics)
        self.assertIn('test_coverage', metrics)

        # Verify strict temporal sequence across partitions
        info = forecaster.partition_info
        train_max_orig = date.fromisoformat(info['train_origin_range'][1])
        cal_min_orig = date.fromisoformat(info['cal_origin_range'][0])
        cal_max_orig = date.fromisoformat(info['cal_origin_range'][1])
        test_min_orig = date.fromisoformat(info['test_origin_range'][0])

        self.assertLess(train_max_orig, cal_min_orig, "Train partition must strictly precede Calibration partition.")
        self.assertLess(cal_max_orig, test_min_orig, "Calibration partition must strictly precede Test partition.")

        # Rejection of shuffled or reversed chronological data
        reversed_df = df1.iloc[::-1].reset_index(drop=True)
        with self.assertRaises(ValueError):
            forecaster.fit_and_calibrate(reversed_df, y_full)

    # 22. Artifact Rollback Detection (F-15 & N-09 fix)
    def test_22_artifact_rollback_detection(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_file = os.path.join(temp_dir, 'waste_forecast_model_latest.joblib')
            meta_file = os.path.join(temp_dir, 'waste_forecast_metadata_latest.json')

            # Version A (Newer timestamp)
            forecaster_a = RidgeMultiHorizonForecaster(horizon=7)
            import joblib
            joblib.dump(forecaster_a, model_file)
            with open(model_file, 'rb') as f:
                sha_a = hashlib.sha256(f.read()).hexdigest()
            meta_a = {
                'model_version': 'v_new',
                'synthetic_records': 0,
                'validation_status': 'PASSED',
                'feature_schema': forecaster_a.feature_names,
                'sha256': sha_a,
            }
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump(meta_a, f)

            _, meta_loaded_1 = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNotNone(meta_loaded_1)
            self.assertEqual(meta_loaded_1['model_version'], 'v_new')

            # Rollback to Version B: write different model with valid metadata but an older mtime
            forecaster_b = RidgeMultiHorizonForecaster(horizon=7)
            joblib.dump(forecaster_b, model_file)
            with open(model_file, 'rb') as f:
                sha_b = hashlib.sha256(f.read()).hexdigest()
            meta_b = {
                'model_version': 'v_rolled_back',
                'synthetic_records': 0,
                'validation_status': 'PASSED',
                'feature_schema': forecaster_b.feature_names,
                'sha256': sha_b,
            }
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump(meta_b, f)
            old_time = time.time() - 1000.0
            os.utime(meta_file, (old_time, old_time))
            os.utime(model_file, (old_time, old_time))

            # Service must detect the mtime change and reload
            _, meta_loaded_2 = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNotNone(meta_loaded_2)
            self.assertEqual(meta_loaded_2['model_version'], 'v_rolled_back')

    # 23. Heuristic Baseline Triangle Bound (F-04 & Directive Phase 8 rewrite)
    def test_23_baseline_triangle_bound(self):
        # Exercises actual production forecast_weight_heuristic
        fc_city = forecast_weight_heuristic(brgy_obj=None, lookback=30)
        fc_brgy = forecast_weight_heuristic(brgy_obj=self.brgy1, lookback=30)

        for fc in [fc_city, fc_brgy]:
            self.assertTrue(fc['sufficient'])
            hist_weights = [h['kg'] for h in fc['history']]
            pred_weights = [p['expected_kg'] for p in fc['points']]

            # Non-negativity
            self.assertTrue(all(v >= 0 for v in pred_weights))
            self.assertTrue(all(p['low_kg'] >= 0 for p in fc['points']))
            self.assertTrue(all(p['high_kg'] >= p['expected_kg'] for p in fc['points']))

            # Triangle inequality bounding
            mean_hist = float(np.mean(hist_weights))
            mean_pred = float(np.mean(pred_weights))
            self.assertLessEqual(mean_pred, max(hist_weights) * 2.0)
            self.assertGreaterEqual(mean_pred, 0.0)

    # 24. Quarantine Synthetic-Trained Artifacts (F-01 fix)
    @override_settings(FORECAST_ML_ENABLED=True)
    def test_24_quarantine_synthetic_artifact(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_file = os.path.join(temp_dir, 'waste_forecast_model_latest.joblib')
            meta_file = os.path.join(temp_dir, 'waste_forecast_metadata_latest.json')

            forecaster = RidgeMultiHorizonForecaster(horizon=7)
            forecaster.is_fitted = True
            import joblib
            joblib.dump(forecaster, model_file)
            with open(model_file, 'rb') as f:
                sha = hashlib.sha256(f.read()).hexdigest()

            # Mark synthetic_records > 0 in metadata
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'v_synthetic_test',
                    'synthetic_records': 163,
                    'sha256': sha,
                    'validation_status': 'PASSED',
                    'feature_schema': forecaster.feature_names,
                    'validation_metrics': {'overall_mae': 1500.0}
                }, f)

            fc = get_waste_forecast(brgy_obj=None, artifacts_dir=temp_dir)
            self.assertEqual(fc['model_type'], 'heuristic')
            self.assertTrue(fc['is_fallback'])
            self.assertIn("quarantined", fc.get('fallback_reason', '').lower())

    # 25. Horizon-Specific Feature Alignment (N-01)
    def test_25_horizon_specific_calendar_features(self):
        start_d = date(2026, 2, 1)
        dates = [start_d + timedelta(days=i) for i in range(60)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [2500.0 + (i % 7) * 200.0 for i in range(60)],
            'barangay_id': 1,
            'population': 15000.0,
        })
        X_dict, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)

        self.assertIsInstance(X_dict, HorizonFeatureDict)

        for h in range(1, 8):
            X_h = X_dict[h]
            self.assertIn('origin_date', X_h.columns)
            self.assertIn('target_sin_dow', X_h.columns)
            self.assertIn('target_cos_dow', X_h.columns)
            for excluded_col in [
                'target_day_of_week',
                'target_day_of_month',
                'target_sin_month',
                'target_cos_month',
                'target_sin_week',
                'target_cos_week',
            ]:
                self.assertNotIn(excluded_col, X_h.columns)

            for _, row in X_h.iterrows():
                orig_raw = row['origin_date']
                orig_d = date.fromisoformat(orig_raw) if isinstance(orig_raw, str) else orig_raw
                expected_target_d = orig_d + timedelta(days=h)
                expected_dow = expected_target_d.weekday()
                self.assertAlmostEqual(
                    row['target_sin_dow'],
                    math.sin(2.0 * math.pi * expected_dow / 7.0),
                    places=6,
                    msg=f"Horizon h={h}: target_sin_dow must match (origin + {h}) weekday harmonic."
                )
                self.assertAlmostEqual(
                    row['target_cos_dow'],
                    math.cos(2.0 * math.pi * expected_dow / 7.0),
                    places=6,
                    msg=f"Horizon h={h}: target_cos_dow must match (origin + {h}) weekday harmonic."
                )
                self.assertEqual(
                    row['target_is_sunday'],
                    1.0 if expected_dow == 6 else 0.0
                )
                self.assertEqual(
                    row['target_is_month_start'],
                    1.0 if expected_target_d.day == 1 else 0.0
                )
                self.assertEqual(
                    row['target_is_month_end'],
                    1.0 if (expected_target_d + timedelta(days=1)).day == 1 else 0.0
                )

    # 26. Strict Seven-Day Embargo Isolation (N-02 & Directive Phase 8 rewrite)
    def test_26_strict_seven_day_embargo_isolation(self):
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(70)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [3000.0] * 70,
            'barangay_id': 1,
            'population': 10000.0,
        })
        X_dict, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
        forecaster = RidgeMultiHorizonForecaster(horizon=7)
        forecaster.fit_and_calibrate(X_dict, y_dict, n_cv_splits=3)

        info = forecaster.partition_info
        self.assertIsNotNone(info)

        train_max_orig = date.fromisoformat(info['train_origin_range'][1])
        cal_min_orig = date.fromisoformat(info['cal_origin_range'][0])
        cal_max_orig = date.fromisoformat(info['cal_origin_range'][1])
        test_min_orig = date.fromisoformat(info['test_origin_range'][0])

        # Embargo gap >= 7 calendar days between origins
        self.assertGreaterEqual((cal_min_orig - train_max_orig).days, 7)
        self.assertGreaterEqual((test_min_orig - cal_max_orig).days, 7)

        # Target date ranges must NEVER overlap
        train_max_target = date.fromisoformat(info['train_target_range'][1])
        cal_min_target = date.fromisoformat(info['cal_target_range'][0])
        cal_max_target = date.fromisoformat(info['cal_target_range'][1])
        test_min_target = date.fromisoformat(info['test_target_range'][0])

        self.assertLess(train_max_target, cal_min_target, "Train targets must not overlap Calibration targets.")
        self.assertLess(cal_max_target, test_min_target, "Calibration targets must not overlap Test targets.")

        # Rejection of insufficient chronological data (<21 distinct dates)
        short_df = pd.DataFrame({
            'date': dates[:15],
            'weight_kg': [3000.0] * 15,
            'barangay_id': 1,
            'population': 10000.0,
        })
        with self.assertRaises(ValueError):
            forecaster.fit_and_calibrate(short_df, y_dict)

    # 27. Fail-Closed Artifact Governance (N-03)
    def test_27_fail_closed_artifact_governance(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_file = os.path.join(temp_dir, 'waste_forecast_model_latest.joblib')
            meta_file = os.path.join(temp_dir, 'waste_forecast_metadata_latest.json')

            dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(60)]
            df = pd.DataFrame({
                'date': dates,
                'weight_kg': [4000.0 + (i % 7) * 200.0 for i in range(60)],
                'barangay_id': 1,
                'population': 12000.0,
            })
            X_dict, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
            forecaster = RidgeMultiHorizonForecaster(horizon=7)
            forecaster.fit_and_calibrate(X_dict, y_dict, n_cv_splits=3)
            import joblib
            joblib.dump(forecaster, model_file)
            with open(model_file, 'rb') as f:
                valid_sha = hashlib.sha256(f.read()).hexdigest()

            # Case 1: Missing metadata file
            fc, meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(fc)
            self.assertIsNone(meta)

            # Case 2: Missing sha256 key
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump({'model_version': 'v1', 'synthetic_records': 0, 'validation_status': 'PASSED'}, f)
            fc, meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(fc)

            # Case 3: SHA256 digest mismatch
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'v1',
                    'synthetic_records': 0,
                    'validation_status': 'PASSED',
                    'feature_schema': forecaster.feature_names,
                    'sha256': '0' * 64
                }, f)
            fc, meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(fc)

            # Case 4: Incomplete subset feature schema
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'v1',
                    'synthetic_records': 0,
                    'validation_status': 'PASSED',
                    'feature_schema': ['population'],
                    'sha256': valid_sha
                }, f)
            fc, meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(fc)

            # Case 4b: Stale superset feature schema (e.g., containing deferred/removed features)
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'v1_stale_superset',
                    'synthetic_records': 0,
                    'validation_status': 'PASSED',
                    'feature_schema': forecaster.feature_names + ['target_sin_month', 'target_day_of_month'],
                    'sha256': valid_sha
                }, f)
            fc, meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(fc)

            # Case 4c: Reordered feature schema must fail closed
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'v1_reordered',
                    'synthetic_records': 0,
                    'validation_status': 'PASSED',
                    'feature_schema': list(reversed(forecaster.feature_names)),
                    'sha256': valid_sha
                }, f)
            fc, meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(fc)

            # Case 4d: Deserialized forecaster.feature_names mismatching active schema must fail closed
            stale_model_file = os.path.join(temp_dir, 'waste_forecast_model_stale_obj.joblib')
            stale_forecaster = RidgeMultiHorizonForecaster(horizon=7)
            stale_forecaster.feature_names = forecaster.feature_names + ['target_sin_month']
            joblib.dump(stale_forecaster, stale_model_file)
            with open(stale_model_file, 'rb') as f:
                stale_sha = hashlib.sha256(f.read()).hexdigest()
            with open(os.path.join(temp_dir, 'active_manifest.json'), 'w', encoding='utf-8') as mf:
                json.dump({
                    'active_model_file': 'waste_forecast_model_stale_obj.joblib',
                    'active_metadata_file': 'waste_forecast_metadata_latest.json',
                }, mf)
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'v1_stale_obj',
                    'synthetic_records': 0,
                    'validation_status': 'PASSED',
                    'feature_schema': forecaster.feature_names,
                    'sha256': stale_sha
                }, f)
            fc, meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(fc)
            os.remove(os.path.join(temp_dir, 'active_manifest.json'))

            # Case 4e: Candidate loader also rejects stale superset feature_schema
            cand_manifest_file = os.path.join(temp_dir, 'candidate_manifest.json')
            with open(cand_manifest_file, 'w', encoding='utf-8') as cmf:
                json.dump({
                    'candidate_model_file': 'waste_forecast_model_latest.joblib',
                    'candidate_metadata_file': 'waste_forecast_metadata_latest.json',
                }, cmf)
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'v1_cand_stale',
                    'synthetic_records': 0,
                    'validation_status': 'PASSED',
                    'feature_schema': forecaster.feature_names + ['target_sin_week'],
                    'sha256': valid_sha
                }, f)
            c_fc, c_meta = load_candidate_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(c_fc)
            os.remove(cand_manifest_file)

            # Case 5: Valid complete metadata with exact active schema loads successfully
            with open(meta_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'v1',
                    'synthetic_records': 0,
                    'validation_status': 'PASSED',
                    'feature_schema': forecaster.feature_names,
                    'sha256': valid_sha
                }, f)
            fc, meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNotNone(fc)
            self.assertEqual(meta['model_version'], 'v1')
            self.assertEqual(fc.feature_names, NUMERIC_FEATURES + CATEGORICAL_FEATURES)

    # 28. Shadow Prediction Persistence, City Uniqueness, and Immutability (Directive Phase 8 rewrite)
    def test_28_shadow_prediction_persistence_and_deduplication(self):
        from django.db import IntegrityError
        origin_d = timezone.localdate() - timedelta(days=2)
        target_d = origin_d + timedelta(days=1)

        # 1. City-Wide record creation with non-null series_id='city'
        sp_city = ShadowForecastPrediction.objects.create(
            origin_date=origin_d,
            target_date=target_d,
            horizon_step=1,
            barangay=None,
            series_id='city',
            model_type='ridge',
            model_version='test_shadow_v1',
            expected_kg=5000.0,
            heuristic_expected_kg=4800.0
        )
        self.assertEqual(sp_city.series_id, 'city')

        # 2. Database-level uniqueness check for City-Wide (series_id='city')
        with transaction.atomic():
            with self.assertRaises(IntegrityError):
                ShadowForecastPrediction.objects.create(
                    origin_date=origin_d,
                    target_date=target_d,
                    horizon_step=1,
                    barangay=None,
                    series_id='city',
                    model_version='test_shadow_v1',
                    expected_kg=5100.0,
                    heuristic_expected_kg=4800.0
                )

        # 3. Immutability check: Attempting to mutate forecast values must raise ValueError
        sp_city.expected_kg = 9999.0
        with self.assertRaises(ValueError) as ctx:
            sp_city.save()
        self.assertIn("immutable", str(ctx.exception).lower())

        # 4. Command execution deduplication: running record_shadow_forecast command does not duplicate
        call_command('record_shadow_forecast', origin_date=str(origin_d))
        call_command('record_shadow_forecast', origin_date=str(origin_d))
        self.assertEqual(
            ShadowForecastPrediction.objects.filter(
                origin_date=origin_d,
                horizon_step=1,
                series_id='city',
                model_version='heuristic_baseline'
            ).count(),
            1
        )

    # 29. Heuristic Serving and Baseline Consistency (Directive Phase 8 rewrite)
    def test_29_heuristic_serving_and_baseline_consistency(self):
        fc = forecast_weight_heuristic(brgy_obj=self.brgy1, lookback=30, horizon=7)
        self.assertTrue(fc['sufficient'])
        self.assertEqual(fc['model_type'], 'heuristic')
        self.assertEqual(len(fc['points']), 7)

        # Verify exact equivalence between heuristic history and canonical aggregation
        today = timezone.localdate()
        yesterday = today - timedelta(days=1)
        history_start = yesterday - timedelta(days=13)
        daily_df = build_daily_aggregation(history_start, yesterday, barangay_id=self.brgy1.id, fill_zeros=True)

        fc_history_by_date = {h['date']: h['kg'] for h in fc['history']}
        for _, row in daily_df.iterrows():
            d_str = str(row['date'])
            if d_str in fc_history_by_date:
                self.assertEqual(
                    fc_history_by_date[d_str],
                    round(row['weight_kg']),
                    f"Date {d_str}: heuristic history does not match canonical aggregation."
                )

        prov = fc.get('provenance', {})
        self.assertIn('Uncalibrated', prov.get('interval_method', ''))
        self.assertEqual(prov.get('aggregation_engine'), 'canonical_daily_aggregation')

    # 30. Nested Alpha Selection Isolation (Directive Phase 8 rewrite)
    def test_30_nested_alpha_selection_isolation(self):
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(70)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [3000.0 + (i % 5) * 100.0 for i in range(70)],
            'barangay_id': 1,
            'population': 10000.0,
        })
        X_dict, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
        forecaster = RidgeMultiHorizonForecaster(horizon=7)
        metrics = forecaster.fit_and_calibrate(X_dict, y_dict)

        self.assertIn('best_alphas', metrics)
        for h in range(1, 8):
            self.assertIn(h, metrics['best_alphas'])
            self.assertIn(metrics['best_alphas'][h], [0.1, 1.0, 10.0, 50.0, 100.0, 500.0])

    # 31. Unmeasured Test Coverage Null (N-07)
    def test_31_unmeasured_test_coverage_null(self):
        dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(60)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [2000.0] * 60,
            'barangay_id': 1,
            'population': 5000.0,
        })
        X_dict, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
        forecaster = RidgeMultiHorizonForecaster(horizon=7)
        metrics = forecaster.fit_and_calibrate(X_dict, y_dict)

        for h in range(1, 8):
            test_count = metrics['test_sample_counts'].get(h, 0)
            if test_count < 15:
                self.assertIsNone(
                    metrics['test_coverage'][h],
                    f"Horizon h={h}: test coverage must be None when test samples ({test_count}) < 15."
                )

    # 32. Sunday Scheduled Collection Behavior (Directive Phase 8 rewrite)
    def test_32_sunday_scheduled_collection_behavior(self):
        sunday_d = date(2026, 11, 8)  # Sunday
        self.assertEqual(sunday_d.weekday(), 6)

        # Case 1: Active Sunday schedule -> SCHEDULED
        sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            start_time="08:00:00",
            end_time="12:00:00",
            days="Sunday",
            status="PENDING"
        )
        sched.barangays.set([self.brgy1])
        status_active = check_collection_schedule(sunday_d, self.brgy1.id)
        self.assertEqual(status_active, ScheduleStatus.SCHEDULED)

        # Case 2: Inactive truck -> CONFIRMED_NON_COLLECTION
        self.truck.status = "inactive"
        self.truck.save()
        status_inactive = check_collection_schedule(sunday_d, self.brgy1.id)
        self.assertEqual(status_inactive, ScheduleStatus.CONFIRMED_NON_COLLECTION)
        self.truck.status = "active"
        self.truck.save()

        # Case 3: Cancelled schedule -> CONFIRMED_NON_COLLECTION
        sched.status = "CANCELLED"
        sched.save()
        status_cancelled = check_collection_schedule(sunday_d, self.brgy1.id)
        self.assertEqual(status_cancelled, ScheduleStatus.CONFIRMED_NON_COLLECTION)

        # Case 4: Substring matching safety: "Sundown" or "Sunny" must NOT match Sunday
        sched_sub = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            start_time="08:00:00",
            end_time="12:00:00",
            days="Sundown Route, Mon, Wed",
            status="PENDING"
        )
        sched_sub.barangays.set([self.brgy1])
        status_sub = check_collection_schedule(sunday_d, self.brgy1.id)
        self.assertEqual(status_sub, ScheduleStatus.CONFIRMED_NON_COLLECTION)
        sched_sub.delete()

        # Case 5: Fail-safe error handling: Database exception must return UNKNOWN, not non-collection
        from unittest.mock import patch
        with patch('driver.models.CollectionSchedule.objects.filter', side_effect=Exception("Database down")):
            status_err = check_collection_schedule(sunday_d, self.brgy1.id)
            self.assertEqual(status_err, ScheduleStatus.UNKNOWN)

    # 33. Fail-Closed Artifact Validation and Atomic Manifest Rollback (N-09)
    def test_33_atomic_manifest_rollback(self):
        """
        Verifies that rollback_forecast_model:
        1. Correctly rejects unvalidated/ineligible/unfitted artifacts without modifying active manifest.
        2. Successfully rolls back and atomically updates active_manifest.json when target artifact is valid.
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            import joblib
            m1_path = os.path.join(temp_dir, 'waste_forecast_model_ridge_v1.joblib')
            meta1_path = os.path.join(temp_dir, 'waste_forecast_metadata_ridge_v1.json')
            manifest_path = os.path.join(temp_dir, 'active_manifest.json')

            # Initial active manifest
            with open(manifest_path, 'w', encoding='utf-8') as mf:
                json.dump({
                    'active_model_file': 'waste_forecast_model_current.joblib',
                    'active_metadata_file': 'waste_forecast_metadata_current.json',
                    'model_version': 'current_v0',
                    'sha256': '0' * 64
                }, mf, indent=2)

            # Case A: Reject target missing 'feature_schema' (assert rejection, no fail-open bypass)
            f_unfitted = RidgeMultiHorizonForecaster(horizon=7)
            joblib.dump(f_unfitted, m1_path)
            with open(m1_path, 'rb') as f:
                sha1 = hashlib.sha256(f.read()).hexdigest()
            with open(meta1_path, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'ridge_v1',
                    'synthetic_records': 0,
                    'validation_status': 'PASSED',
                    'sha256': sha1
                }, f)

            with self.assertRaises(CommandError) as ctx:
                call_command('rollback_forecast_model', artifacts_dir=temp_dir, target_version='ridge_v1')
            self.assertIn("missing mandatory 'feature_schema'", str(ctx.exception).lower())

            # Active manifest must remain untouched
            with open(manifest_path, 'r', encoding='utf-8') as mf:
                manifest_check = json.load(mf)
            self.assertEqual(manifest_check['active_model_file'], 'waste_forecast_model_current.joblib')

            # Case B: Rollback succeeds when target has valid metadata, matching schema, and properly fitted pipelines
            dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(60)]
            df = pd.DataFrame({
                'date': dates,
                'weight_kg': [4000.0 + (i % 7) * 200.0 for i in range(60)],
                'barangay_id': 1,
                'population': 12000.0,
            })
            X_dict, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
            f_valid = RidgeMultiHorizonForecaster(horizon=7)
            f_valid.fit_and_calibrate(X_dict, y_dict, n_cv_splits=3)
            joblib.dump(f_valid, m1_path)
            with open(m1_path, 'rb') as f:
                sha_valid = hashlib.sha256(f.read()).hexdigest()

            with open(meta1_path, 'w', encoding='utf-8') as f:
                json.dump({
                    'model_version': 'ridge_v1',
                    'synthetic_records': 0,
                    'validation_status': 'PASSED',
                    'feature_schema': f_valid.feature_names,
                    'sha256': sha_valid
                }, f)

            call_command('rollback_forecast_model', artifacts_dir=temp_dir, target_version='ridge_v1')

            self.assertTrue(os.path.exists(manifest_path))
            with open(manifest_path, 'r', encoding='utf-8') as mf:
                manifest = json.load(mf)
            self.assertEqual(manifest['active_model_file'], 'waste_forecast_model_ridge_v1.joblib')
            self.assertEqual(manifest['model_version'], 'ridge_v1')
            self.assertEqual(manifest['sha256'], sha_valid)

    # 34. Distinct Genuine Days Eligibility (Directive Phase 8 rewrite)
    def test_34_distinct_genuine_days_eligibility(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            # Setup only has 60 genuine days; force promotion must fail
            with self.assertRaises(CommandError) as ctx:
                call_command(
                    'train_waste_forecast',
                    lookback=60,
                    force_promote=True,
                    output_dir=temp_dir
                )
            self.assertIn("insufficient genuine data", str(ctx.exception).lower())
            manifest_path = os.path.join(temp_dir, 'active_manifest.json')
            self.assertFalse(os.path.exists(manifest_path))

    # 35. Sparse Barangay Heuristic Fallback (Directive Phase 8 rewrite)
    @override_settings(FORECAST_ML_ENABLED=True)
    def test_35_sparse_barangay_heuristic_fallback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            call_command('train_waste_forecast', lookback=60, output_dir=temp_dir)
            # Create active_manifest.json pointing to the trained candidate model
            cand_manifest_path = os.path.join(temp_dir, 'candidate_manifest.json')
            with open(cand_manifest_path, 'r', encoding='utf-8') as f:
                c_meta = json.load(f)

            active_manifest_path = os.path.join(temp_dir, 'active_manifest.json')
            with open(active_manifest_path, 'w', encoding='utf-8') as f:
                json.dump({
                    'active_model_file': c_meta['candidate_model_file'],
                    'active_metadata_file': c_meta['candidate_metadata_file'],
                    'model_version': c_meta['model_version'],
                    'sha256': c_meta['sha256']
                }, f)

            # Ensure metadata validation_status is PASSED for loading
            cand_meta_file = os.path.join(temp_dir, c_meta['candidate_metadata_file'])
            with open(cand_meta_file, 'r', encoding='utf-8') as f:
                meta_json = json.load(f)
            meta_json['validation_status'] = 'PASSED'
            with open(cand_meta_file, 'w', encoding='utf-8') as f:
                json.dump(meta_json, f)

            sparse_brgy = self.brgy3  # has 0 deliveries in test setup (<28 active days)
            fc = get_waste_forecast(brgy_obj=sparse_brgy, artifacts_dir=temp_dir)
            self.assertEqual(fc['model_type'], 'heuristic')
            self.assertTrue(fc['is_fallback'])
            self.assertIn("operating on seasonal heuristic", fc.get('fallback_reason', '').lower())

    # 36. Phase 1 Mandatory Test: Multi-Delivery Daily Aggregation Sum (Fix T-01)
    def test_36_multi_delivery_same_date_aggregation(self):
        """
        MANDATORY T-01 REGRESSION TEST:
        Three deliveries of 4,000 kg, 6,000 kg, and 5,000 kg on the same date
        MUST produce an exact 15,000 kg daily total in canonical daily aggregation,
        in the public heuristic baseline, and in the live analytics payload.
        """
        test_date = timezone.localdate() - timedelta(days=5)

        # Clear existing deliveries on test_date to establish a clean benchmark
        WasteDelivery.objects.filter(date=test_date).delete()

        # Create Delivery A: 4,000 kg
        deliv_a = WasteDelivery.objects.create(
            truck=self.truck,
            driver=self.driver,
            dumpsite=self.dumpsite,
            date=test_date,
            gross_weight=8000.0,
            tare_weight=4000.0,
            estimated_kg=4000.0,
            is_validated=True,
            is_synthetic=False
        )
        deliv_a.barangays.set([self.brgy1])

        # Create Delivery B: 6,000 kg
        deliv_b = WasteDelivery.objects.create(
            truck=self.truck,
            driver=self.driver,
            dumpsite=self.dumpsite,
            date=test_date,
            gross_weight=10000.0,
            tare_weight=4000.0,
            estimated_kg=6000.0,
            is_validated=True,
            is_synthetic=False
        )
        deliv_b.barangays.set([self.brgy1])

        # Create Delivery C: 5,000 kg
        deliv_c = WasteDelivery.objects.create(
            truck=self.truck,
            driver=self.driver,
            dumpsite=self.dumpsite,
            date=test_date,
            gross_weight=9000.0,
            tare_weight=4000.0,
            estimated_kg=5000.0,
            is_validated=True,
            is_synthetic=False
        )
        deliv_c.barangays.set([self.brgy1])

        # 1. Canonical Daily Aggregation Check
        df_agg = build_daily_aggregation(test_date, test_date, barangay_id=self.brgy1.id, fill_zeros=False)
        self.assertEqual(len(df_agg), 1)
        daily_total = float(df_agg['weight_kg'].iloc[0])
        deliv_count = int(df_agg['delivery_count'].iloc[0])

        self.assertEqual(deliv_count, 3, "All 3 delivery rows must be counted.")
        self.assertEqual(
            daily_total,
            15000.0,
            f"Daily total must be exactly 15,000.0 kg (got {daily_total} kg). T-01 defect!"
        )

        # 2. Production Heuristic Baseline Check
        fc = forecast_weight_heuristic(brgy_obj=self.brgy1, lookback=30)
        self.assertTrue(fc['sufficient'])
        history_map = {h['date']: h['kg'] for h in fc['history']}

        self.assertIn(str(test_date), history_map, "Test date must be present in heuristic history.")
        self.assertEqual(
            history_map[str(test_date)],
            15000,
            f"Heuristic history for {test_date} must be 15,000 kg (got {history_map[str(test_date)]} kg)."
        )

        # 3. Live API Payload Check
        payload = build_live_payload(
            date_from=test_date - timedelta(days=7),
            date_to=timezone.localdate(),
            brgy_obj=self.brgy1
        )
        api_forecast = payload.get('forecast', {})
        self.assertTrue(api_forecast.get('sufficient'))
        api_history_map = {h['date']: h['kg'] for h in api_forecast.get('history', [])}
        self.assertEqual(
            api_history_map.get(str(test_date)),
            15000,
            f"Live API payload forecast history must show 15,000 kg (got {api_history_map.get(str(test_date))})."
        )

    # 37. Multi-Barangay Shared Route Proportional Allocation (Directive Phase 1 & 7)
    def test_37_shared_route_proportional_allocation(self):
        test_date = timezone.localdate() - timedelta(days=6)
        WasteDelivery.objects.filter(date=test_date).delete()

        # Shared delivery: 10,000 kg serving Barangay 1 and Barangay 2
        shared_deliv = WasteDelivery.objects.create(
            truck=self.truck,
            driver=self.driver,
            dumpsite=self.dumpsite,
            date=test_date,
            gross_weight=14000.0,
            tare_weight=4000.0,
            estimated_kg=10000.0,
            is_validated=True,
            is_synthetic=False
        )
        shared_deliv.barangays.set([self.brgy1, self.brgy2])

        # City-wide total receives 10,000 kg
        city_df = build_daily_aggregation(test_date, test_date, barangay_id=None)
        self.assertEqual(city_df['weight_kg'].iloc[0], 10000.0)

        # Barangay 1 receives proportional share (10,000 / 2 = 5,000 kg)
        b1_df = build_daily_aggregation(test_date, test_date, barangay_id=self.brgy1.id)
        self.assertEqual(b1_df['weight_kg'].iloc[0], 5000.0)

        # Barangay 2 receives proportional share (10,000 / 2 = 5,000 kg)
        b2_df = build_daily_aggregation(test_date, test_date, barangay_id=self.brgy2.id)
        self.assertEqual(b2_df['weight_kg'].iloc[0], 5000.0)

        # Sum of barangay allocations matches city total
        self.assertEqual(b1_df['weight_kg'].iloc[0] + b2_df['weight_kg'].iloc[0], city_df['weight_kg'].iloc[0])

    # 38. Phase 2 Mandatory Test: City Population Train/Serve Alignment (Fix T-02)
    def test_38_city_population_train_serve_alignment(self):
        canonical_pop = get_canonical_city_population()
        self.assertGreater(canonical_pop, 0.0)

        # Verify serving uses canonical population when brgy_obj is None
        today = timezone.localdate()
        yesterday = today - timedelta(days=1)
        history_series = pd.Series([4000.0] * 30, index=[yesterday - timedelta(days=i) for i in range(30)][::-1])

        feat_vector = build_feature_vector_for_origin(
            origin_date=yesterday,
            target_date=today,
            history_weights=history_series,
            barangay_id=0,
            population=canonical_pop
        )
        self.assertEqual(feat_vector['population'], canonical_pop)
        self.assertNotEqual(feat_vector['population'], 0.0, "City population must not be 0.0 (T-02 train/serve skew).")

    # 39. Candidate Artifact Registration for Shadow Mode (Directive Phase 4)
    def test_39_shadow_candidate_registration(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            # Training without --force-promote creates candidate_manifest.json
            call_command('train_waste_forecast', lookback=60, output_dir=temp_dir)

            candidate_manifest = os.path.join(temp_dir, 'candidate_manifest.json')
            self.assertTrue(os.path.exists(candidate_manifest), "candidate_manifest.json must be registered.")
            with open(candidate_manifest, 'r', encoding='utf-8') as f:
                c_meta = json.load(f)
            self.assertTrue(c_meta.get('is_shadow_candidate'))
            self.assertFalse(c_meta.get('is_promotion_eligible'))

            # Verify load_candidate_forecaster loads this candidate
            c_forecaster, c_metadata = load_candidate_forecaster(artifacts_dir=temp_dir)
            self.assertIsNotNone(c_forecaster)
            self.assertTrue(c_forecaster.is_fitted)

    # 40. Shadow Grace Period and Backfill Data Quality (Directive Phase 4)
    def test_40_shadow_grace_period_and_actuals(self):
        today = timezone.localdate()
        target_in_grace = today - timedelta(days=1)  # 1 day ago < GRACE_PERIOD_DAYS (2)

        sp = ShadowForecastPrediction.objects.create(
            origin_date=today - timedelta(days=2),
            target_date=target_in_grace,
            horizon_step=1,
            barangay=self.brgy1,
            series_id=f"brgy_{self.brgy1.id}",
            model_type='heuristic',
            model_version='heuristic_baseline',
            heuristic_expected_kg=3000.0,
            actual_data_status='PENDING'
        )

        call_command('record_shadow_forecast', backfill_actuals=True)
        sp.refresh_from_db()
        # Inside grace period without ticket entered -> marked GRACE_PERIOD, not 0 kg actual!
        self.assertEqual(sp.actual_data_status, 'GRACE_PERIOD')
        self.assertFalse(sp.is_actual_complete)

    # 41. Calendar Feature Test: Saturday and Sunday Cyclical Adjacency
    def test_41_saturday_sunday_cyclical_adjacency(self):
        sat_date = date(2026, 10, 17)  # Saturday (dow=5)
        sun_date = date(2026, 10, 18)  # Sunday (dow=6)
        mon_date = date(2026, 10, 19)  # Monday (dow=0)

        sat_feats = extract_calendar_features(sat_date)
        sun_feats = extract_calendar_features(sun_date)
        mon_feats = extract_calendar_features(mon_date)

        # Confirm 0-6 weekday angular phase convention (0=Monday -> 0 rad, 5=Saturday -> 10*pi/7, 6=Sunday -> 12*pi/7)
        def recover_dow_idx(f_dict):
            angle = math.atan2(f_dict['target_sin_dow'], f_dict['target_cos_dow']) % (2.0 * math.pi)
            return round(angle * 7.0 / (2.0 * math.pi)) % 7

        self.assertEqual(recover_dow_idx(sat_feats), 5)
        self.assertEqual(recover_dow_idx(sun_feats), 6)
        self.assertEqual(recover_dow_idx(mon_feats), 0)

        # Euclidean distance on unit circle of period 7: 2 * sin(pi / 7) approx 0.867767
        expected_adj_dist = 2.0 * math.sin(math.pi / 7.0)

        sat_vec = np.array([sat_feats['target_sin_dow'], sat_feats['target_cos_dow']])
        sun_vec = np.array([sun_feats['target_sin_dow'], sun_feats['target_cos_dow']])
        mon_vec = np.array([mon_feats['target_sin_dow'], mon_feats['target_cos_dow']])

        dist_sat_sun = float(np.linalg.norm(sat_vec - sun_vec))
        dist_sun_mon = float(np.linalg.norm(sun_vec - mon_vec))

        self.assertAlmostEqual(dist_sat_sun, expected_adj_dist, places=5)
        self.assertAlmostEqual(dist_sun_mon, expected_adj_dist, places=5)
        self.assertAlmostEqual(dist_sat_sun, dist_sun_mon, places=5)

    # 42. Calendar Feature Test: Deferred Month Harmonics December/January Adjacency & Active Exclusion
    def test_42_december_january_cyclical_adjacency(self):
        from forecasting.features import extract_deferred_calendar_harmonics

        dec_date = date(2025, 12, 15)  # December (month=12, month_idx=11)
        jan_date = date(2026, 1, 15)   # January (month=1, month_idx=0)
        feb_date = date(2026, 2, 15)   # February (month=2, month_idx=1)

        # Active extractor must NOT emit deferred month harmonics
        for d in (dec_date, jan_date, feb_date):
            active_f = extract_calendar_features(d)
            self.assertNotIn('target_sin_month', active_f)
            self.assertNotIn('target_cos_month', active_f)

        dec_feats = extract_deferred_calendar_harmonics(dec_date)
        jan_feats = extract_deferred_calendar_harmonics(jan_date)
        feb_feats = extract_deferred_calendar_harmonics(feb_date)

        # Confirm 0-11 month phase convention (January=0 -> 0 rad, February=1 -> pi/6, December=11 -> 11*pi/6)
        def recover_month_idx(f_dict):
            angle = math.atan2(f_dict['target_sin_month'], f_dict['target_cos_month']) % (2.0 * math.pi)
            return round(angle * 12.0 / (2.0 * math.pi)) % 12

        self.assertEqual(recover_month_idx(dec_feats), 11)
        self.assertEqual(recover_month_idx(jan_feats), 0)
        self.assertEqual(recover_month_idx(feb_feats), 1)

        # Euclidean distance on unit circle of period 12: 2 * sin(pi / 12) approx 0.517638
        expected_month_dist = 2.0 * math.sin(math.pi / 12.0)

        dec_vec = np.array([dec_feats['target_sin_month'], dec_feats['target_cos_month']])
        jan_vec = np.array([jan_feats['target_sin_month'], jan_feats['target_cos_month']])
        feb_vec = np.array([feb_feats['target_sin_month'], feb_feats['target_cos_month']])

        dist_dec_jan = float(np.linalg.norm(dec_vec - jan_vec))
        dist_jan_feb = float(np.linalg.norm(jan_vec - feb_vec))

        self.assertAlmostEqual(dist_dec_jan, expected_month_dist, places=5)
        self.assertAlmostEqual(dist_jan_feb, expected_month_dist, places=5)
        self.assertAlmostEqual(dist_dec_jan, dist_jan_feb, places=5)

    # 43. Calendar Feature Test: All Seven Weekdays Have Distinct Valid Encodings
    def test_43_all_seven_weekdays_distinct_encodings(self):
        base_monday = date(2026, 10, 19)  # Monday
        encodings = []
        labels = []

        for offset in range(7):
            d = base_monday + timedelta(days=offset)
            feats = extract_calendar_features(d)
            sin_val = feats['target_sin_dow']
            cos_val = feats['target_cos_dow']

            angle = math.atan2(sin_val, cos_val) % (2.0 * math.pi)
            recovered_dow = round(angle * 7.0 / (2.0 * math.pi)) % 7
            self.assertEqual(recovered_dow, offset)

            # Unit norm verification
            self.assertAlmostEqual(sin_val**2 + cos_val**2, 1.0, places=5)
            encodings.append((round(sin_val, 6), round(cos_val, 6)))
            labels.append(offset)

        # Assert all 7 (sin, cos) pairs are strictly distinct
        self.assertEqual(len(set(encodings)), 7, "All seven weekdays must possess distinct cyclical coordinates.")

    # 44. Calendar Feature Test: Deferred Month Harmonics Distinctness Across 12 Months
    def test_44_all_twelve_months_distinct_encodings(self):
        from forecasting.features import extract_deferred_calendar_harmonics

        encodings = []
        for m in range(1, 13):
            d = date(2026, m, 15)
            self.assertNotIn('target_sin_month', extract_calendar_features(d))
            feats = extract_deferred_calendar_harmonics(d)
            sin_val = feats['target_sin_month']
            cos_val = feats['target_cos_month']

            angle = math.atan2(sin_val, cos_val) % (2.0 * math.pi)
            recovered_m_idx = round(angle * 12.0 / (2.0 * math.pi)) % 12
            self.assertEqual(recovered_m_idx, m - 1)

            # Unit norm verification
            self.assertAlmostEqual(sin_val**2 + cos_val**2, 1.0, places=5)
            encodings.append((round(sin_val, 6), round(cos_val, 6)))

        # Assert all 12 (sin, cos) pairs are strictly distinct
        self.assertEqual(len(set(encodings)), 12, "All twelve months must possess distinct cyclical coordinates.")

    # 45. Calendar Feature Test: Year-Boundary and Leap-Year Cases (Active & Deferred)
    def test_45_year_boundary_and_leap_year_cases(self):
        from forecasting.features import extract_deferred_calendar_harmonics

        def recover_iso_week(f_dict, total_weeks):
            angle = math.atan2(f_dict['target_sin_week'], f_dict['target_cos_week']) % (2.0 * math.pi)
            week_idx = round(angle * float(total_weeks) / (2.0 * math.pi)) % total_weeks
            return week_idx + 1

        def recover_month(f_dict):
            angle = math.atan2(f_dict['target_sin_month'], f_dict['target_cos_month']) % (2.0 * math.pi)
            return (round(angle * 12.0 / (2.0 * math.pi)) % 12) + 1

        # Case A: Active month-end / month-start across Leap Year vs Non-Leap Year
        feb_28_leap = date(2024, 2, 28)
        leap_day = date(2024, 2, 29)
        mar_01_leap = date(2024, 3, 1)

        f_feb28_leap = extract_calendar_features(feb_28_leap)
        leap_feats = extract_calendar_features(leap_day)
        f_mar01_leap = extract_calendar_features(mar_01_leap)

        self.assertNotIn('target_day_of_month', leap_feats)
        self.assertEqual(f_feb28_leap['target_is_month_end'], 0.0)
        self.assertEqual(leap_feats['target_is_month_end'], 1.0)
        self.assertEqual(leap_feats['target_is_month_start'], 0.0)
        self.assertEqual(f_mar01_leap['target_is_month_start'], 1.0)
        self.assertEqual(f_mar01_leap['target_is_month_end'], 0.0)

        non_leap_day = date(2023, 2, 28)
        non_leap_feats = extract_calendar_features(non_leap_day)
        self.assertNotIn('target_day_of_month', non_leap_feats)
        self.assertEqual(non_leap_feats['target_is_month_end'], 1.0)

        # Case B: Active year-boundary operational indicators & weekday continuity (Sun 2023-12-31 -> Mon 2024-01-01)
        dec_31_2023 = date(2023, 12, 31)
        jan_01_2024 = date(2024, 1, 1)

        act_dec_23 = extract_calendar_features(dec_31_2023)
        act_jan_24 = extract_calendar_features(jan_01_2024)
        self.assertEqual(act_dec_23['target_is_month_end'], 1.0)
        self.assertEqual(act_dec_23['target_is_sunday'], 1.0)
        self.assertEqual(act_dec_23['target_is_holiday'], 1.0)  # New Year's Eve
        self.assertEqual(act_jan_24['target_is_month_start'], 1.0)
        self.assertEqual(act_jan_24['target_is_monday'], 1.0)
        self.assertEqual(act_jan_24['target_is_holiday'], 1.0)  # New Year's Day

        dow_vec_dec = np.array([act_dec_23['target_sin_dow'], act_dec_23['target_cos_dow']])
        dow_vec_jan = np.array([act_jan_24['target_sin_dow'], act_jan_24['target_cos_dow']])
        self.assertAlmostEqual(float(np.linalg.norm(dow_vec_dec - dow_vec_jan)), 2.0 * math.sin(math.pi / 7.0), places=5)

        # Deferred harmonics math across 52-week and 53-week ISO year boundaries
        f_dec_23 = extract_deferred_calendar_harmonics(dec_31_2023)
        f_jan_24 = extract_deferred_calendar_harmonics(jan_01_2024)
        self.assertEqual(recover_month(f_dec_23), 12)
        self.assertEqual(recover_month(f_jan_24), 1)
        self.assertEqual(recover_iso_week(f_dec_23, 52), 52)
        self.assertEqual(recover_iso_week(f_jan_24, 52), 1)

        vec_w_dec23 = np.array([f_dec_23['target_sin_week'], f_dec_23['target_cos_week']])
        vec_w_jan24 = np.array([f_jan_24['target_sin_week'], f_jan_24['target_cos_week']])
        self.assertAlmostEqual(float(np.linalg.norm(vec_w_dec23 - vec_w_jan24)), 2.0 * math.sin(math.pi / 52.0), places=5)

        dec_31_2020 = date(2020, 12, 31)
        jan_04_2021 = date(2021, 1, 4)
        f_dec_20 = extract_deferred_calendar_harmonics(dec_31_2020)
        f_jan_21 = extract_deferred_calendar_harmonics(jan_04_2021)
        self.assertEqual(recover_iso_week(f_dec_20, 53), 53)
        self.assertEqual(recover_iso_week(f_jan_21, 52), 1)
        vec_w_dec20 = np.array([f_dec_20['target_sin_week'], f_dec_20['target_cos_week']])
        vec_w_jan21 = np.array([f_jan_21['target_sin_week'], f_jan_21['target_cos_week']])
        self.assertAlmostEqual(float(np.linalg.norm(vec_w_dec20 - vec_w_jan21)), 2.0 * math.sin(math.pi / 53.0), places=5)

        dec_31_2025 = date(2025, 12, 31)
        jan_01_2026 = date(2026, 1, 1)
        f_dec_25 = extract_deferred_calendar_harmonics(dec_31_2025)
        f_jan_26 = extract_deferred_calendar_harmonics(jan_01_2026)
        self.assertEqual(recover_iso_week(f_dec_25, 53), 1)
        self.assertEqual(recover_iso_week(f_jan_26, 53), 1)

    # 46. Genuine End-to-End Training vs Serving 7-Estimator Feature Vector Parity
    def test_46_training_and_inference_estimator_parity(self):
        """
        Captures the exact 7 feature DataFrames passed into the 7 fitted serving estimators
        (`forecaster.models[1..7].predict(...)`) during `RidgeMultiHorizonForecaster.predict_7_days`,
        locates the corresponding row in `generate_training_matrix` for each `(origin_date, target_date, h)`,
        and verifies exact column ordering, raw input values across all 26 model input columns,
        and post-ColumnTransformer standardized/encoded design vectors across year boundaries,
        leap-year boundaries, holidays, and weekday transitions.
        """
        expected_input_cols = list(NUMERIC_FEATURES + CATEGORICAL_FEATURES)
        self.assertEqual(len(NUMERIC_FEATURES), 25)
        self.assertEqual(CATEGORICAL_FEATURES, ['barangay_id'])

        # Ensure Sunday is an active scheduled collection day for self.brgy1 during this test
        # so predict_7_days invokes all 7 serving estimators (h=1..7) without Sunday short-circuiting.
        sunday_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            start_time="07:00:00",
            end_time="12:00:00",
            days="Sunday",
            status="PENDING",
        )
        sunday_sched.barangays.set([self.brgy1])

        def assert_serving_row_matches_training_row(served_df: pd.DataFrame, train_row_df: pd.DataFrame, pipe, h: int, origin_d: date, target_d: date):
            # 1. Exact DataFrame column ordering parity
            self.assertEqual(
                list(served_df.columns),
                list(train_row_df.columns),
                f"Column ordering mismatch at origin={origin_d}, h={h}, target={target_d}"
            )

            # 2. Verify fitted ColumnTransformer consumes NUMERIC_FEATURES and CATEGORICAL_FEATURES in exact order
            pre = pipe.named_steps['preprocessor']
            self.assertEqual(list(pre.transformers_[0][2]), list(NUMERIC_FEATURES))
            self.assertEqual(list(pre.transformers_[1][2]), list(CATEGORICAL_FEATURES))

            # 3. Compare all model input columns value-by-value
            served_row = served_df.iloc[0]
            train_row = train_row_df.iloc[0]

            for col in NUMERIC_FEATURES:
                s_val = float(served_row[col])
                t_val = float(train_row[col])
                if not math.isclose(s_val, t_val, rel_tol=0.0, abs_tol=1e-12):
                    raise AssertionError(
                        f"Numeric feature '{col}' mismatch at origin={origin_d}, h={h}, target={target_d}: "
                        f"served={s_val!r} vs train={t_val!r}"
                    )

            for col in CATEGORICAL_FEATURES:
                if str(served_row[col]) != str(train_row[col]):
                    raise AssertionError(
                        f"Categorical feature '{col}' mismatch at origin={origin_d}, h={h}, target={target_d}: "
                        f"served={served_row[col]!r} vs train={train_row[col]!r}"
                    )

            # 4. Compare exact standardized + one-hot transformed vectors fed into Ridge linear weights
            served_design_vec = pre.transform(served_df)
            train_design_vec = pre.transform(train_row_df)
            np.testing.assert_allclose(
                served_design_vec,
                train_design_vec,
                rtol=0.0,
                atol=1e-12,
                err_msg=f"Transformed Ridge design vector mismatch at origin={origin_d}, h={h}, target={target_d}"
            )

        def run_panel_parity_verification(panel_start: date, n_days: int, test_origins: list):
            dates = [panel_start + timedelta(days=i) for i in range(n_days)]
            # Non-constant deterministic weights so every lag, rolling statistic, trend, and growth rate is distinct
            weights = [
                round(4200.0 + 370.0 * math.sin(i * 0.43) + 195.0 * (i % 7) + 31.0 * (i % 11), 3)
                for i in range(n_days)
            ]
            panel_df = pd.DataFrame({
                'date': dates,
                'weight_kg': weights,
                'barangay_id': self.brgy1.id,
                'population': float(self.brgy1.population),
            })

            X_train_dict, y_train_dict = generate_training_matrix(panel_df, horizon=7, min_history_required=28)
            forecaster = RidgeMultiHorizonForecaster(horizon=7)
            forecaster.fit_and_calibrate(X_train_dict, y_train_dict, n_cv_splits=3)
            self.assertEqual(forecaster.feature_names, expected_input_cols)

            # Instrument all 7 fitted serving pipelines to capture the exact DataFrame passed to .predict()
            captured_by_h = {}
            original_predicts = {}
            for h in range(1, 8):
                orig_fn = forecaster.models[h].predict
                original_predicts[h] = orig_fn

                def make_spy(horizon_idx, fn):
                    def _spy(X_in):
                        captured_by_h[horizon_idx] = X_in.copy(deep=True)
                        return fn(X_in)
                    return _spy

                forecaster.models[h].predict = make_spy(h, orig_fn)

            for origin_d in test_origins:
                captured_by_h.clear()
                hist_mask = panel_df['date'] <= origin_d
                hist_slice_df = panel_df.loc[hist_mask]
                history_series = pd.Series(
                    data=hist_slice_df['weight_kg'].values,
                    index=hist_slice_df['date'].values,
                ).sort_index()

                points = forecaster.predict_7_days(
                    origin_date=origin_d,
                    history_weights=history_series,
                    barangay_id=self.brgy1.id,
                    population=float(self.brgy1.population),
                )
                self.assertEqual(len(points), 7)

                # Confirm all 7 serving estimators were invoked
                self.assertEqual(
                    set(captured_by_h.keys()),
                    {1, 2, 3, 4, 5, 6, 7},
                    f"All 7 serving estimators must be invoked for origin={origin_d}"
                )

                for h in range(1, 8):
                    target_d = origin_d + timedelta(days=h)
                    X_h_train = X_train_dict[h]
                    matched_train_df = X_h_train[
                        (X_h_train['origin_date'] == str(origin_d))
                        & (X_h_train['target_date'] == str(target_d))
                        & (X_h_train['horizon_step'] == h)
                    ]
                    self.assertEqual(
                        len(matched_train_df),
                        1,
                        f"Expected exactly 1 training row for origin={origin_d}, target={target_d}, h={h}"
                    )

                    served_df_h = captured_by_h[h]
                    self.assertEqual(len(served_df_h), 1)
                    assert_serving_row_matches_training_row(
                        served_df=served_df_h,
                        train_row_df=matched_train_df,
                        pipe=forecaster.models[h],
                        h=h,
                        origin_d=origin_d,
                        target_d=target_d,
                    )

            # Negative-control verification: perturbing a serving feature MUST fail the parity assertion
            sample_origin = test_origins[0]
            sample_target = sample_origin + timedelta(days=1)
            sample_train_df = X_train_dict[1][
                (X_train_dict[1]['origin_date'] == str(sample_origin))
                & (X_train_dict[1]['target_date'] == str(sample_target))
            ]
            mutated_served_cal = sample_train_df.copy(deep=True)
            mutated_served_cal['target_sin_dow'] = float(mutated_served_cal['target_sin_dow'].iloc[0]) + 0.05
            with self.assertRaises(AssertionError):
                assert_serving_row_matches_training_row(
                    mutated_served_cal, sample_train_df, forecaster.models[1], 1, sample_origin, sample_target
                )

            mutated_served_lag = sample_train_df.copy(deep=True)
            mutated_served_lag['lag_1'] = float(mutated_served_lag['lag_1'].iloc[0]) + 1.0
            with self.assertRaises(AssertionError):
                assert_serving_row_matches_training_row(
                    mutated_served_lag, sample_train_df, forecaster.models[1], 1, sample_origin, sample_target
                )

        # Panel 1: 300-day cross-year panel (2025-11-15 to 2026-09-10) covering:
        # - 2025-12-28: Year boundary 2025-12-31 -> 2026-01-01, Rizal Day, NYE, NYD, Sat/Sun
        # - 2026-02-25: Non-leap February end 2026-02-28 -> 2026-03-01
        # - 2026-04-01: Holy Week / Good Friday (2026-04-03) / Easter Sunday (2026-04-05)
        # - 2026-08-28: National Heroes Day + month-end Monday (2026-08-31) -> 2026-09-01
        run_panel_parity_verification(
            panel_start=date(2025, 11, 15),
            n_days=300,
            test_origins=[
                date(2025, 12, 28),
                date(2026, 2, 25),
                date(2026, 4, 1),
                date(2026, 8, 28),
            ],
        )

        # Panel 2: 2024 Leap-Year panel (2024-01-15 to 2024-03-20) covering Feb 29 -> Mar 1
        run_panel_parity_verification(
            panel_start=date(2024, 1, 15),
            n_days=66,
            test_origins=[
                date(2024, 2, 26),
            ],
        )

        sunday_sched.delete()

    # 47. Calendar Feature Test: Excluded Ordinals and Deferred Harmonics Absent from Active Schema
    def test_47_raw_ordinal_calendar_features_excluded(self):
        from forecasting.features import (
            ACTIVE_CALENDAR_FEATURES,
            DEFERRED_EXPERIMENTAL_CALENDAR_FEATURES,
        )

        forbidden_in_active = [
            # Raw periodic ordinals
            'target_day_of_week',
            'target_month',
            'target_week_of_year',
            'target_day_of_month',
            # Deferred annual/sub-annual harmonics
            'target_sin_month',
            'target_cos_month',
            'target_sin_week',
            'target_cos_week',
        ]

        expected_active_calendar = [
            'target_is_weekend',
            'target_is_sunday',
            'target_is_monday',
            'target_is_month_start',
            'target_is_month_end',
            'target_is_holiday',
            'target_sin_dow',
            'target_cos_dow',
        ]
        self.assertEqual(ACTIVE_CALENDAR_FEATURES, expected_active_calendar)
        self.assertEqual(
            DEFERRED_EXPERIMENTAL_CALENDAR_FEATURES,
            ['target_sin_month', 'target_cos_month', 'target_sin_week', 'target_cos_week'],
        )

        sample_feats = extract_calendar_features(date(2026, 10, 18))
        self.assertEqual(list(sample_feats.keys()), expected_active_calendar)

        for col in forbidden_in_active:
            self.assertNotIn(col, sample_feats, f"{col} must not be emitted by active extract_calendar_features.")
            self.assertNotIn(col, NUMERIC_FEATURES, f"{col} must not be included in active NUMERIC_FEATURES.")
            self.assertNotIn(col, CATEGORICAL_FEATURES, f"{col} must not be included in CATEGORICAL_FEATURES.")

        # Confirm one-hot weekday was NOT automatically added to production CATEGORICAL_FEATURES
        self.assertEqual(CATEGORICAL_FEATURES, ['barangay_id'])
        self.assertEqual(len(NUMERIC_FEATURES), 25)

        # Fit pipeline on training matrix and confirm transformed feature names exclude all forbidden columns
        dates = [date(2026, 9, 1) + timedelta(days=i) for i in range(45)]
        df = pd.DataFrame({
            'date': dates,
            'weight_kg': [4000.0 + (i % 7) * 200.0 for i in range(45)],
            'barangay_id': 1,
            'population': 12000.0,
        })
        X_dict, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
        pipe = create_ridge_pipeline(alpha=10.0)
        pipe.fit(X_dict[1], y_dict[1])
        feature_names_out = list(pipe.named_steps['preprocessor'].get_feature_names_out())
        for col in forbidden_in_active:
            self.assertFalse(
                any(col in fn for fn in feature_names_out),
                f"Fitted ColumnTransformer must not contain excluded/deferred feature '{col}'."
            )

    # 48. Calendar Feature Test: Holiday and Weekday Operational Indicators
    def test_48_calendar_holiday_and_weekday_operational_indicators(self):
        """
        Explicitly verifies Good Friday (2026-04-03), National Heroes Day (2026-08-31),
        and target_is_weekend, target_is_sunday, and target_is_monday across all seven days Monday through Sunday.
        """
        from datetime import date
        from forecasting.features import extract_calendar_features

        # 1. Movable holidays: Good Friday 2026-04-03 and National Heroes Day 2026-08-31
        gf_feats = extract_calendar_features(date(2026, 4, 3))
        self.assertEqual(gf_feats['target_is_holiday'], 1.0, "Good Friday (2026-04-03) must be recognized as holiday.")

        nhd_feats = extract_calendar_features(date(2026, 8, 31))
        self.assertEqual(nhd_feats['target_is_holiday'], 1.0, "National Heroes Day (2026-08-31) must be recognized as holiday.")

        # Non-holiday regular weekday
        reg_feats = extract_calendar_features(date(2026, 8, 25))
        self.assertEqual(reg_feats['target_is_holiday'], 0.0, "Regular weekday must not be recognized as holiday.")

        # 2. Weekday and operational indicators across Monday through Sunday
        # 2026-10-19 is Monday (dow=0) through 2026-10-25 is Sunday (dow=6)
        mon_d = date(2026, 10, 19)
        for dow_offset in range(7):
            d = mon_d + timedelta(days=dow_offset)
            feats = extract_calendar_features(d)
            dow = d.weekday()

            # Weekend
            expected_weekend = 1.0 if dow in (5, 6) else 0.0
            self.assertEqual(feats['target_is_weekend'], expected_weekend, f"target_is_weekend mismatch on {d} (dow={dow})")

            # Monday
            expected_monday = 1.0 if dow == 0 else 0.0
            self.assertEqual(feats['target_is_monday'], expected_monday, f"target_is_monday mismatch on {d} (dow={dow})")

            # Sunday
            expected_sunday = 1.0 if dow == 6 else 0.0
            self.assertEqual(feats['target_is_sunday'], expected_sunday, f"target_is_sunday mismatch on {d} (dow={dow})")

    # 49. Unified Artifact Governance & Rollback Fail-Closed Verification
    def test_49_unified_artifact_governance_and_rollback_validation(self):
        """
        Targeted regression test for unified artifact validator and rollback governance:
        - Missing 'feature_schema' during rollback.
        - Reordered 'feature_schema' during rollback.
        - Stale pickle 'feature_names' during rollback.
        - Stale fitted-pipeline columns during rollback.
        - Missing 'synthetic_records' (during rollback and primary loading).
        - Boolean 'synthetic_records=False' (during rollback and primary loading).
        - Candidate loader with reordered schema.
        - Primary loader with stale fitted-pipeline columns.
        - Candidate loader with stale fitted-pipeline columns.
        - Rollback with valid metadata and valid fitted pipeline.
        - Failed rollback leaves active manifest and active files completely unchanged.
        """
        import joblib
        from sklearn.compose import ColumnTransformer
        from sklearn.preprocessing import StandardScaler, OneHotEncoder
        from sklearn.pipeline import Pipeline
        from sklearn.linear_model import Ridge
        from forecasting.service import validate_forecaster_artifact

        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = os.path.join(temp_dir, 'active_manifest.json')
            cand_manifest_path = os.path.join(temp_dir, 'candidate_manifest.json')
            latest_model_path = os.path.join(temp_dir, 'waste_forecast_model_latest.joblib')
            latest_meta_path = os.path.join(temp_dir, 'waste_forecast_metadata_latest.json')

            # Initial active production state
            with open(latest_model_path, 'wb') as f:
                f.write(b"ACTIVE_MODEL_BYTES_INITIAL")
            with open(latest_meta_path, 'w', encoding='utf-8') as f:
                json.dump({'model_version': 'v_initial_prod'}, f)

            with open(manifest_path, 'w', encoding='utf-8') as mf:
                json.dump({
                    'active_model_file': 'waste_forecast_model_latest.joblib',
                    'active_metadata_file': 'waste_forecast_metadata_latest.json',
                    'model_version': 'v_initial_prod',
                    'sha256': hashlib.sha256(b"ACTIVE_MODEL_BYTES_INITIAL").hexdigest()
                }, mf, indent=2)

            def get_active_manifest_snapshot():
                with open(manifest_path, 'r', encoding='utf-8') as mf:
                    return json.load(mf)

            def get_active_bytes_snapshot():
                with open(latest_model_path, 'rb') as f:
                    return f.read()

            initial_manifest_snapshot = get_active_manifest_snapshot()
            initial_bytes_snapshot = get_active_bytes_snapshot()

            # Helper to create a properly fitted 7-horizon model
            dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(60)]
            df = pd.DataFrame({
                'date': dates,
                'weight_kg': [3500.0 + (i % 7) * 150.0 for i in range(60)],
                'barangay_id': 1,
                'population': 15000.0,
            })
            X_dict, y_dict = generate_training_matrix(df, horizon=7, min_history_required=28)
            f_valid = RidgeMultiHorizonForecaster(horizon=7)
            f_valid.fit_and_calibrate(X_dict, y_dict, n_cv_splits=3)

            target_model_path = os.path.join(temp_dir, 'waste_forecast_model_target.joblib')
            target_meta_path = os.path.join(temp_dir, 'waste_forecast_metadata_target.json')

            def write_target_artifact(model_obj, meta_dict):
                joblib.dump(model_obj, target_model_path)
                with open(target_model_path, 'rb') as f:
                    actual_sha = hashlib.sha256(f.read()).hexdigest()
                meta_to_write = dict(meta_dict)
                if 'sha256' not in meta_to_write:
                    meta_to_write['sha256'] = actual_sha
                with open(target_meta_path, 'w', encoding='utf-8') as f:
                    json.dump(meta_to_write, f, indent=2)
                return actual_sha

            # 1. Missing 'feature_schema' during rollback
            write_target_artifact(f_valid, {
                'model_version': 'target_v1',
                'synthetic_records': 0,
                'validation_status': 'PASSED',
            })
            with self.assertRaises(CommandError) as ctx:
                call_command('rollback_forecast_model', artifacts_dir=temp_dir, target_version='target')
            self.assertIn("missing mandatory 'feature_schema'", str(ctx.exception).lower())
            self.assertEqual(get_active_manifest_snapshot(), initial_manifest_snapshot)
            self.assertEqual(get_active_bytes_snapshot(), initial_bytes_snapshot)

            # 2. Reordered 'feature_schema' during rollback
            write_target_artifact(f_valid, {
                'model_version': 'target_v1',
                'synthetic_records': 0,
                'validation_status': 'PASSED',
                'feature_schema': list(reversed(f_valid.feature_names)),
            })
            with self.assertRaises(CommandError) as ctx:
                call_command('rollback_forecast_model', artifacts_dir=temp_dir, target_version='target')
            self.assertIn("does not exactly match active model schema", str(ctx.exception).lower())
            self.assertEqual(get_active_manifest_snapshot(), initial_manifest_snapshot)
            self.assertEqual(get_active_bytes_snapshot(), initial_bytes_snapshot)

            # 3. Stale pickle 'feature_names' during rollback
            f_stale_names = RidgeMultiHorizonForecaster(horizon=7)
            f_stale_names.models = f_valid.models
            f_stale_names.feature_names = f_valid.feature_names + ['stale_extra_feature']
            write_target_artifact(f_stale_names, {
                'model_version': 'target_v1',
                'synthetic_records': 0,
                'validation_status': 'PASSED',
                'feature_schema': f_valid.feature_names,
            })
            with self.assertRaises(CommandError) as ctx:
                call_command('rollback_forecast_model', artifacts_dir=temp_dir, target_version='target')
            self.assertIn("forecaster model 'feature_names' does not exactly match active schema", str(ctx.exception).lower())
            self.assertEqual(get_active_manifest_snapshot(), initial_manifest_snapshot)
            self.assertEqual(get_active_bytes_snapshot(), initial_bytes_snapshot)

            # 4. Stale fitted-pipeline columns during rollback
            f_stale_pipe = RidgeMultiHorizonForecaster(horizon=7)
            f_stale_pipe.feature_names = list(f_valid.feature_names)
            # Create pipeline fitted with an obsolete column list
            obsolete_num = list(NUMERIC_FEATURES) + ['obsolete_col']
            pre_obsolete = ColumnTransformer(
                transformers=[
                    ('num', StandardScaler(), obsolete_num),
                    ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), CATEGORICAL_FEATURES),
                ],
                remainder='drop'
            )
            pipe_obsolete = Pipeline([('preprocessor', pre_obsolete), ('ridge', Ridge())])
            # Fake fitted state
            pre_obsolete.transformers_ = [('num', StandardScaler(), obsolete_num), ('cat', OneHotEncoder(), CATEGORICAL_FEATURES)]
            f_stale_pipe.models = {h: pipe_obsolete for h in range(1, 8)}

            write_target_artifact(f_stale_pipe, {
                'model_version': 'target_v1',
                'synthetic_records': 0,
                'validation_status': 'PASSED',
                'feature_schema': f_valid.feature_names,
            })
            with self.assertRaises(CommandError) as ctx:
                call_command('rollback_forecast_model', artifacts_dir=temp_dir, target_version='target')
            self.assertIn("numeric transformer columns do not match active numeric_features", str(ctx.exception).lower())
            self.assertEqual(get_active_manifest_snapshot(), initial_manifest_snapshot)
            self.assertEqual(get_active_bytes_snapshot(), initial_bytes_snapshot)

            # 5. Missing 'synthetic_records' during rollback and primary loader
            write_target_artifact(f_valid, {
                'model_version': 'target_v1',
                'validation_status': 'PASSED',
                'feature_schema': f_valid.feature_names,
            })
            with self.assertRaises(CommandError) as ctx:
                call_command('rollback_forecast_model', artifacts_dir=temp_dir, target_version='target')
            self.assertIn("missing mandatory 'synthetic_records'", str(ctx.exception).lower())

            # Also verify shared validator direct call for missing synthetic_records
            with open(target_model_path, 'rb') as f:
                t_bytes = f.read()
            with open(target_meta_path, 'r', encoding='utf-8') as f:
                t_meta = json.load(f)
            with self.assertRaises(ValueError) as v_ctx:
                validate_forecaster_artifact(t_bytes, t_meta)
            self.assertIn("missing mandatory 'synthetic_records'", str(v_ctx.exception).lower())

            # 6. Boolean 'synthetic_records=False' during rollback and primary loader
            write_target_artifact(f_valid, {
                'model_version': 'target_v1',
                'synthetic_records': False,
                'validation_status': 'PASSED',
                'feature_schema': f_valid.feature_names,
            })
            with self.assertRaises(CommandError) as ctx:
                call_command('rollback_forecast_model', artifacts_dir=temp_dir, target_version='target')
            self.assertIn("must be an integer, not a boolean", str(ctx.exception).lower())

            with open(target_meta_path, 'r', encoding='utf-8') as f:
                t_meta = json.load(f)
            with self.assertRaises(ValueError) as v_ctx:
                validate_forecaster_artifact(t_bytes, t_meta)
            self.assertIn("must be an integer, not a boolean", str(v_ctx.exception).lower())

            # 7. Candidate loader with reordered schema fails closed
            with open(cand_manifest_path, 'w', encoding='utf-8') as cmf:
                json.dump({
                    'candidate_model_file': 'waste_forecast_model_target.joblib',
                    'candidate_metadata_file': 'waste_forecast_metadata_target.json',
                }, cmf)
            write_target_artifact(f_valid, {
                'model_version': 'target_v1',
                'synthetic_records': 0,
                'validation_status': 'PASSED',
                'feature_schema': list(reversed(f_valid.feature_names)),
            })
            c_fc, c_meta = load_candidate_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(c_fc)

            # 8. Primary loader with stale fitted-pipeline columns fails closed
            write_target_artifact(f_stale_pipe, {
                'model_version': 'target_v1',
                'synthetic_records': 0,
                'validation_status': 'PASSED',
                'feature_schema': f_valid.feature_names,
            })
            # Point active manifest to the stale pipeline artifact
            with open(manifest_path, 'w', encoding='utf-8') as mf:
                json.dump({
                    'active_model_file': 'waste_forecast_model_target.joblib',
                    'active_metadata_file': 'waste_forecast_metadata_target.json',
                }, mf)
            p_fc, p_meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(p_fc)

            # 9. Candidate loader with stale fitted-pipeline columns fails closed
            c_fc, c_meta = load_candidate_forecaster(artifacts_dir=temp_dir)
            self.assertIsNone(c_fc)

            # 10. Rollback with valid metadata and valid fitted pipeline succeeds atomically
            target_sha = write_target_artifact(f_valid, {
                'model_version': 'target_v1_valid',
                'synthetic_records': 0,
                'validation_status': 'PASSED',
                'feature_schema': f_valid.feature_names,
            })
            call_command('rollback_forecast_model', artifacts_dir=temp_dir, target_version='target')
            new_manifest = get_active_manifest_snapshot()
            self.assertEqual(new_manifest['active_model_file'], 'waste_forecast_model_target.joblib')
            self.assertEqual(new_manifest['model_version'], 'target_v1_valid')
            self.assertEqual(new_manifest['sha256'], target_sha)

            # Verify primary loader loads this valid rolled-back artifact
            p_fc, p_meta = load_latest_forecaster(artifacts_dir=temp_dir)
            self.assertIsNotNone(p_fc)
            self.assertEqual(p_meta['model_version'], 'target_v1_valid')
            self.assertEqual(p_fc.feature_names, f_valid.feature_names)




