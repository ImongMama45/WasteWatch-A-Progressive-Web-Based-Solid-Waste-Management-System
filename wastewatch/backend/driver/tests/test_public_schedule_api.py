import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from accounts.models import Barangay, User, UserRole
from driver.models import Truck, TruckStatus, CollectionSchedule


class PublicScheduleAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.brgy1 = Barangay.objects.create(name='Isabang')
        self.brgy2 = Barangay.objects.create(name='Gulang-Gulang')

        self.driver = User.objects.create_user(
            username='driver_sched_test',
            email='driver@test.com',
            password='password123',
            role=UserRole.DRIVER,
            full_name='Juan Dela Cruz',
        )
        self.watcher = User.objects.create_user(
            username='watcher_sched_test',
            email='watcher@test.com',
            password='password123',
            role=UserRole.WATCHER,
            full_name='Maria Clara',
            barangay=self.brgy1,
        )
        self.truck = Truck.objects.create(plate_number='XYZ-9999', status=TruckStatus.ACTIVE)

        # Active schedule in Barangay 1
        self.active_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Isabang Commercial Zone',
            days='Mon, Wed, Fri',
            start_time=datetime.time(8, 0),
            end_time=datetime.time(11, 0),
            status='PENDING',
            waypoints=[
                {'label': 'Central Depot', 'address': 'Maharlika Highway', 'lat': 13.9373, 'lng': 121.617},
                {'label': 'Market Area', 'address': 'Quezon Ave', 'lat': 13.9400, 'lng': 121.620},
            ],
        )
        self.active_sched.barangays.add(self.brgy1)

        # Cancelled schedule in Barangay 1
        self.cancelled_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Isabang Old Route',
            days='Tue, Thu',
            start_time=datetime.time(9, 0),
            end_time=datetime.time(12, 0),
            status='CANCELLED',
        )
        self.cancelled_sched.barangays.add(self.brgy1)

        # Active schedule in Barangay 2
        self.brgy2_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Gulang-Gulang North',
            days='Mon, Thu',
            start_time=datetime.time(13, 0),
            end_time=datetime.time(16, 0),
            status='PENDING',
        )
        self.brgy2_sched.barangays.add(self.brgy2)

    def test_anonymous_get_public_schedule_success(self):
        """Anonymous callers can retrieve the sanitized public collection schedule."""
        res = self.client.get('/api/public/schedule/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 2)

        # Verify presence of approved public fields on schedule item
        item = next(s for s in data if s['id'] == self.active_sched.id)
        self.assertEqual(item['area'], 'Isabang Commercial Zone')
        self.assertEqual(item['days'], 'Mon, Wed, Fri')
        self.assertEqual(item['start_time'], '08:00:00')
        self.assertEqual(item['end_time'], '11:00:00')
        self.assertIn(self.brgy1.id, item['barangays'])
        self.assertEqual(item['total_stops'], 2)
        self.assertEqual(len(item['stops']), 2)
        self.assertEqual(item['stops'][0]['label'], 'Central Depot')
        self.assertEqual(item['stops'][1]['label'], 'Market Area')

        # Backward-compatible fields
        self.assertIn('day', item)
        self.assertIn('zone', item)
        self.assertIn('time', item)
        self.assertIn('status', item)
        self.assertIn('isNext', item)

    def test_sensitive_operational_fields_strictly_absent(self):
        """Operational and personal data must be strictly omitted from public schedule."""
        res = self.client.get('/api/public/schedule/')
        self.assertEqual(res.status_code, 200)
        data = res.json()

        sensitive_keys = {
            'driver', 'driver_name', 'driver_id',
            'truck', 'truck_plate', 'truck_status',
            'dumpsite', 'dumpsite_name', 'dumpsite_detail',
            'waypoints', 'waypoints_display', 'watcher_names',
            'notes',
        }

        for item in data:
            for key in sensitive_keys:
                self.assertNotIn(key, item, f"Sensitive operational key '{key}' must not exist in public schedule")

            # Stops must only contain order and label; NO coordinates
            for stop in item.get('stops', []):
                self.assertNotIn('lat', stop)
                self.assertNotIn('lng', stop)
                self.assertNotIn('latitude', stop)
                self.assertNotIn('longitude', stop)
                self.assertNotIn('watcher_names', stop)

    def test_cancelled_schedules_excluded(self):
        """Cancelled schedules must NEVER be returned to public callers."""
        res = self.client.get('/api/public/schedule/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        ids = [s['id'] for s in data]
        self.assertNotIn(
            self.cancelled_sched.id,
            ids,
            'Cancelled schedule must be excluded from public schedule API'
        )

    def test_barangay_filtering(self):
        """Filtering by barangay_id returns only schedules for that barangay."""
        res = self.client.get(f'/api/public/schedule/?barangay_id={self.brgy1.id}')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        ids = [s['id'] for s in data]
        self.assertIn(self.active_sched.id, ids)
        self.assertNotIn(self.brgy2_sched.id, ids)
