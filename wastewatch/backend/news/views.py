from rest_framework import viewsets, permissions, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q, Case, When, Value, IntegerField, Max, Count
from django.core.cache import cache

from accounts.permissions import IsAdminRole, IsAdminRoleOrReadOnly, is_admin_user
from .models import NewsItem, EmergencyAlert, BarangaySpotlight, ContentStatus, NewsType, Priority
from .serializers import (
    NewsItemSerializer,
    EmergencyAlertSerializer,
    BarangaySpotlightSerializer,
)
from notifications.services import notify_announcement, notify_emergency_alert, update_emergency_alert
from django.db import transaction
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver


def get_news_cache_version():
    return cache.get('news_cache_ver', 1)


def bump_news_cache_version():
    try:
        cache.incr('news_cache_ver')
    except (ValueError, Exception):
        cache.set('news_cache_ver', 2)


def build_news_feed_cache_key(request, ver=None):
    """
    Constructs canonical, collision-free, and Memcached-safe cache keys
    for anonymous news and announcements feed listings.
    """
    if ver is None:
        ver = get_news_cache_version()
    search_param = (request.query_params.get('search') or request.query_params.get('q') or '').strip().lower().replace(' ', '_')
    category_param = (request.query_params.get('category') or '').strip().lower().replace(' ', '_')
    return (
        f"news_feed_v{ver}_b{request.query_params.get('barangay_id')}_"
        f"cw{request.query_params.get('city_wide')}_t{request.query_params.get('type')}_"
        f"c{category_param}_pr{request.query_params.get('priority')}_"
        f"p{request.query_params.get('pinned')}_s{search_param}_"
        f"page{request.query_params.get('page', '1')}_ps{request.query_params.get('page_size', '10')}_"
        f"o{request.query_params.get('ordering', '')}"
    )


@receiver(post_save, sender=NewsItem)
@receiver(post_delete, sender=NewsItem)
@receiver(post_save, sender=EmergencyAlert)
@receiver(post_delete, sender=EmergencyAlert)
def on_news_content_change(sender, **kwargs):
    bump_news_cache_version()


class PaginatedDict(dict):
    """
    Paginated dictionary supporting both direct iteration (for backwards compatibility)
    and standard DRF paginated structure ('count', 'next', 'previous', 'results').
    """
    def __iter__(self):
        return iter(self.get('results', []))


class NewsPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 30

    def get_page_size(self, request):
        if self.page_size_query_param:
            try:
                val = int(request.query_params[self.page_size_query_param])
                if val in (10, 20, 30):
                    return val
                elif val > 0:
                    return min(val, self.max_page_size)
            except (KeyError, ValueError, TypeError):
                pass
        return self.page_size

    def get_paginated_response(self, data):
        return Response(PaginatedDict({
            'count': self.page.paginator.count,
            'next': self.get_next_link(),
            'previous': self.get_previous_link(),
            'results': data,
        }))


CATEGORY_TAXONOMY_MAP = {
    'all': None,
    'all notices': None,
    'announcements': ['Announcements', 'announcement'],
    'service updates': ['Service Updates'],
    'cleanup drives': ['Cleanup Drives'],
    'advisories': ['Advisories', 'Emergencies', 'Emergency', 'emergency'],
    'advisories & alerts': ['Advisories', 'Emergencies', 'Emergency', 'emergency'],
    'rankings': ['Rankings'],
    'barangay rankings': ['Rankings'],
    'community news': ['News', 'news', 'General', 'Community'],
    'news': ['News', 'news'],
    'general': ['General'],
    'community': ['Community'],
}


