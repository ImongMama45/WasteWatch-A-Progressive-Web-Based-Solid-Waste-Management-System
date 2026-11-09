"""
forecasting/models.py
---------------------
Ridge Regression Direct Multi-Horizon Forecaster with Time-Based Conformal Residual Calibration.
Produces expected waste weight (expected_kg) and calibrated 80% prediction intervals (low_kg, high_kg).
"""

import math
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd

from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.model_selection import TimeSeriesSplit

from forecasting.features import (
    extract_calendar_features,
    extract_origin_lag_and_rolling_features,
    build_feature_vector_for_origin,
    is_collection_scheduled,
    check_collection_schedule,
    ScheduleStatus,
    HorizonFeatureDict,
)


# Active numeric inputs for Ridge Regression (25 features: 1 demographic + 8 calendar + 16 lag/rolling/trend).
# Note: Annual/sub-annual harmonics (target_sin_month, target_cos_month, target_sin_week, target_cos_week)
# are deferred until multi-season genuine CENRO data exists, and raw target_day_of_month (1-31) is excluded
# to avoid month-boundary step discontinuities while retaining target_is_month_start and target_is_month_end.
NUMERIC_FEATURES = [
    'population',
    'target_is_weekend',
    'target_is_sunday',
    'target_is_monday',
    'target_is_month_start',
    'target_is_month_end',
    'target_is_holiday',
    'target_sin_dow',
    'target_cos_dow',
    'lag_1',
    'lag_2',
    'lag_3',
    'lag_7',
    'lag_14',
    'lag_21',
    'rolling_mean_7',
    'rolling_mean_14',
    'rolling_mean_28',
    'rolling_std_7',
    'rolling_std_14',
    'rolling_max_14',
    'rolling_min_14',
    'rolling_median_14',
    'trend_7_vs_28',
    'recent_growth_rate',
]

CATEGORICAL_FEATURES = [
    'barangay_id',
]


def create_ridge_pipeline(alpha: float = 10.0) -> Pipeline:
    """Creates a leak-free scikit-learn Pipeline with ColumnTransformer and Ridge."""
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), NUMERIC_FEATURES),
            ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), CATEGORICAL_FEATURES),
        ],
        remainder='drop'
    )
    return Pipeline([
        ('preprocessor', preprocessor),
        ('ridge', Ridge(alpha=alpha, positive=False, random_state=42)),
    ])


