"""
accounts/permissions.py
-----------------------
Single source of truth for "is this user an app-level admin?".

WasteWatch authorises by the custom `User.role` field, not by Django's
`is_staff`. Admins created through the UserManagement screen get
role='admin' but is_staff=False, so DRF's built-in IsAdminUser would reject
them. Use these helpers everywhere instead (permissions AND querysets), so
the two can never disagree.
"""

from rest_framework import permissions

from .models import UserRole


def is_admin_user(user):
    """True for role='admin' users, and for Django staff accounts."""
    if not user or not user.is_authenticated:
        return False
    return getattr(user, 'role', None) == UserRole.ADMIN or bool(getattr(user, 'is_staff', False))


class IsAdminRole(permissions.BasePermission):
    """Admin only, for every HTTP method."""

    def has_permission(self, request, view):
        return is_admin_user(request.user)


class IsAdminRoleOrReadOnly(permissions.BasePermission):
    """Anyone may read; only admins may write."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return is_admin_user(request.user)
