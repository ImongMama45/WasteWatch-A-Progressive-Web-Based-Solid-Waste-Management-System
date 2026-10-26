import uuid
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User, UserRole
from notifications.models import Notification, NotificationType


class NotificationBroadcastTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.b1 = Barangay.objects.create(name='Barangay Uno')
        self.b2 = Barangay.objects.create(name='Barangay Dos')
        self.b3 = Barangay.objects.create(name='Barangay Tres')

        # Admin with role='admin' and is_staff=False to verify app-level role handling
        self.admin = User.objects.create_user(
            username='admin_test',
            email='admin_test@example.com',
            password='Password123!',
            role=UserRole.ADMIN,
            is_staff=False,
        )

        # Normal citizen
        self.citizen = User.objects.create_user(
            username='citizen_test',
            email='citizen_test@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            barangay=self.b1,
        )

    def test_anonymous_and_citizen_forbidden_on_broadcast(self):
        payload = {
            'title': 'Test Notice',
            'message': 'Test Message',
            'type': NotificationType.ANNOUNCEMENT,
            'barangay_ids': None,
        }
        # Anonymous
        res = self.client.post('/api/notifications/broadcast/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Citizen
        self.client.force_authenticate(user=self.citizen)
        res = self.client.post('/api/notifications/broadcast/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Citizen delete
        dummy_bid = str(uuid.uuid4())
        res = self.client.delete(f'/api/notifications/broadcast/{dummy_bid}/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_broadcast_validation_failures(self):
        self.client.force_authenticate(user=self.admin)

        # Missing title
        res = self.client.post('/api/notifications/broadcast/', {
            'title': '',
            'message': 'Valid message',
            'type': NotificationType.ANNOUNCEMENT,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Title is required', res.data.get('error', ''))

        # Overlong title
        res = self.client.post('/api/notifications/broadcast/', {
            'title': 'A' * 201,
            'message': 'Valid message',
            'type': NotificationType.ANNOUNCEMENT,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Missing message
        res = self.client.post('/api/notifications/broadcast/', {
            'title': 'Valid Title',
            'message': '   ',
            'type': NotificationType.ANNOUNCEMENT,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Invalid notification type
        res = self.client.post('/api/notifications/broadcast/', {
            'title': 'Valid Title',
            'message': 'Valid message',
            'type': 'INVALID_TYPE',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Empty barangay_ids list
        res = self.client.post('/api/notifications/broadcast/', {
            'title': 'Valid Title',
            'message': 'Valid message',
            'type': NotificationType.ANNOUNCEMENT,
            'barangay_ids': [],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Non-list barangay_ids
        res = self.client.post('/api/notifications/broadcast/', {
            'title': 'Valid Title',
            'message': 'Valid message',
            'type': NotificationType.ANNOUNCEMENT,
            'barangay_ids': 'all',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Nonexistent barangay ID (atomicity: 0 rows created)
        initial_count = Notification.objects.count()
        res = self.client.post('/api/notifications/broadcast/', {
            'title': 'Valid Title',
            'message': 'Valid message',
            'type': NotificationType.ANNOUNCEMENT,
            'barangay_ids': [self.b1.id, 999999],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Notification.objects.count(), initial_count)

    def test_citywide_broadcast_creates_single_row(self):
        self.client.force_authenticate(user=self.admin)

        res = self.client.post('/api/notifications/broadcast/', {
            'title': 'Citywide Alert',
            'message': 'Lucena city emergency',
            'type': NotificationType.ANNOUNCEMENT,
            'barangay_ids': None,
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        bid = res.data.get('broadcast_id')
        self.assertTrue(bid)
        self.assertEqual(res.data.get('count'), 1)

        notif = Notification.objects.get(broadcast_id=uuid.UUID(bid))
        self.assertIsNone(notif.user)
        self.assertIsNone(notif.barangay)
        self.assertEqual(notif.title, 'Citywide Alert')

    def test_targeted_broadcast_and_delete(self):
        self.client.force_authenticate(user=self.admin)

        target_ids = [self.b1.id, self.b2.id, self.b3.id]
        res = self.client.post('/api/notifications/broadcast/', {
            'title': 'Collection Schedule Shift',
            'message': 'Truck collection shifted by 2 hours',
            'type': NotificationType.SCHEDULE_CHANGE,
            'barangay_ids': target_ids,
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        bid_str = res.data.get('broadcast_id')
        self.assertEqual(res.data.get('count'), 3)

        parsed_bid = uuid.UUID(bid_str)
        rows = Notification.objects.filter(broadcast_id=parsed_bid)
        self.assertEqual(rows.count(), 3)
        self.assertEqual(set(rows.values_list('barangay_id', flat=True)), set(target_ids))

        # Query filter ?broadcast=1
        list_res = self.client.get('/api/notifications/?broadcast=1')
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        returned_ids = [item['id'] for item in list_res.data]
        for row in rows:
            self.assertIn(row.id, returned_ids)

        # Invalid UUID for delete
        del_bad = self.client.delete('/api/notifications/broadcast/invalid-uuid/')
        self.assertEqual(del_bad.status_code, status.HTTP_400_BAD_REQUEST)

        # Nonexistent UUID for delete
        random_bid = str(uuid.uuid4())
        del_none = self.client.delete(f'/api/notifications/broadcast/{random_bid}/')
        self.assertEqual(del_none.status_code, status.HTTP_404_NOT_FOUND)

        # Successful delete
        del_res = self.client.delete(f'/api/notifications/broadcast/{bid_str}/')
        self.assertEqual(del_res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(Notification.objects.filter(broadcast_id=parsed_bid).count(), 0)

        # Repeating delete returns 404
        del_repeat = self.client.delete(f'/api/notifications/broadcast/{bid_str}/')
        self.assertEqual(del_repeat.status_code, status.HTTP_404_NOT_FOUND)


class ViewsetPermissionLockdownTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.barangay = Barangay.objects.create(name='Ibabang Dupay')

        self.admin = User.objects.create_user(
            username='admin_user',
            email='admin_perm@example.com',
            password='Password123!',
            role=UserRole.ADMIN,
            is_staff=False,
        )

        self.citizen = User.objects.create_user(
            username='citizen_user',
            email='citizen_perm@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
        )

    def test_anonymous_permissions(self):
        # Read endpoints should be 200
        self.assertEqual(self.client.get('/api/barangays/').status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get('/api/accounts/barangays/').status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get('/api/news/items/').status_code, status.HTTP_200_OK)

        # Write endpoints should be 403 Forbidden
        self.assertEqual(self.client.post('/api/accounts/barangays/', {'name': 'New B'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post('/api/news/items/', {'title': 'Hack', 'body': 'News'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post('/api/news/alerts/', {'title': 'Hack', 'body': 'Alert'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post('/api/news/spotlights/', {'title': 'Hack'}, format='json').status_code, status.HTTP_403_FORBIDDEN)

    def test_citizen_forbidden_on_writes(self):
        self.client.force_authenticate(user=self.citizen)

        self.assertEqual(self.client.post('/api/accounts/barangays/', {'name': 'Illegal B'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post('/api/news/items/', {'title': 'Citizen News', 'body': 'Content'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post('/api/news/alerts/', {'title': 'Citizen Alert', 'body': 'Content'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post('/api/news/spotlights/', {'title': 'Citizen Spotlight'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.patch(f'/api/accounts/barangay-management/{self.barangay.id}/assign-personnel/', {
            'user_id': self.citizen.id,
            'role': UserRole.BRGY_OFFICIAL,
        }, format='json').status_code, status.HTTP_403_FORBIDDEN)

    def test_barangay_assign_personnel_role_validation(self):
        self.client.force_authenticate(user=self.admin)

        # Invalid role
        res = self.client.patch(f'/api/accounts/barangay-management/{self.barangay.id}/assign-personnel/', {
            'user_id': self.citizen.id,
            'role': 'superman',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Invalid role', res.data.get('error', ''))

        # Valid role
        res = self.client.patch(f'/api/accounts/barangay-management/{self.barangay.id}/assign-personnel/', {
            'user_id': self.citizen.id,
            'role': UserRole.BRGY_OFFICIAL,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.citizen.refresh_from_db()
        self.assertEqual(self.citizen.role, UserRole.BRGY_OFFICIAL)
        self.assertEqual(self.citizen.barangay, self.barangay)