class RidgeMultiHorizonForecaster:
    """
    Direct 7-Day Multi-Horizon Forecaster using individual Ridge estimators per horizon step.
    Implements finite-sample conformal quantile prediction intervals.
    """

    def __init__(self, horizon: int = 7, alpha: float = 10.0):
        self.horizon = horizon
        self.alpha = alpha
        self.models: Dict[int, Pipeline] = {}
        self.conformal_q80: Dict[int, float] = {h: 0.0 for h in range(1, horizon + 1)}
        self.validation_metrics: Dict[str, Any] = {}
        self.feature_names: List[str] = NUMERIC_FEATURES + CATEGORICAL_FEATURES
        self.trained_at: Optional[str] = None
        self.training_rows: int = 0
        self.is_fitted: bool = False

    def fit_and_calibrate(
        self,
        X_df: Any,
        y_dict: Dict[int, pd.Series],
        n_cv_splits: int = 4
    ) -> Dict[str, Any]:
        """
        Executes leak-free chronological validation with genuine 7-day calendar embargoes,
        tunes alpha on training partition only, calibrates finite-sample 80% conformal prediction
        intervals from isolated calibration residuals, evaluates empirical coverage on an untouched
        test partition, and fits final production estimators with horizon-specific features.
        """
        def _get_X(X_input: Any, h: int) -> pd.DataFrame:
            if isinstance(X_input, HorizonFeatureDict):
                return X_input[h]
            if isinstance(X_input, dict) and h in X_input:
                return X_input[h]
            return X_input

        X_ref = _get_X(X_df, 1)
        n_samples = len(X_ref)
        if n_samples < 15:
            raise ValueError(f"Insufficient training rows ({n_samples}). At least 15 required.")

        alphas = [0.1, 1.0, 10.0, 50.0, 100.0, 500.0]
        best_alphas = {}
        all_cal_residuals = {h: [] for h in range(1, self.horizon + 1)}
        all_test_actuals = {h: [] for h in range(1, self.horizon + 1)}
        all_test_preds = {h: [] for h in range(1, self.horizon + 1)}

        def _to_date(d: Any) -> date:
            if isinstance(d, date):
                return d
            if isinstance(d, str):
                return date.fromisoformat(d)
            if hasattr(d, 'date'):
                return d.date()
            return date.fromisoformat(str(d))

        has_origin_dates = 'origin_date' in X_ref.columns
        unique_dates = sorted([_to_date(d) for d in X_ref['origin_date'].dropna().unique()]) if has_origin_dates else []

        if has_origin_dates and len(unique_dates) >= 14:
            min_d = unique_dates[0]
            max_d = unique_dates[-1]
            span_days = (max_d - min_d).days

            if span_days < 16:
                raise ValueError(
                    f"Insufficient chronological data ({span_days} days span). "
                    "At least 16 calendar days span is required to form two 7-day embargo gaps."
                )

            # Proportional span calculation guaranteeing >= 7-day embargoes without target overlap (N-02)
            train_span = max(2, int((span_days - 14) * 0.55))
            train_end_date = min_d + timedelta(days=train_span)
            train_dates = set([d for d in unique_dates if d <= train_end_date])

            # 7-day embargo between Train and Cal
            cal_min_date = train_end_date + timedelta(days=7)
            cal_span = max(1, int((span_days - 14) * 0.20))
            cal_end_date = cal_min_date + timedelta(days=cal_span)
            cal_dates = set([d for d in unique_dates if cal_min_date <= d <= cal_end_date])

            # 7-day embargo between Cal and Test
            test_min_date = cal_end_date + timedelta(days=7)
            test_dates = set([d for d in unique_dates if d >= test_min_date])

            if not cal_dates or not test_dates:
                raise ValueError("Insufficient chronological data: cannot create non-empty calibration and test partitions with 7-day embargo gaps.")

            # Record partition details for audit verification
            self.partition_info = {
                'train_origin_range': (str(min(train_dates)), str(max(train_dates))),
                'train_target_range': (str(min(train_dates) + timedelta(days=1)), str(max(train_dates) + timedelta(days=self.horizon))),
                'cal_origin_range': (str(min(cal_dates)), str(max(cal_dates))),
                'cal_target_range': (str(min(cal_dates) + timedelta(days=1)), str(max(cal_dates) + timedelta(days=self.horizon))),
                'test_origin_range': (str(min(test_dates)), str(max(test_dates))),
                'test_target_range': (str(min(test_dates) + timedelta(days=1)), str(max(test_dates) + timedelta(days=self.horizon))),
                'train_days': len(train_dates),
                'cal_days': len(cal_dates),
                'test_days': len(test_dates),
            }

            orig_series = X_ref['origin_date'].apply(_to_date)
            tr_mask = orig_series.isin(train_dates).values
            cal_mask = orig_series.isin(cal_dates).values
            test_mask = orig_series.isin(test_dates).values

            # Nested alpha tuning: split train partition chronologically to avoid evaluating on cal data (N-06 fix)
            train_dates_sorted = sorted(list(train_dates))
            inner_n = len(train_dates_sorted)
            if inner_n >= 6:
                inner_tr_cut = int(inner_n * 0.70)
                inner_tr_dates = set(train_dates_sorted[:inner_tr_cut])
                inner_val_dates = set(train_dates_sorted[inner_tr_cut:])
                inner_tr_mask = orig_series.isin(inner_tr_dates).values
                inner_val_mask = orig_series.isin(inner_val_dates).values
            else:
                inner_tr_mask = tr_mask
                inner_val_mask = tr_mask

            for h in range(1, self.horizon + 1):
                X_h = _get_X(X_df, h)
                y_h = y_dict[h]
                best_alpha = self.alpha
                lowest_mae = float('inf')

                # Tune alpha strictly on inner training split (N-06)
                for alpha_cand in alphas:
                    pipe = create_ridge_pipeline(alpha=alpha_cand)
                    pipe.fit(X_h[inner_tr_mask], y_h[inner_tr_mask])
                    inner_p = np.maximum(0.0, pipe.predict(X_h[inner_val_mask]))
                    mae = float(np.mean(np.abs(y_h[inner_val_mask].values - inner_p)))
                    if mae < lowest_mae:
                        lowest_mae = mae
                        best_alpha = alpha_cand

                best_alphas[h] = best_alpha

                # Fit on full train block with best_alpha
                pipe = create_ridge_pipeline(alpha=best_alpha)
                pipe.fit(X_h[tr_mask], y_h[tr_mask])

                # Collect isolated calibration residuals
                cal_p = np.maximum(0.0, pipe.predict(X_h[cal_mask]))
                cal_res = np.abs(y_h[cal_mask].values - cal_p)
                all_cal_residuals[h].extend(cal_res.tolist())

                # Collect untouched test partition predictions and actuals
                test_p = np.maximum(0.0, pipe.predict(X_h[test_mask]))
                all_test_preds[h].extend(test_p.tolist())
                all_test_actuals[h].extend(y_h[test_mask].values.tolist())

        else:
            # When insufficient origin dates exist for 7-day embargoes, raise error to fail closed (N-02)
            if has_origin_dates and len(unique_dates) < 14:
                raise ValueError(
                    f"Insufficient chronological data ({len(unique_dates)} distinct dates). "
                    "At least 14 distinct dates are required to form 7-day embargoed partitions without target overlap."
                )

            # Fallback to standard TimeSeriesSplit for synthetic / non-temporal matrices
            effective_splits = min(n_cv_splits, max(2, n_samples // 10))
            tscv = TimeSeriesSplit(n_splits=effective_splits)

            for h in range(1, self.horizon + 1):
                X_h = _get_X(X_df, h)
                y_h = y_dict[h]
                best_alpha = self.alpha
                lowest_mae = float('inf')

                for alpha_cand in alphas:
                    fold_maes = []
                    for train_idx, val_idx in tscv.split(X_h):
                        X_tr, X_val = X_h.iloc[train_idx], X_h.iloc[val_idx]
                        y_tr, y_val = y_h.iloc[train_idx], y_h.iloc[val_idx]

                        pipe = create_ridge_pipeline(alpha=alpha_cand)
                        pipe.fit(X_tr, y_tr)
                        preds = np.maximum(0.0, pipe.predict(X_val))
                        mae = float(np.mean(np.abs(y_val.values - preds)))
                        fold_maes.append(mae)

                    avg_mae = float(np.mean(fold_maes))
                    if avg_mae < lowest_mae:
                        lowest_mae = avg_mae
                        best_alpha = alpha_cand

                best_alphas[h] = best_alpha

                for train_idx, val_idx in tscv.split(X_h):
                    X_tr, X_val = X_h.iloc[train_idx], X_h.iloc[val_idx]
                    y_tr, y_val = y_h.iloc[train_idx], y_h.iloc[val_idx]

                    pipe = create_ridge_pipeline(alpha=best_alpha)
                    pipe.fit(X_tr, y_tr)
                    preds = np.maximum(0.0, pipe.predict(X_val))
                    resids = np.abs(y_val.values - preds)
                    all_cal_residuals[h].extend(resids.tolist())
                    all_test_actuals[h].extend(y_val.values.tolist())
                    all_test_preds[h].extend(preds.tolist())

        # Exact finite-sample conformal residual quantile calibration (N-07)
        test_coverage_by_h = {}
        interval_width_by_h = {}
        q80_by_h = {}
        calib_counts_by_h = {}
        test_counts_by_h = {}

        for h in range(1, self.horizon + 1):
            res_list = all_cal_residuals[h]
            n_res = len(res_list)
            calib_counts_by_h[h] = n_res
            n_test = len(all_test_actuals[h])
            test_counts_by_h[h] = n_test

            if n_res >= 5:
                # Finite-sample conformal order statistic: ceil((n+1)*0.80)
                sorted_res = np.sort(res_list)
                k_rank = min(n_res, max(1, math.ceil((n_res + 1) * 0.80)))
                q_val = float(sorted_res[k_rank - 1])
            else:
                q_val = float(np.std(res_list) * 1.2816) if res_list else 100.0

            q80_by_h[h] = round(q_val, 2)
            interval_width_by_h[h] = round(q_val * 2.0, 2)

            # Measure empirical coverage strictly on test partition
            # N-07: If independent test data is insufficient (<15), store coverage as None (null)
            if n_test >= 15:
                acts = np.array(all_test_actuals[h])
                preds = np.array(all_test_preds[h])
                in_band = (acts >= np.maximum(0.0, preds - q_val)) & (acts <= (preds + q_val))
                cov = float(np.mean(in_band)) if len(in_band) > 0 else None
                test_coverage_by_h[h] = round(cov, 3) if cov is not None else None
            else:
                test_coverage_by_h[h] = None

        self.conformal_q80 = q80_by_h

        # Fit final estimators on full available dataset with horizon-specific features (N-01)
        for h in range(1, self.horizon + 1):
            X_h = _get_X(X_df, h)
            prod_pipe = create_ridge_pipeline(alpha=best_alphas[h])
            prod_pipe.fit(X_h, y_dict[h])
            self.models[h] = prod_pipe

        self.training_rows = n_samples
        self.is_fitted = True

        # Aggregate test performance metrics
        all_actuals = np.concatenate([np.array(all_test_actuals[h]) for h in range(1, self.horizon + 1)]) if any(all_test_actuals.values()) else np.array([])
        all_preds = np.concatenate([np.array(all_test_preds[h]) for h in range(1, self.horizon + 1)]) if any(all_test_preds.values()) else np.array([])

        if len(all_actuals) > 0:
            mae = float(np.mean(np.abs(all_actuals - all_preds)))
            rmse = float(np.sqrt(np.mean((all_actuals - all_preds) ** 2)))
            sum_actuals = float(np.sum(all_actuals))
            wape = float(np.sum(np.abs(all_actuals - all_preds)) / (sum_actuals + 1e-5))
            mean_bias = float(np.mean(all_preds - all_actuals))
        else:
            mae, rmse, wape, mean_bias = 0.0, 0.0, 0.0, 0.0

        self.validation_metrics = {
            'overall_mae': round(mae, 2),
            'overall_rmse': round(rmse, 2),
            'overall_wape': round(wape, 4),
            'mean_bias': round(mean_bias, 2),
            'horizon_q80': self.conformal_q80,
            'test_coverage': test_coverage_by_h,
            'calibration_sample_counts': calib_counts_by_h,
            'test_sample_counts': test_counts_by_h,
            'average_interval_width': interval_width_by_h,
            'best_alphas': best_alphas,
            'cv_samples': n_samples,
        }
        return self.validation_metrics

    def predict_7_days(
        self,
        origin_date: date,
        history_weights: pd.Series,
        barangay_id: int = 0,
        population: float = 0.0
    ) -> List[Dict[str, Any]]:
        """
        Generates 7 out-of-sample daily predictions with calibrated 80% intervals.
        Enforces deterministic zero on scheduled non-collection Sundays (F-03 fix).
        """
        if not self.is_fitted:
            raise RuntimeError("RidgeMultiHorizonForecaster is not fitted yet.")

        lag_feats = extract_origin_lag_and_rolling_features(history_weights)
        feat_rows = []
        target_dates = []

        for h in range(1, self.horizon + 1):
            target_d = origin_date + timedelta(days=h)
            target_dates.append(target_d)
            feat_dict = build_feature_vector_for_origin(
                origin_date=origin_date,
                target_date=target_d,
                history_weights=history_weights,
                barangay_id=barangay_id,
                population=population,
                precomputed_lag_feats=lag_feats
            )
            feat_rows.append(feat_dict)

        feat_df = pd.DataFrame(feat_rows)
        forecast_points = []

        for h in range(1, self.horizon + 1):
            target_d = target_dates[h - 1]
            is_sunday = (target_d.weekday() == 6)
            sched_status = check_collection_schedule(target_d, barangay_id, evaluation_origin=origin_date)

            if is_sunday and sched_status == ScheduleStatus.CONFIRMED_NON_COLLECTION:
                # Verified scheduled non-collection day in Lucena City: zero intake expected
                expected_kg = 0.0
                low_kg = 0.0
                high_kg = 0.0
            else:
                model = self.models[h]
                raw_pred = float(model.predict(feat_df.iloc[[h - 1]])[0])
                expected_kg = max(0.0, raw_pred)

                q_band = self.conformal_q80.get(h, 0.0)
                low_kg = max(0.0, expected_kg - q_band)
                high_kg = expected_kg + q_band

            forecast_points.append({
                'date': str(target_d),
                'expected_kg': round(expected_kg),
                'low_kg': round(low_kg),
                'high_kg': round(high_kg),
                'horizon_step': h,
            })

        return forecast_points
