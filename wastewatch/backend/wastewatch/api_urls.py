"""
wastewatch/api_urls.py
-----------------------
All /api/* routes.
Public endpoints are at /api/public/* — no auth required.
"""

from django.urls import path, include

from accounts import api_views as auth_api
from watcher  import api_views as watcher_api
from . import public_api
import driver.urls as driver_urls

urlpatterns = [
    # ── Public (no auth) ─────────────────────────────────────────────────────
    path('public/announcements/', public_api.announcements_view,  name='api-announcements'),
    path('public/stats/',         public_api.public_stats_view,   name='api-public-stats'),
    path('public/schedule/',      public_api.public_schedule_view, name='api-public-schedule'),

    # ── Auth ──────────────────────────────────────────────────────────────────
    path('auth/me/',       auth_api.me_view,           name='api-me'),
    path('auth/login/',    auth_api.api_login_view,    name='api-login'),
    path('auth/logout/',   auth_api.api_logout_view,   name='api-logout'),
    path('auth/register/', auth_api.api_register_view, name='api-register'),

    # ── Barangays ─────────────────────────────────────────────────────────────
    path('barangays/',     auth_api.barangay_list_view, name='api-barangays'),

    # ── Watcher ───────────────────────────────────────────────────────────────
    path('watcher/reports/',                    watcher_api.reports_view,          name='api-reports'),
    path('watcher/reports/<int:report_id>/',    watcher_api.report_detail_view,    name='api-report-detail'),
    path('watcher/stats/',                      watcher_api.stats_view,            name='api-stats'),
    path('driver/', include(driver_urls.router.urls), name='api-driver'),
    path('watcher/confirm/',                    watcher_api.confirm_collection_view, name='api-confirm'),
]
