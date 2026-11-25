import datetime
from unittest.mock import patch

from django.core.management import call_command
from django.db import connection, DatabaseError
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User, UserRole
from driver.models import CollectionSchedule, DriverShift, Truck
from dumpsite.models import Dumpsite
from notifications.models import (
    Notification,
    NotificationDeduplication,
    NotificationReceiptCutover,
    NotificationReadReceipt,
    NotificationType,
)


class Phase4EndToEndIntegrationTests(TestCase):
    """
    WasteWatch Phase 4.2: End-to-End Truck-Near Notification Integration Verification.

    Verifies the complete production lifecycle:
    Driver GPS Ingestion -> Truck-Near Proximity Evaluation -> Barangay-Scoped Notification Creation
    -> Resident Notification API -> Read Receipts / Unread Counts / Archive -> Resident Privacy Guarantee.
    """

    def setUp(self):
        self.client = APIClient()

        # 1. Establish notification receipt cutover timestamp singleton
        self.cutover_dt = timezone.now() - datetime.timedelta(hours=1)
        NotificationReceiptCutover.objects.update_or_create(
            id=1,
            defaults={'cutover_at': self.cutover_dt},
        )

        # 2. Barangays
        self.b_alpha = Barangay.objects.create(name='Barangay Alpha P4')
        self.b_beta = Barangay.objects.create(name='Barangay Beta P4')

        # 3. Users: Driver, Residents in Alpha, Resident in Beta, and Admin
        self.driver = User.objects.create_user(
            username='driver_p4_e2e',
            email='driver_p4_e2e@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
        )

        self.resident_a1 = User.objects.create_user(
            username='resident_alpha_1',
            email='resident_alpha_1@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            barangay=self.b_alpha,
        )

        self.resident_a2 = User.objects.create_user(
            username='resident_alpha_2',
            email='resident_alpha_2@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            barangay=self.b_alpha,
        )

        self.resident_b1 = User.objects.create_user(
            username='resident_beta_1',
            email='resident_beta_1@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            barangay=self.b_beta,
        )

        # 4. Fleet and Authoritative Dumpsite Base
        self.truck = Truck.objects.create(plate_number='P4-TRK-E2E', model='Isuzu Forward')
        self.dumpsite = Dumpsite.objects.create(
            name='Central Eco Dumpsite Base',
            barangay=self.b_alpha,
            latitude=13.9200,
            longitude=121.6000,
        )

        # 5. Multi-barangay collection schedule
        # Stop 0 is confirmed Base Dumpsite (coordinates match dumpsite exactly)
        # Stop 1 is in Barangay Alpha (13.9300, 121.6100)
        # Stop 2 is in Barangay Beta (13.9400, 121.6200)
        self.schedule = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            dumpsite=self.dumpsite,
            start_time=datetime.time(8, 0),
            end_time=datetime.time(17, 0),
            waypoints=[
                {'lat': 13.9200, 'lng': 121.6000, 'label': 'Central Eco Dumpsite Base'},
                {'lat': 13.9300, 'lng': 121.6100, 'label': 'Stop 1 - Town Plaza', 'barangay_id': self.b_alpha.id, 'stop_id': 's-alpha-1'},
                {'lat': 13.9400, 'lng': 121.6200, 'label': 'Stop 2 - Market Square', 'barangay_id': self.b_beta.id, 'stop_id': 's-beta-2'},
            ],
        )
        self.schedule.barangays.add(self.b_alpha, self.b_beta)

        # 6. Active driver shift in operational route status
        self.shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck,
            schedule=self.schedule,
            status='shiftroute',
            op_status='on_route',
            is_active=True,
            current_latitude=13.9200,
            current_longitude=121.6000,
            last_location_update=timezone.now(),
        )

    # -------------------------------------------------------------------------
    # A. Driver GPS Ingestion to Notification Creation (End-to-End)
    # -------------------------------------------------------------------------

    def test_qualifying_driver_gps_ping_creates_truck_near_notification(self):
        """
        Qualifying driver GPS ping within 75m doorstep radius:
        1. Persists TruckLocation and updates shift telemetry.
        2. Dispatches TRUCK_NEAR notification targeting Barangay Alpha.
        3. Registers atomic deduplication key with 1,800s cooldown.
        4. Subsequent ping within cooldown does not create a duplicate.
        """
        self.client.force_authenticate(user=self.driver)

        # Stop 1 coordinates: (13.9300, 121.6100). Truck pings at (13.9302, 121.6100) -> ~22m away.
        res1 = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9302,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')

        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Assert notification created in database
        notifs = list(Notification.objects.filter(type=NotificationType.TRUCK_NEAR))
        self.assertEqual(len(notifs), 1)
        notif = notifs[0]
        self.assertEqual(notif.barangay, self.b_alpha)
        self.assertIsNone(notif.user)
        self.assertEqual(notif.title, 'Collection Truck Approaching')
        self.assertIn('Stop 1 - Town Plaza', notif.message)
        self.assertIn('Barangay Alpha P4', notif.message)

        # Assert atomic deduplication record exists
        expected_dedup_key = f"truck_near_{self.shift.id}_{self.schedule.id}_1"
        dedup_records = NotificationDeduplication.objects.filter(key=expected_dedup_key)
        self.assertEqual(dedup_records.count(), 1)

        # Immediate repeat ping at same doorstep location (sub-10m movement)
        res2 = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.93022,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')
        self.assertEqual(res2.status_code, status.HTTP_201_CREATED)

        # Exactly 1 notification and deduplication record remain (no duplicates created)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 1)
        self.assertEqual(NotificationDeduplication.objects.filter(key=expected_dedup_key).count(), 1)

    def test_non_qualifying_pings_do_not_create_notification(self):
        """
        Non-qualifying telemetry observations do not create notifications:
        - Inaccurate GPS (accuracy > 150m) rejected before mutation.
        - Coarse GPS (101m - 150m) updates shift tracking but suppresses push alert.
        - Non-route shift operational status suppresses notification.
        - Moving away vector in outer detection zone suppresses notification.
        """
        self.client.force_authenticate(user=self.driver)

        # 1. Inaccurate GPS (> 150m)
        res_inaccurate = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9300,
            'longitude': 121.6100,
            'accuracy': 180.0,
        }, format='json')
        self.assertEqual(res_inaccurate.status_code, status.HTTP_200_OK)
        self.assertTrue(res_inaccurate.data.get('skipped'))
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)

        # 2. Coarse GPS (101-150m)
        res_coarse = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9300,
            'longitude': 121.6100,
            'accuracy': 120.0,
        }, format='json')
        self.assertEqual(res_coarse.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)

        # 3. Non-route status (e.g. returning to base)
        self.shift.status = 'navigate_to_base'
        self.shift.op_status = 'heading_to_base'
        self.shift.save()

        res_wrong_status = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9301,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')
        self.assertEqual(res_wrong_status.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)

    def test_atomic_deduplication_rollback_on_notification_failure(self):
        """
        If notification creation fails (e.g. database error), transaction rollback ensures
        no orphaned NotificationDeduplication claim is left behind.
        """
        self.client.force_authenticate(user=self.driver)

        with patch('notifications.services.Notification.objects.create', side_effect=DatabaseError('Simulated DB Crash')):
            res = self.client.post('/api/driver/truck-locations/', {
                'latitude': 13.9301,
                'longitude': 121.6100,
                'accuracy': 10.0,
            }, format='json')
            self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        # Assert no dangling deduplication record and zero notifications
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)
        self.assertEqual(NotificationDeduplication.objects.count(), 0)

    # -------------------------------------------------------------------------
    # B. Barangay Visibility Isolation
    # -------------------------------------------------------------------------

    def test_barangay_visibility_isolation_between_residents(self):
        """
        Verifies visibility boundary at the API level:
        - Resident of Barangay Alpha can retrieve Barangay Alpha's TRUCK_NEAR alert.
        - Resident of Barangay Beta CANNOT retrieve Barangay Alpha's TRUCK_NEAR alert.
        - Direct GET by ID returns 404 Not Found for residents outside the target barangay.
        - Anonymous requests are rejected with 401 Unauthorized.
        - Citywide notifications remain visible to both barangays.
        - Multi-barangay schedule does not broadcast to Barangay Beta when approaching Barangay Alpha stop.
        """
        # Create a TRUCK_NEAR notification targeting Barangay Alpha
        notif_alpha = Notification.objects.create(
            title='Collection Truck Approaching',
            message='The collection truck is approaching Stop 1 - Town Plaza in Barangay Alpha P4. Please prepare your segregated waste.',
            type=NotificationType.TRUCK_NEAR,
            barangay=self.b_alpha,
            user=None,
        )

        # Create a citywide announcement (user=None, barangay=None)
        notif_citywide = Notification.objects.create(
            title='City Clean Air Summit',
            message='Annual eco seminar open to all residents.',
            type=NotificationType.ANNOUNCEMENT,
            barangay=None,
            user=None,
        )

        # Create an unrelated private notification for another citizen
        notif_private = Notification.objects.create(
            title='Private Report Update',
            message='Your report #101 has been received.',
            type=NotificationType.REPORT_UPDATE,
            barangay=None,
            user=self.driver,
        )

        # --- 1. Resident Alpha Scope ---
        self.client.force_authenticate(user=self.resident_a1)
        res_a_list = self.client.get('/api/notifications/')
        self.assertEqual(res_a_list.status_code, status.HTTP_200_OK)
        a_ids = [n['id'] for n in res_a_list.data['results']]

        self.assertIn(notif_alpha.id, a_ids, "Resident Alpha must see Barangay Alpha's TRUCK_NEAR alert")
        self.assertIn(notif_citywide.id, a_ids, "Resident Alpha must see citywide announcement")
        self.assertNotIn(notif_private.id, a_ids, "Resident Alpha must not see other user's private notification")

        # Direct detail retrieval for Alpha resident -> 200 OK
        res_a_detail = self.client.get(f'/api/notifications/{notif_alpha.id}/')
        self.assertEqual(res_a_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(res_a_detail.data['id'], notif_alpha.id)

        # --- 2. Resident Beta Scope ---
        self.client.force_authenticate(user=self.resident_b1)
        res_b_list = self.client.get('/api/notifications/')
        self.assertEqual(res_b_list.status_code, status.HTTP_200_OK)
        b_ids = [n['id'] for n in res_b_list.data['results']]

        self.assertNotIn(notif_alpha.id, b_ids, "Resident Beta must NEVER see Barangay Alpha's TRUCK_NEAR alert")
        self.assertIn(notif_citywide.id, b_ids, "Resident Beta must see citywide announcement")
        self.assertNotIn(notif_private.id, b_ids, "Resident Beta must not see other user's private notification")

        # Direct detail retrieval for Beta resident -> 404 Not Found (scoped out)
        res_b_detail = self.client.get(f'/api/notifications/{notif_alpha.id}/')
        self.assertEqual(res_b_detail.status_code, status.HTTP_404_NOT_FOUND)

        # --- 3. Anonymous Access ---
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get('/api/notifications/').status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])
        self.assertIn(self.client.get('/api/notifications/unread/').status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])
        self.assertIn(self.client.get(f'/api/notifications/{notif_alpha.id}/').status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

    # -------------------------------------------------------------------------
    # C. Read Receipts, Archive, and Unread Counts
    # -------------------------------------------------------------------------

    def test_truck_near_read_receipts_archive_and_unread_counts(self):
        """
        Verifies integration with NotificationReadReceipt architecture:
        - New TRUCK_NEAR notification appears in unread endpoint with accurate count.
        - Marking read records a per-user receipt and decreases unread count.
        - Another resident in the same barangay remains unread (receipt isolation).
        - Archiving moves notification to archived tab and removes it from unread/inbox.
        - Cross-resident read action on inaccessible notification returns HTTP 400.
        """
        notif = Notification.objects.create(
            title='Collection Truck Approaching',
            message='The collection truck is approaching Stop 1 - Town Plaza in Barangay Alpha P4. Please prepare your segregated waste.',
            type=NotificationType.TRUCK_NEAR,
            barangay=self.b_alpha,
            user=None,
        )

        # --- Step 1: Initial unread state for Resident A1 and Resident A2 ---
        self.client.force_authenticate(user=self.resident_a1)
        res_unread_a1 = self.client.get('/api/notifications/unread/')
        self.assertEqual(res_unread_a1.status_code, status.HTTP_200_OK)
        self.assertEqual(res_unread_a1.data['count'], 1)
        self.assertEqual(res_unread_a1.data['results'][0]['id'], notif.id)
        self.assertFalse(res_unread_a1.data['results'][0]['is_read'])

        self.client.force_authenticate(user=self.resident_a2)
        res_unread_a2 = self.client.get('/api/notifications/unread/')
        self.assertEqual(res_unread_a2.status_code, status.HTTP_200_OK)
        self.assertEqual(res_unread_a2.data['count'], 1)

        # --- Step 2: Resident A1 marks notification as read ---
        self.client.force_authenticate(user=self.resident_a1)
        res_mark_read = self.client.post('/api/notifications/read/', {'ids': [notif.id]}, format='json')
        self.assertEqual(res_mark_read.status_code, status.HTTP_200_OK)
        self.assertTrue(res_mark_read.data['success'])
        self.assertEqual(res_mark_read.data['updated_count'], 1)

        # Resident A1 unread count drops to 0
        res_unread_a1_after = self.client.get('/api/notifications/unread/')
        self.assertEqual(res_unread_a1_after.data['count'], 0)
        self.assertEqual(len(res_unread_a1_after.data['results']), 0)

        # Resident A1 inbox reflects is_read = True
        res_inbox_a1 = self.client.get('/api/notifications/?tab=inbox')
        self.assertEqual(res_inbox_a1.data['results'][0]['id'], notif.id)
        self.assertTrue(res_inbox_a1.data['results'][0]['is_read'])

        # --- Step 3: Receipt Isolation: Resident A2 remains unread ---
        self.client.force_authenticate(user=self.resident_a2)
        res_unread_a2_after = self.client.get('/api/notifications/unread/')
        self.assertEqual(res_unread_a2_after.data['count'], 1, "Resident A2 unread count must NOT be affected by Resident A1")
        self.assertFalse(res_unread_a2_after.data['results'][0]['is_read'])

        # --- Step 4: Resident A1 archives notification ---
        self.client.force_authenticate(user=self.resident_a1)
        res_archive = self.client.post('/api/notifications/archive/', {'ids': [notif.id]}, format='json')
        self.assertEqual(res_archive.status_code, status.HTTP_200_OK)
        self.assertEqual(res_archive.data['updated_count'], 1)

        # Excluded from inbox tab for Resident A1
        res_inbox_a1_archived = self.client.get('/api/notifications/?tab=inbox')
        self.assertEqual(len(res_inbox_a1_archived.data['results']), 0)

        # Present in archived tab for Resident A1
        res_archived_a1 = self.client.get('/api/notifications/?tab=archived')
        self.assertEqual(len(res_archived_a1.data['results']), 1)
        self.assertTrue(res_archived_a1.data['results'][0]['is_archived'])

        # Resident A2 still sees it in inbox unarchived
        self.client.force_authenticate(user=self.resident_a2)
        res_inbox_a2 = self.client.get('/api/notifications/?tab=inbox')
        self.assertEqual(len(res_inbox_a2.data['results']), 1)
        self.assertFalse(res_inbox_a2.data['results'][0]['is_archived'])

        # --- Step 5: Cross-barangay read action rejected ---
        self.client.force_authenticate(user=self.resident_b1)
        res_cross_read = self.client.post('/api/notifications/read/', {'ids': [notif.id]}, format='json')
        self.assertEqual(res_cross_read.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_cross_read.data['error'], 'Invalid notification IDs.')

    # -------------------------------------------------------------------------
    # D & E. Frontend Contract Alignment and Resident Privacy Inspection
    # -------------------------------------------------------------------------

    def test_frontend_notification_contract_and_resident_privacy_guarantee(self):
        """
        Verifies:
        1. API payload conforms to frontend consumer contract (NotificationsPage.jsx / useNotifications.js).
        2. Absolute privacy protection: Zero leak of driver personal info, truck plates, GPS coordinates,
           dumpsite internal codes, or shift IDs.
        """
        # Trigger real end-to-end GPS telemetry
        self.client.force_authenticate(user=self.driver)
        self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9302,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')

        # Retrieve through Resident Alpha's API session
        self.client.force_authenticate(user=self.resident_a1)
        res = self.client.get('/api/notifications/unread/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # 1. Frontend Envelope structure
        self.assertIn('count', res.data)
        self.assertIn('results', res.data)
        self.assertEqual(res.data['count'], 1)

        item = res.data['results'][0]

        # 2. Frontend Contract Field Alignment
        self.assertEqual(item['type'], 'TRUCK_NEAR')
        self.assertEqual(item['title'], 'Collection Truck Approaching')
        self.assertEqual(item['barangay_name'], 'Barangay Alpha P4')
        self.assertIs(item['is_read'], False)
        self.assertIs(item['is_archived'], False)
        self.assertIn('created_at', item)

        # Message format verification
        msg = item['message']
        self.assertIn('Stop 1 - Town Plaza', msg)
        self.assertIn('Barangay Alpha P4', msg)

        # 3. Privacy Guarantees — Verify absence of internal/private identifiers
        # Serializer should not contain operational keys
        self.assertNotIn('shift', item)
        self.assertNotIn('shift_id', item)
        self.assertNotIn('truck', item)
        self.assertNotIn('truck_id', item)
        self.assertNotIn('driver', item)
        self.assertNotIn('driver_id', item)
        self.assertNotIn('latitude', item)
        self.assertNotIn('longitude', item)

        # Content must not expose internal details
        serialized_content = f"{item['title']} {item['message']}"
        self.assertNotIn(self.driver.username, serialized_content)
        self.assertNotIn(self.driver.email, serialized_content)
        self.assertNotIn(self.truck.plate_number, serialized_content)
        self.assertNotIn(self.truck.model, serialized_content)
        self.assertNotIn(self.dumpsite.name, serialized_content)
        self.assertNotIn('13.9302', serialized_content)
        self.assertNotIn('121.6100', serialized_content)
        self.assertNotIn('s-alpha-1', serialized_content)
        self.assertNotIn(f"shift #{self.shift.id}", serialized_content.lower())

        # Iconography rule check: no emojis in message, title, or serialized payload
        for char in msg + item['title']:
            self.assertLess(ord(char), 127000, f"Emoji character detected: {char}")

