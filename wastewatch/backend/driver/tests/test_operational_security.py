from django.test import TestCase
from rest_framework.test import APIClient
from django.utils import timezone
from accounts.models import User, UserRole, Barangay
from driver.models import (
    Truck,
    TruckStatus,
    CollectionSchedule,
    DriverShift,
    TruckCrewAssignment,
    Worker,
    SanitationTeam,
    SanitationTeamMembership,
)
from dumpsite.models import Dumpsite
from watcher.models import StopValidation, StopValidationStatus


class OperationalSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Barangays
        self.brgy_a = Barangay.objects.create(name='Barangay A')
        self.brgy_b = Barangay.objects.create(name='Barangay B')

        # Dumpsites
        self.dumpsite_1 = Dumpsite.objects.create(name='Sanitary Landfill 1', latitude=13.93, longitude=121.61, barangay=self.brgy_a)
        self.dumpsite_2 = Dumpsite.objects.create(name='Transfer Station 2', latitude=13.95, longitude=121.63, barangay=self.brgy_b)

        # Users
        self.admin = User.objects.create_user(
            username='admin_sec', email='admin_sec@test.com', password='pw',
            role=UserRole.ADMIN, full_name='Admin User'
        )
        self.staff_admin = User.objects.create_user(
            username='staff_sec', email='staff_sec@test.com', password='pw',
            role=UserRole.CITIZEN, is_staff=True, full_name='Staff Admin'
        )
        self.driver_1 = User.objects.create_user(
            username='driver1_sec', email='driver1_sec@test.com', password='pw',
            role=UserRole.DRIVER, full_name='Driver One'
        )
        self.driver_2 = User.objects.create_user(
            username='driver2_sec', email='driver2_sec@test.com', password='pw',
            role=UserRole.DRIVER, full_name='Driver Two'
        )
        self.dumpsite_staff_1 = User.objects.create_user(
            username='dumpsite1_sec', email='dumpsite1_sec@test.com', password='pw',
            role=UserRole.DUMPSITE, dumpsite=self.dumpsite_1, full_name='Dumpsite Staff 1'
        )
        self.dumpsite_staff_unassigned = User.objects.create_user(
            username='dumpsite_unassigned', email='dumpsite_unassigned@test.com', password='pw',
            role=UserRole.DUMPSITE, dumpsite=None, full_name='Unassigned Dumpsite Staff'
        )
        self.watcher_a = User.objects.create_user(
            username='watcher_a', email='watcher_a@test.com', password='pw',
            role=UserRole.WATCHER, barangay=self.brgy_a, full_name='Watcher A'
        )
        self.watcher_b = User.objects.create_user(
            username='watcher_b', email='watcher_b@test.com', password='pw',
            role=UserRole.WATCHER, barangay=self.brgy_b, full_name='Watcher B'
        )
        self.watcher_unassigned = User.objects.create_user(
            username='watcher_unassigned', email='watcher_unassigned@test.com', password='pw',
            role=UserRole.WATCHER, barangay=None, full_name='Watcher Unassigned'
        )
        self.citizen = User.objects.create_user(
            username='citizen_sec', email='citizen_sec@test.com', password='pw',
            role=UserRole.CITIZEN, barangay=self.brgy_a, full_name='Citizen User'
        )
        self.brgy_official = User.objects.create_user(
            username='official_sec', email='official_sec@test.com', password='pw',
            role=UserRole.BRGY_OFFICIAL, barangay=self.brgy_a, full_name='Barangay Official'
        )

        # Sanitation Teams & Deployment Leaders (Stage 5A authoritative scoping)
        self.worker_watcher_a = Worker.objects.create(
            employee_id='SEC-WA', full_name='Watcher A', user=self.watcher_a, is_active=True
        )
        self.worker_watcher_b = Worker.objects.create(
            employee_id='SEC-WB', full_name='Watcher B', user=self.watcher_b, is_active=True
        )
        self.worker_driver_1 = Worker.objects.create(
            employee_id='SEC-D1', full_name='Driver One', user=self.driver_1, is_active=True
        )
        self.worker_driver_2 = Worker.objects.create(
            employee_id='SEC-D2', full_name='Driver Two', user=self.driver_2, is_active=True
        )
        self.team_1 = SanitationTeam.objects.create(name='Sec Team 1', code='SEC-T1', is_active=True)
        self.team_2 = SanitationTeam.objects.create(name='Sec Team 2', code='SEC-T2', is_active=True)
        SanitationTeamMembership.objects.create(
            team=self.team_1, worker=self.worker_watcher_a, role_in_team='leader', is_active=True, created_by=self.admin
        )
        SanitationTeamMembership.objects.create(
            team=self.team_1, worker=self.worker_driver_1, role_in_team='driver', is_active=True, created_by=self.admin
        )
        SanitationTeamMembership.objects.create(
            team=self.team_2, worker=self.worker_watcher_b, role_in_team='leader', is_active=True, created_by=self.admin
        )
        SanitationTeamMembership.objects.create(
            team=self.team_2, worker=self.worker_driver_2, role_in_team='driver', is_active=True, created_by=self.admin
        )

        # Trucks
        self.truck_1 = Truck.objects.create(plate_number='SEC-101', status=TruckStatus.ACTIVE)
        self.truck_2 = Truck.objects.create(plate_number='SEC-202', status=TruckStatus.ACTIVE)

        # Collection Schedules
        self.sched_1 = CollectionSchedule.objects.create(
            truck=self.truck_1, driver=self.driver_1, dumpsite=self.dumpsite_1, default_team=self.team_1,
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun', start_time='06:00:00', end_time='10:00:00',
            waypoints=[
                {'lat': 13.931, 'lng': 121.611},
                {'lat': 13.932, 'lng': 121.612, 'label': 'Stop 1', 'barangay_id': self.brgy_a.id}
            ]
        )
        self.sched_1.barangays.add(self.brgy_a)

        self.sched_2 = CollectionSchedule.objects.create(
            truck=self.truck_2, driver=self.driver_2, dumpsite=self.dumpsite_2, default_team=self.team_2,
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun', start_time='08:00:00', end_time='12:00:00',
            waypoints=[
                {'lat': 13.941, 'lng': 121.621},
                {'lat': 13.942, 'lng': 121.622, 'label': 'Stop 2', 'barangay_id': self.brgy_b.id}
            ]
        )
        self.sched_2.barangays.add(self.brgy_b)

        # Stop Validations (automatically initialized or updated)
        today = timezone.localdate()
        self.val_a, _ = StopValidation.objects.get_or_create(
            schedule=self.sched_1,
            stop_order=1,
            collection_date=today,
            defaults={'barangay': self.brgy_a, 'current_status': StopValidationStatus.PENDING_INSPECTION}
        )
        self.val_a.barangay = self.brgy_a
        self.val_a.current_status = StopValidationStatus.PENDING_INSPECTION
        self.val_a.save()

        self.val_b, _ = StopValidation.objects.get_or_create(
            schedule=self.sched_2,
            stop_order=1,
            collection_date=today,
            defaults={'barangay': self.brgy_b, 'current_status': StopValidationStatus.PENDING_INSPECTION}
        )
        self.val_b.barangay = self.brgy_b
        self.val_b.current_status = StopValidationStatus.PENDING_INSPECTION
        self.val_b.save()

    # -------------------------------------------------------------------------
    # CollectionScheduleViewSet Security Tests
    # -------------------------------------------------------------------------

    def test_collection_schedule_anonymous_denied(self):
        res = self.client.get('/api/driver/collection-schedules/')
        self.assertIn(res.status_code, [401, 403])

    def test_collection_schedule_unauthorized_roles_denied(self):
        for user in [self.citizen, self.watcher_a, self.brgy_official]:
            self.client.force_authenticate(user=user)
            res = self.client.get('/api/driver/collection-schedules/')
            self.assertEqual(res.status_code, 403, f"User role {user.role} should be denied with 403")

    def test_collection_schedule_admin_access(self):
        # Admin role
        self.client.force_authenticate(user=self.admin)
        res = self.client.get('/api/driver/collection-schedules/')
        self.assertEqual(res.status_code, 200)
        data = res.data if isinstance(res.data, list) else res.data.get('results', [])
        ids = [s['id'] for s in data]
        self.assertIn(self.sched_1.id, ids)
        self.assertIn(self.sched_2.id, ids)

        # Staff admin (is_staff=True with non-admin role)
        self.client.force_authenticate(user=self.staff_admin)
        res_staff = self.client.get('/api/driver/collection-schedules/')
        self.assertEqual(res_staff.status_code, 200)
        data_staff = res_staff.data if isinstance(res_staff.data, list) else res_staff.data.get('results', [])
        ids_staff = [s['id'] for s in data_staff]
        self.assertIn(self.sched_1.id, ids_staff)
        self.assertIn(self.sched_2.id, ids_staff)

    def test_collection_schedule_driver_scoping(self):
        # Driver 1 should only see sched_1 (assigned as default driver)
        self.client.force_authenticate(user=self.driver_1)
        res = self.client.get('/api/driver/collection-schedules/')
        self.assertEqual(res.status_code, 200)
        data = res.data if isinstance(res.data, list) else res.data.get('results', [])
        ids = [s['id'] for s in data]
        self.assertIn(self.sched_1.id, ids)
        self.assertNotIn(self.sched_2.id, ids)

        # Retrieve request respect scoping
        res_retrieve_ok = self.client.get(f'/api/driver/collection-schedules/{self.sched_1.id}/')
        self.assertEqual(res_retrieve_ok.status_code, 200)
        res_retrieve_unauthorized = self.client.get(f'/api/driver/collection-schedules/{self.sched_2.id}/')
        self.assertEqual(res_retrieve_unauthorized.status_code, 404)

    def test_collection_schedule_driver_active_shift_and_crew_assignment(self):
        # Driver 1 assigned to sched_2 via active DriverShift
        DriverShift.objects.create(
            driver=self.driver_1, truck=self.truck_2, schedule=self.sched_2, is_active=True
        )
        self.client.force_authenticate(user=self.driver_1)
        res = self.client.get('/api/driver/collection-schedules/')
        self.assertEqual(res.status_code, 200)
        data = res.data if isinstance(res.data, list) else res.data.get('results', [])
        ids = [s['id'] for s in data]
        self.assertIn(self.sched_1.id, ids)
        self.assertIn(self.sched_2.id, ids)

        # Driver 2 assigned to sched_1 via today's TruckCrewAssignment
        today = timezone.localdate()
        TruckCrewAssignment.objects.create(
            truck=self.truck_1, driver=self.driver_2, schedule=self.sched_1, date=today, is_active=True
        )
        self.client.force_authenticate(user=self.driver_2)
        res_d2 = self.client.get('/api/driver/collection-schedules/')
        self.assertEqual(res_d2.status_code, 200)
        data_d2 = res_d2.data if isinstance(res_d2.data, list) else res_d2.data.get('results', [])
        ids_d2 = [s['id'] for s in data_d2]
        self.assertIn(self.sched_1.id, ids_d2)
        self.assertIn(self.sched_2.id, ids_d2)

    def test_collection_schedule_dumpsite_operator_scoping(self):
        # Dumpsite staff 1 sees only sched_1 (dumpsite_1)
        self.client.force_authenticate(user=self.dumpsite_staff_1)
        res = self.client.get('/api/driver/collection-schedules/')
        self.assertEqual(res.status_code, 200)
        data = res.data if isinstance(res.data, list) else res.data.get('results', [])
        ids = [s['id'] for s in data]
        self.assertIn(self.sched_1.id, ids)
        self.assertNotIn(self.sched_2.id, ids)

        # Unassigned dumpsite staff fails closed (0 results)
        self.client.force_authenticate(user=self.dumpsite_staff_unassigned)
        res_unassigned = self.client.get('/api/driver/collection-schedules/')
        self.assertEqual(res_unassigned.status_code, 200)
        data_unassigned = res_unassigned.data if isinstance(res_unassigned.data, list) else res_unassigned.data.get('results', [])
        self.assertEqual(len(data_unassigned), 0)

    def test_collection_schedule_unpaginated_access(self):
        # Admin can fetch unpaginated
        self.client.force_authenticate(user=self.admin)
        res_admin = self.client.get('/api/driver/collection-schedules/?paginate=false')
        self.assertEqual(res_admin.status_code, 200)
        self.assertIsInstance(res_admin.data, list)

        # Driver can fetch unpaginated (scoped dataset)
        self.client.force_authenticate(user=self.driver_1)
        res_driver = self.client.get('/api/driver/collection-schedules/?paginate=false')
        self.assertEqual(res_driver.status_code, 200)
        self.assertIsInstance(res_driver.data, list)
        self.assertEqual(len(res_driver.data), 1)
        self.assertEqual(res_driver.data[0]['id'], self.sched_1.id)

        # Dumpsite can fetch unpaginated (scoped dataset)
        self.client.force_authenticate(user=self.dumpsite_staff_1)
        res_dumpsite = self.client.get('/api/driver/collection-schedules/?paginate=false')
        self.assertEqual(res_dumpsite.status_code, 200)
        self.assertIsInstance(res_dumpsite.data, list)
        self.assertEqual(len(res_dumpsite.data), 1)
        self.assertEqual(res_dumpsite.data[0]['id'], self.sched_1.id)

    # -------------------------------------------------------------------------
    # StopValidationViewSet Security Tests
    # -------------------------------------------------------------------------

    def test_stop_validation_anonymous_denied(self):
        res = self.client.get('/api/watcher/stop-validations/')
        self.assertIn(res.status_code, [401, 403])

    def test_stop_validation_unauthorized_roles_denied(self):
        for user in [self.citizen, self.brgy_official, self.dumpsite_staff_1]:
            self.client.force_authenticate(user=user)
            res = self.client.get('/api/watcher/stop-validations/')
            self.assertEqual(res.status_code, 403, f"Role {user.role} should be denied with 403")

    def test_stop_validation_admin_access(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.get('/api/watcher/stop-validations/')
        self.assertEqual(res.status_code, 200)
        data = res.data if isinstance(res.data, list) else res.data.get('results', [])
        ids = [v['id'] for v in data]
        self.assertIn(self.val_a.id, ids)
        self.assertIn(self.val_b.id, ids)

        # Staff admin
        self.client.force_authenticate(user=self.staff_admin)
        res_staff = self.client.get('/api/watcher/stop-validations/')
        self.assertEqual(res_staff.status_code, 200)

    def test_stop_validation_watcher_scoping(self):
        # Watcher A in Barangay A sees val_a but NOT val_b (Barangay B)
        self.client.force_authenticate(user=self.watcher_a)
        res = self.client.get('/api/watcher/stop-validations/')
        self.assertEqual(res.status_code, 200)
        data = res.data if isinstance(res.data, list) else res.data.get('results', [])
        ids = [v['id'] for v in data]
        self.assertIn(self.val_a.id, ids)
        self.assertNotIn(self.val_b.id, ids)

        # Unassigned watcher receives empty list (fails closed)
        self.client.force_authenticate(user=self.watcher_unassigned)
        res_unassigned = self.client.get('/api/watcher/stop-validations/')
        self.assertEqual(res_unassigned.status_code, 200)
        data_unassigned = res_unassigned.data if isinstance(res_unassigned.data, list) else res_unassigned.data.get('results', [])
        self.assertEqual(len(data_unassigned), 0)

    def test_stop_validation_driver_scoping(self):
        # Driver 1 assigned to sched_1 sees val_a, not val_b
        self.client.force_authenticate(user=self.driver_1)
        res = self.client.get('/api/watcher/stop-validations/')
        self.assertEqual(res.status_code, 200)
        data = res.data if isinstance(res.data, list) else res.data.get('results', [])
        ids = [v['id'] for v in data]
        self.assertIn(self.val_a.id, ids)
        self.assertNotIn(self.val_b.id, ids)

        # Driver querying authorized schedule_id
        res_sched = self.client.get(f'/api/watcher/stop-validations/?schedule_id={self.sched_1.id}')
        self.assertEqual(res_sched.status_code, 200)
        ids_sched = [v['id'] for v in (res_sched.data if isinstance(res_sched.data, list) else res_sched.data.get('results', []))]
        self.assertIn(self.val_a.id, ids_sched)

        # Driver querying unauthorized schedule_id returns empty
        res_unauth = self.client.get(f'/api/watcher/stop-validations/?schedule_id={self.sched_2.id}')
        self.assertEqual(res_unauth.status_code, 200)
        ids_unauth = [v['id'] for v in (res_unauth.data if isinstance(res_unauth.data, list) else res_unauth.data.get('results', []))]
        self.assertNotIn(self.val_b.id, ids_unauth)

    def test_stop_validation_actions_role_enforcement(self):
        # Driver cannot call pre_inspect or post_verify (403)
        self.client.force_authenticate(user=self.driver_1)
        res_driver_pre = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': self.sched_1.id, 'stop_order': 1, 'outcome': 'present'
        })
        self.assertEqual(res_driver_pre.status_code, 403)

        res_driver_post = self.client.post('/api/watcher/stop-validations/post-verify/', {
            'schedule_id': self.sched_1.id, 'stop_order': 1, 'outcome': 'success'
        })
        self.assertEqual(res_driver_post.status_code, 403)

        # Citizen cannot call pre_inspect (403)
        self.client.force_authenticate(user=self.citizen)
        res_cit = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': self.sched_1.id, 'stop_order': 1, 'outcome': 'present'
        })
        self.assertEqual(res_cit.status_code, 403)

        # Barangay Official cannot call pre_inspect (403)
        self.client.force_authenticate(user=self.brgy_official)
        res_official = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': self.sched_1.id, 'stop_order': 1, 'outcome': 'present'
        })
        self.assertEqual(res_official.status_code, 403)

        # Watcher A attempting to pre_inspect stop in Barangay B gets 403
        self.client.force_authenticate(user=self.watcher_a)
        res_wrong_brgy = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': self.sched_2.id, 'stop_order': 1, 'outcome': 'present',
            'lat': 13.942, 'lng': 121.622
        })
        self.assertEqual(res_wrong_brgy.status_code, 403)

        # Watcher A attempting to post_verify stop in Barangay B gets 403
        res_wrong_brgy_post = self.client.post('/api/watcher/stop-validations/post-verify/', {
            'schedule_id': self.sched_2.id, 'stop_order': 1, 'outcome': 'success',
            'lat': 13.942, 'lng': 121.622
        })
        self.assertEqual(res_wrong_brgy_post.status_code, 403)

    def test_unassigned_driver_fails_closed(self):
        driver_unassigned = User.objects.create_user(
            username='driver_unassigned', email='driver_unassigned@test.com', password='pw',
            role=UserRole.DRIVER, full_name='Unassigned Driver'
        )
        self.client.force_authenticate(user=driver_unassigned)
        res_sched = self.client.get('/api/driver/collection-schedules/')
        self.assertEqual(res_sched.status_code, 200)
        data_sched = res_sched.data if isinstance(res_sched.data, list) else res_sched.data.get('results', [])
        self.assertEqual(len(data_sched), 0)

        res_val = self.client.get('/api/watcher/stop-validations/')
        self.assertEqual(res_val.status_code, 200)
        data_val = res_val.data if isinstance(res_val.data, list) else res_val.data.get('results', [])
        self.assertEqual(len(data_val), 0)

    def test_direct_retrieval_cannot_bypass_scoping(self):
        # Driver 1 retrieves own schedule -> 200 OK
        self.client.force_authenticate(user=self.driver_1)
        res_d1_own = self.client.get(f'/api/driver/collection-schedules/{self.sched_1.id}/')
        self.assertEqual(res_d1_own.status_code, 200)

        # Driver 1 retrieves other driver's schedule -> 404 Not Found
        res_d1_other = self.client.get(f'/api/driver/collection-schedules/{self.sched_2.id}/')
        self.assertEqual(res_d1_other.status_code, 404)

        # Dumpsite 1 retrieves own schedule -> 200 OK
        self.client.force_authenticate(user=self.dumpsite_staff_1)
        res_ds_own = self.client.get(f'/api/driver/collection-schedules/{self.sched_1.id}/')
        self.assertEqual(res_ds_own.status_code, 200)

        # Dumpsite 1 retrieves other facility's schedule -> 404 Not Found
        res_ds_other = self.client.get(f'/api/driver/collection-schedules/{self.sched_2.id}/')
        self.assertEqual(res_ds_other.status_code, 404)

        # Watcher A retrieves own barangay validation -> 200 OK
        self.client.force_authenticate(user=self.watcher_a)
        res_w_own = self.client.get(f'/api/watcher/stop-validations/{self.val_a.id}/')
        self.assertEqual(res_w_own.status_code, 200)

        # Watcher A retrieves other barangay validation -> 404 Not Found
        res_w_other = self.client.get(f'/api/watcher/stop-validations/{self.val_b.id}/')
        self.assertEqual(res_w_other.status_code, 404)

        # Unauthorized role retrieves directly -> 403 Forbidden
        self.client.force_authenticate(user=self.citizen)
        self.assertEqual(self.client.get(f'/api/driver/collection-schedules/{self.sched_1.id}/').status_code, 403)
        self.assertEqual(self.client.get(f'/api/watcher/stop-validations/{self.val_a.id}/').status_code, 403)

    def test_legitimate_watcher_full_lifecycle(self):
        # 1. Watcher pre-inspects stop 1 with present -> 200 OK, becomes READY_FOR_COLLECTION
        self.client.force_authenticate(user=self.watcher_a)
        res_pre = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': self.sched_1.id,
            'stop_order': 1,
            'outcome': 'present',
            'lat': 13.932,
            'lng': 121.612,
            'notes': 'All bins full and ready'
        })
        self.assertEqual(res_pre.status_code, 200)
        self.val_a.refresh_from_db()
        self.assertEqual(self.val_a.current_status, StopValidationStatus.READY_FOR_COLLECTION)
        self.assertEqual(self.val_a.pre_validation_watcher, self.watcher_a)

        # 2. Watcher post-verifies stop 1 with success -> 200 OK, becomes VERIFIED_COLLECTED
        res_post = self.client.post('/api/watcher/stop-validations/post-verify/', {
            'schedule_id': self.sched_1.id,
            'stop_order': 1,
            'outcome': 'success',
            'lat': 13.932,
            'lng': 121.612
        })
        self.assertEqual(res_post.status_code, 200)
        self.val_a.refresh_from_db()
        self.assertEqual(self.val_a.current_status, StopValidationStatus.VERIFIED_COLLECTED)
        self.assertEqual(self.val_a.post_validation_watcher, self.watcher_a)

    def test_watcher_gps_proximity_rejection(self):
        # GPS far away from stop (5km+) should be rejected with 403
        self.client.force_authenticate(user=self.watcher_a)
        res_far = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': self.sched_1.id,
            'stop_order': 1,
            'outcome': 'present',
            'lat': 14.500,
            'lng': 121.000
        })
        self.assertEqual(res_far.status_code, 403)

    def test_serializer_exposure_verification(self):
        # Driver receives own schedule with expected fields
        self.client.force_authenticate(user=self.driver_1)
        res = self.client.get(f'/api/driver/collection-schedules/{self.sched_1.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('waypoints', res.data)
        self.assertIn('truck_plate', res.data)
        self.assertIn('dumpsite_detail', res.data)
        self.assertEqual(res.data['truck_plate'], 'SEC-101')

        # Watcher receives stop validation with expected fields
        self.client.force_authenticate(user=self.watcher_a)
        res_val = self.client.get(f'/api/watcher/stop-validations/{self.val_a.id}/')
        self.assertEqual(res_val.status_code, 200)
        self.assertIn('current_status', res_val.data)
        self.assertIn('barangay_id', res_val.data)
        self.assertIn('barangay_name', res_val.data)
        self.assertEqual(res_val.data['barangay_id'], self.brgy_a.id)

    def test_b01_pickup_status_viewset_read_only_and_driver_only_collect(self):
        from driver.models import PickupStatus

        pickup, _ = PickupStatus.objects.get_or_create(
            driver=self.driver_1,
            schedule=self.sched_1,
            stop_order=1,
            defaults={
                'status': 'EN_ROUTE',
                'address': 'Stop 1',
            },
        )
        self.val_a.current_status = StopValidationStatus.READY_FOR_COLLECTION
        self.val_a.save(update_fields=['current_status'])

        all_roles = [
            self.citizen,
            self.watcher_a,
            self.brgy_official,
            self.dumpsite_staff_1,
            self.driver_1,
            self.admin,
            self.staff_admin,
        ]
        create_payload = {
            'driver': self.driver_1.id,
            'schedule': self.sched_1.id,
            'stop_order': 2,
            'status': 'COMPLETED',
        }
        for user in all_roles:
            self.client.force_authenticate(user=user)
            for base in ('/api/driver/pickup-statuses/', '/api/driver/stops/'):
                res_post = self.client.post(base, create_payload, format='json')
                self.assertEqual(res_post.status_code, 405, f"{base} POST by {user.role} must return 405")
                res_put = self.client.put(f'{base}{pickup.id}/', create_payload, format='json')
                self.assertEqual(res_put.status_code, 405, f"{base} PUT by {user.role} must return 405")
                res_patch = self.client.patch(f'{base}{pickup.id}/', {'status': 'COMPLETED'}, format='json')
                self.assertEqual(res_patch.status_code, 405, f"{base} PATCH by {user.role} must return 405")
                res_del = self.client.delete(f'{base}{pickup.id}/')
                self.assertEqual(res_del.status_code, 405, f"{base} DELETE by {user.role} must return 405")

        # POST /api/driver/stops/collect/ returns 403 for all non-drivers
        collect_payload = {
            'schedule_id': self.sched_1.id,
            'stop_order': 1,
            'lat': 13.932,
            'lng': 121.612,
        }
        for non_driver in (
            self.citizen,
            self.watcher_a,
            self.brgy_official,
            self.dumpsite_staff_1,
            self.admin,
            self.staff_admin,
        ):
            self.client.force_authenticate(user=non_driver)
            res_collect = self.client.post('/api/driver/stops/collect/', collect_payload, format='json')
            self.assertEqual(res_collect.status_code, 403, f"collect by {non_driver.role} must return 403")

        # Scoped GET /api/driver/stops/ returns [] for Citizen and 200 for Driver
        self.client.force_authenticate(user=self.citizen)
        res_cit_list = self.client.get('/api/driver/stops/')
        self.assertEqual(res_cit_list.status_code, 200)
        cit_rows = res_cit_list.data if isinstance(res_cit_list.data, list) else res_cit_list.data.get('results', [])
        self.assertEqual(cit_rows, [])

        # Assigned Driver can GET stops and POST collect
        self.client.force_authenticate(user=self.driver_1)
        res_drv_list = self.client.get('/api/driver/stops/')
        self.assertEqual(res_drv_list.status_code, 200)
        res_drv_collect = self.client.post('/api/driver/stops/collect/', collect_payload, format='json')
        self.assertEqual(res_drv_collect.status_code, 201)
        self.assertEqual(res_drv_collect.data['status'], 'COMPLETED')

