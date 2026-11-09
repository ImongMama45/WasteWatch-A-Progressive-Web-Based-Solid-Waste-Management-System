from datetime import timedelta
from unittest.mock import patch
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Barangay, UserRole
from notifications.models import Notification, NotificationType
from .models import MunicipalEvent, EventStatus, EventCategory, VALID_EVENT_TRANSITIONS

User = get_user_model()


class MunicipalEventBackendTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        # 1. Setup Barangay fixtures
        cls.brgy_isabang = Barangay.objects.create(name='Isabang')
        cls.brgy_dalahican = Barangay.objects.create(name='Dalahican')

        # 2. Setup user fixtures for all required roles
        # Requirement 1: Admin role with is_staff=False
        cls.admin_role_only = User.objects.create_user(
            username='admin_role_only',
            email='admin_role@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.ADMIN,
            is_staff=False,
        )

        # Requirement 2: Django staff user with is_staff=True (e.g. role='citizen' or staff)
        cls.staff_user = User.objects.create_user(
            username='django_staff_user',
            email='staff@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.CITIZEN,
            is_staff=True,
        )

        # Requirement 3: Citizen
        cls.citizen_user = User.objects.create_user(
            username='citizen_pedro',
            email='pedro@citizen.ph',
            password='testpassword123',
            role=UserRole.CITIZEN,
            barangay=cls.brgy_isabang,
        )

        # Requirement 4: Barangay Official (assigned to Isabang)
        cls.brgy_official = User.objects.create_user(
            username='captain_isabang',
            email='captain@isabang.gov.ph',
            password='testpassword123',
            role=UserRole.BRGY_OFFICIAL,
            barangay=cls.brgy_isabang,
        )

        # Requirement 5: Watcher and Driver
        cls.watcher_user = User.objects.create_user(
            username='watcher_juan',
            email='watcher@lucena.ph',
            password='testpassword123',
            role=UserRole.WATCHER,
            barangay=cls.brgy_isabang,
        )
        cls.driver_user = User.objects.create_user(
            username='driver_mario',
            email='driver@lucena.ph',
            password='testpassword123',
            role=UserRole.DRIVER,
        )

        # Base event datetimes
        cls.now = timezone.now()
        cls.t_start = cls.now + timedelta(days=2)
        cls.t_end = cls.now + timedelta(days=2, hours=3)

        # 3. Setup baseline test events across statuses and scopes
        # A. Citywide Published Event
        cls.event_pub_citywide = MunicipalEvent.objects.create(
            title='Citywide Lucena Clean River Drive',
            description='Citywide cleanup campaign along Iyam river.',
            start_datetime=cls.t_start,
            end_datetime=cls.t_end,
            location='Iyam River Banks',
            category=EventCategory.CLEANUP,
            status=EventStatus.PUBLISHED,
            organizer='Lucena City CENRO',
        )

        # B. Isabang-scoped Published Event
        cls.event_pub_isabang = MunicipalEvent.objects.create(
            title='Isabang Special Waste Collection',
            description='Drop-off point for household electronics and hazardous waste.',
            start_datetime=cls.t_start + timedelta(days=1),
            end_datetime=cls.t_end + timedelta(days=1),
            location='Isabang Covered Court',
            category=EventCategory.HAZARDOUS_WASTE,
            status=EventStatus.PUBLISHED,
            organizer='Barangay Isabang & CENRO',
        )
        cls.event_pub_isabang.barangays.add(cls.brgy_isabang)

        # C. Dalahican-scoped Published Event
        cls.event_pub_dalahican = MunicipalEvent.objects.create(
            title='Dalahican Coastal Cleanup',
            description='Coastal debris collection at Dalahican fish port.',
            start_datetime=cls.t_start + timedelta(days=2),
            end_datetime=cls.t_end + timedelta(days=2),
            location='Dalahican Port Area',
            category=EventCategory.CLEANUP,
            status=EventStatus.PUBLISHED,
            organizer='Barangay Dalahican & CENRO',
        )
        cls.event_pub_dalahican.barangays.add(cls.brgy_dalahican)

        # D. Draft Event (Admin only)
        cls.event_draft = MunicipalEvent.objects.create(
            title='Internal CENRO Planning Draft',
            description='Draft plan for annual waste summit.',
            start_datetime=cls.t_start + timedelta(days=5),
            end_datetime=cls.t_end + timedelta(days=5),
            location='Lucena City Hall',
            category=EventCategory.WORKSHOP,
            status=EventStatus.DRAFT,
            organizer='Lucena City CENRO',
        )

        # E. Archived Event (Admin only)
        cls.event_archived = MunicipalEvent.objects.create(
            title='Historical Tree Planting 2025',
            description='Archived record of previous year initiative.',
            start_datetime=cls.t_start - timedelta(days=365),
            end_datetime=cls.t_end - timedelta(days=365),
            location='Tayabas-Lucena Boundary',
            category=EventCategory.TREE_PLANTING,
            status=EventStatus.ARCHIVED,
            organizer='Lucena City CENRO',
        )

        # F. Cancelled Event
        cls.event_cancelled = MunicipalEvent.objects.create(
            title='Cancelled Plaza Seminar',
            description='Seminar cancelled due to typhoon warning.',
            start_datetime=cls.t_start + timedelta(days=7),
            end_datetime=cls.t_end + timedelta(days=7),
            location='Perez Park',
            category=EventCategory.WORKSHOP,
            status=EventStatus.CANCELLED,
            organizer='Lucena City CENRO',
        )

        # G. Completed Event
        cls.event_completed = MunicipalEvent.objects.create(
            title='Completed Barangay Assembly',
            description='Past community orientation successfully conducted.',
            start_datetime=cls.t_start - timedelta(days=10),
            end_datetime=cls.t_end - timedelta(days=10),
            location='Lucena Convention Center',
            category=EventCategory.COMMUNITY_MEETING,
            status=EventStatus.COMPLETED,
            organizer='Lucena City CENRO',
        )

    # ── Requirement 1 & 2: Admin role checks ─────────────────────────────────
    def test_01_admin_role_only_has_full_management_access(self):
        """Admin with role='admin' and is_staff=False has full administrative access."""
        self.client.force_authenticate(user=self.admin_role_only)
        
        # Can view all events including drafts and archived
        res = self.client.get('/api/events/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [e['id'] for e in res.data]
        self.assertIn(self.event_draft.id, ids)
        self.assertIn(self.event_archived.id, ids)

        # Can access admin stats
        stats_res = self.client.get('/api/events/admin-stats/')
        self.assertEqual(stats_res.status_code, status.HTTP_200_OK)
        self.assertEqual(stats_res.data['total'], 7)

    def test_02_django_staff_user_has_admin_access(self):
        """Django staff user with is_staff=True has admin access."""
        self.client.force_authenticate(user=self.staff_user)
        res = self.client.get('/api/events/admin-stats/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    # ── Requirement 3, 5 & 6: Citizen, Watcher, Driver, and Anonymous access ─
    def test_03_citizen_restrictions(self):
        """Citizens cannot access admin stats or execute write/lifecycle actions."""
        self.client.force_authenticate(user=self.citizen_user)

        # Forbidden on admin stats
        self.assertEqual(self.client.get('/api/events/admin-stats/').status_code, status.HTTP_403_FORBIDDEN)

        # Forbidden on create
        create_res = self.client.post('/api/events/', data={
            'title': 'Unauthorized Citizen Event',
            'description': 'Attempting create',
            'start_datetime': self.t_start.isoformat(),
            'end_datetime': self.t_end.isoformat(),
            'location': 'Street',
        })
        self.assertEqual(create_res.status_code, status.HTTP_403_FORBIDDEN)

        # Forbidden on lifecycle actions
        self.assertEqual(self.client.post(f'/api/events/{self.event_pub_citywide.id}/cancel/').status_code, status.HTTP_403_FORBIDDEN)

    def test_05_watcher_and_driver_restrictions(self):
        """Watchers and Drivers cannot perform administrative actions."""
        for u in [self.watcher_user, self.driver_user]:
            self.client.force_authenticate(user=u)
            self.assertEqual(self.client.get('/api/events/admin-stats/').status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(self.client.delete(f'/api/events/{self.event_pub_citywide.id}/').status_code, status.HTTP_403_FORBIDDEN)

    def test_06_anonymous_public_access(self):
        """Anonymous public users can read public events but cannot perform write operations."""
        self.client.logout()
        res = self.client.get('/api/events/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.post('/api/events/', data={}).status_code, status.HTTP_403_FORBIDDEN)

    # ── Requirement 4: Barangay Official Scope Restrictions ──────────────────
    def test_04_barangay_official_scope_restrictions(self):
        """Barangay Official sees only citywide events and events scoped to their barangay."""
        self.client.force_authenticate(user=self.brgy_official)
        res = self.client.get('/api/events/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [e['id'] for e in res.data]

        # Can see Citywide event
        self.assertIn(self.event_pub_citywide.id, ids)
        # Can see Isabang event
        self.assertIn(self.event_pub_isabang.id, ids)
        # MUST NOT see Dalahican-scoped event
        self.assertNotIn(self.event_pub_dalahican.id, ids)
        # MUST NOT see Drafts or Archived events
        self.assertNotIn(self.event_draft.id, ids)
        self.assertNotIn(self.event_archived.id, ids)

        # Cannot perform management actions
        self.assertEqual(self.client.post(f'/api/events/{self.event_pub_isabang.id}/cancel/').status_code, status.HTTP_403_FORBIDDEN)

    # ── Requirement 7, 8, 9, 10, 11: Public Visibility & Isolation ───────────
    def test_07_public_list_visibility(self):
        """Public list exposes published, cancelled, and completed events, excluding drafts and archived."""
        self.client.logout()
        res = self.client.get('/api/events/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [e['id'] for e in res.data]

        self.assertIn(self.event_pub_citywide.id, ids)
        self.assertIn(self.event_cancelled.id, ids)
        self.assertIn(self.event_completed.id, ids)
        self.assertNotIn(self.event_draft.id, ids)
        self.assertNotIn(self.event_archived.id, ids)

    def test_08_public_detail_visibility(self):
        """Public users can retrieve details of published, cancelled, and completed events."""
        self.client.logout()
        for event in [self.event_pub_citywide, self.event_cancelled, self.event_completed]:
            res = self.client.get(f'/api/events/{event.id}/')
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertEqual(res.data['id'], event.id)

    def test_09_draft_isolation_from_public(self):
        """Draft events return 404 to non-administrators on detail retrieve."""
        for user in [None, self.citizen_user, self.brgy_official, self.watcher_user, self.driver_user]:
            if user:
                self.client.force_authenticate(user=user)
            else:
                self.client.logout()
            res = self.client.get(f'/api/events/{self.event_draft.id}/')
            self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_10_archived_event_isolation_from_public(self):
        """Archived events return 404 to non-administrators on detail retrieve."""
        self.client.logout()
        res = self.client.get(f'/api/events/{self.event_archived.id}/')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        # But authorized admin can retrieve it
        self.client.force_authenticate(user=self.admin_role_only)
        admin_res = self.client.get(f'/api/events/{self.event_archived.id}/')
        self.assertEqual(admin_res.status_code, status.HTTP_200_OK)

    # ── Requirement 12: CRUD Permissions ─────────────────────────────────────
    def test_12_admin_crud_operations(self):
        """Admin can create, update, and delete events."""
        self.client.force_authenticate(user=self.admin_role_only)

        # Create
        create_res = self.client.post('/api/events/', data={
            'title': 'New Admin Created Event',
            'description': 'Event description text',
            'start_datetime': (self.now + timedelta(days=10)).isoformat(),
            'end_datetime': (self.now + timedelta(days=10, hours=2)).isoformat(),
            'location': 'Lucena Public Market',
            'category': EventCategory.CLEANUP,
            'organizer': 'CENRO Market Division',
            'status': EventStatus.DRAFT,
            'barangays': [self.brgy_isabang.id],
        }, format='json')
        self.assertEqual(create_res.status_code, status.HTTP_201_CREATED)
        new_id = create_res.data['id']

        # Update
        update_res = self.client.patch(f'/api/events/{new_id}/', data={
            'location': 'Lucena Central Terminal',
        }, format='json')
        self.assertEqual(update_res.status_code, status.HTTP_200_OK)
        self.assertEqual(update_res.data['location'], 'Lucena Central Terminal')

        # Delete
        delete_res = self.client.delete(f'/api/events/{new_id}/')
        self.assertEqual(delete_res.status_code, status.HTTP_204_NO_CONTENT)

    # ── Requirement 13: Lifecycle Transitions ────────────────────────────────
    def test_13_lifecycle_transitions_and_validation(self):
        """Valid transitions succeed; invalid transitions are rejected."""
        self.client.force_authenticate(user=self.admin_role_only)

        event = MunicipalEvent.objects.create(
            title='Lifecycle State Test Event',
            description='Testing valid and invalid state transitions.',
            start_datetime=self.t_start + timedelta(days=20),
            end_datetime=self.t_end + timedelta(days=20),
            location='Lucena City Hall Annex',
            status=EventStatus.DRAFT,
        )

        # 1. DRAFT -> PUBLISHED: Valid
        pub_res = self.client.post(f'/api/events/{event.id}/publish/')
        self.assertEqual(pub_res.status_code, status.HTTP_200_OK)
        self.assertEqual(pub_res.data['status'], EventStatus.PUBLISHED)

        # 2. PUBLISHED -> CANCELLED: Valid
        cancel_res = self.client.post(f'/api/events/{event.id}/cancel/')
        self.assertEqual(cancel_res.status_code, status.HTTP_200_OK)
        self.assertEqual(cancel_res.data['status'], EventStatus.CANCELLED)

        # 3. CANCELLED -> COMPLETED: Invalid! (Cancelled cannot jump directly to Completed)
        invalid_res = self.client.post(f'/api/events/{event.id}/complete/')
        self.assertEqual(invalid_res.status_code, status.HTTP_400_BAD_REQUEST)

        # 4. CANCELLED -> ARCHIVED: Valid
        arch_res = self.client.post(f'/api/events/{event.id}/archive/')
        self.assertEqual(arch_res.status_code, status.HTTP_200_OK)
        self.assertEqual(arch_res.data['status'], EventStatus.ARCHIVED)

        # 5. ARCHIVED -> DRAFT: Valid (restore)
        res_res = self.client.post(f'/api/events/{event.id}/restore/')
        self.assertEqual(res_res.status_code, status.HTTP_200_OK)
        self.assertEqual(res_res.data['status'], EventStatus.DRAFT)

        # Cleanup
        event.delete()

    # ── Requirement 14: Date Validation ──────────────────────────────────────
    def test_14_date_validation_rejects_inverted_datetimes(self):
        """End datetime must be strictly after start datetime."""
        self.client.force_authenticate(user=self.admin_role_only)

        res = self.client.post('/api/events/', data={
            'title': 'Inverted Date Event',
            'description': 'Testing inverted dates',
            'start_datetime': (self.now + timedelta(days=5)).isoformat(),
            'end_datetime': (self.now + timedelta(days=4)).isoformat(), # Earlier than start!
            'location': 'Lucena Oval',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('end_datetime', res.data)

        # Equal start and end is also rejected
        res_eq = self.client.post('/api/events/', data={
            'title': 'Zero Duration Event',
            'description': 'Testing zero duration',
            'start_datetime': (self.now + timedelta(days=5)).isoformat(),
            'end_datetime': (self.now + timedelta(days=5)).isoformat(),
            'location': 'Lucena Oval',
        }, format='json')
        self.assertEqual(res_eq.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('end_datetime', res_eq.data)

    # ── Requirement 15: Barangay Relationship Validation ────────────────────
    def test_15_barangay_relationship_validation(self):
        """Barangays must reference valid existing primary keys."""
        self.client.force_authenticate(user=self.admin_role_only)

        # Valid barangay association
        res_ok = self.client.post('/api/events/', data={
            'title': 'Valid Barangay Event',
            'description': 'Valid association',
            'start_datetime': self.t_start.isoformat(),
            'end_datetime': self.t_end.isoformat(),
            'location': 'Lucena Hall',
            'barangays': [self.brgy_isabang.id, self.brgy_dalahican.id],
        }, format='json')
        self.assertEqual(res_ok.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(res_ok.data['barangays']), 2)
        self.assertFalse(res_ok.data['is_citywide'])
        MunicipalEvent.objects.filter(id=res_ok.data['id']).delete()

        # Non-existent barangay ID is rejected
        res_err = self.client.post('/api/events/', data={
            'title': 'Invalid Barangay Event',
            'description': 'Invalid PK test',
            'start_datetime': self.t_start.isoformat(),
            'end_datetime': self.t_end.isoformat(),
            'location': 'Lucena Hall',
            'barangays': [999999],
        }, format='json')
        self.assertEqual(res_err.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('barangays', res_err.data)

    # ── Requirement 16 & 17: Notification Dispatch, Deduplication & Scope ────
    def test_16_notification_dispatch_and_deduplication(self):
        """Publishing creates 1 notification; repeated publication or editing creates 0 notifications."""
        self.client.force_authenticate(user=self.admin_role_only)
        initial_notifs = Notification.objects.filter(type=NotificationType.ANNOUNCEMENT).count()

        event = MunicipalEvent.objects.create(
            title='Notification Safety Test Event',
            description='Verifying notification counts and duplicate suppression.',
            start_datetime=self.t_start + timedelta(days=30),
            end_datetime=self.t_end + timedelta(days=30),
            location='Lucena City Coliseum',
            status=EventStatus.DRAFT,
        )

        # 1. Draft creation dispatched 0 notifications
        self.assertEqual(Notification.objects.filter(type=NotificationType.ANNOUNCEMENT).count(), initial_notifs)

        # 2. First Publish: dispatches 1 notification
        res_pub1 = self.client.post(f'/api/events/{event.id}/publish/')
        self.assertEqual(res_pub1.status_code, status.HTTP_200_OK)
        after_pub1 = Notification.objects.filter(type=NotificationType.ANNOUNCEMENT).count()
        self.assertEqual(after_pub1 - initial_notifs, 1)

        # 3. Repeated Publish: dispatches 0 additional notifications
        res_pub2 = self.client.post(f'/api/events/{event.id}/publish/')
        self.assertEqual(res_pub2.status_code, status.HTTP_200_OK)
        after_pub2 = Notification.objects.filter(type=NotificationType.ANNOUNCEMENT).count()
        self.assertEqual(after_pub2, after_pub1)

        # 4. Editing published event: dispatches 0 additional notifications
        res_edit = self.client.patch(f'/api/events/{event.id}/', data={'description': 'Updated description text.'})
        self.assertEqual(res_edit.status_code, status.HTTP_200_OK)
        after_edit = Notification.objects.filter(type=NotificationType.ANNOUNCEMENT).count()
        self.assertEqual(after_edit, after_pub1)

        # 5. Cancelling event: dispatches 1 cancellation notification
        res_cancel1 = self.client.post(f'/api/events/{event.id}/cancel/')
        self.assertEqual(res_cancel1.status_code, status.HTTP_200_OK)
        after_cancel1 = Notification.objects.filter(type=NotificationType.ANNOUNCEMENT).count()
        self.assertEqual(after_cancel1 - after_pub1, 1)
        cancel_notif = Notification.objects.filter(type=NotificationType.ANNOUNCEMENT, title__startswith='EVENT CANCELLED').first()
        self.assertIsNotNone(cancel_notif)

        # 6. Repeated Cancel: dispatches 0 additional notifications
        res_cancel2 = self.client.post(f'/api/events/{event.id}/cancel/')
        self.assertEqual(res_cancel2.status_code, status.HTTP_200_OK)
        after_cancel2 = Notification.objects.filter(type=NotificationType.ANNOUNCEMENT).count()
        self.assertEqual(after_cancel2, after_cancel1)

        # Cleanup
        Notification.objects.filter(title__contains='Notification Safety Test Event').delete()
        event.delete()

    def test_17_barangay_vs_citywide_notification_scope(self):
        """Citywide event creates 1 notification with barangay=None; scoped event creates 1 per barangay."""
        self.client.force_authenticate(user=self.admin_role_only)

        # Citywide event
        event_citywide = MunicipalEvent.objects.create(
            title='Scope Citywide Test Event',
            description='Citywide scope verification',
            start_datetime=self.t_start + timedelta(days=40),
            end_datetime=self.t_end + timedelta(days=40),
            location='Lucena City Plaza',
            status=EventStatus.DRAFT,
        )
        self.client.post(f'/api/events/{event_citywide.id}/publish/')
        cw_notif = Notification.objects.filter(title__contains='Scope Citywide Test Event')
        self.assertEqual(cw_notif.count(), 1)
        self.assertIsNone(cw_notif.first().barangay)

        # Scoped event targeting 2 barangays
        event_scoped = MunicipalEvent.objects.create(
            title='Scope Two Barangays Test Event',
            description='Two barangay scope verification',
            start_datetime=self.t_start + timedelta(days=41),
            end_datetime=self.t_end + timedelta(days=41),
            location='Boundary Marker',
            status=EventStatus.DRAFT,
        )
        event_scoped.barangays.add(self.brgy_isabang, self.brgy_dalahican)
        self.client.post(f'/api/events/{event_scoped.id}/publish/')

        scoped_notifs = Notification.objects.filter(title__contains='Scope Two Barangays Test Event')
        self.assertEqual(scoped_notifs.count(), 2)
        notif_brgy_ids = set(scoped_notifs.values_list('barangay_id', flat=True))
        self.assertEqual(notif_brgy_ids, {self.brgy_isabang.id, self.brgy_dalahican.id})

        # Cleanup
        Notification.objects.filter(title__contains='Scope Citywide Test Event').delete()
        Notification.objects.filter(title__contains='Scope Two Barangays Test Event').delete()
        event_citywide.delete()
        event_scoped.delete()

    def test_18_atomicity_and_rollback_on_publication_notification_failure(self):
        """Simulate notification creation failure during publication: status must roll back to DRAFT."""
        self.client.force_authenticate(user=self.admin_role_only)
        event = MunicipalEvent.objects.create(
            title='Atomic Publication Failure Test',
            description='Testing rollback when publication notification fails',
            start_datetime=self.t_start + timedelta(days=50),
            end_datetime=self.t_end + timedelta(days=50),
            location='Lucena City Hall',
            status=EventStatus.DRAFT,
        )

        with patch('events.views.notify_event_published', side_effect=Exception('Simulated database outage')):
            # Because notify_event_published is wrapped to catch and raise EventNotificationError in services,
            # patching it to raise directly tests the view transaction rollback on notification failure.
            from events.services import EventNotificationError
            with patch('events.views.notify_event_published', side_effect=EventNotificationError('Simulated DB outage')):
                res = self.client.post(f'/api/events/{event.id}/publish/')
                self.assertEqual(res.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
                self.assertIn('error', res.data)
                self.assertIn('rolled back', res.data['error'])

        event.refresh_from_db()
        self.assertEqual(event.status, EventStatus.DRAFT, "Event status must remain DRAFT on notification failure")
        notifs = Notification.objects.filter(title__contains='Atomic Publication Failure Test')
        self.assertEqual(notifs.count(), 0, "No notifications should exist after rollback")
        event.delete()

    def test_19_atomicity_and_rollback_on_cancellation_notification_failure(self):
        """Simulate notification creation failure during cancellation: status must remain PUBLISHED."""
        self.client.force_authenticate(user=self.admin_role_only)
        event = MunicipalEvent.objects.create(
            title='Atomic Cancellation Failure Test',
            description='Testing rollback when cancellation notification fails',
            start_datetime=self.t_start + timedelta(days=51),
            end_datetime=self.t_end + timedelta(days=51),
            location='Lucena City Hall',
            status=EventStatus.DRAFT,
        )
        # First publish successfully
        self.client.post(f'/api/events/{event.id}/publish/')
        event.refresh_from_db()
        self.assertEqual(event.status, EventStatus.PUBLISHED)

        from events.services import EventNotificationError
        with patch('events.views.notify_event_cancelled', side_effect=EventNotificationError('Simulated network timeout')):
            res = self.client.post(f'/api/events/{event.id}/cancel/')
            self.assertEqual(res.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
            self.assertIn('error', res.data)
            self.assertIn('rolled back', res.data['error'])

        event.refresh_from_db()
        self.assertEqual(event.status, EventStatus.PUBLISHED, "Event status must remain PUBLISHED after cancel rollback")
        cancel_notifs = Notification.objects.filter(title__startswith='EVENT CANCELLED: Atomic Cancellation Failure')
        self.assertEqual(cancel_notifs.count(), 0, "No cancellation notifications should exist after rollback")

        Notification.objects.filter(title__contains='Atomic Cancellation Failure Test').delete()
        event.delete()

    def test_20_multi_barangay_atomicity_and_rollback_on_partial_failure(self):
        """Simulate bulk_create failure during multi-barangay notification: all rows must roll back."""
        self.client.force_authenticate(user=self.admin_role_only)
        event = MunicipalEvent.objects.create(
            title='Atomic Multi-Barangay Rollback Test',
            description='Testing multi-barangay atomic batch rollback',
            start_datetime=self.t_start + timedelta(days=52),
            end_datetime=self.t_end + timedelta(days=52),
            location='Boundary Marker',
            status=EventStatus.DRAFT,
        )
        event.barangays.add(self.brgy_isabang, self.brgy_dalahican)

        with patch('notifications.models.Notification.objects.bulk_create', side_effect=Exception('DB constraint violation')):
            res = self.client.post(f'/api/events/{event.id}/publish/')
            self.assertEqual(res.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)

        event.refresh_from_db()
        self.assertEqual(event.status, EventStatus.DRAFT, "Event status must remain DRAFT on batch notification failure")
        notifs = Notification.objects.filter(title__contains='Atomic Multi-Barangay Rollback Test')
        self.assertEqual(notifs.count(), 0, "All multi-barangay notification rows must be rolled back")
        event.delete()

    def test_21_direct_creation_as_published_rollback_on_notification_failure(self):
        """Simulate failure when directly creating an event with status=PUBLISHED: event must not be created."""
        self.client.force_authenticate(user=self.admin_role_only)
        from events.services import EventNotificationError

        with patch('events.views.notify_event_published', side_effect=EventNotificationError('Simulated failure on create')):
            res = self.client.post('/api/events/', {
                'title': 'Direct Publish Rollback Test',
                'description': 'Direct creation should roll back if notification fails',
                'start_datetime': (self.t_start + timedelta(days=53)).isoformat(),
                'end_datetime': (self.t_end + timedelta(days=53)).isoformat(),
                'location': 'Perez Park',
                'category': EventCategory.GENERAL,
                'organizer': 'Lucena City CENRO',
                'status': EventStatus.PUBLISHED,
                'barangays': [],
            }, format='json')
            self.assertEqual(res.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)

        event_exists = MunicipalEvent.objects.filter(title='Direct Publish Rollback Test').exists()
        self.assertFalse(event_exists, "Event must not be persisted if notification dispatch fails on direct create")
