"""
forecasting/aggregation.py
--------------------------
Authoritative daily aggregation of municipal solid waste deliveries.
Reconciles city-wide and barangay-level delivery totals from weighbridge records.
"""

from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple, Any
import pandas as pd
import numpy as np

from django.db.models import Case, When, F, FloatField, Sum, Count, Q
from django.db.models.functions import Cast
from django.utils import timezone

from dumpsite.models import WasteDelivery
from accounts.models import Barangay


# Authoritative row weight expression:
# Weighbridge scale net_weight (gross - tare) if positive, else driver's estimated_kg.
WEIGHT_EXPR = Case(
    When(net_weight__gt=0, then=Cast('net_weight', FloatField())),
    default=Cast('estimated_kg', FloatField()),
    output_field=FloatField(),
)


def extract_raw_deliveries(
    start_date: date,
    end_date: date,
    barangay_id: Optional[int] = None,
    brgy_id: Optional[int] = None,
    include_synthetic: bool = False
) -> List[Dict[str, Any]]:
    """
    Extracts raw WasteDelivery records with ManyToMany barangay associations.
    Guards against synthetic data pollution by strictly filtering is_synthetic=include_synthetic.
    """
    effective_brgy_id = barangay_id if barangay_id is not None else brgy_id
    qs = WasteDelivery.objects.filter(date__range=[start_date, end_date])
    if not include_synthetic:
        qs = qs.filter(is_synthetic=False)

    if effective_brgy_id is not None:
        qs = qs.filter(barangays__id=effective_brgy_id).prefetch_related('barangays').distinct()
        records = []
        for d in qs:
            w = float(d.net_weight if d.net_weight and d.net_weight > 0 else (d.estimated_kg or 0))
            brgy_ids = [b.id for b in d.barangays.all()]
            records.append({
                'id': d.id,
                'date': d.date,
                'weight_kg': max(0.0, w),
                'barangays': brgy_ids,
                'is_validated': d.is_validated,
                'is_synthetic': d.is_synthetic,
                'truck_id': d.truck_id,
                'weight_source': 'weighbridge_scale' if d.net_weight and d.net_weight > 0 else 'driver_estimate',
            })
        return records

    # City-wide aggregation traverses barangays to track untagged deliveries
    qs = qs.prefetch_related('barangays').distinct()
    records = []
    for d in qs:
        w = float(d.net_weight if d.net_weight and d.net_weight > 0 else (d.estimated_kg or 0))
        brgy_ids = [b.id for b in d.barangays.all()]
        records.append({
            'id': d.id,
            'date': d.date,
            'weight_kg': max(0.0, w),
            'barangays': brgy_ids,
            'is_validated': d.is_validated,
            'is_synthetic': d.is_synthetic,
            'truck_id': d.truck_id,
            'weight_source': 'weighbridge_scale' if d.net_weight and d.net_weight > 0 else 'driver_estimate',
        })
    return records


def build_daily_aggregation(
    start_date: date,
    end_date: date,
    barangay_id: Optional[int] = None,
    brgy_id: Optional[int] = None,
    fill_zeros: bool = True,
    include_synthetic: bool = False
) -> pd.DataFrame:
    """
    Builds a continuous daily time-series of waste tonnage.

    Proportional Attribution:
    If a delivery serves multiple barangays, its weight is attributed proportionately
    (weight / N) to each served barangay. Untagged deliveries (N=0) are tracked in
    unattributed_kg.
    """
    effective_brgy_id = barangay_id if barangay_id is not None else brgy_id
    if start_date > end_date:
        raise ValueError(f"start_date ({start_date}) cannot be after end_date ({end_date})")

    deliveries = extract_raw_deliveries(
        start_date, end_date,
        barangay_id=effective_brgy_id,
        include_synthetic=include_synthetic
    )

    # All calendar days in the requested window
    num_days = (end_date - start_date).days + 1
    calendar_dates = [start_date + timedelta(days=i) for i in range(num_days)]

    # Group by date and calculate weights
    daily_weights: Dict[date, float] = {d: 0.0 for d in calendar_dates}
    daily_counts: Dict[date, int] = {d: 0 for d in calendar_dates}
    daily_unattributed: Dict[date, float] = {d: 0.0 for d in calendar_dates}

    for deliv in deliveries:
        d_date = deliv['date']
        if d_date not in daily_weights:
            continue
        w = deliv['weight_kg']
        brgys = deliv['barangays']

        if effective_brgy_id is not None:
            # Barangay specific: proportional weight
            if effective_brgy_id in brgys:
                share = w / len(brgys) if len(brgys) > 0 else w
                daily_weights[d_date] += share
                daily_counts[d_date] += 1
        else:
            # City-wide aggregate: full weight of delivery
            daily_weights[d_date] += w
            daily_counts[d_date] += 1
            if len(brgys) == 0:
                daily_unattributed[d_date] += w

    rows = []
    for d in calendar_dates:
        w = daily_weights[d]
        cnt = daily_counts[d]
        is_sunday = (d.weekday() == 6)

        # Classify day semantics
        if cnt > 0:
            day_type = 'ACTIVE_DELIVERY'
        elif is_sunday:
            day_type = 'SCHEDULED_NON_COLLECTION'
        else:
            day_type = 'UNRECORDED_OR_MISSING'

        rows.append({
            'date': d,
            'barangay_id': effective_brgy_id if effective_brgy_id is not None else 0,
            'weight_kg': round(w, 2),
            'delivery_count': cnt,
            'unattributed_kg': round(daily_unattributed[d], 2),
            'is_zero': (w == 0.0),
            'day_type': day_type,
            'weekday': d.weekday(),
        })

    df = pd.DataFrame(rows)
    return df


def build_pooled_barangay_dataset(start_date: date, end_date: date) -> pd.DataFrame:
    """
    Builds a pooled multi-barangay panel dataset where each row is (barangay_id, date, weight_kg).
    Used for training the pooled Ridge model across all active barangays.
    """
    barangays = list(Barangay.objects.all().values('id', 'name', 'population'))
    all_frames = []

    for b in barangays:
        b_df = build_daily_aggregation(start_date, end_date, brgy_id=b['id'], fill_zeros=True)
        b_df['barangay_name'] = b['name']
        b_df['population'] = b['population'] or 0
        all_frames.append(b_df)

    if not all_frames:
        return pd.DataFrame(columns=['date', 'barangay_id', 'weight_kg', 'delivery_count', 'population'])

    panel_df = pd.concat(all_frames, ignore_index=True)
    return panel_df
