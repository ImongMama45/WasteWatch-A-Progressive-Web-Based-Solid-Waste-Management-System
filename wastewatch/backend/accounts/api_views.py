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

from rest_framework import viewsets, permissions
from .models import User, Barangay
from .serializers import UserSerializer, BarangaySerializer, RegisterSerializer, AdminUserSerializer


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related('barangay', 'dumpsite').all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        # Admin writes use the full serializer (password + role writable)
        if self.action in ('create', 'update', 'partial_update'):
            return AdminUserSerializer
        return UserSerializer

    def get_queryset(self):
        role = self.request.query_params.get('role')
        if role:
            return self.queryset.filter(role=role)
        return self.queryset

class BarangayViewSet(viewsets.ModelViewSet):
    queryset = Barangay.objects.all()
    serializer_class = BarangaySerializer
    permission_classes = [permissions.AllowAny]


# ── Helper: serialize a User to a safe dict ──────────────────────────────────
def user_to_dict(user):
    return {
        'id':            user.id,
        'full_name':     user.full_name,
        'email':         user.email,
        'role':          user.role,
        'employee_type': user.employee_type,
        'barangay_id':   user.barangay_id,
        'barangay_name': user.barangay.name if user.barangay else None,
        'dumpsite_id':   user.dumpsite_id,
        'dumpsite_name': user.dumpsite.name if user.dumpsite else None,
    }


def _json_body(request):
    try:
        return json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return None


# ── GET  /api/auth/me/ ────────────────────────────────────────────────────────
@ensure_csrf_cookie   # Sets the csrftoken cookie so React can read it
@require_http_methods(['GET', 'PATCH'])
def me_view(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Not authenticated'}, status=401)

    if request.method == 'PATCH':
        data = _json_body(request)
        if data is None:
            return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

        allowed = {
            field: data[field]
            for field in ('full_name', 'barangay')
            if field in data
        }
        serializer = UserSerializer(request.user, data=allowed, partial=True)
        if not serializer.is_valid():
            return JsonResponse(serializer.errors, status=400)

        serializer.save()
        return JsonResponse(user_to_dict(request.user))

    return JsonResponse(user_to_dict(request.user))


# ── POST /api/auth/login/ ─────────────────────────────────────────────────────
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
@require_http_methods(['POST'])
def api_logout_view(request):
    logout(request)
    return JsonResponse({'message': 'Logged out.'})


# ── POST /api/auth/register/ ─────────────────────────────────────────────────
@require_http_methods(['POST'])
def api_register_view(request):
    data = _json_body(request)
    if data is None:
        return JsonResponse({'error': 'Invalid JSON payload.'}, status=400)

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
