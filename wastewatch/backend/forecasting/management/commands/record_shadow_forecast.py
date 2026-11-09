"""
forecasting/management/commands/record_shadow_forecast.py
---------------------------------------------------------
Authoritative shadow evaluation engine for WasteWatch.
Evaluates candidate Ridge ML models alongside the production-primary seasonal heuristic
against forward weighbridge actuals under strict governance (Directive Phase 4).
"""

import os
import json
import logging
from datetime import date, timedelta
from typing import Optional, Dict, Any, List

import numpy as np
import pandas as pd
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.conf import settings
from django.db import transaction

from accounts.models import Barangay
from analytics.models import ShadowForecastPrediction
from dumpsite.models import WasteDelivery
from forecasting.aggregation import build_daily_aggregation
from forecasting.service import (
    load_latest_forecaster,
    load_candidate_forecaster,
    Z80,
)
from forecasting.features import (
    check_collection_schedule,
    ScheduleStatus,
    get_canonical_city_population,
    get_series_population,
)

logger = logging.getLogger(__name__)

# Documented grace period for late dumpsite delivery log entry (in calendar days)
GRACE_PERIOD_DAYS: int = 2


def compute_heuristic_points_for_origin(
    origin_date: date,
    barangay_obj: Optional[Barangay] = None,
    lookback: int = 30,
    horizon: int = 7,
) -> Optional[List[Dict[str, Any]]]:
    """
    Computes leak-free heuristic baseline predictions for a given origin date
    using the authoritative daily aggregation engine (T-01 fix).
    """
    start_date = origin_date - timedelta(days=lookback - 1)
    brgy_id = barangay_obj.id if barangay_obj else None

    # Canonical daily aggregation (identical to production serving)
    daily_df = build_daily_aggregation(
        start_date=start_date,
        end_date=origin_date,
        barangay_id=brgy_id,
        fill_zeros=True,
        include_synthetic=False
    )

    active_df = daily_df[daily_df['weight_kg'] > 0]
    if active_df.empty:
        return None

    first = active_df['date'].min()
    window_df = daily_df[daily_df['date'] >= first]
    days = window_df['date'].tolist()
    y = window_df['weight_kg'].astype(float).tolist()

    if len(active_df) < 7 or len(window_df) < 14:
        return None

    overall = sum(y) / len(y) if y else 0.0
    if overall <= 0:
        return None

    buckets = {wd: [] for wd in range(7)}
    for d, v in zip(days, y):
        buckets[d.weekday()].append(v)
    index = {wd: ((sum(v) / len(v)) / overall if v else 1.0) for wd, v in buckets.items()}

    fitted = [overall * index[d.weekday()] for d in days]
    resid = [a - f for a, f in zip(y, fitted)]
    var_res = sum(r ** 2 for r in resid) / (len(resid) - 1) if len(resid) > 1 else 0.0
    band = Z80 * (var_res ** 0.5)

    points = []
    effective_brgy_id = barangay_obj.id if barangay_obj else 0
    for h in range(1, horizon + 1):
        target_d = origin_date + timedelta(days=h)
        is_sunday = (target_d.weekday() == 6)
        sched_status = check_collection_schedule(target_d, effective_brgy_id, evaluation_origin=origin_date)

        if is_sunday and sched_status == ScheduleStatus.CONFIRMED_NON_COLLECTION:
            e = 0.0
            p_band = 0.0
        else:
            e = overall * index[target_d.weekday()]
            p_band = band

        points.append({
            'date': target_d,
            'expected_kg': round(e, 2),
            'low_kg': round(max(0.0, e - p_band), 2),
            'high_kg': round(e + p_band, 2),
            'horizon_step': h,
            'schedule_status': sched_status.value,
        })
    return points


