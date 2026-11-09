"""
wastewatch/api_urls.py
-----------------------
All /api/* routes.
Public endpoints are at /api/public/* — no auth required.
"""

from django.urls import path, include

from rest_framework.routers import DefaultRouter

from accounts import api_views as auth_api
from accounts import auth_flow_views as auth_flow
from . import public_api
import driver.urls as driver_urls
import watcher.urls as watcher_urls
import news.urls as news_urls
import analytics.urls as analytics_urls

router = DefaultRouter()
router.register(r'users',     auth_api.UserViewSet,     basename='api-users')
router.register(r'barangays', auth_api.BarangayViewSet, basename='api-barangays')
router.register(r'barangay-management', auth_api.BarangayManagementViewSet, basename='api-barangay-management')

top_router = DefaultRouter()
top_router.register(r'escalations', watcher_urls.views.EscalationViewSet, basename='api-escalations')

urlpatterns = [
    # ── Public (no auth) ─────────────────────────────────────────────────────
    path('public/announcements/', public_api.announcements_view,  name='api-announcements'),
    path('public/stats/',         public_api.public_stats_view,   name='api-public-stats'),
    path('public/schedule/',      public_api.public_schedule_view, name='api-public-schedule'),
    path('public/live/',          public_api.public_live_view,     name='api-public-live'),

    # ── Auth (Manual) ────────────────────────────────────────────────────────
    path('auth/me/',                  auth_api.me_view,                      name='api-me'),
    path('auth/login/',               auth_api.api_login_view,               name='api-login'),
    path('auth/logout/',              auth_api.api_logout_view,              name='api-logout'),
    path('auth/register/',            auth_api.api_register_view,            name='api-register'),
    path('auth/csrf/',                auth_api.get_csrf_token_view,          name='api-csrf'),
    path('auth/barangays/',           auth_api.barangay_list_view,           name='api-auth-barangays'),
    path('auth/verify-email/',        auth_flow.verify_email_view,           name='api-verify-email'),
    path('auth/resend-verification/', auth_flow.resend_verification_view,    name='api-resend-verification'),
    path('auth/forgot-password/',     auth_flow.forgot_password_view,        name='api-forgot-password'),
    path('auth/reset-password/',      auth_flow.reset_password_view,         name='api-reset-password'),
    
    # ── CRUD Resources ────────────────────────────────────────────────────────
    path('barangays/', auth_api.BarangayViewSet.as_view({'get': 'list'}), name='api-barangays-legacy'),
    
    # New paths for simplified report management
    path('reports/public/', watcher_urls.views.GarbageReportViewSet.as_view({'get': 'public'}), name='api-reports-public'),
    path('reports/<int:pk>/approve/', watcher_urls.views.GarbageReportViewSet.as_view({'post': 'approve', 'patch': 'approve'}), name='api-report-approve'),
    path('reports/<int:pk>/reject/', watcher_urls.views.GarbageReportViewSet.as_view({'post': 'reject', 'patch': 'reject'}), name='api-report-reject'),
    path('barangay/reports/', watcher_urls.views.GarbageReportViewSet.as_view({'get': 'list'}), name='api-barangay-reports'),

    path('accounts/heartbeat/', auth_api.heartbeat_view, name='api-accounts-heartbeat'),
    path('accounts/online/',    auth_api.online_users_view, name='api-accounts-online'),
    path('accounts/',  include(router.urls)),
    path('driver/',    include(driver_urls.router.urls)),
    path('watcher/',   include(watcher_urls.urlpatterns)),
    path('news/',      include(news_urls.urlpatterns)),
    path('analytics/', include(analytics_urls.urlpatterns)),
    path('community/', include('community.urls')),
    path('events/',    include('events.urls')),
    path('calendar/',  include('calendar_service.urls')),
    path('',           include(top_router.urls)),
]
