"""
accounts/urls.py
----------------
URL patterns for authentication routes.
"""

from django.urls import path
from . import views

app_name = 'accounts'   # Namespace — use as accounts:login, accounts:register

urlpatterns = [
    path('login/',    views.login_view,    name='login'),
    path('register/', views.register_view, name='register'),
    path('logout/',   views.logout_view,   name='logout'),
]
