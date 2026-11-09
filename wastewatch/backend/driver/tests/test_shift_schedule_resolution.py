"""
driver/tests/test_shift_schedule_resolution.py
----------------------------------------------
Regression tests for active-shift schedule resolution in TruckLocationViewSet (Step 2.5).
"""

import datetime
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User, UserRole
from driver.models import CollectionSchedule, DriverShift, Truck, TruckLocation
from notifications.models import Notification, NotificationType, NotificationDeduplication
from watcher.models import StopValidation, StopValidationStatus


class ShiftScheduleResolutionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.driver = User.objects.create_user(
            username='driver_sched_res',
            email='driver_sched_res@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
        )
        self.client.force_authenticate(user=self.driver)

        self.truck = Truck.objects.create(
            plate_number='RES-101',
            model='Isuzu Forward',
        )

        self.b_a = Barangay.objects.create(name='Barangay Alpha Resolution')
        self.b_b = Barangay.objects.create(name='Barangay Beta Resolution')

        self.today = timezone.localdate()

        # Schedule A: has date=today (would match old fallback query)
        # Waypoints located around (13.9100, 121.6000)
        self.schedule_a = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            date=self.today,
            start_time=datetime.time(8, 0),
            end_time=datetime.time(12, 0),
            waypoints=[
                {'lat': 13.9100, 'lng': 121.6000, 'label': 'Base Depot A'},
                {'lat': 13.9120, 'lng': 121.6020, 'label': 'Stop 1 - Alpha', 'barangay_id': self.b_a.id},
            ],
        )
        self.schedule_a.barangays.add(self.b_a)

        StopValidation.objects.update_or_create(
            schedule=self.schedule_a,
            stop_order=1,
            collection_date=self.today,
            defaults={
                'current_status': StopValidationStatus.READY_FOR_COLLECTION,
                'barangay': self.b_a,
            },
        )

        # Schedule B: recurring schedule (date=None) assigned to active shift
        # Waypoints located around (13.9500, 121.6500) — > 6km away from Schedule A
        self.schedule_b = CollectionSchedule.objects.create(
            driver=self.driver,
            truck=self.truck,
            date=None,
            start_time=datetime.time(13, 0),
            end_time=datetime.time(17, 0),
            waypoints=[
                {'lat': 13.9500, 'lng': 121.6500, 'label': 'Base Depot B'},
                {'lat': 13.9520, 'lng': 121.6520, 'label': 'Stop 1 - Beta', 'barangay_id': self.b_b.id},
            ],
        )
        self.schedule_b.barangays.add(self.b_b)

        StopValidation.objects.update_or_create(
            schedule=self.schedule_b,
            stop_order=1,
            collection_date=self.today,
            defaults={
                'current_status': StopValidationStatus.READY_FOR_COLLECTION,
                'barangay': self.b_b,
            },
        )

    def test_active_shift_schedule_wins_over_date_matched_schedule(self):
        """
        Test 1: The active shift's assigned schedule (Schedule B) MUST be used
        even when another schedule (Schedule A) matches the date query.
        """
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck,
            schedule=self.schedule_b,
            is_active=True,
        )

        # Ping at Schedule B Stop 1 coordinates: (13.9520, 121.6520)
        # Distance to Schedule B Stop 1 is 0m (qualifies <= 300m).
        # Distance to Schedule A Stop 1 is ~6.9km (> 300m).
        payload = {
            'latitude': 13.9520,
            'longitude': 121.6520,
            'accuracy': 10.0,
        }
        res = self.client.post('/api/driver/truck-locations/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        # Assert that proximity logic used Schedule B:
        expected_dedup_key_b = f'truck_near_{shift.id}_{self.schedule_b.id}_1'
        self.assertTrue(
            NotificationDeduplication.objects.filter(key=expected_dedup_key_b).exists(),
            f"Expected deduplication key for Schedule B ({expected_dedup_key_b}) was not created"
        )

        # Only recipients of Schedule B received notifications
        self.assertEqual(
            Notification.objects.filter(type=NotificationType.TRUCK_NEAR, barangay=self.b_b).count(),
            1,
        )

        # No notifications or claims were generated for Schedule A
        unexpected_dedup_key_a = f'truck_near_{shift.id}_{self.schedule_a.id}_1'
        self.assertFalse(
            NotificationDeduplication.objects.filter(key=unexpected_dedup_key_a).exists()
        )
        self.assertEqual(
            Notification.objects.filter(type=NotificationType.TRUCK_NEAR, barangay=self.b_a).count(),
            0,
        )

    def test_active_shift_with_no_schedule_records_location_and_skips_notifications(self):
        """
        Test 2: An active shift with schedule=None still records GPS location,
        does not substitute another schedule, and skips truck-near checks with a warning.
        """
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck,
            schedule=None,
            is_active=True,
        )

        payload = {
            'latitude': 13.9120,
            'longitude': 121.6020,
            'accuracy': 15.0,
        }

        with self.assertLogs(logger='driver.views', level='WARNING') as captured:
            res = self.client.post('/api/driver/truck-locations/', payload, format='json')

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn('id', res.data)
        self.assertEqual(float(res.data['latitude']), 13.9120)

        # Confirm warning was logged
        self.assertTrue(
            any(f'Active shift pk={shift.pk} has no assigned schedule' in msg for msg in captured.output),
            "Expected warning about shift without schedule was not logged"
        )

        # Location was recorded
        self.assertEqual(TruckLocation.objects.filter(shift=shift).count(), 1)

        # No notifications or deduplication claims were created
        self.assertEqual(Notification.objects.filter(type=NotificationType.TRUCK_NEAR).count(), 0)
        self.assertEqual(NotificationDeduplication.objects.count(), 0)

    def test_no_active_shift_returns_forbidden(self):
        """
        Test 3: Calling truck-locations without an active shift returns 403 Forbidden.
        """
        # No active shift exists for self.driver
        payload = {
            'latitude': 13.9120,
            'longitude': 121.6020,
            'accuracy': 10.0,
        }
        res = self.client.post('/api/driver/truck-locations/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data.get('code'), 'no_active_shift')
        self.assertEqual(TruckLocation.objects.count(), 0)

    def test_notification_service_exception_does_not_break_gps_recording(self):
        """
        Test 4: If notify_truck_near raises an unexpected error, GPS recording
        still succeeds and returns 201 Created.
        """
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck,
            schedule=self.schedule_b,
            is_active=True,
        )

        payload = {
            'latitude': 13.9520,
            'longitude': 121.6520,
            'accuracy': 10.0,
        }

        with patch('notifications.services.notify_truck_near', side_effect=RuntimeError('Unexpected notification crash')):
            res = self.client.post('/api/driver/truck-locations/', payload, format='json')

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(TruckLocation.objects.filter(shift=shift).count(), 1)
