from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from django.db import transaction, models
from .models import Dumpsite, WasteDelivery, DumpsiteIncident
from .serializers import DumpsiteSerializer, WasteDeliverySerializer, DumpsiteIncidentSerializer
from driver.models import DriverShift, CollectionSchedule

class DumpsiteViewSet(viewsets.ModelViewSet):
    queryset = Dumpsite.objects.select_related('barangay').all()
    serializer_class = DumpsiteSerializer
    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        qs = Dumpsite.objects.select_related('barangay', 'operator').all()
        # Dumpsite operators only see their own site
        if getattr(user, 'role', None) == 'dumpsite' and hasattr(user, 'operated_dumpsite'):
            try:
                return qs.filter(pk=user.operated_dumpsite.pk)
            except Exception:
                pass
        return qs

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
        # Link as the site's operator if not already set
        if not site.operator:
            site.operator = user
            site.save(update_fields=['operator'])

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

    @action(detail=True, methods=['get'], url_path='dashboard')
    def dashboard(self, request, pk=None):
        """KPI data for the dumpsite operator dashboard."""
        from django.db.models import Sum, Count
        import datetime
        site  = self.get_object()
        today = timezone.localdate()

        today_qs = WasteDelivery.objects.filter(dumpsite=site, date=today)
        today_kg     = today_qs.aggregate(t=Sum('estimated_kg'))['t'] or 0
        trucks_today = today_qs.values('truck').distinct().count()
        barangays    = today_qs.filter(barangays__isnull=False).values('barangays__name').distinct().count()

        recent = WasteDelivery.objects.filter(dumpsite=site).select_related(
            'truck', 'driver'
        ).prefetch_related('barangays').order_by('-created_at')[:5]

        return Response({
            'site_name':       site.name,
            'fill_percent':    site.fill_percent,
            'current_fill_kg': float(site.current_fill_kg),
            'max_capacity_kg': float(site.max_capacity_kg),
            'today_kg':        float(today_kg),
            'trucks_today':    trucks_today,
            'barangays_today': barangays,
            'recent_deliveries': [
                {
                    'id':          d.id,
                    'truck':       d.truck.plate_number,
                    'driver':      d.driver.full_name,
                    'fill_level':  d.fill_level,
                    'estimated_kg': float(d.estimated_kg),
                    'barangay':    ', '.join(b.name for b in d.barangays.all()) if d.barangays.exists() else None,
                    'time':        d.arrival_time.strftime('%I:%M %p') if d.arrival_time else None,
                    'created_at':  d.created_at.isoformat(),
                }
                for d in recent
            ],
        })

    @action(detail=True, methods=['get'], url_path='inbound_queue')
    def inbound_queue(self, request, pk=None):
        """Trucks with op_status in ('heading_to_dumpsite', 'at_dumpsite') — the incoming queue."""
        self.get_object()  # permission check
        from datetime import timedelta
        cutoff = timezone.now() - timedelta(minutes=5)
        shifts = DriverShift.objects.filter(
            is_active=True,
            op_status__in=['heading_to_dumpsite', 'at_dumpsite'],
            driver__last_activity__gte=cutoff
        ).select_related('driver', 'truck')

        data = []
        today = timezone.localdate()
        for shift in shifts:
            schedule = CollectionSchedule.objects.filter(
                driver=shift.driver, date=today
            ).prefetch_related('barangays').first()
            if not schedule:
                schedule = CollectionSchedule.objects.filter(
                    driver=shift.driver
                ).prefetch_related('barangays').first()

            data.append({
                'shift_id':    shift.id,
                'driver':      shift.driver.full_name,
                'driver_id':   shift.driver.id,
                'truck_plate': shift.truck.plate_number if shift.truck else 'Unknown',
                'truck_id':    shift.truck.id if shift.truck else None,
                'truck_max_capacity_kg': float(shift.truck.max_capacity_kg) if shift.truck else 1000.0,
                'barangays':   [b.name for b in schedule.barangays.all()] if schedule else [],
                'barangay_ids': [b.id for b in schedule.barangays.all()] if schedule else [],
                'schedule_id': schedule.id if schedule else None,
                'op_status':   shift.op_status,
                'started_at':  shift.started_at.isoformat(),
            })
        return Response(data)

    @action(detail=True, methods=['get'], url_path='deliveries')
    def deliveries(self, request, pk=None):
        """Paginated + filtered WasteDelivery records for this dumpsite."""
        site = self.get_object()
        qs   = WasteDelivery.objects.filter(dumpsite=site).select_related(
            'truck', 'driver'
        ).prefetch_related('barangays').order_by('-created_at')

        # Filters
        p = request.query_params
        if p.get('date_from'):  qs = qs.filter(date__gte=p['date_from'])
        if p.get('date_to'):    qs = qs.filter(date__lte=p['date_to'])
        if p.get('truck'):      qs = qs.filter(truck__plate_number__icontains=p['truck'])
        if p.get('barangay'):   qs = qs.filter(barangays__name__icontains=p['barangay'])
        if p.get('fill_level'): qs = qs.filter(fill_level=p['fill_level'])

        serializer = WasteDeliverySerializer(qs[:100], many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='log_arrival')
    def log_arrival(self, request, pk=None):
        """Create a WasteDelivery, atomically increment dumpsite fill."""
        from driver.models import TruckCrewAssignment
        site = self.get_object()
        data = request.data.copy()
        data['dumpsite']          = site.id
        data['dumpsite_operator'] = request.user.id
        
        date_str = str(timezone.localdate())
        data.setdefault('date', date_str)
        data.setdefault('arrival_time', timezone.now().strftime('%H:%M:%S'))

        if data.get('truck'):
            # Try to find the active crew assignment for this truck today
            assignment = TruckCrewAssignment.objects.filter(
                truck_id=data['truck'], date=date_str, is_active=True
            ).first()
            if assignment:
                if not data.get('driver'):
                    data['driver'] = assignment.driver_id
                if not data.get('schedule'):
                    data['schedule'] = assignment.schedule_id
                if not data.get('crew_assignment'):
                    data['crew_assignment'] = assignment.id
            
            # If driver is still missing, fallback to truck's default driver
            if not data.get('driver'):
                from driver.models import Truck
                truck_obj = Truck.objects.filter(id=data['truck']).first()
                if truck_obj and truck_obj.driver_id:
                    data['driver'] = truck_obj.driver_id

            # If schedule is still missing, try to find ANY schedule for this driver today
            if not data.get('schedule') and data.get('driver'):
                from driver.models import CollectionSchedule
                sched = CollectionSchedule.objects.filter(
                    driver_id=data['driver'], date=date_str
                ).first()
                if not sched:
                    sched = CollectionSchedule.objects.filter(
                        driver_id=data['driver']
                    ).first()
                if sched:
                    data['schedule'] = sched.id

        serializer = WasteDeliverySerializer(data=data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            delivery = serializer.save()
            Dumpsite.objects.filter(pk=site.pk).update(
                current_fill_kg=models.F('current_fill_kg') + delivery.estimated_kg
            )
            # Clear the driver's dumpsite op_status so they drop off the queue
            from driver.models import DriverShift
            shift = DriverShift.objects.filter(driver=delivery.driver, is_active=True).first()
            if shift and shift.op_status in ['heading_to_dumpsite', 'at_dumpsite']:
                shift.op_status = 'returning_to_base'
                shift.save(update_fields=['op_status'])
        return Response(WasteDeliverySerializer(delivery).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='barangay_breakdown')
    def barangay_breakdown(self, request, pk=None):
        """Per-barangay estimated_kg totals for day / week / month."""
        from django.db.models import Sum, Count
        import datetime
        site   = self.get_object()
        period = request.query_params.get('period', 'day')
        today  = timezone.localdate()

        if period == 'week':
            start = today - datetime.timedelta(days=today.weekday())
        elif period == 'month':
            start = today.replace(day=1)
        else:
            start = today

        rows = (
            WasteDelivery.objects.filter(dumpsite=site, date__gte=start)
            .values('barangays__name')
            .annotate(total_kg=Sum('estimated_kg'), truck_count=Count('truck', distinct=True))
            .order_by('-total_kg')
        )
        return Response([
            {
                'barangay':    r['barangays__name'] or 'Unknown',
                'total_kg':    float(r['total_kg'] or 0),
                'truck_count': r['truck_count'],
            }
            for r in rows
        ])

    @action(detail=True, methods=['post'], url_path='reset_capacity',
            permission_classes=[permissions.IsAdminUser])
    def reset_capacity(self, request, pk=None):
        """Admin-only: reset current_fill_kg to 0 (dumpsite cleared)."""
        site = self.get_object()
        site.current_fill_kg = 0
        site.capacity_used   = 0
        site.save(update_fields=['current_fill_kg', 'capacity_used'])
        return Response({'status': 'reset', 'current_fill_kg': 0})

class WasteDeliveryViewSet(viewsets.ModelViewSet):
    queryset = WasteDelivery.objects.select_related(
        'truck', 'driver', 'dumpsite', 'dumpsite_operator', 'schedule'
    ).prefetch_related('barangays').all()
    serializer_class = WasteDeliverySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        # Dumpsite operators only see deliveries at their linked dumpsite
        user = self.request.user
        if user.role == 'dumpsite' and user.dumpsite_id:
            qs = qs.filter(dumpsite_id=user.dumpsite_id)
        elif user.role == 'driver':
            qs = qs.filter(driver=user)
        return qs.order_by('-created_at')

    def perform_create(self, serializer):
        delivery = serializer.save()
        from driver.models import DriverShift
        shift = DriverShift.objects.filter(driver=delivery.driver, is_active=True).first()
        if shift and shift.op_status in ['heading_to_dumpsite', 'at_dumpsite']:
            shift.op_status = 'returning_to_base'
            shift.save(update_fields=['op_status'])

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
                    .values('barangays__name')
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

class DumpsiteIncidentViewSet(viewsets.ModelViewSet):
    queryset = DumpsiteIncident.objects.select_related('delivery', 'reported_by').all()
    serializer_class = DumpsiteIncidentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        delivery_id = self.request.query_params.get('delivery')
        if delivery_id:
            qs = qs.filter(delivery_id=delivery_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(reported_by=self.request.user)
