
from django.db.models import Count, Q, Case, When, BooleanField
from rest_framework.decorators import action
from rest_framework import viewsets
from .serializers import BarangayListSerializer, BarangayDetailSerializer

"""
accounts/api_views.py
---------------------
JSON API endpoints consumed by the React Vite frontend.
These are separate from the HTML template views so both can coexist.

Endpoints:
  POST /api/auth/register/  — create account
  POST /api/auth/login/     — start session, return user JSON
  POST /api/auth/logout/    — destroy session
  GET  /api/auth/me/        — return current user or 401
  GET  /api/barangays/      — list all barangays for dropdowns
"""

import json
from django.http             import JsonResponse
from django.views.decorators.http   import require_http_methods
from django.views.decorators.csrf   import ensure_csrf_cookie
from django.contrib.auth            import authenticate, login, logout

from rest_framework import viewsets, permissions, serializers
from .models import User, Barangay
from .serializers import UserSerializer, BarangaySerializer, RegisterSerializer, AdminUserSerializer


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related('barangay', 'dumpsite').order_by('-id')
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        # Admin writes use the full serializer (password + role writable)
        if self.action in ('create', 'update', 'partial_update'):
            return AdminUserSerializer
        return UserSerializer

    def get_queryset(self):
        queryset = self.queryset.all()
        role = self.request.query_params.get('role')
        if role:
            return queryset.filter(role=role)
        return queryset

class BarangayViewSet(viewsets.ModelViewSet):
    queryset = Barangay.objects.all()
    serializer_class = BarangaySerializer
    permission_classes = [permissions.AllowAny]


# ── Helper: serialize a User to a safe dict ──────────────────────────────────
def user_to_dict(user):
    """
    Helper to convert a User model instance into a JSON-serializable dict.
    Used by /api/auth/me/ and admin user list.
    """
    return {
        'id':            user.id,
        'full_name':     user.full_name or '',
        'email':         user.email or '',
        'role':          user.role,
        'employee_type': user.employee_type or '',
        'barangay':      user.barangay_id,
        'barangay_id':   user.barangay_id,
        'barangay_name': user.barangay.name if user.barangay else None,
        'dumpsite':      user.dumpsite_id,
        'dumpsite_id':   user.dumpsite_id,
        'dumpsite_name': user.dumpsite.name if user.dumpsite else None,
        'is_active':     user.is_active,
        'profile_pic':   user.profile_pic.url if user.profile_pic else None,
        'created_at':    user.created_at.isoformat() if user.created_at else None,
    }


def _json_body(request):
    try:
        return json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return None


from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

# ── GET  /api/auth/csrf/ ──────────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([permissions.AllowAny])
@ensure_csrf_cookie
def get_csrf_token_view(request):
    return Response({'detail': 'CSRF cookie set'})


# ── GET  /api/auth/me/ ────────────────────────────────────────────────────────
@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def me_view(request):
    if request.method == 'PATCH':
        allowed = {}
        for field in ('full_name', 'first_name', 'last_name', 'username', 'barangay', 'profile_pic'):
            if field in request.data:
                allowed[field] = request.data[field]
                
        serializer = UserSerializer(request.user, data=allowed, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        serializer.save()
        return Response(user_to_dict(request.user))

    return Response(user_to_dict(request.user))


# ── POST /api/auth/login/ ─────────────────────────────────────────────────────
from django.views.decorators.csrf import csrf_exempt
@csrf_exempt
@require_http_methods(['POST'])
def api_login_view(request):
    data = _json_body(request)
    if data is None:
        return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    user = authenticate(request, username=email, password=password)
    if user is None:
        return JsonResponse({'error': 'Invalid email or password.'}, status=400)

    login(request, user)
    return JsonResponse({'user': user_to_dict(user)})


# ── POST /api/auth/logout/ ────────────────────────────────────────────────────
@csrf_exempt
@require_http_methods(['POST'])
def api_logout_view(request):
    logout(request)
    return JsonResponse({'message': 'Logged out.'})


# ── POST /api/auth/register/ ─────────────────────────────────────────────────
@csrf_exempt
@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def api_register_view(request):
    data = request.data
    if not data:
        return JsonResponse({'error': 'Invalid payload.'}, status=400)

    print(f"DEBUG: api_register_view - Received barangay: {data.get('barangay')}")

    serializer = RegisterSerializer(data=data)
    if serializer.is_valid():
        user = serializer.save()
        return JsonResponse({'user': user_to_dict(user)}, status=201)

    return JsonResponse(serializer.errors, status=400)


# ── GET /api/barangays/ ───────────────────────────────────────────────────────
@require_http_methods(['GET'])
def barangay_list_view(request):
    barangays = list(Barangay.objects.values('id', 'name').order_by('name'))
    return JsonResponse(barangays, safe=False)


# ── GET /api/auth/users/ ──────────────────────────────────────────────────────
@require_http_methods(['GET'])
def user_list_view(request):
    # Basic protection: only admins can see all users
    # In a real app, you'd use a better check
    if not request.user.is_authenticated or request.user.role != 'admin':
        return JsonResponse({'error': 'Unauthorized'}, status=403)

    role_filter = request.GET.get('role')
    users = User.objects.all()
    if role_filter:
        users = users.filter(role=role_filter)
    
    data = [user_to_dict(u) for u in users]
    return JsonResponse(data, safe=False)

from django.utils import timezone
from datetime import timedelta
from django.http import HttpResponse
from django.views.decorators.http import require_POST
from django.contrib.auth.decorators import login_required

PERSONNEL_ROLES = ('watcher', 'brgy_official', 'driver')

@csrf_exempt
@login_required
@require_POST
def heartbeat_view(request):
    user = request.user
    if getattr(user, 'role', None) not in PERSONNEL_ROLES:
        return HttpResponse(status=204)
    from django.contrib.auth import get_user_model
    User = get_user_model()
    User.objects.filter(pk=user.pk).update(
        last_activity=timezone.now()
    )
    return HttpResponse(status=204)

@login_required
def online_users_view(request):
    cutoff = timezone.now() - timedelta(minutes=5)
    from django.contrib.auth import get_user_model
    User = get_user_model()

    personnel = (
        User.objects
        .filter(
            role__in=PERSONNEL_ROLES,
            last_activity__gte=cutoff,
        )
        .exclude(pk=request.user.pk)
        .order_by('-last_activity')
        .values('id', 'full_name', 'role', 'last_activity')
    )

    now = timezone.now()
    result = []
    for u in personnel:
        delta = now - u['last_activity']
        if delta <= timedelta(minutes=2):
            status = 'online'
        else:
            status = 'idle'
        result.append({
            'id':            u['id'],
            'full_name':     u['full_name'],
            'role':          u['role'],
            'last_activity': u['last_activity'].isoformat(),
            'status':        status,
        })

    return JsonResponse({'users': result})

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
        role = request.query_params.get('role')
        qs = User.objects.filter(role=role)
        
        class UnassignedUserSerializer(serializers.ModelSerializer):
            current_barangay = serializers.SerializerMethodField()
            
            def get_current_barangay(self, obj):
                return obj.barangay.name if obj.barangay else None

            class Meta:
                model = User
                fields = ['id', 'full_name', 'email', 'current_barangay']
                
        serializer = UnassignedUserSerializer(qs, many=True)
        return Response(serializer.data)

