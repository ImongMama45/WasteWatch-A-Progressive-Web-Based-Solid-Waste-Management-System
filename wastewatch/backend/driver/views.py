from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
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
)

class TruckViewSet(viewsets.ModelViewSet):
    queryset = Truck.objects.all()
    serializer_class = TruckSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='shift/status')
    def shift_status(self, request):
        # In a real app, this might check a Shift model.
        # For now, we'll return a basic status.
        return Response({
            'shift_active': False, # This is usually handled by the frontend useShiftTimer
            'status': 'off_duty'
        })

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

class TruckLocationViewSet(viewsets.ModelViewSet):
    queryset = TruckLocation.objects.all()
    serializer_class = TruckLocationSerializer
    permission_classes = [permissions.IsAuthenticated]

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
        'truck', 'driver', 'schedule', 'schedule__barangay'
    ).prefetch_related('crew_members').all()
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
            'truck', 'driver', 'schedule', 'schedule__barangay'
        ).prefetch_related('crew_members').first()

        if not assignment:
            # Try most recent active assignment as fallback
            assignment = TruckCrewAssignment.objects.filter(
                crew_members=request.user,
                is_active=True,
            ).select_related(
                'truck', 'driver', 'schedule', 'schedule__barangay'
            ).prefetch_related('crew_members').first()

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
