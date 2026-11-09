"""
wastewatch/pagination.py
-------------------------
Standardized pagination for WasteWatch API datasets.
Slices data in the backend database (SQL LIMIT/OFFSET) with a default
page size of 10 items, returning pagination metadata (count, total_pages,
current_page, page_size, next, previous, and results).

Supports unpaginated requests when explicit `paginate=false` or `all=true`
is passed by internal callers (e.g. map pins, dropdown menus, schedule builders).
"""

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 100

    def paginate_queryset(self, queryset, request, view=None):
        # Support unpaginated access only for explicitly authorized views or authenticated sessions
        if request.query_params.get('paginate') == 'false' or request.query_params.get('all') == 'true':
            if self.is_unpaginated_allowed(request, view):
                return None
        return super().paginate_queryset(queryset, request, view=view)

    def is_unpaginated_allowed(self, request, view=None):
        """
        Permit unpaginated retrieval (?paginate=false / ?all=true) ONLY for explicitly
        identified views/actions that have a documented, legitimate need for it.

        Global authentication alone does NOT permit unpaginated access.
        The general GarbageReport list endpoint and public feeds cannot be bypassed
        by ordinary citizens, watchers, or barangay officials simply because they are logged in.
        """
        if not view:
            return False

        # 1. Explicit view-level opt-in for fixed-size/reference datasets (e.g. collection schedules)
        if getattr(view, 'allow_unpaginated', False):
            return True

        # 2. Action-level explicit opt-in for dedicated, scoped endpoints (e.g. 'mine' for personal map markers)
        action = getattr(view, 'action', None)
        unpaginated_actions = getattr(view, 'unpaginated_actions', None)
        if unpaginated_actions and action in unpaginated_actions:
            # Scoped action requires an authenticated session
            user = getattr(request, 'user', None)
            if user and user.is_authenticated:
                return True

        return False

    def get_paginated_response(self, data):
        count = self.page.paginator.count
        total_pages = self.page.paginator.num_pages
        current_page = self.page.number
        page_size = self.get_page_size(self.request)

        response_dict = {
            'count': count,
            'total_pages': total_pages,
            'current_page': current_page,
            'page_size': page_size,
            'next': self.get_next_link(),
            'previous': self.get_previous_link(),
            'results': data
        }

        # If the view attached extra summary data (e.g. status counts for badges)
        if hasattr(self, 'extra_data') and self.extra_data:
            response_dict.update(self.extra_data)

        return Response(response_dict)
