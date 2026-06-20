from django.utils import timezone
from rest_framework import viewsets, permissions, status, filters
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
    permission_classes = [permissions.AllowAny]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['barangay', 'status', 'issue_type', 'severity']
    search_fields = ['address', 'description']
    ordering_fields = ['created_at', 'severity']

    def get_queryset(self):
        user = self.request.user
        qs = GarbageReport.objects.all()

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

        # Auto-promote to GarbageHotspot so it appears on the map (idempotent on double-click).
        if report.latitude and report.longitude and report.barangay:
            GarbageHotspot.objects.get_or_create(
                name=f'Report #{report.id} — {report.get_issue_type_display()}',
                defaults={
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

        GarbageHotspot.objects.filter(
            name=f'Report #{report.id} — {report.get_issue_type_display()}'
        ).delete()

        return Response(GarbageReportSerializer(report, context={'request': request}).data)

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
        hotspots = GarbageHotspot.objects.select_related('barangay').all()

        data = []
        for h in hotspots:
            # Try to find the originating report by the sentinel name pattern
            report = None
            if h.name.startswith('Report #'):
                try:
                    report_id = int(h.name.split('Report #')[1].split(' —')[0])
                    report = GarbageReport.objects.filter(id=report_id).select_related('barangay').first()
                except (ValueError, IndexError):
                    pass

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
                'image':         report.image.url if report and report.image else None,
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
            GarbageHotspot.objects.filter(
                name=f'Report #{confirmation.report.id} — {confirmation.report.get_issue_type_display()}'
            ).delete()

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

    def get_queryset(self):
        ensure_today_stop_validations()
        today = timezone.localdate()
        qs = super().get_queryset().filter(collection_date=today)

        user = self.request.user
        if user.role == 'watcher' and user.barangay:
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

        return Response(
            StopValidationSerializer(validation, context={'request': request}).data,
            status=status.HTTP_200_OK,
        )


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
