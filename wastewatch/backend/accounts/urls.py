"""
accounts/urls.py
----------------
Template-based URL routes have been removed.

Authentication is handled exclusively through the JSON API:
  POST /api/auth/login/
  POST /api/auth/register/
  POST /api/auth/logout/
  GET  /api/auth/me/

See wastewatch/api_urls.py for all active routes.
"""

from django.urls import path
<<<<<<< HEAD
from django.views.generic import RedirectView
from . import views
=======
>>>>>>> 15a149d (Added UI for Admin Feature, Changes the home page)

app_name = 'accounts'

urlpatterns = [
<<<<<<< HEAD
    path('',          RedirectView.as_view(url='/accounts/login/', permanent=False)),
    path('login/',    views.login_view,    name='login'),
    path('register/', views.register_view, name='register'),
    path('logout/',   views.logout_view,   name='logout'),
=======
    # No template-based routes. All auth goes through /api/auth/*.
>>>>>>> 15a149d (Added UI for Admin Feature, Changes the home page)
]