class NewsItemViewSet(viewsets.ModelViewSet):
    queryset = NewsItem.objects.all()
    serializer_class = NewsItemSerializer
    pagination_class = NewsPagination
    permission_classes = [IsAdminRoleOrReadOnly]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['date', 'updated_at', 'priority', 'is_pinned', 'title', 'status']

    def paginate_queryset(self, queryset):
        # Unpaginated list for admin workspace management when page/page_size are omitted
        if self.request.query_params.get('admin_mode') == 'true' and 'page' not in self.request.query_params and 'page_size' not in self.request.query_params:
            return None
        return super().paginate_queryset(queryset)

    def get_queryset(self):
        is_admin = is_admin_user(self.request.user)
        admin_mode = self.request.query_params.get('admin_mode') == 'true'
        status_param = self.request.query_params.get('status')

        if is_admin and (admin_mode or status_param is not None or self.action in ['retrieve', 'admin_stats', 'publish_item', 'unpublish_item', 'archive_item', 'restore_item']):
            if status_param and status_param != 'all':
                qs = NewsItem.objects.filter(status=status_param)
            else:
                qs = NewsItem.objects.all()
        else:
            # Public and non-admin queries strictly see published, active items only
            qs = NewsItem.objects.filter(is_active=True, status=ContentStatus.PUBLISHED)

        # Scoping rule: Barangay Officials cannot see another barangay's private/targeted content
        user = self.request.user
        if not is_admin and user.is_authenticated and getattr(user, 'role', None) == 'brgy_official' and getattr(user, 'barangay_id', None):
            qs = qs.filter(Q(barangay__isnull=True) | Q(barangay_id=user.barangay_id))

        qs = qs.select_related('barangay', 'author')

        # ?barangay_id=<pk> | 'citywide'
        barangay_id = self.request.query_params.get('barangay_id')
        if barangay_id:
            if barangay_id == 'citywide':
                qs = qs.filter(barangay__isnull=True)
            elif admin_mode:
                qs = qs.filter(barangay_id=barangay_id)
            else:
                # City-wide items PLUS items for that specific barangay
                qs = qs.filter(Q(barangay__isnull=True) | Q(barangay_id=barangay_id))

        # ?city_wide=true  — only global items
        if self.request.query_params.get('city_wide') == 'true':
            qs = qs.filter(barangay__isnull=True)

        # ?type=announcement|news|emergency
        news_type = self.request.query_params.get('type')
        if news_type:
            qs = qs.filter(type=news_type)

        # ?category=<cat>
        category = (self.request.query_params.get('category') or '').strip()
        if category:
            cat_lower = category.lower()
            if cat_lower in CATEGORY_TAXONOMY_MAP:
                mapped = CATEGORY_TAXONOMY_MAP[cat_lower]
                if mapped is not None:
                    qs = qs.filter(category__in=mapped)
            else:
                qs = qs.filter(category__iexact=category)

        # ?priority=low|medium|high
        priority = self.request.query_params.get('priority')
        if priority:
            qs = qs.filter(priority=priority)

        # ?pinned=true
        if self.request.query_params.get('pinned') == 'true':
            qs = qs.filter(is_pinned=True)

        # ?search=<term> or ?q=<term>
        search = (self.request.query_params.get('search') or self.request.query_params.get('q') or '').strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(description__icontains=search))

        # Announcements ranking priority:
        # 1. Active EmergencyAlert records (served via emergency alerts endpoint)
        # 2. Published emergency NewsItems (type='emergency')
        # 3. Published high-priority announcements (priority='high')
        # 4. Featured or pinned published content (is_pinned=True or is_featured=True)
        # 5. Other published news and announcements
        qs = qs.annotate(
            feed_priority=Case(
                When(type=NewsType.EMERGENCY, then=Value(1)),
                When(priority=Priority.HIGH, then=Value(2)),
                When(Q(is_pinned=True) | Q(is_featured=True), then=Value(3)),
                default=Value(4),
                output_field=IntegerField()
            )
        )
        return qs.order_by('feed_priority', '-date', '-updated_at', '-id')

    def list(self, request, *args, **kwargs):
        is_anon = not request.user.is_authenticated
        cache_key = None
        if is_anon and request.query_params.get('admin_mode') != 'true':
            cache_key = build_news_feed_cache_key(request)
            cached_data = cache.get(cache_key)
            if cached_data is not None:
                return Response(cached_data)

        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            resp = self.get_paginated_response(serializer.data)
            if is_anon and cache_key:
                cache.set(cache_key, resp.data, timeout=30)
            return resp

        serializer = self.get_serializer(queryset, many=True)
        if is_anon and cache_key:
            cache.set(cache_key, serializer.data, timeout=30)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='latest-check', permission_classes=[permissions.AllowAny])
    def latest_check(self, request):
        """
        Lightweight check endpoint for background polling without downloading full items.
        Returns latest news ID, latest timestamp, news count, plus emergency alert metrics.
        """
        qs = self.get_queryset()
        news_agg = qs.aggregate(
            latest_id=Max('id'),
            latest_timestamp=Max('updated_at'),
            count=Count('id')
        )
        alert_agg = EmergencyAlert.objects.filter(is_active=True).aggregate(
            latest_alert_id=Max('id'),
            latest_alert_timestamp=Max('updated_at'),
            alert_count=Count('id')
        )
        return Response({
            'latest_news_id': news_agg['latest_id'],
            'latest_news_timestamp': news_agg['latest_timestamp'],
            'news_count': news_agg['count'] or 0,
            'latest_alert_id': alert_agg['latest_alert_id'],
            'latest_alert_timestamp': alert_agg['latest_alert_timestamp'],
            'alert_count': alert_agg['alert_count'] or 0,
        })

    def perform_create(self, serializer):
        user = self.request.user
        author = user if user.is_authenticated else None

        # FormData sends booleans as strings — coerce them here
        data = serializer.validated_data
        for field in ('is_pinned', 'is_featured', 'is_active'):
            if field in data and isinstance(data[field], str):
                data[field] = data[field].lower() == 'true'

        if hasattr(user, 'role') and user.role == 'brgy_official':
            # Force the user's own barangay, ignoring anything the client sent
            data.pop('barangay', None)
            instance = serializer.save(barangay=user.barangay, author=author)
        else:
            instance = serializer.save(author=author)

        # Only notify when the post is published and active
        if instance.status == ContentStatus.PUBLISHED and instance.is_active:
            notify_announcement(instance)
        bump_news_cache_version()

    def perform_update(self, serializer):
        old_instance = self.get_object()
        was_published = (old_instance.status == ContentStatus.PUBLISHED and old_instance.is_active)
        instance = serializer.save()
        is_now_published = (instance.status == ContentStatus.PUBLISHED and instance.is_active)

        # Notify only when newly published to avoid spamming recipients on minor edits
        if is_now_published and not was_published:
            notify_announcement(instance)
        bump_news_cache_version()

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        bump_news_cache_version()

    @action(detail=False, methods=['get'], url_path='admin-stats', permission_classes=[IsAdminRole])
    def admin_stats(self, request):
        """
        GET /api/news/items/admin-stats/
        Returns aggregate count metrics for the Admin Content Management Workspace.
        """
        total = NewsItem.objects.count()
        published = NewsItem.objects.filter(status=ContentStatus.PUBLISHED).count()
        drafts = NewsItem.objects.filter(status=ContentStatus.DRAFT).count()
        archived = NewsItem.objects.filter(status=ContentStatus.ARCHIVED).count()
        active_alerts = EmergencyAlert.objects.filter(is_active=True).count()
        total_alerts = EmergencyAlert.objects.count()

        return Response({
            'total': total,
            'published': published,
            'drafts': drafts,
            'archived': archived,
            'active_alerts': active_alerts,
            'total_alerts': total_alerts,
        })

    @action(detail=True, methods=['post'], url_path='publish', permission_classes=[IsAdminRole])
    def publish_item(self, request, pk=None):
        """
        POST /api/news/items/<pk>/publish/
        Transitions a news item to published status and notifies recipients.
        """
        item = self.get_object()
        was_published = (item.status == ContentStatus.PUBLISHED and item.is_active)
        item.status = ContentStatus.PUBLISHED
        item.is_active = True
        item.save()
        bump_news_cache_version()
        if not was_published:
            notify_announcement(item)
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=['post'], url_path='unpublish', permission_classes=[IsAdminRole])
    def unpublish_item(self, request, pk=None):
        """
        POST /api/news/items/<pk>/unpublish/
        Transitions a news item back to draft.
        """
        item = self.get_object()
        item.status = ContentStatus.DRAFT
        item.is_active = False
        item.save()
        bump_news_cache_version()
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=['post'], url_path='archive', permission_classes=[IsAdminRole])
    def archive_item(self, request, pk=None):
        """
        POST /api/news/items/<pk>/archive/
        Transitions a news item to archived status.
        """
        item = self.get_object()
        item.status = ContentStatus.ARCHIVED
        item.is_active = False
        item.save()
        bump_news_cache_version()
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=['post'], url_path='restore', permission_classes=[IsAdminRole])
    def restore_item(self, request, pk=None):
        """
        POST /api/news/items/<pk>/restore/
        Restores an archived item to draft or published.
        """
        item = self.get_object()
        target_status = request.data.get('status', ContentStatus.DRAFT)
        if target_status not in [ContentStatus.DRAFT, ContentStatus.PUBLISHED]:
            target_status = ContentStatus.DRAFT
        item.status = target_status
        item.is_active = (target_status == ContentStatus.PUBLISHED)
        item.save()
        bump_news_cache_version()
        if item.is_active:
            notify_announcement(item)
        return Response(self.get_serializer(item).data)

    @action(detail=False, methods=['get'], url_path='for-dashboard')
    def for_dashboard(self, request):
        """
        GET /api/news/items/for-dashboard/
        Returns latest 5 announcements visible to the requesting user.
        City-wide + user's own barangay (if set).
        """
        q = Q(barangay__isnull=True)
        if request.user.is_authenticated and request.user.barangay_id:
            q |= Q(barangay_id=request.user.barangay_id)

        items = (
            NewsItem.objects
            .filter(is_active=True, status=ContentStatus.PUBLISHED)
            .filter(q)
            .select_related('barangay')
            .order_by('-is_pinned', '-date')[:5]
        )
        return Response(NewsItemSerializer(items, many=True).data)


