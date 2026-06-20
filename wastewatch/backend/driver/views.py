from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from datetime import timezone
from django.utils.dateparse import parse_datetime
from .models import (
    Truck,
    CollectionSchedule,
    RouteAssignment,
    PickupStatus,
    TruckLocation,
    CompletionReport,
    TruckCrewAssignment,
    CalendarEvent,
    DriverShift,
)
from .serializers import (
    TruckSerializer,
    CollectionScheduleSerializer,
    RouteAssignmentSerializer,
    PickupStatusSerializer,
    TruckLocationSerializer,
    CompletionReportSerializer,
    TruckCrewAssignmentSerializer,
    CalendarEventSerializer,
    DriverShiftSerializer,
)

from django.db import transaction
from django.utils import timezone
import math

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000  # radius of Earth in meters
    phi_1 = math.radians(lat1)
    phi_2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi_1) * math.cos(phi_2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

class TruckViewSet(viewsets.ModelViewSet):
    queryset = Truck.objects.all()
    serializer_class = TruckSerializer
    permission_classes = [permissions.IsAuthenticated]



class CollectionScheduleViewSet(viewsets.ModelViewSet):
    queryset = CollectionSchedule.objects.all().order_by('-id')
    serializer_class = CollectionScheduleSerializer
    permission_classes = [permissions.IsAuthenticated]

class RouteAssignmentViewSet(viewsets.ModelViewSet):
    queryset = RouteAssignment.objects.all()
    serializer_class = RouteAssignmentSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='today')
    def today(self, request):
        assignment = RouteAssignment.objects.filter(driver=request.user).first()
        if not assignment:
            return Response({'error': 'No route assigned for today'}, status=status.HTTP_404_NOT_FOUND)
        
        schedule = assignment.schedule
        truck = schedule.truck
        
        return Response({
            'id': assignment.id,
            'name': assignment.route_name,
            'barangay': schedule.barangay.name if schedule.barangay else 'City-Wide',
            'totalStops': 10, # Mocked for now
            'completedStops': 0,
            'distanceKm': 15, # Mocked for now
            'startTime': schedule.start_time.strftime('%I:%M %p'),
            'estEnd': schedule.end_time.strftime('%I:%M %p'),
            'truck': f"TRUCK {truck.plate_number}" if truck else "NO TRUCK",
        })

