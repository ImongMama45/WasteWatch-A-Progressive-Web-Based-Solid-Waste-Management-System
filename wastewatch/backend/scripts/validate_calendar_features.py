"""
validate_calendar_features.py
-----------------------------
Controlled, reproducible verification of calendar feature engineering configurations
for the WasteWatch Ridge Regression multi-horizon forecasting pipeline.

Evaluates on identical chronological partitions, 7-day embargoes, prediction origins,
actual observations, prediction horizons (h=1..7), series definitions, and inner
hyperparameter selection procedures:

  - Config A     : Original approved baseline (raw target_day_of_week + sin/cos_dow, no month/week)
  - Config B     : Production revised pure cyclical (raw weekday/month/week ordinals removed;
                   uses live extract_calendar_features and NUMERIC_FEATURES from forecasting/)
  - Config B-DoW : Weekday-only pure cyclical ablation (Config A with raw target_day_of_week removed;
                   isolates weekday encoding from sub-annual month/week harmonics on short windows)
  - Config C1    : Pure cyclical + raw target_day_of_week (0-6) retained
  - Config C2    : Previous report configuration (cyclical + raw target_day_of_week, target_month,
                   and target_week_of_year retained)
  - Config D     : Pure cyclical + One-Hot Encoded weekday (OneHotEncoder on 0..6)

Also outputs a strict Dataset Composition & Provenance Audit separating genuine CENRO
records from synthetic development records and proportionally allocated barangay rows.
"""

import os
import sys
import math
from datetime import date, timedelta
import numpy as np
import pandas as pd

# Ensure backend root is on sys.path when invoked from backend/ or scripts/
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
import django
django.setup()

from django.conf import settings
from accounts.models import Barangay
from dumpsite.models import WasteDelivery
from forecasting.aggregation import build_daily_aggregation
from forecasting.features import (
    extract_calendar_features as extract_production_calendar_features,
    extract_deferred_calendar_harmonics,
    extract_origin_lag_and_rolling_features,
    get_canonical_city_population,
    is_philippine_holiday,
    HorizonFeatureDict,
)
from forecasting.models import (
    NUMERIC_FEATURES as PRODUCTION_NUMERIC_FEATURES,
    CATEGORICAL_FEATURES as PRODUCTION_CATEGORICAL_FEATURES,
)
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline


LAG_AND_ROLLING_COLS = [
    'lag_1', 'lag_2', 'lag_3', 'lag_7', 'lag_14', 'lag_21',
    'rolling_mean_7', 'rolling_mean_14', 'rolling_mean_28',
    'rolling_std_7', 'rolling_std_14',
    'rolling_max_14', 'rolling_min_14', 'rolling_median_14',
    'trend_7_vs_28', 'recent_growth_rate',
]

OPERATIONAL_CAL_COLS = [
    'target_is_weekend',
    'target_is_sunday',
    'target_is_monday',
    'target_day_of_month',
    'target_is_month_start',
    'target_is_month_end',
    'target_is_holiday',
]

