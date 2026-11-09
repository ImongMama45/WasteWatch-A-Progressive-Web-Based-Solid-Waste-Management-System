from django.utils import timezone
import math

def fmt_time(dt):
    """Cross-platform 12-hour time without leading zero (works on Windows & Linux)."""
    return dt.strftime('%I:%M %p').lstrip('0') if dt else ''

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def get_cluster_ids(lat, lng, radius_m=15, active_only=True):
    from .models import GarbageHotspot
    lat, lng = float(lat), float(lng)
    radius_km = radius_m / 1000.0
    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * math.cos(math.radians(lat)))
    
    qs = GarbageHotspot.objects.all()
    if active_only:
        qs = qs.filter(is_active=True)
    nearby = qs.filter(
        latitude__range=(lat - lat_delta, lat + lat_delta),
        longitude__range=(lng - lng_delta, lng + lng_delta),
    )
    return [h.id for h in nearby if haversine_km(lat, lng, float(h.latitude), float(h.longitude)) * 1000 <= radius_m]


import collections.abc
from django.http import Http404


def parse_positive_id(val):
    """
    Parses and validates positive integer identifiers (e.g. primary keys).
    Rejects booleans, floats, negative values, zero, malformed strings,
    and unreasonably long or overflow numbers.
    Returns integer if valid, else None.
    """
    if val is None or isinstance(val, (bool, float, list, dict)):
        return None
    if isinstance(val, int):
        return val if 1 <= val <= 9223372036854775807 else None
    if isinstance(val, str):
        s = val.strip()
        if s.isdigit() and 1 <= len(s) <= 19:
            try:
                n = int(s)
                return n if 1 <= n <= 9223372036854775807 else None
            except (ValueError, OverflowError):
                return None
    return None


from rest_framework import viewsets, permissions, status, filters, mixins
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.decorators import action
from rest_framework.response import Response
from wastewatch.pagination import StandardResultsSetPagination
from .models import (
    GarbageReport,
    CollectionConfirmation,
    GarbageHotspot,
    Escalation,
    ReportStatus,
    StopValidation,
    StopValidationStatus,
    ReportVote,
    ReportStatusHistory,
    Severity,
    WatcherReportedSpot,
    WatcherSpotStatus,
)
from .services import (
    create_or_get_community_post_for_report,
    record_report_status_transition,
    can_view_watcher_spots,
    attach_report_to_watcher_spot,
    spot_report_counts,
    route_points_for_schedule,
    distance_to_route_m,
    WATCHER_SPOT_ROUTE_RADIUS_M,
)
from accounts.permissions import (
    is_admin_user,
    is_viewer_authorized_for_report,
    can_moderate_report,
    can_vote_on_report,
)
from notifications.models import Notification, NotificationType
from django.db import transaction
from django.db.models import Count, Q, Subquery, OuterRef, IntegerField
from django.db.models.functions import Coalesce
from community.models import PostComment
import json
from .serializers import (
    GarbageReportSerializer,
    CollectionConfirmationSerializer,
    GarbageHotspotSerializer,
    EscalationSerializer,
    StopValidationSerializer,
    WatcherReportedSpotSerializer,
)
from .stop_validation_service import ensure_today_stop_validations
from .stop_validation_utils import (
    COLLECTION_RADIUS_M,
    INSPECTION_RADIUS_M,
    VERIFICATION_RADIUS_M,
    get_stop_coordinates,
    is_validation_visible,
    validate_gps_proximity,
)

# Roles that may see all reports across the city on the map
_MAP_FULL_ACCESS_ROLES = {'admin', 'watcher', 'brgy_official', 'driver'}

