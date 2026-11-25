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
import sys
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
_CACHED_KEY = None

# Candidate model cache singleton (for shadow evaluation)
_CANDIDATE_FORECASTER = None
_CANDIDATE_METADATA = None
_CANDIDATE_PATH = None
_CANDIDATE_SHA = None
_CANDIDATE_MTIME = 0.0
_CANDIDATE_KEY = None

Z80 = 1.2816  # Heuristic fallback two-sided 80% Gaussian multiplier


def _build_cache_key(model_path, meta_path, model_mtime, model_size, meta_bytes, meta_sha, manifest_path=None):
    """
    Composite cache identity. A change in ANY component forces a full reload and
    re-validation through validate_forecaster_artifact():
      - model/metadata paths (manifest repointing)
      - model mtime and size (cheap filesystem change signal)
      - SHA-256 of the exact metadata bytes (metadata-only changes, including
        rollbacks where deterministic training produced identical model bytes)
      - declared model SHA-256 in metadata
      - SHA-256 of the exact manifest bytes, if a manifest governs the slot
    The model SHA alone is not a sufficient key: two artifacts can share identical
    model bytes while carrying different governance metadata.
    """
    manifest_digest = None
    if manifest_path and os.path.exists(manifest_path):
        with open(manifest_path, 'rb') as mf:
            manifest_digest = hashlib.sha256(mf.read()).hexdigest()
    return (
        model_path,
        meta_path,
        model_mtime,
        model_size,
        hashlib.sha256(meta_bytes).hexdigest(),
        meta_sha,
        manifest_digest,
    )


def _reset_latest_cache():
    global _CACHED_FORECASTER, _CACHED_METADATA, _CACHED_PATH, _CACHED_VERSION, _CACHED_SHA, _CACHED_MTIME, _CACHED_SIZE, _CACHED_KEY
    _CACHED_FORECASTER = None
    _CACHED_METADATA = None
    _CACHED_PATH = None
    _CACHED_VERSION = None
    _CACHED_SHA = None
    _CACHED_MTIME = 0.0
    _CACHED_SIZE = 0
    _CACHED_KEY = None


def _reset_candidate_cache():
    global _CANDIDATE_FORECASTER, _CANDIDATE_METADATA, _CANDIDATE_PATH, _CANDIDATE_SHA, _CANDIDATE_MTIME, _CANDIDATE_KEY
    _CANDIDATE_FORECASTER = None
    _CANDIDATE_METADATA = None
    _CANDIDATE_PATH = None
    _CANDIDATE_SHA = None
    _CANDIDATE_MTIME = 0.0
    _CANDIDATE_KEY = None


def verify_artifact_database_provenance(metadata: Dict[str, Any], min_distinct_days: int = 84) -> bool:
    """
    Independently verifies genuine observation evidence against the authoritative Django database.
    Recomputes distinct collection days from WasteDelivery records over the recorded training_window.

    Explicit limitation: This function requires database access and is used when verifying live system
    provenance. It cannot run in isolated offline environments without database connectivity.
    """
    training_window = metadata.get('training_window')
    if not isinstance(training_window, dict) or 'start_date' not in training_window or 'end_date' not in training_window:
        raise ValueError("Metadata missing valid 'training_window' dictionary with 'start_date' and 'end_date'.")

    from driver.models import WasteDelivery
    start_d = training_window['start_date']
    end_d = training_window['end_date']

    db_distinct_days = WasteDelivery.objects.filter(
        is_synthetic=False,
        date__range=[start_d, end_d]
    ).values('date').distinct().count()

    db_synthetic_count = WasteDelivery.objects.filter(
        is_synthetic=True,
        date__range=[start_d, end_d]
    ).count()

    if db_synthetic_count > 0:
        raise ValueError(f"Database evidence rejection: found {db_synthetic_count} synthetic records in training window.")

    if db_distinct_days < min_distinct_days:
        raise ValueError(
            f"Database evidence rejection: found {db_distinct_days} distinct genuine days in window [{start_d}..{end_d}], "
            f"minimum {min_distinct_days} required."
        )

    expected_dgd = metadata.get('distinct_genuine_days')
    if expected_dgd is not None and db_distinct_days < expected_dgd:
        raise ValueError(
            f"Database evidence mismatch: database has {db_distinct_days} distinct genuine days, metadata claims {expected_dgd}."
        )

    return True


