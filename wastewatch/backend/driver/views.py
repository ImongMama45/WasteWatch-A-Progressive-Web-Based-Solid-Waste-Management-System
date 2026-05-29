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
    queryset = Dumpsite.objects.all()
    serializer_class = DumpsiteSerializer
    permission_classes = [permissions.IsAuthenticated]

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