CONFIG_SPECS = {
    'A_Baseline': {
        'label': 'A. Original Approved Baseline (raw DoW + sin/cos DoW, no month/week)',
        'numeric': ['population', 'target_day_of_week'] + OPERATIONAL_CAL_COLS + [
            'target_sin_dow', 'target_cos_dow',
        ] + LAG_AND_ROLLING_COLS,
        'categorical': ['barangay_id'],
    },
    'B_Pure_Cyclical': {
        'label': 'B. Pure Cyclical [PRODUCTION CODE] (raw ordinals removed)',
        'numeric': list(PRODUCTION_NUMERIC_FEATURES),
        'categorical': list(PRODUCTION_CATEGORICAL_FEATURES),
    },
    'B_DoW_Only': {
        'label': 'B-DoW. Weekday-Only Pure Cyclical Ablation (raw DoW removed, no month/week)',
        'numeric': ['population'] + OPERATIONAL_CAL_COLS + [
            'target_sin_dow', 'target_cos_dow',
        ] + LAG_AND_ROLLING_COLS,
        'categorical': ['barangay_id'],
    },
    'C1_Raw_DoW_Retained': {
        'label': 'C1. Cyclical + Raw Weekday Retained (raw month/week removed)',
        'numeric': ['population', 'target_day_of_week'] + OPERATIONAL_CAL_COLS + [
            'target_sin_dow', 'target_cos_dow',
            'target_sin_month', 'target_cos_month',
            'target_sin_week', 'target_cos_week',
        ] + LAG_AND_ROLLING_COLS,
        'categorical': ['barangay_id'],
    },
    'C2_All_Raw_Ordinals': {
        'label': 'C2. Previous Report Config (cyclical + raw DoW, raw month, raw week)',
        'numeric': ['population', 'target_day_of_week'] + OPERATIONAL_CAL_COLS + [
            'target_sin_dow', 'target_cos_dow',
            'target_month', 'target_sin_month', 'target_cos_month',
            'target_week_of_year', 'target_sin_week', 'target_cos_week',
        ] + LAG_AND_ROLLING_COLS,
        'categorical': ['barangay_id'],
    },
    'D_Cyclical_Plus_OHE_DoW': {
        'label': 'D. Pure Cyclical + One-Hot Encoded Weekday (OneHotEncoder 0..6)',
        'numeric': list(PRODUCTION_NUMERIC_FEATURES),
        'categorical': ['barangay_id', 'target_dow_cat'],
    },
}


def extract_superset_calendar_row(target_date: date) -> dict:
    """
    Uses live production extract_calendar_features() as ground truth for active features,
    and attaches deferred experimental harmonics and historical raw/categorical columns
    used only by archived experimental comparator configurations A, B, C1, C2, and D.
    """
    prod_cal = extract_production_calendar_features(target_date)
    deferred_cal = extract_deferred_calendar_harmonics(target_date)
    dow = target_date.weekday()
    month = target_date.month
    iso_week = target_date.isocalendar().week

    superset = dict(prod_cal)
    superset.update(deferred_cal)
    superset['target_day_of_month'] = float(target_date.day)
    superset['target_day_of_week'] = float(dow)
    superset['target_month'] = float(month)
    superset['target_week_of_year'] = float(iso_week)
    superset['target_dow_cat'] = str(dow)
    return superset


def collect_panel_series(start_date: date, end_date: date, include_synthetic: bool, min_history: int = 28, horizon: int = 7):
    """Builds city-wide and barangay daily series using canonical build_daily_aggregation."""
    city_pop = get_canonical_city_population()
    city_df = build_daily_aggregation(
        start_date=start_date,
        end_date=end_date,
        barangay_id=None,
        include_synthetic=include_synthetic,
    )
    city_df['barangay_id'] = 0
    city_df['population'] = city_pop

    all_series = [city_df]
    brgy_qs = Barangay.objects.filter(waste_deliveries__isnull=False).distinct().order_by('id')
    for b in brgy_qs:
        b_df = build_daily_aggregation(
            start_date=start_date,
            end_date=end_date,
            barangay_id=b.id,
            include_synthetic=include_synthetic,
        )
        if b_df['weight_kg'].sum() <= 0 or len(b_df) < (min_history + horizon):
            continue
        b_df['barangay_id'] = b.id
        b_df['population'] = float(b.population) if b.population else 0.0
        all_series.append(b_df)

    return all_series


