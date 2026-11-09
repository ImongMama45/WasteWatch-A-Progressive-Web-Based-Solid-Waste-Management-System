"""
forecasting/management/commands/train_waste_forecast.py
-------------------------------------------------------
Offline training management command for WasteWatch Ridge Regression forecasting engine.
Implements leak-free chronological validation, multi-horizon feature matrices,
and canonical heuristic comparison under strict governance (Directive Phase 5).
"""

import os
import json
import shutil
import hashlib
import platform
from datetime import date, timedelta
from typing import Dict, Any, List, Optional

import numpy as np
import pandas as pd
import sklearn
import joblib
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.conf import settings

from accounts.models import Barangay
from dumpsite.models import WasteDelivery
from forecasting.aggregation import build_daily_aggregation
from forecasting.features import (
    generate_training_matrix,
    build_feature_vector_for_origin,
    check_collection_schedule,
    ScheduleStatus,
    HorizonFeatureDict,
    get_canonical_city_population,
)
from forecasting.models import RidgeMultiHorizonForecaster


class Command(BaseCommand):
    help = "Trains, validates, and artifacts the WasteWatch Ridge Regression forecasting model offline."

    def add_arguments(self, parser):
        parser.add_argument(
            '--lookback',
            type=int,
            default=120,
            help="Days of historical delivery records to aggregate for training (default: 120)."
        )
        parser.add_argument(
            '--n-splits',
            type=int,
            default=4,
            help="Number of expanding TimeSeriesSplit folds for chronological CV (default: 4)."
        )
        parser.add_argument(
            '--threshold-pct',
            type=float,
            default=5.0,
            help="Minimum MAE percentage improvement over heuristic baseline required for promotion (default: 5.0%%)."
        )
        parser.add_argument(
            '--allow-synthetic',
            action='store_true',
            help="Allow training on synthetic records for development/shadow testing (strictly quarantined from production)."
        )
        parser.add_argument(
            '--force-promote',
            action='store_true',
            help="Force promotion to production active_manifest.json (strictly prohibited for synthetic data or <84 genuine days)."
        )
        parser.add_argument(
            '--output-dir',
            type=str,
            default=None,
            help="Custom directory to store model artifacts."
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING("=== WasteWatch Waste Forecasting Training Pipeline ==="))

        lookback = options['lookback']
        n_splits = options['n_splits']
        threshold_pct = options['threshold_pct']
        allow_synthetic = options['allow_synthetic']
        force_promote = options.get('force_promote', False)

        artifacts_dir = options['output_dir'] or getattr(
            settings,
            'FORECASTING_ARTIFACTS_DIR',
            os.path.join(settings.BASE_DIR, 'forecasting', 'artifacts')
        )
        os.makedirs(artifacts_dir, exist_ok=True)

        today = timezone.localdate()
        yesterday = today - timedelta(days=1)
        start_date = yesterday - timedelta(days=lookback - 1)

        self.stdout.write(f"Training Window: {start_date} to {yesterday} ({lookback} calendar days)")

        # Audit finding N-10: Check genuine distinct collection days
        distinct_genuine_days = WasteDelivery.objects.filter(
            is_synthetic=False,
            date__range=[start_date, yesterday]
        ).values('date').distinct().count()

        genuine_count = WasteDelivery.objects.filter(
            is_synthetic=False,
            date__range=[start_date, yesterday]
        ).count()

        synthetic_count = WasteDelivery.objects.filter(
            is_synthetic=True,
            date__range=[start_date, yesterday]
        ).count()

        self.stdout.write(f"Authoritative genuine WasteDelivery records in window: {genuine_count}")
        self.stdout.write(f"Distinct genuine collection days in window: {distinct_genuine_days}")
        self.stdout.write(f"Synthetic records detected in window: {synthetic_count}")

        if distinct_genuine_days < 28 and not allow_synthetic:
            raise CommandError(
                f"Insufficient genuine collection days ({distinct_genuine_days} distinct days, minimum 28 days required to train). "
                "Per CENRO governance directives, production models cannot be trained or promoted on synthetic data. "
                "Use --allow-synthetic only for non-production development testing."
            )

        if allow_synthetic and synthetic_count > 0:
            self.stdout.write(self.style.WARNING(
                "CAUTION: --allow-synthetic enabled. Including synthetic data for development/shadow pipeline testing. "
                "This artifact will be quarantined and cannot be promoted as production-primary."
            ))

        # 1. Build city-wide daily dataset with canonical city population (T-02 fix)
        self.stdout.write("Aggregating daily city-wide waste series...")
        city_df = build_daily_aggregation(
            start_date=start_date,
            end_date=yesterday,
            barangay_id=None,
            fill_zeros=True,
            include_synthetic=allow_synthetic
        )
        city_df['barangay_id'] = 0
        canonical_city_pop = get_canonical_city_population()
        city_df['population'] = float(canonical_city_pop)

        # 2. Build pooled barangay dataset
        self.stdout.write("Aggregating pooled barangay panel dataset...")
        barangays = list(Barangay.objects.all())
        all_series = [city_df]

        for b in barangays:
            b_df = build_daily_aggregation(
                start_date=start_date,
                end_date=yesterday,
                barangay_id=b.id,
                fill_zeros=True,
                include_synthetic=allow_synthetic
            )
            if b_df['weight_kg'].sum() > 0:
                b_df['barangay_id'] = b.id
                b_df['population'] = float(b.population) if b.population is not None else 0.0
                all_series.append(b_df)

        self.stdout.write(f"Loaded {len(all_series)} distinct series (1 city-wide + {len(all_series) - 1} active barangays).")

        # 3. Generate Multi-Horizon Training Matrices with HorizonFeatureDict (N-01 fix)
        self.stdout.write("Generating leak-free multi-horizon feature matrices...")
        series_features: List[HorizonFeatureDict] = []
        series_targets: List[Dict[int, pd.Series]] = []

        for s_df in all_series:
            if len(s_df) >= 35:
                try:
                    X_dict_s, y_s = generate_training_matrix(s_df, horizon=7, min_history_required=28)
                    series_features.append(X_dict_s)
                    series_targets.append(y_s)
                except Exception as e:
                    self.stdout.write(self.style.WARNING(f"Skipping series {s_df['barangay_id'].iloc[0]}: {e}"))

        if not series_features:
            raise CommandError("Could not construct training matrices. Insufficient consecutive series.")

        # Pool series for each horizon h, preserving chronological sorting by [origin_date, barangay_id]
        pooled_dict = {}
        y_full = {}
        for h in range(1, 8):
            h_dfs = []
            for feat_dict, targ_dict in zip(series_features, series_targets):
                df_h = feat_dict[h].copy()
                df_h['__target'] = targ_dict[h].values
                h_dfs.append(df_h)

            combined_h = pd.concat(h_dfs, ignore_index=True)
            combined_h['barangay_id_int'] = pd.to_numeric(combined_h['barangay_id'], errors='coerce').fillna(0).astype(int)
            combined_h = combined_h.sort_values(by=['origin_date', 'barangay_id_int']).reset_index(drop=True)
            combined_h = combined_h.drop(columns=['barangay_id_int'])

            y_full[h] = combined_h['__target']
            pooled_dict[h] = combined_h.drop(columns=['__target'])

        X_full = HorizonFeatureDict(pooled_dict)
        n_samples = len(X_full)
        unique_origins = X_full.origin_dates.nunique() if hasattr(X_full, 'origin_dates') else len(X_full)
        self.stdout.write(self.style.SUCCESS(
            f"Feature matrix built successfully: {n_samples} pooled training rows across {unique_origins} unique origin dates."
        ))

        # 4. Synchronized Chronological Evaluation comparing Ridge vs Canonical Heuristic (Directive Phase 5)
        self.stdout.write("Evaluating Ridge vs Heuristic on identical chronological test origins...")
        eval_comparison = self._evaluate_synchronized_gating(X_full, y_full, n_splits=n_splits)

        city_eval = eval_comparison['city']
        brgy_eval = eval_comparison['barangay']
        horizon_eval = eval_comparison['horizons']

        self.stdout.write("\n=== SYNCHRONIZED EVALUATION RESULTS ===")
        self.stdout.write(f"City-Wide:  Ridge MAE = {city_eval['ridge_mae']:.1f} kg | Heuristic MAE = {city_eval['heuristic_mae']:.1f} kg | Diff = {city_eval['diff_pct']:+.2f}%")
        self.stdout.write(f"Barangay:   Ridge MAE = {brgy_eval['ridge_mae']:.1f} kg | Heuristic MAE = {brgy_eval['heuristic_mae']:.1f} kg | Diff = {brgy_eval['diff_pct']:+.2f}%")
        self.stdout.write("Horizon Breakdown:")
        for h in range(1, 8):
            h_res = horizon_eval.get(h, {})
            self.stdout.write(f"  H={h}: Ridge MAE = {h_res.get('ridge_mae', 0):.1f} kg | Heur MAE = {h_res.get('heuristic_mae', 0):.1f} kg | Diff = {h_res.get('diff_pct', 0):+.2f}%")

        # 5. Fit & Calibrate Final Ridge Multi-Horizon Forecaster
        self.stdout.write("\nFitting Final Ridge Forecaster & Calibrating Conformal Residual Intervals...")
        forecaster = RidgeMultiHorizonForecaster(horizon=7)
        ridge_metrics = forecaster.fit_and_calibrate(X_full, y_full, n_cv_splits=n_splits)

        effective_synthetic_count = int(synthetic_count) if allow_synthetic else 0
        overall_improvement_pct = eval_comparison['overall']['diff_pct']

        # Governance rule: synthetic data can NEVER be promoted to production (N-10, Directive Phase 5)
        # Production promotion requires >= 84 distinct genuine collection days and completion of 8-week shadow mode
        is_governance_eligible = (effective_synthetic_count == 0) and (distinct_genuine_days >= 84)
        meets_accuracy_threshold = (overall_improvement_pct >= threshold_pct)

        # By default, production promotion is strictly PROHIBITED per Directive Section 1
        should_promote = False
        if force_promote:
            if not is_governance_eligible:
                raise CommandError(
                    f"Force promote rejected: insufficient genuine data ({distinct_genuine_days} distinct days, 84 required) "
                    f"or synthetic records present ({effective_synthetic_count})."
                )
            if not meets_accuracy_threshold:
                raise CommandError(
                    f"Force promote rejected: model improvement ({overall_improvement_pct:.2f}%) below threshold ({threshold_pct:.1f}%)."
                )
            should_promote = True

        timestamp_str = timezone.now().strftime("%Y%m%d_%H%M%S")
        version_str = f"ridge_v{timestamp_str}"

        # 6. Persistence with SHA-256 integrity hash & metadata verification (N-03, N-09)
        model_filename = f"waste_forecast_model_{version_str}.joblib"
        meta_filename = f"waste_forecast_metadata_{version_str}.json"
        versioned_model_path = os.path.join(artifacts_dir, model_filename)
        versioned_meta_path = os.path.join(artifacts_dir, meta_filename)

        joblib.dump(forecaster, versioned_model_path)

        with open(versioned_model_path, 'rb') as f:
            model_sha256 = hashlib.sha256(f.read()).hexdigest()

        metadata = {
            'model_version': version_str,
            'model_type': 'ridge_regression',
            'trained_at': timezone.now().isoformat(),
            'training_window': {'start_date': str(start_date), 'end_date': str(yesterday), 'days': lookback},
            'genuine_records': genuine_count,
            'distinct_genuine_days': distinct_genuine_days,
            'synthetic_records': int(effective_synthetic_count),
            'training_samples': n_samples,
            'unique_origin_dates': unique_origins,
            'canonical_city_population': canonical_city_pop,
            'feature_count': len(forecaster.feature_names),
            'feature_schema': forecaster.feature_names,
            'library_versions': {
                'python': platform.python_version(),
                'sklearn': sklearn.__version__,
                'numpy': np.__version__,
                'pandas': pd.__version__,
                'joblib': joblib.__version__,
            },
            'model_sha256': model_sha256,
            'sha256': model_sha256,
            'validation_status': 'PASSED' if meets_accuracy_threshold else 'FAILED',
            'is_promotion_eligible': should_promote,
            'synchronized_evaluation': eval_comparison,
            'validation_metrics': ridge_metrics,
            'relative_improvement_pct': round(overall_improvement_pct, 2),
            'promoted_to_production': should_promote,
            'gate_threshold_pct': threshold_pct,
            'quarantine_reason': None if is_governance_eligible else (
                "Model trained on synthetic data." if effective_synthetic_count > 0 else
                f"Insufficient distinct genuine days ({distinct_genuine_days} found, 84 required)."
            ),
        }

        with open(versioned_meta_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2)

        self.stdout.write(f"Saved versioned artifact: {versioned_model_path} (SHA-256: {model_sha256[:12]}...)")

        # 7. Candidate Manifest for Shadow Evaluation (Directive Phase 4)
        if effective_synthetic_count == 0 and distinct_genuine_days >= 28:
            candidate_manifest_path = os.path.join(artifacts_dir, 'candidate_manifest.json')
            candidate_tmp = os.path.join(artifacts_dir, f".tmp_candidate_{version_str}.json")
            candidate_data = {
                'candidate_model_file': model_filename,
                'candidate_metadata_file': meta_filename,
                'model_version': version_str,
                'evaluated_at': timezone.now().isoformat(),
                'sha256': model_sha256,
                'distinct_genuine_days': distinct_genuine_days,
                'synthetic_records': 0,
                'is_shadow_candidate': True,
                'is_promotion_eligible': False,
            }
            with open(candidate_tmp, 'w', encoding='utf-8') as cf:
                json.dump(candidate_data, cf, indent=2)
            os.replace(candidate_tmp, candidate_manifest_path)
            self.stdout.write(self.style.SUCCESS(
                f"Registered candidate artifact for shadow evaluation: candidate_manifest.json -> {model_filename}"
            ))

        # 8. Production Promotion (Only if explicitly force-promoted and legally eligible)
        latest_model_path = os.path.join(artifacts_dir, 'waste_forecast_model_latest.joblib')
        latest_meta_path = os.path.join(artifacts_dir, 'waste_forecast_metadata_latest.json')
        prev_model_path = os.path.join(artifacts_dir, 'waste_forecast_model_prev.joblib')
        prev_meta_path = os.path.join(artifacts_dir, 'waste_forecast_metadata_prev.json')

        if should_promote:
            if os.path.exists(latest_model_path):
                shutil.copy2(latest_model_path, prev_model_path)
                if os.path.exists(latest_meta_path):
                    shutil.copy2(latest_meta_path, prev_meta_path)
                self.stdout.write("Backed up previous production model to waste_forecast_model_prev.joblib")

            tmp_model = os.path.join(artifacts_dir, f".tmp_latest_{version_str}.joblib")
            tmp_meta = os.path.join(artifacts_dir, f".tmp_latest_{version_str}.json")
            shutil.copy2(versioned_model_path, tmp_model)
            shutil.copy2(versioned_meta_path, tmp_meta)
            os.replace(tmp_model, latest_model_path)
            os.replace(tmp_meta, latest_meta_path)

            manifest_data = {
                'active_model_file': model_filename,
                'active_metadata_file': meta_filename,
                'model_version': version_str,
                'promoted_at': timezone.now().isoformat(),
                'sha256': model_sha256,
                'distinct_genuine_days': distinct_genuine_days,
                'synthetic_records': 0,
            }
            manifest_tmp = os.path.join(artifacts_dir, f".tmp_manifest_{version_str}.json")
            manifest_path = os.path.join(artifacts_dir, 'active_manifest.json')
            with open(manifest_tmp, 'w', encoding='utf-8') as mf:
                json.dump(manifest_data, mf, indent=2)
            os.replace(manifest_tmp, manifest_path)

            self.stdout.write(self.style.SUCCESS(
                f"\nPROMOTION SUCCESSFUL: {version_str} is now active in production!"
            ))
        else:
            self.stdout.write(self.style.WARNING(
                "\nPRODUCTION PROMOTION PROHIBITED: Model generated as candidate for shadow evaluation only. "
                "Production serving remains on seasonal heuristic baseline (FORECAST_ML_ENABLED=False)."
            ))

    def _evaluate_synchronized_gating(
        self,
        X_df: Any,
        y_dict: Dict[int, pd.Series],
        n_splits: int = 4
    ) -> Dict[str, Any]:
        """
        Synchronized cross-validation comparing Ridge ML and canonical seasonal heuristic
        on identical chronological origin dates and identical forward target observations.
        Separates City and Barangay errors and reports horizon-specific metrics.
        """
        X_ref = X_df[1] if isinstance(X_df, HorizonFeatureDict) else X_df
        unique_origins = sorted(X_ref['origin_date'].unique())
        n_origins = len(unique_origins)

        if n_origins < 14:
            raise CommandError(
                f"Insufficient chronological origins ({n_origins}) to perform evaluation gating (minimum 14 required)."
            )

        split_step = max(2, n_origins // (n_splits + 1))
        city_ridge_errs, city_heur_errs = [], []
        brgy_ridge_errs, brgy_heur_errs = [], []
        h_ridge_errs = {h: [] for h in range(1, 8)}
        h_heur_errs = {h: [] for h in range(1, 8)}
        h_city_ridge_errs = {h: [] for h in range(1, 8)}
        h_city_heur_errs = {h: [] for h in range(1, 8)}
        h_brgy_ridge_errs = {h: [] for h in range(1, 8)}
        h_brgy_heur_errs = {h: [] for h in range(1, 8)}

        for split_i in range(1, n_splits + 1):
            train_end_idx = split_i * split_step
            val_end_idx = min(n_origins, train_end_idx + split_step)
            if train_end_idx >= val_end_idx:
                break

            train_origins = set(unique_origins[:train_end_idx])
            val_origins = set(unique_origins[train_end_idx:val_end_idx])

            for h in range(1, 8):
                X_h = X_df[h] if isinstance(X_df, HorizonFeatureDict) else X_df
                train_mask = X_h['origin_date'].isin(train_origins)
                val_mask = X_h['origin_date'].isin(val_origins)

                X_tr = X_h[train_mask]
                y_tr = y_dict[h][train_mask]
                X_val = X_h[val_mask]
                y_val = y_dict[h][val_mask]

                if not val_mask.any() or not train_mask.any():
                    continue

                # 1. Fit Fold Ridge Estimator
                from forecasting.models import create_ridge_pipeline
                pipe = create_ridge_pipeline(alpha=10.0)
                pipe.fit(X_tr, y_tr)
                ridge_preds = pipe.predict(X_val)

                # 2. Compute Fold Canonical Seasonal Heuristic on identical train origins
                for b_id in X_h['barangay_id'].unique():
                    tr_b_mask = (X_tr['barangay_id'] == b_id)
                    val_b_mask = (X_val['barangay_id'] == b_id)

                    if not val_b_mask.any():
                        continue

                    y_tr_b = y_tr[tr_b_mask]
                    series_mean = float(y_tr_b.mean()) if len(y_tr_b) > 0 else 0.0

                    dow_factors = {}
                    X_tr_b = X_tr[tr_b_mask]
                    tr_target_dows = X_tr_b['target_date'].apply(
                        lambda dt_val: (dt_val if isinstance(dt_val, date) else date.fromisoformat(str(dt_val))).weekday()
                    )
                    for d in range(7):
                        d_mask = (tr_target_dows == d)
                        if d_mask.any() and series_mean > 0:
                            dow_factors[d] = float(y_tr_b[d_mask].mean()) / series_mean
                        else:
                            dow_factors[d] = 1.0

                    # Evaluate on identical validation points
                    val_indices = np.where(val_b_mask)[0]
                    for idx in val_indices:
                        actual = float(y_val.iloc[idx])
                        r_pred = max(0.0, float(ridge_preds[idx]))

                        row = X_val.iloc[idx]
                        t_d = row['target_date'] if isinstance(row['target_date'], date) else date.fromisoformat(str(row['target_date']))
                        t_dow = t_d.weekday()
                        h_pred = max(0.0, series_mean * dow_factors.get(t_dow, 1.0))

                        # Sunday confirmed non-collection post-processing for both
                        sched_status = check_collection_schedule(t_d, b_id)
                        if t_dow == 6 and sched_status == ScheduleStatus.CONFIRMED_NON_COLLECTION:
                            r_pred = 0.0
                            h_pred = 0.0

                        r_err = abs(actual - r_pred)
                        h_err = abs(actual - h_pred)

                        h_ridge_errs[h].append(r_err)
                        h_heur_errs[h].append(h_err)

                        if str(b_id) in ['0', 'None']:
                            city_ridge_errs.append(r_err)
                            city_heur_errs.append(h_err)
                            h_city_ridge_errs[h].append(r_err)
                            h_city_heur_errs[h].append(h_err)
                        else:
                            brgy_ridge_errs.append(r_err)
                            brgy_heur_errs.append(h_err)
                            h_brgy_ridge_errs[h].append(r_err)
                            h_brgy_heur_errs[h].append(h_err)

        def calc_mae(errs):
            return float(np.mean(errs)) if errs else 0.0

        def calc_diff(heur_mae, ridge_mae):
            if heur_mae <= 0:
                return 0.0
            return ((heur_mae - ridge_mae) / heur_mae) * 100.0

        c_r_mae = calc_mae(city_ridge_errs)
        c_h_mae = calc_mae(city_heur_errs)
        b_r_mae = calc_mae(brgy_ridge_errs)
        b_h_mae = calc_mae(brgy_heur_errs)

        all_r_errs = city_ridge_errs + brgy_ridge_errs
        all_h_errs = city_heur_errs + brgy_heur_errs
        tot_r_mae = calc_mae(all_r_errs)
        tot_h_mae = calc_mae(all_h_errs)

        horizon_results = {}
        for h in range(1, 8):
            hr_mae = calc_mae(h_ridge_errs[h])
            hh_mae = calc_mae(h_heur_errs[h])
            hcr_mae = calc_mae(h_city_ridge_errs[h])
            hch_mae = calc_mae(h_city_heur_errs[h])
            hbr_mae = calc_mae(h_brgy_ridge_errs[h])
            hbh_mae = calc_mae(h_brgy_heur_errs[h])
            horizon_results[h] = {
                'ridge_mae': round(hr_mae, 2),
                'heuristic_mae': round(hh_mae, 2),
                'diff_pct': round(calc_diff(hh_mae, hr_mae), 2),
                'city_ridge_mae': round(hcr_mae, 2),
                'city_heuristic_mae': round(hch_mae, 2),
                'city_diff_pct': round(calc_diff(hch_mae, hcr_mae), 2),
                'brgy_ridge_mae': round(hbr_mae, 2),
                'brgy_heuristic_mae': round(hbh_mae, 2),
                'brgy_diff_pct': round(calc_diff(hbh_mae, hbr_mae), 2),
            }

        return {
            'city': {
                'ridge_mae': round(c_r_mae, 2),
                'heuristic_mae': round(c_h_mae, 2),
                'diff_pct': round(calc_diff(c_h_mae, c_r_mae), 2),
                'samples': len(city_ridge_errs)
            },
            'barangay': {
                'ridge_mae': round(b_r_mae, 2),
                'heuristic_mae': round(b_h_mae, 2),
                'diff_pct': round(calc_diff(b_h_mae, b_r_mae), 2),
                'samples': len(brgy_ridge_errs)
            },
            'horizons': horizon_results,
            'overall': {
                'ridge_mae': round(tot_r_mae, 2),
                'heuristic_mae': round(tot_h_mae, 2),
                'diff_pct': round(calc_diff(tot_h_mae, tot_r_mae), 2),
                'samples': len(all_r_errs)
            }
        }
