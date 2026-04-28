"""
WasteWatch — Root URL Configuration
------------------------------------
All app routes are registered here. Each app has its own urls.py
so that new modules (driver, admin_panel, etc.) can be plugged in easily.
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import RedirectView

urlpatterns = [
    # Root — show login page
    path('', RedirectView.as_view(url='/accounts/login/', permanent=False), name='home'),

    # Shortcuts — so /dashboard, /login, /register work without the app prefix
    path('dashboard/', RedirectView.as_view(url='/watcher/dashboard/', permanent=False)),
    path('login/',     RedirectView.as_view(url='/accounts/login/',    permanent=False)),
    path('register/',  RedirectView.as_view(url='/accounts/register/', permanent=False)),
    path('home/',      RedirectView.as_view(url='/watcher/dashboard/', permanent=False)),
    path('home/dashboard/', RedirectView.as_view(url='/watcher/dashboard/', permanent=False)),

    # Django built-in admin (useful for superusers / debugging)
    path('admin/', admin.site.urls),

    # Accounts: login, register, logout
    path('accounts/', include('accounts.urls')),

    # Watcher module: dashboard, reports, collection confirm
    path('watcher/', include('watcher.urls')),

    # JSON API — consumed by the React Vite frontend
    path('api/', include('wastewatch.api_urls')),

    # -----------------------------------------------------------------------
    # Future modules — uncomment and create their urls.py when ready:
    # path('driver/',    include('driver.urls')),
    # path('barangay/',  include('barangay_official.urls')),
    # -----------------------------------------------------------------------
]

# Serve uploaded media files during development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