def build_superset_matrices(all_series, horizon: int = 7, min_history: int = 28):
    """Builds leak-free multi-horizon feature matrices shared identically across all configs."""
    x_rows = {h: [] for h in range(1, horizon + 1)}
    y_targets = {h: [] for h in range(1, horizon + 1)}

    for s_df in all_series:
        df = s_df.sort_values('date').reset_index(drop=True)
        if len(df) < min_history + horizon:
            continue
        dates = df['date'].tolist()
        weights = df['weight_kg']
        brgy_id = int(df['barangay_id'].iloc[0])
        pop = float(df['population'].iloc[0])

        for t_idx in range(min_history - 1, len(df) - horizon):
            origin_d = dates[t_idx]
            history_slice = weights.iloc[:t_idx + 1]
            lag_feats = extract_origin_lag_and_rolling_features(history_slice)

            for h in range(1, horizon + 1):
                target_d = origin_d + timedelta(days=h)
                row = {
                    'origin_date': str(origin_d),
                    'target_date': str(target_d),
                    'horizon_step': h,
                    'barangay_id': str(brgy_id),
                    'population': pop,
                }
                row.update(extract_superset_calendar_row(target_d))
                row.update(lag_feats)
                x_rows[h].append(row)
                y_targets[h].append(float(weights.iloc[t_idx + h]))

    X_dict = HorizonFeatureDict({h: pd.DataFrame(x_rows[h]) for h in range(1, horizon + 1)})
    y_dict = {h: pd.Series(y_targets[h]) for h in range(1, horizon + 1)}
    return X_dict, y_dict


def audit_dataset_composition(window_start: date, window_end: date):
    """Reports exact database record provenance and genuine vs synthetic composition."""
    print("=" * 100)
    print("SECTION 1: DATASET COMPOSITION & PROVENANCE AUDIT")
    print("=" * 100)
    print(f"Governance Flag Check : settings.FORECAST_ML_ENABLED = {getattr(settings, 'FORECAST_ML_ENABLED', None)}")
    print(f"Audit Calendar Window : {window_start} to {window_end} ({(window_end - window_start).days + 1} distinct calendar dates)")

    qs_all = WasteDelivery.objects.all()
    qs_win = WasteDelivery.objects.filter(date__gte=window_start, date__lte=window_end)

    gen_val = qs_win.filter(is_synthetic=False, is_validated=True)
    gen_unval = qs_win.filter(is_synthetic=False, is_validated=False)
    syn_rows = qs_win.filter(is_synthetic=True)

    print(f"Total WasteDelivery records in database         : {qs_all.count()}")
    print(f"Total WasteDelivery records in window           : {qs_win.count()}")
    print(f"  - Genuine validated records (is_synthetic=0, is_validated=1)   : {gen_val.count()} rows across {gen_val.values('date').distinct().count()} distinct dates")
    print(f"  - Genuine unvalidated records (is_synthetic=0, is_validated=0) : {gen_unval.count()} rows across {gen_unval.values('date').distinct().count()} distinct dates")
    for r in gen_unval.order_by('date'):
        brgy_ids = list(r.barangays.values_list('id', flat=True))
        eff_w = float(r.net_weight) if (r.net_weight is not None and float(r.net_weight) > 0) else float(r.estimated_kg or 0.0)
        print(f"      * Genuine row id={r.id}: date={r.date}, effective_weight_kg={eff_w:.2f}, is_validated={r.is_validated}, barangay_ids={brgy_ids}")
    print(f"  - Synthetic records excluded in genuine mode (is_synthetic=1)  : {syn_rows.count()} rows across {syn_rows.values('date').distinct().count()} distinct dates")

    # Multi-barangay shared route allocation check on window
    multi_brgy_count = 0
    single_brgy_count = 0
    for r in qs_win.prefetch_related('barangays'):
        n_b = r.barangays.count()
        if n_b > 1:
            multi_brgy_count += 1
        elif n_b == 1:
            single_brgy_count += 1
    print(f"  - Route barangay multiplicity in window       : {single_brgy_count} single-barangay deliveries, {multi_brgy_count} multi-barangay deliveries (allocated proportionally as weight_kg / N)")

    # Genuine-only aggregation check
    gen_city_df = build_daily_aggregation(window_start, window_end, barangay_id=None, include_synthetic=False)
    gen_nonzero_city = int((gen_city_df['weight_kg'] > 0).sum())
    gen_series = collect_panel_series(window_start, window_end, include_synthetic=False)
    gen_brgy_series_count = len(gen_series) - 1
    gen_brgy_nonzero_obs = sum(int((s['weight_kg'] > 0).sum()) for s in gen_series[1:])

    distinct_genuine_days = qs_win.filter(is_synthetic=False).values('date').distinct().count()
    genuine_gate_passes = distinct_genuine_days >= 28

    print("\n[A] STRICT GENUINE-ONLY PIPELINE MODE (include_synthetic=False):")
    print(f"  - Distinct calendar dates in grid             : {len(gen_city_df)}")
    print(f"  - Distinct genuine delivery dates (any)       : {distinct_genuine_days} (minimum required for training gate: 28)")
    print(f"  - Distinct genuine VALIDATED delivery dates   : {gen_val.values('date').distinct().count()}")
    print(f"  - Synthetic records excluded                  : {syn_rows.count()}")
    print(f"  - Valid city-wide daily grid observations     : {len(gen_city_df)} days ({gen_nonzero_city} non-zero delivery days, {len(gen_city_df) - gen_nonzero_city} zero-kg days)")
    print(f"  - Active barangay series (>0 kg in window)    : {gen_brgy_series_count} series ({gen_brgy_series_count * len(gen_city_df)} daily grid cells, {gen_brgy_nonzero_obs} non-zero delivery cells)")
    print(f"  - Genuine training gate status                : {'PASS' if genuine_gate_passes else 'FAIL-CLOSED (0 usable genuine training rows per horizon; model training blocked)'}")

    print("\n[B] SYNTHETIC DEVELOPMENT BENCHMARK MODE (include_synthetic=True):")
    print("  - PROVENANCE DISCLOSURE: The controlled feature comparisons below use synthetic seeded")
    print("    records (163 synthetic + 2 unvalidated genuine rows) and proportional multi-barangay")
    print("    weight allocations (w/N) strictly to benchmark feature matrix math under identical splits.")
    print("    They do NOT represent independently collected genuine CENRO weighbridge performance.")


