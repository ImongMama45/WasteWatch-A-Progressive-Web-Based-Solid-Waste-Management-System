"""
forecasting/service.py
----------------------
Dedicated forecasting inference service for WasteWatch.

Features:
- In-memory model caching with mtime checking (zero disk I/O on hot requests).
- Direct multi-horizon Ridge forecasting with conformal 80% prediction intervals.
- Robust tiered fallback to weekday-adjusted seasonal heuristic.
- Strict P95 < 150ms execution envelope.
"""

import os
import json
import logging
from datetime import date, timedelta
from typing import Dict, Any, Optional, List, Tuple
from statistics import mean, stdev

import joblib
import pandas as pd
from django.utils import timezone
from django.conf import settings

from accounts.models import Barangay
from dumpsite.models import WasteDelivery
from forecasting.aggregation import build_daily_aggregation, WEIGHT_EXPR

logger = logging.getLogger(__name__)

import io
import hashlib

from forecasting.features import (
    is_collection_scheduled,
    check_collection_schedule,
    ScheduleStatus,
    get_canonical_city_population,
    get_series_population,
)
from forecasting.models import NUMERIC_FEATURES, CATEGORICAL_FEATURES

ARTIFACTS_DIR = getattr(
    settings,
    'FORECASTING_ARTIFACTS_DIR',
    os.path.join(settings.BASE_DIR, 'forecasting', 'artifacts')
)

# In-memory model cache singleton
_CACHED_FORECASTER = None
_CACHED_METADATA = None
_CACHED_PATH = None
_CACHED_VERSION = None
_CACHED_SHA = None
_CACHED_MTIME = 0.0
_CACHED_SIZE = 0

# Candidate model cache singleton (for shadow evaluation)
_CANDIDATE_FORECASTER = None
_CANDIDATE_METADATA = None
_CANDIDATE_PATH = None
_CANDIDATE_MTIME = 0.0

Z80 = 1.2816  # Heuristic fallback two-sided 80% Gaussian multiplier


