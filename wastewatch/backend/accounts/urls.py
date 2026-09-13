from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import api_views

router = DefaultRouter()
router.register(r'users', api_views.UserViewSet, basename='user')
router.register(r'barangay-management', api_views.BarangayManagementViewSet, basename='barangay-management')

urlpatterns = [
    path('', include(router.urls)),       # ← ViewSet: GET list, POST create, PATCH, DELETE
    path('register/',  api_views.api_register_view,  name='auth-register'),
    path('login/',     api_views.api_login_view,      name='auth-login'),
    path('logout/',    api_views.api_logout_view,     name='auth-logout'),
    path('me/',        api_views.me_view,             name='auth-me'),
    path('barangays/', api_views.barangay_list_view,  name='auth-barangays'),
    path('heartbeat/', api_views.heartbeat_view,      name='heartbeat'),
    path('online/',    api_views.online_users_view,   name='online-users'),
]