class Command(BaseCommand):
    help = "Authoritative shadow evaluation engine recording candidate ML and heuristic predictions."

    def add_arguments(self, parser):
        parser.add_argument('--origin-date', type=str, help="Origin date in YYYY-MM-DD format (default: yesterday)")
        parser.add_argument('--backfill-actuals', action='store_true', help="Backfill actual weighbridge records for past target dates")
        parser.add_argument('--report-metrics', action='store_true', help="Calculate and print comparative shadow evaluation metrics")
        parser.add_argument('--allow-backfill', action='store_true', help="Explicitly mark origin as historical backfill rather than prospective forward record")
        parser.add_argument('--supersede', action='store_true', help="Create append-only supersession records for existing origins")
        parser.add_argument('--artifacts-dir', type=str, default=None, help="Custom artifacts directory")

    def handle(self, *args, **options):
        if options.get('report_metrics'):
            self.report_metrics()
            return

        if options.get('backfill_actuals'):
            self.backfill_actuals()

        origin_str = options.get('origin_date')
        today = timezone.localdate()
        yesterday = today - timedelta(days=1)

        if origin_str:
            origin_d = date.fromisoformat(origin_str)
        else:
            origin_d = yesterday

        is_backfill = options.get('allow_backfill', False) or (origin_d < yesterday)

        self.stdout.write(f"Executing Shadow Forecast Evaluation for origin date: {origin_d} (backfill={is_backfill})")
        self.record_shadow(
            origin_date=origin_d,
            artifacts_dir=options.get('artifacts_dir'),
            is_backfill=is_backfill,
            allow_supersede=options.get('supersede', False)
        )

    def record_shadow(
        self,
        origin_date: date,
        artifacts_dir: Optional[str] = None,
        is_backfill: bool = False,
        allow_supersede: bool = False
    ):
        # 1. Candidate Artifact Discovery (Directive Phase 4)
        # Attempt to load candidate forecaster first; fallback to latest or heuristic-only
        forecaster, metadata = load_candidate_forecaster(artifacts_dir=artifacts_dir)
        has_ridge_candidate = False

        if forecaster is not None and getattr(forecaster, 'is_fitted', False):
            has_ridge_candidate = True
            model_type = 'ridge'
            model_version = (metadata or {}).get('model_version', 'candidate_ridge')
            training_cutoff = None
            training_window = (metadata or {}).get('training_window', {})
            if isinstance(training_window, dict) and 'end_date' in training_window:
                training_cutoff = date.fromisoformat(training_window['end_date'])
            genuine_count = (metadata or {}).get('genuine_records', 0)
            self.stdout.write(self.style.SUCCESS(f"Loaded valid candidate Ridge artifact: {model_version}"))
        else:
            # Fallback to heuristic-only shadow mode
            forecaster = None
            metadata = None
            model_type = 'heuristic'
            model_version = 'heuristic_baseline'
            training_cutoff = None
            genuine_count = 0
            self.stdout.write(self.style.WARNING(
                "No valid unpromoted Ridge candidate artifact available. "
                "Recording heuristic-only shadow baseline predictions."
            ))

        # 2. Build canonical series targets
        city_pop = get_canonical_city_population()
        series_targets = [(None, 0, city_pop, "City-Wide", "city")]
        for b in Barangay.objects.all():
            pop = float(b.population) if b.population is not None else 0.0
            series_targets.append((b, b.id, pop, b.name, f"brgy_{b.id}"))

        history_start = origin_date - timedelta(days=44)
        recorded_count = 0
        skipped_count = 0
        superseded_count = 0

        for brgy_obj, brgy_id, pop, label, series_id in series_targets:
            daily_df = build_daily_aggregation(
                start_date=history_start,
                end_date=origin_date,
                barangay_id=brgy_id if brgy_id != 0 else None,
                include_synthetic=False
            )

            # Heuristic baseline points
            heur_points = compute_heuristic_points_for_origin(
                origin_date=origin_date,
                barangay_obj=brgy_obj,
                lookback=30,
                horizon=7
            )
            if not heur_points or len(heur_points) != 7:
                continue

            heur_by_h = {p['horizon_step']: p for p in heur_points}

            # Ridge candidate points (if candidate forecaster available)
            ridge_points_by_h = {}
            if has_ridge_candidate:
                active_days = int((daily_df['weight_kg'] > 0).sum()) if not daily_df.empty else 0
                if len(daily_df) >= 28 and (brgy_obj is None or active_days >= 28):
                    weight_series = pd.Series(
                        data=daily_df['weight_kg'].values,
                        index=daily_df['date'].values
                    ).sort_index()
                    try:
                        pts = forecaster.predict_7_days(
                            origin_date=origin_date,
                            history_weights=weight_series,
                            barangay_id=brgy_id,
                            population=pop
                        )
                        ridge_points_by_h = {p['horizon_step']: p for p in pts}
                    except Exception as exc:
                        logger.warning(f"Ridge candidate inference skipped for {label}: {exc}")

            with transaction.atomic():
                for h in range(1, 8):
                    hp = heur_by_h[h]
                    target_d = origin_date + timedelta(days=h)
                    rp = ridge_points_by_h.get(h)

                    # Check existing prediction for immutability & deduplication
                    existing = ShadowForecastPrediction.objects.filter(
                        origin_date=origin_date,
                        target_date=target_d,
                        horizon_step=h,
                        series_id=series_id,
                        model_version=model_version,
                        is_superseded=False
                    ).first()

                    if existing:
                        if allow_supersede:
                            # Append-only supersession: mark old record superseded
                            new_record = ShadowForecastPrediction.objects.create(
                                origin_date=origin_date,
                                target_date=target_d,
                                horizon_step=h,
                                barangay=brgy_obj,
                                series_id=series_id,
                                model_type=model_type,
                                model_version=model_version,
                                expected_kg=rp['expected_kg'] if rp else None,
                                low_kg=rp['low_kg'] if rp else None,
                                high_kg=rp['high_kg'] if rp else None,
                                heuristic_expected_kg=hp['expected_kg'],
                                heuristic_low_kg=hp['low_kg'],
                                heuristic_high_kg=hp['high_kg'],
                                is_backfill=is_backfill,
                                training_cutoff=training_cutoff,
                                genuine_record_count=genuine_count,
                                prediction_provenance={
                                    'series_label': label,
                                    'schedule_status': hp.get('schedule_status'),
                                    'has_ridge_candidate': (rp is not None)
                                }
                            )
                            existing.is_superseded = True
                            existing.superseded_by = new_record
                            existing.save(update_fields=['is_superseded', 'superseded_by'])
                            superseded_count += 1
                        else:
                            skipped_count += 1
                            continue
                    else:
                        ShadowForecastPrediction.objects.create(
                            origin_date=origin_date,
                            target_date=target_d,
                            horizon_step=h,
                            barangay=brgy_obj,
                            series_id=series_id,
                            model_type=model_type,
                            model_version=model_version,
                            expected_kg=rp['expected_kg'] if rp else None,
                            low_kg=rp['low_kg'] if rp else None,
                            high_kg=rp['high_kg'] if rp else None,
                            heuristic_expected_kg=hp['expected_kg'],
                            heuristic_low_kg=hp['low_kg'],
                            heuristic_high_kg=hp['high_kg'],
                            is_backfill=is_backfill,
                            training_cutoff=training_cutoff,
                            genuine_record_count=genuine_count,
                            prediction_provenance={
                                'series_label': label,
                                'schedule_status': hp.get('schedule_status'),
                                'has_ridge_candidate': (rp is not None)
                            }
                        )
                        recorded_count += 1

        self.stdout.write(self.style.SUCCESS(
            f"Shadow evaluation completed for origin {origin_date}: "
            f"recorded={recorded_count}, skipped_existing={skipped_count}, superseded={superseded_count}."
        ))

    def backfill_actuals(self):
        """
        Backfills actual weighbridge measurements with canonical daily aggregation,
        proportional shared-route splitting, and a documented grace period.
        """
        today = timezone.localdate()
        yesterday = today - timedelta(days=1)

        pending = ShadowForecastPrediction.objects.filter(
            is_actual_complete=False,
            target_date__lte=yesterday,
            is_superseded=False
        )
        total_pending = pending.count()
        self.stdout.write(f"Evaluating {total_pending} pending shadow predictions for actuals backfill...")

        confirmed_count = 0
        grace_count = 0
        missing_count = 0

        for sp in pending:
            days_since_target = (yesterday - sp.target_date).days

            # 1. Grace period check: tickets may still be pending dumpsite data entry
            if days_since_target < GRACE_PERIOD_DAYS:
                # Check if delivery already entered anyway
                has_deliveries = WasteDelivery.objects.filter(is_synthetic=False, date=sp.target_date).exists()
                if not has_deliveries:
                    sp.actual_data_status = 'GRACE_PERIOD'
                    sp.save(update_fields=['actual_data_status'])
                    grace_count += 1
                    continue

            # 2. Extract authoritative daily total using canonical aggregation
            eff_brgy_id = sp.barangay_id if sp.barangay_id else None
            actual_df = build_daily_aggregation(
                start_date=sp.target_date,
                end_date=sp.target_date,
                barangay_id=eff_brgy_id,
                fill_zeros=False,
                include_synthetic=False
            )

            deliv_count = int(actual_df['delivery_count'].iloc[0]) if not actual_df.empty else 0
            actual_weight = float(actual_df['weight_kg'].iloc[0]) if not actual_df.empty else 0.0

            if deliv_count > 0:
                sp.actual_kg = round(actual_weight, 2)
                sp.actual_recorded_at = timezone.now()
                sp.actual_data_status = 'CONFIRMED'
                sp.is_actual_complete = True
                sp.save(update_fields=['actual_kg', 'actual_recorded_at', 'actual_data_status', 'is_actual_complete'])
                confirmed_count += 1
            else:
                # 3. No delivery logged: check if confirmed non-collection day
                sched_status = check_collection_schedule(sp.target_date, eff_brgy_id)
                if sched_status == ScheduleStatus.CONFIRMED_NON_COLLECTION:
                    sp.actual_kg = 0.0
                    sp.actual_recorded_at = timezone.now()
                    sp.actual_data_status = 'CONFIRMED_NON_COLLECTION'
                    sp.is_actual_complete = True
                    sp.save(update_fields=['actual_kg', 'actual_recorded_at', 'actual_data_status', 'is_actual_complete'])
                    confirmed_count += 1
                else:
                    # Regular active collection day with zero tickets logged:
                    # Do not assume 0 kg without evidence!
                    sp.actual_data_status = 'UNRECORDED_OR_MISSING'
                    sp.save(update_fields=['actual_data_status'])
                    missing_count += 1

        self.stdout.write(self.style.SUCCESS(
            f"Backfill complete: confirmed={confirmed_count}, in_grace_period={grace_count}, missing_unrecorded={missing_count}."
        ))

    def report_metrics(self):
        """
        Calculates and reports shadow evaluation metrics separated by City and Barangay,
        strictly excluding backfills and incomplete actuals.
        """
        evaluated = ShadowForecastPrediction.objects.filter(
            is_actual_complete=True,
            actual_kg__isnull=False,
            is_backfill=False,
            is_superseded=False,
            actual_data_status__in=['CONFIRMED', 'CONFIRMED_NON_COLLECTION']
        )
        total_eval = evaluated.count()
        if total_eval == 0:
            self.stdout.write("No prospective forward shadow records with verified actuals found.")
            return

        self.stdout.write(f"\n=== WASTEWATCH SHADOW EVALUATION REPORT ({total_eval} points) ===")
        self.stdout.write("Note: Historical backfills and unverified missing days are strictly excluded.\n")

        for series_category, label in [('city', 'City-Wide Aggregate'), ('barangays', 'Barangay Level')]:
            if series_category == 'city':
                cat_subset = evaluated.filter(series_id='city')
            else:
                cat_subset = evaluated.exclude(series_id='city')

            n_cat = cat_subset.count()
            if n_cat == 0:
                continue

            self.stdout.write(f"--- {label} ({n_cat} samples) ---")
            self.stdout.write(f"{'Horizon':<8} | {'Samples':<8} | {'Ridge MAE':<12} | {'Heuristic MAE':<15} | {'Diff (%)':<10}")
            self.stdout.write("-" * 65)

            for h in range(1, 8):
                h_sub = cat_subset.filter(horizon_step=h)
                n_sub = h_sub.count()
                if n_sub == 0:
                    continue

                heur_errors = [abs(p.actual_kg - p.heuristic_expected_kg) for p in h_sub]
                h_mae = sum(heur_errors) / n_sub

                ridge_valid = h_sub.filter(expected_kg__isnull=False)
                n_ridge = ridge_valid.count()
                if n_ridge > 0:
                    ridge_errors = [abs(p.actual_kg - p.expected_kg) for p in ridge_valid]
                    r_mae = sum(ridge_errors) / n_ridge
                    diff_pct = ((h_mae - r_mae) / (h_mae + 1e-5)) * 100.0
                    diff_str = f"{diff_pct:>+8.2f}%"
                    r_mae_str = f"{r_mae:<12.1f}"
                else:
                    r_mae_str = f"{'N/A':<12}"
                    diff_str = f"{'N/A':>10}"

                self.stdout.write(f"H={h:<6} | {n_sub:<8} | {r_mae_str} | {h_mae:<15.1f} | {diff_str}")
            self.stdout.write("")