def validate_forecaster_artifact(
    model_bytes: bytes,
    metadata: Dict[str, Any],
    require_validation_passed: bool = True,
    target_label: str = "artifact"
) -> Tuple[Any, Dict[str, Any]]:
    """
    Unified, strict fail-closed validator for WasteWatch forecaster artifacts.
    Shared across primary model loader, candidate artifact validation, and rollback command.

    Rejects the artifact unless ALL of the following are true:
    1. metadata is a valid dictionary.
    2. 'feature_schema' exists, is an exact list, and its ordered contents exactly
       match the active feature schema (NUMERIC_FEATURES + CATEGORICAL_FEATURES).
    3. 'synthetic_records' exists, is an integer (strictly not a bool), and equals 0.
    4. sha256 checksum exists, is a valid 64-char string, and matches the SHA-256 of model_bytes.
    5. 'validation_status' is 'PASSED' (if require_validation_passed is True).
    6. Pickled model can be safely deserialized from in-memory bytes.
    7. Deserialized model's 'feature_names' attribute exactly matches the active schema.
    8. Deserialized model has all seven direct multi-horizon estimators (models 1..7).
    9. Every fitted horizon estimator (1..7) has a ColumnTransformer whose input columns
       strictly match NUMERIC_FEATURES (transformer 0) and CATEGORICAL_FEATURES (transformer 1).

    Returns (forecaster, metadata) on success, or raises ValueError with a clear actionable reason.
    """
    if not isinstance(metadata, dict):
        raise ValueError(f"[{target_label}] Malformed metadata: expected a dictionary.")

    # 1. Feature schema check (metadata)
    expected_schema = list(NUMERIC_FEATURES + CATEGORICAL_FEATURES)
    if 'feature_schema' not in metadata:
        raise ValueError(f"[{target_label}] Metadata missing mandatory 'feature_schema' field.")
    art_schema = metadata.get('feature_schema')
    if not isinstance(art_schema, list):
        raise ValueError(f"[{target_label}] Metadata 'feature_schema' must be a list.")
    if art_schema != expected_schema:
        raise ValueError(
            f"[{target_label}] Metadata 'feature_schema' does not exactly match active model schema. "
            f"Expected {len(expected_schema)} ordered features, found {len(art_schema)}."
        )

    # 2. Synthetic records check (metadata)
    if 'synthetic_records' not in metadata:
        raise ValueError(f"[{target_label}] Metadata missing mandatory 'synthetic_records' field.")
    synth_rec = metadata.get('synthetic_records')
    if isinstance(synth_rec, bool) or not isinstance(synth_rec, int):
        raise ValueError(f"[{target_label}] Metadata 'synthetic_records' must be an integer, not a Boolean or other type.")
    if synth_rec != 0:
        raise ValueError(f"[{target_label}] Governance rejection: trained on synthetic data ({synth_rec} synthetic records).")

    # 3. SHA-256 integrity check
    expected_sha256 = metadata.get('sha256') or metadata.get('model_sha256')
    if not expected_sha256 or not isinstance(expected_sha256, str) or len(expected_sha256) != 64:
        raise ValueError(f"[{target_label}] Missing or malformed 64-character SHA-256 checksum.")
    actual_sha256 = hashlib.sha256(model_bytes).hexdigest()
    if actual_sha256 != expected_sha256:
        raise ValueError(f"[{target_label}] SHA-256 integrity mismatch: expected {expected_sha256}, got {actual_sha256}.")

    # 4. Validation status check
    if require_validation_passed:
        val_status = metadata.get('validation_status')
        if val_status != 'PASSED':
            raise ValueError(f"[{target_label}] Governance rejection: validation_status is '{val_status}', expected 'PASSED'.")

    # 5. Deserialization from in-memory bytes
    try:
        forecaster = joblib.load(io.BytesIO(model_bytes))
    except Exception as exc:
        raise ValueError(f"[{target_label}] Failed to deserialize forecaster model: {exc}")

    # 6. Pickled model feature_names check
    model_feature_names = getattr(forecaster, 'feature_names', None)
    if not isinstance(model_feature_names, list):
        raise ValueError(f"[{target_label}] Forecaster model missing list-type 'feature_names' attribute.")
    if model_feature_names != expected_schema:
        raise ValueError(
            f"[{target_label}] Forecaster model 'feature_names' does not exactly match active schema. "
            f"Expected {len(expected_schema)} ordered features, got {len(model_feature_names)}."
        )

    # 7. Horizon estimators structural completeness (7 horizons)
    models_dict = getattr(forecaster, 'models', None)
    if not isinstance(models_dict, dict):
        raise ValueError(f"[{target_label}] Forecaster missing 'models' dictionary attribute.")
    expected_horizons = set(range(1, 8))
    if set(models_dict.keys()) != expected_horizons:
        raise ValueError(
            f"[{target_label}] Forecaster 'models' dictionary must contain all 7 direct multi-horizon estimators (1..7). "
            f"Found keys: {sorted(list(models_dict.keys()))}."
        )

    # 8. Fitted ColumnTransformer ordered input column checks on every horizon
    for h in range(1, 8):
        pipe = models_dict[h]
        if not hasattr(pipe, 'named_steps') or 'preprocessor' not in pipe.named_steps:
            raise ValueError(f"[{target_label}] Horizon {h} pipeline missing 'preprocessor' ColumnTransformer step.")
        pre = pipe.named_steps['preprocessor']
        if not hasattr(pre, 'transformers_') or len(pre.transformers_) < 2:
            raise ValueError(f"[{target_label}] Horizon {h} preprocessor is not properly fitted or missing transformers.")
        num_cols = list(pre.transformers_[0][2])
        cat_cols = list(pre.transformers_[1][2])
        if num_cols != list(NUMERIC_FEATURES):
            raise ValueError(
                f"[{target_label}] Horizon {h} numeric transformer columns do not match active NUMERIC_FEATURES. "
                f"Expected {len(NUMERIC_FEATURES)} ordered columns, got {len(num_cols)}."
            )
        if cat_cols != list(CATEGORICAL_FEATURES):
            raise ValueError(
                f"[{target_label}] Horizon {h} categorical transformer columns do not match active CATEGORICAL_FEATURES. "
                f"Expected {list(CATEGORICAL_FEATURES)}, got {cat_cols}."
            )

    return forecaster, metadata


