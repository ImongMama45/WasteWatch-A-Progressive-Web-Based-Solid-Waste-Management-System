from django.test import TestCase
from rest_framework.test import APIClient
from accounts.models import User, UserRole, EmployeeType
from driver.models import Truck, TruckStatus

class TruckAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        
        self.admin = User.objects.create_user(email='admin@test.com', password='pw', role=UserRole.ADMIN, full_name='Admin')
        self.driver1 = User.objects.create_user(email='driver1@test.com', password='pw', role=UserRole.DRIVER, full_name='Driver 1')
        self.driver2 = User.objects.create_user(email='driver2@test.com', password='pw', role=UserRole.DRIVER, full_name='Driver 2')
        self.driver3 = User.objects.create_user(email='driver3@test.com', password='pw', role=UserRole.DRIVER, full_name='Driver 3')
        self.citizen = User.objects.create_user(email='citizen@test.com', password='pw', role=UserRole.CITIZEN, full_name='Citizen')
        self.crew1 = User.objects.create_user(email='crew1@test.com', password='pw', role=UserRole.CITIZEN, employee_type=EmployeeType.CREW_MEMBER, full_name='Crew 1')
        self.crew2 = User.objects.create_user(email='crew2@test.com', password='pw', role=UserRole.CITIZEN, employee_type=EmployeeType.CREW_MEMBER, full_name='Crew 2')
        
        self.truck_a = Truck.objects.create(plate_number='TRK-A', model='Model A', status=TruckStatus.ACTIVE)
        self.truck_a.drivers.add(self.driver1)
        
        self.truck_b = Truck.objects.create(plate_number='TRK-B', model='Model B', status=TruckStatus.ACTIVE)

    def test_permissions(self):
        # Citizen
        self.client.force_authenticate(user=self.citizen)
        res = self.client.get('/api/driver/trucks/')
        self.assertEqual(res.status_code, 200)
        res = self.client.post('/api/driver/trucks/', {'plate_number': 'NEW1', 'model': 'M'})
        self.assertEqual(res.status_code, 403)
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'plate_number': 'NEW'})
        self.assertEqual(res.status_code, 403)
        res = self.client.delete(f'/api/driver/trucks/{self.truck_b.id}/')
        self.assertEqual(res.status_code, 403)

        # Driver
        self.client.force_authenticate(user=self.driver1)
        res = self.client.post('/api/driver/trucks/', {'plate_number': 'NEW1', 'model': 'M'})
        self.assertEqual(res.status_code, 403)
        
        # Admin
        self.client.force_authenticate(user=self.admin)
        res = self.client.post('/api/driver/trucks/', {'plate_number': 'NEW1', 'model': 'M'})
        self.assertEqual(res.status_code, 201)

    def test_role_restricted_assignees(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'drivers': [self.citizen.id]})
        self.assertEqual(res.status_code, 400)
        self.assertIn('drivers', res.data)
        
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'crew': [self.citizen.id]})
        self.assertEqual(res.status_code, 400)
        self.assertIn('crew', res.data)

    def test_max_2_drivers(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'drivers': [self.driver1.id, self.driver2.id, self.driver3.id]})
        self.assertEqual(res.status_code, 400)
        self.assertIn('drivers', res.data)

    def test_active_conflict(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'drivers': [self.driver1.id]})
        self.assertEqual(res.status_code, 400)
        self.assertIn('drivers', res.data)
        self.assertIn('TRK-A', res.data['drivers'][0])

    def test_maintenance_no_conflict_and_reactivation(self):
        self.client.force_authenticate(user=self.admin)
        # Put A in maintenance
        self.truck_a.status = TruckStatus.MAINTENANCE
        self.truck_a.save()
        
        # Now assigning driver1 to B works
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'drivers': [self.driver1.id]})
        self.assertEqual(res.status_code, 200)
        
        # Reactivating A should fail due to conflict
        res = self.client.patch(f'/api/driver/trucks/{self.truck_a.id}/', {'status': 'active'})
        self.assertEqual(res.status_code, 400)

    def test_conflict_skip_if_not_changed(self):
        self.client.force_authenticate(user=self.admin)
        # Create a bad state
        self.truck_b.drivers.add(self.driver1)
        
        # Editing just plate number should succeed
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'plate_number': 'TRK-B-UPDATED'})
        self.assertEqual(res.status_code, 200)

    def test_inactive_clears(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(f'/api/driver/trucks/{self.truck_a.id}/', {'status': 'inactive'})
        self.assertEqual(res.status_code, 200)
        self.truck_a.refresh_from_db()
        self.assertEqual(self.truck_a.drivers.count(), 0)
        
        # PATCH inactive + non-empty drivers -> 400
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'status': 'inactive', 'drivers': [self.driver2.id]})
        self.assertEqual(res.status_code, 400)

    def test_populated_response(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'drivers': [self.driver2.id], 'crew': [self.crew1.id]})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['drivers']), 1)
        self.assertEqual(len(res.data['crew']), 1)
        self.assertEqual(len(res.data['driver_details']), 1)
        self.assertEqual(len(res.data['crew_names']), 1)

    def test_read_only_fields(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'maintenance_start': '2025-01-01T00:00:00Z', 'past_crew_names': 'Hack'})
        self.assertEqual(res.status_code, 200)
        self.truck_b.refresh_from_db()
        self.assertIsNone(self.truck_b.maintenance_start)
        self.assertIsNone(self.truck_b.past_crew_names)

    def test_status_reason_writable(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(f'/api/driver/trucks/{self.truck_b.id}/', {'status': 'maintenance', 'status_reason': 'Broken engine'})
        self.assertEqual(res.status_code, 200)
        self.truck_b.refresh_from_db()
        self.assertEqual(self.truck_b.status_reason, 'Broken engine')