def evaluate_config_on_split(X_dict, y_dict, num_feats, cat_feats, horizon: int = 7):
    """
    Evaluates a feature configuration using identical chronological train / 7d embargo /
    calibration / 7d embargo / test splits and inner chronological alpha tuning.
    """
    X_ref = X_dict[1]
    unique_dates = sorted([date.fromisoformat(d) for d in X_ref['origin_date'].unique()])
    span_days = (unique_dates[-1] - unique_dates[0]).days

    train_span = max(2, int((span_days - 14) * 0.55))
    train_end_date = unique_dates[0] + timedelta(days=train_span)
    train_dates = set([d for d in unique_dates if d <= train_end_date])

    cal_min_date = train_end_date + timedelta(days=7)
    cal_span = max(1, int((span_days - 14) * 0.20))
    cal_end_date = cal_min_date + timedelta(days=cal_span)
    cal_dates = set([d for d in unique_dates if cal_min_date <= d <= cal_end_date])

    test_min_date = cal_end_date + timedelta(days=7)
    test_dates = set([d for d in unique_dates if d >= test_min_date])

    orig_series = X_ref['origin_date'].apply(lambda d: date.fromisoformat(d))
    tr_mask = orig_series.isin(train_dates).values
    cal_mask = orig_series.isin(cal_dates).values
    test_mask = orig_series.isin(test_dates).values

    def make_pipe(alpha):
        pre = ColumnTransformer(
            transformers=[
                ('num', StandardScaler(), num_feats),
                ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), cat_feats),
            ],
            remainder='drop'
        )
        return Pipeline([
            ('preprocessor', pre),
            ('ridge', Ridge(alpha=alpha, random_state=42)),
        ])

    split_meta = {
        'n_origins_total': len(unique_dates),
        'origin_range': f"{unique_dates[0]}..{unique_dates[-1]}",
        'train_range': f"{min(train_dates)}..{max(train_dates)} ({len(train_dates)} origins, {int(tr_mask.sum())} rows/h)",
        'cal_range': f"{min(cal_dates)}..{max(cal_dates)} ({len(cal_dates)} origins, {int(cal_mask.sum())} rows/h)",
        'test_range': f"{min(test_dates)}..{max(test_dates)} ({len(test_dates)} origins, {int(test_mask.sum())} rows/h)",
        'total_rows_per_h': len(X_ref),
    }

    horizon_results = {}
    all_test_actuals = []
    all_test_preds = []
    all_is_city = []

    train_dates_sorted = sorted(list(train_dates))
    inner_cut = max(1, int(len(train_dates_sorted) * 0.70))
    inner_tr_dates = set(train_dates_sorted[:inner_cut])
    inner_val_dates = set(train_dates_sorted[inner_cut:])
    inner_tr_mask = orig_series.isin(inner_tr_dates).values
    inner_val_mask = orig_series.isin(inner_val_dates).values

    for h in range(1, horizon + 1):
        X_h = X_dict[h]
        y_h = y_dict[h]

        best_alpha = 10.0
        best_mae = float('inf')
        alpha_trace = {}
        for alpha_c in [0.1, 1.0, 10.0, 50.0, 100.0, 500.0]:
            p = make_pipe(alpha_c)
            p.fit(X_h[inner_tr_mask], y_h[inner_tr_mask])
            val_p = np.maximum(0.0, p.predict(X_h[inner_val_mask]))
            val_act = y_h[inner_val_mask].values
            val_city = (X_h[inner_val_mask]['barangay_id'] == '0').values
            mae_v = float(np.mean(np.abs(val_act - val_p)))
            alpha_trace[alpha_c] = {
                'overall_mae': round(mae_v, 2),
                'city_mae': round(float(np.mean(np.abs(val_act[val_city] - val_p[val_city]))), 2),
                'brgy_mae': round(float(np.mean(np.abs(val_act[~val_city] - val_p[~val_city]))), 2),
            }
            if mae_v < best_mae:
                best_mae = mae_v
                best_alpha = alpha_c

        pipe = make_pipe(best_alpha)
        pipe.fit(X_h[tr_mask], y_h[tr_mask])

        test_p = np.maximum(0.0, pipe.predict(X_h[test_mask]))
        test_act = y_h[test_mask].values
        test_is_city = (X_h[test_mask]['barangay_id'] == '0').values

        city_act = test_act[test_is_city]
        city_pred = test_p[test_is_city]
        brgy_act = test_act[~test_is_city]
        brgy_pred = test_p[~test_is_city]

        mae_h = float(np.mean(np.abs(test_act - test_p)))
        city_mae_h = float(np.mean(np.abs(city_act - city_pred)))
        brgy_mae_h = float(np.mean(np.abs(brgy_act - brgy_pred)))
        city_wape_h = float(np.sum(np.abs(city_act - city_pred)) / max(1.0, np.sum(city_act))) * 100.0
        brgy_wape_h = float(np.sum(np.abs(brgy_act - brgy_pred)) / max(1.0, np.sum(brgy_act))) * 100.0

        horizon_results[h] = {
            'best_alpha': best_alpha,
            'overall_mae': round(mae_h, 2),
            'city_mae': round(city_mae_h, 2),
            'city_wape': round(city_wape_h, 2),
            'brgy_mae': round(brgy_mae_h, 2),
            'brgy_wape': round(brgy_wape_h, 2),
            'n_city_test': int(test_is_city.sum()),
            'n_brgy_test': int((~test_is_city).sum()),
            'alpha_trace': alpha_trace,
        }

        all_test_actuals.extend(test_act.tolist())
        all_test_preds.extend(test_p.tolist())
        all_is_city.extend(test_is_city.tolist())

    act_arr = np.array(all_test_actuals)
    pred_arr = np.array(all_test_preds)
    city_arr = np.array(all_is_city, dtype=bool)

    overall_mae = float(np.mean(np.abs(act_arr - pred_arr)))
    overall_wape = float(np.sum(np.abs(act_arr - pred_arr)) / max(1.0, np.sum(act_arr))) * 100.0
    city_mae = float(np.mean(np.abs(act_arr[city_arr] - pred_arr[city_arr])))
    city_wape = float(np.sum(np.abs(act_arr[city_arr] - pred_arr[city_arr])) / max(1.0, np.sum(act_arr[city_arr]))) * 100.0
    brgy_mae = float(np.mean(np.abs(act_arr[~city_arr] - pred_arr[~city_arr])))
    brgy_wape = float(np.sum(np.abs(act_arr[~city_arr] - pred_arr[~city_arr])) / max(1.0, np.sum(act_arr[~city_arr]))) * 100.0

    return {
        'split_meta': split_meta,
        'overall_mae': round(overall_mae, 2),
        'overall_wape': round(overall_wape, 2),
        'city_mae': round(city_mae, 2),
        'city_wape': round(city_wape, 2),
        'brgy_mae': round(brgy_mae, 2),
        'brgy_wape': round(brgy_wape, 2),
        'horizon_results': horizon_results,
    }


