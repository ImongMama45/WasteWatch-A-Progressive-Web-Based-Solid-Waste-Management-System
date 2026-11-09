"""
watcher/services.py
-------------------
Service layer operations for GarbageReport processing, including atomic
creation and resolution of linked civic CommunityPost representations.
"""

import logging
from django.db import transaction
from django.apps import apps

logger = logging.getLogger(__name__)


def create_or_get_community_post_for_report(report, author=None):
    """
    Atomically creates or retrieves the single linked CommunityPost for a GarbageReport.
    Guarantees idempotency and concurrency safety via OneToOneField uniqueness.
    Never creates a duplicate CommunityPost for the same GarbageReport.
    """
    CommunityPost = apps.get_model('community', 'CommunityPost')

    # Quick check for existing link
    try:
        if hasattr(report, 'community_post') and report.community_post:
            return report.community_post, False
    except CommunityPost.DoesNotExist:
        pass

    user = author if author is not None else report.user

    # Determine default content
    issue_label = report.get_issue_type_display() if hasattr(report, 'get_issue_type_display') else report.issue_type
    brgy_name = report.barangay.name if report.barangay else (report.address or 'Lucena City')
    default_content = (
        report.description.strip()
        if (report.description and report.description.strip())
        else f"Civic waste report for {issue_label} at {brgy_name}."
    )

    with transaction.atomic():
        post, created = CommunityPost.objects.get_or_create(
            report=report,
            defaults={
                'author': user,
                'barangay': report.barangay,
                'post_type': 'report',
                'category': 'general',
                'content': default_content,
                'is_hidden': bool(report.status == 'rejected' or report.is_archived),
            }
        )
        return post, created


def haversine_km(lat1, lon1, lat2, lon2):
    import math
    R = 6371.0
    lat1, lon1, lat2, lon2 = float(lat1), float(lon1), float(lat2), float(lon2)
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def retire_hotspot_and_cancel_active_dispatches(target, cancelled_by=None, reason=''):
    """
    Retires hotspot(s) associated with a report or directly.
    If the retired hotspot is a cluster dispatch anchor and other active collection targets
    remain in the 15-meter cluster, the active dispatch is safely re-anchored to the next
    active hotspot. If no active targets remain in the cluster, active dispatches are cancelled.
    Preserves completed, resolved, and historical interventions.
    """
    import math
    from django.db import transaction
    from watcher.models import GarbageHotspot, HotspotIntervention, InterventionStatus, InterventionType

    if hasattr(target, 'hotspots'):
        hotspots = list(target.hotspots.all())
    elif isinstance(target, GarbageHotspot):
        hotspots = [target]
    else:
        hotspots = list(GarbageHotspot.objects.filter(source_report=target))

    with transaction.atomic():
        for hotspot in hotspots:
            # 1. Identify remaining active hotspots in the 15-meter cluster
            radius_km = 15.0 / 1000.0
            lat_delta = radius_km / 111.0
            lng_delta = radius_km / (111.0 * math.cos(math.radians(float(hotspot.latitude))))

            cluster_candidates = GarbageHotspot.objects.filter(
                is_active=True,
                latitude__range=(float(hotspot.latitude) - lat_delta, float(hotspot.latitude) + lat_delta),
                longitude__range=(float(hotspot.longitude) - lng_delta, float(hotspot.longitude) + lng_delta),
            ).exclude(id=hotspot.id)

            remaining_active = [
                h for h in cluster_candidates
                if haversine_km(hotspot.latitude, hotspot.longitude, h.latitude, h.longitude) * 1000 <= 15.0
            ]

            # 2. Check open interventions anchored to this hotspot
            open_interventions = list(HotspotIntervention.objects.filter(
                hotspot=hotspot,
                status__in=[
                    InterventionStatus.CREATED,
                    InterventionStatus.ACKNOWLEDGED,
                    InterventionStatus.FLAGGED,
                ]
            ))

            if remaining_active:
                remaining_active_ids = [h.id for h in remaining_active]
                new_anchor = sorted(remaining_active, key=lambda h: h.id)[0]

                if open_interventions:
                    for intervention in open_interventions:
                        # Check if any remaining active hotspot in the cluster already has an active intervention of the same type
                        already_has_active = HotspotIntervention.objects.filter(
                            hotspot_id__in=remaining_active_ids,
                            intervention_type=intervention.intervention_type,
                            status__in=[
                                InterventionStatus.CREATED,
                                InterventionStatus.ACKNOWLEDGED,
                                InterventionStatus.FLAGGED,
                            ]
                        ).exclude(id=intervention.id).exists()

                        if not already_has_active:
                            intervention.hotspot = new_anchor
                            reanchor_note = f"Re-anchored to active hotspot #{new_anchor.id} because #{hotspot.id} was retired."
                            intervention.resolution_notes = (
                                f"{intervention.resolution_notes}\n{reanchor_note}".strip()
                                if intervention.resolution_notes else reanchor_note
                            )
                            intervention.save(update_fields=['hotspot', 'resolution_notes'])
                        else:
                            intervention.status = InterventionStatus.CANCELLED
                            intervention.resolution_notes = (
                                f"{intervention.resolution_notes}\nCancelled: duplicate intervention type during re-anchor.".strip()
                                if intervention.resolution_notes else "Cancelled: duplicate intervention type during re-anchor."
                            )
                            intervention.save(update_fields=['status', 'resolution_notes'])

                # Inspect the entire cluster for a valid active DISPATCH intervention
                # (Only CREATED or ACKNOWLEDGED dispatches count; FLAGGED is not a dispatch)
                cluster_active_dispatch = HotspotIntervention.objects.filter(
                    hotspot_id__in=remaining_active_ids,
                    intervention_type=InterventionType.DISPATCH,
                    status__in=[InterventionStatus.CREATED, InterventionStatus.ACKNOWLEDGED]
                ).select_related('truck').order_by('id').first()

                for h in remaining_active:
                    if cluster_active_dispatch and cluster_active_dispatch.truck:
                        h.assigned_truck = cluster_active_dispatch.truck
                        h.dispatch_acknowledged = (cluster_active_dispatch.status == InterventionStatus.ACKNOWLEDGED)
                        h.dispatched_at = cluster_active_dispatch.created_at
                        h.save(update_fields=['assigned_truck', 'dispatch_acknowledged', 'dispatched_at'])
                    else:
                        h.assigned_truck = None
                        h.dispatch_acknowledged = True
                        h.dispatched_at = None
                        h.save(update_fields=['assigned_truck', 'dispatch_acknowledged', 'dispatched_at'])

            else:
                # No active targets remain in the cluster — cancel open interventions
                for intervention in open_interventions:
                    intervention.status = InterventionStatus.CANCELLED
                    cancel_note = f"Cancelled: {reason}" if reason else "Cancelled: Hotspot retired and no active cluster targets remain."
                    intervention.resolution_notes = (
                        f"{intervention.resolution_notes}\n{cancel_note}".strip()
                        if intervention.resolution_notes else cancel_note
                    )
                    intervention.save(update_fields=['status', 'resolution_notes'])

            # Neutralize the retired hotspot itself
            hotspot.is_active = False
            hotspot.assigned_truck = None
            hotspot.dispatch_acknowledged = True
            hotspot.dispatched_at = None
            hotspot.save(update_fields=['is_active', 'assigned_truck', 'dispatch_acknowledged', 'dispatched_at'])


