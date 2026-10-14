from rest_framework.test import APITestCase
from django.core.cache import cache
from accounts.models import Barangay, User
from driver.models import CollectionSchedule, Truck, DriverShift
from dumpsite.models import Dumpsite
from django.utils import timezone
from datetime import timedelta

class TrackerApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.b1 = Barangay.objects.create(name='Barangay A')
        self.b2 = Barangay.objects.create(name='Barangay B')
        
        self.citizen = User.objects.create_user('citizen1', email='c@x.com', password='x', role='citizen', barangay=self.b1)
        self.admin = User.objects.create_user('admin1', email='a@x.com', password='x', role='admin')
        self.driver = User.objects.create_user('driver1', email='d@x.com', password='x', role='driver', full_name='John Driver')
        self.site = Dumpsite.objects.create(name='Test Dumpsite', latitude=14.0, longitude=121.0)
        self.site_B = Dumpsite.objects.create(name='Other Site', latitude=14.1, longitude=121.1)
        self.operator_A = User.objects.create_user('opA', email='opa@x.com', password='x', role='dumpsite', dumpsite=self.site)
        
        self.truck = Truck.objects.create(plate_number='TRK-123')
        
        now = timezone.localtime()
        today = timezone.localdate()
        
        # Seed one schedule and shift for self.b1 so loop over trucks runs
        wps = [
            {'lat': 14.0, 'lng': 121.0, 'label': 'Base'},
            {'lat': 14.1, 'lng': 121.1, 'label': 'Stop 1 (b1)', 'barangay_id': self.b1.id},
        ]
        
        self.sched = CollectionSchedule.objects.create(
            truck=self.truck, driver=self.driver, status='PENDING',
            start_time=(now - timedelta(hours=1)).time(),
            end_time=(now + timedelta(hours=2)).time(),
            waypoints=wps, days=today.strftime('%A')
        )
        self.sched.barangays.add(self.b1)
        
        self.shift = DriverShift.objects.create(
            driver=self.driver, schedule=self.sched, truck=self.truck,
            status='shiftroute', is_active=True,
            current_latitude=14.05, current_longitude=121.05
        )
        # Manually backdate started_at since auto_now_add is set
        DriverShift.objects.filter(pk=self.shift.pk).update(started_at=now - timedelta(minutes=30))

    def test_own_ok_and_redacted(self):
        self.client.force_authenticate(self.citizen)
        r = self.client.get(f'/api/analytics/barangay-tracker/?brgy_id={self.b1.id}')
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(len(data.get('trucks', [])), 1)
        truck_data = data['trucks'][0]
        self.assertEqual(truck_data['truck']['plate'], 'Hidden')
        self.assertIsNone(truck_data['driver_name'])

    def test_other_barangay_403(self):
        self.client.force_authenticate(self.citizen)
        r = self.client.get(f'/api/analytics/barangay-tracker/?brgy_id={self.b2.id}')
        self.assertEqual(r.status_code, 403)

    def test_cache_not_mutated(self):
        # Call as admin, then as citizen, citizen must still see 'Hidden'
        self.client.force_authenticate(self.admin)
        r_admin = self.client.get(f'/api/analytics/barangay-tracker/?brgy_id={self.b1.id}')
        self.assertEqual(r_admin.status_code, 200)
        admin_data = r_admin.json()
        # Admin should see the driver and plate
        self.assertEqual(admin_data['trucks'][0]['truck']['plate'], 'TRK-123')
        self.assertEqual(admin_data['trucks'][0]['driver_name'], 'John Driver')
        
        self.client.force_authenticate(self.citizen)
        r_cit = self.client.get(f'/api/analytics/barangay-tracker/?brgy_id={self.b1.id}')
        self.assertEqual(r_cit.status_code, 200)
        cit_data = r_cit.json()
        # Citizen should STILL see Hidden and None despite cache
        self.assertEqual(cit_data['trucks'][0]['truck']['plate'], 'Hidden')
        self.assertIsNone(cit_data['trucks'][0]['driver_name'])

    def test_throttle(self):
        self.client.force_authenticate(self.citizen)
        codes = [self.client.get(f'/api/analytics/barangay-tracker/?brgy_id={self.b1.id}').status_code for _ in range(31)]
        self.assertIn(429, codes)

    def test_days_formats(self):
        today = timezone.localdate()
        for days in (today.strftime('%a'), 'Mon, Wed, Fri, Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday'):
            with self.subTest(days=days):
                CollectionSchedule.objects.filter(pk=self.sched.pk).update(days=days)
                cache.clear()
                self.client.force_authenticate(self.admin)
                r = self.client.get(f'/api/analytics/barangay-tracker/?brgy_id={self.b1.id}')
                self.assertEqual(len(r.json()['trucks']), 1)
                
    def test_days_formats_negative(self):
        today = timezone.localdate()
        CollectionSchedule.objects.filter(pk=self.sched.pk).update(days=(today + timedelta(days=1)).strftime('%a'))
        cache.clear()
        self.client.force_authenticate(self.admin)
        r = self.client.get(f'/api/analytics/barangay-tracker/?brgy_id={self.b1.id}')
        self.assertEqual(r.json().get('trucks', []), [])

    def test_dumpsite_permissions(self):
        # 1. Citizens have no access to these endpoints
        self.client.force_authenticate(self.citizen)
        for method, path in [('get', 'inbound_queue'), ('post', 'reset_capacity'), ('post', 'create-account')]:
            self.assertEqual(getattr(self.client, method)(f'/api/dumpsite/dumpsites/{self.site.id}/{path}/').status_code, 403)

        # 2. Operator A can access their own queue but not site B's queue
        self.client.force_authenticate(self.operator_A)
        self.assertEqual(self.client.get(f'/api/dumpsite/dumpsites/{self.site.id}/inbound_queue/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/dumpsite/dumpsites/{self.site_B.id}/inbound_queue/').status_code, 403)
        
        # 3. Operator A cannot reset capacity or create accounts
        self.assertEqual(self.client.post(f'/api/dumpsite/dumpsites/{self.site.id}/reset_capacity/').status_code, 403)
        self.assertEqual(self.client.post(f'/api/dumpsite/dumpsites/{self.site.id}/create-account/').status_code, 403)
