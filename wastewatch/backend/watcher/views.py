from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import GarbageReport, CollectionConfirmation, GarbageHotspot, Escalation, ReportStatus
from .serializers import (
    GarbageReportSerializer,
    CollectionConfirmationSerializer,
    GarbageHotspotSerializer,
    EscalationSerializer,
)

# Roles that may see all reports across the city on the map
_MAP_FULL_ACCESS_ROLES = {'admin', 'watcher', 'brgy_official', 'driver'}

class GarbageReportViewSet(viewsets.ModelViewSet):
    queryset = GarbageReport.objects.all()
    serializer_class = GarbageReportSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        user = self.request.user
        
        # Public-facing queries (like for maps) usually filter for 'approved'
        # Check if a 'status' query param is passed, or if we should default to filtering
        status_filter = self.request.query_params.get('status')
        
        # 1. Anonymous users see only approved reports
        if not user.is_authenticated:
            qs = GarbageReport.objects.filter(status=ReportStatus.APPROVED)
        
        # 2. Admins see everything
        elif user.role == 'admin':
            qs = GarbageReport.objects.all()
            
        # 3. Barangay Officials see reports in their barangay
        elif user.role == 'brgy_official':
            qs = GarbageReport.objects.filter(barangay=user.barangay)
            
        # 4. Citizens see their own reports PLUS all approved reports from others
        else:
            from django.db.models import Q
            qs = GarbageReport.objects.filter(
                Q(user=user) | Q(status=ReportStatus.APPROVED)
            )

        if status_filter:
            qs = qs.filter(status=status_filter)
            
        return qs

    def perform_create(self, serializer):
        # Automatically set to PENDING on creation
        # user=None if guest
        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(user=user, status=ReportStatus.PENDING)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def approve(self, request, pk=None):
        if request.user.role not in ['admin', 'brgy_official']:
            return Response({'error': 'Not authorized'}, status=403)
        
        report = self.get_object()
        report.status = ReportStatus.APPROVED
        report.save()
        return Response({'status': 'approved'})

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def reject(self, request, pk=None):
        if request.user.role not in ['admin', 'brgy_official']:
            return Response({'error': 'Not authorized'}, status=403)
        
        report = self.get_object()
        report.status = ReportStatus.REJECTED
        report.save()
        return Response({'status': 'rejected'})

    @action(detail=False, methods=['get'])
    def public_map(self, request):
        """Returns only approved reports for the public map."""
        approved_reports = GarbageReport.objects.filter(status=ReportStatus.APPROVED)
        serializer = self.get_serializer(approved_reports, many=True)
        return Response(serializer.data)

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

    @action(detail=False, methods=['get'], url_path='map_pins')
    def map_pins(self, request):
        """
        Returns geolocated garbage reports for the live map.
        - Admin / Watcher / Brgy Official / Driver: all pending + approved reports city-wide.
        - Citizen: only reports from their own barangay.
        Excludes reports with missing coordinates.
        """
        user = request.user
        base_qs = GarbageReport.objects.exclude(
            latitude=None
        ).exclude(
            longitude=None
        ).filter(status__in=[ReportStatus.PENDING, ReportStatus.APPROVED])

        if user.role in _MAP_FULL_ACCESS_ROLES:
            qs = base_qs
        elif user.barangay_id:
            qs = base_qs.filter(barangay=user.barangay)
        else:
            qs = base_qs.none()

        data = [
            {
                'id':        r.id,
                'lat':       float(r.latitude),
                'lng':       float(r.longitude),
                'type':      r.issue_type,
                'severity':  r.severity,
                'status':    r.status,
                'address':   r.barangay.name if r.barangay else 'Unknown',
                'reported':  r.created_at,
                'description': r.description,
            }
            for r in qs.select_related('barangay')[:200]  # hard cap for map performance
        ]
        return Response(data)

class CollectionConfirmationViewSet(viewsets.ModelViewSet):
    queryset = CollectionConfirmation.objects.all()
    serializer_class = CollectionConfirmationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        confirmation = serializer.save(confirmed_by=self.request.user)
        if confirmation.report:
            confirmation.report.status = ReportStatus.RESOLVED
            confirmation.report.save()

class GarbageHotspotViewSet(viewsets.ModelViewSet):
    queryset = GarbageHotspot.objects.all()
    serializer_class = GarbageHotspotSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='nearby')
    def nearby(self, request):
        """
        Returns hotspots within 5 km of the driver, sorted by distance.
        Query params: ?lat=<float>&lng=<float>
        Falls back to all hotspots if no coords provided (capped at 50).
        """
        import math

        def haversine_km(lat1, lon1, lat2, lon2):
            R = 6371
            phi1, phi2 = math.radians(lat1), math.radians(lat2)
            dphi = math.radians(lat2 - lat1)
            dlam = math.radians(lon2 - lon1)
            a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
            return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

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
            ).select_related('barangay')
        else:
            qs = GarbageHotspot.objects.select_related('barangay').all()[:50]

        data = []
        for h in qs:
            dist_km = haversine_km(drv_lat, drv_lng, float(h.latitude), float(h.longitude)) if has_coords else 0
            data.append({
                'id':          h.id,
                'severity':    h.severity,
                'barangay':    h.barangay.name if h.barangay else 'Unknown',
                'address':     h.name,
                'description': '',
                'distanceKm':  round(dist_km, 2),
                'reportedAt':  h.created_at.strftime('%-I:%M %p') if h.created_at else '',
                'type':        'overflow',
                'latitude':    float(h.latitude),
                'longitude':   float(h.longitude),
            })
        data.sort(key=lambda x: x['distanceKm'])
        return Response(data)

    @action(detail=True, methods=['post'], url_path='noted')
    def noted(self, request, pk=None):
        """Mark that the driver has noted this hotspot. No model changes needed — returns 200."""
        return Response({'status': 'noted', 'id': pk})

    @action(detail=True, methods=['post'], url_path='add-to-route')
    def add_to_route(self, request, pk=None):
        """Placeholder: driver requests to add this hotspot to their current route."""
        return Response({'status': 'added', 'id': pk})

from rest_framework.decorators import action
from rest_framework.response import Response

class EscalationViewSet(viewsets.ModelViewSet):
    queryset = Escalation.objects.all()
    serializer_class = EscalationSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        escalation = self.get_object()
        escalation.status = 'resolved'
        escalation.save()
        return Response(self.get_serializer(escalation).data)