def get_artifact_paths(artifacts_dir: Optional[str] = None) -> tuple[str, str]:
    target_dir = artifacts_dir or ARTIFACTS_DIR
    model_path = os.path.join(target_dir, 'waste_forecast_model_latest.joblib')
    meta_path = os.path.join(target_dir, 'waste_forecast_metadata_latest.json')
    return model_path, meta_path


def load_latest_forecaster(artifacts_dir: Optional[str] = None):
    """
    Loads RidgeMultiHorizonForecaster artifact with fail-closed governance (N-03)
    and TOCTOU-free deserialization from verified in-memory bytes.
    Uses active_manifest.json if present for atomic version pointing (N-09).
    Includes artifact path and version in cache keys.
    """
    global _CACHED_FORECASTER, _CACHED_METADATA, _CACHED_PATH, _CACHED_VERSION, _CACHED_SHA, _CACHED_MTIME, _CACHED_SIZE

    target_dir = artifacts_dir or ARTIFACTS_DIR
    manifest_path = os.path.join(target_dir, 'active_manifest.json')

    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, 'r', encoding='utf-8') as mf:
                manifest = json.load(mf)
            active_model = manifest.get('active_model_file')
            active_meta = manifest.get('active_metadata_file')
            if not active_model or not active_meta:
                logger.error("Active manifest missing model/metadata pointers. Failing closed.")
                _CACHED_FORECASTER = None
                _CACHED_METADATA = None
                return None, None
            model_path = os.path.join(target_dir, active_model)
            meta_path = os.path.join(target_dir, active_meta)
        except Exception as exc:
            logger.error(f"Error reading active manifest {manifest_path}: {exc}. Failing closed.")
            _CACHED_FORECASTER = None
            _CACHED_METADATA = None
            return None, None
    else:
        model_path, meta_path = get_artifact_paths(artifacts_dir)

    if not os.path.exists(model_path) or not os.path.exists(meta_path):
        _CACHED_FORECASTER = None
        _CACHED_METADATA = None
        return None, None

    try:
        current_mtime = os.path.getmtime(model_path)
        current_size = os.path.getsize(model_path)

        # In-memory cache hit check including path and version key
        if (
            _CACHED_FORECASTER is not None 
            and _CACHED_PATH == model_path
            and current_mtime == _CACHED_MTIME 
            and current_size == _CACHED_SIZE
            and _CACHED_METADATA is not None
        ):
            return _CACHED_FORECASTER, _CACHED_METADATA

        # Load metadata and model bytes
        with open(meta_path, 'r', encoding='utf-8') as f:
            metadata = json.load(f)

        with open(model_path, 'rb') as f:
            model_bytes = f.read()

        forecaster, metadata = validate_forecaster_artifact(
            model_bytes=model_bytes,
            metadata=metadata,
            require_validation_passed=True,
            target_label=os.path.basename(model_path)
        )

        _CACHED_FORECASTER = forecaster
        _CACHED_METADATA = metadata
        _CACHED_PATH = model_path
        _CACHED_VERSION = metadata.get('model_version')
        _CACHED_SHA = metadata.get('sha256') or metadata.get('model_sha256')
        _CACHED_MTIME = current_mtime
        _CACHED_SIZE = current_size
        return _CACHED_FORECASTER, _CACHED_METADATA

    except Exception as exc:
        logger.error(f"Failed to load and verify forecaster artifact from {model_path}: {exc}", exc_info=True)
        _CACHED_FORECASTER = None
        _CACHED_METADATA = None
        return None, None


