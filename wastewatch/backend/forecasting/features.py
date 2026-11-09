"""
forecasting/features.py
-----------------------
Reusable, strictly leak-free feature engineering pipeline for Ridge Regression waste forecasting.
Constructs calendar, lag, rolling, trend, and demographic features strictly from information
available at the forecast origin.
"""

import math
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple, Set, Any
import numpy as np
import pandas as pd


import enum
import re

class ScheduleStatus(str, enum.Enum):
    SCHEDULED = "SCHEDULED"
    CONFIRMED_NON_COLLECTION = "CONFIRMED_NON_COLLECTION"
    UNKNOWN = "UNKNOWN"


# Official Lucena City Population Baseline (PSA Census baseline for 33 barangays)
LUCENA_CITY_FALLBACK_POPULATION: float = 270000.0


def get_canonical_city_population() -> float:
    """
    Returns the authoritative city-wide population for Lucena City.
    Uses the sum of registered barangay populations from the database if available and positive;
    otherwise falls back to the official Lucena City census baseline (270,000).
    Guarantees strict train/serve population feature alignment across all pipelines.
    """
    try:
        from accounts.models import Barangay
        from django.db.models import Sum
        agg = Barangay.objects.aggregate(total_pop=Sum('population'))
        total = agg.get('total_pop')
        if total is not None and float(total) > 0.0:
            return float(total)
    except Exception:
        pass
    return LUCENA_CITY_FALLBACK_POPULATION


def get_series_population(barangay_obj: Optional[Any] = None, barangay_id: Optional[Any] = None) -> float:
    """
    Returns the authoritative population for a given series.
    Distinguishes city-wide series from specific barangay series.
    """
    is_city = (barangay_obj is None) and (barangay_id is None or str(barangay_id) in ['0', 'None', 'city'])
    if is_city:
        return get_canonical_city_population()

    if barangay_obj is not None:
        pop = getattr(barangay_obj, 'population', None)
        if pop is not None:
            return float(pop)

    if barangay_id is not None:
        try:
            from accounts.models import Barangay
            b = Barangay.objects.filter(id=int(barangay_id)).first()
            if b and b.population is not None:
                return float(b.population)
        except Exception:
            pass

    return 0.0


# ── Philippine Public Holidays (Fixed and Movable Key Observances) ────────────
# Standard statutory holidays in the Philippines + Lucena City Day
FIXED_PH_HOLIDAYS = {
    (1, 1): "New Year's Day",
    (4, 9): "Araw ng Kagitingan (Day of Valor)",
    (5, 1): "Labor Day",
    (6, 12): "Independence Day",
    (8, 19): "Quezon Day (Lucena City Local Holiday)",
    (8, 20): "Lucena City Charter Day",
    (11, 1): "All Saints' Day",
    (11, 2): "All Souls' Day",
    (11, 30): "Bonifacio Day",
    (12, 8): "Feast of the Immaculate Conception",
    (12, 25): "Christmas Day",
    (12, 30): "Rizal Day",
    (12, 31): "New Year's Eve",
}


