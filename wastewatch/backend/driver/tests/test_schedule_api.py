from django.test import TestCase
from rest_framework.test import APIClient
from accounts.models import User, UserRole, EmployeeType
from driver.models import Truck, TruckStatus, CollectionSchedule

class ScheduleAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(email='admin@test.com', password='pw', role=UserRole.ADMIN, full_name='Admin')
        self.driver1 = User.objects.create_user(email='driver1@test.com', password='pw', role=UserRole.DRIVER, full_name='Driver 1')
        self.driver2 = User.objects.create_user(email='driver2@test.com', password='pw', role=UserRole.DRIVER, full_name='Driver 2')
        self.citizen = User.objects.create_user(email='citizen@test.com', password='pw', role=UserRole.CITIZEN, full_name='Citizen')
        
        self.truck_a = Truck.objects.create(plate_number='TRK-A', status=TruckStatus.ACTIVE)
        self.truck_a.drivers.add(self.driver1)
        
        self.truck_maintenance = Truck.objects.create(plate_number='TRK-M', status=TruckStatus.MAINTENANCE)
        self.truck_maintenance.drivers.add(self.driver2)

    def test_valid_create(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post('/api/driver/collection-schedules/', {
            'truck': self.truck_a.id,
            'driver': self.driver1.id,
            'days': 'Mon, Wed',
            'start_time': '06:00:00',
            'end_time': '10:00:00',
            'status': 'PENDING'
        })
        self.assertEqual(res.status_code, 201)

    def test_non_admin_create(self):
        self.client.force_authenticate(user=self.driver1)
        res = self.client.post('/api/driver/collection-schedules/', {
            'truck': self.truck_a.id,
            'driver': self.driver1.id,
            'days': 'Mon, Wed',
            'start_time': '06:00:00',
            'end_time': '10:00:00',
        })
        self.assertEqual(res.status_code, 403)

    def test_truck_maintenance_and_driver_not_on_truck(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post('/api/driver/collection-schedules/', {
            'truck': self.truck_maintenance.id,
            'driver': self.driver2.id,
            'days': 'Mon, Wed',
            'start_time': '06:00:00',
            'end_time': '10:00:00',
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('truck', res.data)
        
        res = self.client.post('/api/driver/collection-schedules/', {
            'truck': self.truck_a.id,
            'driver': self.driver2.id,
            'days': 'Mon, Wed',
            'start_time': '06:00:00',
            'end_time': '10:00:00',
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('driver', res.data)

    def test_end_time_before_start_time(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post('/api/driver/collection-schedules/', {
            'truck': self.truck_a.id,
            'driver': self.driver1.id,
            'days': 'Mon, Wed',
            'start_time': '10:00:00',
            'end_time': '06:00:00',
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('end_time', res.data)

    def test_overlap_and_back_to_back(self):
        self.client.force_authenticate(user=self.admin)
        CollectionSchedule.objects.create(
            truck=self.truck_a, driver=self.driver1,
            days='Mon, Wed', start_time='06:00:00', end_time='10:00:00'
        )
        
        # Overlapping
        res = self.client.post('/api/driver/collection-schedules/', {
            'truck': self.truck_a.id,
            'driver': self.driver1.id,
            'days': 'Mon',
            'start_time': '09:00:00',
            'end_time': '11:00:00',
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('TRK-A', res.data['truck'][0])
        
        # Back-to-back
        res = self.client.post('/api/driver/collection-schedules/', {
            'truck': self.truck_a.id,
            'driver': self.driver1.id,
            'days': 'Mon',
            'start_time': '10:00:00',
            'end_time': '14:00:00',
        })
        self.assertEqual(res.status_code, 201)

    def test_overlap_normalization(self):
        self.client.force_authenticate(user=self.admin)
        CollectionSchedule.objects.create(
            truck=self.truck_a, driver=self.driver1,
            days='Monday, Wednesday', start_time='06:00:00', end_time='10:00:00'
        )
        res = self.client.post('/api/driver/collection-schedules/', {
            'truck': self.truck_a.id,
            'driver': self.driver1.id,
            'days': 'Mon',
            'start_time': '09:00:00',
            'end_time': '11:00:00',
        })
        self.assertEqual(res.status_code, 400)

    def test_legacy_data_patch(self):
        self.client.force_authenticate(user=self.admin)
        # Driver2 not on truck_a
        sched = CollectionSchedule.objects.create(
            truck=self.truck_a, driver=self.driver2,
            days='Mon', start_time='06:00:00', end_time='10:00:00'
        )
        
        # Unrelated edit succeeds
        res = self.client.patch(f'/api/driver/collection-schedules/{sched.id}/', {
            'area': 'Downtown'
        })
        self.assertEqual(res.status_code, 200)
        
        # Changing driver to another bad driver fails
        res = self.client.patch(f'/api/driver/collection-schedules/{sched.id}/', {
            'driver': self.citizen.id
        })
        self.assertEqual(res.status_code, 400)

    def test_patch_own_overlap(self):
        self.client.force_authenticate(user=self.admin)
        sched = CollectionSchedule.objects.create(
            truck=self.truck_a, driver=self.driver1,
            days='Mon, Wed', start_time='06:00:00', end_time='10:00:00'
        )
        res = self.client.patch(f'/api/driver/collection-schedules/{sched.id}/', {
            'start_time': '07:00:00'
        })
        self.assertEqual(res.status_code, 200)

    def test_missing_truck_or_driver_on_create(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post('/api/driver/collection-schedules/', {
            'days': 'Mon, Wed',
            'start_time': '06:00:00',
            'end_time': '10:00:00',
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('truck', res.data)
        self.assertIn('driver', res.data)