def pct_delta(new_val: float, base_val: float) -> float:
    if base_val == 0:
        return 0.0
    return ((new_val - base_val) / base_val) * 100.0


def run_controlled_window_benchmark(title: str, start_date: date, end_date: date):
    print("\n" + "=" * 100)
    print(title)
    print("=" * 100)

    series_list = collect_panel_series(start_date, end_date, include_synthetic=True)
    X_dict, y_dict = build_superset_matrices(series_list, horizon=7, min_history=28)

    # Confirm production calendar keys match Pure Cyclical config
    prod_cal_sample = extract_production_calendar_features(date(2026, 10, 18))
    assert 'target_day_of_week' not in prod_cal_sample, "Raw target_day_of_week still in production!"
    assert 'target_month' not in prod_cal_sample, "Raw target_month still in production!"
    assert 'target_week_of_year' not in prod_cal_sample, "Raw target_week_of_year still in production!"

    eval_map = {}
    for key, spec in CONFIG_SPECS.items():
        eval_map[key] = evaluate_config_on_split(
            X_dict, y_dict,
            num_feats=spec['numeric'],
            cat_feats=spec['categorical'],
            horizon=7,
        )

    meta = eval_map['A_Baseline']['split_meta']
    print(f"Calendar Span         : {start_date} to {end_date} ({(end_date - start_date).days + 1} calendar days)")
    print(f"Series Count          : {len(series_list)} (1 City-Wide + {len(series_list) - 1} Barangays)")
    print(f"Usable Rows / Horizon : {meta['total_rows_per_h']} pooled rows ({meta['n_origins_total']} origins x {len(series_list)} series)")
    print(f"Train Partition       : {meta['train_range']}")
    print(f"Embargo 1             : 7 calendar days")
    print(f"Calibration Partition : {meta['cal_range']}")
    print(f"Embargo 2             : 7 calendar days")
    print(f"Test Partition        : {meta['test_range']}")

    base = eval_map['A_Baseline']

    print("\n--- AGGREGATE MULTI-HORIZON SUMMARY (h=1..7) ---")
    header = f"{'Configuration':<26} | {'Overall MAE':>11} {'(vs A)':>8} | {'City MAE':>10} {'(vs A)':>8} {'City WAPE':>10} | {'Brgy MAE':>10} {'(vs A)':>8} {'Brgy WAPE':>10}"
    print(header)
    print("-" * len(header))
    for key, spec in CONFIG_SPECS.items():
        r = eval_map[key]
        d_ov = pct_delta(r['overall_mae'], base['overall_mae'])
        d_ci = pct_delta(r['city_mae'], base['city_mae'])
        d_br = pct_delta(r['brgy_mae'], base['brgy_mae'])
        print(
            f"{key:<26} | {r['overall_mae']:>9.2f}kg {d_ov:>+7.2f}% | "
            f"{r['city_mae']:>8.2f}kg {d_ci:>+7.2f}% {r['city_wape']:>9.2f}% | "
            f"{r['brgy_mae']:>8.2f}kg {d_br:>+7.2f}% {r['brgy_wape']:>9.2f}%"
        )

    print("\n--- CITY-WIDE MAE BY HORIZON (kg) & SELECTED ALPHA ---")
    h_hdr = f"{'Horizon':<8} | {'A_Baseline (alpha)':>20} | {'B_Pure_Cyc (alpha)':>20} | {'B_DoW_Only (alpha)':>20} | {'C1_RawDoW (alpha)':>20} | {'C2_PrevAll (alpha)':>20} | {'D_Cyc+OHE (alpha)':>20}"
    print(h_hdr)
    print("-" * len(h_hdr))
    for h in range(1, 8):
        vals = []
        for k in ['A_Baseline', 'B_Pure_Cyclical', 'B_DoW_Only', 'C1_Raw_DoW_Retained', 'C2_All_Raw_Ordinals', 'D_Cyclical_Plus_OHE_DoW']:
            hr = eval_map[k]['horizon_results'][h]
            vals.append(f"{hr['city_mae']:>9.2f} ({hr['best_alpha']:>5.1f})")
        print(f"h={h:<6} | " + " | ".join(f"{v:>20}" for v in vals))

    print("\n--- BARANGAY MAE BY HORIZON (kg) ---")
    b_hdr = f"{'Horizon':<8} | {'A_Baseline':>14} | {'B_Pure_Cyclical':>15} | {'B_DoW_Only':>14} | {'C1_Raw_DoW':>14} | {'C2_All_Raw':>14} | {'D_Cyc+OHE_DoW':>14}"
    print(b_hdr)
    print("-" * len(b_hdr))
    for h in range(1, 8):
        vals = [
            f"{eval_map[k]['horizon_results'][h]['brgy_mae']:>14.2f}"
            for k in ['A_Baseline', 'B_Pure_Cyclical', 'B_DoW_Only', 'C1_Raw_DoW_Retained', 'C2_All_Raw_Ordinals', 'D_Cyclical_Plus_OHE_DoW']
        ]
        print(f"h={h:<6} | " + " | ".join(vals))

    return eval_map, X_dict, y_dict