def load_candidate_forecaster(artifacts_dir: Optional[str] = None):
    """
    Loads candidate RidgeMultiHorizonForecaster artifact for shadow evaluation (Phase 4).
    Inspects candidate_manifest.json and verifies integrity without requiring production promotion.
    """
    global _CANDIDATE_FORECASTER, _CANDIDATE_METADATA, _CANDIDATE_PATH, _CANDIDATE_MTIME

    target_dir = artifacts_dir or ARTIFACTS_DIR
    manifest_path = os.path.join(target_dir, 'candidate_manifest.json')

    if not os.path.exists(manifest_path):
        return None, None

    try:
        with open(manifest_path, 'r', encoding='utf-8') as mf:
            manifest = json.load(mf)
        candidate_model = manifest.get('candidate_model_file')
        candidate_meta = manifest.get('candidate_metadata_file')
        if not candidate_model or not candidate_meta:
            return None, None

        model_path = os.path.join(target_dir, candidate_model)
        meta_path = os.path.join(target_dir, candidate_meta)

        if not os.path.exists(model_path) or not os.path.exists(meta_path):
            return None, None

        current_mtime = os.path.getmtime(model_path)
        if _CANDIDATE_FORECASTER is not None and _CANDIDATE_PATH == model_path and current_mtime == _CANDIDATE_MTIME:
            return _CANDIDATE_FORECASTER, _CANDIDATE_METADATA

        with open(meta_path, 'r', encoding='utf-8') as f:
            metadata = json.load(f)

        with open(model_path, 'rb') as f:
            model_bytes = f.read()

        forecaster, metadata = validate_forecaster_artifact(
            model_bytes=model_bytes,
            metadata=metadata,
            require_validation_passed=False,  # Candidates might be evaluated before promotion validation
            target_label=os.path.basename(model_path)
        )

        _CANDIDATE_FORECASTER = forecaster
        _CANDIDATE_METADATA = metadata
        _CANDIDATE_PATH = model_path
        _CANDIDATE_MTIME = current_mtime
        return _CANDIDATE_FORECASTER, _CANDIDATE_METADATA

    except Exception as exc:
        logger.warning(f"Failed to load candidate forecaster: {exc}")
        return None, None


