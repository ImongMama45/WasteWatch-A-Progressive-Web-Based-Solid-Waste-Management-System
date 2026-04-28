"""
accounts/urls.py
----------------
URL patterns for authentication routes.
"""

from django.urls import path
from django.views.generic import RedirectView
from . import views

app_name = 'accounts'

urlpatterns = [
    path('',          RedirectView.as_view(url='/accounts/login/', permanent=False)),
    path('login/',    views.login_view,    name='login'),
    path('register/', views.register_view, name='register'),
    path('logout/',   views.logout_view,   name='logout'),
]
