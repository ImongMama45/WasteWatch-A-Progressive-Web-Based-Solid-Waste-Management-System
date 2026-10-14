from django.utils import timezone
import math

def fmt_time(dt):
    """Cross-platform 12-hour time without leading zero (works on Windows & Linux)."""
    return dt.strftime('%I:%M %p').lstrip('0') if dt else ''

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def get_cluster_ids(lat, lng, radius_m=15):
    from .models import GarbageHotspot
    lat, lng = float(lat), float(lng)
    radius_km = radius_m / 1000.0
    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * math.cos(math.radians(lat)))
    
    nearby = GarbageHotspot.objects.filter(
        latitude__range=(lat - lat_delta, lat + lat_delta),
        longitude__range=(lng - lng_delta, lng + lng_delta),
    )
    return [h.id for h in nearby if haversine_km(lat, lng, float(h.latitude), float(h.longitude)) * 1000 <= radius_m]

from rest_framework import viewsets, permissions, status, filters, mixins
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import (
    GarbageReport,
    CollectionConfirmation,
    GarbageHotspot,
    Escalation,
    ReportStatus,
    StopValidation,
    StopValidationStatus,
)
from notifications.models import Notification, NotificationType
from django.db import transaction
import json
from .serializers import (
    GarbageReportSerializer,
    CollectionConfirmationSerializer,
    GarbageHotspotSerializer,
    EscalationSerializer,
    StopValidationSerializer,
)
from .stop_validation_service import ensure_today_stop_validations
from .stop_validation_utils import (
    COLLECTION_RADIUS_M,
    INSPECTION_RADIUS_M,
    VERIFICATION_RADIUS_M,
    get_stop_coordinates,
    is_validation_visible,
    validate_gps_proximity,
)

# Roles that may see all reports across the city on the map
_MAP_FULL_ACCESS_ROLES = {'admin', 'watcher', 'brgy_official', 'driver'}

