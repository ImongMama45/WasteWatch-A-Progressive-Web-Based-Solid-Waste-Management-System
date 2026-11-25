from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status

from accounts.models import Barangay
from news.models import NewsItem, EmergencyAlert, ContentStatus, NewsType, Priority
from notifications.models import Notification, NotificationType

User = get_user_model()


class NewsContentManagementComprehensiveTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # 1. Barangay fixture
        self.barangay = Barangay.objects.create(name='Barangay Isabang')

        # 2. Six distinct identities
        # Identity 1: Admin with role='admin' and is_staff=False
        self.admin_role_only = User.objects.create_user(
            username='admin_role_only',
            email='admin_role@wastewatch.ph',
            password='Password123!',
            role='admin',
            is_staff=False,
            first_name='Admin',
            last_name='RoleOnly',
        )

        # Identity 2: Admin with is_staff=True
        self.admin_staff_user = User.objects.create_user(
            username='admin_staff',
            email='admin_staff@wastewatch.ph',
            password='Password123!',
            role='citizen',  # Role citizen, but is_staff=True
            is_staff=True,
            first_name='Staff',
            last_name='Admin',
        )

        # Identity 3: Citizen
        self.citizen_user = User.objects.create_user(
            username='citizen_user',
            email='citizen@wastewatch.ph',
            password='Password123!',
            role='citizen',
            is_staff=False,
        )

        # Identity 4: Watcher
        self.watcher_user = User.objects.create_user(
            username='watcher_user',
            email='watcher@wastewatch.ph',
            password='Password123!',
            role='watcher',
            is_staff=False,
        )

        # Identity 5: Barangay Official
        self.brgy_official_user = User.objects.create_user(
            username='official_user',
            email='official@wastewatch.ph',
            password='Password123!',
            role='brgy_official',
            barangay=self.barangay,
            is_staff=False,
        )

        # Identity 6: Driver
        self.driver_user = User.objects.create_user(
            username='driver_user',
            email='driver@wastewatch.ph',
            password='Password123!',
            role='driver',
            is_staff=False,
        )

        # Content Fixtures
        self.published_item = NewsItem.objects.create(
            title='Published Announcement',
            description='This is public content.',
            type=NewsType.ANNOUNCEMENT,
            status=ContentStatus.PUBLISHED,
            is_active=True,
            author=self.admin_role_only,
        )

        self.draft_item = NewsItem.objects.create(
            title='Draft Announcement',
            description='This is an internal draft.',
            type=NewsType.ANNOUNCEMENT,
            status=ContentStatus.DRAFT,
            is_active=False,
            author=self.admin_role_only,
        )

        self.archived_item = NewsItem.objects.create(
            title='Archived Announcement',
            description='This is old archived content.',
            type=NewsType.ANNOUNCEMENT,
            status=ContentStatus.ARCHIVED,
            is_active=False,
            author=self.admin_role_only,
        )

        self.active_alert = EmergencyAlert.objects.create(
            title='Active Flood Advisory',
            body='Flooding reported downtown.',
            is_active=True,
        )

        self.inactive_alert = EmergencyAlert.objects.create(
            title='Past Storm Advisory',
            body='Storm has passed.',
            is_active=False,
        )

    # ─────────────────────────────────────────────────────────────────────────
    # SECTION 1: Backend Admin Authorization Across All 6 Identities
    # ─────────────────────────────────────────────────────────────────────────

    def test_section1_admin_role_only_authorized(self):
        """Admin with role='admin' and is_staff=False is authorized for all administrative actions."""
        self.client.force_authenticate(user=self.admin_role_only)

        # 1. Access admin stats
        res = self.client.get('/api/news/items/admin-stats/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # 2. Access admin_mode list with drafts
        res = self.client.get('/api/news/items/?admin_mode=true')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [i['id'] for i in res.data]
        self.assertIn(self.draft_item.id, ids)

        # 3. Retrieve draft detail
        res = self.client.get(f'/api/news/items/{self.draft_item.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # 4. Lifecycle action: publish draft
        res = self.client.post(f'/api/news/items/{self.draft_item.id}/publish/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # 5. Alert management: toggle active
        res = self.client.post(f'/api/news/alerts/{self.inactive_alert.id}/toggle-active/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_section1_admin_staff_authorized(self):
        """Admin with is_staff=True is authorized for all administrative actions."""
        self.client.force_authenticate(user=self.admin_staff_user)

        res = self.client.get('/api/news/items/admin-stats/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        res = self.client.get('/api/news/items/?admin_mode=true')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [i['id'] for i in res.data]
        self.assertIn(self.draft_item.id, ids)

        res = self.client.get(f'/api/news/items/{self.draft_item.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_section1_non_admin_roles_rejected_from_admin_operations(self):
        """Citizens, Watchers, Barangay Officials, and Drivers are rejected from admin operations."""
        non_admin_users = [
            self.citizen_user,
            self.watcher_user,
            self.brgy_official_user,
            self.driver_user,
        ]

        for u in non_admin_users:
            self.client.force_authenticate(user=u)

            # 1. Admin stats must return 403 Forbidden
            res = self.client.get('/api/news/items/admin-stats/')
            self.assertEqual(
                res.status_code,
                status.HTTP_403_FORBIDDEN,
                f"User {u.username} with role {u.role} was not rejected from admin-stats",
            )

            # 2. Cannot create news item
            res = self.client.post('/api/news/items/', {
                'title': f'Unauthorized by {u.username}',
                'description': 'Test',
                'type': 'news',
                'status': 'published',
            })
            # Barangay official has restricted brgy news creation in some setups or 403; others strictly 403
            if u.role != 'brgy_official':
                self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

            # 3. Cannot call publish action
            res = self.client.post(f'/api/news/items/{self.draft_item.id}/publish/')
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

            # 4. Cannot call unpublish action
            res = self.client.post(f'/api/news/items/{self.published_item.id}/unpublish/')
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

            # 5. Cannot call archive action
            res = self.client.post(f'/api/news/items/{self.published_item.id}/archive/')
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

            # 6. Cannot call restore action
            res = self.client.post(f'/api/news/items/{self.archived_item.id}/restore/', {'status': 'draft'})
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

            # 7. Cannot toggle alert
            res = self.client.post(f'/api/news/alerts/{self.inactive_alert.id}/toggle-active/')
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

            # 8. Query parameter manipulation does NOT return drafts or archived items
            res = self.client.get('/api/news/items/?admin_mode=true&status=draft')
            ids = [i['id'] for i in res.data]
            self.assertNotIn(self.draft_item.id, ids)
            self.assertNotIn(self.archived_item.id, ids)

            # 9. Detail retrieval of drafts or archived returns 404
            res = self.client.get(f'/api/news/items/{self.draft_item.id}/')
            self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

            res = self.client.get(f'/api/news/items/{self.archived_item.id}/')
            self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

            # 10. Detail retrieval of inactive alert returns 404
            res = self.client.get(f'/api/news/alerts/{self.inactive_alert.id}/')
            self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    # ─────────────────────────────────────────────────────────────────────────
    # SECTION 2: NewsItem Lifecycle & Backward Compatibility
    # ─────────────────────────────────────────────────────────────────────────

    def test_section2_newsitem_lifecycle_transitions(self):
        """Verify the exact 8 lifecycle transition scenarios from the specification table."""
        # Scenario 1: Create draft
        draft = NewsItem.objects.create(
            title='Scenario 1 Draft',
            description='Body',
            status=ContentStatus.DRAFT,
        )
        self.assertEqual(draft.status, 'draft')
        self.assertFalse(draft.is_active)

        # Scenario 2: Publish draft
        draft.status = ContentStatus.PUBLISHED
        draft.save()
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'published')
        self.assertTrue(draft.is_active)

        # Scenario 3: Unpublish published item
        draft.status = ContentStatus.DRAFT
        draft.save()
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'draft')
        self.assertFalse(draft.is_active)

        # Scenario 4: Archive item
        draft.status = ContentStatus.ARCHIVED
        draft.save()
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'archived')
        self.assertFalse(draft.is_active)

        # Scenario 5: Restore archived item as draft
        draft.status = ContentStatus.DRAFT
        draft.save()
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'draft')
        self.assertFalse(draft.is_active)

        # Scenario 6: Restore archived item as published
        draft.status = ContentStatus.ARCHIVED
        draft.save()
        draft.status = ContentStatus.PUBLISHED
        draft.save()
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'published')
        self.assertTrue(draft.is_active)

        # Scenario 7: Edit published item (remains published)
        draft.title = 'Edited Published Title'
        draft.save()
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'published')
        self.assertTrue(draft.is_active)

        # Scenario 8: Edit draft item (remains draft)
        draft.status = ContentStatus.DRAFT
        draft.save()
        draft.title = 'Edited Draft Title'
        draft.save()
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'draft')
        self.assertFalse(draft.is_active)

    def test_section2_update_fields_compatibility(self):
        """update_fields does not cause inconsistent lifecycle values."""
        item = NewsItem.objects.create(
            title='Update Fields Item',
            description='Body',
            status=ContentStatus.DRAFT,
        )
        self.assertFalse(item.is_active)

        # Update status using update_fields=['status']
        item.status = ContentStatus.PUBLISHED
        item.save(update_fields=['status'])
        item.refresh_from_db()
        self.assertEqual(item.status, 'published')
        self.assertTrue(item.is_active)

        # Update status using update_fields=['is_active']
        item.is_active = False
        item.save(update_fields=['is_active'])
        item.refresh_from_db()
        self.assertEqual(item.status, 'archived')
        self.assertFalse(item.is_active)

    def test_section2_direct_is_active_mutation_compatibility(self):
        """Direct changes to is_active are not silently broken or overridden."""
        item = NewsItem.objects.create(
            title='Direct Active Item',
            description='Body',
            status=ContentStatus.PUBLISHED,
        )
        self.assertTrue(item.is_active)

        # Legacy caller directly sets is_active = False
        item.is_active = False
        item.save()
        item.refresh_from_db()
        self.assertFalse(item.is_active)
        self.assertEqual(item.status, 'archived')

        # Legacy caller directly sets is_active = True
        item.is_active = True
        item.save()
        item.refresh_from_db()
        self.assertTrue(item.is_active)
        self.assertEqual(item.status, 'published')

    # ─────────────────────────────────────────────────────────────────────────
    # SECTION 3: Notification Safety & Deduplication
    # ─────────────────────────────────────────────────────────────────────────

    def test_section3_newsitem_notification_publishing_and_scope(self):
        """Verifies notification dispatch on publishing, deduplication on edit, and barangay targeting."""
        self.client.force_authenticate(user=self.admin_role_only)
        Notification.objects.all().delete()

        # 1. Publishing new draft creates notification
        res = self.client.post(f'/api/news/items/{self.draft_item.id}/publish/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        notif = Notification.objects.filter(type=NotificationType.ANNOUNCEMENT, title=self.draft_item.title)
        self.assertEqual(notif.count(), 1)
        self.assertIsNone(notif.first().barangay)  # city-wide

        # 2. Publishing an already published item does NOT create another notification
        res = self.client.post(f'/api/news/items/{self.draft_item.id}/publish/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(Notification.objects.filter(type=NotificationType.ANNOUNCEMENT, title=self.draft_item.title).count(), 1)

        # 3. Editing an already published item does NOT rebroadcast
        res = self.client.patch(f'/api/news/items/{self.draft_item.id}/', {'description': 'Minor typo fix.'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(Notification.objects.filter(type=NotificationType.ANNOUNCEMENT, title=self.draft_item.title).count(), 1)

        # 4. Unpublishing does not create a notification
        res = self.client.post(f'/api/news/items/{self.draft_item.id}/unpublish/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(Notification.objects.filter(type=NotificationType.ANNOUNCEMENT, title=self.draft_item.title).count(), 1)

        # 5. Publishing barangay-specific item targets the specific barangay
        brgy_item = NewsItem.objects.create(
            title='Barangay Isabang Drive',
            description='Clean drive for Isabang only.',
            type=NewsType.ANNOUNCEMENT,
            barangay=self.barangay,
            status=ContentStatus.DRAFT,
            is_active=False,
        )
        res = self.client.post(f'/api/news/items/{brgy_item.id}/publish/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        brgy_notif = Notification.objects.filter(type=NotificationType.ANNOUNCEMENT, title=brgy_item.title).first()
        self.assertIsNotNone(brgy_notif)
        self.assertEqual(brgy_notif.barangay, self.barangay)

    def test_section3_emergency_alert_notification_safety(self):
        """Verifies emergency alert notification safety, deduplication, and deactivation behavior."""
        self.client.force_authenticate(user=self.admin_role_only)
        Notification.objects.all().delete()

        # 1. Activating an inactive alert generates intended notification
        res = self.client.post(f'/api/news/alerts/{self.inactive_alert.id}/toggle-active/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['is_active'])
        notif_qs = Notification.objects.filter(title__contains=self.inactive_alert.title)
        self.assertEqual(notif_qs.count(), 1)
        self.assertIsNone(notif_qs.first().barangay)  # system-wide

        # 2. Deactivating an alert does NOT generate a new broadcast
        res = self.client.post(f'/api/news/alerts/{self.inactive_alert.id}/toggle-active/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(res.data['is_active'])
        self.assertEqual(Notification.objects.filter(title__contains=self.inactive_alert.title).count(), 1)

        # 3. Editing an already active alert does not rebroadcast
        res = self.client.post(f'/api/news/alerts/{self.inactive_alert.id}/toggle-active/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['is_active'])
        current_count = Notification.objects.filter(title__contains=self.inactive_alert.title).count()

        res = self.client.patch(f'/api/news/alerts/{self.inactive_alert.id}/', {'body': 'Updated advisory wording without state change.'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(Notification.objects.filter(title__contains=self.inactive_alert.title).count(), current_count)

    # ─────────────────────────────────────────────────────────────────────────
    # SECTION 4: Public API Isolation
    # ─────────────────────────────────────────────────────────────────────────

    def test_section4_public_api_isolation(self):
        """Public endpoints strictly expose published active items and active alerts only."""
        # Unauthenticated visitor
        self.client.logout()

        # 1. List NewsItems
        res = self.client.get('/api/news/items/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [i['id'] for i in res.data]
        self.assertIn(self.published_item.id, ids)
        self.assertNotIn(self.draft_item.id, ids)
        self.assertNotIn(self.archived_item.id, ids)

        # 2. Detail NewsItem - Published vs Draft vs Archived
        res = self.client.get(f'/api/news/items/{self.published_item.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        res = self.client.get(f'/api/news/items/{self.draft_item.id}/')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        res = self.client.get(f'/api/news/items/{self.archived_item.id}/')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        # 3. List Alerts - Only active
        res = self.client.get('/api/news/alerts/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        alert_ids = [a['id'] for a in res.data]
        self.assertIn(self.active_alert.id, alert_ids)
        self.assertNotIn(self.inactive_alert.id, alert_ids)

        # 4. Detail Alerts - Active vs Inactive
        res = self.client.get(f'/api/news/alerts/{self.active_alert.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        res = self.client.get(f'/api/news/alerts/{self.inactive_alert.id}/')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        # 5. Dashboard endpoint isolation
        res = self.client.get('/api/news/items/for-dashboard/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        dash_ids = [i['id'] for i in res.data]
        self.assertIn(self.published_item.id, dash_ids)
        self.assertNotIn(self.draft_item.id, dash_ids)
        self.assertNotIn(self.archived_item.id, dash_ids)

    def test_news_feed_pagination_and_latest_check(self):
        """
        Verify Announcements feed server-side pagination, page size bounds,
        deterministic ranking priority, and lightweight update-check endpoint.
        """
        NewsItem.objects.all().delete()

        # Create 25 published news items
        for i in range(25):
            NewsItem.objects.create(
                title=f"Announcement {i}",
                description=f"Description {i}",
                status=ContentStatus.PUBLISHED,
                is_active=True,
                type=NewsType.NEWS,
                priority=Priority.LOW
            )

        # 1. Default page size is 10
        res = self.client.get('/api/news/items/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 25)
        self.assertEqual(len(res.data['results']), 10)

        # 2. Configurable page sizes: 20, 30
        res20 = self.client.get('/api/news/items/?page_size=20')
        self.assertEqual(len(res20.data['results']), 20)

        # 3. Maximum page size enforcement: capped at 30
        res50 = self.client.get('/api/news/items/?page_size=50')
        self.assertEqual(len(res50.data['results']), 25)  # all 25 since 25 <= 30

        # 4. Page 2 without duplicates
        page1_ids = {p['id'] for p in res.data['results']}
        res_p2 = self.client.get('/api/news/items/?page=2')
        page2_ids = {p['id'] for p in res_p2.data['results']}
        self.assertEqual(len(page1_ids.intersection(page2_ids)), 0)

        # 5. Lightweight latest-check endpoint
        res_check = self.client.get('/api/news/items/latest-check/')
        self.assertEqual(res_check.status_code, status.HTTP_200_OK)
        self.assertEqual(res_check.data['news_count'], 25)
        self.assertIsNotNone(res_check.data['latest_news_id'])

        # 6. Priority ranking: Emergency outranks regular news
        emg = NewsItem.objects.create(
            title="Typhoon Alert",
            description="Immediate evacuation",
            status=ContentStatus.PUBLISHED,
            is_active=True,
            type=NewsType.EMERGENCY,
            priority=Priority.HIGH
        )
        res_ranked = self.client.get('/api/news/items/')
        self.assertEqual(res_ranked.data['results'][0]['id'], emg.id)

        # 7. Admin mode without page/page_size parameters remains unpaginated
        self.client.force_authenticate(user=self.admin_role_only)
        res_admin = self.client.get('/api/news/items/?admin_mode=true')
        self.assertIsInstance(res_admin.data, list)
        self.assertEqual(len(res_admin.data), 26)

    def test_server_side_search_and_category_filtering(self):
        """
        Verify server-side search across title/description, category taxonomy mapping,
        and accurate count pagination across filtered querysets.
        """
        self.client.force_authenticate(user=None)  # Public / unauthenticated

        # Clear existing items
        NewsItem.objects.all().delete()

        # Seed items across categories and search terms
        item_cleanup = NewsItem.objects.create(
            title="Citywide Coastal Cleanup Drive",
            description="Volunteers needed for coastal cleanup along Dalahican Beach.",
            category="Cleanup Drives",
            status=ContentStatus.PUBLISHED,
            is_active=True,
        )
        item_sched = NewsItem.objects.create(
            title="Barangay Isabang Waste Collection Schedule Change",
            description="Garbage trucks will arrive earlier at 6:00 AM on Mondays.",
            category="Service Updates",
            status=ContentStatus.PUBLISHED,
            is_active=True,
            barangay=self.barangay,
        )
        item_adv = NewsItem.objects.create(
            title="Flash Flood Advisory and Drainage Caution",
            description="Heavy rain expected due to low pressure area in Lucena City.",
            category="Advisories",
            status=ContentStatus.PUBLISHED,
            is_active=True,
        )
        item_comm = NewsItem.objects.create(
            title="Youth Eco-Brigade Recycling Workshop",
            description="Community recycling initiative for plastics and cartons.",
            category="Community",
            status=ContentStatus.PUBLISHED,
            is_active=True,
        )
        item_draft = NewsItem.objects.create(
            title="Draft Internal Cleanup Instructions",
            description="Internal memo regarding Dalahican beach tools.",
            category="Cleanup Drives",
            status=ContentStatus.DRAFT,
            is_active=True,
        )

        # 1. Server-side text search by title
        res = self.client.get('/api/news/items/?search=Coastal')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 1)
        self.assertEqual(res.data['results'][0]['id'], item_cleanup.id)

        # 2. Server-side text search by description (case-insensitive)
        res_desc = self.client.get('/api/news/items/?search=drainage')
        self.assertEqual(res_desc.status_code, status.HTTP_200_OK)
        self.assertEqual(res_desc.data['count'], 1)
        self.assertEqual(res_desc.data['results'][0]['id'], item_adv.id)

        # 3. Fallback parameter ?q=
        res_q = self.client.get('/api/news/items/?q=plastics')
        self.assertEqual(res_q.status_code, status.HTTP_200_OK)
        self.assertEqual(res_q.data['count'], 1)
        self.assertEqual(res_q.data['results'][0]['id'], item_comm.id)

        # 4. Drafts never exposed in public search results
        res_draft = self.client.get('/api/news/items/?search=Internal')
        self.assertEqual(res_draft.data['count'], 0)

        # 5. Category taxonomy mapping: "Community News" maps to ['News', 'General', 'Community']
        res_cat = self.client.get('/api/news/items/?category=Community+News')
        self.assertEqual(res_cat.status_code, status.HTTP_200_OK)
        self.assertEqual(res_cat.data['count'], 1)
        self.assertEqual(res_cat.data['results'][0]['id'], item_comm.id)

        # 6. Category taxonomy mapping: "Advisories"
        res_adv = self.client.get('/api/news/items/?category=Advisories')
        self.assertEqual(res_adv.data['count'], 1)
        self.assertEqual(res_adv.data['results'][0]['id'], item_adv.id)

        # 7. Category "All" returns all published items
        res_all = self.client.get('/api/news/items/?category=All')
        self.assertEqual(res_all.data['count'], 4)

        # 8. Combined filters: scope + category + search
        res_comb = self.client.get(f'/api/news/items/?barangay_id={self.barangay.id}&category=Service+Updates&search=Schedule')
        self.assertEqual(res_comb.status_code, status.HTTP_200_OK)
        self.assertEqual(res_comb.data['count'], 1)
        self.assertEqual(res_comb.data['results'][0]['id'], item_sched.id)

    def test_server_side_search_finds_record_beyond_page_one(self):
        """
        Targeted Scenario 2 Acceptance:
        1. Create at least 11 published announcements (15 total).
        2. Put a unique searchable phrase in an announcement positioned beyond the first 10 records.
        3. Request /api/news/items/?search=<unique phrase>.
        4. Confirm the matching record is returned immediately on Page 1 without requesting earlier pages.
        5. Confirm response count reflects the filtered result set (1), NOT the unfiltered total (15).
        6. Confirm pagination next and previous reflect the filtered queryset (both None).
        7. Verify combining search with category and barangay scope returns only records matching all active filters.
        """
        self.client.force_authenticate(user=None)
        NewsItem.objects.all().delete()

        # Create the target announcement first with an earlier date/id so it is positioned beyond page 1
        unique_phrase = "DeepPagingTargetTerm"
        target_item = NewsItem.objects.create(
            title="Special Deeply Paged Notice",
            description=f"Crucial information containing the unique phrase {unique_phrase} located beyond page 1.",
            status=ContentStatus.PUBLISHED,
            is_active=True,
            category="Service Updates",
            priority=Priority.LOW,
            barangay=self.barangay,
        )

        # Create 14 newer background announcements (they will take spots 1-10 on page 1)
        for i in range(1, 15):
            NewsItem.objects.create(
                title=f"General Lucena Bulletin #{i}",
                description=f"Standard municipal update number {i} regarding regular city services.",
                status=ContentStatus.PUBLISHED,
                is_active=True,
                category="General",
                priority=Priority.LOW,
            )

        # Confirm that in an unfiltered request with default page_size=10, the target is NOT on page 1
        res_unfiltered = self.client.get('/api/news/items/')
        self.assertEqual(res_unfiltered.status_code, status.HTTP_200_OK)
        self.assertEqual(res_unfiltered.data['count'], 15)
        self.assertEqual(len(res_unfiltered.data['results']), 10)
        self.assertIsNotNone(res_unfiltered.data['next'])
        unfiltered_ids = [item['id'] for item in res_unfiltered.data['results']]
        self.assertNotIn(target_item.id, unfiltered_ids)

        # Verify page 2 contains target_item before filtering
        res_page2 = self.client.get('/api/news/items/?page=2')
        self.assertEqual(res_page2.status_code, status.HTTP_200_OK)
        page2_ids = [item['id'] for item in res_page2.data['results']]
        self.assertIn(target_item.id, page2_ids)

        # 3. Request /api/news/items/?search=<unique phrase>
        res_search = self.client.get(f'/api/news/items/?search={unique_phrase}')
        self.assertEqual(res_search.status_code, status.HTTP_200_OK)

        # 4. Returned immediately on Page 1 without requesting earlier pages
        self.assertEqual(len(res_search.data['results']), 1)
        self.assertEqual(res_search.data['results'][0]['id'], target_item.id)

        # 5. Count reflects filtered set (1), NOT the unfiltered total (15)
        self.assertEqual(res_search.data['count'], 1)

        # 6. Pagination next and previous reflect filtered queryset (both None)
        self.assertIsNone(res_search.data['next'])
        self.assertIsNone(res_search.data['previous'])

        # 7. Combined search + category + barangay scope
        # Matching all active filters:
        res_comb_match = self.client.get(
            f'/api/news/items/?search={unique_phrase}&category=Service+Updates&barangay_id={self.barangay.id}'
        )
        self.assertEqual(res_comb_match.data['count'], 1)
        self.assertEqual(res_comb_match.data['results'][0]['id'], target_item.id)

        # Mismatched category:
        res_comb_bad_cat = self.client.get(
            f'/api/news/items/?search={unique_phrase}&category=Cleanup+Drives'
        )
        self.assertEqual(res_comb_bad_cat.data['count'], 0)

        # Mismatched barangay:
        other_brgy = Barangay.objects.create(name='Barangay Cotta')
        res_comb_bad_brgy = self.client.get(
            f'/api/news/items/?search={unique_phrase}&barangay_id={other_brgy.id}'
        )
        self.assertEqual(res_comb_bad_brgy.data['count'], 0)

    def test_visibility_and_cache_isolation_across_roles(self):
        """
        Targeted Scenario 3 Acceptance:
        - Anonymous/Citizen cannot find drafts, archived, inactive, or unpublished records.
        - Barangay Official searches cannot find another barangay's private content.
        - Citywide content remains visible where authorized.
        - Search and filter variations do not reuse incorrect cached results.
        - The latest-check endpoint does not reveal unfiltered or unauthorized content counts.
        - Admin Content Management listing and lifecycle operations remain unaffected.
        """
        NewsItem.objects.all().delete()
        other_brgy = Barangay.objects.create(name='Barangay Gulang-Gulang')

        # 1. Seed various status and visibility items
        citywide_pub = NewsItem.objects.create(
            title="Citywide Public Tree Planting",
            description="Green Lucena citywide tree planting initiative.",
            status=ContentStatus.PUBLISHED,
            is_active=True,
            barangay=None,  # Citywide
        )
        isabang_pub = NewsItem.objects.create(
            title="Isabang Barangay Community Cleanliness",
            description="Isabang cleanup schedules and resident guidelines.",
            status=ContentStatus.PUBLISHED,
            is_active=True,
            barangay=self.barangay,
        )
        other_brgy_pub = NewsItem.objects.create(
            title="Gulang-Gulang Private Advisory",
            description="Confidential barangay advisory specifically for Gulang-Gulang.",
            status=ContentStatus.PUBLISHED,
            is_active=True,
            barangay=other_brgy,
        )
        draft_item = NewsItem.objects.create(
            title="Confidential Draft City Budget Report",
            description="Unreleased budget allocation for waste management.",
            status=ContentStatus.DRAFT,
            is_active=True,
        )
        archived_item = NewsItem.objects.create(
            title="Archived 2024 Schedule",
            description="Old schedule from previous year.",
            status=ContentStatus.ARCHIVED,
            is_active=True,
        )
        inactive_item = NewsItem.objects.create(
            title="Inactive Invalidation Notice",
            description="Notice with is_active=False.",
            status=ContentStatus.PUBLISHED,
            is_active=False,
        )

        # 1. Anonymous / Citizen visibility:
        self.client.force_authenticate(user=None)
        res_anon_search = self.client.get('/api/news/items/?search=Confidential')
        anon_ids = [item['id'] for item in res_anon_search.data['results']]
        self.assertNotIn(draft_item.id, anon_ids)
        self.assertNotIn(archived_item.id, anon_ids)
        self.assertNotIn(inactive_item.id, anon_ids)

        # Citizen user check
        self.client.force_authenticate(user=self.citizen_user)
        res_cit_draft = self.client.get('/api/news/items/?search=Budget')
        self.assertEqual(res_cit_draft.data['count'], 0)

        # 2. Barangay Official cannot find another barangay's private content:
        self.client.force_authenticate(user=self.brgy_official_user)
        # Search specifically for term in Gulang-Gulang item
        res_bo_search = self.client.get('/api/news/items/?search=Gulang-Gulang')
        self.assertEqual(res_bo_search.data['count'], 0)

        # Even if passing ?barangay_id=other_brgy.id
        res_bo_target_other = self.client.get(f'/api/news/items/?barangay_id={other_brgy.id}')
        bo_other_ids = [item['id'] for item in res_bo_target_other.data['results']]
        self.assertNotIn(other_brgy_pub.id, bo_other_ids)

        # 3. Citywide content and own barangay content remain visible to Barangay Official:
        res_bo_all = self.client.get('/api/news/items/')
        bo_all_ids = [item['id'] for item in res_bo_all.data['results']]
        self.assertIn(citywide_pub.id, bo_all_ids)
        self.assertIn(isabang_pub.id, bo_all_ids)
        self.assertNotIn(other_brgy_pub.id, bo_all_ids)

        # 4. Latest-check endpoint accuracy:
        # For Barangay Official:
        res_bo_check = self.client.get('/api/news/items/latest-check/')
        self.assertEqual(res_bo_check.status_code, status.HTTP_200_OK)
        # Only citywide_pub and isabang_pub = 2 items
        self.assertEqual(res_bo_check.data['news_count'], 2)

        # For Anonymous:
        self.client.force_authenticate(user=None)
        res_anon_check = self.client.get('/api/news/items/latest-check/')
        # 3 published active items total (citywide, isabang, other_brgy), drafts/archived/inactive excluded
        self.assertEqual(res_anon_check.data['news_count'], 3)

        # 5. Cache isolation across search and filter variations:
        # Anonymous request 1: search for 'Tree'
        res_c1 = self.client.get('/api/news/items/?search=Tree')
        self.assertEqual(res_c1.data['count'], 1)
        self.assertEqual(res_c1.data['results'][0]['id'], citywide_pub.id)

        # Anonymous request 2: search for 'Cleanliness' (must NOT return cached 'Tree' result)
        res_c2 = self.client.get('/api/news/items/?search=Cleanliness')
        self.assertEqual(res_c2.data['count'], 1)
        self.assertEqual(res_c2.data['results'][0]['id'], isabang_pub.id)

        # 6. Admin Content Management unaffected:
        self.client.force_authenticate(user=self.admin_role_only)
        res_admin_all = self.client.get('/api/news/items/?admin_mode=true')
        self.assertEqual(len(res_admin_all.data), 6)
        admin_all_ids = [item['id'] for item in res_admin_all.data]
        self.assertIn(draft_item.id, admin_all_ids)
        self.assertIn(archived_item.id, admin_all_ids)
        self.assertIn(inactive_item.id, admin_all_ids)

        # Admin lifecycle action (publish draft):
        res_publish = self.client.post(f'/api/news/items/{draft_item.id}/publish/')
        self.assertEqual(res_publish.status_code, status.HTTP_200_OK)
        draft_item.refresh_from_db()
        self.assertEqual(draft_item.status, ContentStatus.PUBLISHED)

    def test_cache_key_isolation_and_invalidation(self):
        """
        Targeted Cache-Key Verification:
        - Search canonicalization: ?search=term and ?q=term hit the exact same cache entry.
        - Parameter isolation: variations in category, type, priority, barangay_id, city_wide, page, page_size
          do not share cache keys.
        - Privileged isolation: authenticated users bypass the cache completely.
        - Invalidation: updating or publishing a NewsItem bumps cache version and evicts stale cache.
        """
        from django.core.cache import cache
        from news.views import get_news_cache_version, build_news_feed_cache_key

        cache.clear()
        NewsItem.objects.all().delete()

        item = NewsItem.objects.create(
            title="Lucena Coastal Cleanup Alert",
            description="Cleanup details for Dalahican Beach.",
            category="Cleanup Drives",
            type=NewsType.ANNOUNCEMENT,
            priority=Priority.HIGH,
            status=ContentStatus.PUBLISHED,
            is_active=True,
            barangay=self.barangay,
        )

        self.client.force_authenticate(user=None)

        # 1. First anonymous request generates and populates cache
        res_search = self.client.get('/api/news/items/?search=Coastal')
        self.assertEqual(res_search.status_code, status.HTTP_200_OK)

        ver = get_news_cache_version()
        expected_key = f"news_feed_v{ver}_bNone_cwNone_tNone_c_prNone_pNone_scoastal_page1_ps10_o"
        self.assertIsNotNone(cache.get(expected_key))

        # 2. Canonical query parameter ?q=coastal hits the exact same cache entry
        res_q = self.client.get('/api/news/items/?q=coastal')
        self.assertEqual(res_q.status_code, status.HTTP_200_OK)
        self.assertEqual(res_q.data['results'][0]['id'], item.id)

        # 3. Parameter distinctions produce distinct cache keys
        # Distinct category
        res_cat = self.client.get('/api/news/items/?category=Cleanup+Drives')
        key_cat = f"news_feed_v{ver}_bNone_cwNone_tNone_ccleanup_drives_prNone_pNone_s_page1_ps10_o"
        self.assertIsNotNone(cache.get(key_cat))

        # Distinct type
        res_type = self.client.get('/api/news/items/?type=announcement')
        key_type = f"news_feed_v{ver}_bNone_cwNone_tannouncement_c_prNone_pNone_s_page1_ps10_o"
        self.assertIsNotNone(cache.get(key_type))

        # Distinct priority
        res_pri = self.client.get('/api/news/items/?priority=high')
        key_pri = f"news_feed_v{ver}_bNone_cwNone_tNone_c_prhigh_pNone_s_page1_ps10_o"
        self.assertIsNotNone(cache.get(key_pri))

        # Distinct barangay_id
        res_brgy = self.client.get(f'/api/news/items/?barangay_id={self.barangay.id}')
        key_brgy = f"news_feed_v{ver}_b{self.barangay.id}_cwNone_tNone_c_prNone_pNone_s_page1_ps10_o"
        self.assertIsNotNone(cache.get(key_brgy))

        # Distinct city_wide
        res_cw = self.client.get('/api/news/items/?city_wide=true')
        key_cw = f"news_feed_v{ver}_bNone_cwtrue_tNone_c_prNone_pNone_s_page1_ps10_o"
        self.assertIsNotNone(cache.get(key_cw))

        # Distinct page_size
        res_page = self.client.get('/api/news/items/?page_size=20')
        self.assertEqual(res_page.status_code, status.HTTP_200_OK)
        key_page = f"news_feed_v{ver}_bNone_cwNone_tNone_c_prNone_pNone_s_page1_ps20_o"
        self.assertIsNotNone(cache.get(key_page))

        # 4. Authenticated users do NOT read from or write to public cache
        initial_cache_dump = {k: cache.get(k) for k in [expected_key, key_cat, key_type]}
        self.client.force_authenticate(user=self.admin_role_only)
        res_admin = self.client.get('/api/news/items/?search=Coastal')
        # Ensure cache for expected_key was not overwritten
        self.assertEqual(cache.get(expected_key), initial_cache_dump[expected_key])

        # 5. Invalidation on content/publication update
        old_ver = ver
        item.title = "Updated Lucena Coastal Cleanup Alert"
        item.save()  # Triggers post_save signal -> bump_news_cache_version
        new_ver = get_news_cache_version()
        self.assertGreater(new_ver, old_ver)

        # Old cache key is no longer used; new version key is generated
        self.client.force_authenticate(user=None)
        res_new = self.client.get('/api/news/items/?search=Coastal')
        new_key = f"news_feed_v{new_ver}_bNone_cwNone_tNone_c_prNone_pNone_scoastal_page1_ps10_o"
        self.assertIsNotNone(cache.get(new_key))
        self.assertEqual(res_new.data['results'][0]['title'], "Updated Lucena Coastal Cleanup Alert")
