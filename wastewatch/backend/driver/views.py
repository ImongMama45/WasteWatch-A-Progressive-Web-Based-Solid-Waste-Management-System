from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from datetime import timezone
from django.utils.dateparse import parse_datetime
from .models import (
    Truck,
    Dumpsite,
    CollectionSchedule,
    RouteAssignment,
    PickupStatus,
    TruckLocation,
    CompletionReport,
    DriverNotification,
    TruckCrewAssignment,
    WasteDelivery,
    CalendarEvent,
    DriverShift,
)
from .serializers import (
    TruckSerializer,
    DumpsiteSerializer,
    CollectionScheduleSerializer,
    RouteAssignmentSerializer,
    PickupStatusSerializer,
    TruckLocationSerializer,
    CompletionReportSerializer,
    DriverNotificationSerializer,
    TruckCrewAssignmentSerializer,
    WasteDeliverySerializer,
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

class DumpsiteViewSet(viewsets.ModelViewSet):
    queryset = Dumpsite.objects.select_related('barangay').all()
    serializer_class = DumpsiteSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=True, methods=['post'], url_path='create-account')
    def create_account(self, request, pk=None):
        """Create a dumpsite-role user account linked to this site."""
        from accounts.models import User, UserRole
        site = self.get_object()
        data = request.data

        full_name = data.get('full_name', '').strip()
        email     = data.get('email', '').strip().lower()
        password  = data.get('password', '')

        if not full_name:
            return Response({'error': 'Full name is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not email:
            return Response({'error': 'Email is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not password or len(password) < 6:
            return Response({'error': 'Password must be at least 6 characters.'}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(email__iexact=email).exists():
            return Response({'error': 'An account with this email already exists.'}, status=status.HTTP_400_BAD_REQUEST)

        user = User(
            full_name=full_name,
            email=email,
            role=UserRole.DUMPSITE,
            dumpsite=site,
            barangay=site.barangay,
        )
        user.set_password(password)
        user.save()

        return Response({
            'id':         user.id,
            'full_name':  user.full_name,
            'email':      user.email,
            'role':       user.role,
            'dumpsite':   site.id,
            'barangay':   site.barangay.name if site.barangay else None,
            'is_active':  user.is_active,
            'created_at': user.created_at.strftime('%b %d, %Y'),
        }, status=status.HTTP_201_CREATED)

class CollectionScheduleViewSet(viewsets.ModelViewSet):
    queryset = CollectionSchedule.objects.all()
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
        Returns the driver's next uncompleted stop for today.
        Maps to GET /api/driver/stops/current/
        """
        today = timezone.localdate()
        assignment = TruckCrewAssignment.objects.filter(driver=request.user, date=today, is_active=True).first()
        if assignment and assignment.schedule:
            schedule = assignment.schedule
        else:
            schedule = CollectionSchedule.objects.filter(driver=request.user, date=today).first()
            if not schedule:
                schedule = CollectionSchedule.objects.filter(driver=request.user).first()
        if schedule:
            stop = PickupStatus.objects.filter(
                driver=request.user,
                schedule=schedule
            ).exclude(status='COMPLETED').select_related('schedule').order_by('stop_order').first()
        else:
            stop = PickupStatus.objects.filter(
                driver=request.user
            ).exclude(status='COMPLETED').select_related('schedule').order_by('stop_order').first()

        if not stop:
            return Response(None)  # null → frontend shows "no more stops"

        schedule = stop.schedule
        return Response({
            'id':            stop.id,
            'order':         stop.stop_order,
            'address':       stop.address or (schedule.area if schedule else 'Unknown'),
            'barangay':      ', '.join(b.name for b in schedule.barangays.all()[:1]) if schedule else 'Unknown',
            'zone':          schedule.area if schedule else '',
            'category':      'Mixed Waste',
            'scheduledTime': schedule.start_time.strftime('%I:%M %p') if schedule else 'N/A',
            'distance':      '—',
            'notes':         stop.note,
        })

    @action(detail=True, methods=['post'], url_path='collect')
    def collect(self, request, pk=None):
        stop = self.get_object()
        if stop.driver != request.user:
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        photo = request.FILES.get('photo')
        if not photo:
            return Response({'error': 'A proof photo is required.'}, status=status.HTTP_400_BAD_REQUEST)

        stop.status = 'COMPLETED'
        stop.note = request.data.get('note') or stop.note
        stop.collected_at = timezone.now()
        stop.photo_url = photo
        stop.save(update_fields=['status', 'note', 'collected_at', 'photo_url', 'updated_at'])
        return Response({
            'id': stop.id,
            'status': stop.status,
            'collected_at': stop.collected_at,
            'stop_order': stop.stop_order,
            'schedule_id': stop.schedule_id,
            'driver_id': stop.driver_id,
            'photo_url': stop.photo_url.url if getattr(stop.photo_url, 'url', None) else stop.photo_url,
            'updated_at': stop.updated_at,
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

class DriverNotificationViewSet(viewsets.ModelViewSet):
    queryset = DriverNotification.objects.all()
    serializer_class = DriverNotificationSerializer
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

class WasteDeliveryViewSet(viewsets.ModelViewSet):
    queryset = WasteDelivery.objects.select_related(
        'truck', 'driver', 'dumpsite', 'dumpsite_operator', 'schedule', 'barangay'
    ).all()
    serializer_class = WasteDeliverySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        # Dumpsite operators only see deliveries at their linked dumpsite
        user = self.request.user
        if user.role == 'dumpsite' and user.dumpsite_id:
            qs = qs.filter(dumpsite_id=user.dumpsite_id)
        return qs

    @action(detail=False, methods=['get'], url_path='analytics')
    def analytics(self, request):
        """Aggregated net_weight by day/week/month for dashboard charts."""
        from django.db.models import Sum, Count
        from django.utils import timezone
        import datetime

        today  = timezone.localdate()
        start_week  = today - datetime.timedelta(days=today.weekday())
        start_month = today.replace(day=1)

        base = WasteDelivery.objects.filter(is_validated=True)
        return Response({
            'today':  base.filter(date=today).aggregate(
                        kg=Sum('net_weight'), trips=Count('id')),
            'week':   base.filter(date__gte=start_week).aggregate(
                        kg=Sum('net_weight'), trips=Count('id')),
            'month':  base.filter(date__gte=start_month).aggregate(
                        kg=Sum('net_weight'), trips=Count('id')),
            'by_barangay': list(
                base.filter(date__gte=start_month)
                    .values('barangay__name')
                    .annotate(kg=Sum('net_weight'), trips=Count('id'))
                    .order_by('-kg')[:10]
            ),
            'by_truck': list(
                base.filter(date__gte=start_month)
                    .values('truck__plate_number', 'driver__full_name')
                    .annotate(kg=Sum('net_weight'), trips=Count('id'))
                    .order_by('-kg')[:10]
            ),
        })

class CalendarEventViewSet(viewsets.ModelViewSet):
    queryset = CalendarEvent.objects.all().order_by('-date')
    serializer_class = CalendarEventSerializer
    permission_classes = [permissions.IsAuthenticated]

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

        # Vicinity check
        if schedule and schedule.waypoints:
            waypoints = schedule.waypoints
            if waypoints and len(waypoints) > 0:
                home_base = waypoints[0] # First waypoint is the home base
                if driver_lat and driver_lng and 'lat' in home_base and 'lng' in home_base:
                    try:
                        dist = haversine(
                            float(driver_lat), float(driver_lng),
                            float(home_base['lat']), float(home_base['lng'])
                        )
                        if dist > 1000: # 1000 meters / 1km radius
                            return Response({
                                'error': f'You are too far from the home base ({int(dist)}m away). You must be within 1km to start your shift.'
                            }, status=status.HTTP_403_FORBIDDEN)
                    except ValueError:
                        pass # Invalid coordinates format


        

        with transaction.atomic():
            # Check for existing active shifts
            if DriverShift.objects.select_for_update().filter(driver=driver, is_active=True).exists():
                return Response({'error': 'Driver already has an active shift.'}, status=status.HTTP_400_BAD_REQUEST)
            if truck and DriverShift.objects.select_for_update().filter(truck=truck, is_active=True).exists():
                return Response({'error': 'Truck is currently being used in another active shift.'}, status=status.HTTP_400_BAD_REQUEST)

            shift = DriverShift.objects.create(
                driver=driver,
                truck=truck,
                duty_type=duty_type,
                started_at=timezone.now(),  # always server-side — never trust client clock
                is_active=True,
                current_latitude=driver_lat,    # ← add this
                current_longitude=driver_lng,   # ← add this
                last_location_update=timezone.now()  # ← and this
            )
        return Response(DriverShiftSerializer(shift).data, status=status.HTTP_201_CREATED)


    @action(detail=False, methods=['post'], url_path='end')
    def end_shift(self, request):
        driver = request.user
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
            current_latitude__isnull=False,
            current_longitude__isnull=False,
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

                truck = shift.truck
                if not truck:
                    schedule = CollectionSchedule.objects.filter(driver=shift.driver, date=timezone.localdate()).first()
                    if not schedule:
                        schedule = CollectionSchedule.objects.filter(driver=shift.driver).first()
                    truck = schedule.truck if schedule else None

                data.append({
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
        return Response(data)

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
            if shift and new_status in ('on_duty', 'on_route', 'delayed'):
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
                    'id': shift.id, 'driver': shift.driver.full_name,
                    'truckId': shift.truck.plate_number if shift.truck else 'Unknown',
                    'lat': float(shift.current_latitude), 'lng': float(shift.current_longitude),
                    'status': conn,
                })

            completed_orders = set(PickupStatus.objects.filter(
                driver=shift.driver, schedule=schedule, status='COMPLETED',
            ).values_list('stop_order', flat=True))

            failed_orders = set(PickupStatus.objects.filter(
                driver=shift.driver, schedule=schedule, status='FAILED',
            ).values_list('stop_order', flat=True))

            nxt = PickupStatus.objects.filter(
                driver=shift.driver, schedule=schedule,
            ).exclude(status__in=['COMPLETED', 'FAILED']).order_by('stop_order').first()
            current_order = nxt.stop_order if nxt else None

            for i, wp in enumerate(schedule.waypoints or []):
                if i == 0:
                    continue  # skip home base
                st = (
                    'collected' if i in completed_orders
                    else 'missed' if i in failed_orders
                    else 'current' if i == current_order
                    else 'upcoming'
                )
                result_stops.append({
                    'lat': float(wp.get('lat', 0)), 'lng': float(wp.get('lng', 0)),
                    'label': wp.get('label', f'Stop {i}'),
                    'status': st, 'stop_order': i,
                    'driver_id': shift.driver.id, 'driver_name': shift.driver.full_name,
                })

        return Response({'trucks': result_trucks, 'stops': result_stops})
