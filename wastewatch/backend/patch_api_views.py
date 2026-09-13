import os

file_path = r"d:\Coding\Waste Watch\wastewatch\backend\accounts\api_views.py"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

imports = """
from django.db.models import Count, Q, Case, When, BooleanField
from rest_framework.decorators import action
from rest_framework import viewsets
from .serializers import BarangayListSerializer, BarangayDetailSerializer
"""

if "BarangayManagementViewSet" not in content:
    new_views = """
class BarangayManagementViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [permissions.IsAuthenticated, permissions.IsAdminUser]

    def get_queryset(self):
        if self.action == 'list':
            return Barangay.objects.annotate(
                official_count=Count('residents', filter=Q(residents__role='brgy_official'), distinct=True),
                watcher_count=Count('residents', filter=Q(residents__role='watcher'), distinct=True),
                driver_count=Count('residents', filter=Q(residents__role='driver'), distinct=True),
                pending_concerns=Count(
                    'reports', filter=Q(reports__status='PENDING'), distinct=True
                ),
                active_hotspots=Count(
                    'hotspots', distinct=True # Or filter by something if hotspot has is_active
                ),
                open_escalations=Count(
                    'escalations', filter=Q(escalations__status='pending'), distinct=True
                ),
                has_unassigned_roles=Case(
                    When(Q(official_count=0) | Q(watcher_count=0) | Q(driver_count=0),
                         then=True),
                    default=False,
                    output_field=BooleanField(),
                ),
            )
        return Barangay.objects.prefetch_related(
            'residents', 'hotspots', 'escalations', 'reports',
        )

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return BarangayDetailSerializer
        return BarangayListSerializer

    @action(detail=True, methods=['patch'], url_path='assign-personnel')
    def assign_personnel(self, request, pk=None):
        barangay = self.get_object()
        user_id = request.data.get('user_id')
        role = request.data.get('role')
        
        if not user_id or not role:
            return Response({"error": "user_id and role are required."}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            user = User.objects.get(pk=user_id)
            user.role = role
            user.barangay = barangay
            user.save()
            return Response({"status": "assigned successfully", "user_id": user_id, "role": role})
        except User.DoesNotExist:
            return Response({"error": "User not found."}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['get'], url_path='unassigned-users')
    def unassigned_users(self, request):
        role = request.GET.get('role')
        qs = User.objects.filter(is_active=True, role=UserRole.CITIZEN)
        # Could also filter based on requested role if we just want users available to be promoted
        from .serializers import UserSerializer
        data = UserSerializer(qs, many=True).data
        return Response(data)

"""
    # Insert imports at the top
    if "Count, Q, Case, When, BooleanField" not in content:
        content = imports + "\n" + content
        
    content += new_views
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

print("api_views updated.")
