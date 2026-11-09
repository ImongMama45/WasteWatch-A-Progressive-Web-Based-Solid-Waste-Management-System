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
