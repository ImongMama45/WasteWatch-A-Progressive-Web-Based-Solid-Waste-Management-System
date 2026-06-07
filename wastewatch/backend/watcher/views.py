from django.utils import timezone
from rest_framework import viewsets, permissions, status
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
        qs = GarbageReport.objects.all()
        
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
            return qs.none() # Or all if they have no barangay? User requirement says "Receive ONLY reports within their barangay"
            
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
        """PENDING -> APPROVED. Saves audit trail."""
        if request.user.role not in ['admin', 'brgy_official']:
            return Response({'error': 'Not authorized'}, status=403)
        
        report = self.get_object()
        
        # Security: Barangay official can only approve reports in their barangay
        if request.user.role == 'brgy_official' and report.barangay != request.user.barangay:
            return Response({'error': 'Cannot approve reports outside your barangay'}, status=status.HTTP_403_FORBIDDEN)

        report.status = ReportStatus.APPROVED
        report.approved_by = request.user
        report.approved_at = timezone.now()
        report.save()
        return Response(GarbageReportSerializer(report).data)

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
        report.save()
        return Response(GarbageReportSerializer(report).data)

    @action(detail=False, methods=['get'])
    def public(self, request):
        """Returns ONLY approved reports for the public map."""
        approved_reports = GarbageReport.objects.filter(status=ReportStatus.APPROVED)
        serializer = self.get_serializer(approved_reports, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def map_pins(self, request):
        """
        Public-facing map pins endpoint.
        Returns ONLY APPROVED reports for everyone.
        (Special roles like admin/watcher can use the main list endpoint to see PENDING)
        """
        qs = GarbageReport.objects.filter(status=ReportStatus.APPROVED).exclude(
            latitude__isnull=True
        ).exclude(
            longitude__isnull=True
        )

        data = []
        for r in qs.select_related('barangay')[:300]:
            try:
                data.append({
                    'id':            r.id,
                    'lat':           float(r.latitude),
                    'lng':           float(r.longitude),
                    'issue_type':    r.issue_type,
                    'severity':      r.severity,
                    'status':        r.status,
                    'barangay_name': r.barangay.name if r.barangay else 'Unknown',
                    'address':       r.address,
                    'reported':      r.created_at.isoformat(),
                    'description':   r.description,
                    'image':         r.image.url if r.image else None,
                })
            except (TypeError, ValueError, AttributeError):
                continue

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
