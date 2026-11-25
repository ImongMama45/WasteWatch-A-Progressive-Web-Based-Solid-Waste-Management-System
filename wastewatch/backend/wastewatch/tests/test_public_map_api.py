import datetime
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.db import connection
from rest_framework.test import APIClient
from accounts.models import Barangay, User, UserRole
from driver.models import Truck, TruckStatus, CollectionSchedule


class PublicMapPinsAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.brgy1 = Barangay.objects.create(name='Isabang')
        self.brgy2 = Barangay.objects.create(name='Gulang-Gulang')

        self.driver = User.objects.create_user(
            username='driver_map_test',
            email='driver_map@test.com',
            password='password123',
            role=UserRole.DRIVER,
            full_name='Juan Dela Cruz',
        )
        self.truck = Truck.objects.create(plate_number='MAP-1111', status=TruckStatus.ACTIVE)

        # 1. Normal assigned schedule in Barangay 1 (with depot at idx 0, stops at idx 1 & 2)
        self.assigned_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Isabang Commercial Zone',
            days='Mon, Wed, Fri',
            start_time=datetime.time(8, 0),
            end_time=datetime.time(11, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Central Depot', 'address': 'Depot St', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'Stop 1 Market', 'address': 'Market St', 'lat': 13.9400, 'lng': 121.6200, 'barangay_id': self.brgy1.id},
                {'label': 'Stop 2 Plaza', 'address': 'Plaza Ave', 'lat': 13.9450, 'lng': 121.6250, 'barangay_id': self.brgy1.id},
            ],
        )
        self.assigned_sched.barangays.add(self.brgy1)

        # 2. Schedule in Barangay 2
        self.brgy2_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Gulang-Gulang Sector',
            days='Tue, Thu',
            start_time=datetime.time(13, 0),
            end_time=datetime.time(16, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Depot North', 'lat': 13.9300, 'lng': 121.6100},
                {'label': 'Gulang Stop 1', 'lat': 13.9500, 'lng': 121.6300, 'barangay_id': self.brgy2.id},
            ],
        )
        self.brgy2_sched.barangays.add(self.brgy2)

        # 3. Recognized Citywide schedule (no barangays, area='Citywide')
        self.citywide_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Citywide',
            days='Sat',
            start_time=datetime.time(9, 0),
            end_time=datetime.time(12, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Central Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'City Hall Stop', 'lat': 13.9320, 'lng': 121.6140},
            ],
        )

        # 4. Recognized City-wide schedule alternate spelling (no barangays, area='city-wide')
        self.citywide_alt_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='city-wide',
            days='Sun',
            start_time=datetime.time(10, 0),
            end_time=datetime.time(12, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Central Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'Main Boulevard Stop', 'lat': 13.9350, 'lng': 121.6180},
            ],
        )

        # 5. Meaningful area without barangay (area='North Sector', NOT citywide)
        self.meaningful_unassigned_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='North Sector',
            days='Wed',
            start_time=datetime.time(7, 0),
            end_time=datetime.time(10, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'North Route Stop', 'lat': 13.9600, 'lng': 121.6400},
            ],
        )

        # 6. Blank unassigned schedule (no barangays, blank area)
        self.blank_unassigned_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='',
            days='Fri',
            start_time=datetime.time(14, 0),
            end_time=datetime.time(17, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'Unassigned Stop', 'lat': 13.9700, 'lng': 121.6500},
            ],
        )

        # 7. Cancelled schedule (even if assigned to Barangay 1)
        self.cancelled_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Isabang Cancelled Route',
            days='Mon',
            start_time=datetime.time(6, 0),
            end_time=datetime.time(9, 0),
            status='CANCELLED',
            waypoints=[
                {'label': 'Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'Cancelled Stop', 'lat': 13.9420, 'lng': 121.6220},
            ],
        )
        self.cancelled_sched.barangays.add(self.brgy1)

    def test_anonymous_get_public_map_pins_success(self):
        """Anonymous callers can retrieve sanitized map pins without authentication."""
        res = self.client.get('/api/public/map/pins/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)

    def test_correct_public_response_shape(self):
        """Response objects contain all required sanitized public routing fields."""
        res = self.client.get('/api/public/map/pins/')
        self.assertEqual(res.status_code, 200)
        data = res.json()

        item = next((s for s in data if s['id'] == self.assigned_sched.id), None)
        self.assertIsNotNone(item)

        expected_keys = {
            'id', 'area', 'days', 'time_window', 'color',
            'barangays', 'barangay_names', 'total_stops', 'stops'
        }
        self.assertEqual(set(item.keys()), expected_keys)

        self.assertEqual(item['id'], self.assigned_sched.id)
        self.assertEqual(item['area'], 'Isabang Commercial Zone')
        self.assertEqual(item['days'], 'Mon, Wed, Fri')
        self.assertEqual(item['time_window'], '08:00 AM – 11:00 AM')
        self.assertEqual(item['color'], '#16a34a')
        self.assertEqual(item['barangays'], [self.brgy1.id])
        self.assertEqual(item['barangay_names'], 'Isabang')
        self.assertEqual(item['total_stops'], 2)
        self.assertEqual(len(item['stops']), 2)

    def test_security_operational_exclusions(self):
        """Operational and sensitive fields must strictly NOT exist in response."""
        res = self.client.get('/api/public/map/pins/')
        self.assertEqual(res.status_code, 200)
        data = res.json()

        forbidden_keys = {
            'driver', 'driver_id', 'driver_name', 'driver_phone',
            'truck', 'truck_id', 'truck_plate', 'plate_number', 'truck_status',
            'dumpsite', 'dumpsite_id', 'dumpsite_name', 'dumpsite_detail',
            'watcher', 'watcher_id', 'watcher_name', 'watcher_names',
            'notes', 'waypoints', 'waypoints_display', 'depot',
            'shift', 'shift_id', 'route_progress', 'audit'
        }

        for item in data:
            for key in forbidden_keys:
                self.assertNotIn(key, item, f"Forbidden operational key '{key}' found in schedule item")

            for stop in item.get('stops', []):
                for key in forbidden_keys:
                    self.assertNotIn(key, stop, f"Forbidden operational key '{key}' found in stop")
                # Depot at index 0 must NOT be present in stops
                self.assertNotEqual(stop.get('label'), 'Central Depot')
                self.assertNotEqual(stop.get('label'), 'Depot North')

    def test_correct_stop_coordinates_labels_and_ordering(self):
        """Stops must correctly exclude index 0 depot, and have sequential 1-based order with coordinates."""
        res = self.client.get('/api/public/map/pins/')
        self.assertEqual(res.status_code, 200)
        data = res.json()

        item = next(s for s in data if s['id'] == self.assigned_sched.id)
        stops = item['stops']
        self.assertEqual(len(stops), 2)

        stop1 = stops[0]
        self.assertEqual(stop1['order'], 1)
        self.assertEqual(stop1['label'], 'Stop 1 Market')
        self.assertAlmostEqual(stop1['lat'], 13.9400, places=4)
        self.assertAlmostEqual(stop1['lng'], 121.6200, places=4)
        self.assertEqual(stop1['barangay_id'], self.brgy1.id)

        stop2 = stops[1]
        self.assertEqual(stop2['order'], 2)
        self.assertEqual(stop2['label'], 'Stop 2 Plaza')
        self.assertAlmostEqual(stop2['lat'], 13.9450, places=4)
        self.assertAlmostEqual(stop2['lng'], 121.6250, places=4)
        self.assertEqual(stop2['barangay_id'], self.brgy1.id)

    def test_missing_or_malformed_coordinates_handled_safely(self):
        """Stops with missing, non-numeric, or out-of-range coordinates must be safely omitted."""
        malformed_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Isabang Malformed Route',
            days='Tue',
            start_time=datetime.time(8, 0),
            end_time=datetime.time(10, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Depot', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'Valid Stop', 'lat': 13.9410, 'lng': 121.6210},
                {'label': 'Missing Lng', 'lat': 13.9420},
                {'label': 'Non-numeric Lat', 'lat': 'invalid_lat', 'lng': 121.6230},
                {'label': 'Latitude Out Of Range', 'lat': 95.0, 'lng': 121.6240},
                {'label': 'Longitude Out Of Range', 'lat': 13.9440, 'lng': 200.0},
                {'label': 'Negative Out Of Range', 'lat': -95.0, 'lng': -200.0},
                'string_waypoint_not_dict',
                None,
                {'label': 'Second Valid Stop', 'lat': '13.9450', 'lng': '121.6250'},
            ],
        )
        malformed_sched.barangays.add(self.brgy1)

        res = self.client.get(f'/api/public/map/pins/?barangay_id={self.brgy1.id}')
        self.assertEqual(res.status_code, 200)
        data = res.json()

        item = next(s for s in data if s['id'] == malformed_sched.id)
        # Only the two valid stops should be retained
        self.assertEqual(item['total_stops'], 2)
        self.assertEqual(len(item['stops']), 2)
        self.assertEqual(item['stops'][0]['label'], 'Valid Stop')
        self.assertEqual(item['stops'][0]['order'], 1)
        self.assertEqual(item['stops'][1]['label'], 'Second Valid Stop')
        self.assertEqual(item['stops'][1]['order'], 9)

    def test_explicit_barangay_filtering(self):
        """Filtering by barangay_id returns target barangay schedules and recognized citywide schedules."""
        res = self.client.get(f'/api/public/map/pins/?barangay_id={self.brgy1.id}')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        ids = [s['id'] for s in data]

        self.assertIn(self.assigned_sched.id, ids)
        self.assertIn(self.citywide_sched.id, ids)
        self.assertIn(self.citywide_alt_sched.id, ids)
        self.assertNotIn(self.brgy2_sched.id, ids)
        self.assertNotIn(self.meaningful_unassigned_sched.id, ids)
        self.assertNotIn(self.blank_unassigned_sched.id, ids)
        self.assertNotIn(self.cancelled_sched.id, ids)

    def test_recognized_citywide_schedule_inclusion(self):
        """Recognized citywide schedules (case-insensitive) are included in unfiltered and filtered queries."""
        # Unfiltered discovery
        res = self.client.get('/api/public/map/pins/')
        self.assertEqual(res.status_code, 200)
        ids = [s['id'] for s in res.json()]
        self.assertIn(self.citywide_sched.id, ids)
        self.assertIn(self.citywide_alt_sched.id, ids)

        # Filtered by Barangay 2
        res2 = self.client.get(f'/api/public/map/pins/?barangay_id={self.brgy2.id}')
        self.assertEqual(res2.status_code, 200)
        ids2 = [s['id'] for s in res2.json()]
        self.assertIn(self.citywide_sched.id, ids2)
        self.assertIn(self.citywide_alt_sched.id, ids2)

    def test_unassigned_schedule_exclusion(self):
        """Schedules with no barangay and blank/null area are excluded from public discovery."""
        res = self.client.get('/api/public/map/pins/')
        self.assertEqual(res.status_code, 200)
        ids = [s['id'] for s in res.json()]
        self.assertNotIn(self.blank_unassigned_sched.id, ids)

    def test_empty_barangay_relationship_not_automatically_citywide(self):
        """Meaningful non-citywide area without a barangay is NOT treated as citywide and is excluded."""
        res = self.client.get('/api/public/map/pins/')
        self.assertEqual(res.status_code, 200)
        ids = [s['id'] for s in res.json()]
        self.assertNotIn(self.meaningful_unassigned_sched.id, ids)

        # Also excluded when filtering by barangay
        res_filtered = self.client.get(f'/api/public/map/pins/?barangay_id={self.brgy1.id}')
        self.assertEqual(res_filtered.status_code, 200)
        ids_filtered = [s['id'] for s in res_filtered.json()]
        self.assertNotIn(self.meaningful_unassigned_sched.id, ids_filtered)

    def test_cancelled_schedule_exclusion(self):
        """Cancelled schedules must never be returned on the public map pins endpoint."""
        res = self.client.get('/api/public/map/pins/')
        self.assertEqual(res.status_code, 200)
        ids = [s['id'] for s in res.json()]
        self.assertNotIn(self.cancelled_sched.id, ids)

    def test_invalid_barangay_parameter_returns_400(self):
        """Invalid barangay_id values (non-numeric, zero, negative) must return HTTP 400 Bad Request."""
        invalid_cases = ['abc', '-5', '0', 'not-a-number', '1.5']
        for invalid_val in invalid_cases:
            res = self.client.get(f'/api/public/map/pins/?barangay_id={invalid_val}')
            self.assertEqual(
                res.status_code, 400,
                f"Expected HTTP 400 for invalid barangay_id '{invalid_val}', got {res.status_code}"
            )
            data = res.json()
            self.assertIn('detail', data)
            self.assertEqual(data['detail'], 'Invalid barangay_id. Must be a positive integer.')

    def test_unsupported_http_methods(self):
        """Only GET is permitted; POST, PUT, DELETE, and PATCH must return HTTP 405 Method Not Allowed."""
        url = '/api/public/map/pins/'
        res_post = self.client.post(url, {'area': 'Hacked Route'})
        self.assertEqual(res_post.status_code, 405)

        res_put = self.client.put(url, {'area': 'Hacked Route'})
        self.assertEqual(res_put.status_code, 405)

        res_delete = self.client.delete(url)
        self.assertEqual(res_delete.status_code, 405)

        res_patch = self.client.patch(url, {'area': 'Hacked Route'})
        self.assertEqual(res_patch.status_code, 405)

    def test_query_count_behavior_avoids_n_plus_one(self):
        """Fetching map pins must execute a bounded, constant number of queries avoiding N+1."""
        # Warm up if any
        self.client.get('/api/public/map/pins/')

        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get('/api/public/map/pins/')
            self.assertEqual(res.status_code, 200)

        # Expected queries:
        # 1. CollectionSchedule query with filtering and order_by/limit
        # 2. Barangay prefetch query
        # Total queries should be <= 3 regardless of schedule count
        query_count = len(ctx.captured_queries)
        self.assertLessEqual(
            query_count, 3,
            f"Expected <= 3 queries (prefetched barangays, no N+1), but executed {query_count} queries"
        )
