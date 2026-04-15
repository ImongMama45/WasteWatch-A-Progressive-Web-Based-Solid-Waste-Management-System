"""
wastewatch/api_urls.py
-----------------------
All /api/* routes in one place.
Mounted at /api/ in wastewatch/urls.py.

Adding a new module later is as simple as:
  from driver import api_views as driver_api
  path('driver/routes/', driver_api.routes_view, name='driver-routes'),
"""

from django.urls import path

from accounts import api_views as auth_api
from watcher  import api_views as watcher_api

urlpatterns = [
    # ── Auth ─────────────────────────────────────────────────────────────────
    path('auth/me/',       auth_api.me_view,           name='api-me'),
    path('auth/login/',    auth_api.api_login_view,    name='api-login'),
    path('auth/logout/',   auth_api.api_logout_view,   name='api-logout'),
    path('auth/register/', auth_api.api_register_view, name='api-register'),

    # ── Barangays (shared lookup) ─────────────────────────────────────────────
    path('barangays/',     auth_api.barangay_list_view, name='api-barangays'),

    # ── Watcher ───────────────────────────────────────────────────────────────
    path('watcher/reports/',          watcher_api.reports_view,          name='api-reports'),
    path('watcher/reports/<int:report_id>/', watcher_api.report_detail_view, name='api-report-detail'),
    path('watcher/stats/',            watcher_api.stats_view,            name='api-stats'),
    path('watcher/confirm/',          watcher_api.confirm_collection_view, name='api-confirm'),

    # ── Future modules (add when ready) ──────────────────────────────────────
    # path('driver/routes/',  driver_api.routes_view),
    # path('admin/users/',    admin_api.users_view),
]
