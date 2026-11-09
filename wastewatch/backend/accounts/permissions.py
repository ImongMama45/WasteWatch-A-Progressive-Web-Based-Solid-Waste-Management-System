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


def is_viewer_authorized_for_report(user, report):
    """
    Returns True if the viewer is authorized to see the reporter's personal identity.
    Authorized viewers:
      1. Report owner (report.user == user)
      2. Administrators (is_admin_user(user))
      3. Barangay Officials assigned to the report's barangay (user.barangay == report.barangay)
    """
    if not user or not user.is_authenticated or not report:
        return False
    if is_admin_user(user):
        return True
    report_user_id = getattr(report, 'user_id', None)
    if report_user_id and user.id == report_user_id:
        return True
    if getattr(user, 'role', None) == UserRole.BRGY_OFFICIAL:
        user_brgy_id = getattr(user, 'barangay_id', None)
        report_brgy_id = getattr(report, 'barangay_id', None)
        if user_brgy_id and report_brgy_id and user_brgy_id == report_brgy_id:
            return True
    return False


def can_moderate_report(user, report):
    """
    Checks if a user is authorized to moderate (approve, reject, reopen, archive) a report.
    Rules:
      1. Administrators can moderate any report (including barangay-less reports).
      2. Barangay Officials must have a non-null barangay assignment and may ONLY moderate
         reports belonging to that same non-null barangay.
      3. Barangay-less reports (report.barangay_id is None) can ONLY be moderated by Admins.
      4. Other roles (citizens, watchers, drivers) cannot moderate reports.
    """
    if not user or not user.is_authenticated or not report:
        return False
    if is_admin_user(user):
        return True
    if getattr(user, 'role', None) == UserRole.BRGY_OFFICIAL:
        user_brgy_id = getattr(user, 'barangay_id', None)
        report_brgy_id = getattr(report, 'barangay_id', None)
        if user_brgy_id is None or report_brgy_id is None:
            return False
        return user_brgy_id == report_brgy_id
    return False


def can_vote_on_report(user, report):
    """
    Checks if a user is authorized to cast or change a civic verification vote on a report.
    Rules:
      1. User must be authenticated.
      2. User's role must be an eligible voter: citizen, watcher, or brgy_official.
         (Drivers and Admins cannot vote).
      3. User must have an assigned barangay (user.barangay_id is not None).
      4. Report must have an assigned barangay (report.barangay_id is not None).
      5. User's assigned barangay must match the report's barangay (user.barangay_id == report.barangay_id).
         (Cross-barangay voting is strictly prohibited; no citywide voting exceptions).
    """
    if not user or not user.is_authenticated or not report:
        return False
    user_role = getattr(user, 'role', None)
    if user_role not in [UserRole.CITIZEN, UserRole.WATCHER, UserRole.BRGY_OFFICIAL]:
        return False
    user_brgy_id = getattr(user, 'barangay_id', None)
    report_brgy_id = getattr(report, 'barangay_id', None)
    if user_brgy_id is None or report_brgy_id is None:
        return False
    return user_brgy_id == report_brgy_id
