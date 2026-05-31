"""
accounts/urls.py
----------------
Mount this file with:

    # config/urls.py  (or your root urls.py)
    path('api/auth/', include('accounts.urls')),
"""

from django.urls import path
from . import api_views

urlpatterns = [
    path('register/',   api_views.api_register_view,  name='auth-register'),
    path('login/',      api_views.api_login_view,     name='auth-login'),
    path('logout/',     api_views.api_logout_view,    name='auth-logout'),
    path('me/',         api_views.me_view,            name='auth-me'),
    path('barangays/',  api_views.barangay_list_view, name='auth-barangays'),
]
