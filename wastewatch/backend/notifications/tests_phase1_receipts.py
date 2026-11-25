from datetime import timedelta
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User, UserRole
from notifications.models import (
    Notification,
    NotificationReadReceipt,
    NotificationReceiptCutover,
    NotificationType,
)
from notifications.serializers import NotificationSerializer


class NotificationsPhase1ReceiptsTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.b1 = Barangay.objects.create(name='Barangay Uno')
        self.b2 = Barangay.objects.create(name='Barangay Dos')

        self.user_a = User.objects.create_user(
            username='citizen_a',
            email='citizen_a@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            barangay=self.b1,
        )

        self.user_b = User.objects.create_user(
            username='citizen_b',
            email='citizen_b@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            barangay=self.b1,
        )

        self.admin = User.objects.create_user(
            username='admin_user',
            email='admin_user@example.com',
            password='Password123!',
            role=UserRole.ADMIN,
            barangay=self.b2,
        )

        # Baseline cutover timestamp
        self.cutover_dt = timezone.now()
        NotificationReceiptCutover.objects.update_or_create(
            id=1,
            defaults={'cutover_at': self.cutover_dt}
        )

    def test_shared_notification_isolation_between_two_users(self):
        """
        User A marking a shared broadcast read creates a receipt for User A only.
        User B in the same barangay remains completely unread and unread count is unchanged.
        """
        # Shared notification created AFTER cutover
        notif = Notification.objects.create(
            title="Barangay Clean-up",
            message="Clean-up drive this Saturday.",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b1,
            user=None,
        )

        # Check User A unread count before
        self.client.force_authenticate(user=self.user_a)
        res_a = self.client.get('/api/notifications/unread/')
        self.assertEqual(res_a.status_code, status.HTTP_200_OK)
        self.assertEqual(res_a.data['count'], 1)

        # Check User B unread count before
        self.client.force_authenticate(user=self.user_b)
        res_b = self.client.get('/api/notifications/unread/')
        self.assertEqual(res_b.status_code, status.HTTP_200_OK)
        self.assertEqual(res_b.data['count'], 1)

        # User A marks notification as read (standardized envelope verified)
        self.client.force_authenticate(user=self.user_a)
        res_mark = self.client.post('/api/notifications/read/', {'ids': [notif.id]}, format='json')
        self.assertEqual(res_mark.status_code, status.HTTP_200_OK)
        self.assertTrue(res_mark.data['success'])
        self.assertEqual(res_mark.data['updated_count'], 1)
        self.assertEqual(res_mark.data['message'], 'Notifications marked as read.')

        # User A is now read (unread count = 0)
        res_a_after = self.client.get('/api/notifications/unread/')
        self.assertEqual(res_a_after.data['count'], 0)

        # User A's inbox shows is_read = True
        res_inbox_a = self.client.get('/api/notifications/')
        self.assertEqual(res_inbox_a.data['results'][0]['is_read'], True)

        # User B remains unread (unread count = 1)
        self.client.force_authenticate(user=self.user_b)
        res_b_after = self.client.get('/api/notifications/unread/')
        self.assertEqual(res_b_after.data['count'], 1)

        # User B's inbox shows is_read = False
        res_inbox_b = self.client.get('/api/notifications/')
        self.assertEqual(res_inbox_b.data['results'][0]['is_read'], False)

        # Database receipt verification
        self.assertEqual(NotificationReadReceipt.objects.filter(user=self.user_a).count(), 1)
        self.assertEqual(NotificationReadReceipt.objects.filter(user=self.user_b).count(), 0)

    def test_cutover_historical_vs_new_shared(self):
        """
        Historical shared notification (created < cutover) without receipt counts as read for badges/unread tab.
        New shared notification (created >= cutover) without receipt counts as unread.
        """
        hist_notif = Notification.objects.create(
            title="Historical Notice",
            message="Old notice before system cutover.",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b1,
            user=None,
        )
        Notification.objects.filter(id=hist_notif.id).update(
            created_at=self.cutover_dt - timedelta(days=2)
        )

        new_notif = Notification.objects.create(
            title="Fresh Notice",
            message="New notice after system cutover.",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b1,
            user=None,
        )

        self.client.force_authenticate(user=self.user_a)

        # Unread endpoint should return count = 1 (only fresh notice)
        res_unread = self.client.get('/api/notifications/unread/')
        self.assertEqual(res_unread.status_code, status.HTTP_200_OK)
        self.assertEqual(res_unread.data['count'], 1)
        self.assertEqual(len(res_unread.data['results']), 1)
        self.assertEqual(res_unread.data['results'][0]['id'], new_notif.id)

        # Inbox endpoint returns both, but historical is_read=True and new is_read=False
        res_inbox = self.client.get('/api/notifications/?tab=inbox')
        self.assertEqual(res_inbox.status_code, status.HTTP_200_OK)
        self.assertEqual(res_inbox.data['count'], 2)
        items = {item['id']: item for item in res_inbox.data['results']}
        self.assertTrue(items[hist_notif.id]['is_read'])
        self.assertFalse(items[new_notif.id]['is_read'])

        # Unread tab returns only fresh notice
        res_unread_tab = self.client.get('/api/notifications/?tab=unread')
        self.assertEqual(res_unread_tab.data['count'], 1)
        self.assertEqual(res_unread_tab.data['results'][0]['id'], new_notif.id)

    def test_mark_unread_overrides_historical_baseline(self):
        """
        Calling mark-unread on a historical shared notification creates a receipt with read_at=None,
        explicitly overriding the historical baseline and moving it to unread for that user only.
        """
        hist_notif = Notification.objects.create(
            title="Historical Notice",
            message="Old notice before system cutover.",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b1,
            user=None,
        )
        Notification.objects.filter(id=hist_notif.id).update(
            created_at=self.cutover_dt - timedelta(days=2)
        )

        self.client.force_authenticate(user=self.user_a)
        # Initially unread count is 0
        self.assertEqual(self.client.get('/api/notifications/unread/').data['count'], 0)

        # User A marks historical notification as unread
        res_mark_un = self.client.post('/api/notifications/mark-unread/', {'ids': [hist_notif.id]}, format='json')
        self.assertEqual(res_mark_un.status_code, status.HTTP_200_OK)
        self.assertTrue(res_mark_un.data['success'])
        self.assertEqual(res_mark_un.data['updated_count'], 1)
        self.assertEqual(res_mark_un.data['message'], 'Notifications marked as unread.')

        # Unread count is now 1 for User A
        self.assertEqual(self.client.get('/api/notifications/unread/').data['count'], 1)
        res_inbox = self.client.get('/api/notifications/')
        self.assertFalse(res_inbox.data['results'][0]['is_read'])

        # User B is completely unaffected: still baseline read
        self.client.force_authenticate(user=self.user_b)
        self.assertEqual(self.client.get('/api/notifications/unread/').data['count'], 0)
        res_inbox_b = self.client.get('/api/notifications/')
        self.assertTrue(res_inbox_b.data['results'][0]['is_read'])

    def test_archive_and_unarchive_preserves_read_state(self):
        """
        Archiving an item removes it from inbox and unread counts.
        Unarchiving restores it to inbox and preserves its original read state.
        """
        notif = Notification.objects.create(
            title="Fresh Notice",
            message="New notice after cutover.",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b1,
            user=None,
        )

        self.client.force_authenticate(user=self.user_a)
        # Unread count is 1 initially
        self.assertEqual(self.client.get('/api/notifications/unread/').data['count'], 1)

        # Archive the unread notification
        res_arc = self.client.post('/api/notifications/archive/', {'ids': [notif.id]}, format='json')
        self.assertEqual(res_arc.status_code, status.HTTP_200_OK)
        self.assertTrue(res_arc.data['success'])
        self.assertEqual(res_arc.data['updated_count'], 1)
        self.assertEqual(res_arc.data['message'], 'Notifications archived.')

        # Unread count drops to 0; inbox tab excludes it
        self.assertEqual(self.client.get('/api/notifications/unread/').data['count'], 0)
        self.assertEqual(self.client.get('/api/notifications/?tab=inbox').data['count'], 0)

        # Archived tab contains it
        res_archived_tab = self.client.get('/api/notifications/?tab=archived')
        self.assertEqual(res_archived_tab.data['count'], 1)
        self.assertTrue(res_archived_tab.data['results'][0]['is_archived'])
        self.assertFalse(res_archived_tab.data['results'][0]['is_read'])

        # Unarchive
        res_unarc = self.client.post('/api/notifications/unarchive/', {'ids': [notif.id]}, format='json')
        self.assertEqual(res_unarc.status_code, status.HTTP_200_OK)
        self.assertTrue(res_unarc.data['success'])
        self.assertEqual(res_unarc.data['updated_count'], 1)
        self.assertEqual(res_unarc.data['message'], 'Notifications unarchived.')

        # Restored to inbox and unread tab, read state is still unread!
        self.assertEqual(self.client.get('/api/notifications/unread/').data['count'], 1)
        self.assertEqual(self.client.get('/api/notifications/?tab=inbox').data['count'], 1)
        self.assertFalse(self.client.get('/api/notifications/?tab=inbox').data['results'][0]['is_archived'])
        self.assertFalse(self.client.get('/api/notifications/?tab=inbox').data['results'][0]['is_read'])

    def test_generic_post_put_patch_return_405(self):
        """
        Generic POST, PUT, and PATCH on /api/notifications/ must return 405 Method Not Allowed.
        """
        notif = Notification.objects.create(
            title="Sample Notice",
            message="Content",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b1,
        )

        self.client.force_authenticate(user=self.admin)

        # POST /api/notifications/
        res_post = self.client.post('/api/notifications/', {'title': 'New'}, format='json')
        self.assertEqual(res_post.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

        # PUT /api/notifications/{id}/
        res_put = self.client.put(f'/api/notifications/{notif.id}/', {'title': 'Updated'}, format='json')
        self.assertEqual(res_put.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

        # PATCH /api/notifications/{id}/
        res_patch = self.client.patch(f'/api/notifications/{notif.id}/', {'title': 'Patched'}, format='json')
        self.assertEqual(res_patch.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_admin_default_inbox_and_broadcast_management_list(self):
        """
        Admin default inbox uses the same visible scope as other users.
        ?broadcast=1 returns the broadcast management array (only for admins).
        Non-admins calling ?broadcast=1 receive 403 Forbidden.
        """
        b_notif = Notification.objects.create(
            title="Uno Broadcast",
            message="Uno Message",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b1,
            broadcast_id='11111111-1111-1111-1111-111111111111',
        )

        # Admin belongs to Barangay Dos, so b_notif is OUT of admin's default visible scope
        self.client.force_authenticate(user=self.admin)
        res_admin_inbox = self.client.get('/api/notifications/')
        self.assertEqual(res_admin_inbox.data['count'], 0)

        # Admin calls ?broadcast=1
        res_broadcast_list = self.client.get('/api/notifications/?broadcast=1')
        self.assertEqual(res_broadcast_list.status_code, status.HTTP_200_OK)
        self.assertIsInstance(res_broadcast_list.data, list)
        self.assertEqual(len(res_broadcast_list.data), 1)
        self.assertEqual(res_broadcast_list.data[0]['id'], b_notif.id)

        # Non-admin citizen calls ?broadcast=1 -> 403 Forbidden
        self.client.force_authenticate(user=self.user_a)
        res_citizen_forbidden = self.client.get('/api/notifications/?broadcast=1')
        self.assertEqual(res_citizen_forbidden.status_code, status.HTTP_403_FORBIDDEN)

    def test_mark_all_read(self):
        """
        Calling /api/notifications/read/ with {} marks all visible unread notifications read,
        excluding archived notifications.
        """
        n1 = Notification.objects.create(title="Notice 1", message="M1", type=NotificationType.ANNOUNCEMENT, barangay=self.b1)
        n2 = Notification.objects.create(title="Notice 2", message="M2", type=NotificationType.ANNOUNCEMENT, barangay=self.b1)
        n3 = Notification.objects.create(title="Notice 3", message="M3", type=NotificationType.ANNOUNCEMENT, barangay=self.b1)

        self.client.force_authenticate(user=self.user_a)

        # Archive n3
        self.client.post('/api/notifications/archive/', {'ids': [n3.id]}, format='json')

        # Currently unread count is 2 (n1 and n2)
        self.assertEqual(self.client.get('/api/notifications/unread/').data['count'], 2)

        # Mark all read
        res_mark_all = self.client.post('/api/notifications/read/', {}, format='json')
        self.assertEqual(res_mark_all.status_code, status.HTTP_200_OK)
        self.assertTrue(res_mark_all.data['success'])
        self.assertEqual(res_mark_all.data['updated_count'], 2)
        self.assertEqual(res_mark_all.data['message'], 'Notifications marked as read.')

        # Unread count is now 0
        self.assertEqual(self.client.get('/api/notifications/unread/').data['count'], 0)

        # n3 is still archived and was not marked read
        res_arc = self.client.get('/api/notifications/?tab=archived')
        self.assertEqual(res_arc.data['count'], 1)
        self.assertEqual(res_arc.data['results'][0]['id'], n3.id)

    def test_tab_validation(self):
        """
        D-01 Verification:
        Only 'inbox', 'unread', and 'archived' are accepted for tab parameter.
        Unsupported values return HTTP 400 Bad Request with field-specific ValidationError.
        Omitted tab defaults to 'inbox'.
        """
        self.client.force_authenticate(user=self.user_a)

        # Omitted tab -> 200 OK
        res_default = self.client.get('/api/notifications/')
        self.assertEqual(res_default.status_code, status.HTTP_200_OK)

        # Valid tabs -> 200 OK
        for valid_tab in ['inbox', 'unread', 'archived']:
            res_valid = self.client.get(f'/api/notifications/?tab={valid_tab}')
            self.assertEqual(res_valid.status_code, status.HTTP_200_OK)

        # Invalid tab -> 400 Bad Request
        res_invalid = self.client.get('/api/notifications/?tab=invalid_tab')
        self.assertEqual(res_invalid.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('tab', res_invalid.data)
        self.assertIn('Invalid tab parameter', res_invalid.data['tab'][0])

    def test_atomic_bulk_id_validation_mixed_and_inaccessible_ids(self):
        """
        D-03 Verification:
        - Mixed valid and nonexistent IDs reject the entire operation with HTTP 400 without changing any receipt.
        - Inaccessible IDs (another user's or another barangay's notification) receive the exact same generic error.
        - Zero partial updates occur.
        """
        # Notification in User A's scope (Barangay Uno)
        n_valid = Notification.objects.create(
            title="Valid Note",
            message="Content",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b1,
        )
        # Notification in Barangay Dos (Inaccessible to User A)
        n_inaccessible = Notification.objects.create(
            title="Other Barangay Note",
            message="Content",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b2,
        )

        self.client.force_authenticate(user=self.user_a)

        # 1. Nonexistent ID test on read/
        res_nonexistent = self.client.post('/api/notifications/read/', {'ids': [n_valid.id, 999999]}, format='json')
        self.assertEqual(res_nonexistent.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(res_nonexistent.data['success'])
        self.assertEqual(res_nonexistent.data['error'], 'Invalid notification IDs.')
        self.assertEqual(res_nonexistent.data['details']['ids'], ['One or more IDs are invalid or inaccessible.'])
        # Verify atomicity: n_valid remains completely unreceipted!
        self.assertFalse(NotificationReadReceipt.objects.filter(notification=n_valid, user=self.user_a).exists())

        # 2. Inaccessible ID test on read/ (receives identical error)
        res_inacc = self.client.post('/api/notifications/read/', {'ids': [n_valid.id, n_inaccessible.id]}, format='json')
        self.assertEqual(res_inacc.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(res_inacc.data['success'])
        self.assertEqual(res_inacc.data['details']['ids'], ['One or more IDs are invalid or inaccessible.'])
        self.assertFalse(NotificationReadReceipt.objects.filter(notification=n_valid, user=self.user_a).exists())

        # 3. Same atomic validation on mark-unread/, archive/, unarchive/
        # Set up an existing read receipt and an archived receipt to verify they do not mutate on mixed failure
        rcpt_read = NotificationReadReceipt.objects.create(
            notification=n_valid,
            user=self.user_a,
            read_at=timezone.now(),
            is_archived=False,
        )
        res_un_fail = self.client.post('/api/notifications/mark-unread/', {'ids': [n_valid.id, 999999]}, format='json')
        self.assertEqual(res_un_fail.status_code, status.HTTP_400_BAD_REQUEST)
        rcpt_read.refresh_from_db()
        self.assertIsNotNone(rcpt_read.read_at)  # Did not mutate to None!

        res_arc_fail = self.client.post('/api/notifications/archive/', {'ids': [n_valid.id, 999999]}, format='json')
        self.assertEqual(res_arc_fail.status_code, status.HTTP_400_BAD_REQUEST)
        rcpt_read.refresh_from_db()
        self.assertFalse(rcpt_read.is_archived)  # Did not mutate to True!

        rcpt_read.is_archived = True
        rcpt_read.save()
        res_unarc_fail = self.client.post('/api/notifications/unarchive/', {'ids': [n_valid.id, 999999]}, format='json')
        self.assertEqual(res_unarc_fail.status_code, status.HTTP_400_BAD_REQUEST)
        rcpt_read.refresh_from_db()
        self.assertTrue(rcpt_read.is_archived)  # Did not mutate to False!

    def test_duplicate_ids_normalized(self):
        """
        D-03 Verification:
        Duplicate IDs in request payload are normalized (deduplicated) so each unique notification is updated once.
        """
        notif = Notification.objects.create(
            title="Single Note",
            message="Content",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b1,
        )
        self.client.force_authenticate(user=self.user_a)

        res = self.client.post('/api/notifications/read/', {'ids': [notif.id, notif.id, notif.id]}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['success'])
        self.assertEqual(res.data['updated_count'], 1)
        self.assertEqual(NotificationReadReceipt.objects.filter(notification=notif, user=self.user_a).count(), 1)

    def test_mark_unread_requires_explicit_nonempty_ids(self):
        """
        D-03 Requirement 8:
        An empty or missing ID list must never mean mark-all for mark-unread, archive, or unarchive.
        """
        self.client.force_authenticate(user=self.user_a)

        for endpoint in ['/api/notifications/mark-unread/', '/api/notifications/archive/', '/api/notifications/unarchive/']:
            # Missing IDs `{}`
            res_missing = self.client.post(endpoint, {}, format='json')
            self.assertEqual(res_missing.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertFalse(res_missing.data['success'])

            # Empty list `{"ids": []}`
            res_empty = self.client.post(endpoint, {'ids': []}, format='json')
            self.assertEqual(res_empty.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertFalse(res_empty.data['success'])

    def test_serializer_raises_if_missing_annotation(self):
        """
        Serializing a Notification instance without receipt annotations must raise AttributeError.
        """
        raw_notif = Notification.objects.create(
            title="Raw Notice",
            message="Raw Message",
            type=NotificationType.ANNOUNCEMENT,
        )
        serializer = NotificationSerializer(raw_notif)
        with self.assertRaises(AttributeError):
            _ = serializer.data

    def test_missing_cutover_fails_closed_503(self):
        """
        If the cutover row is missing in the database, receipt-aware endpoints fail closed with 503.
        """
        NotificationReceiptCutover.objects.all().delete()
        self.client.force_authenticate(user=self.user_a)

        self.assertEqual(self.client.get('/api/notifications/').status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(self.client.get('/api/notifications/unread/').status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(self.client.post('/api/notifications/read/', {'ids': [1]}).status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(self.client.post('/api/notifications/mark-unread/', {'ids': [1]}).status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(self.client.post('/api/notifications/archive/', {'ids': [1]}).status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(self.client.post('/api/notifications/unarchive/', {'ids': [1]}).status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_cutover_overwrite_protection_and_backfill(self):
        """
        D-04 Verification:
        Verify set_notification_cutover overwrite protection and idempotent backfill.
        """
        # Attempting to set cutover without --force when cutover exists raises CommandError
        with self.assertRaises(CommandError) as ctx:
            call_command('set_notification_cutover', '--now')
        self.assertIn('Cutover timestamp already exists', str(ctx.exception))

        # With --force it succeeds
        call_command('set_notification_cutover', '--now', '--force')
        cutover = NotificationReceiptCutover.objects.get(pk=1)
        self.assertIsNotNone(cutover.cutover_at)

        # Create direct notification with is_read=True
        direct_notif = Notification.objects.create(
            user=self.user_a,
            title="Direct Note",
            message="Direct Content",
            type=NotificationType.ANNOUNCEMENT,
            is_read=True,
        )
        # Create shared notification
        shared_notif = Notification.objects.create(
            title="Shared Note",
            message="Shared Content",
            type=NotificationType.ANNOUNCEMENT,
            barangay=self.b1,
            is_read=True,
        )

        # Run backfill command
        call_command('backfill_notification_receipts')

        # Direct notification has a receipt
        self.assertTrue(
            NotificationReadReceipt.objects.filter(
                notification=direct_notif,
                user=self.user_a,
            ).exists()
        )

        # Shared notification has NO receipt created by backfill
        self.assertFalse(
            NotificationReadReceipt.objects.filter(
                notification=shared_notif,
            ).exists()
        )