def validate_forecaster_artifact(
    model_bytes: bytes,
    metadata: Dict[str, Any],
    require_validation_passed: bool = True,
    require_promotion_eligible: bool = True,
    target_label: str = "artifact",
    verify_db_records: bool = False,
) -> Tuple[Any, Dict[str, Any]]:
    """
    Unified, strict fail-closed validator for WasteWatch forecaster artifacts.
    Shared across primary model loader, candidate artifact validation, and rollback command.

    Rejects the artifact unless ALL of the following are true:
    1. metadata is a valid non-empty dictionary.
    2. 'feature_schema' exists, is an exact list, and its ordered contents exactly
       match the active feature schema (NUMERIC_FEATURES + CATEGORICAL_FEATURES).
    3. 'synthetic_records' exists, is an integer (strictly not a bool), and equals 0.
    4. 'distinct_genuine_days' exists, is a non-negative integer (strictly not a bool).
    5. 'is_promotion_eligible' exists, is strictly a boolean.
    6. 'validation_status' exists, is a non-empty string in {'PASSED', 'FAILED', 'PENDING'}.
    7. 'genuine_records' (if present) is an integer >= distinct_genuine_days.
    8. sha256 checksum exists, is a valid 64-char string, and matches the SHA-256 of model_bytes.
    9. 'library_versions' exists, is a dictionary containing 'sklearn', 'joblib', and 'python',
       and its versions are strictly compatible with the current runtime environment.
    10. Gated eligibility checks:
        - If require_promotion_eligible is True (production loading and rollback):
          - 'is_promotion_eligible' must be strictly True.
          - 'distinct_genuine_days' must be an integer >= 84.
          - 'genuine_records' (if present) must be >= 84.
          - 'validation_status' must equal 'PASSED' (if require_validation_passed is True).
        - If require_promotion_eligible is False (candidate shadow evaluation):
          - 'is_promotion_eligible' can be False or True.
          - 'distinct_genuine_days' can be any non-negative integer (no artificial loader-level threshold).
          - 'validation_status' must equal 'PASSED' (if require_validation_passed is True).
    11. If verify_db_records is True, verify_artifact_database_provenance() passes.
    12. Pickled model can be safely deserialized from in-memory bytes.
    13. Deserialized model's 'feature_names' attribute exactly matches the active schema.
    14. Deserialized model has all seven direct multi-horizon estimators (models 1..7).
    15. Every fitted horizon estimator (1..7) has a ColumnTransformer whose input columns
        strictly match NUMERIC_FEATURES (transformer 0) and CATEGORICAL_FEATURES (transformer 1).

    LIMITATION ON OFFLINE ARTIFACT INTEGRITY VS LIVE DATABASE PROVENANCE:
    When inspecting serialized artifacts in isolation from the database (e.g. offline verification,
    CLI inspection, or containerized execution), validate_forecaster_artifact validates internal
    cryptographic integrity and the formal typed schema of the metadata provenance record.
    To independently verify genuine weighbridge records against the database, callers can supply
    verify_db_records=True or invoke verify_artifact_database_provenance().

    Returns (forecaster, metadata) on success, or raises ValueError with a clear actionable reason.
    """
    if not isinstance(metadata, dict) or not metadata:
        raise ValueError(f"[{target_label}] Malformed or empty metadata: expected a non-empty dictionary.")

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

    # 3. Distinct genuine days check (mandatory metadata presence and type)
    if 'distinct_genuine_days' not in metadata:
        raise ValueError(f"[{target_label}] Metadata missing mandatory 'distinct_genuine_days' field.")
    dgd = metadata.get('distinct_genuine_days')
    if isinstance(dgd, bool) or not isinstance(dgd, int):
        raise ValueError(f"[{target_label}] Metadata 'distinct_genuine_days' must be an integer, not {type(dgd).__name__}.")
    if dgd < 0:
        raise ValueError(f"[{target_label}] Metadata 'distinct_genuine_days' cannot be negative ({dgd}).")

    # 4. Promotion eligibility check (mandatory metadata presence and type)
    if 'is_promotion_eligible' not in metadata:
        raise ValueError(f"[{target_label}] Metadata missing mandatory 'is_promotion_eligible' field.")
    promo_eligible = metadata.get('is_promotion_eligible')
    if not isinstance(promo_eligible, bool):
        raise ValueError(f"[{target_label}] Metadata 'is_promotion_eligible' must be a boolean, not {type(promo_eligible).__name__}.")

    # 5. Validation status check (mandatory metadata presence and type)
    if 'validation_status' not in metadata:
        raise ValueError(f"[{target_label}] Metadata missing mandatory 'validation_status' field.")
    val_status = metadata.get('validation_status')
    if not isinstance(val_status, str) or not val_status:
        raise ValueError(f"[{target_label}] Metadata 'validation_status' must be a non-empty string.")
    allowed_statuses = {'PASSED', 'FAILED', 'PENDING'}
    if val_status not in allowed_statuses:
        raise ValueError(
            f"[{target_label}] Metadata 'validation_status' has invalid value '{val_status}'. "
            f"Expected one of {sorted(list(allowed_statuses))}."
        )

    # 6. Genuine records consistency check (if present)
    if 'genuine_records' in metadata:
        gr = metadata.get('genuine_records')
        if isinstance(gr, bool) or not isinstance(gr, int):
            raise ValueError(f"[{target_label}] Metadata 'genuine_records' must be an integer, not {type(gr).__name__}.")
        if gr < dgd:
            raise ValueError(f"[{target_label}] Metadata inconsistency: distinct_genuine_days ({dgd}) exceeds genuine_records ({gr}).")

    # 7. SHA-256 integrity check
    expected_sha256 = metadata.get('sha256') or metadata.get('model_sha256')
    if not expected_sha256 or not isinstance(expected_sha256, str) or len(expected_sha256) != 64 or not all(c in '0123456789abcdefABCDEF' for c in expected_sha256):
        raise ValueError(f"[{target_label}] Missing or malformed 64-character SHA-256 checksum.")
    actual_sha256 = hashlib.sha256(model_bytes).hexdigest()
    if actual_sha256.lower() != expected_sha256.lower():
        raise ValueError(f"[{target_label}] SHA-256 integrity mismatch: expected {expected_sha256}, got {actual_sha256}.")

    # 8. Library version compatibility check (Requirement D)
    if 'library_versions' not in metadata:
        raise ValueError(f"[{target_label}] Metadata missing mandatory 'library_versions' dictionary.")
    lib_vers = metadata.get('library_versions')
    if not isinstance(lib_vers, dict):
        raise ValueError(f"[{target_label}] Metadata 'library_versions' must be a dictionary.")

    required_libs = ['sklearn', 'joblib', 'python']
    for req_lib in required_libs:
        if req_lib not in lib_vers or not isinstance(lib_vers[req_lib], str):
            raise ValueError(f"[{target_label}] Metadata 'library_versions' missing required string key: '{req_lib}'.")

    def _parse_major_minor(v_str: str) -> Tuple[int, int]:
        parts = v_str.split('.')
        if len(parts) < 2:
            raise ValueError(f"Malformed version string '{v_str}'")
        return int(parts[0]), int(parts[1])

    # scikit-learn compatibility: major.minor must match runtime
    import sklearn
    rt_sklearn_mm = _parse_major_minor(sklearn.__version__)
    try:
        art_sklearn_mm = _parse_major_minor(lib_vers['sklearn'])
    except Exception:
        raise ValueError(f"[{target_label}] Malformed artifact scikit-learn version '{lib_vers['sklearn']}'.")
    if art_sklearn_mm != rt_sklearn_mm:
        raise ValueError(
            f"[{target_label}] Incompatible scikit-learn version: artifact was serialized with "
            f"scikit-learn {lib_vers['sklearn']}, but runtime is {sklearn.__version__}. "
            f"Pickled estimator compatibility requires matching major.minor ({rt_sklearn_mm[0]}.{rt_sklearn_mm[1]}.x)."
        )

    # Python compatibility: major.minor must match runtime
    rt_py_mm = sys.version_info[:2]
    try:
        art_py_mm = _parse_major_minor(lib_vers['python'])
    except Exception:
        raise ValueError(f"[{target_label}] Malformed artifact Python version '{lib_vers['python']}'.")
    if art_py_mm != rt_py_mm:
        raise ValueError(
            f"[{target_label}] Incompatible Python version: artifact was serialized under Python "
            f"{lib_vers['python']}, but runtime is {sys.version.split()[0]}."
        )

    # joblib compatibility: major.minor must match runtime
    rt_joblib_mm = _parse_major_minor(joblib.__version__)
    try:
        art_joblib_mm = _parse_major_minor(lib_vers['joblib'])
    except Exception:
        raise ValueError(f"[{target_label}] Malformed artifact joblib version '{lib_vers['joblib']}'.")
    if art_joblib_mm != rt_joblib_mm:
        raise ValueError(
            f"[{target_label}] Incompatible joblib version: artifact was serialized under joblib "
            f"{lib_vers['joblib']}, but runtime is {joblib.__version__}."
        )

    # numpy compatibility: if present, major version must match runtime
    if 'numpy' in lib_vers and isinstance(lib_vers['numpy'], str):
        import numpy as np
        rt_np_major = int(np.__version__.split('.')[0])
        try:
            art_np_major = int(lib_vers['numpy'].split('.')[0])
        except Exception:
            raise ValueError(f"[{target_label}] Malformed artifact numpy version '{lib_vers['numpy']}'.")
        if art_np_major != rt_np_major:
            raise ValueError(
                f"[{target_label}] Incompatible numpy version: artifact was serialized under numpy "
                f"{lib_vers['numpy']}, but runtime is {np.__version__} (ABI major mismatch)."
            )

    # 9. Gated Promotion Eligibility Checks
    if require_promotion_eligible:
        if promo_eligible is not True:
            raise ValueError(f"[{target_label}] Governance rejection: artifact metadata explicitly marks 'is_promotion_eligible' as False.")

        if dgd < 84:
            raise ValueError(
                f"[{target_label}] Governance rejection: insufficient distinct genuine collection days "
                f"({dgd} found, 84 required for production promotion)."
            )

        if 'genuine_records' in metadata and metadata['genuine_records'] < 84:
            raise ValueError(
                f"[{target_label}] Governance rejection: insufficient genuine records "
                f"({metadata['genuine_records']} found, 84 required for production promotion)."
            )

        if require_validation_passed and val_status != 'PASSED':
            raise ValueError(f"[{target_label}] Governance rejection: validation_status is '{val_status}', expected 'PASSED'.")
    else:
        # Candidate mode: if validation passed is explicitly required
        if require_validation_passed and val_status != 'PASSED':
            raise ValueError(f"[{target_label}] Candidate rejection: validation_status is '{val_status}', expected 'PASSED'.")

    # 10. Live Database Evidence Verification (if requested)
    if verify_db_records:
        verify_artifact_database_provenance(metadata, min_distinct_days=84 if require_promotion_eligible else 1)

    # 6. Deserialization from in-memory bytes
    try:
        forecaster = joblib.load(io.BytesIO(model_bytes))
    except Exception as exc:
        raise ValueError(f"[{target_label}] Failed to deserialize forecaster model: {exc}")

    # 7. Pickled model feature_names check
    model_feature_names = getattr(forecaster, 'feature_names', None)
    if not isinstance(model_feature_names, list):
        raise ValueError(f"[{target_label}] Forecaster model missing list-type 'feature_names' attribute.")
    if model_feature_names != expected_schema:
        raise ValueError(
            f"[{target_label}] Forecaster model 'feature_names' does not exactly match active schema. "
            f"Expected {len(expected_schema)} ordered features, got {len(model_feature_names)}."
        )

    # 8. Horizon estimators structural completeness (7 horizons)
    models_dict = getattr(forecaster, 'models', None)
    if not isinstance(models_dict, dict):
        raise ValueError(f"[{target_label}] Forecaster missing 'models' dictionary attribute.")
    expected_horizons = set(range(1, 8))
    if set(models_dict.keys()) != expected_horizons:
        raise ValueError(
            f"[{target_label}] Forecaster 'models' dictionary must contain all 7 direct multi-horizon estimators (1..7). "
            f"Found keys: {sorted(list(models_dict.keys()))}."
        )

    # 9. Fitted ColumnTransformer ordered input column checks on every horizon
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
    Includes verified cryptographic content SHA and version in cache validation
    to prevent stale cache hits on identical filesystem timestamps (Remediation E).
    """
    global _CACHED_FORECASTER, _CACHED_METADATA, _CACHED_PATH, _CACHED_VERSION, _CACHED_SHA, _CACHED_MTIME, _CACHED_SIZE, _CACHED_KEY

    target_dir = artifacts_dir or ARTIFACTS_DIR
    manifest_path = os.path.join(target_dir, 'active_manifest.json')

    manifest_sha = None
    manifest_version = None

    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, 'r', encoding='utf-8') as mf:
                manifest = json.load(mf)
            active_model = manifest.get('active_model_file') or manifest.get('model_file')
            active_meta = manifest.get('active_metadata_file') or manifest.get('metadata_file')
            manifest_sha = manifest.get('sha256')
            manifest_version = manifest.get('model_version')
            if not active_model or not active_meta:
                logger.error("Active manifest missing model/metadata pointers. Failing closed.")
                _reset_latest_cache()
                return None, None
            model_path = os.path.join(target_dir, active_model)
            meta_path = os.path.join(target_dir, active_meta)
        except Exception as exc:
            logger.error(f"Error reading active manifest {manifest_path}: {exc}. Failing closed.")
            _reset_latest_cache()
            return None, None
    else:
        model_path, meta_path = get_artifact_paths(artifacts_dir)

    if not os.path.exists(model_path) or not os.path.exists(meta_path):
        _reset_latest_cache()
        return None, None

    try:
        current_mtime = os.path.getmtime(model_path)
        current_size = os.path.getsize(model_path)

        # Metadata is small: always read it and hash its exact bytes so that a
        # metadata-only change (e.g. identical deterministic model bytes with a
        # different model_version) can never be served from a stale cache.
        with open(meta_path, 'rb') as f:
            meta_bytes = f.read()
        metadata = json.loads(meta_bytes.decode('utf-8'))
        meta_sha = metadata.get('sha256') or metadata.get('model_sha256')

        cache_key = _build_cache_key(
            model_path, meta_path, current_mtime, current_size,
            meta_bytes, meta_sha, manifest_path if os.path.exists(manifest_path) else None,
        )
        if (
            _CACHED_FORECASTER is not None
            and _CACHED_METADATA is not None
            and _CACHED_KEY == cache_key
        ):
            return _CACHED_FORECASTER, _CACHED_METADATA

        # Cache miss or artifact replaced: read model bytes and validate
        with open(model_path, 'rb') as f:
            model_bytes = f.read()

        forecaster, metadata = validate_forecaster_artifact(
            model_bytes=model_bytes,
            metadata=metadata,
            require_validation_passed=True,
            require_promotion_eligible=True,
            target_label=os.path.basename(model_path)
        )

        _CACHED_FORECASTER = forecaster
        _CACHED_METADATA = metadata
        _CACHED_PATH = model_path
        _CACHED_VERSION = metadata.get('model_version')
        _CACHED_SHA = hashlib.sha256(model_bytes).hexdigest()
        _CACHED_MTIME = current_mtime
        _CACHED_SIZE = current_size
        _CACHED_KEY = cache_key
        return _CACHED_FORECASTER, _CACHED_METADATA

    except Exception as exc:
        logger.error(f"Failed to load and verify forecaster artifact from {model_path}: {exc}", exc_info=True)
        _reset_latest_cache()
        return None, None


def load_candidate_forecaster(artifacts_dir: Optional[str] = None):
    """
    Loads candidate RidgeMultiHorizonForecaster artifact for shadow evaluation (Phase 4).
    Inspects candidate_manifest.json and verifies integrity without requiring production promotion.
    Includes verified cryptographic content SHA in cache validation to prevent stale cache hits.
    """
    global _CANDIDATE_FORECASTER, _CANDIDATE_METADATA, _CANDIDATE_PATH, _CANDIDATE_SHA, _CANDIDATE_MTIME, _CANDIDATE_KEY

    target_dir = artifacts_dir or ARTIFACTS_DIR
    manifest_path = os.path.join(target_dir, 'candidate_manifest.json')

    if not os.path.exists(manifest_path):
        _reset_candidate_cache()
        return None, None

    try:
        with open(manifest_path, 'r', encoding='utf-8') as mf:
            manifest = json.load(mf)
        candidate_model = manifest.get('candidate_model_file') or manifest.get('model_file')
        candidate_meta = manifest.get('candidate_metadata_file') or manifest.get('metadata_file')
        candidate_sha = manifest.get('sha256')
        if not candidate_model or not candidate_meta:
            _reset_candidate_cache()
            return None, None

        model_path = os.path.join(target_dir, candidate_model)
        meta_path = os.path.join(target_dir, candidate_meta)

        if not os.path.exists(model_path) or not os.path.exists(meta_path):
            _reset_candidate_cache()
            return None, None

        current_mtime = os.path.getmtime(model_path)
        current_size = os.path.getsize(model_path)

        with open(meta_path, 'rb') as f:
            meta_bytes = f.read()
        metadata = json.loads(meta_bytes.decode('utf-8'))
        meta_sha = metadata.get('sha256') or metadata.get('model_sha256')

        cache_key = _build_cache_key(
            model_path, meta_path, current_mtime, current_size,
            meta_bytes, meta_sha, manifest_path,
        )
        if (
            _CANDIDATE_FORECASTER is not None
            and _CANDIDATE_METADATA is not None
            and _CANDIDATE_KEY == cache_key
        ):
            return _CANDIDATE_FORECASTER, _CANDIDATE_METADATA

        with open(model_path, 'rb') as f:
            model_bytes = f.read()

        forecaster, metadata = validate_forecaster_artifact(
            model_bytes=model_bytes,
            metadata=metadata,
            require_validation_passed=False,  # Candidates might be evaluated before promotion validation
            require_promotion_eligible=False,
            target_label=os.path.basename(model_path)
        )

        _CANDIDATE_FORECASTER = forecaster
        _CANDIDATE_METADATA = metadata
        _CANDIDATE_PATH = model_path
        _CANDIDATE_SHA = hashlib.sha256(model_bytes).hexdigest()
        _CANDIDATE_MTIME = current_mtime
        _CANDIDATE_KEY = cache_key
        return _CANDIDATE_FORECASTER, _CANDIDATE_METADATA

    except Exception as exc:
        logger.warning(f"Failed to load candidate forecaster: {exc}")
        _reset_candidate_cache()
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