class GarbageReportViewSet(viewsets.ModelViewSet):
    queryset = GarbageReport.objects.all()
    serializer_class = GarbageReportSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action in ('create', 'list', 'retrieve', 'public', 'map_pins', 'leaderboard'):
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if self.action in ('update', 'partial_update', 'destroy'):
            if request.user.role not in ['admin', 'brgy_official'] and obj.user != request.user:
                self.permission_denied(request, message="Not authorized to modify this report.")
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['barangay', 'status', 'issue_type', 'severity']
    search_fields = ['address', 'description']
    ordering_fields = ['created_at', 'severity']
    throttle_scope = 'report_submission'

    def get_throttles(self):
        # Only throttle the creation of new reports to prevent spam
        if self.action == 'create':
            return [ScopedRateThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        user = self.request.user
        qs = GarbageReport.objects.filter(is_archived=False)

        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)

        # 1. Anonymous users see only approved reports
        if not user.is_authenticated:
            return qs.filter(status=ReportStatus.APPROVED)

        # 2. Admins see everything
        if user.role == 'admin':
            return qs

        # 3. Barangay Officials see reports in their assigned barangay
        if user.role == 'brgy_official':
            if user.barangay:
                return qs.filter(barangay=user.barangay)
            return qs.none()

        # 4. Citizens/Watchers see their own reports PLUS all approved reports
        from django.db.models import Q
        return qs.filter(
            Q(user=user) | Q(status=ReportStatus.APPROVED)
        )

    def perform_create(self, serializer):
        # Automatically set to PENDING on creation
        user = self.request.user if self.request.user.is_authenticated else None
        
        # If barangay not provided, try to find it from address string
        barangay = serializer.validated_data.get('barangay')
        address = serializer.validated_data.get('address', '')
        
        if not barangay and address:
            from accounts.models import Barangay
            # Try to find barangay name in address
            # Sort by length descending to match "Barangay 10" before "Barangay 1"
            all_brgys = Barangay.objects.all()
            for brgy in sorted(all_brgys, key=lambda x: len(x.name), reverse=True):
                if brgy.name.lower() in address.lower():
                    barangay = brgy
                    break
        
        # Fallback to user's barangay if still not found
        if not barangay and user and user.barangay:
            barangay = user.barangay
            
        serializer.save(user=user, status=ReportStatus.PENDING, barangay=barangay)

    @action(detail=True, methods=['post', 'patch'], permission_classes=[permissions.IsAuthenticated])
    def approve(self, request, pk=None):
        if request.user.role not in ['admin', 'brgy_official']:
            return Response({'error': 'Not authorized'}, status=403)

        report = self.get_object()

        if request.user.role == 'brgy_official' and report.barangay != request.user.barangay:
            return Response({'error': 'Cannot approve reports outside your barangay'}, status=status.HTTP_403_FORBIDDEN)

        report.status = ReportStatus.APPROVED
        report.approved_by = request.user
        report.approved_at = timezone.now()
        report.rejected_by = None
        report.rejected_at = None
        report.rejection_reason = ''
        report.save()

        # Send notification to the reporter
        if report.user:
            from notifications.models import Notification, NotificationType
            Notification.objects.create(
                user=report.user,
                title='Report Approved',
                message=f'Your {report.get_issue_type_display()} report at {report.address or "the reported location"} has been approved and published to the map.',
                type=NotificationType.REPORT_UPDATE
            )

        # Auto-promote to GarbageHotspot so it appears on the map (idempotent on double-click).
        if report.latitude and report.longitude and report.barangay:
            GarbageHotspot.objects.get_or_create(
                source_report=report,
                defaults={
                    'name': f'Report #{report.id} — {report.get_issue_type_display()}',
                    'severity': report.severity,
                    'barangay': report.barangay,
                    'latitude': report.latitude,
                    'longitude': report.longitude,
                }
            )

        return Response(GarbageReportSerializer(report, context={'request': request}).data)

    @action(detail=True, methods=['post', 'patch'], permission_classes=[permissions.IsAuthenticated])
    def reject(self, request, pk=None):
        """PENDING -> REJECTED. Saves reason and audit trail."""
        if request.user.role not in ['admin', 'brgy_official']:
            return Response({'error': 'Not authorized'}, status=403)
        
        report = self.get_object()
        
        # Security: Barangay official can only reject reports in their barangay
        if request.user.role == 'brgy_official' and report.barangay != request.user.barangay:
            return Response({'error': 'Cannot reject reports outside your barangay'}, status=status.HTTP_403_FORBIDDEN)

        reason = request.data.get('rejection_reason', '')
        if not reason:
            return Response({'rejection_reason': 'This field is required.'}, status=status.HTTP_400_BAD_REQUEST)

        report.status = ReportStatus.REJECTED
        report.rejected_by = request.user
        report.rejected_at = timezone.now()
        report.rejection_reason = reason
        report.approved_by = None
        report.approved_at = None
        report.save()

        # Send notification to the reporter
        if report.user:
            from notifications.models import Notification, NotificationType
            Notification.objects.create(
                user=report.user,
                title='Report Rejected',
                message=f'Your {report.get_issue_type_display()} report at {report.address or "the reported location"} was rejected. Reason: {reason}',
                type=NotificationType.REPORT_UPDATE
            )

        GarbageHotspot.objects.filter(source_report=report).delete()

        return Response(GarbageReportSerializer(report, context={'request': request}).data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def archive(self, request, pk=None):
        """Soft deletes the report (only available to Brgy Officials / Admin)."""
        if request.user.role not in ['admin', 'brgy_official']:
            return Response({'error': 'Not authorized'}, status=403)
        
        report = self.get_object()
        if request.user.role == 'brgy_official' and report.barangay != request.user.barangay:
            return Response({'error': 'Cannot archive reports outside your barangay'}, status=status.HTTP_403_FORBIDDEN)
            
        if report.status != ReportStatus.REJECTED:
            return Response({'error': 'Only rejected reports can be archived.'}, status=400)
            
        report.is_archived = True
        report.save()
        return Response({'status': 'archived'})

    @action(detail=False, methods=['get'])
    def public(self, request):
        """Returns ONLY approved reports for the public map."""
        approved_reports = GarbageReport.objects.filter(status=ReportStatus.APPROVED)
        serializer = self.get_serializer(approved_reports, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def map_pins(self, request):
        """
        Returns approved reports as map pins — sourced from GarbageHotspot
        so only admin/brgy_official-approved issues appear on the public map.
        Each pin links back to the originating GarbageReport for the detail panel.
        """
        hotspots = GarbageHotspot.objects.select_related('barangay', 'source_report', 'source_report__user').all()

        is_privileged = request.user.is_authenticated and getattr(request.user, 'role', None) in _MAP_FULL_ACCESS_ROLES
        
        data = []
        for h in hotspots:
            # Try to find the originating report
            report = h.source_report

            data.append({
                'id':            h.id,
                'report_id':     report.id if report else None,
                'lat':           float(h.latitude),
                'lng':           float(h.longitude),
                'issue_type':    report.issue_type if report else 'overflow',
                'severity':      h.severity,
                'status':        report.status if report else 'approved',
                'barangay_name': h.barangay.name if h.barangay else 'Unknown',
                'address':       report.address if report else h.name,
                'reported':      report.created_at.isoformat() if report else None,
                'description':   report.description if report else '',
                'images':        [img.url for img in [report.image, report.image_2, report.image_3, report.image_4] if report and img] if report else [],
                'user_name':     (report.user.get_full_name() or report.user.username) if (report and report.user and is_privileged) else None,
                'rejection_reason': None,
            })

        return Response(data)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        qs = self.get_queryset()
        return Response({
            'total':    qs.count(),
            'pending':  qs.filter(status=ReportStatus.PENDING).count(),
            'approved': qs.filter(status=ReportStatus.APPROVED).count(),
            'resolved': qs.filter(status=ReportStatus.RESOLVED).count(),
            'rejected': qs.filter(status=ReportStatus.REJECTED).count(),
        })

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def mine(self, request):
        qs = GarbageReport.objects.filter(user=request.user).order_by('-created_at')
        return Response(self.get_serializer(qs, many=True).data)

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def mine_stats(self, request):
        qs = GarbageReport.objects.filter(user=request.user)
        return Response({
            'total':    qs.count(),
            'pending':  qs.filter(status=ReportStatus.PENDING).count(),
            'approved': qs.filter(status=ReportStatus.APPROVED).count(),
            'resolved': qs.filter(status=ReportStatus.RESOLVED).count(),
            'rejected': qs.filter(status=ReportStatus.REJECTED).count(),
        })

    @action(detail=False, methods=['get'])
    def leaderboard(self, request):
        """
        Returns the top barangays based on the number of resolved reports and resolution rate.
        Used for the Cleanest Barangay Leaderboard widget.
        """
        from django.db.models import Count, Q
        
        stats = GarbageReport.objects.exclude(barangay__isnull=True).values(
            'barangay__name'
        ).annotate(
            total=Count('id'),
            resolved=Count('id', filter=Q(status=ReportStatus.RESOLVED))
        )
        
        leaderboard_data = []
        for item in stats:
            total = item['total']
            resolved = item['resolved']
            rate = int((resolved / total) * 100) if total > 0 else 0
            
            # Simple scoring metric: heavily weight resolutions, lightly weight rate
            score = (resolved * 10) + rate
            
            leaderboard_data.append({
                'barangay': item['barangay__name'],
                'resolved': resolved,
                'total': total,
                'rate': rate,
                'score': score
            })
            
        # Sort by score descending and return top 5
        leaderboard_data.sort(key=lambda x: x['score'], reverse=True)
        
        for i, entry in enumerate(leaderboard_data):
            entry['rank'] = i + 1
            
        return Response(leaderboard_data[:5])

class CollectionConfirmationViewSet(viewsets.ModelViewSet):
    queryset = CollectionConfirmation.objects.all()
    serializer_class = CollectionConfirmationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        confirmation = serializer.save(confirmed_by=self.request.user)
        if confirmation.report:
            confirmation.report.status = ReportStatus.RESOLVED
            confirmation.report.save()
            # Retire the hotspot — collection confirmed, no longer an active issue
            GarbageHotspot.objects.filter(source_report=confirmation.report).delete()

class GarbageHotspotViewSet(viewsets.ModelViewSet):
    queryset = GarbageHotspot.objects.all()
    serializer_class = GarbageHotspotSerializer
    permission_classes = [permissions.IsAuthenticated]

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if self.action in ('update', 'partial_update', 'destroy'):
            if request.user.role not in ['admin', 'brgy_official']:
                self.permission_denied(request, message="Not authorized to modify this hotspot.")

    def get_permissions(self):
        if self.action in ('create',):
            class IsAdminOrBrgyOfficial(permissions.BasePermission):
                def has_permission(self, request, view):
                    return request.user.is_authenticated and request.user.role in ['admin', 'brgy_official']
            return [IsAdminOrBrgyOfficial()]
        return super().get_permissions()

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        # Sort by id to ensure stable anchor selection (lowest ID is always the anchor)
        data = sorted(serializer.data, key=lambda x: x['id'])
        
        CLUSTER_RADIUS_M = 15
        clustered = []
        SEVERITY_RANKS = {'low': 1, 'medium': 2, 'high': 3, 'critical': 4}
        
        for row in data:
            lat = float(row['latitude'])
            lng = float(row['longitude'])
            
            found_cluster = False
            for cluster in clustered:
                if haversine_km(lat, lng, float(cluster['latitude']), float(cluster['longitude'])) * 1000 <= CLUSTER_RADIUS_M:
                    cluster['report_count'] = cluster.get('report_count', 1) + 1
                    
                    if row.get('assigned_truck'):
                        cluster['assigned_truck'] = row['assigned_truck']
                        cluster['dispatch_acknowledged'] = row.get('dispatch_acknowledged')
                        cluster['dispatched_at'] = row.get('dispatched_at')
                        
                    # Escalate severity to max
                    if SEVERITY_RANKS.get(row.get('severity', 'low'), 1) > SEVERITY_RANKS.get(cluster.get('severity', 'low'), 1):
                        cluster['severity'] = row['severity']
                        
                    row_name = row.get('name', '')
                    cluster_name = cluster.get('name', '')
                    
                    def extract_type(name):
                        if '—' in name: return name.split('—')[-1].strip()
                        if '-' in name: return name.split('-')[-1].strip()
                        return name

                    row_type = extract_type(row_name)
                    cluster_type = extract_type(cluster_name)
                    
                    if row_type != cluster_type and cluster_type != 'Mixed':
                        cluster['name'] = f"{cluster.get('barangay_name', 'Unknown')} — Mixed"
                        cluster['type'] = 'Mixed'
                        
                    found_cluster = True
                    break
                    
            if not found_cluster:
                # Add type if not already there
                def extract_type(name):
                    if '—' in name: return name.split('—')[-1].strip()
                    if '-' in name: return name.split('-')[-1].strip()
                    return name
                row['type'] = extract_type(row.get('name', ''))
                clustered.append(row)
                
        return Response(clustered)

    @action(detail=False, methods=['get'], url_path='nearby')
    def nearby(self, request):
        """
        Returns hotspots within 5 km of the driver, sorted by distance.
        Query params: ?lat=<float>&lng=<float>
        Falls back to all hotspots if no coords provided (capped at 50).
        """
        import math

        try:
            drv_lat = float(request.query_params.get('lat', 0))
            drv_lng = float(request.query_params.get('lng', 0))
            has_coords = bool(request.query_params.get('lat'))
        except ValueError:
            has_coords = False

        if has_coords:
            # Bounding box pre-filter (~5 km radius) — uses DB index on lat/lng columns
            RADIUS_KM = 5.0
            lat_delta = RADIUS_KM / 111.0
            lng_delta = RADIUS_KM / (111.0 * math.cos(math.radians(drv_lat)))
            qs = GarbageHotspot.objects.filter(
                latitude__range=(drv_lat - lat_delta, drv_lat + lat_delta),
                longitude__range=(drv_lng - lng_delta, drv_lng + lng_delta),
            ).select_related('barangay', 'assigned_truck')
        else:
            qs = GarbageHotspot.objects.select_related('barangay', 'assigned_truck').all()[:50]

        data = []
        for h in qs:
            dist_km = haversine_km(drv_lat, drv_lng, float(h.latitude), float(h.longitude)) if has_coords else 0
            data.append({
                'id':                  h.id,
                'severity':            h.severity,
                'barangay':            h.barangay.name if h.barangay else 'Unknown',
                'address':             h.name,
                'description':         '',
                'distanceKm':          round(dist_km, 2),
                'reportedAt':          fmt_time(h.created_at),
                'type':                'overflow',
                'latitude':            float(h.latitude),
                'longitude':           float(h.longitude),
                'assigned_truck_id':   h.assigned_truck_id,
                'assigned_truck_plate':h.assigned_truck.plate_number if h.assigned_truck else None,
            })
        data.sort(key=lambda x: x['distanceKm'])
        return Response(data)

    @action(detail=False, methods=['get'], url_path='assigned')
    def assigned(self, request):
        """
        Returns hotspots assigned to the requesting driver's truck.
        The driver must have an active shift with an associated truck.
        """
        from driver.models import DriverShift
        shift = DriverShift.objects.filter(driver=request.user, is_active=True).select_related('truck').first()
        if not shift or not shift.truck:
            return Response([])
        qs = GarbageHotspot.objects.filter(
            assigned_truck=shift.truck
        ).select_related('barangay', 'assigned_truck')
        data = []
        for h in qs:
            data.append({
                'id':                  h.id,
                'severity':            h.severity,
                'barangay':            h.barangay.name if h.barangay else 'Unknown',
                'barangay_id':         h.barangay_id,
                'address':             h.name,
                'description':         '',
                'distanceKm':          None,
                'reportedAt':          fmt_time(h.created_at),
                'type':                'overflow',
                'latitude':            float(h.latitude),
                'longitude':           float(h.longitude),
                'assigned_truck_id':   h.assigned_truck_id,
                'assigned_truck_plate':h.assigned_truck.plate_number if h.assigned_truck else None,
                'dispatch_acknowledged': h.dispatch_acknowledged,
                'dispatched_at':         h.dispatched_at.isoformat() if h.dispatched_at else None,
            })
        return Response(data)

    @action(detail=True, methods=['get'], url_path='reports')
    def reports(self, request, pk=None):
        """Re-derives the cluster by proximity — do NOT trust a `count` field, it doesn't exist on the model."""
        hotspot = self.get_object()
        cluster_ids = get_cluster_ids(hotspot.latitude, hotspot.longitude, radius_m=15)
        
        nearby = GarbageHotspot.objects.filter(
            id__in=cluster_ids,
            source_report__isnull=False,
        ).select_related('source_report', 'source_report__user')

        def _get_url(img):
            if not img: return None
            try:
                u = img.url
                if u.startswith('res.cloudinary.com'): return f'https://{u}'
                if u.startswith('//res.cloudinary.com'): return f'https:{u}'
                if not u.startswith('http') and request: return request.build_absolute_uri(u)
                return u
            except Exception: return None

        reports_dict = {}
        for h in nearby:
            r = h.source_report
            if r.id not in reports_dict:
                reports_dict[r.id] = {
                    'id': r.id, 'issue_type': r.issue_type, 'severity': r.severity,
                    'status': r.status, 'address': r.address, 'description': r.description,
                    'latitude': float(r.latitude) if r.latitude else None,
                    'longitude': float(r.longitude) if r.longitude else None,
                    'reported_by': (r.user.get_full_name() or r.user.username) if r.user else 'Anonymous',
                    'created_at': r.created_at.isoformat(),
                    'images': [_get_url(img) for img in [r.image, r.image_2, r.image_3, r.image_4] if img],
                }
        reports = list(reports_dict.values())
        reports.sort(key=lambda x: x['created_at'], reverse=True)
        return Response(reports)

    @action(detail=True, methods=['get'], url_path='recommend-trucks')
    def recommend_trucks(self, request, pk=None):
        from driver.models import DriverShift, Truck, TruckStatus
        hotspot = self.get_object()

        shifts = DriverShift.objects.filter(is_active=True, truck__isnull=False)\
            .select_related('truck', 'schedule', 'driver').prefetch_related('schedule__barangays')

        scored = []
        seen_trucks = set()
        for shift in shifts:
            truck = shift.truck
            if truck.status != TruckStatus.ACTIVE:
                continue
            if truck.id in seen_trucks:
                continue
            seen_trucks.add(truck.id)
            if shift.schedule and hotspot.barangay in shift.schedule.barangays.all():
                score = 0
            elif truck.zone and hotspot.barangay and truck.zone.strip().lower() == hotspot.barangay.name.strip().lower():
                score = 1  # fallback — zone is freeform text, not FK'd to Barangay
            else:
                score = 2
            scored.append((score, truck, shift))

        scored.sort(key=lambda x: x[0])
        return Response([{
            'id': t.id, 'plate_number': t.plate_number, 'model': t.model, 'zone': t.zone,
            'driver_name': s.driver.get_full_name() or s.driver.username,
            'capacity': t.current_capacity,
            'match': ['schedule', 'zone', 'other'][sc],
        } for sc, t, s in scored])

    @action(detail=True, methods=['post'], url_path='assign-truck')
    def assign_truck(self, request, pk=None):
        from driver.models import Truck, TruckStatus
        if request.user.role not in ('admin', 'brgy_official'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Only admins can assign trucks to hotspots.')
        hotspot = self.get_object()
        truck_id = request.data.get('truck_id')
        
        cluster_ids = get_cluster_ids(hotspot.latitude, hotspot.longitude, radius_m=15)
        cluster_qs = GarbageHotspot.objects.filter(id__in=cluster_ids)

        if truck_id:
            try:
                truck = Truck.objects.get(id=truck_id, status=TruckStatus.ACTIVE)
            except Truck.DoesNotExist:
                return Response({'error': 'Truck not found or not active.'}, status=404)
            from django.utils import timezone
            cluster_qs.update(
                assigned_truck=truck,
                dispatch_acknowledged=False,
                dispatched_at=timezone.now()
            )
            from .models import HotspotIntervention, InterventionType, InterventionStatus
            HotspotIntervention.objects.filter(
                hotspot=hotspot, 
                intervention_type=InterventionType.DISPATCH,
                status__in=[InterventionStatus.CREATED, InterventionStatus.ACKNOWLEDGED]
            ).update(status=InterventionStatus.CANCELLED)
            HotspotIntervention.objects.create(
                hotspot=hotspot,
                intervention_type=InterventionType.DISPATCH,
                status=InterventionStatus.CREATED,
                truck=truck,
                created_by=request.user
            )
            hotspot.refresh_from_db()
        else:
            cluster_qs.update(
                assigned_truck=None,
                dispatch_acknowledged=True,
                dispatched_at=None
            )
            from .models import HotspotIntervention, InterventionType, InterventionStatus
            HotspotIntervention.objects.filter(
                hotspot=hotspot, 
                intervention_type=InterventionType.DISPATCH,
                status__in=[InterventionStatus.CREATED, InterventionStatus.ACKNOWLEDGED]
            ).update(status=InterventionStatus.CANCELLED)
            hotspot.refresh_from_db()
            
        return Response({
            'status': 'ok', 'id': hotspot.id,
            'assigned_truck_id': hotspot.assigned_truck_id,
            'assigned_truck_plate': hotspot.assigned_truck.plate_number if hotspot.assigned_truck else None,
        })

    @action(detail=True, methods=['post'], url_path='acknowledge-dispatch')
    def acknowledge_dispatch(self, request, pk=None):
        hotspot = self.get_object()
        if hotspot.assigned_truck_id is None:
            return Response({'error': 'No active dispatch on this hotspot.'}, status=400)
            
        if request.user.role != 'admin':
            from driver.models import DriverShift
            shift = DriverShift.objects.filter(driver=request.user, is_active=True, truck=hotspot.assigned_truck).first()
            if not shift:
                return Response({'error': 'Not your dispatch.'}, status=403)

        cluster_ids = get_cluster_ids(hotspot.latitude, hotspot.longitude, radius_m=15)
        GarbageHotspot.objects.filter(id__in=cluster_ids).update(dispatch_acknowledged=True)
        
        from .models import HotspotIntervention, InterventionType, InterventionStatus
        from django.utils import timezone
        active_dispatch = HotspotIntervention.objects.filter(
            hotspot=hotspot,
            intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.CREATED
        ).first()
        if active_dispatch:
            active_dispatch.status = InterventionStatus.ACKNOWLEDGED
            active_dispatch.acknowledged_by = request.user
            active_dispatch.acknowledged_at = timezone.now()
            active_dispatch.save()
            
        return Response({'status': 'acknowledged'})

    @action(detail=True, methods=['post'], url_path='flag-to-brgy')
    def flag_to_brgy(self, request, pk=None):
        """
        Notify Barangay officials about a persistent hotspot.
        """
        if request.user.role not in ('admin', 'brgy_official'):
            return Response({'error': 'Not authorized'}, status=403)

        hotspot = self.get_object()
        if not hotspot.barangay:
            return Response({'error': 'Hotspot has no associated barangay.'}, status=400)

        from notifications.models import Notification, NotificationType
        from django.contrib.auth import get_user_model

        User = get_user_model()
        officials = User.objects.filter(role='brgy_official', barangay=hotspot.barangay)
        notifications = []
        for off in officials:
            notifications.append(
                Notification(
                    user=off,
                    type=NotificationType.REPORT_UPDATE,
                    title='Hotspot Flagged by Admin',
                    message=f"Admin flagged a hotspot in {hotspot.barangay.name} ({hotspot.severity.upper()} severity) for your attention."
                )
            )
        if notifications:
            Notification.objects.bulk_create(notifications)

        from .models import HotspotIntervention, InterventionType, InterventionStatus
        HotspotIntervention.objects.filter(
            hotspot=hotspot, 
            intervention_type=InterventionType.FLAG,
            status__in=[InterventionStatus.FLAGGED, InterventionStatus.ACKNOWLEDGED]
        ).update(status=InterventionStatus.CANCELLED)
        
        HotspotIntervention.objects.create(
            hotspot=hotspot,
            intervention_type=InterventionType.FLAG,
            status=InterventionStatus.FLAGGED,
            created_by=request.user
        )

        return Response({'status': 'flagged'})

    @action(detail=True, methods=['post'], url_path='noted')
    def noted(self, request, pk=None):
        """Mark that the driver has noted this hotspot. No model changes needed — returns 200."""
        return Response({'status': 'noted', 'id': pk})

class StopValidationViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Centralized stop validation workflow API.
    GET  /api/watcher/stop-validations/
    POST /api/watcher/stop-validations/pre-inspect/
    POST /api/watcher/stop-validations/post-verify/
    """
    queryset = StopValidation.objects.select_related(
        'schedule', 'schedule__truck', 'driver',
        'pre_validation_watcher', 'post_validation_watcher',
    ).prefetch_related('schedule__barangays')
    serializer_class = StopValidationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        # Allow public read access to the list endpoint for the citizen map
        if self.action == 'list':
            return [permissions.AllowAny()]
        return super().get_permissions()

    def get_queryset(self):
        ensure_today_stop_validations()
        qs = super().get_queryset()
        
        start_date_param = self.request.query_params.get('start_date')
        end_date_param = self.request.query_params.get('end_date')
        date_param = self.request.query_params.get('date')
        
        from django.utils.dateparse import parse_date
        
        if start_date_param and end_date_param:
            start_date = parse_date(start_date_param)
            end_date = parse_date(end_date_param)
            if start_date and end_date:
                qs = qs.filter(collection_date__range=(start_date, end_date))
        elif date_param:
            target_date = parse_date(date_param) or timezone.localdate()
            qs = qs.filter(collection_date=target_date)
        else:
            qs = qs.filter(collection_date=timezone.localdate())

        user = self.request.user
        if user.is_authenticated and getattr(user, 'role', None) == 'watcher' and getattr(user, 'barangay', None):
            qs = qs.filter(barangay=user.barangay)

        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(current_status=status_param)

        schedule_id = self.request.query_params.get('schedule_id')
        if schedule_id:
            qs = qs.filter(schedule_id=schedule_id)

        visible = [sv.id for sv in qs if is_validation_visible(sv)]
        return qs.filter(id__in=visible)

    def _get_validation(self, schedule_id, stop_order):
        today = timezone.localdate()
        try:
            return StopValidation.objects.select_related('schedule', 'schedule__truck', 'schedule__driver').get(
                schedule_id=schedule_id,
                stop_order=stop_order,
                collection_date=today,
            )
        except StopValidation.DoesNotExist:
            return None

    def _update_driver_timeline(self, validation):
        driver = validation.schedule.driver
        if not driver:
            return

        # Check if all stops in schedule are completed
        all_stops = StopValidation.objects.filter(schedule=validation.schedule, collection_date=validation.collection_date)
        pending = all_stops.exclude(current_status__in=[
            StopValidationStatus.VERIFIED_COLLECTED, 
            StopValidationStatus.COLLECTION_DISPUTED,
            StopValidationStatus.EMPTY_STOP
        ])
        
        is_completed = not pending.exists() and all_stops.exists()

        # Build full timeline
        timeline = []
        for stop in all_stops.order_by('stop_order'):
            if stop.current_status == StopValidationStatus.PENDING_INSPECTION:
                continue
                
            # Formulate the string based on status
            st = stop.current_status
            val_text = "Verified"
            if st == StopValidationStatus.EMPTY_STOP:
                val_text = "Empty"
            elif st == StopValidationStatus.VERIFIED_COLLECTED:
                if stop.pre_validation_remarks or stop.dispute_reason:
                    val_text = "Present"
                else:
                    val_text = "Collected"
            elif st == StopValidationStatus.COLLECTION_DISPUTED:
                val_text = "Missed"
            elif st == StopValidationStatus.READY_FOR_COLLECTION:
                if stop.pre_validation_remarks or stop.pre_validation_photo:
                    val_text = "Present"
                else:
                    val_text = "Inspected"
                    
            # Get image
            img_url = None
            if stop.post_validation_photo:
                img_url = stop.post_validation_photo.url
            elif stop.pre_validation_photo:
                img_url = stop.pre_validation_photo.url
                
            # Get timestamp
            ts = stop.post_validation_timestamp or stop.pre_validation_timestamp or timezone.now()
                
            timeline.append({
                "stop_order": stop.stop_order,
                "status": val_text,
                "image": img_url,
                "timestamp": ts.isoformat()
            })
            
        if not timeline:
            return

        today = timezone.localdate()
        notif = Notification.objects.filter(
            user=driver,
            type=NotificationType.WATCHER_ROUTE_SUMMARY,
            created_at__date=today
        ).first()
        
        msg_data = {
            "type": "summary",
            "watcher_name": self.request.user.full_name,
            "truck_name": validation.schedule.truck.plate_number if validation.schedule.truck else "Truck",
            "timeline": timeline,
        }
        
        title = "Route Confirmation Complete" if is_completed else "Watcher Route updates"
        
        if notif:
            notif.title = title
            notif.message = json.dumps(msg_data)
            notif.created_at = timezone.now()
            notif.is_read = False
            notif.save()
        else:
            Notification.objects.create(
                user=driver,
                title=title,
                message=json.dumps(msg_data),
                type=NotificationType.WATCHER_ROUTE_SUMMARY
            )
            
        self._send_driver_notification(driver, title, msg_data)

    def _send_driver_notification(self, driver, title, msg_data):
        # External calls like WebSockets or Push Notifications go here.
        # This executes outside the atomic block in the views.
        pass


    @action(detail=False, methods=['post'], url_path='pre-inspect')
    def pre_inspect(self, request):
        """
        Watcher pre-collection inspection.
        outcome: garbage_present | no_garbage
        """
        if request.user.role not in ('watcher', 'admin', 'brgy_official'):
            return Response({'error': 'Not authorized.'}, status=status.HTTP_403_FORBIDDEN)

        schedule_id = request.data.get('schedule_id')
        stop_order = request.data.get('stop_order')
        outcome_raw = (request.data.get('outcome') or '').strip().lower()
        if outcome_raw == 'present':
            outcome = 'garbage_present'
        elif outcome_raw == 'empty':
            outcome = 'no_garbage'
        else:
            outcome = outcome_raw

        lat = request.data.get('lat')
        lng = request.data.get('lng')
        remarks = (request.data.get('notes') or request.data.get('remarks') or '').strip()
        photo = request.FILES.get('photo')
        photo_2 = request.FILES.get('photo_2')
        photo_3 = request.FILES.get('photo_3')
        photo_4 = request.FILES.get('photo_4')

        if not schedule_id or stop_order is None:
            return Response({'error': 'schedule_id and stop_order are required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            stop_order = int(stop_order)
        except (TypeError, ValueError):
            return Response({'error': 'stop_order must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)

        if outcome not in ('garbage_present', 'no_garbage'):
            return Response({'error': 'outcome must be garbage_present or no_garbage.'}, status=status.HTTP_400_BAD_REQUEST)

        validation = self._get_validation(schedule_id, stop_order)
        if not validation:
            return Response({'error': 'Stop validation not found for today.'}, status=status.HTTP_404_NOT_FOUND)
            
        if validation.current_status == StopValidationStatus.READY_FOR_COLLECTION:
            return Response(
                StopValidationSerializer(validation, context={'request': request}).data,
                status=status.HTTP_200_OK
            )
            
        if validation.current_status != StopValidationStatus.PENDING_INSPECTION:
            return Response({'error': 'Stop is not pending inspection.'}, status=status.HTTP_400_BAD_REQUEST)

        coords = get_stop_coordinates(validation.schedule, stop_order)
        if not coords:
            return Response({'error': 'Stop coordinates not found.'}, status=status.HTTP_400_BAD_REQUEST)
        ok, err = validate_gps_proximity(lat, lng, coords[0], coords[1], INSPECTION_RADIUS_M)
        if not ok:
            return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            validation.pre_validation_watcher = request.user
            validation.pre_validation_timestamp = timezone.now()
            validation.pre_validation_latitude = lat
            validation.pre_validation_longitude = lng
            validation.pre_validation_remarks = remarks
            if photo: validation.pre_validation_photo = photo
            if photo_2: validation.pre_validation_photo_2 = photo_2
            if photo_3: validation.pre_validation_photo_3 = photo_3
            if photo_4: validation.pre_validation_photo_4 = photo_4
            validation.current_status = (
                StopValidationStatus.READY_FOR_COLLECTION
                if outcome == 'garbage_present'
                else StopValidationStatus.EMPTY_STOP
            )
            validation.save()

            # Update the driver timeline inside atomic
            self._update_driver_timeline(validation)

        return Response(
            StopValidationSerializer(validation, context={'request': request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=['post'], url_path='post-verify')
    def post_verify(self, request):
        """
        Watcher post-collection verification.
        outcome: success | failed
        """
        if request.user.role not in ('watcher', 'admin', 'brgy_official'):
            return Response({'error': 'Not authorized.'}, status=status.HTTP_403_FORBIDDEN)

        schedule_id = request.data.get('schedule_id')
        stop_order = request.data.get('stop_order')
        outcome = (request.data.get('outcome') or '').strip().lower()
        lat = request.data.get('lat')
        lng = request.data.get('lng')
        dispute_reason = (request.data.get('dispute_reason') or request.data.get('notes') or request.data.get('description') or '').strip()
        photo = request.FILES.get('photo')
        photo_2 = request.FILES.get('photo_2')
        photo_3 = request.FILES.get('photo_3')
        photo_4 = request.FILES.get('photo_4')

        if not schedule_id or stop_order is None:
            return Response({'error': 'schedule_id and stop_order are required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            stop_order = int(stop_order)
        except (TypeError, ValueError):
            return Response({'error': 'stop_order must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)

        if outcome not in ('success', 'failed'):
            return Response({'error': 'outcome must be success or failed.'}, status=status.HTTP_400_BAD_REQUEST)
        if outcome == 'failed' and not dispute_reason:
            return Response({'error': 'A reason is required when collection is marked as missed.'}, status=status.HTTP_400_BAD_REQUEST)

        validation = self._get_validation(schedule_id, stop_order)
        if not validation:
            return Response({'error': 'Stop validation not found for today.'}, status=status.HTTP_404_NOT_FOUND)
            
        if validation.current_status in (StopValidationStatus.VERIFIED_COLLECTED, StopValidationStatus.COLLECTION_DISPUTED):
            return Response(
                StopValidationSerializer(validation, context={'request': request}).data,
                status=status.HTTP_200_OK
            )
            
        if validation.current_status not in (
            StopValidationStatus.COLLECTION_REPORTED, 
            StopValidationStatus.READY_FOR_COLLECTION, 
            StopValidationStatus.PENDING_INSPECTION,
        ):
            return Response({'error': 'Stop cannot be verified.'}, status=status.HTTP_400_BAD_REQUEST)

        coords = get_stop_coordinates(validation.schedule, stop_order)
        if not coords:
            return Response({'error': 'Stop coordinates not found.'}, status=status.HTTP_400_BAD_REQUEST)
        ok, err = validate_gps_proximity(lat, lng, coords[0], coords[1], VERIFICATION_RADIUS_M)
        if not ok:
            return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            validation.post_validation_watcher = request.user
            validation.post_validation_timestamp = timezone.now()
            validation.post_validation_latitude = lat
            validation.post_validation_longitude = lng
            validation.dispute_reason = dispute_reason if outcome == 'failed' else ''
            if photo: validation.post_validation_photo = photo
            if photo_2: validation.post_validation_photo_2 = photo_2
            if photo_3: validation.post_validation_photo_3 = photo_3
            if photo_4: validation.post_validation_photo_4 = photo_4
            validation.current_status = (
                StopValidationStatus.VERIFIED_COLLECTED
                if outcome == 'success'
                else StopValidationStatus.COLLECTION_DISPUTED
            )
            validation.save()

            self._update_driver_timeline(validation)

            # WATCHER_FLAG trigger: driver reported collection but watcher disputes it.
            # This implies a falsely reported stop → penalize & add to missed pool.
            if outcome == 'failed' and validation.schedule_id:
                try:
                    from driver.missed_stop_service import create_missed_stops
                    from driver.models import MissedStopReason
                    create_missed_stops(
                        validation.schedule,
                        [stop_order],
                        reason=MissedStopReason.WATCHER_FLAG,
                    )
                except Exception:
                    pass  # Non-fatal — don't let a service error block the verification response

        return Response(
            StopValidationSerializer(validation, context={'request': request}).data,
            status=status.HTTP_200_OK,
        )


class EscalationViewSet(viewsets.ModelViewSet):
    queryset = Escalation.objects.all()
    serializer_class = EscalationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        class IsAdminOrBrgyOfficialOrDriver(permissions.BasePermission):
            def has_permission(self, request, view):
                if not request.user or not request.user.is_authenticated:
                    return False
                if request.user.role in ['admin', 'brgy_official']:
                    return True
                if request.user.role == 'driver':
                    if request.method in permissions.SAFE_METHODS or view.action == 'acknowledge':
                        return True
                return False
        return [IsAdminOrBrgyOfficialOrDriver()]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        
        # Simple query param filtering
        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)
            
        driver_ack_param = self.request.query_params.get('driver_acknowledged')
        if driver_ack_param is not None:
            is_ack = driver_ack_param.lower() in ['true', '1', 't', 'y', 'yes']
            qs = qs.filter(driver_acknowledged=is_ack)
            
        if getattr(user, 'role', None) == 'admin':
            return qs
        if getattr(user, 'role', None) == 'brgy_official' and getattr(user, 'barangay', None):
            return qs.filter(barangay=user.barangay)
        if getattr(user, 'role', None) == 'driver':
            return qs.filter(driver=user)
        return qs.none()

    @action(detail=True, methods=['patch'])
    def acknowledge(self, request, pk=None):
        escalation = self.get_object()
        
        # Security: only the penalized driver can acknowledge their own write-up
        if escalation.driver != request.user:
            return Response({"error": "You can only acknowledge your own escalations."}, status=status.HTTP_403_FORBIDDEN)
            
        if escalation.status != 'approved':
            return Response({"error": "Only approved escalations require acknowledgment."}, status=status.HTTP_400_BAD_REQUEST)
            
        escalation.driver_acknowledged = True
        escalation.save(update_fields=['driver_acknowledged'])
        
        return Response({"message": "Escalation acknowledged."})

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        escalation = self.get_object()
        escalation.status = 'resolved'
        escalation.save()
        return Response(self.get_serializer(escalation).data)

class HotspotInterventionViewSet(mixins.RetrieveModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    from .models import HotspotIntervention
    queryset = HotspotIntervention.objects.select_related('hotspot', 'truck', 'created_by', 'acknowledged_by', 'resolved_by').all()
    from .serializers import HotspotInterventionSerializer
    serializer_class = HotspotInterventionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        from .models import InterventionType

        if user.role == 'admin':
            pass
        elif user.role == 'brgy_official' and user.barangay_id:
            qs = qs.filter(intervention_type=InterventionType.FLAG, hotspot__barangay_id=user.barangay_id)
        elif user.role == 'driver':
            from driver.models import DriverShift
            shift = DriverShift.objects.filter(driver=user, is_active=True).select_related('truck').first()
            if shift and shift.truck:
                qs = qs.filter(intervention_type=InterventionType.DISPATCH, truck=shift.truck)
            else:
                qs = qs.none()
        else:
            qs = qs.none()

        type_param = self.request.query_params.get('type')
        if type_param:
            qs = qs.filter(intervention_type=type_param)
        status_param = self.request.query_params.get('status')
        if status_param:
            statuses = status_param.split(',')
            qs = qs.filter(status__in=statuses)
        return qs

    @action(detail=False, methods=['get'], url_path='mine')
    def mine(self, request):
        if request.user.role != 'brgy_official':
            return Response([])
        return Response(self.get_serializer(self.get_queryset(), many=True).data)

    @action(detail=False, methods=['get'], url_path='driver')
    def driver(self, request):
        if request.user.role != 'driver':
            return Response([])
        from .models import InterventionStatus
        qs = self.get_queryset().filter(
            status__in=[InterventionStatus.CREATED, InterventionStatus.ACKNOWLEDGED]
        )
        return Response(self.get_serializer(qs, many=True).data)

    def _clear_dispatch_fields(self, hotspot):
        from .models import GarbageHotspot
        cluster_ids = get_cluster_ids(hotspot.latitude, hotspot.longitude, radius_m=15)
        GarbageHotspot.objects.filter(id__in=cluster_ids).update(
            assigned_truck=None, dispatch_acknowledged=True, dispatched_at=None
        )

    @action(detail=True, methods=['post'], url_path='acknowledge')
    def acknowledge(self, request, pk=None):
        from .models import InterventionType, InterventionStatus
        from django.utils import timezone
        intervention = self.get_object()
        
        if request.user.role != 'admin':
            if intervention.intervention_type == InterventionType.DISPATCH:
                from driver.models import DriverShift
                shift = DriverShift.objects.filter(driver=request.user, is_active=True, truck=intervention.truck).first()
                if not shift:
                    return Response({'error': 'Not your dispatch.'}, status=403)
            elif intervention.intervention_type == InterventionType.FLAG:
                if request.user.role != 'brgy_official' or intervention.hotspot.barangay_id != request.user.barangay_id:
                    return Response({'error': 'Not your barangay.'}, status=403)

        intervention.status = InterventionStatus.ACKNOWLEDGED
        intervention.acknowledged_by = request.user
        intervention.acknowledged_at = timezone.now()
        intervention.save()
        return Response({'status': 'ok'})

    @action(detail=True, methods=['post'], url_path='resolve')
    def resolve(self, request, pk=None):
        from .models import InterventionType, InterventionStatus
        from django.utils import timezone
        intervention = self.get_object()
        
        if request.user.role != 'admin':
            if intervention.intervention_type == InterventionType.DISPATCH:
                from driver.models import DriverShift
                shift = DriverShift.objects.filter(driver=request.user, is_active=True, truck=intervention.truck).first()
                if not shift:
                    return Response({'error': 'Not your dispatch.'}, status=403)
            elif intervention.intervention_type == InterventionType.FLAG:
                if request.user.role != 'brgy_official' or intervention.hotspot.barangay_id != request.user.barangay_id:
                    return Response({'error': 'Not your barangay.'}, status=403)

        intervention.status = InterventionStatus.RESOLVED if intervention.intervention_type == InterventionType.FLAG else InterventionStatus.COLLECTED
        intervention.resolved_by = request.user
        intervention.resolved_at = timezone.now()
        intervention.resolution_notes = request.data.get('notes', '')
        intervention.save()
        
        if intervention.intervention_type == InterventionType.DISPATCH:
            self._clear_dispatch_fields(intervention.hotspot)
            
        return Response({'status': 'ok'})

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        from .models import InterventionType, InterventionStatus
        if request.user.role != 'admin':
            return Response({'error': 'Only admins can cancel'}, status=403)
        intervention = self.get_object()
        intervention.status = InterventionStatus.CANCELLED
        intervention.save()
        
        if intervention.intervention_type == InterventionType.DISPATCH:
            self._clear_dispatch_fields(intervention.hotspot)
            
        return Response({'status': 'ok'})

