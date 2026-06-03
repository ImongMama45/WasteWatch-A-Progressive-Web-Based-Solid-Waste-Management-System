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
