import json
from unittest.mock import patch
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User, UserRole
from analytics.models import ActivityLog
from news.models import EmergencyAlert
from news.admin import EmergencyAlertAdmin
from notifications.models import (
    EmergencyActivationEvent,
    Notification,
    NotificationType,
)
from notifications.services import update_emergency_alert


class DummyAdminSite:
    pass


class EmergencyAlertLifecycleTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.barangay = Barangay.objects.create(name='Barangay Uno')

        self.admin = User.objects.create_user(
            username='admin_officer',
            email='admin@example.com',
            password='Password123!',
            role=UserRole.ADMIN,
            barangay=self.barangay,
            is_staff=True,
        )

        self.citizen = User.objects.create_user(
            username='citizen_pedro',
            email='pedro@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            barangay=self.barangay,
        )

        self.watcher = User.objects.create_user(
            username='watcher_juan',
            email='juan@example.com',
            password='Password123!',
            role=UserRole.WATCHER,
            barangay=self.barangay,
        )

        self.driver = User.objects.create_user(
            username='driver_kiko',
            email='kiko@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
            barangay=self.barangay,
        )

        self.brgy_official = User.objects.create_user(
            username='official_maria',
            email='maria@example.com',
            password='Password123!',
            role=UserRole.BRGY_OFFICIAL,
            barangay=self.barangay,
        )

    # ── Test 1: Inactive -> Active creates 1 event and 1 notification ───────────
    def test_inactive_to_active_creates_one_event_and_one_notification(self):
        alert = EmergencyAlert.objects.create(
            title='Flood Warning',
            body='River levels rising in low-lying areas.',
            is_active=False,
        )

        updated = update_emergency_alert(
            alert_pk=alert.pk,
            actor=self.admin,
            validated_fields={'is_active': True},
        )

        self.assertTrue(updated.is_active)
        events = EmergencyActivationEvent.objects.filter(alert=alert)
        self.assertEqual(events.count(), 1)
        event = events.first()
        self.assertEqual(event.sequence, 1)
        self.assertEqual(event.activated_by, self.admin)
        self.assertIsNone(event.deactivated_at)

        notifs = Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT)
        self.assertEqual(notifs.count(), 1)
        notif = notifs.first()
        self.assertIsNone(notif.user)
        self.assertIsNone(notif.barangay)
        self.assertEqual(notif.title, 'EMERGENCY ADVISORY: Flood Warning')
        self.assertEqual(notif.message, 'River levels rising in low-lying areas.')

        # Verify audit trail
        log = ActivityLog.objects.filter(module='EmergencyAlert').first()
        self.assertIsNotNone(log)
        details = json.loads(log.details)
        self.assertEqual(details['operation'], 'emergency_activate')
        self.assertEqual(details['sequence'], 1)
        self.assertFalse(details['previous_is_active'])
        self.assertTrue(details['new_is_active'])

    # ── Test 2: Active alert edit does not dispatch again ───────────────────────
    def test_editing_active_alert_does_not_dispatch_again(self):
        alert = EmergencyAlert.objects.create(
            title='Flood Warning',
            body='Initial warning text.',
            is_active=False,
        )
        update_emergency_alert(alert.pk, self.admin, {'is_active': True})
        self.assertEqual(EmergencyActivationEvent.objects.filter(alert=alert).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 1)

        # Edit title and body while keeping alert active
        updated = update_emergency_alert(
            alert_pk=alert.pk,
            actor=self.admin,
            validated_fields={'title': 'Updated Flood Warning', 'body': 'Updated evacuation center info.'},
        )

        self.assertTrue(updated.is_active)
        self.assertEqual(updated.title, 'Updated Flood Warning')
        self.assertEqual(updated.body, 'Updated evacuation center info.')

        # No new event or notification dispatched
        self.assertEqual(EmergencyActivationEvent.objects.filter(alert=alert).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 1)

        # Audit log records edit
        edit_log = ActivityLog.objects.filter(module='EmergencyAlert').order_by('-timestamp').first()
        details = json.loads(edit_log.details)
        self.assertEqual(details['operation'], 'emergency_edit')

    # ── Test 3: Active -> Inactive closes event without dispatching ─────────────
    def test_active_to_inactive_closes_event_without_dispatching(self):
        alert = EmergencyAlert.objects.create(
            title='Flood Warning',
            body='Water receding.',
            is_active=False,
        )
        update_emergency_alert(alert.pk, self.admin, {'is_active': True})
        event = EmergencyActivationEvent.objects.get(alert=alert, sequence=1)
        self.assertIsNone(event.deactivated_at)

        # Deactivate
        updated = update_emergency_alert(
            alert_pk=alert.pk,
            actor=self.admin,
            validated_fields={'is_active': False},
        )

        self.assertFalse(updated.is_active)
        event.refresh_from_db()
        self.assertIsNotNone(event.deactivated_at)

        # No new notification created
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 1)

        # Audit log records deactivation
        deact_log = ActivityLog.objects.filter(module='EmergencyAlert').order_by('-timestamp').first()
        details = json.loads(deact_log.details)
        self.assertEqual(details['operation'], 'emergency_deactivate')
        self.assertEqual(details['sequence'], 1)

    # ── Test 4: Inactive -> Active again creates sequence 2 & new notification ──
    def test_inactive_to_active_again_creates_new_sequence_and_new_notification(self):
        alert = EmergencyAlert.objects.create(
            title='Typhoon Signal',
            body='Signal 1.',
            is_active=False,
        )
        # 1st activation
        update_emergency_alert(alert.pk, self.admin, {'is_active': True})
        # Deactivation
        update_emergency_alert(alert.pk, self.admin, {'is_active': False})
        # 2nd activation (reactivation)
        updated = update_emergency_alert(
            alert_pk=alert.pk,
            actor=self.admin,
            validated_fields={'is_active': True},
        )

        self.assertTrue(updated.is_active)
        events = list(EmergencyActivationEvent.objects.filter(alert=alert).order_by('sequence'))
        self.assertEqual(len(events), 2)

        # Event 1 is preserved and closed
        self.assertEqual(events[0].sequence, 1)
        self.assertIsNotNone(events[0].deactivated_at)

        # Event 2 is newly created and open
        self.assertEqual(events[1].sequence, 2)
        self.assertEqual(events[1].activated_by, self.admin)
        self.assertIsNone(events[1].deactivated_at)

        # Total 2 emergency notifications created
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 2)

    # ── Test 5: Creating alert initially active follows lifecycle service ───────
    def test_creating_alert_initially_active_via_drf(self):
        self.client.force_authenticate(user=self.admin)
        payload = {
            'title': 'Severe Weather Advisory',
            'body': 'Heavy downpour expected across the city.',
            'is_active': True,
        }
        response = self.client.post('/api/news/alerts/', data=payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['is_active'])

        alert_id = response.data['id']
        alert = EmergencyAlert.objects.get(pk=alert_id)
        self.assertTrue(alert.is_active)

        # Exactly 1 activation event and 1 notification
        self.assertEqual(EmergencyActivationEvent.objects.filter(alert=alert).count(), 1)
        event = EmergencyActivationEvent.objects.get(alert=alert)
        self.assertEqual(event.sequence, 1)
        self.assertEqual(event.activated_by, self.admin)

        notif = Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).first()
        self.assertIsNotNone(notif)
        self.assertEqual(notif.title, 'EMERGENCY ADVISORY: Severe Weather Advisory')

    # ── Test 6: Dispatch failure rolls back alert creation & event ──────────────
    def test_dispatch_failure_rolls_back_alert_creation_and_event(self):
        self.client.force_authenticate(user=self.admin)
        payload = {
            'title': 'Failed Alert',
            'body': 'Will fail dispatch.',
            'is_active': True,
        }

        with patch('notifications.services.Notification.objects.create', side_effect=RuntimeError('Dispatch DB error')):
            with self.assertRaises(RuntimeError):
                self.client.post('/api/news/alerts/', data=payload, format='json')

        # Entire transaction rolled back: no alert, no event, no notification
        self.assertFalse(EmergencyAlert.objects.filter(title='Failed Alert').exists())
        self.assertEqual(EmergencyActivationEvent.objects.count(), 0)
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 0)

    def test_dispatch_failure_on_update_rolls_back_state_change(self):
        alert = EmergencyAlert.objects.create(
            title='Stable Alert',
            body='Content.',
            is_active=False,
        )

        with patch('notifications.services.Notification.objects.create', side_effect=RuntimeError('Notification creation failed')):
            with self.assertRaises(RuntimeError):
                update_emergency_alert(alert.pk, self.admin, {'is_active': True})

        # Alert remains inactive and no event was created
        alert.refresh_from_db()
        self.assertFalse(alert.is_active)
        self.assertEqual(EmergencyActivationEvent.objects.filter(alert=alert).count(), 0)

    # ── Test 7: Repeated activation requests do not create duplicates ───────────
    def test_repeated_activation_requests_are_idempotent(self):
        alert = EmergencyAlert.objects.create(
            title='Storm Alert',
            body='Storm approaching.',
            is_active=False,
        )

        # Initial activation
        update_emergency_alert(alert.pk, self.admin, {'is_active': True})
        self.assertEqual(EmergencyActivationEvent.objects.filter(alert=alert).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 1)

        # Repeated calls with is_active=True
        update_emergency_alert(alert.pk, self.admin, {'is_active': True})
        update_emergency_alert(alert.pk, self.admin, {'is_active': True})

        # Counts must remain strictly 1
        self.assertEqual(EmergencyActivationEvent.objects.filter(alert=alert).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 1)

        # Repeated calls on inactive alert are also idempotent
        update_emergency_alert(alert.pk, self.admin, {'is_active': False})
        update_emergency_alert(alert.pk, self.admin, {'is_active': False})
        update_emergency_alert(alert.pk, self.admin, {'is_active': False})
        self.assertEqual(EmergencyActivationEvent.objects.filter(alert=alert).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 1)

    # ── Test 8: DB Uniqueness Constraint ───────────────────────────────────────
    def test_unique_constraint_enforced_at_db_level(self):
        alert = EmergencyAlert.objects.create(title='DB Test', body='Body', is_active=False)
        EmergencyActivationEvent.objects.create(alert=alert, sequence=1, activated_by=self.admin)

        # Direct duplicate sequence insertion must raise IntegrityError
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                EmergencyActivationEvent.objects.create(alert=alert, sequence=1, activated_by=self.admin)

    # ── Test 9: Unauthorized users cannot perform lifecycle changes ─────────────
    def test_unauthorized_users_cannot_perform_lifecycle_changes(self):
        alert = EmergencyAlert.objects.create(
            title='Restricted Alert',
            body='Restricted info.',
            is_active=False,
        )

        non_admins = [
            (self.citizen, 'Citizen'),
            (self.watcher, 'Watcher'),
            (self.driver, 'Driver'),
            (self.brgy_official, 'Barangay Official'),
        ]

        for user, role_name in non_admins:
            self.client.force_authenticate(user=user)

            # 1. Create attempt -> 403
            res_create = self.client.post('/api/news/alerts/', data={'title': f'Alert by {role_name}', 'body': 'B', 'is_active': True})
            self.assertEqual(res_create.status_code, status.HTTP_403_FORBIDDEN, f"{role_name} should get 403 on create")

            # 2. Toggle active attempt -> 403
            res_toggle = self.client.post(f'/api/news/alerts/{alert.pk}/toggle-active/')
            self.assertEqual(res_toggle.status_code, status.HTTP_403_FORBIDDEN, f"{role_name} should get 403 on toggle-active")

            # 3. Update attempt -> 403
            res_update = self.client.patch(f'/api/news/alerts/{alert.pk}/', data={'is_active': True})
            self.assertEqual(res_update.status_code, status.HTTP_403_FORBIDDEN, f"{role_name} should get 403 on update")

        # Anonymous user -> 401
        self.client.force_authenticate(user=None)
        res_anon_toggle = self.client.post(f'/api/news/alerts/{alert.pk}/toggle-active/')
        self.assertIn(res_anon_toggle.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

    # ── Test 10: Django Admin and DRF preserve all editable fields ──────────────
    def test_drf_partial_update_preserves_fields_and_active_state(self):
        self.client.force_authenticate(user=self.admin)
        alert = EmergencyAlert.objects.create(
            title='Initial Title',
            body='Initial Body',
            is_active=False,
        )
        update_emergency_alert(alert.pk, self.admin, {'is_active': True})

        # PATCH title only
        res = self.client.patch(f'/api/news/alerts/{alert.pk}/', data={'title': 'Modified Title'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['title'], 'Modified Title')
        self.assertEqual(res.data['body'], 'Initial Body')
        self.assertTrue(res.data['is_active'])

        # PATCH body only
        res2 = self.client.patch(f'/api/news/alerts/{alert.pk}/', data={'body': 'Modified Body'}, format='json')
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(res2.data['title'], 'Modified Title')
        self.assertEqual(res2.data['body'], 'Modified Body')
        self.assertTrue(res2.data['is_active'])

        # No spurious events created
        self.assertEqual(EmergencyActivationEvent.objects.filter(alert=alert).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 1)

    def test_django_admin_save_model_lifecycle_integration(self):
        admin_site = DummyAdminSite()
        model_admin = EmergencyAlertAdmin(EmergencyAlert, admin_site)

        class MockRequest:
            user = self.admin

        class MockForm:
            def __init__(self, cleaned_data):
                self.cleaned_data = cleaned_data

        # 1. Admin Creation with is_active=True
        new_alert = EmergencyAlert(
            title='Admin Created Alert',
            body='Admin Body',
            is_active=True,
        )
        form_create = MockForm({'title': 'Admin Created Alert', 'body': 'Admin Body', 'is_active': True})
        model_admin.save_model(MockRequest(), new_alert, form_create, change=False)

        new_alert.refresh_from_db()
        self.assertTrue(new_alert.is_active)
        self.assertEqual(EmergencyActivationEvent.objects.filter(alert=new_alert).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 1)

        # 2. Admin Update editing title and body
        form_update = MockForm({'title': 'Admin Edited Alert', 'body': 'Admin Edited Body', 'is_active': True})
        model_admin.save_model(MockRequest(), new_alert, form_update, change=True)

        new_alert.refresh_from_db()
        self.assertEqual(new_alert.title, 'Admin Edited Alert')
        self.assertEqual(new_alert.body, 'Admin Edited Body')
        self.assertTrue(new_alert.is_active)
        # Still exactly 1 event and 1 notification
        self.assertEqual(EmergencyActivationEvent.objects.filter(alert=new_alert).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 1)

        # 3. Admin Deactivation
        form_deact = MockForm({'title': 'Admin Edited Alert', 'body': 'Admin Edited Body', 'is_active': False})
        model_admin.save_model(MockRequest(), new_alert, form_deact, change=True)

        new_alert.refresh_from_db()
        self.assertFalse(new_alert.is_active)
        event = EmergencyActivationEvent.objects.get(alert=new_alert, sequence=1)
        self.assertIsNotNone(event.deactivated_at)
        self.assertEqual(Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).count(), 1)

    # ── Test 11: Title truncation invariant ────────────────────────────────────
    def test_title_truncation_invariant(self):
        long_title = "A" * 250
        alert = EmergencyAlert.objects.create(
            title=long_title,
            body='Emergency details.',
            is_active=False,
        )

        update_emergency_alert(alert.pk, self.admin, {'is_active': True})
        notif = Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).first()
        self.assertIsNotNone(notif)
        self.assertLessEqual(len(notif.title), 200)
        self.assertTrue(notif.title.startswith('EMERGENCY ADVISORY: '))