class GarbageReportViewSet(viewsets.ModelViewSet):
    queryset = GarbageReport.objects.all()
    serializer_class = GarbageReportSerializer
    pagination_class = StandardResultsSetPagination
    unpaginated_actions = ['mine']  # Strictly scoped to user=request.user for personal map pins
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action in ('create', 'list', 'retrieve', 'public', 'map_pins', 'leaderboard'):
            return [permissions.AllowAny()]
        if self.action in ('community_post', 'comments') and self.request.method in permissions.SAFE_METHODS:
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if self.action in ('update', 'partial_update', 'destroy'):
            if not is_admin_user(request.user):
                if obj.user != request.user:
                    self.permission_denied(request, message="Not authorized to modify this report.")
                if obj.status != ReportStatus.PENDING:
                    self.permission_denied(
                        request,
                        message=f"Cannot edit or delete report after it has been {obj.status}."
                    )

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.check_object_permissions(request, instance)

        # Operational history check to prevent destructive permanent deletions:
        # 1. Associated hotspots with operational history (interventions or truck assignments)
        # 2. Associated interventions linked via source_report
        # 3. More than its initial status-history record
        # 4. Any collection confirmation records
        from .models import HotspotIntervention
        has_hotspot_history = instance.hotspots.filter(
            Q(interventions__isnull=False) | Q(assigned_truck__isnull=False)
        ).exists()
        has_interventions = HotspotIntervention.objects.filter(hotspot__source_report=instance).exists()
        has_status_history = instance.status_history.count() > 1
        has_confirmations = instance.confirmations.exists()

        if has_hotspot_history or has_interventions or has_status_history or has_confirmations:
            return Response(
                {'detail': 'Cannot permanently delete report with operational history. Archive the report instead.'},
                status=status.HTTP_409_CONFLICT
            )

        from django.db.models import ProtectedError
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {'detail': 'Cannot delete report because related operational records are protected. Archive the report instead.'},
                status=status.HTTP_409_CONFLICT
            )

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['barangay', 'status', 'issue_type', 'severity']
    search_fields = ['address', 'description', 'reported_user__username', 'reported_user__full_name', 'user__username', 'user__full_name', 'barangay__name']
    ordering_fields = ['created_at', 'severity']
    throttle_scope = 'report_submission'

    def get_throttles(self):
        # Only throttle the creation of new reports to prevent spam
        if self.action == 'create':
            return [ScopedRateThrottle()]
        return super().get_throttles()

    def _get_fresh_report_for_response(self, report_id):
        from django.db.models import Prefetch
        return GarbageReport.objects.select_related(
            'community_post', 'barangay', 'user', 'approved_by', 'rejected_by', 'reported_user'
        ).prefetch_related(
            Prefetch(
                'status_history',
                queryset=ReportStatusHistory.objects.select_related('changed_by').order_by('-timestamp', '-id')
            )
        ).get(pk=report_id)

    def get_accessible_reports_queryset(self):
        user = self.request.user
        qs = GarbageReport.objects.all()

        # 0. Watcher-reported spots are internal: only staff and watchers may see them
        if not can_view_watcher_spots(user):
            qs = qs.exclude(is_watcher_spot=True)

        # 1. Anonymous users see approved and resolved reports (never archived)
        if not user.is_authenticated:
            return qs.filter(is_archived=False, status__in=[ReportStatus.APPROVED, ReportStatus.RESOLVED])

        # 2. Admins see all report states, including archived records
        if is_admin_user(user):
            return qs

        # 3. Barangay Officials: access is limited to their own barangay.
        # Report owners can privately view their own reports (including archived).
        # Non-owned reports must be unarchived.
        if user.role == 'brgy_official':
            if user.barangay:
                return qs.filter(
                    Q(user=user) |
                    (Q(is_archived=False) & (Q(barangay=user.barangay) | Q(status__in=[ReportStatus.APPROVED, ReportStatus.RESOLVED])))
                )
            return qs.filter(
                Q(user=user) |
                (Q(is_archived=False) & Q(status__in=[ReportStatus.APPROVED, ReportStatus.RESOLVED]))
            )

        # 4. Citizens / Watchers / Drivers:
        # Report owner may privately view their own reports (including rejected and archived).
        # Unrelated reports must be unarchived and approved or resolved.
        return qs.filter(
            Q(user=user) | (Q(is_archived=False) & Q(status__in=[ReportStatus.APPROVED, ReportStatus.RESOLVED]))
        )

    def get_queryset(self):
        qs = self.get_accessible_reports_queryset()

        from django.db.models import Prefetch
        # Single-valued relationships, multi-valued prefetches, and annotations to eliminate N+1 queries
        qs = qs.select_related(
            'community_post', 'barangay', 'user', 'approved_by', 'rejected_by', 'reported_user'
        ).prefetch_related(
            Prefetch(
                'status_history',
                queryset=ReportStatusHistory.objects.select_related('changed_by').order_by('-timestamp', '-id')
            )
        )

        # Correlated subqueries avoid join multiplication cross products (votes x comments)
        upvotes_sub = ReportVote.objects.filter(report=OuterRef('pk'), vote_type=1).values('report').annotate(c=Count('id')).values('c')
        downvotes_sub = ReportVote.objects.filter(report=OuterRef('pk'), vote_type=-1).values('report').annotate(c=Count('id')).values('c')
        comments_sub = PostComment.objects.filter(post__report=OuterRef('pk'), is_hidden=False).values('post__report').annotate(c=Count('id')).values('c')

        qs = qs.annotate(
            annotated_upvotes=Coalesce(Subquery(upvotes_sub, output_field=IntegerField()), 0),
            annotated_downvotes=Coalesce(Subquery(downvotes_sub, output_field=IntegerField()), 0),
            annotated_comment_count=Coalesce(Subquery(comments_sub, output_field=IntegerField()), 0),
        )

        status_param = self.request.query_params.get('status')
        if status_param and status_param.lower() != 'all':
            qs = qs.filter(status=status_param.lower())

        barangay_param = self.request.query_params.get('barangay')
        if barangay_param:
            if barangay_param.isdigit():
                qs = qs.filter(barangay_id=int(barangay_param))
            else:
                qs = qs.filter(barangay__name__iexact=barangay_param)

        issue_type_param = self.request.query_params.get('issue_type')
        if issue_type_param and issue_type_param.lower() != 'all':
            qs = qs.filter(issue_type=issue_type_param)

        severity_param = self.request.query_params.get('severity')
        if severity_param and severity_param.lower() != 'all':
            qs = qs.filter(severity=severity_param)

        tag_param = self.request.query_params.get('tags__icontains') or self.request.query_params.get('tag')
        if tag_param:
            qs = qs.filter(tags__icontains=tag_param)

        search_query = self.request.query_params.get('search', '').strip()
        if search_query:
            clean_num = search_query.lstrip('#').strip()
            if clean_num.isdigit():
                qs = qs.filter(
                    Q(id=int(clean_num)) |
                    Q(address__icontains=search_query) |
                    Q(description__icontains=search_query) |
                    Q(reported_user__full_name__icontains=search_query) |
                    Q(reported_user__username__icontains=search_query) |
                    Q(barangay__name__icontains=search_query)
                )
            else:
                qs = qs.filter(
                    Q(address__icontains=search_query) |
                    Q(description__icontains=search_query) |
                    Q(reported_user__full_name__icontains=search_query) |
                    Q(reported_user__username__icontains=search_query) |
                    Q(user__full_name__icontains=search_query) |
                    Q(user__username__icontains=search_query) |
                    Q(barangay__name__icontains=search_query)
                )

        return qs

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        if getattr(self, 'paginator', None) is not None:
            base_accessible = self.get_accessible_reports_queryset()
            summary_agg = base_accessible.aggregate(
                total=Count('id'),
                pending=Count('id', filter=Q(status=ReportStatus.PENDING)),
                approved=Count('id', filter=Q(status=ReportStatus.APPROVED)),
                rejected=Count('id', filter=Q(status=ReportStatus.REJECTED)),
                resolved=Count('id', filter=Q(status=ReportStatus.RESOLVED)),
            )
            self.paginator.extra_data = {'summary': summary_agg}

        page = self.paginate_queryset(queryset)
        reports = page if page is not None else queryset

        # Batch-fetch user's votes in 1 single query to eliminate N+1
        if request.user.is_authenticated:
            report_ids = [r.id for r in reports]
            user_votes = dict(
                ReportVote.objects.filter(
                    user=request.user,
                    report_id__in=report_ids
                ).values_list('report_id', 'vote_type')
            )
            for r in reports:
                r._user_vote = user_votes.get(r.id)

        serializer = self.get_serializer(reports, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def get_object(self):
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        pk_val = self.kwargs.get(lookup_url_kwarg)
        clean_id = parse_positive_id(pk_val)
        if clean_id is None:
            raise Http404("Report not found.")
        self.kwargs[lookup_url_kwarg] = clean_id
        return super().get_object()

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.user.is_authenticated:
            vote = instance.votes.filter(user=request.user).first()
            instance._user_vote = vote.vote_type if vote else None
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    def perform_create(self, serializer):
        # Automatically set to PENDING on creation
        user = self.request.user if self.request.user.is_authenticated else None

        # Watcher-reported spot: a special report only a Watcher can file. It skips the
        # barangay/admin approval queue and becomes a Route Builder suggestion.
        is_watcher_spot = str(self.request.data.get('is_watcher_spot', '')).strip().lower() in ('true', '1', 'yes')
        if is_watcher_spot:
            if not user or getattr(user, 'role', None) != 'watcher':
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Only watchers can report a watcher spot.')

        latitude = serializer.validated_data.get('latitude')
        longitude = serializer.validated_data.get('longitude')
        barangay = serializer.validated_data.get('barangay')
        address = serializer.validated_data.get('address', '')

        if is_watcher_spot and (latitude is None or longitude is None):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'GPS coordinates are required to report a watcher spot.'})

        # 1. Primary & authoritative: coordinate-based geofencing against Lucena City barangay polygons.
        #    Regardless of whether the reporter is anonymous or registered in Barangay A,
        #    a report whose GPS coordinates fall inside Barangay B is geo-tagged to Barangay B.
        if latitude is not None and longitude is not None:
            from .geofence import resolve_barangay_from_coords
            geofenced_barangay = resolve_barangay_from_coords(latitude, longitude)
            if geofenced_barangay is not None:
                barangay = geofenced_barangay
            else:
                # Coordinates are outside Lucena City boundaries — never fall back to user.barangay
                barangay = None
        else:
            # 2. Only when coordinates are absent, allow explicit barangay or address match.
            #    Never depend on `user.barangay` (the reporter's profile barangay).
            if not barangay and address:
                from accounts.models import Barangay
                all_brgys = Barangay.objects.all()
                for brgy in sorted(all_brgys, key=lambda x: len(x.name), reverse=True):
                    if brgy.name.lower() in address.lower():
                        barangay = brgy
                        break

        if is_watcher_spot:
            if barangay is None:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({'detail': 'The spot must be inside a Lucena City barangay.'})
            with transaction.atomic():
                report = serializer.save(
                    user=user,
                    status=ReportStatus.APPROVED,
                    barangay=barangay,
                    is_watcher_spot=True,
                    approved_at=timezone.now(),
                )
                ReportStatusHistory.objects.create(
                    report=report,
                    previous_status='',
                    new_status=ReportStatus.APPROVED,
                    changed_by=user,
                    remarks='Watcher spot reported (auto-approved, skips barangay/admin approval)',
                )
                attach_report_to_watcher_spot(report, user)
            return

        with transaction.atomic():
            report = serializer.save(user=user, status=ReportStatus.PENDING, barangay=barangay)
            create_or_get_community_post_for_report(report, author=user)
            ReportStatusHistory.objects.create(
                report=report,
                previous_status='',
                new_status=ReportStatus.PENDING,
                changed_by=user,
                remarks='Report submitted',
            )

    def perform_update(self, serializer):
        instance = serializer.instance
        has_coord_change = 'latitude' in serializer.validated_data or 'longitude' in serializer.validated_data
        if has_coord_change:
            latitude = serializer.validated_data.get('latitude', instance.latitude)
            longitude = serializer.validated_data.get('longitude', instance.longitude)
            if latitude is not None and longitude is not None:
                from .geofence import resolve_barangay_from_coords
                geofenced_barangay = resolve_barangay_from_coords(latitude, longitude)
                serializer.save(barangay=geofenced_barangay)
                return
        serializer.save()

    @action(detail=True, methods=['post', 'delete'], permission_classes=[permissions.IsAuthenticated])
    def vote(self, request, pk=None):
        """
        Cast, update, or remove a civic verification vote on a GarbageReport.
        Eligible roles: citizen, watcher, brgy_official.
        Drivers and admins can view results but cannot vote.
        Only APPROVED and RESOLVED reports accept new votes.
        """
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

        if getattr(request.user, 'role', None) not in ['citizen', 'watcher', 'brgy_official']:
            return Response(
                {'error': f"Role '{getattr(request.user, 'role', None)}' is not eligible to cast votes on reports."},
                status=status.HTTP_403_FORBIDDEN
            )

        if request.method == 'DELETE':
            # Check report visibility or existing vote ownership:
            # Users may remove their vote from visible reports OR reports they previously voted on
            # before the report became rejected or archived (Finding 7A).
            # Truly inaccessible reports without existing votes return 404 (Finding 2).
            has_existing_vote = ReportVote.objects.filter(report_id=clean_pk, user=request.user).exists()
            is_visible = self.get_queryset().filter(pk=clean_pk).exists()
            if not (is_visible or has_existing_vote):
                return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

            with transaction.atomic():
                try:
                    report = GarbageReport.objects.select_for_update().get(pk=clean_pk)
                except GarbageReport.DoesNotExist:
                    return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

                # Re-verify report visibility within the locked transaction
                is_report_visible = self.get_queryset().filter(pk=report.pk).exists()

                ReportVote.objects.filter(report=report, user=request.user).delete()

                # If report is visible to user, return authoritative counts.
                # If report is NOT visible (e.g. rejected or archived after vote was cast),
                # return ONLY report_id and user_vote: None to prevent disclosing private report details.
                if is_report_visible:
                    upvotes = report.votes.filter(vote_type=1).count()
                    downvotes = report.votes.filter(vote_type=-1).count()
                    return Response({
                        'report_id': report.id,
                        'upvotes': upvotes,
                        'downvotes': downvotes,
                        'net_votes': upvotes - downvotes,
                        'user_vote': None,
                    }, status=status.HTTP_200_OK)
                else:
                    return Response({
                        'report_id': report.id,
                        'user_vote': None,
                    }, status=status.HTTP_200_OK)

        # POST path
        # Authoritative visibility check: non-existent or inaccessible reports return identical 404
        if not self.get_queryset().filter(pk=clean_pk).exists():
            return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not isinstance(request.data, (dict, collections.abc.Mapping)):
            return Response({'error': 'Invalid request body. Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

        raw_vote = request.data.get('vote_type')
        if raw_vote is None or isinstance(raw_vote, (bool, float)):
            return Response(
                {'error': 'vote_type must be either 1 (upvote) or -1 (downvote).'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            vote_type = int(raw_vote)
        except (ValueError, TypeError):
            return Response(
                {'error': 'vote_type must be either 1 (upvote) or -1 (downvote).'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if vote_type not in (1, -1):
            return Response(
                {'error': 'vote_type must be either 1 (upvote) or -1 (downvote).'},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            try:
                # Plain model select_for_update() without GROUP BY/annotations to prevent TOCTOU
                locked_report = GarbageReport.objects.select_for_update().get(pk=clean_pk)
            except GarbageReport.DoesNotExist:
                return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

            if locked_report.is_archived or locked_report.status not in [ReportStatus.APPROVED, ReportStatus.RESOLVED]:
                return Response(
                    {'error': 'Only approved or resolved reports are eligible for community voting.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Enforce strict barangay scope for civic voting
            if not can_vote_on_report(request.user, locked_report):
                if not getattr(request.user, 'barangay_id', None):
                    return Response({'error': 'Users without an assigned barangay cannot vote.'}, status=status.HTTP_403_FORBIDDEN)
                if not getattr(locked_report, 'barangay_id', None):
                    return Response({'error': 'Reports without an assigned barangay cannot receive votes.'}, status=status.HTTP_400_BAD_REQUEST)
                return Response({'error': 'Cannot vote on reports outside your assigned barangay.'}, status=status.HTTP_403_FORBIDDEN)

            ReportVote.objects.update_or_create(
                report=locked_report,
                user=request.user,
                defaults={'vote_type': vote_type}
            )

            upvotes = locked_report.votes.filter(vote_type=1).count()
            downvotes = locked_report.votes.filter(vote_type=-1).count()

        return Response({
            'report_id': locked_report.id,
            'upvotes': upvotes,
            'downvotes': downvotes,
            'net_votes': upvotes - downvotes,
            'user_vote': vote_type,
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'])
    def community_post(self, request, pk=None):
        """
        Resolves a GarbageReport to its single associated CommunityPost.
        Strictly read-only: returns 404 if no CommunityPost exists or if hidden from non-admin viewers.
        """
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

        report = self.get_object()
        post = getattr(report, 'community_post', None)
        if not post or (post.is_hidden and not is_admin_user(request.user)):
            return Response(
                {'error': 'No community post associated with this report.'},
                status=status.HTTP_404_NOT_FOUND
            )
        from community.serializers import CommunityPostSerializer
        return Response(CommunityPostSerializer(post, context={'request': request}).data)

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        """
        Unified comments delegation: reads and writes comments on the report's linked CommunityPost.
        GET is strictly read-only and returns [] if no CommunityPost exists or if hidden.
        POST creates or retrieves the CommunityPost atomically before creating the comment.
        """
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

        report = self.get_object()
        from community.serializers import PostCommentSerializer

        post = getattr(report, 'community_post', None)
        if request.method == 'GET':
            if not post or (post.is_hidden and not is_admin_user(request.user)):
                return Response([], status=status.HTTP_200_OK)
            comments = post.comments.select_related('author', 'author__barangay', 'post', 'post__report')
            if not is_admin_user(request.user):
                comments = comments.filter(is_hidden=False)
            return Response(PostCommentSerializer(comments.order_by('created_at'), many=True, context={'request': request}).data)
        elif request.method == 'POST':
            if not request.user or not request.user.is_authenticated:
                return Response({'error': 'Authentication required to post comments.'}, status=status.HTTP_401_UNAUTHORIZED)
            if not isinstance(request.data, (dict, collections.abc.Mapping)):
                return Response({'error': 'Invalid request body. Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)
            if post and post.is_hidden and not is_admin_user(request.user):
                return Response({'error': 'Cannot interact with a hidden post.'}, status=status.HTTP_400_BAD_REQUEST)
            with transaction.atomic():
                post, _ = create_or_get_community_post_for_report(report, author=report.user)
                if post.is_hidden and not is_admin_user(request.user):
                    return Response({'error': 'Cannot interact with a hidden post.'}, status=status.HTTP_400_BAD_REQUEST)
                serializer = PostCommentSerializer(data=request.data, context={'request': request})
                serializer.is_valid(raise_exception=True)
                comment = serializer.save(post=post, author=request.user)
                return Response(PostCommentSerializer(comment, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post', 'patch'], permission_classes=[permissions.IsAuthenticated])
    def approve(self, request, pk=None):
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_admin_user(request.user) and getattr(request.user, 'role', None) != 'brgy_official':
            return Response({'error': 'Not authorized'}, status=403)

        if request.data and not isinstance(request.data, (dict, collections.abc.Mapping)):
            return Response({'error': 'Invalid request body. Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                report = GarbageReport.objects.select_for_update().get(pk=clean_pk)
            except GarbageReport.DoesNotExist:
                return Response({'error': 'Report not found.'}, status=404)

            if not can_moderate_report(request.user, report):
                return Response({'error': 'Not authorized to moderate this report.'}, status=status.HTTP_403_FORBIDDEN)

            if report.is_archived:
                return Response({'error': 'Archived reports cannot be approved.'}, status=status.HTTP_400_BAD_REQUEST)

            if report.status == ReportStatus.RESOLVED:
                return Response(
                    {'error': 'Resolved reports cannot be approved directly. Use reopen to reopen a resolved report.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            if report.status == ReportStatus.APPROVED:
                return Response({'error': 'Report is already approved.'}, status=status.HTTP_400_BAD_REQUEST)

            if report.status == ReportStatus.REJECTED:
                return Response({'error': 'Rejected reports cannot be approved directly. Reopen the report first.'}, status=status.HTTP_400_BAD_REQUEST)

            if report.status != ReportStatus.PENDING:
                return Response({'error': f"Only pending reports can be approved (current: '{report.status}')."}, status=status.HTTP_400_BAD_REQUEST)

            report.rejected_by = None
            report.rejected_at = None
            report.rejection_reason = ''

            # Allow barangay official or admin to set/update waste severity at approval time
            if request.data and 'severity' in request.data:
                new_sev = str(request.data.get('severity', '')).lower().strip()
                if new_sev in Severity.values:
                    report.severity = new_sev
                    report.save(update_fields=['severity'])

            record_report_status_transition(
                report,
                ReportStatus.APPROVED,
                changed_by=request.user,
                remarks='Report approved by staff',
            )

            # Ensure coordinate-bearing reports have their geofenced barangay resolved before promotion
            if report.latitude is not None and report.longitude is not None and not report.barangay:
                from .geofence import resolve_barangay_from_coords
                resolved_brgy = resolve_barangay_from_coords(report.latitude, report.longitude)
                if resolved_brgy is not None:
                    report.barangay = resolved_brgy
                    report.save(update_fields=['barangay'])

            # Auto-promote to GarbageHotspot so it appears on the map (idempotent on double-click).
            if report.latitude and report.longitude and report.barangay:
                hotspot, created = GarbageHotspot.objects.get_or_create(
                    source_report=report,
                    defaults={
                        'name': f'Report #{report.id} — {report.get_issue_type_display()}',
                        'severity': report.severity,
                        'barangay': report.barangay,
                        'latitude': report.latitude,
                        'longitude': report.longitude,
                        'is_active': True,
                    }
                )
                if not created:
                    update_fields = []
                    if hotspot.barangay_id != report.barangay_id:
                        hotspot.barangay = report.barangay
                        update_fields.append('barangay')
                    if hotspot.severity != report.severity:
                        hotspot.severity = report.severity
                        update_fields.append('severity')
                    if not hotspot.is_active:
                        hotspot.is_active = True
                        update_fields.append('is_active')
                    # When reactivating a hotspot during approval, explicitly clear stale dispatch state
                    if hotspot.assigned_truck_id is not None:
                        hotspot.assigned_truck = None
                        update_fields.append('assigned_truck')
                    if not hotspot.dispatch_acknowledged:
                        hotspot.dispatch_acknowledged = True
                        update_fields.append('dispatch_acknowledged')
                    if hotspot.dispatched_at is not None:
                        hotspot.dispatched_at = None
                        update_fields.append('dispatched_at')
                    if update_fields:
                        hotspot.save(update_fields=update_fields)

            # Send notification to the reporter
            if report.user:
                Notification.objects.create(
                    user=report.user,
                    title='Report Approved',
                    message=f'Your {report.get_issue_type_display()} report at {report.address or "the reported location"} has been approved and published to the map.',
                    type=NotificationType.REPORT_UPDATE
                )

        fresh_report = self._get_fresh_report_for_response(report.id)
        return Response(GarbageReportSerializer(fresh_report, context={'request': request}).data)

    @action(detail=True, methods=['post', 'patch'], permission_classes=[permissions.IsAuthenticated])
    def set_severity(self, request, pk=None):
        """Allows barangay official or admin to update waste severity on a report."""
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_admin_user(request.user) and getattr(request.user, 'role', None) != 'brgy_official':
            return Response({'error': 'Not authorized'}, status=403)

        if not isinstance(request.data, (dict, collections.abc.Mapping)):
            return Response({'error': 'Invalid request body. Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                report = GarbageReport.objects.select_for_update().get(pk=clean_pk)
            except GarbageReport.DoesNotExist:
                return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

            if not can_moderate_report(request.user, report):
                return Response({'error': 'Not authorized to moderate this report.'}, status=status.HTTP_403_FORBIDDEN)

            raw_severity = request.data.get('severity')
            if not raw_severity:
                return Response({'error': 'Severity field is required.'}, status=status.HTTP_400_BAD_REQUEST)

            new_sev = str(raw_severity).lower().strip()
            if new_sev not in Severity.values:
                return Response({'error': f"Invalid severity. Choices are: {Severity.values}"}, status=status.HTTP_400_BAD_REQUEST)

            report.severity = new_sev
            report.save(update_fields=['severity'])

            # Sync to any linked GarbageHotspot
            GarbageHotspot.objects.filter(source_report=report).update(severity=new_sev)

        fresh_report = self._get_fresh_report_for_response(report.id)
        return Response(GarbageReportSerializer(fresh_report, context={'request': request}).data)

    @action(detail=True, methods=['post', 'patch'], permission_classes=[permissions.IsAuthenticated])
    def reject(self, request, pk=None):
        """PENDING -> REJECTED. Saves reason and audit trail."""
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_admin_user(request.user) and getattr(request.user, 'role', None) != 'brgy_official':
            return Response({'error': 'Not authorized'}, status=403)

        if not isinstance(request.data, (dict, collections.abc.Mapping)):
            return Response({'error': 'Invalid request body. Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

        raw_reason = (
            request.data.get('rejection_reason')
            if 'rejection_reason' in request.data
            else request.data.get('reason')
        )
        if raw_reason is None:
            return Response({'rejection_reason': 'This field is required.'}, status=status.HTTP_400_BAD_REQUEST)

        if not isinstance(raw_reason, str) or isinstance(raw_reason, bool):
            return Response({'rejection_reason': 'Rejection reason must be a string.'}, status=status.HTTP_400_BAD_REQUEST)

        reason = raw_reason.strip()
        if not reason:
            return Response({'rejection_reason': 'This field is required.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                report = GarbageReport.objects.select_for_update().get(pk=clean_pk)
            except GarbageReport.DoesNotExist:
                return Response({'error': 'Report not found.'}, status=404)

            # Security: Validate moderation scope using shared helper
            if not can_moderate_report(request.user, report):
                return Response({'error': 'Not authorized to moderate this report.'}, status=status.HTTP_403_FORBIDDEN)

            if report.is_archived:
                return Response({'error': 'Archived reports cannot be rejected.'}, status=status.HTTP_400_BAD_REQUEST)

            if report.status == ReportStatus.REJECTED:
                return Response({'error': 'Report is already rejected.'}, status=status.HTTP_400_BAD_REQUEST)

            if report.status == ReportStatus.RESOLVED:
                return Response({'error': 'Resolved reports cannot be rejected directly. Reopen the report first.'}, status=status.HTTP_400_BAD_REQUEST)

            if report.status not in [ReportStatus.PENDING, ReportStatus.APPROVED]:
                return Response({'error': f"Only pending or approved reports can be rejected (current: '{report.status}')."}, status=status.HTTP_400_BAD_REQUEST)

            report.rejected_by = request.user
            report.rejected_at = timezone.now()
            report.rejection_reason = reason
            report.approved_by = None
            report.approved_at = None
            record_report_status_transition(
                report,
                ReportStatus.REJECTED,
                changed_by=request.user,
                remarks=reason,
            )

            # Retire / deactivate hotspot and cancel open interventions
            from .services import retire_hotspot_and_cancel_active_dispatches
            retire_hotspot_and_cancel_active_dispatches(report, cancelled_by=request.user, reason=f"Report rejected: {reason}")

            # Send notification to the reporter
            if report.user:
                Notification.objects.create(
                    user=report.user,
                    title='Report Rejected',
                    message=f'Your {report.get_issue_type_display()} report at {report.address or "the reported location"} was rejected. Reason: {reason}',
                    type=NotificationType.REPORT_UPDATE
                )

        fresh_report = self._get_fresh_report_for_response(report.id)
        return Response(GarbageReportSerializer(fresh_report, context={'request': request}).data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def archive(self, request, pk=None):
        """Soft deletes the report (only available to Brgy Officials / Admin)."""
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_admin_user(request.user) and getattr(request.user, 'role', None) != 'brgy_official':
            return Response({'error': 'Not authorized'}, status=403)

        if request.data and not isinstance(request.data, (dict, collections.abc.Mapping)):
            return Response({'error': 'Invalid request body. Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                report = GarbageReport.objects.select_for_update().get(pk=clean_pk)
            except GarbageReport.DoesNotExist:
                return Response({'error': 'Report not found.'}, status=404)

            if not can_moderate_report(request.user, report):
                return Response({'error': 'Not authorized to moderate this report.'}, status=status.HTTP_403_FORBIDDEN)

            if report.is_archived:
                return Response({'error': 'Report is already archived.'}, status=status.HTTP_400_BAD_REQUEST)

            if report.status != ReportStatus.REJECTED:
                return Response({'error': 'Only rejected reports can be archived.'}, status=status.HTTP_400_BAD_REQUEST)

            report.is_archived = True
            report.save(update_fields=['is_archived', 'updated_at'])

            from .services import retire_hotspot_and_cancel_active_dispatches
            retire_hotspot_and_cancel_active_dispatches(report, cancelled_by=request.user, reason="Report archived")

            # NOTE: Archive is metadata/soft-delete, not a status transition.
            # Do NOT create a fake REJECTED -> REJECTED transition.

        return Response({'status': 'archived'})

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def reopen(self, request, pk=None):
        """
        Explicitly reopens a RESOLVED or REJECTED report back to PENDING.
        Clears resolved_at, approved state, and rejection_reason while preserving historical records.
        """
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_admin_user(request.user) and getattr(request.user, 'role', None) != 'brgy_official':
            return Response({'error': 'Not authorized'}, status=403)

        if request.data is not None and not isinstance(request.data, (dict, collections.abc.Mapping)):
            return Response({'error': 'Invalid request body. Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

        data = request.data if isinstance(request.data, (dict, collections.abc.Mapping)) else {}
        raw_remarks = data.get('remarks')
        if raw_remarks is not None:
            if not isinstance(raw_remarks, str) or isinstance(raw_remarks, bool):
                return Response({'remarks': 'Remarks must be a string.'}, status=status.HTTP_400_BAD_REQUEST)
            remarks = raw_remarks.strip() or 'Report reopened by staff'
        else:
            remarks = 'Report reopened by staff'

        with transaction.atomic():
            try:
                report = GarbageReport.objects.select_for_update().get(pk=clean_pk)
            except GarbageReport.DoesNotExist:
                return Response({'error': 'Report not found.'}, status=404)

            if not can_moderate_report(request.user, report):
                return Response({'error': 'Not authorized to moderate this report.'}, status=status.HTTP_403_FORBIDDEN)

            if report.is_archived:
                return Response({'error': 'Archived reports cannot be reopened.'}, status=status.HTTP_400_BAD_REQUEST)

            if report.status not in [ReportStatus.RESOLVED, ReportStatus.REJECTED]:
                return Response(
                    {'error': f"Cannot reopen report with status '{report.status}'. Only resolved or rejected reports can be reopened."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            report.resolved_at = None
            report.approved_at = None
            report.approved_by = None
            report.rejection_reason = ''
            report.rejected_by = None
            report.rejected_at = None
            record_report_status_transition(
                report,
                ReportStatus.PENDING,
                changed_by=request.user,
                remarks=remarks,
            )

            # Deactivate hotspot and cancel open dispatches
            from .services import retire_hotspot_and_cancel_active_dispatches
            retire_hotspot_and_cancel_active_dispatches(report, cancelled_by=request.user, reason=remarks)

            if report.user:
                Notification.objects.create(
                    user=report.user,
                    title='Report Reopened',
                    message=f'Your {report.get_issue_type_display()} report at {report.address or "the reported location"} has been reopened for review.',
                    type=NotificationType.REPORT_UPDATE
                )

        fresh_report = self._get_fresh_report_for_response(report.id)
        return Response(GarbageReportSerializer(fresh_report, context={'request': request}).data)



    @action(detail=False, methods=['get'])
    def public(self, request):
        """Returns approved and resolved reports for the public map without N+1 queries."""
        reports = self.get_queryset().filter(status__in=[ReportStatus.APPROVED, ReportStatus.RESOLVED])
        page = self.paginate_queryset(reports)
        data_reports = page if page is not None else reports

        if request.user.is_authenticated:
            report_ids = [r.id for r in data_reports]
            user_votes = dict(
                ReportVote.objects.filter(
                    user=request.user,
                    report_id__in=report_ids
                ).values_list('report_id', 'vote_type')
            )
            for r in data_reports:
                r._user_vote = user_votes.get(r.id)

        serializer = self.get_serializer(data_reports, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def mine(self, request):
        """Returns reports submitted by the authenticated user without N+1 queries."""
        reports = self.get_queryset().filter(user=request.user)
        page = self.paginate_queryset(reports)
        data_reports = page if page is not None else reports

        report_ids = [r.id for r in data_reports]
        user_votes = dict(
            ReportVote.objects.filter(
                user=request.user,
                report_id__in=report_ids
            ).values_list('report_id', 'vote_type')
        )
        for r in data_reports:
            r._user_vote = user_votes.get(r.id)

        serializer = self.get_serializer(data_reports, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def map_pins(self, request):
        """
        Returns approved reports as map pins — sourced from active GarbageHotspot
        so only admin/brgy_official-approved issues appear on the public map.
        Each pin links back to the originating GarbageReport for the detail panel.
        """
        hotspots = GarbageHotspot.objects.filter(is_active=True).select_related(
            'barangay', 'source_report', 'source_report__user', 'source_report__community_post'
        ).all()

        # Batch-fetch active comment counts for linked community posts
        post_ids = [
            h.source_report.community_post.id
            for h in hotspots
            if h.source_report
            and hasattr(h.source_report, 'community_post')
            and h.source_report.community_post
            and not h.source_report.community_post.is_hidden
        ]
        comment_counts = {}
        if post_ids:
            from community.models import PostComment
            from django.db.models import Count
            comment_counts = dict(
                PostComment.objects.filter(post_id__in=post_ids, is_hidden=False)
                .values('post_id')
                .annotate(c=Count('id'))
                .values_list('post_id', 'c')
            )

        data = []
        for h in hotspots:
            report = h.source_report
            # If linked to a report, exclude if archived, rejected, or pending
            if report and (report.is_archived or report.status not in [ReportStatus.APPROVED, ReportStatus.RESOLVED]):
                continue

            # Identity masking using is_viewer_authorized_for_report
            if report and is_viewer_authorized_for_report(request.user, report):
                user_name = (report.user.full_name or report.user.username) if report.user else "Anonymous"
            else:
                user_name = "Community Waste Report"

            community_post = getattr(report, 'community_post', None) if report else None
            community_post_id = None
            comment_count = 0
            if community_post and not community_post.is_hidden:
                community_post_id = community_post.id
                comment_count = comment_counts.get(community_post.id, 0)

            data.append({
                'id':            h.id,
                'report_id':     report.id if report else None,
                'community_post_id': community_post_id,
                'comment_count': comment_count,
                'lat':           float(h.latitude),
                'lng':           float(h.longitude),
                'issue_type':    report.issue_type if report else 'overflow',
                'severity':      h.severity,
                'status':        report.status if report else 'approved',
                'barangay_name': h.barangay.name if h.barangay else 'Unknown',
                'address':       report.address if report else h.name,
                'reported':      report.created_at.isoformat() if report else None,
                'description':   report.description if report else '',
                'images':        [img.url for img in [report.image, report.image_2, report.image_3, report.image_4] if report and img] if report else [],
                'user_name':     user_name,
                'rejection_reason': None,
            })

        return Response(data)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        qs = self.get_queryset()
        return Response({
            'total':    qs.count(),
            'pending':  qs.filter(status=ReportStatus.PENDING).count(),
            'approved': qs.filter(status=ReportStatus.APPROVED).count(),
            'resolved': qs.filter(status=ReportStatus.RESOLVED).count(),
            'rejected': qs.filter(status=ReportStatus.REJECTED).count(),
        })

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def mine_stats(self, request):
        qs = GarbageReport.objects.filter(user=request.user)
        return Response({
            'total':    qs.count(),
            'pending':  qs.filter(status=ReportStatus.PENDING).count(),
            'approved': qs.filter(status=ReportStatus.APPROVED).count(),
            'resolved': qs.filter(status=ReportStatus.RESOLVED).count(),
            'rejected': qs.filter(status=ReportStatus.REJECTED).count(),
        })

    @action(detail=False, methods=['get'])
    def leaderboard(self, request):
        """
        Returns the top barangays based on the number of resolved reports and resolution rate.
        Used for the Cleanest Barangay Leaderboard widget.
        """
        from django.db.models import Count, Q
        
        stats = GarbageReport.objects.exclude(barangay__isnull=True).values(
            'barangay__name'
        ).annotate(
            total=Count('id'),
            resolved=Count('id', filter=Q(status=ReportStatus.RESOLVED))
        )
        
        leaderboard_data = []
        for item in stats:
            total = item['total']
            resolved = item['resolved']
            rate = int((resolved / total) * 100) if total > 0 else 0
            
            # Simple scoring metric: heavily weight resolutions, lightly weight rate
            score = (resolved * 10) + rate
            
            leaderboard_data.append({
                'barangay': item['barangay__name'],
                'resolved': resolved,
                'total': total,
                'rate': rate,
                'score': score
            })
            
        # Sort by score descending and return top 5
        leaderboard_data.sort(key=lambda x: x['score'], reverse=True)
        
        for i, entry in enumerate(leaderboard_data):
            entry['rank'] = i + 1
            
        return Response(leaderboard_data[:5])

class CollectionConfirmationViewSet(viewsets.ModelViewSet):
    serializer_class = CollectionConfirmationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user or not user.is_authenticated:
            return CollectionConfirmation.objects.none()
        from accounts.permissions import is_admin_user
        if is_admin_user(user):
            return CollectionConfirmation.objects.select_related('confirmed_by', 'barangay', 'report').all()
        if user.role == 'brgy_official':
            if user.barangay_id:
                return CollectionConfirmation.objects.filter(barangay_id=user.barangay_id).select_related('confirmed_by', 'barangay', 'report')
            return CollectionConfirmation.objects.none()
        if user.role == 'watcher':
            if user.barangay_id:
                return CollectionConfirmation.objects.filter(
                    Q(barangay_id=user.barangay_id) | Q(confirmed_by=user)
                ).select_related('confirmed_by', 'barangay', 'report')
            return CollectionConfirmation.objects.filter(confirmed_by=user).select_related('confirmed_by', 'barangay', 'report')
        return CollectionConfirmation.objects.filter(confirmed_by=user).select_related('confirmed_by', 'barangay', 'report')

    def get_object(self):
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        pk_val = self.kwargs.get(lookup_url_kwarg)
        clean_id = parse_positive_id(pk_val)
        if clean_id is None:
            raise Http404("Confirmation not found.")
        self.kwargs[lookup_url_kwarg] = clean_id
        return super().get_object()

    def get_permissions(self):
        class IsAuthorizedCollector(permissions.BasePermission):
            def has_permission(self, request, view):
                if not request.user or not request.user.is_authenticated:
                    return False
                if request.method in permissions.SAFE_METHODS:
                    return True
                from accounts.permissions import is_admin_user
                if is_admin_user(request.user):
                    return True
                role = getattr(request.user, 'role', None)
                if role == 'watcher':
                    return bool(getattr(request.user, 'barangay_id', None))
                if role == 'brgy_official':
                    return bool(getattr(request.user, 'barangay_id', None))
                return False
        return [IsAuthorizedCollector()]

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        user = request.user
        from accounts.permissions import is_admin_user
        is_admin = is_admin_user(user)

        # Role enforcement for mutations
        if not is_admin and user.role not in ['brgy_official', 'watcher']:
            return Response(
                {'detail': f"Role '{user.role}' is not authorized to confirm waste collections."},
                status=status.HTTP_403_FORBIDDEN
            )

        if not is_admin and not user.barangay_id:
            return Response(
                {'detail': "Unassigned personnel cannot confirm waste collections."},
                status=status.HTTP_403_FORBIDDEN
            )

        if not isinstance(request.data, (dict, collections.abc.Mapping)):
            return Response({'detail': 'Invalid request body. Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

        if hasattr(request.data, 'getlist') and len(request.data.getlist('report')) > 1:
            return Response({'report': ['Invalid report ID format. Expected an integer.']}, status=status.HTTP_400_BAD_REQUEST)

        report_raw = request.data.get('report')
        locked_report = None

        if report_raw is not None and report_raw != '':
            # Validate malformed input (e.g. arrays, objects, booleans, negative, zero, floats)
            report_id = parse_positive_id(report_raw)
            if report_id is None:
                return Response({'report': ['Invalid report ID format. Expected an integer.']}, status=status.HTTP_400_BAD_REQUEST)

            try:
                locked_report = GarbageReport.objects.select_for_update().get(pk=report_id)
            except (GarbageReport.DoesNotExist, ValueError):
                return Response({'detail': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

            # Check barangay policy FIRST before checking status to avoid leaking report status
            if not is_admin:
                if not locked_report.barangay_id:
                    return Response(
                        {'detail': 'Report without an assigned barangay requires admin confirmation.'},
                        status=status.HTTP_403_FORBIDDEN
                    )
                if locked_report.barangay_id != user.barangay_id:
                    return Response(
                        {'detail': 'Cannot confirm collection for reports outside your assigned barangay.'},
                        status=status.HTTP_403_FORBIDDEN
                    )


            if locked_report.is_archived:
                return Response(
                    {'detail': 'Cannot confirm collection on an archived report.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            if locked_report.status == ReportStatus.RESOLVED:
                return Response(
                    {'detail': 'This report has already been confirmed / resolved.'},
                    status=status.HTTP_409_CONFLICT
                )

            if locked_report.status != ReportStatus.APPROVED:
                return Response(
                    {'detail': "Report must be in 'approved' status to confirm collection."},
                    status=status.HTTP_400_BAD_REQUEST
                )


        # Build and validate serializer before branching to ensure standalone confirmations work
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if locked_report:
            derived_barangay = locked_report.barangay
            confirmation = serializer.save(
                confirmed_by=user,
                barangay=derived_barangay,
                report=locked_report
            )

            now = timezone.now()
            # Record status transition history with actual previous status (APPROVED -> RESOLVED)
            # and non-identifying remarks (no username or email leaks)
            record_report_status_transition(
                locked_report,
                ReportStatus.RESOLVED,
                changed_by=user,
                remarks="Collection confirmed by staff",
                resolved_at=now
            )

            # Retire hotspot and cancel active dispatches (preserve collected/completed)
            from .services import retire_hotspot_and_cancel_active_dispatches
            retire_hotspot_and_cancel_active_dispatches(
                locked_report,
                cancelled_by=user,
                reason="Report resolved via collection confirmation."
            )

            # Send notification to the reporter
            if locked_report.user:
                Notification.objects.create(
                    user=locked_report.user,
                    title='Report Resolved',
                    message=f'Your {locked_report.get_issue_type_display()} report at {locked_report.address or "the reported location"} has been resolved.',
                    type=NotificationType.REPORT_UPDATE
                )

            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
        else:
            # Standalone confirmation (no specific report)
            derived_barangay = user.barangay if not is_admin else (serializer.validated_data.get('barangay') or user.barangay)
            confirmation = serializer.save(confirmed_by=user, barangay=derived_barangay)
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        return Response({'detail': 'Collection confirmation audit records cannot be modified.'}, status=status.HTTP_403_FORBIDDEN)

    def partial_update(self, request, *args, **kwargs):
        return Response({'detail': 'Collection confirmation audit records cannot be modified.'}, status=status.HTTP_403_FORBIDDEN)

    def destroy(self, request, *args, **kwargs):
        return Response({'detail': 'Collection confirmation audit records cannot be deleted.'}, status=status.HTTP_403_FORBIDDEN)

class GarbageHotspotViewSet(viewsets.ModelViewSet):
    serializer_class = GarbageHotspotSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = GarbageHotspot.objects.all()
        include_inactive = self.request.query_params.get('include_inactive', '').lower() in ['true', '1']
        from accounts.permissions import is_admin_user
        if not (include_inactive and is_admin_user(self.request.user)):
            qs = qs.filter(is_active=True)
        return qs

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if self.action in ('update', 'partial_update', 'destroy'):
            if request.user.role not in ['admin', 'brgy_official']:
                self.permission_denied(request, message="Not authorized to modify this hotspot.")

    def get_permissions(self):
        if self.action in ('create',):
            class IsAdminOrBrgyOfficial(permissions.BasePermission):
                def has_permission(self, request, view):
                    return request.user.is_authenticated and request.user.role in ['admin', 'brgy_official']
            return [IsAdminOrBrgyOfficial()]
        return super().get_permissions()

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.check_object_permissions(request, instance)
        from .services import retire_hotspot_and_cancel_active_dispatches
        retire_hotspot_and_cancel_active_dispatches(instance, cancelled_by=request.user, reason="Hotspot retired by staff.")
        return Response(status=status.HTTP_204_NO_CONTENT)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        # Sort by id to ensure stable anchor selection (lowest ID is always the anchor)
        data = sorted(serializer.data, key=lambda x: x['id'])
        
        CLUSTER_RADIUS_M = 15
        clustered = []
        SEVERITY_RANKS = {'low': 1, 'medium': 2, 'high': 3, 'critical': 4}
        
        for row in data:
            lat = float(row['latitude'])
            lng = float(row['longitude'])
            
            found_cluster = False
            for cluster in clustered:
                if haversine_km(lat, lng, float(cluster['latitude']), float(cluster['longitude'])) * 1000 <= CLUSTER_RADIUS_M:
                    cluster['report_count'] = cluster.get('report_count', 1) + 1
                    
                    if row.get('assigned_truck'):
                        cluster['assigned_truck'] = row['assigned_truck']
                        cluster['dispatch_acknowledged'] = row.get('dispatch_acknowledged')
                        cluster['dispatched_at'] = row.get('dispatched_at')
                        
                    # Escalate severity to max
                    if SEVERITY_RANKS.get(row.get('severity', 'low'), 1) > SEVERITY_RANKS.get(cluster.get('severity', 'low'), 1):
                        cluster['severity'] = row['severity']
                        
                    row_name = row.get('name', '')
                    cluster_name = cluster.get('name', '')
                    
                    def extract_type(name):
                        if '—' in name: return name.split('—')[-1].strip()
                        if '-' in name: return name.split('-')[-1].strip()
                        return name

                    row_type = extract_type(row_name)
                    cluster_type = extract_type(cluster_name)
                    
                    if row_type != cluster_type and cluster_type != 'Mixed':
                        cluster['name'] = f"{cluster.get('barangay_name', 'Unknown')} — Mixed"
                        cluster['type'] = 'Mixed'
                        
                    found_cluster = True
                    break
                    
            if not found_cluster:
                # Add type if not already there
                def extract_type(name):
                    if '—' in name: return name.split('—')[-1].strip()
                    if '-' in name: return name.split('-')[-1].strip()
                    return name
                row['type'] = extract_type(row.get('name', ''))
                clustered.append(row)
                
        return Response(clustered)

    @action(detail=False, methods=['get'], url_path='nearby')
    def nearby(self, request):
        """
        Returns hotspots within 5 km of the driver, sorted by distance.
        Query params: ?lat=<float>&lng=<float>
        Falls back to all active hotspots if no coords provided (capped at 50).
        """
        import math

        try:
            drv_lat = float(request.query_params.get('lat', 0))
            drv_lng = float(request.query_params.get('lng', 0))
            has_coords = bool(request.query_params.get('lat'))
        except ValueError:
            has_coords = False

        if has_coords:
            # Bounding box pre-filter (~5 km radius) — uses DB index on lat/lng columns
            RADIUS_KM = 5.0
            lat_delta = RADIUS_KM / 111.0
            lng_delta = RADIUS_KM / (111.0 * math.cos(math.radians(drv_lat)))
            qs = GarbageHotspot.objects.filter(
                is_active=True,
                latitude__range=(drv_lat - lat_delta, drv_lat + lat_delta),
                longitude__range=(drv_lng - lng_delta, drv_lng + lng_delta),
            ).select_related('barangay', 'assigned_truck')
        else:
            qs = GarbageHotspot.objects.filter(is_active=True).select_related('barangay', 'assigned_truck')[:50]

        data = []
        for h in qs:
            dist_km = haversine_km(drv_lat, drv_lng, float(h.latitude), float(h.longitude)) if has_coords else 0
            data.append({
                'id':                  h.id,
                'severity':            h.severity,
                'barangay':            h.barangay.name if h.barangay else 'Unknown',
                'address':             h.name,
                'description':         '',
                'distanceKm':          round(dist_km, 2),
                'reportedAt':          fmt_time(h.created_at),
                'type':                'overflow',
                'latitude':            float(h.latitude),
                'longitude':           float(h.longitude),
                'assigned_truck_id':   h.assigned_truck_id,
                'assigned_truck_plate':h.assigned_truck.plate_number if h.assigned_truck else None,
            })
        data.sort(key=lambda x: x['distanceKm'])
        return Response(data)

    @action(detail=False, methods=['get'], url_path='assigned')
    def assigned(self, request):
        """
        Returns hotspots assigned to the requesting driver's truck.
        The driver must have an active shift with an associated truck.
        """
        from driver.models import DriverShift
        shift = DriverShift.objects.filter(driver=request.user, is_active=True).select_related('truck').first()
        if not shift or not shift.truck:
            return Response([])
        qs = GarbageHotspot.objects.filter(
            is_active=True,
            assigned_truck=shift.truck
        ).select_related('barangay', 'assigned_truck')
        data = []
        for h in qs:
            data.append({
                'id':                  h.id,
                'severity':            h.severity,
                'barangay':            h.barangay.name if h.barangay else 'Unknown',
                'barangay_id':         h.barangay_id,
                'address':             h.name,
                'description':         '',
                'distanceKm':          None,
                'reportedAt':          fmt_time(h.created_at),
                'type':                'overflow',
                'latitude':            float(h.latitude),
                'longitude':           float(h.longitude),
                'assigned_truck_id':   h.assigned_truck_id,
                'assigned_truck_plate':h.assigned_truck.plate_number if h.assigned_truck else None,
                'dispatch_acknowledged': h.dispatch_acknowledged,
                'dispatched_at':         h.dispatched_at.isoformat() if h.dispatched_at else None,
            })
        return Response(data)

    @action(detail=True, methods=['get'], url_path='reports')
    def reports(self, request, pk=None):
        """Re-derives the cluster by proximity — do NOT trust a `count` field, it doesn't exist on the model."""
        hotspot = self.get_object()
        cluster_ids = get_cluster_ids(hotspot.latitude, hotspot.longitude, radius_m=15)
        
        nearby = GarbageHotspot.objects.filter(
            id__in=cluster_ids,
            source_report__isnull=False,
            is_active=True,
        ).select_related('source_report', 'source_report__user')

        def _get_url(img):
            if not img: return None
            try:
                u = img.url
                if u.startswith('res.cloudinary.com'): return f'https://{u}'
                if u.startswith('//res.cloudinary.com'): return f'https:{u}'
                if not u.startswith('http') and request: return request.build_absolute_uri(u)
                return u
            except Exception: return None

        reports_dict = {}
        for h in nearby:
            r = h.source_report
            if not is_viewer_authorized_for_report(request.user, r):
                if r.is_archived or r.status not in [ReportStatus.APPROVED, ReportStatus.RESOLVED]:
                    continue
                reported_by = 'Community Waste Report'
            else:
                reported_by = (r.user.full_name or r.user.get_full_name() or r.user.username) if r.user else 'Anonymous'

            if r.id not in reports_dict:
                reports_dict[r.id] = {
                    'id': r.id, 'issue_type': r.issue_type, 'severity': r.severity,
                    'status': r.status, 'address': r.address, 'description': r.description,
                    'latitude': float(r.latitude) if r.latitude else None,
                    'longitude': float(r.longitude) if r.longitude else None,
                    'reported_by': reported_by,
                    'created_at': r.created_at.isoformat(),
                    'images': [_get_url(img) for img in [r.image, r.image_2, r.image_3, r.image_4] if img],
                }
        reports = list(reports_dict.values())
        reports.sort(key=lambda x: x['created_at'], reverse=True)
        return Response(reports)

    @action(detail=True, methods=['get'], url_path='recommend-trucks')
    def recommend_trucks(self, request, pk=None):
        from driver.models import DriverShift, Truck, TruckStatus
        hotspot = self.get_object()

        shifts = DriverShift.objects.filter(is_active=True, truck__isnull=False)\
            .select_related('truck', 'schedule', 'driver').prefetch_related('schedule__barangays')

        scored = []
        seen_trucks = set()
        for shift in shifts:
            truck = shift.truck
            if truck.status != TruckStatus.ACTIVE:
                continue
            if truck.id in seen_trucks:
                continue
            seen_trucks.add(truck.id)
            if shift.schedule and hotspot.barangay in shift.schedule.barangays.all():
                score = 0
            elif truck.zone and hotspot.barangay and truck.zone.strip().lower() == hotspot.barangay.name.strip().lower():
                score = 1  # fallback — zone is freeform text, not FK'd to Barangay
            else:
                score = 2
            scored.append((score, truck, shift))

        scored.sort(key=lambda x: x[0])
        return Response([{
            'id': t.id, 'plate_number': t.plate_number, 'model': t.model, 'zone': t.zone,
            'driver_name': s.driver.get_full_name() or s.driver.username,
            'capacity': t.current_capacity,
            'match': ['schedule', 'zone', 'other'][sc],
        } for sc, t, s in scored])

    @action(detail=True, methods=['post'], url_path='assign-truck')
    def assign_truck(self, request, pk=None):
        from driver.models import Truck, TruckStatus
        if request.user.role not in ('admin', 'brgy_official'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Only admins can assign trucks to hotspots.')
        hotspot = self.get_object()
        truck_id = request.data.get('truck_id')
        
        cluster_ids = get_cluster_ids(hotspot.latitude, hotspot.longitude, radius_m=15)
        cluster_qs = GarbageHotspot.objects.filter(id__in=cluster_ids)

        if truck_id:
            try:
                truck = Truck.objects.get(id=truck_id, status=TruckStatus.ACTIVE)
            except Truck.DoesNotExist:
                return Response({'error': 'Truck not found or not active.'}, status=404)
            from django.utils import timezone
            cluster_qs.update(
                assigned_truck=truck,
                dispatch_acknowledged=False,
                dispatched_at=timezone.now()
            )
            from .models import HotspotIntervention, InterventionType, InterventionStatus
            HotspotIntervention.objects.filter(
                hotspot=hotspot, 
                intervention_type=InterventionType.DISPATCH,
                status__in=[InterventionStatus.CREATED, InterventionStatus.ACKNOWLEDGED]
            ).update(status=InterventionStatus.CANCELLED)
            intervention = HotspotIntervention.objects.create(
                hotspot=hotspot,
                intervention_type=InterventionType.DISPATCH,
                status=InterventionStatus.CREATED,
                truck=truck,
                created_by=request.user
            )
            hotspot.refresh_from_db()
        else:
            cluster_qs.update(
                assigned_truck=None,
                dispatch_acknowledged=True,
                dispatched_at=None
            )
            from .models import HotspotIntervention, InterventionType, InterventionStatus
            HotspotIntervention.objects.filter(
                hotspot=hotspot, 
                intervention_type=InterventionType.DISPATCH,
                status__in=[InterventionStatus.CREATED, InterventionStatus.ACKNOWLEDGED]
            ).update(status=InterventionStatus.CANCELLED)
            hotspot.refresh_from_db()
            intervention = None
            
        from .serializers import HotspotInterventionSerializer
        return Response({
            'status': 'ok', 'id': hotspot.id,
            'assigned_truck_id': hotspot.assigned_truck_id,
            'assigned_truck_plate': hotspot.assigned_truck.plate_number if hotspot.assigned_truck else None,
            'intervention': HotspotInterventionSerializer(intervention).data if intervention else None,
        })

    @action(detail=True, methods=['post'], url_path='acknowledge-dispatch')
    def acknowledge_dispatch(self, request, pk=None):
        hotspot = self.get_object()
        if hotspot.assigned_truck_id is None:
            return Response({'error': 'No active dispatch on this hotspot.'}, status=400)
            
        if request.user.role != 'admin':
            from driver.models import DriverShift
            shift = DriverShift.objects.filter(driver=request.user, is_active=True, truck=hotspot.assigned_truck).first()
            if not shift:
                return Response({'error': 'Not your dispatch.'}, status=403)

        cluster_ids = get_cluster_ids(hotspot.latitude, hotspot.longitude, radius_m=15)
        GarbageHotspot.objects.filter(id__in=cluster_ids).update(dispatch_acknowledged=True)
        
        from .models import HotspotIntervention, InterventionType, InterventionStatus
        from django.utils import timezone
        active_dispatch = HotspotIntervention.objects.filter(
            hotspot=hotspot,
            intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.CREATED
        ).first()
        if active_dispatch:
            active_dispatch.status = InterventionStatus.ACKNOWLEDGED
            active_dispatch.acknowledged_by = request.user
            active_dispatch.acknowledged_at = timezone.now()
            active_dispatch.save()
            
        return Response({'status': 'acknowledged'})

    @action(detail=True, methods=['post'], url_path='flag-to-brgy')
    def flag_to_brgy(self, request, pk=None):
        """
        Notify Barangay officials about a persistent hotspot.
        """
        if request.user.role not in ('admin', 'brgy_official'):
            return Response({'error': 'Not authorized'}, status=403)

        hotspot = self.get_object()
        if not hotspot.barangay:
            return Response({'error': 'Hotspot has no associated barangay.'}, status=400)

        from notifications.models import Notification, NotificationType
        from django.contrib.auth import get_user_model

        User = get_user_model()
        officials = User.objects.filter(role='brgy_official', barangay=hotspot.barangay)
        notifications = []
        for off in officials:
            notifications.append(
                Notification(
                    user=off,
                    type=NotificationType.REPORT_UPDATE,
                    title='Hotspot Flagged by Admin',
                    message=f"Admin flagged a hotspot in {hotspot.barangay.name} ({hotspot.severity.upper()} severity) for your attention."
                )
            )
        if notifications:
            Notification.objects.bulk_create(notifications)

        from .models import HotspotIntervention, InterventionType, InterventionStatus
        HotspotIntervention.objects.filter(
            hotspot=hotspot, 
            intervention_type=InterventionType.FLAG,
            status__in=[InterventionStatus.FLAGGED, InterventionStatus.ACKNOWLEDGED]
        ).update(status=InterventionStatus.CANCELLED)
        
        intervention = HotspotIntervention.objects.create(
            hotspot=hotspot,
            intervention_type=InterventionType.FLAG,
            status=InterventionStatus.FLAGGED,
            created_by=request.user
        )

        from .serializers import HotspotInterventionSerializer
        return Response({
            'status': 'flagged',
            'intervention': HotspotInterventionSerializer(intervention).data
        })

    @action(detail=True, methods=['post'], url_path='noted')
    def noted(self, request, pk=None):
        """Mark that the driver has noted this hotspot. No model changes needed — returns 200."""
        return Response({'status': 'noted', 'id': pk})

class StopValidationViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Centralized stop validation workflow API.
    GET  /api/watcher/stop-validations/
    POST /api/watcher/stop-validations/pre-inspect/
    POST /api/watcher/stop-validations/post-verify/
    """
    queryset = StopValidation.objects.select_related(
        'schedule', 'schedule__truck', 'driver',
        'pre_validation_watcher', 'post_validation_watcher',
    ).prefetch_related('schedule__barangays')
    serializer_class = StopValidationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        # Allow public read access to the list endpoint for the citizen map
        if self.action == 'list':
            return [permissions.AllowAny()]
        return super().get_permissions()

    def get_queryset(self):
        ensure_today_stop_validations()
        qs = super().get_queryset()
        
        start_date_param = self.request.query_params.get('start_date')
        end_date_param = self.request.query_params.get('end_date')
        date_param = self.request.query_params.get('date')
        
        from django.utils.dateparse import parse_date
        
        if start_date_param and end_date_param:
            start_date = parse_date(start_date_param)
            end_date = parse_date(end_date_param)
            if start_date and end_date:
                qs = qs.filter(collection_date__range=(start_date, end_date))
        elif date_param:
            target_date = parse_date(date_param) or timezone.localdate()
            qs = qs.filter(collection_date=target_date)
        else:
            qs = qs.filter(collection_date=timezone.localdate())

        user = self.request.user
        if user.is_authenticated and getattr(user, 'role', None) == 'watcher' and getattr(user, 'barangay', None):
            qs = qs.filter(barangay=user.barangay)

        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(current_status=status_param)

        schedule_id = self.request.query_params.get('schedule_id')
        if schedule_id:
            qs = qs.filter(schedule_id=schedule_id)

        visible = [sv.id for sv in qs if is_validation_visible(sv)]
        return qs.filter(id__in=visible)

    def _get_validation(self, schedule_id, stop_order):
        today = timezone.localdate()
        try:
            return StopValidation.objects.select_related('schedule', 'schedule__truck', 'schedule__driver').get(
                schedule_id=schedule_id,
                stop_order=stop_order,
                collection_date=today,
            )
        except StopValidation.DoesNotExist:
            return None

    def _update_driver_timeline(self, validation):
        driver = validation.schedule.driver
        if not driver:
            return

        # Check if all stops in schedule are completed
        all_stops = StopValidation.objects.filter(schedule=validation.schedule, collection_date=validation.collection_date)
        pending = all_stops.exclude(current_status__in=[
            StopValidationStatus.VERIFIED_COLLECTED, 
            StopValidationStatus.COLLECTION_DISPUTED,
            StopValidationStatus.EMPTY_STOP
        ])
        
        is_completed = not pending.exists() and all_stops.exists()

        # Build full timeline
        timeline = []
        for stop in all_stops.order_by('stop_order'):
            if stop.current_status == StopValidationStatus.PENDING_INSPECTION:
                continue
                
            # Formulate the string based on status
            st = stop.current_status
            val_text = "Verified"
            if st == StopValidationStatus.EMPTY_STOP:
                val_text = "Empty"
            elif st == StopValidationStatus.VERIFIED_COLLECTED:
                if stop.pre_validation_remarks or stop.dispute_reason:
                    val_text = "Present"
                else:
                    val_text = "Collected"
            elif st == StopValidationStatus.COLLECTION_DISPUTED:
                val_text = "Missed"
            elif st == StopValidationStatus.READY_FOR_COLLECTION:
                if stop.pre_validation_remarks or stop.pre_validation_photo:
                    val_text = "Present"
                else:
                    val_text = "Inspected"
                    
            # Get image
            img_url = None
            if stop.post_validation_photo:
                img_url = stop.post_validation_photo.url
            elif stop.pre_validation_photo:
                img_url = stop.pre_validation_photo.url
                
            # Get timestamp
            ts = stop.post_validation_timestamp or stop.pre_validation_timestamp or timezone.now()
                
            timeline.append({
                "stop_order": stop.stop_order,
                "status": val_text,
                "image": img_url,
                "timestamp": ts.isoformat()
            })
            
        if not timeline:
            return

        today = timezone.localdate()
        notif = Notification.objects.filter(
            user=driver,
            type=NotificationType.WATCHER_ROUTE_SUMMARY,
            created_at__date=today
        ).first()
        
        msg_data = {
            "type": "summary",
            "watcher_name": self.request.user.full_name,
            "truck_name": validation.schedule.truck.plate_number if validation.schedule.truck else "Truck",
            "timeline": timeline,
        }
        
        title = "Route Confirmation Complete" if is_completed else "Watcher Route updates"
        
        if notif:
            notif.title = title
            notif.message = json.dumps(msg_data)
            notif.created_at = timezone.now()
            notif.is_read = False
            notif.save()
        else:
            Notification.objects.create(
                user=driver,
                title=title,
                message=json.dumps(msg_data),
                type=NotificationType.WATCHER_ROUTE_SUMMARY
            )
            
        self._send_driver_notification(driver, title, msg_data)

    def _send_driver_notification(self, driver, title, msg_data):
        # External calls like WebSockets or Push Notifications go here.
        # This executes outside the atomic block in the views.
        pass


    @action(detail=False, methods=['post'], url_path='pre-inspect')
    def pre_inspect(self, request):
        """
        Watcher pre-collection inspection.
        outcome: garbage_present | no_garbage
        """
        if request.user.role not in ('watcher', 'admin', 'brgy_official'):
            return Response({'error': 'Not authorized.'}, status=status.HTTP_403_FORBIDDEN)

        schedule_id = request.data.get('schedule_id')
        stop_order = request.data.get('stop_order')
        outcome_raw = (request.data.get('outcome') or '').strip().lower()
        if outcome_raw == 'present':
            outcome = 'garbage_present'
        elif outcome_raw == 'empty':
            outcome = 'no_garbage'
        else:
            outcome = outcome_raw

        lat = request.data.get('lat')
        lng = request.data.get('lng')
        remarks = (request.data.get('notes') or request.data.get('remarks') or '').strip()
        photo = request.FILES.get('photo')
        photo_2 = request.FILES.get('photo_2')
        photo_3 = request.FILES.get('photo_3')
        photo_4 = request.FILES.get('photo_4')

        if not schedule_id or stop_order is None:
            return Response({'error': 'schedule_id and stop_order are required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            stop_order = int(stop_order)
        except (TypeError, ValueError):
            return Response({'error': 'stop_order must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)

        if outcome not in ('garbage_present', 'no_garbage'):
            return Response({'error': 'outcome must be garbage_present or no_garbage.'}, status=status.HTTP_400_BAD_REQUEST)

        validation = self._get_validation(schedule_id, stop_order)
        if not validation:
            return Response({'error': 'Stop validation not found for today.'}, status=status.HTTP_404_NOT_FOUND)
            
        if validation.current_status == StopValidationStatus.READY_FOR_COLLECTION:
            return Response(
                StopValidationSerializer(validation, context={'request': request}).data,
                status=status.HTTP_200_OK
            )
            
        if validation.current_status != StopValidationStatus.PENDING_INSPECTION:
            return Response({'error': 'Stop is not pending inspection.'}, status=status.HTTP_400_BAD_REQUEST)

        coords = get_stop_coordinates(validation.schedule, stop_order)
        if not coords:
            return Response({'error': 'Stop coordinates not found.'}, status=status.HTTP_400_BAD_REQUEST)
        ok, err = validate_gps_proximity(lat, lng, coords[0], coords[1], INSPECTION_RADIUS_M)
        if not ok:
            return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            validation.pre_validation_watcher = request.user
            validation.pre_validation_timestamp = timezone.now()
            validation.pre_validation_latitude = lat
            validation.pre_validation_longitude = lng
            validation.pre_validation_remarks = remarks
            if photo: validation.pre_validation_photo = photo
            if photo_2: validation.pre_validation_photo_2 = photo_2
            if photo_3: validation.pre_validation_photo_3 = photo_3
            if photo_4: validation.pre_validation_photo_4 = photo_4
            validation.current_status = (
                StopValidationStatus.READY_FOR_COLLECTION
                if outcome == 'garbage_present'
                else StopValidationStatus.EMPTY_STOP
            )
            validation.save()

            # Update the driver timeline inside atomic
            self._update_driver_timeline(validation)

        return Response(
            StopValidationSerializer(validation, context={'request': request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=['post'], url_path='post-verify')
    def post_verify(self, request):
        """
        Watcher post-collection verification.
        outcome: success | failed
        """
        if request.user.role not in ('watcher', 'admin', 'brgy_official'):
            return Response({'error': 'Not authorized.'}, status=status.HTTP_403_FORBIDDEN)

        schedule_id = request.data.get('schedule_id')
        stop_order = request.data.get('stop_order')
        outcome = (request.data.get('outcome') or '').strip().lower()
        lat = request.data.get('lat')
        lng = request.data.get('lng')
        dispute_reason = (request.data.get('dispute_reason') or request.data.get('notes') or request.data.get('description') or '').strip()
        photo = request.FILES.get('photo')
        photo_2 = request.FILES.get('photo_2')
        photo_3 = request.FILES.get('photo_3')
        photo_4 = request.FILES.get('photo_4')

        if not schedule_id or stop_order is None:
            return Response({'error': 'schedule_id and stop_order are required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            stop_order = int(stop_order)
        except (TypeError, ValueError):
            return Response({'error': 'stop_order must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)

        if outcome not in ('success', 'failed'):
            return Response({'error': 'outcome must be success or failed.'}, status=status.HTTP_400_BAD_REQUEST)
        if outcome == 'failed' and not dispute_reason:
            return Response({'error': 'A reason is required when collection is marked as missed.'}, status=status.HTTP_400_BAD_REQUEST)

        validation = self._get_validation(schedule_id, stop_order)
        if not validation:
            return Response({'error': 'Stop validation not found for today.'}, status=status.HTTP_404_NOT_FOUND)
            
        if validation.current_status in (StopValidationStatus.VERIFIED_COLLECTED, StopValidationStatus.COLLECTION_DISPUTED):
            return Response(
                StopValidationSerializer(validation, context={'request': request}).data,
                status=status.HTTP_200_OK
            )
            
        if validation.current_status not in (
            StopValidationStatus.COLLECTION_REPORTED, 
            StopValidationStatus.READY_FOR_COLLECTION, 
            StopValidationStatus.PENDING_INSPECTION,
        ):
            return Response({'error': 'Stop cannot be verified.'}, status=status.HTTP_400_BAD_REQUEST)

        coords = get_stop_coordinates(validation.schedule, stop_order)
        if not coords:
            return Response({'error': 'Stop coordinates not found.'}, status=status.HTTP_400_BAD_REQUEST)
        ok, err = validate_gps_proximity(lat, lng, coords[0], coords[1], VERIFICATION_RADIUS_M)
        if not ok:
            return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            validation.post_validation_watcher = request.user
            validation.post_validation_timestamp = timezone.now()
            validation.post_validation_latitude = lat
            validation.post_validation_longitude = lng
            validation.dispute_reason = dispute_reason if outcome == 'failed' else ''
            if photo: validation.post_validation_photo = photo
            if photo_2: validation.post_validation_photo_2 = photo_2
            if photo_3: validation.post_validation_photo_3 = photo_3
            if photo_4: validation.post_validation_photo_4 = photo_4
            validation.current_status = (
                StopValidationStatus.VERIFIED_COLLECTED
                if outcome == 'success'
                else StopValidationStatus.COLLECTION_DISPUTED
            )
            validation.save()

            self._update_driver_timeline(validation)

            # WATCHER_FLAG trigger: driver reported collection but watcher disputes it.
            # This implies a falsely reported stop → penalize & add to missed pool.
            if outcome == 'failed' and validation.schedule_id:
                try:
                    from driver.missed_stop_service import create_missed_stops
                    from driver.models import MissedStopReason
                    create_missed_stops(
                        validation.schedule,
                        [stop_order],
                        reason=MissedStopReason.WATCHER_FLAG,
                    )
                except Exception:
                    pass  # Non-fatal — don't let a service error block the verification response

        return Response(
            StopValidationSerializer(validation, context={'request': request}).data,
            status=status.HTTP_200_OK,
        )


class EscalationViewSet(viewsets.ModelViewSet):
    queryset = Escalation.objects.all().select_related('barangay', 'assignee', 'driver', 'truck').order_by('-created_at')
    serializer_class = EscalationSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        class IsAdminOrBrgyOfficialOrDriver(permissions.BasePermission):
            def has_permission(self, request, view):
                if not request.user or not request.user.is_authenticated:
                    return False
                if request.user.role in ['admin', 'brgy_official'] or request.user.is_staff or request.user.is_superuser:
                    return True
                if request.user.role == 'driver':
                    if request.method in permissions.SAFE_METHODS or view.action == 'acknowledge':
                        return True
                return False
        return [IsAdminOrBrgyOfficialOrDriver()]

    def get_base_accessible_queryset(self):
        user = self.request.user
        qs = Escalation.objects.all().select_related('barangay', 'assignee', 'driver', 'truck').order_by('-created_at')
        if getattr(user, 'role', None) == 'admin' or getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False):
            return qs
        if getattr(user, 'role', None) == 'brgy_official' and getattr(user, 'barangay', None):
            return qs.filter(barangay=user.barangay)
        if getattr(user, 'role', None) == 'driver':
            return qs.filter(driver=user)
        return qs.none()

    def get_queryset(self):
        qs = self.get_base_accessible_queryset()
        
        status_param = self.request.query_params.get('status')
        if status_param and status_param.lower() != 'all':
            qs = qs.filter(status=status_param.lower())

        priority_param = self.request.query_params.get('priority')
        if priority_param and priority_param.lower() != 'all':
            qs = qs.filter(priority=priority_param.lower())
            
        driver_ack_param = self.request.query_params.get('driver_acknowledged')
        if driver_ack_param is not None:
            is_ack = driver_ack_param.lower() in ['true', '1', 't', 'y', 'yes']
            qs = qs.filter(driver_acknowledged=is_ack)

        search_query = self.request.query_params.get('search', '').strip()
        if search_query:
            qs = qs.filter(
                Q(reason__icontains=search_query) |
                Q(resolution_notes__icontains=search_query) |
                Q(barangay__name__icontains=search_query) |
                Q(driver__full_name__icontains=search_query) |
                Q(driver__username__icontains=search_query) |
                Q(truck__plate_number__icontains=search_query)
            )

        return qs

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        if getattr(self, 'paginator', None) is not None:
            base_accessible = self.get_base_accessible_queryset()
            summary_agg = base_accessible.aggregate(
                total=Count('id'),
                pending=Count('id', filter=Q(status='pending')),
                approved=Count('id', filter=Q(status='approved')),
                rejected=Count('id', filter=Q(status='rejected')),
                resolved=Count('id', filter=Q(status='resolved')),
            )
            self.paginator.extra_data = {'summary': summary_agg}

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['patch'])
    def acknowledge(self, request, pk=None):
        escalation = self.get_object()
        
        # Security: only the penalized driver can acknowledge their own write-up
        if escalation.driver != request.user:
            return Response({"error": "You can only acknowledge your own escalations."}, status=status.HTTP_403_FORBIDDEN)
            
        if escalation.status != 'approved':
            return Response({"error": "Only approved escalations require acknowledgment."}, status=status.HTTP_400_BAD_REQUEST)
            
        escalation.driver_acknowledged = True
        escalation.save(update_fields=['driver_acknowledged'])
        
        return Response({"message": "Escalation acknowledged."})

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        escalation = self.get_object()
        escalation.status = 'resolved'
        escalation.save()
        return Response(self.get_serializer(escalation).data)

class HotspotInterventionViewSet(mixins.RetrieveModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    from .models import HotspotIntervention
    queryset = HotspotIntervention.objects.select_related('hotspot', 'truck', 'created_by', 'acknowledged_by', 'resolved_by').all()
    from .serializers import HotspotInterventionSerializer
    serializer_class = HotspotInterventionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        from .models import InterventionType

        if user.role == 'admin':
            pass
        elif user.role == 'brgy_official' and user.barangay_id:
            qs = qs.filter(intervention_type=InterventionType.FLAG, hotspot__barangay_id=user.barangay_id)
        elif user.role == 'driver':
            from driver.models import DriverShift
            shift = DriverShift.objects.filter(driver=user, is_active=True).select_related('truck').first()
            if shift and shift.truck:
                qs = qs.filter(hotspot__is_active=True, intervention_type=InterventionType.DISPATCH, truck=shift.truck)
            else:
                qs = qs.none()
        else:
            qs = qs.none()

        type_param = self.request.query_params.get('type')
        if type_param:
            qs = qs.filter(intervention_type=type_param)
        status_param = self.request.query_params.get('status')
        if status_param:
            statuses = status_param.split(',')
            qs = qs.filter(status__in=statuses)
        return qs

    @action(detail=False, methods=['get'], url_path='mine')
    def mine(self, request):
        if request.user.role != 'brgy_official':
            return Response([])
        return Response(self.get_serializer(self.get_queryset(), many=True).data)

    @action(detail=False, methods=['get'], url_path='driver')
    def driver(self, request):
        if request.user.role != 'driver':
            return Response([])
        from .models import InterventionStatus
        qs = self.get_queryset().filter(
            hotspot__is_active=True,
            status__in=[InterventionStatus.CREATED, InterventionStatus.ACKNOWLEDGED]
        )
        return Response(self.get_serializer(qs, many=True).data)

    def _clear_dispatch_fields(self, hotspot):
        from .models import GarbageHotspot
        cluster_ids = get_cluster_ids(hotspot.latitude, hotspot.longitude, radius_m=15)
        GarbageHotspot.objects.filter(id__in=cluster_ids).update(
            assigned_truck=None, dispatch_acknowledged=True, dispatched_at=None
        )

    @action(detail=True, methods=['post'], url_path='acknowledge')
    def acknowledge(self, request, pk=None):
        from .models import InterventionType, InterventionStatus
        from django.utils import timezone
        intervention = self.get_object()
        
        if request.user.role != 'admin':
            if intervention.intervention_type == InterventionType.DISPATCH:
                from driver.models import DriverShift
                shift = DriverShift.objects.filter(driver=request.user, is_active=True, truck=intervention.truck).first()
                if not shift:
                    return Response({'error': 'Not your dispatch.'}, status=403)
            elif intervention.intervention_type == InterventionType.FLAG:
                if request.user.role != 'brgy_official' or intervention.hotspot.barangay_id != request.user.barangay_id:
                    return Response({'error': 'Not your barangay.'}, status=403)

        intervention.status = InterventionStatus.ACKNOWLEDGED
        intervention.acknowledged_by = request.user
        intervention.acknowledged_at = timezone.now()
        intervention.save()
        return Response({'status': 'ok'})

    @action(detail=True, methods=['post'], url_path='resolve')
    def resolve(self, request, pk=None):
        from .models import InterventionType, InterventionStatus
        from django.utils import timezone
        intervention = self.get_object()
        
        if request.user.role != 'admin':
            if intervention.intervention_type == InterventionType.DISPATCH:
                from driver.models import DriverShift
                shift = DriverShift.objects.filter(driver=request.user, is_active=True, truck=intervention.truck).first()
                if not shift:
                    return Response({'error': 'Not your dispatch.'}, status=403)
            elif intervention.intervention_type == InterventionType.FLAG:
                if request.user.role != 'brgy_official' or intervention.hotspot.barangay_id != request.user.barangay_id:
                    return Response({'error': 'Not your barangay.'}, status=403)

        intervention.status = InterventionStatus.RESOLVED if intervention.intervention_type == InterventionType.FLAG else InterventionStatus.COLLECTED
        intervention.resolved_by = request.user
        intervention.resolved_at = timezone.now()
        intervention.resolution_notes = request.data.get('notes', '')
        intervention.save()
        
        if intervention.intervention_type == InterventionType.DISPATCH:
            self._clear_dispatch_fields(intervention.hotspot)
            
        return Response({'status': 'ok'})

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        from .models import InterventionType, InterventionStatus
        if request.user.role != 'admin':
            return Response({'error': 'Only admins can cancel'}, status=403)
        intervention = self.get_object()
        intervention.status = InterventionStatus.CANCELLED
        intervention.save()
        
        if intervention.intervention_type == InterventionType.DISPATCH:
            self._clear_dispatch_fields(intervention.hotspot)
            
        return Response({'status': 'ok'})




class WatcherReportedSpotViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Centralized API for Watcher Reported Spots.
    GET  /api/watcher/spots/
    GET  /api/watcher/spots/{id}/
    POST /api/watcher/spots/{id}/reject/
    POST /api/watcher/spots/{id}/add-to-route/
    GET  /api/watcher/spots/{id}/reports/
    """
    queryset = WatcherReportedSpot.objects.select_related('barangay', 'first_reported_by', 'rejected_by').prefetch_related('reports')
    serializer_class = WatcherReportedSpotSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not can_view_watcher_spots(user):
            return WatcherReportedSpot.objects.none()

        qs = super().get_queryset()

        status_param = self.request.query_params.get('status')
        if status_param and status_param.lower() != 'all':
            qs = qs.filter(status=status_param.lower())
        elif not status_param:
            # Default to active spots
            qs = qs.filter(status=WatcherSpotStatus.ACTIVE)

        barangay_param = self.request.query_params.get('barangay')
        if barangay_param:
            if str(barangay_param).isdigit():
                qs = qs.filter(barangay_id=int(barangay_param))
            else:
                qs = qs.filter(barangay__name__iexact=str(barangay_param).strip())

        # Proximity to schedule route (for Watcher / Route Builder)
        schedule_id = self.request.query_params.get('schedule_id')
        if schedule_id:
            from driver.models import CollectionSchedule
            try:
                sched = CollectionSchedule.objects.get(pk=schedule_id)
                route_pts = route_points_for_schedule(sched)
                if route_pts:
                    matched_ids = []
                    for spot in qs:
                        d = distance_to_route_m(spot.latitude, spot.longitude, route_pts)
                        if d is not None and d <= WATCHER_SPOT_ROUTE_RADIUS_M:
                            matched_ids.append(spot.id)
                    qs = qs.filter(id__in=matched_ids)
            except CollectionSchedule.DoesNotExist:
                pass

        # Filter by nearby coordinates (?lat=...&lng=...&radius_m=...)
        lat = self.request.query_params.get('lat')
        lng = self.request.query_params.get('lng')
        if lat and lng:
            try:
                plat, plng = float(lat), float(lng)
                rad = float(self.request.query_params.get('radius_m', WATCHER_SPOT_ROUTE_RADIUS_M))
                matched_ids = []
                from watcher.stop_validation_utils import haversine_m
                for spot in qs:
                    if haversine_m(plat, plng, spot.latitude, spot.longitude) <= rad:
                        matched_ids.append(spot.id)
                qs = qs.filter(id__in=matched_ids)
            except (ValueError, TypeError):
                pass

        return qs

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def reject(self, request, pk=None):
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Spot not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_admin_user(request.user) and getattr(request.user, 'role', None) != 'brgy_official':
            return Response({'error': 'Not authorized to reject watcher spots.'}, status=status.HTTP_403_FORBIDDEN)

        reason = str(request.data.get('reason') or request.data.get('rejection_reason') or '').strip()
        if not reason:
            return Response({'error': 'Rejection reason is required.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                spot = WatcherReportedSpot.objects.select_for_update().get(pk=clean_pk)
            except WatcherReportedSpot.DoesNotExist:
                return Response({'error': 'Spot not found.'}, status=status.HTTP_404_NOT_FOUND)

            spot.status = WatcherSpotStatus.REJECTED
            spot.rejected_by = request.user
            spot.rejected_at = timezone.now()
            spot.rejection_reason = reason
            spot.save(update_fields=['status', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at'])

            # Also reject all linked reports and retire associated hotspots
            linked_reports = spot.reports.filter(status=ReportStatus.APPROVED)
            for rep in linked_reports:
                rep.rejected_by = request.user
                rep.rejected_at = timezone.now()
                rep.rejection_reason = reason
                record_report_status_transition(
                    rep,
                    ReportStatus.REJECTED,
                    changed_by=request.user,
                    remarks=f"Watcher spot rejected: {reason}",
                )
                from .services import retire_hotspot_and_cancel_active_dispatches
                retire_hotspot_and_cancel_active_dispatches(rep, cancelled_by=request.user, reason=f"Watcher spot rejected: {reason}")

        serializer = self.get_serializer(spot)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def add_to_route(self, request, pk=None):
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Spot not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_admin_user(request.user):
            return Response({'error': 'Only admins can add spots to routes.'}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            try:
                spot = WatcherReportedSpot.objects.select_for_update().get(pk=clean_pk)
            except WatcherReportedSpot.DoesNotExist:
                return Response({'error': 'Spot not found.'}, status=status.HTTP_404_NOT_FOUND)

            spot.status = WatcherSpotStatus.ADDED_TO_ROUTE
            spot.save(update_fields=['status', 'updated_at'])

        serializer = self.get_serializer(spot)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def reports(self, request, pk=None):
        clean_pk = parse_positive_id(pk)
        if clean_pk is None:
            return Response({'error': 'Spot not found.'}, status=status.HTTP_404_NOT_FOUND)

        spot = self.get_object()
        reports = spot.reports.select_related('user', 'barangay').order_by('-created_at')
        serializer = GarbageReportSerializer(reports, many=True, context={'request': request})
        return Response(serializer.data)