class EmergencyAlertViewSet(viewsets.ModelViewSet):
    queryset           = EmergencyAlert.objects.all()
    serializer_class   = EmergencyAlertSerializer
    permission_classes = [IsAdminRoleOrReadOnly]

    def get_queryset(self):
        is_admin = is_admin_user(self.request.user)
        include_inactive = self.request.query_params.get('include_inactive') == 'true'
        admin_mode = self.request.query_params.get('admin_mode') == 'true'

        if is_admin and (include_inactive or admin_mode or self.action in ['retrieve', 'update', 'partial_update', 'destroy', 'toggle_active']):
            return EmergencyAlert.objects.all().order_by('-date', '-updated_at')
        return EmergencyAlert.objects.filter(is_active=True).order_by('-date', '-updated_at')

    @transaction.atomic
    def perform_create(self, serializer):
        requested_active = serializer.validated_data.get('is_active', True)

        # 1. Persist initially as inactive to establish database identity
        instance = serializer.save(is_active=False)
        bump_news_cache_version()

        # 2. If submitted as active, activate through authoritative lifecycle service
        if requested_active:
            updated_instance = update_emergency_alert(
                alert_pk=instance.pk,
                actor=self.request.user,
                validated_fields={'is_active': True}
            )
            serializer.instance = updated_instance

    @transaction.atomic
    def perform_update(self, serializer):
        # Lock-first update: pass all validated fields directly to the service
        updated_instance = update_emergency_alert(
            alert_pk=serializer.instance.pk,
            actor=self.request.user,
            validated_fields=serializer.validated_data
        )

        # Explicitly rebind serializer instance to the updated locked instance
        serializer.instance = updated_instance
        bump_news_cache_version()

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        bump_news_cache_version()

    @action(detail=True, methods=['post'], url_path='toggle-active', permission_classes=[IsAdminRole])
    @transaction.atomic
    def toggle_active(self, request, pk=None):
        self.get_object()
        locked_alert = EmergencyAlert.objects.select_for_update().get(pk=pk)
        target_state = not locked_alert.is_active

        updated_instance = update_emergency_alert(
            alert_pk=pk,
            actor=request.user,
            validated_fields={'is_active': target_state}
        )
        bump_news_cache_version()
        return Response(self.get_serializer(updated_instance).data)


class BarangaySpotlightViewSet(viewsets.ModelViewSet):
    queryset           = BarangaySpotlight.objects.select_related('barangay').all()
    serializer_class   = BarangaySpotlightSerializer
    permission_classes = [IsAdminRoleOrReadOnly]