class PickupStatusViewSet(viewsets.ModelViewSet):
    queryset = PickupStatus.objects.all()
    serializer_class = PickupStatusSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = (
            super()
            .get_queryset()
            .select_related('driver', 'schedule', 'schedule__truck')
        )

        user = self.request.user
        params = self.request.query_params

        schedule_id = params.get('schedule_id')
        if schedule_id:
            qs = qs.filter(schedule_id=schedule_id)

        driver_id = params.get('driver_id')
        if driver_id:
            qs = qs.filter(driver_id=driver_id)
        elif getattr(user, 'role', None) == 'driver':
            qs = qs.filter(driver=user)

        updated_after = params.get('updated_after')
        if updated_after:
            parsed = parse_datetime(updated_after)
            if parsed:
                qs = qs.filter(updated_at__gt=parsed)

        return qs.order_by('schedule_id', 'stop_order', '-updated_at')

    @action(detail=False, methods=['get'], url_path='current')
    def current(self, request):
        """
        Returns the driver's next uncompleted stop.

        Resolution order:
        1. Today's TruckCrewAssignment → schedule
        2. Today's CollectionSchedule for this driver
        3. Any CollectionSchedule for this driver (date may be null for recurring)
        4. Any uncompleted PickupStatus for this driver across all schedules

        Auto-repair: if a schedule exists with waypoints but no PickupStatus rows,
        sync_pickup_statuses() is called to create them before querying.

        Maps to GET /api/driver/stops/current/
        """
        today = timezone.localdate()

        # ── 1. Resolve schedule ──────────────────────────────────────────────
        schedule = None

        assignment = (
            TruckCrewAssignment.objects
            .filter(driver=request.user, date=today, is_active=True)
            .select_related('schedule')
            .first()
        )
        if assignment and assignment.schedule_id:
            schedule = assignment.schedule

        if not schedule:
            schedule = (
                CollectionSchedule.objects
                .filter(driver=request.user, date=today)
                .first()
            )

        if not schedule:
            # Covers recurring schedules where date is left null
            schedule = (
                CollectionSchedule.objects
                .filter(driver=request.user)
                .order_by('-id')
                .first()
            )

        # ── 2. Auto-repair missing PickupStatus rows ──────────────────────────
        # If a schedule has waypoints but no stops were ever synced, create them now.
        if schedule:
            has_stops = PickupStatus.objects.filter(
                driver=request.user, schedule=schedule
            ).exists()
            if not has_stops and schedule.waypoints and len(schedule.waypoints) > 1:
                try:
                    schedule.sync_pickup_statuses()
                except Exception:
                    pass  # non-fatal — fall through to last-resort query

        # ── 3. Query next READY_FOR_COLLECTION stop (watcher-validated) ───────
        from watcher.models import StopValidation, StopValidationStatus
        from watcher.stop_validation_service import ensure_stop_validations_for_schedule

        stop = None
        if schedule:
            ensure_stop_validations_for_schedule(schedule)
            ready_orders = set(
                StopValidation.objects.filter(
                    schedule=schedule,
                    collection_date=today,
                    current_status=StopValidationStatus.READY_FOR_COLLECTION,
                ).values_list('stop_order', flat=True)
            )
            reported_orders = set(
                StopValidation.objects.filter(
                    schedule=schedule,
                    collection_date=today,
                    current_status__in=[
                        StopValidationStatus.COLLECTION_REPORTED,
                        StopValidationStatus.VERIFIED_COLLECTED,
                        StopValidationStatus.COLLECTION_DISPUTED,
                    ],
                ).values_list('stop_order', flat=True)
            )
            eligible_orders = sorted(ready_orders - reported_orders)
            if eligible_orders:
                next_order = eligible_orders[0]
                stop = (
                    PickupStatus.objects
                    .filter(driver=request.user, schedule=schedule, stop_order=next_order)
                    .select_related('schedule')
                    .first()
                )
                if not stop:
                    waypoints = schedule.waypoints or []
                    address = ''
                    if next_order < len(waypoints) and isinstance(waypoints[next_order], dict):
                        address = waypoints[next_order].get('label') or waypoints[next_order].get('address') or ''
                    stop = PickupStatus.objects.create(
                        driver=request.user,
                        schedule=schedule,
                        stop_order=next_order,
                        status='EN_ROUTE',
                        address=address,
                    )

        # ── 4. Last resort: any uncompleted stop for this driver ──────────────
        if not stop:
            stop = (
                PickupStatus.objects
                .filter(driver=request.user)
                .exclude(status='COMPLETED')
                .select_related('schedule')
                .order_by('stop_order')
                .first()
            )

        if not stop:
            return Response(None)  # null → frontend shows "no more stops"

        sched = stop.schedule
        return Response({
            'id':            stop.id,
            'order':         stop.stop_order,
            'address':       stop.address or (sched.area if sched else 'Unknown'),
            'barangay':      (
                ', '.join(b.name for b in sched.barangays.all()[:1])
                if sched else 'Unknown'
            ),
            'zone':          sched.area if sched else '',
            'category':      'Mixed Waste',
            'scheduledTime': sched.start_time.strftime('%I:%M %p') if sched else 'N/A',
            'distance':      '—',
            'notes':         stop.note,
        })  
    
    @action(detail=False, methods=['get'], url_path='history/today')
    def history_today(self, request):
        """
        Returns all stops the driver completed today.
        Maps to GET /api/driver/stops/history/today/
        """
        from django.utils import timezone
        today = timezone.localdate()
        stops = PickupStatus.objects.filter(
            driver=request.user,
            status='COMPLETED',
            collected_at__date=today,
        ).select_related('schedule').order_by('stop_order')

        data = []
        for s in stops:
            schedule = s.schedule
            data.append({
                'id':          s.id,
                'order':       s.stop_order,
                'address':     s.address or (schedule.area if schedule else 'Unknown'),
                'barangay':    ', '.join(b.name for b in schedule.barangays.all()[:1]) if schedule else 'Unknown',
                'category':    'Mixed Waste',
                'collectedAt': s.collected_at.strftime('%I:%M %p') if s.collected_at else '',
                'note':        s.note,
            })
        return Response(data)

    @action(detail=False, methods=['get'], url_path='reassigned')
    def reassigned_stops(self, request):
        """Returns only stops explicitly flagged DRIVER_MISSED that were
        reassigned to this driver (extended mode only).
        Non-extended drivers always get an empty list."""
        from driver.models import DriverShift, CollectionSchedule, PickupStatus

        shift = DriverShift.objects.filter(driver=request.user, is_active=True).first()
        if not shift or not shift.is_extended_mode:
            return Response({'stops': []})

        schedule = CollectionSchedule.objects.filter(driver=request.user).first()
        if not schedule:
            return Response({'stops': []})

        # Only rows explicitly marked DRIVER_MISSED on this driver's schedule
        missed_records = PickupStatus.objects.filter(
            schedule=schedule,
            status='DRIVER_MISSED',
        ).order_by('stop_order')

        # Build waypoint lookup by stop_order for geometry data
        wp_by_order = {}
        for i, wp in enumerate(schedule.waypoints or []):
            order = wp.get('stopOrder') or wp.get('stop_order') or i
            wp_by_order[int(order)] = wp

        stops = []
        for record in missed_records:
            wp = wp_by_order.get(record.stop_order)
            if wp:
                stops.append({
                    **wp,
                    'pickup_status_id': record.id,
                    'stop_order': record.stop_order,
                    'status': 'DRIVER_MISSED',
                })

        return Response({'stops': stops})

    @action(detail=False, methods=['post'], url_path='collect')
    def collect(self, request):
        """
        Upload a collection proof photo by schedule + stop order.
        Does NOT require a pre-existing PickupStatus pk.
        Creates the PickupStatus row if it doesn't exist yet.

        POST /api/driver/stops/collect/
        Form fields: schedule_id, stop_order, photo, note, lat, lng, collected_at
        """
        schedule_id  = request.data.get('schedule_id')
        stop_order   = request.data.get('stop_order')
        photo        = request.FILES.get('photo')
        note         = request.data.get('note', '').strip()
        collected_at_raw = request.data.get('collected_at')

        if not schedule_id:
            return Response({'error': 'schedule_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if stop_order is None:
            return Response({'error': 'stop_order is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            stop_order = int(stop_order)
        except (ValueError, TypeError):
            return Response({'error': 'stop_order must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            schedule = CollectionSchedule.objects.get(pk=schedule_id, driver=request.user)
        except CollectionSchedule.DoesNotExist:
            return Response({'error': 'Schedule not found or not assigned to you.'}, status=status.HTTP_404_NOT_FOUND)

        from watcher.models import StopValidation, StopValidationStatus
        from watcher.stop_validation_utils import COLLECTION_RADIUS_M, get_stop_coordinates, validate_gps_proximity
        from watcher.stop_validation_service import ensure_stop_validations_for_schedule

        ensure_stop_validations_for_schedule(schedule)
        today = timezone.localdate()
        try:
            validation = StopValidation.objects.get(
                schedule=schedule,
                stop_order=stop_order,
                collection_date=today,
            )
        except StopValidation.DoesNotExist:
            return Response({'error': 'Stop validation not found for today.'}, status=status.HTTP_404_NOT_FOUND)

        from django.conf import settings as django_settings

        if validation.current_status != StopValidationStatus.READY_FOR_COLLECTION:
            if not django_settings.DEBUG:
                return Response(
                    {'error': 'Stop is not ready for collection. Watcher pre-inspection required.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        driver_lat = request.data.get('lat')
        driver_lng = request.data.get('lng')
        coords = get_stop_coordinates(schedule, stop_order)
        if coords and not django_settings.DEBUG:
            ok, err = validate_gps_proximity(driver_lat, driver_lng, coords[0], coords[1], COLLECTION_RADIUS_M)
            if not ok:
                return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)

        collected_at = timezone.now()
        if collected_at_raw:
            try:
                parsed = parse_datetime(collected_at_raw)
                if parsed:
                    collected_at = parsed
            except Exception:
                pass

        # Get or create — safe even if sync_pickup_statuses() never ran
        ps, created = PickupStatus.objects.get_or_create(
            driver=request.user,
            schedule=schedule,
            stop_order=stop_order,
            defaults={
                'status': 'COMPLETED',
                'address': (schedule.waypoints or [{}])[stop_order].get('label', '') if len(schedule.waypoints or []) > stop_order else '',
                'note': note,
                'collected_at': collected_at,
            },
        )

        if not created:
            ps.status = 'COMPLETED'
            ps.note = note
            ps.collected_at = collected_at

        if photo:
            ps.photo_url = photo  # Cloudinary field handles upload on save

        try:
            ps.save()

            validation.driver = request.user
            validation.collection_timestamp = collected_at
            validation.collection_notes = note
            if driver_lat is not None:
                validation.collection_latitude = driver_lat
            if driver_lng is not None:
                validation.collection_longitude = driver_lng
            
            if photo:
                photo.seek(0)  # Reset file pointer before saving to second model
                validation.collection_photo = photo
                
            validation.current_status = StopValidationStatus.COLLECTION_REPORTED
            validation.save()
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'error': f'Failed to save collection record: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # ── Notify barangay: collection done ─────────────────────────────────
        try:
            from notifications.services import notify_collection_done
            notify_collection_done(schedule, stop_order, driver=request.user)
        except Exception:
            pass  # non-fatal — collection is already recorded

        photo_url = None
        if ps.photo_url:
            try:
                photo_url = ps.photo_url.url
            except Exception:
                pass

        return Response({
            'id':          ps.id,
            'stop_order':  ps.stop_order,
            'status':      ps.status,
            'validation_status': validation.current_status,
            'photo_url':   photo_url,
            'collected_at': ps.collected_at,
        }, status=status.HTTP_201_CREATED)

class TruckLocationViewSet(viewsets.ModelViewSet):
    queryset = TruckLocation.objects.all().order_by('-timestamp')
    serializer_class = TruckLocationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        driver = request.user

        # 1. Enforce Active Shift
        active_shift = DriverShift.objects.filter(driver=driver, is_active=True).first()
        if not active_shift:
            return Response({'error': 'GPS tracking requires an active shift.'}, status=403)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        lat = serializer.validated_data['latitude']
        lng = serializer.validated_data['longitude']
        accuracy = serializer.validated_data.get('accuracy')  # metres, can be None

        ACCURACY_THRESHOLD = 50  # metres — ignore live update if worse than this

        # 2. Update Live Tracking only when GPS accuracy is good enough
        #    This prevents the dashboard marker from jumping due to a bad fix.
        MIN_MOVEMENT_M = 10
        last = (
            TruckLocation.objects
            .filter(shift=active_shift)
            .order_by('-timestamp')
            .values('latitude', 'longitude')
            .first()
        )
        if last:
            dist = haversine(
                float(last['latitude']), float(last['longitude']),
                float(lat), float(lng)
            )
            if dist < MIN_MOVEMENT_M:
                # Update live position on the shift but don't write a new row
                if accuracy is None or accuracy <= ACCURACY_THRESHOLD:
                    active_shift.current_latitude = lat
                    active_shift.current_longitude = lng
                    active_shift.last_location_update = timezone.now()
                    active_shift.save(update_fields=[
                        'current_latitude', 'current_longitude', 'last_location_update'
                    ])
                return Response({'skipped': True, 'reason': 'no_movement'}, status=200)

        # Original logic follows — update live position and store the ping
        if accuracy is None or accuracy <= ACCURACY_THRESHOLD:
            active_shift.current_latitude = lat
            active_shift.current_longitude = lng
            active_shift.last_location_update = timezone.now()
            active_shift.save(update_fields=[
                'current_latitude', 'current_longitude', 'last_location_update'
            ])

        # ── TRUCK_NEAR check ──────────────────────────────────────────────────
        # Runs on every qualifying ping. The service handles distance + dedup
        # internally — this call is always safe and non-blocking.
        try:
            from notifications.services import notify_truck_near

            # Resolve today's schedule for this driver
            _schedule = (
                CollectionSchedule.objects
                .filter(driver=driver, date=timezone.localdate())
                .prefetch_related('barangays')
                .first()
            ) or (
                CollectionSchedule.objects
                .filter(driver=driver)
                .prefetch_related('barangays')
                .order_by('-id')
                .first()
            )

            if _schedule and _schedule.waypoints:
                # Find the next uncompleted stop to check proximity against
                from watcher.models import StopValidation, StopValidationStatus
                today_date = timezone.localdate()
                next_stop  = (
                    StopValidation.objects
                    .filter(
                        schedule=_schedule,
                        collection_date=today_date,
                        current_status=StopValidationStatus.READY_FOR_COLLECTION,
                    )
                    .order_by('stop_order')
                    .first()
                )
                if next_stop:
                    wp = _schedule.waypoints[next_stop.stop_order] if next_stop.stop_order < len(_schedule.waypoints) else None
                    if wp and 'lat' in wp and 'lng' in wp:
                        notify_truck_near(
                            shift=active_shift,
                            schedule=_schedule,
                            stop_order=next_stop.stop_order,
                            stop_lat=float(wp['lat']),
                            stop_lng=float(wp['lng']),
                            driver_lat=float(lat),
                            driver_lng=float(lng),
                        )
        except Exception:
            pass  # TRUCK_NEAR is best-effort — never block GPS recording

        location = TruckLocation.objects.create(
            driver=driver,
            truck=active_shift.truck,
            shift=active_shift,
            latitude=lat,
            longitude=lng,
            accuracy=accuracy,
        )

        return Response(TruckLocationSerializer(location).data, status=status.HTTP_201_CREATED)

class CompletionReportViewSet(viewsets.ModelViewSet):
    queryset = CompletionReport.objects.all()
    serializer_class = CompletionReportSerializer
    permission_classes = [permissions.IsAuthenticated]
 


class TruckCrewAssignmentViewSet(viewsets.ModelViewSet):
    queryset = TruckCrewAssignment.objects.select_related(
        'truck', 'driver', 'schedule'
    ).prefetch_related('crew_members', 'schedule__barangays').all()
    serializer_class = TruckCrewAssignmentSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='my-assignment')
    def my_assignment(self, request):
        """Returns today's active crew assignment for the requesting crew member."""
        from django.utils import timezone
        today = timezone.localdate()
        assignment = TruckCrewAssignment.objects.filter(
            crew_members=request.user,
            date=today,
            is_active=True,
        ).select_related(
            'truck', 'driver', 'schedule'
        ).prefetch_related('crew_members', 'schedule__barangays').first()

        if not assignment:
            # Try most recent active assignment as fallback
            assignment = TruckCrewAssignment.objects.filter(
                crew_members=request.user,
                is_active=True,
            ).select_related(
                'truck', 'driver', 'schedule'
            ).prefetch_related('crew_members', 'schedule__barangays').first()

        if not assignment:
            return Response({'detail': 'No active assignment found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = TruckCrewAssignmentSerializer(assignment, context={'request': request})
        return Response(serializer.data)



def _thin_shift_locations(shift_id):
    from django.db import connection

    # Get all location IDs for this shift ordered by timestamp,
    # then keep every 24th one (every ~2 minutes at 5s ping rate).
    # Delete the rest.
    location_ids = list(
        TruckLocation.objects
        .filter(shift_id=shift_id)
        .order_by('timestamp')
        .values_list('id', flat=True)
    )

    if len(location_ids) <= 24:
        return  # Short shift — keep everything

    # Keep every 24th record (indices 0, 24, 48, ...)
    keep_ids = set(location_ids[i] for i in range(0, len(location_ids), 24))
    delete_qs = TruckLocation.objects.filter(shift_id=shift_id).exclude(id__in=keep_ids)
    deleted_count = delete_qs.count()
    delete_qs.delete()

    import logging
    logging.getLogger(__name__).info(
        f'Shift {shift_id}: thinned {deleted_count} location records, '
        f'kept {len(keep_ids)} (~2-min intervals)'
    )

class DriverShiftViewSet(viewsets.ModelViewSet):
    queryset = DriverShift.objects.all()
    serializer_class = DriverShiftSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='current')
    def current(self, request):
        from datetime import timedelta
        now = timezone.now()
        staleness_cutoff = now - timedelta(hours=24)

        # Auto-close any shifts abandoned for more than 24 hours
        DriverShift.objects.filter(
            driver=request.user,
            ended_at__isnull=True,
            started_at__lt=staleness_cutoff,
        ).update(
            ended_at=now,
            status='end_shift',
            is_active=False
        )

        # Now look for a genuinely active shift
        shift = DriverShift.objects.filter(
            driver=request.user,
            ended_at__isnull=True,
            started_at__gte=staleness_cutoff,
            is_active=True
        ).order_by('-started_at').first()

        if not shift:
            return Response({'active_shift': None})

        return Response({
            'active_shift': DriverShiftSerializer(shift).data
        })

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        shift = self.get_object()

        VALID_TRANSITIONS = {
            'navigate_to_base': ['confirm_start', 'end_shift'],
            'confirm_start':    ['checkin', 'end_shift'],
            'checkin':          ['shiftroute', 'end_shift'],
            'shiftroute':       ['end_shift'],
            'end_shift':        ['end_shift', 'shiftroute'],  # allow re-entry for Extended Mode
            # DEV-only: allow jumping to any phase
            'assignment':       ['navigate_to_base', 'confirm_start', 'checkin', 'shiftroute', 'end_shift'],
        }

        # Map each phase → op_status so the live map always shows a meaningful label
        PHASE_OP_STATUS = {
            'assignment':       'off_duty',
            'navigate_to_base': 'heading_to_start',
            'confirm_start':    'at_base',
            'checkin':          'checking_in',
            'shiftroute':       'on_route',
            'end_shift':        'heading_to_dumpsite',
        }

        new_status = request.data.get('status')
        current = shift.status

        if new_status == current:
            return Response({'status': current, 'op_status': shift.op_status})

        # Allow any transition in DEV (detected by a flag in the request)
        is_dev_skip = request.data.get('dev_skip', False)
        if not is_dev_skip and new_status not in VALID_TRANSITIONS.get(current, []):
            return Response(
                {'error': f'Invalid transition: {current} → {new_status}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        new_op = PHASE_OP_STATUS.get(new_status, shift.op_status)
        shift.status = new_status
        shift.op_status = new_op
        shift.save(update_fields=['status', 'op_status'])
        return Response({'status': new_status, 'op_status': new_op})

    @action(detail=True, methods=['post'], url_path='extended_mode')
    def extended_mode(self, request, pk=None):
        shift = self.get_object()
        if not shift.is_active:
            return Response({'error': 'Cannot activate extended mode on an inactive shift.'}, status=status.HTTP_400_BAD_REQUEST)

        # Set status back to shiftroute so a page refresh returns to the map,
        # not EndShiftModule / dump_site. is_extended_mode distinguishes this from
        # a normal collection run so reassignment logic can target this driver.
        shift.is_extended_mode = True
        shift.status = 'shiftroute'
        shift.save(update_fields=['is_extended_mode', 'status'])

        # Process missed stops — same logic as end_shift
        missed_stop_orders = request.data.get('missed_stop_orders', [])
        schedule_id = request.data.get('schedule_id')
        if schedule_id and missed_stop_orders:
            from driver.models import PickupStatus
            PickupStatus.objects.filter(
                schedule_id=schedule_id,
                stop_order__in=missed_stop_orders,
            ).update(status='DRIVER_MISSED')

            from driver.reassignment import trigger_reassignment
            trigger_reassignment(schedule_id, missed_stop_orders)

        return Response({'status': 'extended_mode_activated'})

    @action(detail=False, methods=['post'], url_path='pre_start')
    def pre_start_shift(self, request):
        driver = request.user
        duty_type = request.data.get('duty_type', 'normal')
        
        today = timezone.localdate()
        assignment = TruckCrewAssignment.objects.filter(
            driver=driver, date=today, is_active=True
        ).select_related('schedule').first()
        schedule = assignment.schedule if assignment else None
        if not schedule:
            schedule = CollectionSchedule.objects.filter(driver=driver, date=today).first()
            if not schedule:
                schedule = CollectionSchedule.objects.filter(driver=driver).first()
        truck = assignment.truck if assignment else (schedule.truck if schedule else None)

        with transaction.atomic():
            shift = DriverShift.objects.select_for_update().filter(driver=driver, is_active=True).first()
            if shift:
                # Already active, we just return it
                return Response(DriverShiftSerializer(shift).data, status=status.HTTP_200_OK)

            if truck and truck.status == 'maintenance':
                return Response({'error': 'This truck is currently under maintenance and cannot be used.'}, status=status.HTTP_400_BAD_REQUEST)
            if truck and DriverShift.objects.select_for_update().filter(truck=truck, is_active=True).exists():
                return Response({'error': 'Truck is currently being used in another active shift.'}, status=status.HTTP_400_BAD_REQUEST)

            shift = DriverShift.objects.create(
                driver=driver,
                truck=truck,
                duty_type=duty_type,
                started_at=timezone.now(),  # Temporary start time
                is_active=True,
                op_status='heading_to_start',
                current_latitude=None,
                current_longitude=None,
                last_location_update=None
            )
        return Response(DriverShiftSerializer(shift).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='start')
    def start_shift(self, request):
        driver = request.user
        duty_type = request.data.get('duty_type', 'normal')
        driver_lat = request.data.get('latitude')
        driver_lng = request.data.get('longitude')
        
        # Get today's assigned truck for the driver.
        today = timezone.localdate()
        assignment = TruckCrewAssignment.objects.filter(
            driver=driver, date=today, is_active=True
        ).select_related('schedule').first()
        schedule = assignment.schedule if assignment else None
        if not schedule:
            schedule = CollectionSchedule.objects.filter(driver=driver, date=today).first()
            if not schedule:
                schedule = CollectionSchedule.objects.filter(driver=driver).first()
        truck = assignment.truck if assignment else (schedule.truck if schedule else None)

        # Vicinity check — skipped in DEBUG mode for developer bypass
        from django.conf import settings as django_settings
        if schedule and schedule.waypoints and not django_settings.DEBUG:
            waypoints = schedule.waypoints
            if waypoints and len(waypoints) > 0:
                home_base = waypoints[0]
                if driver_lat and driver_lng and 'lat' in home_base and 'lng' in home_base:
                    try:
                        dist = haversine(
                            float(driver_lat), float(driver_lng),
                            float(home_base['lat']), float(home_base['lng'])
                        )
                        if dist > 1000:   # hard 1 km radius (production only)
                            return Response({
                                'error': f'You are too far from the home base ({int(dist)}m away)...'
                            }, status=status.HTTP_403_FORBIDDEN)
                    except ValueError:
                        pass  # Invalid coordinates format


        

        with transaction.atomic():
            shift = DriverShift.objects.select_for_update().filter(driver=driver, is_active=True).first()
            if shift:
                # Update existing shift from pre_start
                shift.started_at = timezone.now()
                shift.current_latitude = driver_lat
                shift.current_longitude = driver_lng
                shift.last_location_update = timezone.now()
                shift.op_status = 'on_duty'
                shift.save()
                return Response(DriverShiftSerializer(shift).data, status=status.HTTP_200_OK)
            
            if truck and truck.status == 'maintenance':
                return Response({'error': 'This truck is currently under maintenance and cannot be used.'}, status=status.HTTP_400_BAD_REQUEST)
            if truck and DriverShift.objects.select_for_update().filter(truck=truck, is_active=True).exists():
                return Response({'error': 'Truck is currently being used in another active shift.'}, status=status.HTTP_400_BAD_REQUEST)

            shift = DriverShift.objects.create(
                driver=driver,
                truck=truck,
                duty_type=duty_type,
                started_at=timezone.now(),
                is_active=True,
                op_status='on_duty',
                current_latitude=driver_lat,
                current_longitude=driver_lng,
                last_location_update=timezone.now()
            )
        return Response(DriverShiftSerializer(shift).data, status=status.HTTP_201_CREATED)


    @action(detail=False, methods=['post'], url_path='end')
    def end_shift(self, request):
        driver = request.user
        missed_stop_orders = request.data.get('missed_stop_orders', [])
        schedule_id = request.data.get('schedule_id')

        with transaction.atomic():
            shift = DriverShift.objects.select_for_update().filter(driver=driver, is_active=True).first()
            if not shift:
                return Response({'error': 'No active shift found.'}, status=status.HTTP_400_BAD_REQUEST)
            
            now = timezone.now()
            shift.ended_at    = now
            shift.duration_ms = int((now - shift.started_at).total_seconds() * 1000)
            shift.is_active   = False
            shift.current_latitude    = None
            shift.current_longitude   = None
            shift.last_location_update = None
            shift.save()
            
            if schedule_id and missed_stop_orders:
                from driver.models import PickupStatus
                PickupStatus.objects.filter(
                    schedule_id=schedule_id,
                    stop_order__in=missed_stop_orders
                ).update(status='DRIVER_MISSED')
                
                from driver.reassignment import trigger_reassignment
                trigger_reassignment(schedule_id, missed_stop_orders)
        # ── Thin out this shift's location history outside the transaction ──
        # Keep one ping every 2 minutes (retain every 24th row at 5s intervals).
        # This preserves a usable trail for replay without storing 5,760 rows/shift.
        # Runs after the shift is committed so a failure here doesn't block ending.
        try:
            _thin_shift_locations(shift.id)
        except Exception as e:
            # Non-fatal — log and continue. The full data is already saved.
            import logging
            logging.getLogger(__name__).warning(f'Location thinning failed for shift {shift.id}: {e}')

        return Response(DriverShiftSerializer(shift).data)



    @action(detail=False, methods=['get'], url_path='active_shifts',
            permission_classes=[permissions.IsAuthenticated])
    def active_shifts(self, request):
        shifts = DriverShift.objects.filter(
            is_active=True,
        ).select_related('driver', 'truck')
        data = []
        now = timezone.now()

        for shift in shifts:
            if shift.current_latitude and shift.current_longitude:
                # Determine staleness status from last_location_update
                if shift.last_location_update:
                    age_seconds = (now - shift.last_location_update).total_seconds()
                    if age_seconds <= 60:
                        conn_status = 'active'
                    elif age_seconds <= 300:
                        conn_status = 'weak_signal'
                    else:
                        conn_status = 'offline'
                else:
                    conn_status = 'offline'
            else:
                # If no location yet, determine status by driver's last activity
                if shift.driver.last_activity:
                    age_seconds = (now - shift.driver.last_activity).total_seconds()
                    conn_status = 'active' if age_seconds <= 300 else 'offline'
                else:
                    conn_status = 'offline'

            truck = shift.truck
            if not truck:
                schedule = CollectionSchedule.objects.filter(driver=shift.driver, date=timezone.localdate()).first()
                if not schedule:
                    schedule = CollectionSchedule.objects.filter(driver=shift.driver).first()
                truck = schedule.truck if schedule else None

            data.append({
                'id': shift.id,
                'driver': shift.driver.full_name or shift.driver.username,
                'truck': truck.id if truck else None,
                'truckId': truck.plate_number if truck else 'Unknown',
                'truckModel': truck.model if truck else 'Unknown',
                'lat': float(shift.current_latitude) if shift.current_latitude else None,
                'lng': float(shift.current_longitude) if shift.current_longitude else None,
                'last_update': shift.last_location_update,
                'duty_type': shift.duty_type,
                'op_status': shift.op_status,
                'phase_status': shift.status,
                'status': conn_status,
                })
        return Response(data)

    @action(detail=False, methods=['get'], url_path='my_active_shift',
            permission_classes=[permissions.IsAuthenticated])
    def my_active_shift(self, request):
        shift = DriverShift.objects.filter(
            driver=request.user,
            is_active=True,
            current_latitude__isnull=False,
            current_longitude__isnull=False,
        ).select_related('driver', 'truck').first()

        if not shift:
            return Response(None)

        now = timezone.now()
        if shift.last_location_update:
            age_seconds = (now - shift.last_location_update).total_seconds()
            if age_seconds <= 60:
                conn_status = 'active'
            elif age_seconds <= 300:
                conn_status = 'weak_signal'
            else:
                conn_status = 'offline'
        else:
            conn_status = 'offline'

        truck = shift.truck
        if not truck:
            schedule = CollectionSchedule.objects.filter(driver=shift.driver, date=timezone.localdate()).first()
            if not schedule:
                schedule = CollectionSchedule.objects.filter(driver=shift.driver).first()
            truck = schedule.truck if schedule else None

        return Response({
            'id': shift.id,
            'driver': shift.driver.full_name or shift.driver.username,
            'truckId': truck.plate_number if truck else 'Unknown',
            'truckModel': truck.model if truck else 'Unknown',
            'lat': float(shift.current_latitude),
            'lng': float(shift.current_longitude),
            'last_update': shift.last_location_update,
            'duty_type': shift.duty_type,
            'op_status': shift.op_status,
            'status': conn_status,
        })

    @action(detail=False, methods=['get'], url_path='profile')
    def profile(self, request):
        """Driver profile + current truck assignment, consumed by CheckInModule & DriverStatusPanel."""
        user = request.user
        today = timezone.localdate()
        assignment = TruckCrewAssignment.objects.filter(
            driver=user, date=today, is_active=True
        ).select_related('truck', 'schedule').prefetch_related('schedule__barangays').first()

        truck = assignment.truck if assignment else None
        schedule = assignment.schedule if assignment else None

        if not schedule:
            schedule = CollectionSchedule.objects.filter(driver=user).prefetch_related('barangays').first()
            if schedule and not truck:
                truck = schedule.truck

        return Response({
            'id':           user.id,
            'name':         user.full_name,
            'email':        user.email,
            'role':         user.role,
            'employeeId':   f'DRV-{user.id:03d}',
            'barangay':     user.barangay.name if user.barangay else 'Unassigned',
            'truck':        f'TRUCK {truck.plate_number}' if truck else 'No Truck Assigned',
            'plateNumber':  truck.plate_number if truck else '—',
            'route':        str(schedule) if schedule else 'No Route Assigned',
            'truckId':      truck.id if truck else None,
        })

    @action(detail=False, methods=['get', 'post'], url_path='status')
    def shift_status(self, request):
        shift = DriverShift.objects.filter(driver=request.user, is_active=True).first()
        if request.method == 'POST':
            new_status = request.data.get('status')
            valid_statuses = ('heading_to_start', 'on_duty', 'on_route', 'delayed', 'heading_to_dumpsite', 'at_dumpsite', 'returning_to_base')
            if shift and new_status in valid_statuses:
                # Trigger dumpsite notification if transitioning to heading_to_dumpsite
                if new_status == 'heading_to_dumpsite':
                    from notifications.services import notify_dumpsite_inbound
                    from driver.models import CollectionSchedule
                    # Try to find today's schedule for this driver to know which dumpsite they're heading to
                    import datetime
                    date_str = str(datetime.date.today())
                    sched = CollectionSchedule.objects.filter(driver=request.user, date=date_str).first()
                    if not sched:
                        sched = CollectionSchedule.objects.filter(driver=request.user).first()
                    if sched and sched.dumpsite:
                        notify_dumpsite_inbound(shift, sched.dumpsite)

                shift.op_status = new_status
                shift.save(update_fields=['op_status'])
                return Response({'shift_active': True, 'op_status': shift.op_status})
            return Response({'error': 'No active shift or invalid status.'}, status=400)
        # GET
        if shift:
            return Response({
                'shift_active': True,
                'status': 'on_duty',
                'op_status': shift.op_status,
                'started_at': shift.started_at,
            })
        return Response({'shift_active': False, 'status': 'off_duty', 'op_status': 'off_duty'})

    @action(detail=False, methods=['get'], url_path='analytics')
    def analytics(self, request):
        """Per-driver analytics: summary + weekly stops + trend."""
        from django.db.models import Count, Sum
        import datetime
        user = request.user
        today = timezone.localdate()
        start_month = today.replace(day=1)
        start_week  = today - datetime.timedelta(days=today.weekday())

        from django.db.models import Sum, Count
        month_agg = DriverShift.objects.filter(
            driver=user, is_active=False, started_at__date__gte=start_month
        ).aggregate(total_ms=Sum('duration_ms'), routes_done=Count('id'))
        total_ms    = month_agg['total_ms'] or 0
        routes_done = month_agg['routes_done'] or 0
        total_hrs   = round(total_ms / 3_600_000, 1)
        avg_mins    = round((total_ms / 1000 / 60) / routes_done, 0) if routes_done else 0

        days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        weekly = []
        for i, day_name in enumerate(days):
            day_date = start_week + datetime.timedelta(days=i)
            count = PickupStatus.objects.filter(
                driver=user,
                status='COMPLETED',
                collected_at__date=day_date
            ).count()
            weekly.append({'day': day_name, 'stops': count})

        recent = list(
            DriverShift.objects.filter(driver=user, is_active=False, duration_ms__isnull=False)
            .order_by('-started_at')[:8]
            .values_list('duration_ms', flat=True)
        )
        trend = [round(ms / 1000 / 60, 1) for ms in reversed(recent)] if recent else [0]

        return Response({
            'summary': {
                'routesCompleted':   routes_done,
                'stopsCompleted':    PickupStatus.objects.filter(driver=user, status='COMPLETED', collected_at__date__gte=start_month).count(),
                'totalWorkingHours': total_hrs,
                'avgCompletionMins': avg_mins,
            },
            'weekly': weekly,
            'trend':  trend,
        })
    # ↑ analytics ends here — barangay_stops is a SEPARATE method below

    @action(detail=False, methods=['get'], url_path='barangay_stops',
            permission_classes=[permissions.IsAuthenticated])
    def barangay_stops(self, request):
        """
        Returns active trucks + stop markers for a given barangay.
        GET /api/driver/shift/barangay_stops/?barangay_name=<name>
        """
        barangay_name = request.query_params.get('barangay_name', '').strip()
        scope = request.query_params.get('scope', 'all').strip().lower()
        if not barangay_name:
            return Response({'error': 'barangay_name is required.'}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        result_trucks, result_stops = [], []

        for shift in DriverShift.objects.filter(is_active=True).select_related('driver', 'truck'):
            schedule = CollectionSchedule.objects.filter(
                driver=shift.driver,
                barangays__name=barangay_name,
            ).first()
            if not schedule:
                continue

            age = (now - shift.last_location_update).total_seconds() if shift.last_location_update else None
            conn = 'active' if age and age <= 60 else 'weak_signal' if age and age <= 300 else 'offline'

            if shift.current_latitude and shift.current_longitude:
                result_trucks.append({
                    'id': shift.id,
                    'driver_id': shift.driver.id,
                    'driver': shift.driver.full_name,
                    'driver_name': shift.driver.full_name,
                    'truckId': shift.truck.plate_number if shift.truck else 'Unknown',
                    'truck_plate': shift.truck.plate_number if shift.truck else 'Unknown',
                    'truckModel': shift.truck.model if shift.truck else 'Unknown',
                    'lat': float(shift.current_latitude),
                    'lng': float(shift.current_longitude),
                    'status': conn,
                    'op_status': shift.op_status,
                    'last_update': shift.last_location_update.isoformat() if shift.last_location_update else None,
                    'barangay_name': barangay_name,
                })

            from watcher.models import StopValidation, StopValidationStatus
            from watcher.stop_validation_service import ensure_stop_validations_for_schedule
            from watcher.stop_validation_utils import is_schedule_today, is_validation_visible

            if not is_schedule_today(schedule):
                continue

            ensure_stop_validations_for_schedule(schedule)
            today = timezone.localdate()
            validations = {
                sv.stop_order: sv
                for sv in StopValidation.objects.filter(schedule=schedule, collection_date=today)
                if is_validation_visible(sv)
            }

            current_order = None
            for order in sorted(validations.keys()):
                if validations[order].current_status == StopValidationStatus.READY_FOR_COLLECTION:
                    current_order = order
                    break
            if current_order is None:
                for order in sorted(validations.keys()):
                    if validations[order].current_status == StopValidationStatus.COLLECTION_REPORTED:
                        current_order = order
                        break

            for i, wp in enumerate(schedule.waypoints or []):
                if i == 0:
                    continue  # skip home base
                sv = validations.get(i)
                if not sv:
                    continue
                is_current = i == current_order
                if scope == 'focus' and not is_current:
                    continue
                st = sv.current_status
                result_stops.append({
                    'lat': float(wp.get('lat', 0)), 'lng': float(wp.get('lng', 0)),
                    'label': wp.get('label', f'Stop {i}'),
                    'status': st,
                    'current_status': st,
                    'is_current': is_current,
                    'stop_order': i,
                    'schedule_id': schedule.id,
                    'driver_id': shift.driver.id,
                    'driver_name': shift.driver.full_name,
                    'truck_plate': shift.truck.plate_number if shift.truck else '',
                    'collected_at': sv.collection_timestamp.isoformat() if sv.collection_timestamp else None,
                })

        if scope == 'focus':
            active_driver_ids = {s['driver_id'] for s in result_stops}
            result_trucks = [
                t for t in result_trucks
                if t.get('driver_id') in active_driver_ids
            ]

        return Response({'trucks': result_trucks, 'stops': result_stops})

class CalendarEventViewSet(viewsets.ModelViewSet):
    queryset = CalendarEvent.objects.all().order_by('-date')
    serializer_class = CalendarEventSerializer
    permission_classes = [permissions.IsAuthenticated]