def print_h1_degradation_diagnostics(eval_91):
    print("\n" + "=" * 100)
    print("SECTION 4: DIAGNOSTIC PROOF OF CITY-WIDE h=1 DEGRADATION ON 91-DAY PADDED WINDOW")
    print("=" * 100)
    print("Inner Validation MAE Trace at h=1 (Unweighted Pooled MAE = 1/12 City + 11/12 Barangay):")
    for k in ['A_Baseline', 'B_Pure_Cyclical', 'B_DoW_Only', 'C2_All_Raw_Ordinals']:
        trace = eval_91[k]['horizon_results'][1]['alpha_trace']
        chosen = eval_91[k]['horizon_results'][1]['best_alpha']
        print(f"\n  {k} (Selected best_alpha = {chosen}):")
        for alpha_c, m in trace.items():
            marker = " <-- SELECTED" if alpha_c == chosen else ""
            print(
                f"    alpha={alpha_c:<5} : Inner Pooled MAE={m['overall_mae']:>7.2f} kg | "
                f"Inner City MAE={m['city_mae']:>7.2f} kg | Inner Brgy MAE={m['brgy_mae']:>7.2f} kg{marker}"
            )


def run_all():
    win_91_start = date(2026, 8, 5)
    win_91_end = date(2026, 11, 3)
    audit_dataset_composition(win_91_start, win_91_end)

    eval_91, _, _ = run_controlled_window_benchmark(
        "SECTION 2: CONTROLLED COMPARISON -- 91-DAY BENCHMARK WINDOW (2026-08-05 to 2026-11-03, SYNTHETIC BENCHMARK)",
        win_91_start,
        win_91_end,
    )

    win_60_start = date(2026, 9, 2)
    win_60_end = date(2026, 10, 31)
    run_controlled_window_benchmark(
        "SECTION 3: CONTROLLED COMPARISON -- 60-DAY ACTIVE SEEDED WINDOW (2026-09-02 to 2026-10-31, NO COLD-START ZEROS)",
        win_60_start,
        win_60_end,
    )

    print_h1_degradation_diagnostics(eval_91)


if __name__ == '__main__':
    run_all()
