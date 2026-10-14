from django.test import TestCase
from rest_framework.test import APIClient
from accounts.models import User, UserRole, EmployeeType
from driver.models import Truck, TruckStatus, CollectionSchedule
from django.utils import timezone

class CrewAssignmentAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(email='admin@test.com', password='pw', role=UserRole.ADMIN)
        self.driver1 = User.objects.create_user(email='driver1@test.com', password='pw', role=UserRole.DRIVER, full_name='Driver 1')
        self.crew1 = User.objects.create_user(email='crew1@test.com', password='pw', role=UserRole.CITIZEN, employee_type=EmployeeType.CREW_MEMBER, full_name='Crew 1')
        self.crew2 = User.objects.create_user(email='crew2@test.com', password='pw', role=UserRole.CITIZEN, employee_type=EmployeeType.CREW_MEMBER, full_name='Crew 2')
        self.non_crew = User.objects.create_user(email='citizen@test.com', password='pw', role=UserRole.CITIZEN)
        
        self.truck_a = Truck.objects.create(plate_number='TRK-A', status=TruckStatus.ACTIVE)
        self.truck_a.drivers.add(self.driver1)
        self.truck_a.crew.add(self.crew1)
        
        self.truck_m = Truck.objects.create(plate_number='TRK-M', status=TruckStatus.MAINTENANCE)
        self.truck_m.crew.add(self.crew2)
        
        today_str = timezone.localdate().strftime('%a')
        self.sched = CollectionSchedule.objects.create(
            truck=self.truck_a, driver=self.driver1,
            days=today_str, start_time='06:00:00', end_time='10:00:00'
        )

    def test_active_truck_with_schedule(self):
        self.client.force_authenticate(user=self.crew1)
        res = self.client.get('/api/driver/crew-assignments/my-assignment/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['truck_plate'], 'TRK-A')
        self.assertEqual(res.data['driver_name'], 'Driver 1')
        self.assertEqual(res.data['schedule'], self.sched.id)
        crew_ids = [c['id'] for c in res.data['crew_names']]
        self.assertIn(self.crew1.id, crew_ids)

    def test_active_truck_no_schedule(self):
        self.sched.delete()
        self.client.force_authenticate(user=self.crew1)
        res = self.client.get('/api/driver/crew-assignments/my-assignment/')
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data['schedule'])

    def test_maintenance_truck_or_non_crew(self):
        self.client.force_authenticate(user=self.crew2)
        res = self.client.get('/api/driver/crew-assignments/my-assignment/')
        self.assertEqual(res.status_code, 404)
        
        self.client.force_authenticate(user=self.non_crew)
        res = self.client.get('/api/driver/crew-assignments/my-assignment/')
        self.assertEqual(res.status_code, 404)

    def test_permissions(self):
        self.client.force_authenticate(user=self.crew1)
        res = self.client.post('/api/driver/crew-assignments/', {})
        self.assertEqual(res.status_code, 403)
        res = self.client.get('/api/driver/crew-assignments/')
        self.assertEqual(res.status_code, 403)
        
        self.client.force_authenticate(user=self.admin)
        res = self.client.get('/api/driver/crew-assignments/')
        self.assertEqual(res.status_code, 200)
