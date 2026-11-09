"""
watcher/geofence.py
-------------------
Authoritative coordinate-based barangay geofence resolver for Lucena City.

Determines which Barangay a report falls into strictly from its GPS coordinates
(latitude, longitude) against the official Lucena City GeoJSON polygons, rather
than relying on the reporter's profile barangay.
"""

import json
import math
import os
from functools import lru_cache
from django.conf import settings


BARANGAY_ALIASES = {
    'kanlurang mayao': 'mayao kanluran',
    'mayao kanluran': 'kanlurang mayao',
    'silangang mayao': 'mayao silangan',
    'mayao silangan': 'silangang mayao',
}


def point_in_ring(x, y, ring):
    """Ray-casting point-in-polygon test for a single linear ring [ [lng, lat], ... ]."""
    n = len(ring)
    if n < 3:
        return False
    inside = False
    p1x, p1y = ring[0][0], ring[0][1]
    for i in range(1, n + 1):
        p2x, p2y = ring[i % n][0], ring[i % n][1]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    xinters = None
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or (xinters is not None and x <= xinters):
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside


def _point_in_polygon_coords(x, y, poly_coords):
    """Checks outer ring inclusion and excludes any interior holes."""
    if not poly_coords:
        return False
    if not point_in_ring(x, y, poly_coords[0]):
        return False
    for hole in poly_coords[1:]:
        if point_in_ring(x, y, hole):
            return False
    return True


def _min_dist_sq_to_ring(x, y, ring):
    """Minimum squared Euclidean distance (in degrees^2) from (x, y) to segments of a ring."""
    min_d2 = float('inf')
    n = len(ring)
    if n == 0:
        return min_d2
    for i in range(n):
        ax, ay = ring[i][0], ring[i][1]
        bx, by = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            d2 = (x - ax) ** 2 + (y - ay) ** 2
        else:
            t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)
            t = max(0.0, min(1.0, t))
            px, py = ax + t * dx, ay + t * dy
            d2 = (x - px) ** 2 + (y - py) ** 2
        if d2 < min_d2:
            min_d2 = d2
    return min_d2


def _compute_bbox(polygons):
    min_x = float('inf')
    min_y = float('inf')
    max_x = float('-inf')
    max_y = float('-inf')
    for poly in polygons:
        if not poly:
            continue
        for pt in poly[0]:
            px, py = pt[0], pt[1]
            if px < min_x:
                min_x = px
            if px > max_x:
                max_x = px
            if py < min_y:
                min_y = py
            if py > max_y:
                max_y = py
    return (min_x, min_y, max_x, max_y)


@lru_cache(maxsize=1)
def _load_barangay_polygons():
    """
    Loads and caches Lucena City barangay polygons with precomputed bounding boxes.
    Returns list of tuples: (brgy_name, polygons_list, (min_x, min_y, max_x, max_y))
    where polygons_list is standardized as [ poly_coords, ... ] (MultiPolygon form).
    """
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, 'data', 'lucena_barangays.geojson'),
        os.path.join(os.path.dirname(settings.BASE_DIR), 'frontend', 'public', 'data', 'lucena_barangays.geojson'),
    ]
    geojson_path = next((p for p in candidates if os.path.exists(p)), None)
    if not geojson_path:
        return []

    with open(geojson_path, 'r', encoding='utf-8') as f:
        gj = json.load(f)

    features = []
    for feat in gj.get('features', []):
        props = feat.get('properties') or {}
        name = (props.get('brgy_name') or props.get('name') or '').strip()
        geom = feat.get('geometry') or {}
        gtype = geom.get('type')
        coords = geom.get('coordinates') or []
        if not name or not coords:
            continue

        if gtype == 'Polygon':
            polygons = [coords]
        elif gtype == 'MultiPolygon':
            polygons = coords
        else:
            continue

        bbox = _compute_bbox(polygons)
        features.append((name, polygons, bbox))

    return features


def detect_barangay_name(latitude, longitude, edge_tolerance_deg=0.00045):
    """
    Returns the GeoJSON barangay name containing (latitude, longitude),
    or None if the coordinate is outside Lucena City boundaries.
    `edge_tolerance_deg` (~50m) snaps slight coastal/border GPS drift to the nearest polygon edge.
    """
    if latitude is None or longitude is None:
        return None
    try:
        y = float(latitude)
        x = float(longitude)
        if math.isnan(x) or math.isnan(y) or math.isinf(x) or math.isinf(y):
            return None
    except (ValueError, TypeError):
        return None

    features = _load_barangay_polygons()
    if not features:
        return None

    # 1. Exact point-in-polygon check (fast bbox rejection first)
    for name, polygons, (min_x, min_y, max_x, max_y) in features:
        if x < min_x or x > max_x or y < min_y or y > max_y:
            continue
        for poly in polygons:
            if _point_in_polygon_coords(x, y, poly):
                return name

    # 2. Boundary tolerance check (~50m) for shoreline / boundary edge GPS drift
    if edge_tolerance_deg and edge_tolerance_deg > 0:
        tol_sq = edge_tolerance_deg * edge_tolerance_deg
        best_name = None
        best_d2 = tol_sq
        for name, polygons, (min_x, min_y, max_x, max_y) in features:
            if (
                x < min_x - edge_tolerance_deg
                or x > max_x + edge_tolerance_deg
                or y < min_y - edge_tolerance_deg
                or y > max_y + edge_tolerance_deg
            ):
                continue
            for poly in polygons:
                if not poly:
                    continue
                d2 = _min_dist_sq_to_ring(x, y, poly[0])
                if d2 <= best_d2:
                    best_d2 = d2
                    best_name = name
        if best_name:
            return best_name

    return None


def match_barangay_by_name(detected_name, create_if_missing=True):
    """
    Matches a detected GeoJSON barangay name to an `accounts.models.Barangay` record,
    handling case differences and naming aliases (e.g. 'Kanlurang Mayao' <-> 'Mayao Kanluran').
    """
    if not detected_name:
        return None

    from accounts.models import Barangay

    clean = detected_name.strip()
    lower = clean.lower()
    alias = BARANGAY_ALIASES.get(lower)

    all_brgys = list(Barangay.objects.all())
    by_lower = {b.name.strip().lower(): b for b in all_brgys}

    if lower in by_lower:
        return by_lower[lower]
    if alias and alias in by_lower:
        return by_lower[alias]

    # Also match "Barangay X" <-> "Barangay X (Pob.)" if needed
    stripped_pob = lower.replace('(pob.)', '').strip()
    for b_low, b_obj in by_lower.items():
        if b_low.replace('(pob.)', '').strip() == stripped_pob:
            return b_obj

    if create_if_missing:
        brgy, _ = Barangay.objects.get_or_create(name=clean)
        return brgy

    return None


def resolve_barangay_from_coords(latitude, longitude, create_if_missing=True):
    """
    Authoritatively resolves the `Barangay` model instance from (latitude, longitude).
    Returns None if coordinates are missing or outside Lucena City.
    """
    detected_name = detect_barangay_name(latitude, longitude)
    if not detected_name:
        return None
    return match_barangay_by_name(detected_name, create_if_missing=create_if_missing)