def record_report_status_transition(report, new_status, changed_by=None, remarks='', resolved_at=None, previous_status=None):
    """
    Atomically updates a GarbageReport status and records a ReportStatusHistory entry.
    Preserves audit trail across multiple approval, resolution, rejection, and reopening cycles.
    Rejects invalid no-op transitions with ValueError.
    """
    from django.db import transaction
    from django.utils import timezone
    from watcher.models import ReportStatus, ReportStatusHistory

    latest_history = None
    if previous_status is not None:
        old_status = previous_status
    elif report.status != new_status:
        old_status = report.status
    else:
        # report.status matches new_status on the instance: check latest history to distinguish pre-mutation from no-op
        latest_history = ReportStatusHistory.objects.filter(report=report).order_by('-timestamp', '-id').first()
        if latest_history:
            if latest_history.new_status == new_status:
                raise ValueError(f"Cannot record transition: report #{report.id} is already in status '{new_status}'.")
            old_status = latest_history.new_status
        else:
            old_status = ''

    if old_status == new_status:
        raise ValueError(f"Cannot record transition: report #{report.id} is already in status '{new_status}'.")



    with transaction.atomic():
        report.status = new_status

        if new_status == ReportStatus.RESOLVED:
            report.resolved_at = resolved_at or timezone.now()
        elif new_status == ReportStatus.PENDING:
            # Reopening clears the current resolution and approval state
            report.resolved_at = None
            report.approved_at = None
            report.approved_by = None
        elif new_status == ReportStatus.APPROVED:
            # Latest approval timestamp and actor
            report.approved_at = timezone.now()
            report.approved_by = changed_by

        report.save()

        history = ReportStatusHistory.objects.create(
            report=report,
            previous_status=old_status,
            new_status=new_status,
            changed_by=changed_by,
            remarks=remarks,
        )
        return history





# ---------------------------------------------------------------------------
# Watcher Reported Spots
# ---------------------------------------------------------------------------

# Reports filed within this distance of an existing (non-rejected) spot are merged
# into it and increase its count instead of creating a new spot.
WATCHER_SPOT_MERGE_RADIUS_M = 10