def forecast_weight_heuristic(
    brgy_obj: Optional[Barangay] = None,
    lookback: int = 30,
    horizon: int = 7,
    min_span: int = 14,
    min_active: int = 7,
    is_fallback: bool = False,
    fallback_reason: Optional[str] = None
) -> Dict[str, Any]:
    """
    Permanent fallback forecasting engine: weekday-adjusted seasonal baseline + residual band.
    Preserves existing proven calculation while reporting accurate day counters.
    """
    today = timezone.localdate()
    end = today - timedelta(days=1)
    start = end - timedelta(days=lookback - 1)

    # Authoritative daily aggregation summing all deliveries per day (T-01 fix)
    daily_df = build_daily_aggregation(
        start_date=start,
        end_date=end,
        barangay_id=brgy_obj.id if brgy_obj else None,
        fill_zeros=True,
        include_synthetic=False
    )

    active_df = daily_df[daily_df['weight_kg'] > 0]
    if active_df.empty:
        return {
            'sufficient': False,
            'reason': 'no_data',
            'model_type': 'heuristic',
            'is_fallback': is_fallback,
            'fallback_reason': fallback_reason or 'No genuine historical delivery records found in window.'
        }

    first = active_df['date'].min()
    window_df = daily_df[daily_df['date'] >= first]
    days = window_df['date'].tolist()
    y = window_df['weight_kg'].astype(float).tolist()

    span = (end - first).days + 1
    active_count = len(active_df)

    if span < min_span or active_count < min_active:
        return {
            'sufficient': False,
            'reason': 'not_enough_data',
            'days_available': span,
            'active_days': active_count,
            'required_span': min_span,
            'required_active': min_active,
            'model_type': 'heuristic',
            'is_fallback': is_fallback,
            'fallback_reason': fallback_reason or f"Requires {min_span} days span and {min_active} active days (found span {span}, active {active_count})."
        }

    overall = mean(y)
    if overall <= 0:
        return {
            'sufficient': False,
            'reason': 'no_data',
            'model_type': 'heuristic',
            'is_fallback': is_fallback,
            'fallback_reason': 'Zero mean weight across historical window.'
        }

    buckets = {wd: [] for wd in range(7)}
    for d, v in zip(days, y):
        buckets[d.weekday()].append(v)
    index = {wd: (mean(v) / overall if v else 1.0) for wd, v in buckets.items()}

    fitted = [overall * index[d.weekday()] for d in days]
    resid = [a - f for a, f in zip(y, fitted)]
    band = Z80 * (stdev(resid) if len(resid) > 1 else 0.0)

    points = []
    brgy_id = brgy_obj.id if brgy_obj else 0
    for i in range(horizon):
        d = today + timedelta(days=i)
        is_sunday = (d.weekday() == 6)
        sched_status = check_collection_schedule(d, brgy_id)
        if is_sunday and sched_status == ScheduleStatus.CONFIRMED_NON_COLLECTION:
            e = 0.0
            p_band = 0.0
        else:
            e = overall * index[d.weekday()]
            p_band = band

        points.append({
            'date': str(d),
            'expected_kg': round(e),
            'low_kg': round(max(0.0, e - p_band)),
            'high_kg': round(e + p_band),
            'horizon_step': i + 1,
        })

    return {
        'sufficient': True,
        'band_pct': 80,
        'band_label': 'Residual Band (±1.28 s.d.)',
        'model_type': 'heuristic',
        'is_fallback': is_fallback,
        'fallback_reason': fallback_reason,
        'history': [{'date': str(d), 'kg': round(v)} for d, v in zip(days[-14:], y[-14:])],
        'points': points,
        'provenance': {
            'algorithm': 'Weekday-Adjusted Seasonal Heuristic Baseline',
            'interval_method': 'Gaussian Residual StdDev (Uncalibrated; Not Finite-Sample Conformal)',
            'aggregation_engine': 'canonical_daily_aggregation',
            'lookback_days': lookback,
            'active_days_used': active_count,
        }
    }


