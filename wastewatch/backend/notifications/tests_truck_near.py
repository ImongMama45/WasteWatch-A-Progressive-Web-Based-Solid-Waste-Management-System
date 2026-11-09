"""
notifications/tests_truck_near.py
---------------------------------
Dedicated regression tests for database-backed notify_truck_near deduplication (Step 2).
"""

import datetime
import threading
import unittest
from unittest.mock import patch

from django.db import connection, connections, DatabaseError
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from accounts.models import Barangay, User, UserRole
from driver.models import CollectionSchedule, DriverShift, Truck
from notifications.models import Notification, NotificationType, NotificationDeduplication
from notifications.services import notify_truck_near, _TRUCK_NEAR_COOLDOWN_S


class TruckNearDeduplicationTests(TestCase):
    def setUp(self):
        # Create driver and barangays
        self.driver = User.objects.create_user(
            username='driver_truck_near',
            email='driver_tn@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
        )
        self.b1 = Barangay.objects.create(name='Barangay Alpha')
        self.b2 = Barangay.objects.create(name='Barangay Beta')

        self.truck = Truck.objects.create(plate_number='TNT-101', model='Isuzu Elf')

        # Waypoint coordinates in Lucena City
        # Stop 1 at (13.9320, 121.6120)
        # Stop 2 at (13.9350, 121.6150)
        self.schedule = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            start_time=datetime.time(8, 0),
            end_time=datetime.time(17, 0),
            waypoints=[
                {'lat': 13.9300, 'lng': 121.6100, 'label': 'Base Depot'},
                {'lat': 13.9320, 'lng': 121.6120, 'label': 'Stop 1 - Plaza', 'barangay_id': self.b1.id},
                {'lat': 13.9350, 'lng': 121.6150, 'label': 'Stop 2 - Market', 'barangay_id': self.b2.id},
            ],
        )
        self.schedule.barangays.add(self.b1, self.b2)

        self.shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck,
            schedule=self.schedule,
        )

        self.stop_1_lat = 13.9320
        self.stop_1_lng = 121.6120

    def test_first_qualifying_event_creates_notifications_and_claim(self):
        """
        A. First qualifying event creates exactly one notification per recipient
        and one deduplication row with approximately 1,800 seconds cooldown.
        """
        expected_key = f'truck_near_{self.shift.id}_{self.schedule.id}_1'

        t_before = timezone.now()
        notify_truck_near(
            shift=self.shift,
            schedule=self.schedule,
            stop_order=1,
            stop_lat=self.stop_1_lat,
            stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat,  # distance = 0m (<= 300m)
            driver_lng=self.stop_1_lng,
        )
        t_after = timezone.now()

        # Exactly 1 notification per barangay on the schedule (2 total)
        notifs = list(Notification.objects.filter(type=NotificationType.TRUCK_NEAR))
        self.assertEqual(len(notifs), 2)
        notif_barangays = {n.barangay_id for n in notifs}
        self.assertEqual(notif_barangays, {self.b1.id, self.b2.id})

        # Exactly 1 deduplication row created with future expiry
        dedup_records = list(NotificationDeduplication.objects.filter(key=expected_key))
        self.assertEqual(len(dedup_records), 1)
        claim = dedup_records[0]

        # Verify cooldown duration: expires_at must be approximately 1,800 seconds after creation
        expected_expiry_min = t_before + datetime.timedelta(seconds=_TRUCK_NEAR_COOLDOWN_S - 5)
        expected_expiry_max = t_after + datetime.timedelta(seconds=_TRUCK_NEAR_COOLDOWN_S + 5)
        self.assertGreaterEqual(claim.expires_at, expected_expiry_min)
        self.assertLessEqual(claim.expires_at, expected_expiry_max)

    def test_repeated_event_within_cooldown_creates_no_additional_notifications(self):
        """
        B. Repeated event within 1,800 seconds creates no additional notifications.
        """
        # First call: succeeds
        notify_truck_near(
            shift=self.shift,
            schedule=self.schedule,
            stop_order=1,
            stop_lat=self.stop_1_lat,
            stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat,
            driver_lng=self.stop_1_lng,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 2)
        self.assertEqual(NotificationDeduplication.objects.count(), 1)

        # Immediate duplicate ping: within cooldown -> suppressed
        notify_truck_near(
            shift=self.shift,
            schedule=self.schedule,
            stop_order=1,
            stop_lat=self.stop_1_lat,
            stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat,
            driver_lng=self.stop_1_lng,
        )
        # Counts must remain completely unchanged
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 2)
        self.assertEqual(NotificationDeduplication.objects.count(), 1)

    def test_expired_claim_permits_another_notification(self):
        """
        C. An expired claim permits another notification after 1,800 seconds.
        Time is controlled deterministically without sleeping.
        """
        expected_key = f'truck_near_{self.shift.id}_{self.schedule.id}_1'

        notify_truck_near(
            shift=self.shift,
            schedule=self.schedule,
            stop_order=1,
            stop_lat=self.stop_1_lat,
            stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat,
            driver_lng=self.stop_1_lng,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 2)

        # Age the deduplication record so expires_at is in the past (> 1,800s ago)
        dedup_row = NotificationDeduplication.objects.get(key=expected_key)
        dedup_row.expires_at = timezone.now() - datetime.timedelta(seconds=10)
        dedup_row.save()

        # Subsequent ping after expiry: must notify again and update the existing row
        notify_truck_near(
            shift=self.shift,
            schedule=self.schedule,
            stop_order=1,
            stop_lat=self.stop_1_lat,
            stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat,
            driver_lng=self.stop_1_lng,
        )
        # 2 more notifications created (total 4)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 4)

        # Deduplication row count remains 1 (updated in-place)
        dedup_records = list(NotificationDeduplication.objects.filter(key=expected_key))
        self.assertEqual(len(dedup_records), 1)
        self.assertGreater(dedup_records[0].expires_at, timezone.now())

    def test_different_shifts_schedules_and_stops_do_not_collide(self):
        """
        D. Different shift IDs, schedule IDs, and stop orders produce independent keys
        and do not collide or suppress one another.
        Specifically tests that the same shift and same stop order across two different
        schedules produces distinct keys and separate notification batches (schedule isolation).
        """
        # Create an alternate schedule using the same driver and truck
        schedule_alt = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            start_time=datetime.time(13, 0),
            end_time=datetime.time(17, 0),
            waypoints=self.schedule.waypoints,
        )
        schedule_alt.barangays.add(self.b1)

        # Create a second driver, schedule, and shift for cross-shift testing
        driver_2 = User.objects.create_user(
            username='driver_truck_near_2',
            email='driver_tn_2@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
        )
        schedule_2 = CollectionSchedule.objects.create(
            driver=driver_2,
            start_time=datetime.time(13, 0),
            end_time=datetime.time(18, 0),
            waypoints=self.schedule.waypoints,
        )
        schedule_2.barangays.add(self.b1)

        shift_2 = DriverShift.objects.create(driver=driver_2, schedule=schedule_2)

        # Event 1: shift 1, schedule 1, stop 1
        notify_truck_near(
            shift=self.shift, schedule=self.schedule, stop_order=1,
            stop_lat=self.stop_1_lat, stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat, driver_lng=self.stop_1_lng,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 2)

        # Event 2: same shift 1, same stop order 1, but DIFFERENT schedule (schedule_alt)
        # Both schedules have recipients (sched 1 has b1, b2; schedule_alt has b1).
        # Both use qualifying coordinates.
        # This call must NOT collide with Event 1, and must produce its own notification batch.
        notify_truck_near(
            shift=self.shift, schedule=schedule_alt, stop_order=1,
            stop_lat=self.stop_1_lat, stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat, driver_lng=self.stop_1_lng,
        )
        # Total notifications should increase by 1 (schedule_alt has 1 barangay: b1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 3)

        # Event 3: shift 1, schedule 1, stop 2 (different stop order)
        stop_2_lat = 13.9350
        stop_2_lng = 121.6150
        notify_truck_near(
            shift=self.shift, schedule=self.schedule, stop_order=2,
            stop_lat=stop_2_lat, stop_lng=stop_2_lng,
            driver_lat=stop_2_lat, driver_lng=stop_2_lng,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 5)

        # Event 4: shift 2, schedule 2, stop 1 (different shift & schedule)
        notify_truck_near(
            shift=shift_2, schedule=schedule_2, stop_order=1,
            stop_lat=self.stop_1_lat, stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat, driver_lng=self.stop_1_lng,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 6)

        # Assert all 4 events created distinct deduplication keys in the database
        key_shift1_sched1_stop1 = f'truck_near_{self.shift.id}_{self.schedule.id}_1'
        key_shift1_schedalt_stop1 = f'truck_near_{self.shift.id}_{schedule_alt.id}_1'
        key_shift1_sched1_stop2 = f'truck_near_{self.shift.id}_{self.schedule.id}_2'
        key_shift2_sched2_stop1 = f'truck_near_{shift_2.id}_{schedule_2.id}_1'

        self.assertTrue(NotificationDeduplication.objects.filter(key=key_shift1_sched1_stop1).exists())
        self.assertTrue(NotificationDeduplication.objects.filter(key=key_shift1_schedalt_stop1).exists())
        self.assertTrue(NotificationDeduplication.objects.filter(key=key_shift1_sched1_stop2).exists())
        self.assertTrue(NotificationDeduplication.objects.filter(key=key_shift2_sched2_stop1).exists())

        # Specifically verify schedule isolation on same shift and stop:
        self.assertNotEqual(key_shift1_sched1_stop1, key_shift1_schedalt_stop1)
        all_keys = {
            key_shift1_sched1_stop1,
            key_shift1_schedalt_stop1,
            key_shift1_sched1_stop2,
            key_shift2_sched2_stop1,
        }
        self.assertEqual(len(all_keys), 4)
        self.assertEqual(NotificationDeduplication.objects.count(), 4)

    def test_outside_radius_creates_no_notifications_and_no_claim(self):
        """
        E. A truck outside the existing 300m radius creates no notifications
        and does not consume a deduplication claim.
        """
        # Distance between (13.9320, 121.6120) and (13.9500, 121.6300) is ~2.8km (> 300m)
        notify_truck_near(
            shift=self.shift,
            schedule=self.schedule,
            stop_order=1,
            stop_lat=self.stop_1_lat,
            stop_lng=self.stop_1_lng,
            driver_lat=13.9500,
            driver_lng=121.6300,
        )

        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)
        self.assertEqual(NotificationDeduplication.objects.count(), 0)

    def test_empty_recipient_list_creates_no_notifications_and_no_claim(self):
        """
        F. An empty recipient list creates no notifications and returns early
        without consuming a deduplication claim.
        """
        empty_schedule = CollectionSchedule.objects.create(
            driver=self.driver,
            start_time=datetime.time(8, 0),
            end_time=datetime.time(17, 0),
            waypoints=self.schedule.waypoints,
        )
        # Do not add any barangays to empty_schedule

        notify_truck_near(
            shift=self.shift,
            schedule=empty_schedule,
            stop_order=1,
            stop_lat=self.stop_1_lat,
            stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat,
            driver_lng=self.stop_1_lng,
        )

        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)
        self.assertEqual(NotificationDeduplication.objects.count(), 0)

    def test_notification_insert_failure_rolls_back_claim_and_inserts(self):
        """
        G. Notification insert failure rolls back the deduplication claim and all notification inserts.
        """
        expected_key = f'truck_near_{self.shift.id}_{self.schedule.id}_1'

        with patch('notifications.services.Notification.objects.create', side_effect=DatabaseError('Simulated DB failure')):
            notify_truck_near(
                shift=self.shift,
                schedule=self.schedule,
                stop_order=1,
                stop_lat=self.stop_1_lat,
                stop_lng=self.stop_1_lng,
                driver_lat=self.stop_1_lat,
                driver_lng=self.stop_1_lng,
            )

        # Neither notification nor deduplication record must persist
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)
        self.assertFalse(NotificationDeduplication.objects.filter(key=expected_key).exists())

    def test_partial_fan_out_failure_rolls_back_entirely(self):
        """
        H. Partial fan-out failure: first recipient succeeds, second recipient raises error.
        Assert that the first insert completed and the claim was visible in-transaction
        before failure, and that all notifications and the claim roll back entirely afterward.
        """
        expected_key = f'truck_near_{self.shift.id}_{self.schedule.id}_1'
        call_count = 0
        seen_notification_count = None
        seen_claim_exists = None
        real_create = Notification.objects.create

        def faulty_create(*args, **kwargs):
            nonlocal call_count, seen_notification_count, seen_claim_exists
            call_count += 1
            if call_count == 1:
                # Allow the first insert to execute the real method
                return real_create(*args, **kwargs)
            elif call_count == 2:
                # On the second insert, record the observed in-transaction state
                # rather than asserting inside the mock (where AssertionError would
                # be caught by notify_truck_near's broad except Exception handler)
                seen_notification_count = Notification.objects.filter(
                    type=NotificationType.TRUCK_NEAR
                ).count()
                seen_claim_exists = NotificationDeduplication.objects.filter(
                    key=expected_key
                ).exists()
                raise DatabaseError('Simulated failure on second recipient')
            return real_create(*args, **kwargs)

        with patch('notifications.services.Notification.objects.create', side_effect=faulty_create):
            notify_truck_near(
                shift=self.shift,
                schedule=self.schedule,
                stop_order=1,
                stop_lat=self.stop_1_lat,
                stop_lng=self.stop_1_lng,
                driver_lat=self.stop_1_lat,
                driver_lng=self.stop_1_lng,
            )

        # Assert the mock call count and verified in-transaction state outside the mock
        self.assertEqual(call_count, 2)
        self.assertEqual(seen_notification_count, 1)
        self.assertTrue(seen_claim_exists)

        # Both the partial notification and the deduplication claim MUST be rolled back
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)
        self.assertFalse(NotificationDeduplication.objects.filter(key=expected_key).exists())

    def test_subsequent_call_after_failed_attempt_succeeds(self):
        """
        I. A subsequent call after a failed attempt can succeed because the claim rolled back.
        """
        expected_key = f'truck_near_{self.shift.id}_{self.schedule.id}_1'

        # Attempt 1: Fails due to simulated DB error
        with patch('notifications.services.Notification.objects.create', side_effect=DatabaseError('Transient DB error')):
            notify_truck_near(
                shift=self.shift,
                schedule=self.schedule,
                stop_order=1,
                stop_lat=self.stop_1_lat,
                stop_lng=self.stop_1_lng,
                driver_lat=self.stop_1_lat,
                driver_lng=self.stop_1_lng,
            )
        self.assertEqual(Notification.objects.count(), 0)
        self.assertFalse(NotificationDeduplication.objects.filter(key=expected_key).exists())

        # Attempt 2: DB restored -> call succeeds completely
        notify_truck_near(
            shift=self.shift,
            schedule=self.schedule,
            stop_order=1,
            stop_lat=self.stop_1_lat,
            stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat,
            driver_lng=self.stop_1_lng,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 2)
        self.assertTrue(NotificationDeduplication.objects.filter(key=expected_key).exists())

    def test_unrelated_notification_types_unaffected(self):
        """
        K. Unrelated notification types (e.g. ANNOUNCEMENT) remain unaffected
        in data and behavior.
        """
        Notification.objects.create(
            user=None,
            barangay=self.b1,
            title='Public Announcement',
            message='City Cleanliness Drive tomorrow',
            type=NotificationType.ANNOUNCEMENT,
        )

        notify_truck_near(
            shift=self.shift,
            schedule=self.schedule,
            stop_order=1,
            stop_lat=self.stop_1_lat,
            stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat,
            driver_lng=self.stop_1_lng,
        )

        # Announcement remains intact alongside the 2 truck-near notifications
        self.assertEqual(Notification.objects.filter(type=NotificationType.ANNOUNCEMENT).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 2)
        self.assertEqual(Notification.objects.count(), 3)


