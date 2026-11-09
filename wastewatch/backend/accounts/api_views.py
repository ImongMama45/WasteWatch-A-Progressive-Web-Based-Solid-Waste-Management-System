
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

from rest_framework import viewsets, permissions, serializers, status
from .models import User, Barangay, UserRole
from rest_framework.response import Response
from wastewatch.pagination import StandardResultsSetPagination
from .serializers import UserSerializer, BarangaySerializer, RegisterSerializer, AdminUserSerializer
from .permissions import IsAdminRole, IsAdminRoleOrReadOnly, is_admin_user
from .emails import send_verification_email


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related('barangay', 'dumpsite', 'driverprofile').prefetch_related('suspension_overrides').order_by('-id')
    pagination_class = StandardResultsSetPagination
    # Admin only for EVERY method. Writes use AdminUserSerializer (role + password
    # writable), and list/retrieve expose every user's email, so a plain
    # IsAuthenticated check let any citizen PATCH themselves to role='admin'.
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]
    # Admin-only endpoint: allow ?paginate=false so assignment dropdowns
    # (drivers / crew in Truck & Route management) receive the full user list
    # instead of only the first page.
    allow_unpaginated = True

    def get_serializer_class(self):
        # Admin writes use the full serializer (password + role writable)
        if self.action in ('create', 'update', 'partial_update'):
            return AdminUserSerializer
        return UserSerializer

    def get_queryset(self):
        queryset = self.queryset.all()
        role = self.request.query_params.get('role')
        if role and role.lower() != 'all':
            if role.lower() == 'crew':
                queryset = queryset.filter(employee_type='crew_member')
            else:
                queryset = queryset.filter(role=role)

        status_param = self.request.query_params.get('status')
        if status_param and status_param.lower() != 'all':
            if status_param.lower() == 'active':
                queryset = queryset.filter(is_active=True)
            elif status_param.lower() == 'inactive':
                queryset = queryset.filter(is_active=False)

        search_query = self.request.query_params.get('search', '').strip()
        if search_query:
            search_filter = (
                Q(full_name__icontains=search_query) |
                Q(username__icontains=search_query) |
                Q(email__icontains=search_query) |
                Q(barangay__name__icontains=search_query) |
                Q(dumpsite__name__icontains=search_query)
            )
            if search_query.isdigit():
                search_filter |= Q(id=int(search_query))
            queryset = queryset.filter(search_filter)

        return queryset

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        if getattr(self, 'paginator', None) is not None:
            base_qs = self.queryset.all()
            summary_agg = base_qs.aggregate(
                all=Count('id'),
                active=Count('id', filter=Q(is_active=True)),
                inactive=Count('id', filter=Q(is_active=False)),
                driver=Count('id', filter=Q(role='driver')),
                watcher=Count('id', filter=Q(role='watcher')),
                brgy_official=Count('id', filter=Q(role='brgy_official')),
                citizen=Count('id', filter=Q(role='citizen')),
                dumpsite=Count('id', filter=Q(role='dumpsite')),
                crew=Count('id', filter=Q(employee_type='crew_member')),
            )
            self.paginator.extra_data = {'summary': summary_agg}

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.role == 'admin':
            return Response(
                {'error': 'Administrator accounts cannot be edited through User Management.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.id == request.user.id and 'is_active' in request.data and not request.data['is_active']:
            return Response(
                {'error': 'You cannot deactivate your own administrator account.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if instance.role == 'admin':
            if 'is_active' in request.data and not request.data['is_active']:
                return Response(
                    {'error': 'Administrator accounts cannot be deactivated.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if 'role' in request.data and request.data['role'] != 'admin':
                return Response(
                    {'error': 'Administrator role cannot be changed through User Management.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if instance.id == request.user.id and any(k in request.data for k in ('email', 'username', 'role')):
                return Response(
                    {'error': 'Your administrator credentials should be updated in Profile settings.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.id == request.user.id:
            return Response(
                {'error': 'You cannot delete your own account.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if instance.role == 'admin':
            return Response(
                {'error': 'Administrator accounts cannot be deleted through User Management.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['patch'], url_path='lift_suspension')
    def lift_suspension(self, request, pk=None):
        if not is_admin_user(request.user):
            return Response({'error': 'Only admins can lift suspensions.'}, status=status.HTTP_403_FORBIDDEN)
            
        driver = self.get_object()
        
        if driver.role != 'driver':
            return Response({'error': 'User is not a driver.'}, status=status.HTTP_400_BAD_REQUEST)
            
        if not hasattr(driver, 'driverprofile') or not driver.driverprofile.is_suspended:
            return Response({'error': 'Driver is not currently suspended.'}, status=status.HTTP_400_BAD_REQUEST)
            
        reason = request.data.get('reason', '').strip()
        if not reason:
            return Response({'error': 'A reason is required to lift a suspension manually.'}, status=status.HTTP_400_BAD_REQUEST)
            
        from .models import SuspensionOverride
        
        profile = driver.driverprofile
        profile.is_suspended = False
        profile.save(update_fields=['is_suspended'])
        
        SuspensionOverride.objects.create(
            driver=driver,
            admin=request.user,
            reason=reason
        )
        
        return Response({'status': 'suspension_lifted'})

class BarangayViewSet(viewsets.ModelViewSet):
    queryset = Barangay.objects.all()
    serializer_class = BarangaySerializer
    permission_classes = [IsAdminRoleOrReadOnly]


# ── Helper: serialize a User to a safe dict ──────────────────────────────────
def user_to_dict(user):
    """
    Helper to convert a User model instance into a JSON-serializable dict.
    Used by /api/auth/me/ and admin user list.
    """
    data = {
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
        'phone_number':  user.phone_number or '',
        'address_line':  user.address_line or '',
        'email_verified': user.email_verified,
        'email_verified_at': user.email_verified_at.isoformat() if user.email_verified_at else None,
        'is_active':     user.is_active,
        'is_staff':      bool(user.is_staff),
        'profile_pic':   user.profile_pic.url if user.profile_pic else None,
        'created_at':    user.created_at.isoformat() if user.created_at else None,
    }
    
    if user.role == 'driver':
        if hasattr(user, 'driverprofile'):
            data['points'] = user.driverprofile.points
            data['is_suspended'] = user.driverprofile.is_suspended
        else:
            data['points'] = 0
            data['is_suspended'] = False
            
        overrides = user.suspension_overrides.all().order_by('-created_at')
        data['suspension_overrides'] = [
            {
                "id": o.id,
                "reason": o.reason,
                "admin_name": o.admin.full_name if o.admin else "System",
                "created_at": o.created_at.isoformat()
            }
            for o in overrides
        ]
            
    return data


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
        for field in ('full_name', 'first_name', 'last_name', 'username', 'barangay', 'profile_pic', 'phone_number', 'address_line'):
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
    if request.user.is_authenticated:
        return JsonResponse({
            'error': 'You are already signed in. Please log out first before signing into another account.',
            'code': 'already_authenticated',
            'user': user_to_dict(request.user)
        }, status=400)

    data = _json_body(request)
    if data is None:
        return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    user = authenticate(request, username=email, password=password)
    if user is None:
        return JsonResponse({'error': 'Invalid email or password.'}, status=400)

    # Email verification check (applies only to citizen accounts)
    if user.role == UserRole.CITIZEN and not user.email_verified and not user.is_staff and not user.is_superuser:
        return JsonResponse({
            'error': 'Please verify your email address before signing in. Check your inbox for the activation link.',
            'code': 'email_not_verified',
            'email': user.email
        }, status=403)

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
    if request.user.is_authenticated:
        return JsonResponse({
            'error': 'You are already signed in. Please log out before creating a new account.',
            'code': 'already_authenticated'
        }, status=400)

    data = request.data
    if not data:
        return JsonResponse({'error': 'Invalid payload.'}, status=400)

    serializer = RegisterSerializer(data=data)
    if serializer.is_valid():
        user = serializer.save()
        # Dispatch verification email asynchronously / via email backend
        send_verification_email(user)
        return JsonResponse({
            'message': 'Account created! Please check your email to verify your account.',
            'verification_required': True,
            'email': user.email,
            'user': user_to_dict(user)
        }, status=201)

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
    users = User.objects.select_related('barangay', 'dumpsite', 'driverprofile').prefetch_related('suspension_overrides')
    if role_filter:
        users = users.filter(role=role_filter)
    
    data = [user_to_dict(u) for u in users]
    return JsonResponse(data, safe=False)

from django.utils import timezone
from datetime import timedelta
from django.http import HttpResponse
from django.views.decorators.http import require_POST
PERSONNEL_ROLES = ('watcher', 'brgy_official', 'driver')

@csrf_exempt
@require_POST
def heartbeat_view(request):
    user = request.user
    if not user or not user.is_authenticated:
        return HttpResponse(status=401)
    if getattr(user, 'role', None) not in PERSONNEL_ROLES:
        return HttpResponse(status=204)
    from django.contrib.auth import get_user_model
    User = get_user_model()
    User.objects.filter(pk=user.pk).update(
        last_activity=timezone.now()
    )
    return HttpResponse(status=204)

def online_users_view(request):
    user = request.user
    if not user or not user.is_authenticated:
        return JsonResponse({'error': 'Authentication required'}, status=401)
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
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        if self.action == 'list':
            qs = Barangay.objects.annotate(
                official_count=Count('residents', filter=Q(residents__role='brgy_official'), distinct=True),
                watcher_count=Count('residents', filter=Q(residents__role='watcher'), distinct=True),
                driver_count=Count('residents', filter=Q(residents__role='driver'), distinct=True),
                pending_concerns=Count(
                    'reports', filter=Q(reports__status='PENDING'), distinct=True
                ),
                active_hotspots=Count(
                    'hotspots', filter=Q(hotspots__is_active=True), distinct=True
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
            search_query = self.request.query_params.get('search', '').strip()
            if search_query:
                qs = qs.filter(name__icontains=search_query)
            return qs.order_by('name')
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
        if role not in UserRole.values:
            return Response({"error": "Invalid role."}, status=status.HTTP_400_BAD_REQUEST)
            
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

