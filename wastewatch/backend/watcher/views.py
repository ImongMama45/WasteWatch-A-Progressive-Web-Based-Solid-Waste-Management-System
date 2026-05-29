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
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'admin':
            return GarbageReport.objects.all()
        return GarbageReport.objects.filter(user=user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        user = self.request.user
        qs = self.get_queryset()
        return Response({
            'total':            qs.count(),
            'pending':          qs.filter(status=ReportStatus.PENDING).count(),
            'resolved':         qs.filter(status=ReportStatus.RESOLVED).count(),
            'rejected':         qs.filter(status=ReportStatus.REJECTED).count(),
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