class PostgreSQLTruckNearIntegrationTests(TransactionTestCase):
    @unittest.skipUnless(connection.vendor == 'postgresql', 'Requires PostgreSQL test database for multi-connection concurrency test')
    def test_concurrent_truck_near_pings_postgresql(self):
        """
        Concurrency: Two concurrent worker threads trying to send truck-near notifications
        for the same (shift, schedule, stop_order): exactly one succeeds on PostgreSQL.
        """
        driver = User.objects.create_user(
            username='driver_pg_conc',
            email='driver_pg_conc@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
        )
        b1 = Barangay.objects.create(name='Barangay PG 1')
        b2 = Barangay.objects.create(name='Barangay PG 2')
        schedule = CollectionSchedule.objects.create(
            driver=driver,
            start_time=datetime.time(8, 0),
            end_time=datetime.time(17, 0),
            waypoints=[
                {'lat': 13.9300, 'lng': 121.6100, 'label': 'Base Depot'},
                {'lat': 13.9320, 'lng': 121.6120, 'label': 'Stop 1', 'barangay_id': b1.id},
            ],
        )
        schedule.barangays.add(b1, b2)
        shift = DriverShift.objects.create(driver=driver, schedule=schedule)

        barrier = threading.Barrier(2)
        worker_errors = []

        def worker():
            connections['default'].close()
            try:
                barrier.wait(timeout=5)
                notify_truck_near(
                    shift=shift,
                    schedule=schedule,
                    stop_order=1,
                    stop_lat=13.9320,
                    stop_lng=121.6120,
                    driver_lat=13.9320,
                    driver_lng=121.6120,
                )
            except Exception as exc:
                worker_errors.append(exc)
            finally:
                connections['default'].close()

        t1 = threading.Thread(target=worker)
        t2 = threading.Thread(target=worker)

        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        # Assert that threads are no longer alive after the join timeout
        self.assertFalse(t1.is_alive(), "Worker thread 1 timed out and is still alive")
        self.assertFalse(t2.is_alive(), "Worker thread 2 timed out and is still alive")

        if worker_errors:
            self.fail(f"Worker thread encountered unhandled exception: {worker_errors[0]}")

        # Exactly 1 set of notifications created (2 rows total for b1 and b2)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 2)

        # Exactly 1 deduplication row created
        expected_key = f'truck_near_{shift.id}_{schedule.id}_1'
        self.assertEqual(NotificationDeduplication.objects.filter(key=expected_key).count(), 1)
