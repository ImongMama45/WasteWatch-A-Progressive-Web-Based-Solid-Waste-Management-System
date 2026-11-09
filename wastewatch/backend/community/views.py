from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from django.db.models import Count, Q, Subquery, OuterRef, IntegerField
from django.db.models.functions import Coalesce
from django.db import transaction
from django.shortcuts import get_object_or_404

from django.contrib.auth import get_user_model
from accounts.permissions import is_admin_user, IsAdminRole
from .models import CommunityPost, PostLike, PostComment, PostReport

User = get_user_model()
from .serializers import (
    CommunityPostSerializer,
    PostCommentSerializer,
    PostReportSerializer,
)


class CommunityPagination(PageNumberPagination):
    page_size = 15
    page_size_query_param = 'page_size'
    max_page_size = 50


class CommunityOrderingFilter(filters.OrderingFilter):
    """
    Custom ordering filter supporting aliases 'likes_count' / '-likes_count'
    mapped to 'annotated_like_count' with a deterministic '-id' tie-breaker,
    avoiding mutation of internal request query dictionaries.
    """
    ordering_fields = ['created_at', 'annotated_like_count', 'likes_count']

    def get_ordering(self, request, queryset, view):
        params = request.query_params.get(self.ordering_param)
        if params:
            fields = [param.strip() for param in params.split(',')]
            ordering = []
            for field in fields:
                reverse = field.startswith('-')
                clean_field = field.lstrip('-')
                if clean_field == 'likes_count':
                    clean_field = 'annotated_like_count'
                target = f"-{clean_field}" if reverse else clean_field
                if clean_field in ['created_at', 'annotated_like_count']:
                    ordering.append(target)
            if ordering:
                if '-id' not in ordering and 'id' not in ordering:
                    ordering.append('-id')
                return ordering
        return ['-created_at', '-id']


