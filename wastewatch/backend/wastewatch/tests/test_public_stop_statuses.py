from datetime import datetime, time, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Barangay, User, UserRole
from driver.models import Truck, TruckStatus, CollectionSchedule
from watcher.models import StopValidation, StopValidationStatus


class PublicStopStatusesAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.manila_tz = ZoneInfo('Asia/Manila')
        self.today = timezone.localdate()
        self.yesterday = self.today - timedelta(days=1)
        self.now = timezone.now()

        # Day abbreviations for recurrence matching
        self.today_day_code = self.today.strftime('%a')
        self.yesterday_day_code = self.yesterday.strftime('%a')

        self.brgy1 = Barangay.objects.create(name='Isabang')
        self.brgy2 = Barangay.objects.create(name='Gulang-Gulang')

        self.driver = User.objects.create_user(
            username='driver_status_test',
            email='driver_status@test.com',
            password='password123',
            role=UserRole.DRIVER,
            full_name='Juan Dela Cruz',
        )
        self.watcher = User.objects.create_user(
            username='watcher_status_test',
            email='watcher_status@test.com',
            password='password123',
            role=UserRole.WATCHER,
            full_name='Maria Santos',
        )
        self.truck = Truck.objects.create(plate_number='STA-1111', status=TruckStatus.ACTIVE)

        # 1. Active schedule for Barangay 1, runs every day (all 7 days)
        self.sched_brgy1 = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Isabang Commercial Zone',
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(8, 0),
            end_time=time(11, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Central Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'Stop 1 Market', 'lat': 13.9400, 'lng': 121.6200, 'barangay_id': self.brgy1.id},
                {'label': 'Stop 2 Plaza', 'lat': 13.9450, 'lng': 121.6250, 'barangay_id': self.brgy1.id},
            ],
        )
        self.sched_brgy1.barangays.add(self.brgy1)

        # 2. Active schedule for Barangay 2, runs every day
        self.sched_brgy2 = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Gulang-Gulang Sector',
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(13, 0),
            end_time=time(16, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Depot North', 'lat': 13.9300, 'lng': 121.6100},
                {'label': 'Gulang Stop 1', 'lat': 13.9500, 'lng': 121.6300, 'barangay_id': self.brgy2.id},
            ],
        )
        self.sched_brgy2.barangays.add(self.brgy2)

        # 3. Recognized Citywide schedule
        self.sched_citywide = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Citywide',
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(9, 0),
            end_time=time(12, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Central Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'City Hall Stop', 'lat': 13.9320, 'lng': 121.6140},
            ],
        )

        # 4. Cancelled schedule (must be excluded)
        self.sched_cancelled = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Cancelled Route',
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(8, 0),
            end_time=time(10, 0),
            status='CANCELLED',
            waypoints=[
                {'label': 'Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'Cancelled Stop', 'lat': 13.9400, 'lng': 121.6200},
            ],
        )

        # Clear automatically synced StopValidation records so each test controls its dataset
        StopValidation.objects.all().delete()

    # 1. Anonymous GET succeeds
    def test_anonymous_get_succeeds(self):
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.PENDING_INSPECTION,
        )
        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.status_code, 200)
        self.assertIsInstance(res.json(), list)
        self.assertEqual(len(res.json()), 1)

    # 2. Unsupported methods return 405
    def test_unsupported_methods_return_405(self):
        for method in ['post', 'put', 'patch', 'delete']:
            caller = getattr(self.client, method)
            res = caller('/api/public/map/stop-statuses/', {})
            self.assertEqual(res.status_code, 405, f"Method {method.upper()} should return 405")

    # 3. Today's record takes precedence over yesterday's record
    def test_today_preempts_yesterday(self):
        # Yesterday verified completed 10 hours ago
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.yesterday,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
            post_validation_watcher=self.watcher,
            post_validation_timestamp=self.now - timedelta(hours=10),
            collection_timestamp=self.now - timedelta(hours=11),
        )
        # Today pending inspection
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.PENDING_INSPECTION,
        )

        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 1)
        item = data[0]
        self.assertEqual(item['schedule_id'], self.sched_brgy1.id)
        self.assertEqual(item['stop_order'], 1)
        self.assertEqual(item['status'], 'PENDING_INSPECTION')
        self.assertTrue(item['is_today'])
        self.assertEqual(item['collection_date'], self.today.isoformat())
        self.assertIsNone(item['collected_at'])

    # 4. Yesterday's terminal record within 24 hours carries over when no today's record exists
    def test_yesterday_terminal_within_24h_carries_over(self):
        col_time = self.now - timedelta(hours=15)
        post_time = self.now - timedelta(hours=14)
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.yesterday,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
            post_validation_watcher=self.watcher,
            post_validation_timestamp=post_time,
            collection_timestamp=col_time,
        )

        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 1)
        item = data[0]
        self.assertEqual(item['schedule_id'], self.sched_brgy1.id)
        self.assertEqual(item['stop_order'], 1)
        self.assertEqual(item['status'], 'VERIFIED_COLLECTED')
        self.assertFalse(item['is_today'])
        self.assertEqual(item['collection_date'], self.yesterday.isoformat())
        expected_time = timezone.localtime(col_time, self.manila_tz).strftime('%H:%M')
        self.assertEqual(item['collected_at'], expected_time)

    # 5. Yesterday's terminal record older than 24 hours is excluded
    def test_yesterday_terminal_older_than_24h_excluded(self):
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.yesterday,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
            post_validation_watcher=self.watcher,
            post_validation_timestamp=self.now - timedelta(hours=26),
            collection_timestamp=self.now - timedelta(hours=27),
        )

        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [])

    # 6. Yesterday's nonterminal record is excluded
    def test_yesterday_nonterminal_excluded(self):
        for nonterm_status in [
            StopValidationStatus.PENDING_INSPECTION,
            StopValidationStatus.READY_FOR_COLLECTION,
            StopValidationStatus.COLLECTION_REPORTED,
        ]:
            StopValidation.objects.all().delete()
            StopValidation.objects.create(
                schedule=self.sched_brgy1,
                stop_order=1,
                collection_date=self.yesterday,
                current_status=nonterm_status,
                collection_timestamp=self.now - timedelta(hours=10),
            )
            res = self.client.get('/api/public/map/stop-statuses/')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json(), [], f"Non-terminal {nonterm_status} from yesterday must be excluded")

    # 7. EMPTY_STOP uses pre_validation_timestamp
    def test_empty_stop_uses_pre_validation_timestamp(self):
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.EMPTY_STOP,
            pre_validation_watcher=self.watcher,
            pre_validation_timestamp=self.now - timedelta(hours=2),
        )
        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['status'], 'EMPTY_STOP')
        self.assertIsNone(data[0]['collected_at'])

        # If pre_validation_timestamp is older than 24h, excluded
        StopValidation.objects.all().delete()
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.EMPTY_STOP,
            pre_validation_watcher=self.watcher,
            pre_validation_timestamp=self.now - timedelta(hours=25),
        )
        res2 = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res2.json(), [])

    # 8. Missing terminal authoritative timestamp fails closed
    def test_missing_terminal_timestamp_fails_closed(self):
        # EMPTY_STOP with null pre_validation_timestamp
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.EMPTY_STOP,
            pre_validation_timestamp=None,
        )
        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.json(), [])

        # VERIFIED_COLLECTED with null post_validation_timestamp
        StopValidation.objects.all().delete()
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
            post_validation_timestamp=None,
        )
        res2 = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res2.json(), [])

    # 9. VERIFIED_COLLECTED cannot substitute collection_timestamp for missing post_validation_timestamp
    def test_no_collection_timestamp_substitution(self):
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
            post_validation_timestamp=None,
            collection_timestamp=self.now - timedelta(hours=1),
        )
        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [], "Must fail closed: collection_timestamp must not rescue missing post_validation_timestamp")

    # 10. Disputed stop has null collected_at
    def test_disputed_stop_collected_at_is_null(self):
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.COLLECTION_DISPUTED,
            post_validation_watcher=self.watcher,
            post_validation_timestamp=self.now - timedelta(hours=1),
            collection_timestamp=self.now - timedelta(hours=2),
            dispute_reason='Driver skipped bin',
        )
        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['status'], 'COLLECTION_DISPUTED')
        self.assertIsNone(data[0]['collected_at'], "Disputed stop must have null collected_at")

    # 11. Recurrence weekday filtering uses existing normalize_days implementation
    def test_recurrence_weekday_filtering(self):
        # Schedule that runs on specific non-matching days
        other_days = 'Sat, Sun' if self.today_day_code in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] else 'Tue, Wed'
        limited_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Limited Days Route',
            days=other_days,
            start_time=time(8, 0),
            end_time=time(11, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'Stop 1', 'lat': 13.9400, 'lng': 121.6200, 'barangay_id': self.brgy1.id},
            ],
        )
        limited_sched.barangays.add(self.brgy1)
        StopValidation.objects.filter(schedule=limited_sched).delete()

        StopValidation.objects.create(
            schedule=limited_sched,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.PENDING_INSPECTION,
        )

        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.status_code, 200)
        # Should be excluded because today's weekday is not in other_days
        sched_ids = [item['schedule_id'] for item in res.json()]
        self.assertNotIn(limited_sched.id, sched_ids)

    # 12. Invalid stop order and invalid waypoint coordinates are excluded
    def test_invalid_stop_order_and_waypoint_coords_excluded(self):
        # 1. Stop order out of range (order 99 when waypoints has 3 items)
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=99,
            collection_date=self.today,
            current_status=StopValidationStatus.PENDING_INSPECTION,
        )
        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.json(), [])

        # 2. Schedule with invalid coordinates
        bad_coord_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Bad Coord Route',
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(8, 0),
            end_time=time(11, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'Stop Invalid Lat', 'lat': 999.0, 'lng': 121.6200, 'barangay_id': self.brgy1.id},
            ],
        )
        bad_coord_sched.barangays.add(self.brgy1)
        StopValidation.objects.filter(schedule=bad_coord_sched).delete()

        StopValidation.objects.create(
            schedule=bad_coord_sched,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.PENDING_INSPECTION,
        )
        res2 = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res2.json(), [])

    # 13. Barangay filtering includes matching barangay and citywide routes only
    def test_barangay_filtering_includes_matching_and_citywide(self):
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.PENDING_INSPECTION,
        )
        StopValidation.objects.create(
            schedule=self.sched_brgy2,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.PENDING_INSPECTION,
        )
        StopValidation.objects.create(
            schedule=self.sched_citywide,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.PENDING_INSPECTION,
        )

        res = self.client.get(f'/api/public/map/stop-statuses/?barangay_id={self.brgy1.id}')
        self.assertEqual(res.status_code, 200)
        sched_ids = [item['schedule_id'] for item in res.json()]
        self.assertIn(self.sched_brgy1.id, sched_ids)
        self.assertIn(self.sched_citywide.id, sched_ids)
        self.assertNotIn(self.sched_brgy2.id, sched_ids)

    # 14. Invalid barangay IDs return 400
    def test_invalid_barangay_ids_return_400(self):
        for bad_id in ['abc', '-1', '0', '1.5', '']:
            res = self.client.get(f'/api/public/map/stop-statuses/?barangay_id={bad_id}')
            self.assertEqual(res.status_code, 400, f"barangay_id={bad_id} must return 400")
            self.assertIn('Invalid barangay_id', res.json().get('detail', ''))

    # 15. Explicit date requests enforce exact-date behavior and range validation
    def test_explicit_date_requests(self):
        col_time = self.now - timedelta(hours=10)
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.yesterday,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
            post_validation_watcher=self.watcher,
            post_validation_timestamp=col_time,
            collection_timestamp=col_time,
        )
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=2,
            collection_date=self.today,
            current_status=StopValidationStatus.PENDING_INSPECTION,
        )

        # Explicit date = today -> returns Stop 2 only, no yesterday carryover
        res_today = self.client.get(f'/api/public/map/stop-statuses/?date={self.today.isoformat()}')
        self.assertEqual(res_today.status_code, 200)
        today_data = res_today.json()
        self.assertEqual(len(today_data), 1)
        self.assertEqual(today_data[0]['stop_order'], 2)
        self.assertTrue(today_data[0]['is_today'])

        # Explicit date = yesterday -> returns Stop 1 only
        res_yest = self.client.get(f'/api/public/map/stop-statuses/?date={self.yesterday.isoformat()}')
        self.assertEqual(res_yest.status_code, 200)
        yest_data = res_yest.json()
        self.assertEqual(len(yest_data), 1)
        self.assertEqual(yest_data[0]['stop_order'], 1)
        self.assertFalse(yest_data[0]['is_today'])

        # Date older than yesterday -> 400
        old_date = (self.today - timedelta(days=2)).isoformat()
        res_old = self.client.get(f'/api/public/map/stop-statuses/?date={old_date}')
        self.assertEqual(res_old.status_code, 400)
        self.assertIn('Date query out of range', res_old.json().get('detail', ''))

        # Future date -> 400
        future_date = (self.today + timedelta(days=1)).isoformat()
        res_fut = self.client.get(f'/api/public/map/stop-statuses/?date={future_date}')
        self.assertEqual(res_fut.status_code, 400)
        self.assertIn('Date cannot be in the future', res_fut.json().get('detail', ''))

        # Malformed date -> 400
        res_mal = self.client.get('/api/public/map/stop-statuses/?date=not-a-date')
        self.assertEqual(res_mal.status_code, 400)
        self.assertIn('Invalid date format', res_mal.json().get('detail', ''))

    # 16. Strict response sanitization verifies the exact seven-field allowlist
    def test_strict_response_sanitization(self):
        col_time = self.now - timedelta(hours=2)
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
            post_validation_watcher=self.watcher,
            post_validation_timestamp=col_time,
            collection_timestamp=col_time,
            collection_notes='Confidential operational notes',
            dispute_reason='Internal reason',
        )

        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 1)
        item = data[0]

        allowed_keys = {
            'schedule_id',
            'stop_order',
            'status',
            'collected_at',
            'collection_date',
            'is_today',
            'occurrence_key',
        }
        self.assertEqual(set(item.keys()), allowed_keys)
        self.assertEqual(item['occurrence_key'], f"{self.sched_brgy1.id}:1:{self.today.isoformat()}")

        # Prohibited fields must never leak
        prohibited_keys = [
            'driver', 'driver_name', 'truck', 'truck_plate', 'watcher',
            'pre_validation_watcher', 'post_validation_watcher',
            'pre_validation_photo', 'collection_photo', 'post_validation_photo',
            'pre_validation_latitude', 'pre_validation_longitude',
            'collection_latitude', 'collection_longitude',
            'post_validation_latitude', 'post_validation_longitude',
            'collection_notes', 'pre_validation_remarks', 'dispute_reason',
        ]
        for p in prohibited_keys:
            self.assertNotIn(p, item)

    # 17. Precedence: Invalid today record does not leak yesterday record
    def test_precedence_invalid_today_record_does_not_leak_yesterday(self):
        # Yesterday has valid terminal record within 24h
        col_time = self.now - timedelta(hours=10)
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.yesterday,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
            post_validation_watcher=self.watcher,
            post_validation_timestamp=col_time,
            collection_timestamp=col_time,
        )
        # Today has a record with missing post_validation_timestamp (fails closed)
        StopValidation.objects.create(
            schedule=self.sched_brgy1,
            stop_order=1,
            collection_date=self.today,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
            post_validation_timestamp=None,
        )

        res = self.client.get('/api/public/map/stop-statuses/')
        self.assertEqual(res.status_code, 200)
        # Because today had a record (even though invalid/failed closed), yesterday MUST NOT carry over
        self.assertEqual(res.json(), [])

    # 18. Shared eligibility refactor preserves /api/public/map/pins/ behavior
    def test_public_map_pins_compatibility_regression(self):
        res = self.client.get('/api/public/map/pins/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        ids = [s['id'] for s in data]
        self.assertIn(self.sched_brgy1.id, ids)
        self.assertIn(self.sched_brgy2.id, ids)
        self.assertIn(self.sched_citywide.id, ids)
        self.assertNotIn(self.sched_cancelled.id, ids)

        # Filter by barangay
        res_b1 = self.client.get(f'/api/public/map/pins/?barangay_id={self.brgy1.id}')
        self.assertEqual(res_b1.status_code, 200)
        ids_b1 = [s['id'] for s in res_b1.json()]
        self.assertIn(self.sched_brgy1.id, ids_b1)
        self.assertIn(self.sched_citywide.id, ids_b1)
        self.assertNotIn(self.sched_brgy2.id, ids_b1)

    # 19. Terminal timestamp boundary interval: [now - 24h, now]
    def test_terminal_timestamp_boundary_interval(self):
        frozen_now = datetime(self.today.year, self.today.month, self.today.day, 12, 0, 0, tzinfo=self.manila_tz)

        with patch('django.utils.timezone.now', return_value=frozen_now):
            # A. Timestamp exactly at the 24-hour cutoff (now - 24h) -> accepted
            StopValidation.objects.all().delete()
            StopValidation.objects.create(
                schedule=self.sched_brgy1,
                stop_order=1,
                collection_date=self.yesterday,
                current_status=StopValidationStatus.VERIFIED_COLLECTED,
                post_validation_watcher=self.watcher,
                post_validation_timestamp=frozen_now - timedelta(hours=24),
            )
            res = self.client.get('/api/public/map/stop-statuses/')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(len(res.json()), 1, "Timestamp exactly at 24h cutoff must be accepted")

            # B. Timestamp slightly older than 24-hour cutoff (now - 24h - 1s) -> rejected
            StopValidation.objects.all().delete()
            StopValidation.objects.create(
                schedule=self.sched_brgy1,
                stop_order=1,
                collection_date=self.yesterday,
                current_status=StopValidationStatus.VERIFIED_COLLECTED,
                post_validation_watcher=self.watcher,
                post_validation_timestamp=frozen_now - timedelta(hours=24, seconds=1),
            )
            res = self.client.get('/api/public/map/stop-statuses/')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json(), [], "Timestamp older than 24h cutoff must be rejected")

            # C. Timestamp exactly equal to captured now -> accepted
            StopValidation.objects.all().delete()
            StopValidation.objects.create(
                schedule=self.sched_brgy1,
                stop_order=1,
                collection_date=self.today,
                current_status=StopValidationStatus.VERIFIED_COLLECTED,
                post_validation_watcher=self.watcher,
                post_validation_timestamp=frozen_now,
            )
            res = self.client.get('/api/public/map/stop-statuses/')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(len(res.json()), 1, "Timestamp exactly equal to now must be accepted")

            # D. Timestamp slightly in the future (now + 1s) -> rejected
            StopValidation.objects.all().delete()
            StopValidation.objects.create(
                schedule=self.sched_brgy1,
                stop_order=1,
                collection_date=self.today,
                current_status=StopValidationStatus.VERIFIED_COLLECTED,
                post_validation_watcher=self.watcher,
                post_validation_timestamp=frozen_now + timedelta(seconds=1),
            )
            res = self.client.get('/api/public/map/stop-statuses/')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json(), [], "Timestamp in the future must be rejected")

    # 20. Future timestamps rejected for all three terminal statuses
    def test_future_timestamps_rejected_for_all_terminal_statuses(self):
        frozen_now = datetime(self.today.year, self.today.month, self.today.day, 12, 0, 0, tzinfo=self.manila_tz)
        future_ts = frozen_now + timedelta(minutes=5)

        with patch('django.utils.timezone.now', return_value=frozen_now):
            # 1. EMPTY_STOP with future pre_validation_timestamp
            StopValidation.objects.all().delete()
            StopValidation.objects.create(
                schedule=self.sched_brgy1,
                stop_order=1,
                collection_date=self.today,
                current_status=StopValidationStatus.EMPTY_STOP,
                pre_validation_watcher=self.watcher,
                pre_validation_timestamp=future_ts,
            )
            res1 = self.client.get('/api/public/map/stop-statuses/')
            self.assertEqual(res1.status_code, 200)
            self.assertEqual(res1.json(), [], "EMPTY_STOP with future pre_validation_timestamp must be rejected")

            # 2. VERIFIED_COLLECTED with future post_validation_timestamp
            StopValidation.objects.all().delete()
            StopValidation.objects.create(
                schedule=self.sched_brgy1,
                stop_order=1,
                collection_date=self.today,
                current_status=StopValidationStatus.VERIFIED_COLLECTED,
                post_validation_watcher=self.watcher,
                post_validation_timestamp=future_ts,
            )
            res2 = self.client.get('/api/public/map/stop-statuses/')
            self.assertEqual(res2.status_code, 200)
            self.assertEqual(res2.json(), [], "VERIFIED_COLLECTED with future post_validation_timestamp must be rejected")

            # 3. COLLECTION_DISPUTED with future post_validation_timestamp
            StopValidation.objects.all().delete()
            StopValidation.objects.create(
                schedule=self.sched_brgy1,
                stop_order=1,
                collection_date=self.today,
                current_status=StopValidationStatus.COLLECTION_DISPUTED,
                post_validation_watcher=self.watcher,
                post_validation_timestamp=future_ts,
            )
            res3 = self.client.get('/api/public/map/stop-statuses/')
            self.assertEqual(res3.status_code, 200)
            self.assertEqual(res3.json(), [], "COLLECTION_DISPUTED with future post_validation_timestamp must be rejected")