# A spot is shown to watchers when it lies within this distance of today's route.
WATCHER_SPOT_ROUTE_RADIUS_M = 150

# Roles that may see watcher-reported spots and the reports behind them.
WATCHER_SPOT_VIEWER_ROLES = ('admin', 'brgy_official', 'watcher')


def can_view_watcher_spots(user):
    """Watcher spots are internal: staff and watchers only."""
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    return getattr(user, 'role', None) in WATCHER_SPOT_VIEWER_ROLES or bool(getattr(user, 'is_staff', False))


def find_matching_watcher_spot(lat, lng, radius_m=WATCHER_SPOT_MERGE_RADIUS_M):
    """Nearest non-rejected spot within radius_m of (lat, lng), or None."""
    import math
    from watcher.models import WatcherReportedSpot, WatcherSpotStatus
    from watcher.stop_validation_utils import haversine_m

    lat, lng = float(lat), float(lng)
    lat_delta = radius_m / 111000.0
    lng_delta = radius_m / (111000.0 * max(math.cos(math.radians(lat)), 0.01))

    candidates = WatcherReportedSpot.objects.filter(
        status__in=[WatcherSpotStatus.ACTIVE, WatcherSpotStatus.ADDED_TO_ROUTE],
        latitude__range=(lat - lat_delta, lat + lat_delta),
        longitude__range=(lng - lng_delta, lng + lng_delta),
    )
    best, best_d = None, None
    for spot in candidates:
        d = haversine_m(lat, lng, spot.latitude, spot.longitude)
        if d <= radius_m and (best_d is None or d < best_d):
            best, best_d = spot, d
    return best


def attach_report_to_watcher_spot(report, reporter):
    """
    Links an (already saved) watcher-spot report to a spot, merging into an existing
    one within WATCHER_SPOT_MERGE_RADIUS_M or creating a new spot. Also promotes the
    report to a GarbageHotspot so it shows up in Hotspot Detection like any other report.
    Returns (spot, created).
    """
    from django.utils import timezone
    from watcher.models import GarbageHotspot, WatcherReportedSpot

    with transaction.atomic():
        spot = find_matching_watcher_spot(report.latitude, report.longitude)
        created = spot is None
        if created:
            spot = WatcherReportedSpot.objects.create(
                latitude=report.latitude,
                longitude=report.longitude,
                barangay=report.barangay,
                first_reported_by=reporter,
                last_reported_at=timezone.now(),
            )
        else:
            spot.last_reported_at = timezone.now()
            spot.save(update_fields=['last_reported_at', 'updated_at'])

        report.watcher_spot = spot
        report.save(update_fields=['watcher_spot'])

        if report.latitude is not None and report.longitude is not None and report.barangay:
            GarbageHotspot.objects.get_or_create(
                source_report=report,
                defaults={
                    'name': f'Report #{report.id} — {report.get_issue_type_display()}',
                    'severity': report.severity,
                    'barangay': report.barangay,
                    'latitude': report.latitude,
                    'longitude': report.longitude,
                    'is_active': True,
                },
            )
    return spot, created


def spot_report_counts(spot, user=None):
    """(total live reports, reports by `user`) for a spot."""
    from watcher.models import ReportStatus
    live = spot.reports.filter(status=ReportStatus.APPROVED)
    total = live.count()
    mine = live.filter(user=user).count() if user is not None and getattr(user, 'is_authenticated', False) else 0
    return total, mine


def _point_segment_distance_m(plat, plng, alat, alng, blat, blng):
    """Distance in meters from point P to segment AB (local equirectangular projection)."""
    import math
    k = 111320.0
    cos_lat = math.cos(math.radians(plat))
    ax, ay = (alng - plng) * k * cos_lat, (alat - plat) * k
    bx, by = (blng - plng) * k * cos_lat, (blat - plat) * k
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    if seg2 == 0:
        return math.hypot(ax, ay)
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / seg2))
    return math.hypot(ax + t * dx, ay + t * dy)


def route_points_for_schedule(schedule):
    """Ordered (lat, lng) points of a schedule's route (start point + stops)."""
    points = []
    for wp in (schedule.waypoints or []):
        if not isinstance(wp, dict):
            continue
        lat, lng = wp.get('lat'), wp.get('lng')
        if lat is None or lng is None:
            continue
        try:
            points.append((float(lat), float(lng)))
        except (TypeError, ValueError):
            continue
    return points


def distance_to_route_m(lat, lng, points):
    """Min distance in meters from (lat, lng) to the polyline through `points`."""
    from watcher.stop_validation_utils import haversine_m
    if not points:
        return None
    lat, lng = float(lat), float(lng)
    if len(points) == 1:
        return haversine_m(lat, lng, points[0][0], points[0][1])
    return min(
        _point_segment_distance_m(lat, lng, a[0], a[1], b[0], b[1])
        for a, b in zip(points, points[1:])
    )