def _get_easter_date(year: int) -> date:
    """Computus: Anonymous Gregorian algorithm for Western Easter Sunday."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _get_movable_ph_holidays(year: int) -> Dict[date, str]:
    """Computes movable Philippine national observances for a given calendar year."""
    holidays = {}
    # Holy Week
    easter = _get_easter_date(year)
    holidays[easter - timedelta(days=3)] = "Maundy Thursday"
    holidays[easter - timedelta(days=2)] = "Good Friday"
    holidays[easter - timedelta(days=1)] = "Black Saturday"

    # National Heroes Day: Last Monday of August
    last_day_aug = date(year, 8, 31)
    offset_to_mon = (last_day_aug.weekday() - 0) % 7
    last_mon_aug = last_day_aug - timedelta(days=offset_to_mon)
    holidays[last_mon_aug] = "National Heroes Day"

    return holidays


def is_philippine_holiday(d: date) -> bool:
    """Checks whether date d is a recognized national or local Lucena holiday."""
    if (d.month, d.day) in FIXED_PH_HOLIDAYS:
        return True
    movable = _get_movable_ph_holidays(d.year)
    return d in movable


def check_collection_schedule(
    target_date: date,
    barangay_id: Optional[Any] = None,
    evaluation_origin: Optional[date] = None
) -> ScheduleStatus:
    """
    Authoritative schedule resolution with fail-safe error handling (N-08 & T-05 fix).

    Returns:
    - ScheduleStatus.SCHEDULED: Mon-Sat standard collection, or verified active Sunday schedule.
    - ScheduleStatus.CONFIRMED_NON_COLLECTION: Sunday with verified absence of any active routes.
    - ScheduleStatus.UNKNOWN: Database failure, query error, or evaluating historical dates
      where current schedules do not apply.
    """
    # Mon-Sat (weekday 0..5) are statutory active collection days in Lucena City CENRO
    if target_date.weekday() != 6:
        return ScheduleStatus.SCHEDULED

    # If evaluating a historical date prior to current operational schedule validity
    if evaluation_origin is not None and target_date < evaluation_origin:
        return ScheduleStatus.UNKNOWN

    try:
        from driver.models import CollectionSchedule, TruckStatus

        # Query schedules matching exact date or recurring Sunday
        # Exclude cancelled one-time or recurring schedules
        # Exclude schedules without an assigned truck or with an inactive truck
        qs = CollectionSchedule.objects.filter(
            truck__isnull=False
        ).exclude(
            status='CANCELLED'
        ).exclude(
            truck__status=TruckStatus.INACTIVE
        ).prefetch_related('barangays')

        if barangay_id and str(barangay_id) not in ['0', 'None', 'city']:
            qs = qs.filter(barangays__id=int(barangay_id))

        has_active_sunday_schedule = False
        for sched in qs:
            # 1. Exact date match
            if sched.date == target_date:
                has_active_sunday_schedule = True
                break

            # 2. Recurring schedule: check days string with regex word boundaries
            # Avoid naive substring match like 'days__icontains="Sun"'
            if sched.days:
                if re.search(r'\b(sun|sunday)\b', sched.days, re.IGNORECASE):
                    has_active_sunday_schedule = True
                    break

        if has_active_sunday_schedule:
            return ScheduleStatus.SCHEDULED
        else:
            return ScheduleStatus.CONFIRMED_NON_COLLECTION

    except Exception:
        # Crucial N-08/T-05 requirement: Do NOT interpret a database failure as proof that
        # no collection is scheduled! Return UNKNOWN to fail safe.
        return ScheduleStatus.UNKNOWN


def is_collection_scheduled(target_date: date, barangay_id: Optional[Any] = None) -> bool:
    """
    Backward-compatibility boolean wrapper.
    Returns True if scheduled or unknown, False ONLY if confirmed non-collection.
    """
    status = check_collection_schedule(target_date, barangay_id)
    return status != ScheduleStatus.CONFIRMED_NON_COLLECTION


def get_holiday_distance(d: date, window_days: int = 45) -> Tuple[int, int]:
    """
    Calculates (days_until_next_holiday, days_since_last_holiday) within a search window.
    Caps at window_days if none found.
    """
    days_until = window_days
    days_since = window_days

    for offset in range(1, window_days + 1):
        future_d = d + timedelta(days=offset)
        if is_philippine_holiday(future_d):
            days_until = offset
            break

    for offset in range(1, window_days + 1):
        past_d = d - timedelta(days=offset)
        if is_philippine_holiday(past_d):
            days_since = offset
            break

    return days_until, days_since


# Active calendar features wired into Ridge Regression training and inference (8 features)
ACTIVE_CALENDAR_FEATURES: List[str] = [
    'target_is_weekend',
    'target_is_sunday',
    'target_is_monday',
    'target_is_month_start',
    'target_is_month_end',
    'target_is_holiday',
    'target_sin_dow',
    'target_cos_dow',
]

# Deferred experimental calendar harmonics -- NOT included in active Ridge inputs.
# Retained solely for offline research/benchmarking once >= 180-365 days of genuine
# validated multi-season CENRO weighbridge history accumulates.
DEFERRED_EXPERIMENTAL_CALENDAR_FEATURES: List[str] = [
    'target_sin_month',
    'target_cos_month',
    'target_sin_week',
    'target_cos_week',
]


def extract_calendar_features(target_date: date) -> Dict[str, float]:
    """
    Extracts active calendar features for a given target date for Ridge Regression.

    Active Calendar Representation (8 features):
    - Cyclical weekday harmonics (`target_sin_dow`, `target_cos_dow`, period=7, 0=Monday..6=Sunday).
    - Operational weekday indicators (`target_is_weekend`, `target_is_sunday`, `target_is_monday`).
    - Month boundary indicators (`target_is_month_start`, `target_is_month_end`, leap-year aware).
    - Validated Philippine statutory & Lucena City holiday indicator (`target_is_holiday`).

    Excluded / Deferred Encodings:
    - Raw periodic ordinals (`target_day_of_week` 0-6, `target_month` 1-12, `target_week_of_year` 1-53)
      are excluded to eliminate artificial linear step discontinuities across cycle wrap-arounds.
    - Raw `target_day_of_month` (1-31) is excluded from active Ridge inputs because it introduces an
      analogous month-boundary step discontinuity (28/29/30/31 -> 1); boundary effects remain captured
      by `target_is_month_start` and `target_is_month_end` without introducing an unvalidated variable-length
      intra-month encoding.
    - Annual/sub-annual harmonics (`target_sin_month`, `target_cos_month`, `target_sin_week`, `target_cos_week`)
      are deferred (see `extract_deferred_calendar_harmonics`) until multi-season genuine CENRO history exists.
    """
    dow = target_date.weekday()          # 0=Monday, 6=Sunday (consistent 0-6 convention)
    dom = target_date.day                # 1-31

    # Indicators for operational scheduling in Lucena City
    is_sunday = 1.0 if dow == 6 else 0.0
    is_monday = 1.0 if dow == 0 else 0.0
    is_weekend = 1.0 if dow in (5, 6) else 0.0

    # Month start/end (leap-year aware via calendar progression)
    is_month_start = 1.0 if dom == 1 else 0.0
    next_day = target_date + timedelta(days=1)
    is_month_end = 1.0 if next_day.day == 1 else 0.0

    # Recognized Philippine/Lucena holiday
    is_holiday = 1.0 if is_philippine_holiday(target_date) else 0.0

    # Cyclical day-of-week harmonics (period = 7)
    # Saturday (5) and Sunday (6) are adjacent; Sunday (6) and Monday (0) are adjacent
    sin_dow = math.sin(2.0 * math.pi * dow / 7.0)
    cos_dow = math.cos(2.0 * math.pi * dow / 7.0)

    return {
        'target_is_weekend': is_weekend,
        'target_is_sunday': is_sunday,
        'target_is_monday': is_monday,
        'target_is_month_start': is_month_start,
        'target_is_month_end': is_month_end,
        'target_is_holiday': is_holiday,
        'target_sin_dow': sin_dow,
        'target_cos_dow': cos_dow,
    }


def extract_deferred_calendar_harmonics(target_date: date) -> Dict[str, float]:
    """
    DEFERRED EXPERIMENTAL FEATURES -- NOT USED IN ACTIVE RIDGE TRAINING OR INFERENCE.

    Computes cyclical month-of-year (period 12, 0-indexed month_idx 0..11) and ISO 8601
    week-of-year (period 52 or 53) sine/cosine harmonics. Preserved for mathematical
    verification and future offline evaluation once multi-season (>= 180-365 days)
    genuine validated CENRO weighbridge records are available.
    """
    month = target_date.month
    iso_year, iso_week, _ = target_date.isocalendar()
    weeks_in_iso_year = date(iso_year, 12, 28).isocalendar().week  # 52 or 53

    month_idx = month - 1
    sin_month = math.sin(2.0 * math.pi * month_idx / 12.0)
    cos_month = math.cos(2.0 * math.pi * month_idx / 12.0)

    week_idx = iso_week - 1
    sin_week = math.sin(2.0 * math.pi * week_idx / float(weeks_in_iso_year))
    cos_week = math.cos(2.0 * math.pi * week_idx / float(weeks_in_iso_year))

    return {
        'target_sin_month': sin_month,
        'target_cos_month': cos_month,
        'target_sin_week': sin_week,
        'target_cos_week': cos_week,
    }


def extract_origin_lag_and_rolling_features(history_weights: pd.Series) -> Dict[str, float]:
    """
    Extracts lag, rolling statistics, and trend features strictly up to the forecast origin T.
    The input Series `history_weights` must be sorted chronologically ending on origin date T.

    Zero-Leakage Assurance:
    All rolling windows and lags are computed strictly over indices <= T.
    Numerically hardened against division-by-zero on 0-kg non-collection days.
    """
    n = len(history_weights)
    if n == 0:
        raise ValueError("history_weights cannot be empty")

    values = history_weights.values.astype(float)

    def safe_lag(k: int) -> float:
        """Returns weight k days before origin T (lag_1 = values[-1])."""
        return float(values[-k]) if n >= k else float(values[0])

    lag_1 = safe_lag(1)
    lag_2 = safe_lag(2)
    lag_3 = safe_lag(3)
    lag_7 = safe_lag(7)
    lag_14 = safe_lag(14)
    lag_21 = safe_lag(21)

    def window_slice(k: int) -> np.ndarray:
        return values[-k:] if n >= k else values

    w7 = window_slice(7)
    w14 = window_slice(14)
    w28 = window_slice(28)

    rolling_mean_7 = float(np.mean(w7))
    rolling_mean_14 = float(np.mean(w14))
    rolling_mean_28 = float(np.mean(w28))

    rolling_std_7 = float(np.std(w7)) if len(w7) > 1 else 0.0
    rolling_std_14 = float(np.std(w14)) if len(w14) > 1 else 0.0

    rolling_max_14 = float(np.max(w14))
    rolling_min_14 = float(np.min(w14))
    rolling_median_14 = float(np.median(w14))

    # Scale-aware denominator floors (F-06 fix)
    floor_28 = max(50.0, 0.05 * rolling_mean_28)
    floor_lag7 = max(50.0, 0.05 * rolling_mean_7, lag_7)

    # Bounded trend and growth rate (clipped to [-5.0, 5.0])
    trend_7_vs_28 = float(np.clip((rolling_mean_7 - rolling_mean_28) / floor_28, -5.0, 5.0))
    recent_growth_rate = float(np.clip((lag_1 - lag_7) / floor_lag7, -5.0, 5.0))

    return {
        'lag_1': lag_1,
        'lag_2': lag_2,
        'lag_3': lag_3,
        'lag_7': lag_7,
        'lag_14': lag_14,
        'lag_21': lag_21,
        'rolling_mean_7': rolling_mean_7,
        'rolling_mean_14': rolling_mean_14,
        'rolling_mean_28': rolling_mean_28,
        'rolling_std_7': rolling_std_7,
        'rolling_std_14': rolling_std_14,
        'rolling_max_14': rolling_max_14,
        'rolling_min_14': rolling_min_14,
        'rolling_median_14': rolling_median_14,
        'trend_7_vs_28': trend_7_vs_28,
        'recent_growth_rate': recent_growth_rate,
    }


def build_feature_vector_for_origin(
    origin_date: date,
    target_date: date,
    history_weights: pd.Series,
    barangay_id: int = 0,
    population: float = 0.0,
    precomputed_lag_feats: Optional[Dict[str, float]] = None
) -> Dict[str, Any]:
    """
    Constructs a complete single-row feature dictionary for predicting `target_date`
    from forecast origin `origin_date`.
    """
    calendar_feats = extract_calendar_features(target_date)
    lag_feats = precomputed_lag_feats if precomputed_lag_feats is not None else extract_origin_lag_and_rolling_features(history_weights)

    horizon_days = (target_date - origin_date).days

    row = {
        'origin_date': str(origin_date),
        'target_date': str(target_date),
        'horizon_step': horizon_days,
        'barangay_id': str(barangay_id),
        'population': float(population),
    }
    row.update(calendar_feats)
    row.update(lag_feats)
    return row


class HorizonFeatureDict(dict):
    """
    Dictionary mapping horizon h -> DataFrame X_h with horizon-specific calendar features (N-01 fix).
    Provides backward-compatibility properties for callers expecting a single DataFrame.
    """
    @property
    def columns(self):
        return self[1].columns if 1 in self else pd.Index([])

    @property
    def iloc(self):
        return self[1].iloc

    def __len__(self):
        return len(self[1]) if 1 in self else 0


def generate_training_matrix(
    daily_df: pd.DataFrame,
    horizon: int = 7,
    min_history_required: int = 28
) -> Tuple[HorizonFeatureDict, Dict[int, pd.Series]]:
    """
    Constructs direct multi-horizon training samples from historical panel or city data.

    For each historical date T (from min_history_required to end - horizon):
    - Features are computed strictly using history <= T.
    - For each horizon h in 1..horizon:
      * Target date is T + h.
      * Target-day calendar features correspond to the exact target date (T + h) (N-01 fix).
      * Target is the actual weight at T + h.

    Returns:
    - X_dict: HorizonFeatureDict mapping horizon step h (1..horizon) to DataFrame X_h.
    - y_dict: Dict mapping horizon step h (1..horizon) to Target Series y_h.
    """
    if len(daily_df) < min_history_required + horizon:
        raise ValueError(
            f"Dataset length ({len(daily_df)}) is insufficient. "
            f"Need at least {min_history_required + horizon} rows."
        )

    # Ensure chronological sort
    df = daily_df.sort_values('date').reset_index(drop=True)
    dates = df['date'].tolist()
    weights = df['weight_kg']

    brgy_id = int(df['barangay_id'].iloc[0]) if 'barangay_id' in df.columns else 0
    pop = float(df['population'].iloc[0]) if 'population' in df.columns else 0.0

    x_rows = {h: [] for h in range(1, horizon + 1)}
    y_targets = {h: [] for h in range(1, horizon + 1)}

    for t_idx in range(min_history_required - 1, len(df) - horizon):
        origin_d = dates[t_idx]
        history_slice = weights.iloc[:t_idx + 1]
        lag_feats = extract_origin_lag_and_rolling_features(history_slice)

        for h in range(1, horizon + 1):
            target_d = origin_d + timedelta(days=h)
            row_h = build_feature_vector_for_origin(
                origin_date=origin_d,
                target_date=target_d,
                history_weights=history_slice,
                barangay_id=brgy_id,
                population=pop,
                precomputed_lag_feats=lag_feats
            )
            x_rows[h].append(row_h)
            y_val = weights.iloc[t_idx + h]
            y_targets[h].append(float(y_val))

    X_dict = HorizonFeatureDict({
        h: pd.DataFrame(x_rows[h]) for h in range(1, horizon + 1)
    })
    y_series = {h: pd.Series(y_targets[h], name=f'target_h{h}') for h in range(1, horizon + 1)}
    return X_dict, y_series
