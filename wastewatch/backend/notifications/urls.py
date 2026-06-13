from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'', views.NotificationViewSet, basename='notification')

urlpatterns = [
    path('unread/', views.notification_unread,    name='notification-unread'),
    path('read/',   views.notification_mark_read, name='notification-mark-read'),
    path('',        include(router.urls)),
]