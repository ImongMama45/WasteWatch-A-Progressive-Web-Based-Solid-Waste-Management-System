"""
notifications/tests_truck_near.py
---------------------------------
Dedicated regression tests for route waypoint resolution and TRUCK_NEAR notifications (Phase 4.1).
"""

import datetime
import threading
import unittest
from unittest.mock import patch

from django.db import connection, connections, DatabaseError
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User, UserRole
from driver.models import CollectionSchedule, DriverShift, Truck, TruckLocation, PickupStatus
from dumpsite.models import Dumpsite
from notifications.models import Notification, NotificationType, NotificationDeduplication
from notifications.deduplication import _reset_prune_throttle_for_testing
from notifications.services import notify_truck_near, _TRUCK_NEAR_COOLDOWN_S
from watcher.models import StopValidation, StopValidationStatus


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

        self.dumpsite = Dumpsite.objects.create(
            name='Lucena Central Dumpsite',
            barangay=self.b1,
            latitude=13.9300,
            longitude=121.6100,
        )

        # Waypoint coordinates in Lucena City
        # Stop 1 at (13.9320, 121.6120) in Barangay Alpha
        # Stop 2 at (13.9350, 121.6150) in Barangay Beta
        self.schedule = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            dumpsite=self.dumpsite,
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
            status='shiftroute',
            op_status='on_route',
        )

        self.stop_1_lat = 13.9320
        self.stop_1_lng = 121.6120

    def test_first_qualifying_event_creates_notifications_and_claim(self):
        """
        A. First qualifying event creates exactly one notification for the targeted barangay
        and one deduplication row with approximately 1,800 seconds cooldown.
        Single-barangay targeting is enforced: Barangay Beta receives 0 notifications.
        """
        expected_key = f'truck_near_{self.shift.id}_{self.schedule.id}_1'

        t_before = timezone.now()
        notify_truck_near(
            shift=self.shift,
            schedule=self.schedule,
            stop_order=1,
            stop_lat=self.stop_1_lat,
            stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat,  # distance = 0m (<= 350m)
            driver_lng=self.stop_1_lng,
        )
        t_after = timezone.now()

        # Exactly 1 notification created for the target barangay (b1), none for b2
        notifs = list(Notification.objects.filter(type=NotificationType.TRUCK_NEAR))
        self.assertEqual(len(notifs), 1)
        self.assertEqual(notifs[0].barangay_id, self.b1.id)
        self.assertEqual(Notification.objects.filter(barangay=self.b2).count(), 0)

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
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 1)
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
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 1)
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
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 1)

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
        # 1 more notification created (total 2)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 2)

        # Deduplication row count remains 1 (updated in-place)
        dedup_records = list(NotificationDeduplication.objects.filter(key=expected_key))
        self.assertEqual(len(dedup_records), 1)
        self.assertGreater(dedup_records[0].expires_at, timezone.now())

    def test_different_shifts_schedules_and_stops_do_not_collide(self):
        """
        D. Different shift IDs, schedule IDs, and stop orders produce independent keys
        and do not collide or suppress one another.
        """
        # Create an alternate schedule using the same driver and truck
        schedule_alt = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            dumpsite=self.dumpsite,
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
            dumpsite=self.dumpsite,
            start_time=datetime.time(13, 0),
            end_time=datetime.time(18, 0),
            waypoints=self.schedule.waypoints,
        )
        schedule_2.barangays.add(self.b1)

        shift_2 = DriverShift.objects.create(
            driver=driver_2,
            schedule=schedule_2,
            status='shiftroute',
            op_status='on_route',
        )

        # Event 1: shift 1, schedule 1, stop 1 -> 1 notif (b1)
        notify_truck_near(
            shift=self.shift, schedule=self.schedule, stop_order=1,
            stop_lat=self.stop_1_lat, stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat, driver_lng=self.stop_1_lng,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 1)

        # Event 2: same shift 1, same stop order 1, but DIFFERENT schedule (schedule_alt) -> 1 notif (b1)
        notify_truck_near(
            shift=self.shift, schedule=schedule_alt, stop_order=1,
            stop_lat=self.stop_1_lat, stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat, driver_lng=self.stop_1_lng,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 2)

        # Event 3: shift 1, schedule 1, stop 2 (different stop order -> b2) -> 1 notif (b2)
        stop_2_lat = 13.9350
        stop_2_lng = 121.6150
        notify_truck_near(
            shift=self.shift, schedule=self.schedule, stop_order=2,
            stop_lat=stop_2_lat, stop_lng=stop_2_lng,
            driver_lat=stop_2_lat, driver_lng=stop_2_lng,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 3)

        # Event 4: shift 2, schedule 2, stop 1 (different shift & schedule -> b1) -> 1 notif (b1)
        notify_truck_near(
            shift=shift_2, schedule=schedule_2, stop_order=1,
            stop_lat=self.stop_1_lat, stop_lng=self.stop_1_lng,
            driver_lat=self.stop_1_lat, driver_lng=self.stop_1_lng,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 4)

        # Assert all 4 events created distinct deduplication keys in the database
        key_shift1_sched1_stop1 = f'truck_near_{self.shift.id}_{self.schedule.id}_1'
        key_shift1_schedalt_stop1 = f'truck_near_{self.shift.id}_{schedule_alt.id}_1'
        key_shift1_sched1_stop2 = f'truck_near_{self.shift.id}_{self.schedule.id}_2'
        key_shift2_sched2_stop1 = f'truck_near_{shift_2.id}_{schedule_2.id}_1'

        self.assertTrue(NotificationDeduplication.objects.filter(key=key_shift1_sched1_stop1).exists())
        self.assertTrue(NotificationDeduplication.objects.filter(key=key_shift1_schedalt_stop1).exists())
        self.assertTrue(NotificationDeduplication.objects.filter(key=key_shift1_sched1_stop2).exists())
        self.assertTrue(NotificationDeduplication.objects.filter(key=key_shift2_sched2_stop1).exists())

    def test_outside_radius_creates_no_notifications_and_no_claim(self):
        """
        E. A truck outside the 350m radius creates no notifications and no deduplication claim.
        """
        # Distance ~2.8km (> 350m)
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
            dumpsite=self.dumpsite,
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
        G. Notification insert failure rolls back the deduplication claim and all inserts.
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

        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)
        self.assertFalse(NotificationDeduplication.objects.filter(key=expected_key).exists())

    def test_subsequent_call_after_failed_attempt_succeeds(self):
        """
        H. A subsequent call after a failed attempt can succeed because the claim rolled back.
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
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 1)
        self.assertTrue(NotificationDeduplication.objects.filter(key=expected_key).exists())


class Phase4RouteAndTruckNearTests(TestCase):
    """
    Focused verification tests for Phase 4.1 specifications:
    - Base / Dumpsite resolution & fail-closed behavior
    - Waypoint index 0 & stop_order convention
    - Pending-inspection eligibility & completed/empty exclusion
    - Extended mode missed-stop retargeting
    - Conflicting IDs & duplicate record fail-closed handling
    - Single-barangay fallback vs multi-barangay isolation
    - GPS accuracy validation ordering & shift mutation gating
    - Sub-10m immediate arrival bypass & first-ping/stale-observation handling
    - Shift operational status gating
    - Privacy-compliant resident notification payloads
    """

    def setUp(self):
        self.client = APIClient()
        self.driver = User.objects.create_user(
            username='driver_p4',
            email='driver_p4@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
        )
        self.client.force_authenticate(user=self.driver)

        self.truck = Truck.objects.create(plate_number='P4-TRK-01', model='Isuzu Forward')
        self.b_alpha = Barangay.objects.create(name='Barangay Alpha P4')
        self.b_beta = Barangay.objects.create(name='Barangay Beta P4')

        self.dumpsite = Dumpsite.objects.create(
            name='Central Eco Dumpsite',
            barangay=self.b_alpha,
            latitude=13.9200,
            longitude=121.6000,
        )

        self.schedule = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            dumpsite=self.dumpsite,
            start_time=datetime.time(8, 0),
            end_time=datetime.time(17, 0),
            waypoints=[
                {'lat': 13.9200, 'lng': 121.6000, 'label': 'Base Dumpsite'},
                {'lat': 13.9300, 'lng': 121.6100, 'label': 'Stop 1 - Plaza', 'barangay_id': self.b_alpha.id, 'stop_id': 's-1'},
                {'lat': 13.9400, 'lng': 121.6200, 'label': 'Stop 2 - Market', 'barangay_id': self.b_beta.id, 'stop_id': 's-2'},
            ],
        )
        self.schedule.barangays.add(self.b_alpha, self.b_beta)

        self.shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck,
            schedule=self.schedule,
            status='shiftroute',
            op_status='on_route',
            is_active=True,
        )

    # 1. Dumpsite missing/invalid fail-closed behavior
    def test_dumpsite_missing_or_invalid_fails_closed(self):
        """Schedule with missing or invalid dumpsite fails closed without alerting."""
        self.schedule.dumpsite = None
        self.schedule.save()

        notify_truck_near(
            shift=self.shift,
            schedule=self.schedule,
            stop_order=1,
            stop_lat=13.9300,
            stop_lng=121.6100,
            driver_lat=13.9300,
            driver_lng=121.6100,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)
        self.assertEqual(NotificationDeduplication.objects.count(), 0)

    # 2. Waypoint index 0 and actual stop-order convention
    def test_waypoint_index_zero_collection_stop_when_not_dumpsite(self):
        """Waypoint at index 0 without base marker and distinct from dumpsite is treated as a collection stop."""
        sched_with_stop0 = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            dumpsite=self.dumpsite,
            start_time=datetime.time(8, 0),
            end_time=datetime.time(17, 0),
            waypoints=[
                {'lat': 13.9250, 'lng': 121.6050, 'label': 'Stop 0 Corner', 'barangay_id': self.b_alpha.id},
                {'lat': 13.9300, 'lng': 121.6100, 'label': 'Stop 1 Plaza', 'barangay_id': self.b_alpha.id},
            ],
        )
        sched_with_stop0.barangays.add(self.b_alpha)

        from driver.views import resolve_eligible_collection_stops
        stops = resolve_eligible_collection_stops(self.shift, sched_with_stop0)
        stop_orders = [s['stop_order'] for s in stops]
        self.assertIn(0, stop_orders)
        self.assertIn(1, stop_orders)

    # 3. Pending-inspection eligibility and completed/empty exclusion
    def test_pending_inspection_eligible_and_completed_empty_excluded(self):
        """PENDING_INSPECTION and READY_FOR_COLLECTION stops are eligible; completed and empty stops are excluded."""
        today = timezone.localdate()
        StopValidation.objects.filter(
            schedule=self.schedule,
            stop_order=1,
            collection_date=today,
        ).update(
            current_status=StopValidationStatus.PENDING_INSPECTION,
            stop_id='s-1',
        )
        StopValidation.objects.filter(
            schedule=self.schedule,
            stop_order=2,
            collection_date=today,
        ).update(
            current_status=StopValidationStatus.EMPTY_STOP,
            stop_id='s-2',
        )

        from driver.views import resolve_eligible_collection_stops
        stops = resolve_eligible_collection_stops(self.shift, self.schedule)
        self.assertEqual(len(stops), 1)
        self.assertEqual(stops[0]['stop_order'], 1)

        # Mark stop 1 as completed -> now excluded
        PickupStatus.objects.filter(
            schedule=self.schedule,
            stop_order=1,
        ).update(status='COMPLETED')
        stops_after_complete = resolve_eligible_collection_stops(self.shift, self.schedule)
        self.assertEqual(len(stops_after_complete), 0)

    # 4. Extended mode missed-stop retargeting
    def test_extended_mode_reconsiders_missed_and_failed_stops(self):
        """DRIVER_MISSED stops are excluded in normal mode but reconsidered in extended mode."""
        PickupStatus.objects.filter(
            schedule=self.schedule,
            stop_order=1,
        ).update(
            status='DRIVER_MISSED',
            stop_id='s-1',
        )

        from driver.views import resolve_eligible_collection_stops
        # Normal mode: excluded
        self.shift.is_extended_mode = False
        self.shift.save()
        stops_normal = resolve_eligible_collection_stops(self.shift, self.schedule)
        self.assertEqual([s['stop_order'] for s in stops_normal], [2])

        # Extended mode: reconsidered and eligible
        self.shift.is_extended_mode = True
        self.shift.save()
        stops_extended = resolve_eligible_collection_stops(self.shift, self.schedule)
        self.assertIn(1, [s['stop_order'] for s in stops_extended])

    # 5. Conflicting IDs and duplicate records fail closed
    def test_conflicting_ids_and_duplicates_fail_closed(self):
        """Conflicting stop_ids and duplicate stop_order records fail closed for that stop."""
        PickupStatus.objects.filter(
            schedule=self.schedule,
            stop_order=1,
        ).update(
            status='EN_ROUTE',
            stop_id='mismatched-id-999',  # Waypoint has 's-1'
        )

        from driver.views import resolve_eligible_collection_stops
        stops = resolve_eligible_collection_stops(self.shift, self.schedule)
        # Stop 1 failed closed due to conflict; only Stop 2 remains eligible
        self.assertEqual([s['stop_order'] for s in stops], [2])

        # Duplicate records fail closed: create a second record for stop 2
        PickupStatus.objects.create(
            driver=self.driver,
            schedule=self.schedule,
            stop_order=2,
            status='EN_ROUTE',
            stop_id='s-2',
        )
        stops_dup = resolve_eligible_collection_stops(self.shift, self.schedule)
        # Both stop 1 (conflict) and stop 2 (duplicate) fail closed -> 0 eligible stops
        self.assertEqual(len(stops_dup), 0)

    # 6. Single-barangay fallback and multi-barangay isolation
    def test_single_barangay_fallback_and_multibarangay_isolation(self):
        """Sole schedule barangay acts as fallback when barangay_id is missing; multi-barangay fails closed."""
        single_sched = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            dumpsite=self.dumpsite,
            start_time=datetime.time(8, 0),
            end_time=datetime.time(17, 0),
            waypoints=[
                {'lat': 13.9200, 'lng': 121.6000, 'label': 'Base Depot'},
                {'lat': 13.9300, 'lng': 121.6100, 'label': 'Stop No ID'},  # Missing barangay_id
            ],
        )
        single_sched.barangays.add(self.b_alpha)

        from driver.views import resolve_eligible_collection_stops
        stops_single = resolve_eligible_collection_stops(self.shift, single_sched)
        self.assertEqual(len(stops_single), 1)
        self.assertEqual(stops_single[0]['barangay'].id, self.b_alpha.id)

        # Multi-barangay schedule with missing barangay_id: fails closed
        multi_sched = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            dumpsite=self.dumpsite,
            start_time=datetime.time(8, 0),
            end_time=datetime.time(17, 0),
            waypoints=[
                {'lat': 13.9200, 'lng': 121.6000, 'label': 'Base Depot'},
                {'lat': 13.9300, 'lng': 121.6100, 'label': 'Stop Multi No ID'},
            ],
        )
        multi_sched.barangays.add(self.b_alpha, self.b_beta)
        stops_multi = resolve_eligible_collection_stops(self.shift, multi_sched)
        self.assertEqual(len(stops_multi), 0)

    # 7. GPS accuracy validation ordering & shift mutation gating
    def test_gps_accuracy_validation_before_shift_mutation(self):
        """Accuracy > 150m is rejected without mutating shift coordinates, writing location, or alerting."""
        initial_lat = self.shift.current_latitude
        initial_time = self.shift.last_location_update

        res = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9300,
            'longitude': 121.6100,
            'accuracy': 200.0,  # Inaccurate cellular ping (> 150m)
        }, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data.get('skipped'), True)
        self.assertEqual(res.data.get('reason'), 'poor_accuracy')

        self.shift.refresh_from_db()
        self.assertEqual(self.shift.current_latitude, initial_lat)
        self.assertEqual(self.shift.last_location_update, initial_time)
        self.assertEqual(TruckLocation.objects.filter(shift=self.shift).count(), 0)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)

    def test_gps_accuracy_between_101m_and_150m_updates_shift_but_suppresses_push_alert(self):
        """Pings between 101m and 150m update map tracking coordinates but suppress resident push alerts."""
        res = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9300,
            'longitude': 121.6100,
            'accuracy': 125.0,  # Valid for shift map (<= 150m), but too coarse for push alerts (> 100m)
        }, format='json')

        self.assertEqual(res.status_code, 201)
        self.shift.refresh_from_db()
        self.assertEqual(float(self.shift.current_latitude), 13.9300)
        self.assertEqual(TruckLocation.objects.filter(shift=self.shift).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)

    # 8. Sub-10m immediate arrival bypass
    def test_sub_10m_movement_bypassed_for_immediate_doorstep_arrival(self):
        """Sub-10m movement is bypassed when truck is within 75m of an eligible target stop."""
        # Initial ping 30m away from Stop 1 (13.9300, 121.6100)
        self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9302,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 1)

        # Second ping: moves only 2 meters (sub-10m) at the doorstep
        res = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.93021,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')
        # Not skipped as 'no_movement'; accepted as 201
        self.assertEqual(res.status_code, 201)

    # 9. First-ping and stale-observation handling
    def test_first_ping_at_outer_detection_zone_establishes_baseline_without_alert(self):
        """First ping at 250m establishes baseline and requires subsequent ping to verify approach."""
        # Ping 1 at ~250m from Stop 1
        res1 = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9280,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')
        self.assertEqual(res1.status_code, 201)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)

        # Ping 2 moves closer to Stop 1 by 35m (Delta D >= 15m)
        res2 = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9283,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')
        self.assertEqual(res2.status_code, 201)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 1)

    def test_approach_vector_moving_away_suppressed(self):
        """Truck moving away from target stop (Delta D < 0) does not dispatch alerts."""
        # Ping 1 at 200m
        self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9282,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')

        # Ping 2 moves further away from Stop 1 to 280m
        self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9275,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)

    # 10. Shift operational status gating
    def test_shift_status_and_op_status_gating(self):
        """Alerts are dispatched only when shift.status == 'shiftroute' and op_status == 'on_route'."""
        self.shift.status = 'navigate_to_base'
        self.shift.op_status = 'heading_to_start'
        self.shift.save()

        res = self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9300,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)

    # 11. Privacy-clean resident-facing payload
    def test_resident_facing_privacy_payload(self):
        """Resident payload contains no driver name, plate number, phone, or dumpsite codes."""
        self.client.post('/api/driver/truck-locations/', {
            'latitude': 13.9300,
            'longitude': 121.6100,
            'accuracy': 10.0,
        }, format='json')

        notifs = list(Notification.objects.filter(type=NotificationType.TRUCK_NEAR))
        self.assertEqual(len(notifs), 1)
        msg = notifs[0].message
        title = notifs[0].title

        self.assertEqual(title, 'Collection Truck Approaching')
        self.assertIn('Stop 1 - Plaza', msg)
        self.assertIn('Barangay Alpha P4', msg)

        # Assert no private operational details leaked
        self.assertNotIn(self.driver.username, msg)
        self.assertNotIn(self.truck.plate_number, msg)
        self.assertNotIn(self.dumpsite.name, msg)


class PostgreSQLTruckNearIntegrationTests(TransactionTestCase):
    _SCOPED_USERNAME = 'driver_pg_conc'
    _SCOPED_BARANGAY_NAMES = ('Barangay PG 1', 'Barangay PG 2')
    _SCOPED_DUMPSITE_NAME = 'Central Dumpsite PG'

    def setUp(self):
        super().setUp()
        _reset_prune_throttle_for_testing()
        self._created_shift_ids = []
        self._created_schedule_ids = []
        self._created_dedup_keys = []
        self._worker_threads = []

    def tearDown(self):
        try:
            for t in getattr(self, '_worker_threads', []):
                if t.ident is not None and t.is_alive():
                    t.join(timeout=10)
        finally:
            _reset_prune_throttle_for_testing()
            super().tearDown()

    def _fixture_teardown(self):
        if connection.vendor != 'postgresql':
            super()._fixture_teardown()
            return

        # Trigger-safe scoped teardown: avoid `call_command('flush')` (TRUNCATE),
        # which hits PostgreSQL BEFORE TRUNCATE immutability triggers on attendance
        # and roster tables, and never bulk-delete shared models used by other suites.
        shift_ids = list(
            DriverShift.objects.filter(
                driver__username=self._SCOPED_USERNAME
            ).values_list('id', flat=True)
        )
        for sid in getattr(self, '_created_shift_ids', []):
            if sid not in shift_ids:
                shift_ids.append(sid)

        schedule_ids = list(
            CollectionSchedule.objects.filter(
                driver__username=self._SCOPED_USERNAME
            ).values_list('id', flat=True)
        )
        for scid in getattr(self, '_created_schedule_ids', []):
            if scid not in schedule_ids:
                schedule_ids.append(scid)

        dedup_keys = set(getattr(self, '_created_dedup_keys', []))
        for sid in shift_ids:
            for scid in schedule_ids:
                dedup_keys.add(f'truck_near_{sid}_{scid}_1')

        Notification.objects.filter(
            type=NotificationType.TRUCK_NEAR,
            barangay__name__in=self._SCOPED_BARANGAY_NAMES,
        ).delete()
        if dedup_keys:
            NotificationDeduplication.objects.filter(key__in=dedup_keys).delete()
        if schedule_ids:
            StopValidation.objects.filter(schedule_id__in=schedule_ids).delete()
            PickupStatus.objects.filter(schedule_id__in=schedule_ids).delete()
        PickupStatus.objects.filter(driver__username=self._SCOPED_USERNAME).delete()
        if shift_ids:
            DriverShift.objects.filter(id__in=shift_ids).delete()
        if schedule_ids:
            CollectionSchedule.objects.filter(id__in=schedule_ids).delete()
        Dumpsite.objects.filter(name=self._SCOPED_DUMPSITE_NAME).delete()
        Barangay.objects.filter(name__in=self._SCOPED_BARANGAY_NAMES).delete()
        User.objects.filter(username=self._SCOPED_USERNAME).delete()

    @unittest.skipUnless(connection.vendor == 'postgresql', 'Requires PostgreSQL test database for multi-connection concurrency test')
    def test_concurrent_truck_near_pings_postgresql(self):
        """
        Concurrency: Two concurrent worker threads trying to send truck-near notifications
        for the same (shift, schedule, stop_order): exactly one succeeds on PostgreSQL.
        """
        driver = User.objects.create_user(
            username=self._SCOPED_USERNAME,
            email='driver_pg_conc@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
        )
        b1 = Barangay.objects.create(name='Barangay PG 1')
        b2 = Barangay.objects.create(name='Barangay PG 2')
        dumpsite = Dumpsite.objects.create(
            name=self._SCOPED_DUMPSITE_NAME,
            barangay=b1,
            latitude=13.9300,
            longitude=121.6100,
        )
        schedule = CollectionSchedule.objects.create(
            driver=driver,
            dumpsite=dumpsite,
            start_time=datetime.time(8, 0),
            end_time=datetime.time(17, 0),
            waypoints=[
                {'lat': 13.9300, 'lng': 121.6100, 'label': 'Base Depot'},
                {'lat': 13.9320, 'lng': 121.6120, 'label': 'Stop 1', 'barangay_id': b1.id},
            ],
        )
        self._created_schedule_ids.append(schedule.id)
        schedule.barangays.add(b1, b2)
        shift = DriverShift.objects.create(
            driver=driver,
            schedule=schedule,
            status='shiftroute',
            op_status='on_route',
        )
        self._created_shift_ids.append(shift.id)
        expected_key = f'truck_near_{shift.id}_{schedule.id}_1'
        self._created_dedup_keys.append(expected_key)

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
        self._worker_threads = [t1, t2]

        try:
            t1.start()
            t2.start()
        finally:
            for t in (t1, t2):
                if t.ident is not None:
                    t.join(timeout=10)

        self.assertFalse(t1.is_alive(), "Worker thread 1 timed out and is still alive")
        self.assertFalse(t2.is_alive(), "Worker thread 2 timed out and is still alive")

        if worker_errors:
            self.fail(f"Worker thread encountered unhandled exception: {worker_errors[0]}")

        # Exactly 1 notification created for target barangay (b1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 1)
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR, barangay=b1).count(), 1)

        # Exactly 1 deduplication row created
        self.assertEqual(NotificationDeduplication.objects.filter(key=expected_key).count(), 1)