class CommunityPostViewSet(viewsets.ModelViewSet):
    """
    CRUD and interactions for community posts.
    - Public read-only for active/non-hidden posts.
    - Authenticated users can create, like, comment, and report.
    - Authors can edit or delete their own posts.
    - Admins can hide/unhide or delete any post.
    """
    serializer_class = CommunityPostSerializer
    pagination_class = CommunityPagination
    filter_backends = [CommunityOrderingFilter]
    ordering_fields = ['created_at', 'annotated_like_count', 'likes_count']

    def get_permissions(self):
        if self.action in ['create', 'like', 'report', 'add_comment']:
            return [permissions.IsAuthenticated()]
        if self.action in ['moderate']:
            return [permissions.IsAuthenticated(), IsAdminRole()]
        return [permissions.IsAuthenticatedOrReadOnly()]

    def get_queryset(self):
        user = self.request.user
        qs = CommunityPost.objects.select_related('author', 'author__barangay', 'barangay', 'report', 'report__barangay')

        # Correlated subqueries avoid join multiplication cross products (likes x comments)
        likes_sub = PostLike.objects.filter(post=OuterRef('pk')).values('post').annotate(c=Count('id')).values('c')
        comments_sub = PostComment.objects.filter(post=OuterRef('pk'), is_hidden=False).values('post').annotate(c=Count('id')).values('c')
        qs = qs.annotate(
            annotated_like_count=Coalesce(Subquery(likes_sub, output_field=IntegerField()), 0),
            annotated_comment_count=Coalesce(Subquery(comments_sub, output_field=IntegerField()), 0),
        )

        # Hidden posts are excluded from ordinary public retrieval and feeds.
        # Only administrators explicitly passing ?include_hidden=true can view hidden posts.
        include_hidden = is_admin_user(user) and self.request.query_params.get('include_hidden') == 'true'
        if not include_hidden:
            qs = qs.filter(is_hidden=False)

        # Enforce authoritative GarbageReport visibility rules on report-linked posts:
        # Base discussions (report__isnull=True) are unaffected.
        if not include_hidden:
            if not user.is_authenticated:
                # Anonymous visitors: only approved/resolved reports (never pending, archived, or rejected)
                qs = qs.filter(
                    Q(report__isnull=True) |
                    (Q(report__isnull=False) & Q(report__is_archived=False) & Q(report__status__in=['approved', 'resolved']))
                )
            elif is_admin_user(user):
                # Administrators without include_hidden: pending, approved, resolved (unarchived, non-rejected)
                qs = qs.filter(
                    Q(report__isnull=True) |
                    (Q(report__isnull=False) & Q(report__is_archived=False) & Q(report__status__in=['pending', 'approved', 'resolved']))
                )
            elif getattr(user, 'role', None) == 'brgy_official' and getattr(user, 'barangay', None):
                # Authorized Barangay Officials: visible within scope (their barangay) or public approved/resolved or own report
                qs = qs.filter(
                    Q(report__isnull=True) |
                    (
                        Q(report__isnull=False) &
                        Q(report__is_archived=False) &
                        (
                            Q(report__status__in=['approved', 'resolved']) |
                            (Q(report__status='pending') & (Q(report__barangay=user.barangay) | Q(report__user=user)))
                        )
                    )
                )
            else:
                # Authenticated citizens / watchers / drivers:
                # - Approved or resolved reports are publicly visible
                # - Pending reports are visible ONLY to the report owner (report__user=user, never author=user)
                # - Archived or rejected reports remain hidden from feeds
                qs = qs.filter(
                    Q(report__isnull=True) |
                    (
                        Q(report__isnull=False) &
                        Q(report__is_archived=False) &
                        (
                            Q(report__status__in=['approved', 'resolved']) |
                            (Q(report__status='pending') & Q(report__user=user))
                        )
                    )
                )

        # Optional filter by barangay
        barangay_id = self.request.query_params.get('barangay_id')
        if barangay_id and barangay_id.isdigit():
            qs = qs.filter(barangay_id=int(barangay_id))

        # Optional filter by post_type ('discussion' or 'report')
        post_type = self.request.query_params.get('post_type')
        if post_type in ['discussion', 'report']:
            qs = qs.filter(post_type=post_type)

        # Optional filter by category
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)

        # Optional filter by report_id
        report_id = self.request.query_params.get('report_id')
        if report_id and str(report_id).isdigit():
            qs = qs.filter(report_id=int(report_id))

        return qs.order_by('-created_at')

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        posts = page if page is not None else queryset

        # Batch-fetch liked post IDs for the authenticated user to avoid N+1 queries
        if request.user.is_authenticated:
            post_ids = [p.id for p in posts]
            user_liked_ids = set(
                PostLike.objects.filter(
                    user=request.user,
                    post_id__in=post_ids
                ).values_list('post_id', flat=True)
            )
            for p in posts:
                p._user_liked_ids = user_liked_ids

        # Batch-fetch ReportVote aggregations for all report-linked posts on this page
        report_ids = [p.report_id for p in posts if p.report_id is not None]
        if report_ids:
            from watcher.models import ReportVote
            up_map = dict(
                ReportVote.objects.filter(report_id__in=report_ids, vote_type=1)
                .values('report_id')
                .annotate(c=Count('id'))
                .values_list('report_id', 'c')
            )
            down_map = dict(
                ReportVote.objects.filter(report_id__in=report_ids, vote_type=-1)
                .values('report_id')
                .annotate(c=Count('id'))
                .values_list('report_id', 'c')
            )
            user_votes = {}
            if request.user.is_authenticated:
                user_votes = dict(
                    ReportVote.objects.filter(report_id__in=report_ids, user=request.user)
                    .values_list('report_id', 'vote_type')
                )
            for p in posts:
                if p.report:
                    p.report.annotated_upvotes = up_map.get(p.report_id, 0)
                    p.report.annotated_downvotes = down_map.get(p.report_id, 0)
                    if request.user.is_authenticated:
                        p.report._user_vote = user_votes.get(p.report_id, None)

        serializer = self.get_serializer(posts, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.user.is_authenticated:
            instance._user_liked_ids = set(
                PostLike.objects.filter(
                    user=request.user,
                    post=instance
                ).values_list('post_id', flat=True)
            )
        if instance.report_id is not None and instance.report:
            from watcher.models import ReportVote
            instance.report.annotated_upvotes = ReportVote.objects.filter(report=instance.report, vote_type=1).count()
            instance.report.annotated_downvotes = ReportVote.objects.filter(report=instance.report, vote_type=-1).count()
            if request.user.is_authenticated:
                v = ReportVote.objects.filter(report=instance.report, user=request.user).first()
                instance.report._user_vote = v.vote_type if v else None
            else:
                instance.report._user_vote = None

        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    def perform_create(self, serializer):
        user = self.request.user
        if not user.is_authenticated:
            raise PermissionDenied("Authentication required to create community posts.")

        # Report-type posts cannot be manually created via the community endpoint
        requested_type = self.request.data.get('post_type')
        if requested_type == 'report' or 'report' in self.request.data or serializer.validated_data.get('post_type') == 'report':
            raise ValidationError("Official report cards cannot be created directly via the community feed.")

        # Default to user's assigned barangay if not explicitly passed
        barangay = serializer.validated_data.get('barangay') or getattr(user, 'barangay', None)
        serializer.save(author=user, barangay=barangay, post_type='discussion')

    def perform_update(self, serializer):
        post = self.get_object()
        user = self.request.user
        if post.report_id is not None or post.post_type == 'report':
            if not is_admin_user(user):
                raise PermissionDenied("Official report cards cannot be edited through the community feed.")
        elif post.author_id != user.id and not is_admin_user(user):
            raise PermissionDenied("You can only edit your own posts.")
        serializer.save()

    def perform_destroy(self, instance):
        user = self.request.user
        if instance.report_id is not None or instance.post_type == 'report':
            if not is_admin_user(user):
                raise PermissionDenied("Official report cards cannot be deleted through the community feed.")
        elif instance.author_id != user.id and not is_admin_user(user):
            raise PermissionDenied("You can only delete your own posts.")
        instance.delete()

    @action(detail=True, methods=['post', 'delete'])
    def like(self, request, pk=None):
        """
        Toggle or idempotently set like status on the community post.
        Uses database row locking on the requesting user to serialize concurrent requests.
        Database constraints ensure no duplicate likes can exist.
        """
        post = self.get_object()
        if post.is_hidden:
            return Response({'error': 'Cannot interact with a hidden post.'}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        action_param = request.data.get('action') or request.query_params.get('action')
        if request.method == 'DELETE':
            action_param = 'unlike'

        with transaction.atomic():
            # Acquire exclusive row lock on the user row to serialize concurrent like/unlike requests
            User.objects.select_for_update().get(id=user.id)

            if action_param == 'like':
                PostLike.objects.get_or_create(post=post, user=user)
                liked = True
            elif action_param == 'unlike':
                PostLike.objects.filter(post=post, user=user).delete()
                liked = False
            else:
                # Default toggle semantics, protected against race conditions
                existing_like = PostLike.objects.filter(post=post, user=user).first()
                if existing_like:
                    existing_like.delete()
                    liked = False
                else:
                    PostLike.objects.get_or_create(post=post, user=user)
                    liked = True

        return Response({
            'liked': liked,
            'like_count': post.likes.count(),
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def report(self, request, pk=None):
        """
        Submit a moderation report for an inappropriate post.
        """
        post = self.get_object()
        user = request.user
        reason = request.data.get('reason', 'other')
        details = request.data.get('details', '').strip()

        valid_reasons = dict(PostReport.REPORT_REASONS)
        if reason not in valid_reasons:
            reason = 'other'

        with transaction.atomic():
            report, created = PostReport.objects.update_or_create(
                post=post,
                reporter=user,
                defaults={
                    'reason': reason,
                    'details': details,
                    'status': 'pending',
                }
            )

        return Response({
            'status': 'reported',
            'report_id': report.id,
            'created': created,
            'message': 'Report received. Thank you for keeping our community safe.',
        }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['get', 'post'], url_path='comments')
    def comments(self, request, pk=None):
        """
        GET /api/community/posts/{id}/comments/ - List comments
        POST /api/community/posts/{id}/comments/ - Add a comment
        """
        post = self.get_object()
        if post.is_hidden:
            return Response({'error': 'Cannot interact with a hidden post.'}, status=status.HTTP_400_BAD_REQUEST)

        if request.method == 'GET':
            qs = post.comments.select_related('author', 'author__barangay')
            if not is_admin_user(request.user):
                qs = qs.filter(is_hidden=False)
            serializer = PostCommentSerializer(qs.order_by('created_at'), many=True, context={'request': request})
            return Response(serializer.data)

        # POST: Add comment
        if not request.user.is_authenticated:
            raise PermissionDenied("Authentication required to comment.")

        serializer = PostCommentSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        comment = serializer.save(post=post, author=request.user)

        # Return full serialized comment
        full_serializer = PostCommentSerializer(comment, context={'request': request})
        return Response(full_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch', 'post'])
    def moderate(self, request, pk=None):
        """
        Admin-only moderation action: hide or unhide a post.
        Explicit moderation endpoint operates on all posts (hidden or active).
        """
        post = get_object_or_404(
            CommunityPost.objects.select_related('author', 'barangay'),
            pk=pk
        )
        raw_hidden = request.data.get('is_hidden')
        if raw_hidden is None:
            return Response({'error': 'is_hidden boolean field is required.'}, status=status.HTTP_400_BAD_REQUEST)

        if isinstance(raw_hidden, str):
            is_hidden = raw_hidden.strip().lower() in ('true', '1')
        else:
            is_hidden = bool(raw_hidden)

        post.is_hidden = is_hidden
        post.save(update_fields=['is_hidden', 'updated_at'])

        # Update any pending reports on this post
        if post.is_hidden:
            post.reports.filter(status='pending').update(status='actioned')

        return Response({
            'id': post.id,
            'is_hidden': post.is_hidden,
            'message': f"Post #{post.id} is now {'hidden' if post.is_hidden else 'visible'}.",
        })

    @action(detail=False, methods=['get'], url_path='preview')
    def preview(self, request):
        """
        GET /api/community/posts/preview/
        Returns up to 3 recent real non-hidden posts for the Announcements page preview section.
        Reuses the exact same visibility-filtered queryset as the primary feed.
        """
        posts = list(self.filter_queryset(self.get_queryset())[:3])

        # Batch-fetch liked post IDs for authenticated user
        if request.user.is_authenticated:
            post_ids = [p.id for p in posts]
            user_liked_ids = set(
                PostLike.objects.filter(
                    user=request.user,
                    post_id__in=post_ids
                ).values_list('post_id', flat=True)
            )
            for p in posts:
                p._user_liked_ids = user_liked_ids

        # Batch-fetch ReportVote aggregations for report-linked posts
        report_ids = [p.report_id for p in posts if p.report_id is not None]
        if report_ids:
            from watcher.models import ReportVote
            up_map = dict(
                ReportVote.objects.filter(report_id__in=report_ids, vote_type=1)
                .values('report_id')
                .annotate(c=Count('id'))
                .values_list('report_id', 'c')
            )
            down_map = dict(
                ReportVote.objects.filter(report_id__in=report_ids, vote_type=-1)
                .values('report_id')
                .annotate(c=Count('id'))
                .values_list('report_id', 'c')
            )
            user_votes = {}
            if request.user.is_authenticated:
                user_votes = dict(
                    ReportVote.objects.filter(report_id__in=report_ids, user=request.user)
                    .values_list('report_id', 'vote_type')
                )
            for p in posts:
                if p.report:
                    p.report.annotated_upvotes = up_map.get(p.report_id, 0)
                    p.report.annotated_downvotes = down_map.get(p.report_id, 0)
                    if request.user.is_authenticated:
                        p.report._user_vote = user_votes.get(p.report_id, None)

        serializer = self.get_serializer(posts, many=True)
        return Response(serializer.data)


class PostCommentViewSet(viewsets.GenericViewSet):
    """
    Manage individual comments (e.g. deletion).
    """
    queryset = PostComment.objects.all()
    serializer_class = PostCommentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def destroy(self, request, pk=None):
        comment = get_object_or_404(PostComment, pk=pk)
        if comment.author_id != request.user.id and not is_admin_user(request.user):
            raise PermissionDenied("You can only delete your own comments.")
        comment.delete()
        return Response({'message': 'Comment deleted.'}, status=status.HTTP_200_OK)


class PostReportViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Admin-only inspection of reported posts.
    """
    queryset = PostReport.objects.select_related('post', 'reporter').order_by('-created_at')
    serializer_class = PostReportSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    @action(detail=True, methods=['post'])
    def dismiss(self, request, pk=None):
        report = self.get_object()
        report.status = 'dismissed'
        report.save(update_fields=['status'])
        return Response({'status': 'dismissed', 'message': f'Report #{report.id} dismissed.'})