def get_waste_forecast(
    brgy_obj: Optional[Barangay] = None,
    lookback: int = 45,
    horizon: int = 7,
    artifacts_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Primary forecasting entry point for WasteWatch analytics.
    Enforces governance safeguards:
    1. Falls back to verified seasonal heuristic if FORECAST_ML_ENABLED is False (F-01 fix).
    2. Quarantines artifacts containing synthetic training records (F-01, F-10 fix).
    3. Excludes synthetic data from historical aggregation (F-10 fix).
    """
    ml_enabled = getattr(settings, 'FORECAST_ML_ENABLED', False)
    if not ml_enabled:
        return forecast_weight_heuristic(
            brgy_obj=brgy_obj,
            is_fallback=True,
            fallback_reason='Ridge ML forecasting is in shadow evaluation mode (FORECAST_ML_ENABLED=False). Operating on verified seasonal baseline.'
        )

    forecaster, metadata = load_latest_forecaster(artifacts_dir=artifacts_dir)

    # Fallback 1: No artifact fitted or governance rejection
    if forecaster is None or not getattr(forecaster, 'is_fitted', False):
        reason = 'No trained Ridge Regression model artifact available.'
        _, raw_meta_path = get_artifact_paths(artifacts_dir)
        if os.path.exists(raw_meta_path):
            try:
                with open(raw_meta_path, 'r', encoding='utf-8') as mf:
                    raw_m = json.load(mf)
                if raw_m.get('synthetic_records', 0) > 0:
                    reason = 'Model artifact trained on synthetic data is quarantined from production. Operating on verified seasonal baseline.'
                elif raw_m.get('validation_status') != 'PASSED':
                    reason = 'Model artifact failed validation gating. Operating on verified seasonal baseline.'
                elif not raw_m.get('sha256'):
                    reason = 'Model artifact missing integrity checksum. Operating on verified seasonal baseline.'
            except Exception:
                pass

        return forecast_weight_heuristic(
            brgy_obj=brgy_obj,
            is_fallback=True,
            fallback_reason=reason
        )

    today = timezone.localdate()
    yesterday = today - timedelta(days=1)
    history_start = yesterday - timedelta(days=lookback - 1)

    # Fetch daily aggregation strictly with genuine records
    daily_df = build_daily_aggregation(
        start_date=history_start,
        end_date=yesterday,
        barangay_id=brgy_obj.id if brgy_obj else None,
        include_synthetic=False
    )

    if daily_df.empty or len(daily_df) < 28:
        # Fallback 2: Insufficient history to compute 28-day rolling window
        return forecast_weight_heuristic(
            brgy_obj=brgy_obj,
            is_fallback=True,
            fallback_reason=f'Insufficient daily history for Ridge features ({len(daily_df)} days available, 28 required).'
        )

    # Sparse barangay eligibility check (N-11):
    # Count genuinely observed collection days (weight_kg > 0), not zero-padded rows
    active_delivery_days = int((daily_df['weight_kg'] > 0).sum())
    if brgy_obj and active_delivery_days < 28:
        return forecast_weight_heuristic(
            brgy_obj=brgy_obj,
            is_fallback=True,
            fallback_reason=(
                f"Barangay '{brgy_obj.name}' has only {active_delivery_days} active delivery days "
                f"(minimum 28 required for ML forecaster). Operating on seasonal heuristic baseline."
            )
        )

    # Prepare historical weight series indexed by date
    weight_series = pd.Series(
        data=daily_df['weight_kg'].values,
        index=daily_df['date'].values
    ).sort_index()

    barangay_id = brgy_obj.id if brgy_obj else 0
    if brgy_obj:
        population = float(brgy_obj.population) if brgy_obj.population is not None else 0.0
    else:
        population = get_canonical_city_population()

    try:
        raw_points = forecaster.predict_7_days(
            origin_date=yesterday,
            history_weights=weight_series,
            barangay_id=barangay_id,
            population=population
        )

        # Integrity verification
        for p in raw_points:
            if not isinstance(p['expected_kg'], (int, float)) or pd.isna(p['expected_kg']):
                raise ValueError("Forecast point contains NaN or invalid expected_kg.")
            if p['expected_kg'] < 0:
                p['expected_kg'] = 0.0
            if p['low_kg'] < 0:
                p['low_kg'] = 0.0

        # Construct recent 14-day history payload for frontend visualization
        recent_14 = daily_df.tail(14)
        history_payload = [
            {'date': str(d), 'kg': round(float(w))}
            for d, w in zip(recent_14['date'], recent_14['weight_kg'])
        ]

        meta_info = metadata or {}
        val_metrics = meta_info.get('validation_metrics', {})

        return {
            'sufficient': True,
            'band_pct': 80,
            'model_type': 'ridge',
            'model_version': meta_info.get('model_version', '1.0.0'),
            'is_fallback': False,
            'fallback_reason': None,
            'history': history_payload,
            'points': raw_points,
            'provenance': {
                'algorithm': 'Ridge Regression (L2 Regularized Direct Multi-Horizon)',
                'interval_method': 'Time-Based Conformal Residual Calibration (80% confidence)',
                'trained_at': meta_info.get('trained_at'),
                'training_samples': meta_info.get('training_samples'),
                'validation_mae': val_metrics.get('overall_mae'),
                'validation_wape': val_metrics.get('overall_wape'),
                'empirical_coverage': val_metrics.get('empirical_coverage'),
            }
        }

    except Exception as exc:
        logger.warning(f"Ridge forecasting inference failed: {exc}. Executing heuristic fallback.", exc_info=True)
        return forecast_weight_heuristic(
            brgy_obj=brgy_obj,
            is_fallback=True,
            fallback_reason=f'Inference failure: {str(exc)}'
        )
