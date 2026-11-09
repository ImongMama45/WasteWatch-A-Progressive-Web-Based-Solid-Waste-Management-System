from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CommunityPostViewSet, PostCommentViewSet, PostReportViewSet

router = DefaultRouter()
router.register(r'posts', CommunityPostViewSet, basename='community-posts')
router.register(r'comments', PostCommentViewSet, basename='community-comments')
router.register(r'reports', PostReportViewSet, basename='community-reports')

urlpatterns = [
    path('', include(router.urls)),
]
