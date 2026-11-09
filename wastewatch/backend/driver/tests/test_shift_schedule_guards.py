from datetime import time
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Barangay, DriverProfile
from driver.models import CollectionSchedule, DriverShift, MissedStop, PickupStatus, Truck
from driver.serializers import DriverShiftSerializer
from watcher.models import StopValidation, StopValidationStatus

User = get_user_model()

DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


class DriverShiftScheduleGuardTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.driver = User.objects.create_user(
            username='driver_guard_test',
            email='driver_guard_test@example.com',
            password='testpassword123',
            role='driver',
        )
        self.truck = Truck.objects.create(
            plate_number='WW-901',
            model='Compactor',
            status='active',
        )
        self.truck.drivers.add(self.driver)
        self.client.force_authenticate(user=self.driver)

        self.today = timezone.localdate()
        self.today_day = DAY_NAMES[self.today.weekday()]
        self.other_day = DAY_NAMES[(self.today.weekday() + 2) % 7]

    def _create_schedule(self, days_str, status_val='PENDING'):
        return CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver,
            area='Isabang Test Route',
            start_time=time(8, 0),
            end_time=time(16, 0),
            days=days_str,
            status=status_val,
            waypoints=[
                {'lat': 13.9414, 'lng': 121.6234, 'label': 'Base'},
                {'lat': 13.9450, 'lng': 121.6260, 'label': 'Stop 1'},
            ],
        )

    def test_unscheduled_day_blocks_pre_start_direct_start_and_flow_current(self):
        off_day_schedule = self._create_schedule(self.other_day)

        current_res = self.client.get('/api/driver/shift/current/')
        self.assertEqual(current_res.status_code, 200)
        self.assertIsNone(current_res.data['active_shift'])
        self.assertFalse(current_res.data['can_start_shift'])
        self.assertEqual(current_res.data['block_reason'], 'no_schedule_today')

        today_res = self.client.get('/api/driver/route-assignments/today/')
        self.assertEqual(today_res.status_code, 200)
        self.assertFalse(today_res.data['assigned'])

        pre_res = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(pre_res.status_code, 400)
        self.assertEqual(pre_res.data.get('code'), 'no_schedule_today')

        explicit_pre_res = self.client.post(
            '/api/driver/shift/pre_start/',
            {'schedule_id': off_day_schedule.id},
            format='json',
        )
        self.assertEqual(explicit_pre_res.status_code, 400)
        self.assertEqual(explicit_pre_res.data.get('code'), 'no_schedule_today')

        start_res = self.client.post('/api/driver/shift/start/', {}, format='json')
        self.assertEqual(start_res.status_code, 400)
        self.assertEqual(start_res.data.get('code'), 'no_schedule_today')
        self.assertFalse(DriverShift.objects.filter(driver=self.driver, is_active=True).exists())

    def test_scheduled_day_allows_pre_start_and_checkin_start(self):
        self._create_schedule(self.other_day)
        today_schedule = self._create_schedule(self.today_day)

        current_res = self.client.get('/api/driver/shift/current/')
        self.assertEqual(current_res.status_code, 200)
        self.assertTrue(current_res.data['can_start_shift'])

        today_res = self.client.get('/api/driver/route-assignments/today/')
        self.assertEqual(today_res.status_code, 200)
        self.assertTrue(today_res.data['assigned'])
        self.assertEqual(today_res.data['id'], today_schedule.id)

        pre_res = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(pre_res.status_code, 201)
        self.assertEqual(pre_res.data['schedule'], today_schedule.id)

        start_res = self.client.post(
            '/api/driver/shift/start/',
            {'schedule_id': today_schedule.id, 'latitude': 13.9414, 'longitude': 121.6234},
            format='json',
        )
        self.assertEqual(start_res.status_code, 200)
        self.assertEqual(start_res.data['op_status'], 'on_duty')

    @override_settings(DEBUG=True)
    def test_already_ended_truck_shift_today_blocks_reentry_and_returns_truck_history(self):
        today_schedule = self._create_schedule(self.today_day)

        pre_res = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(pre_res.status_code, 201)
        end_res = self.client.post('/api/driver/shift/end/', {}, format='json')
        self.assertEqual(end_res.status_code, 200)

        current_res = self.client.get('/api/driver/shift/current/')
        self.assertEqual(current_res.status_code, 200)
        self.assertIsNone(current_res.data['active_shift'])
        self.assertFalse(current_res.data['can_start_shift'])
        self.assertEqual(current_res.data['block_reason'], 'shift_already_ended')
        self.assertIsNotNone(current_res.data['previous_shift_today'])
        self.assertEqual(len(current_res.data['truck_previous_shifts_today']), 1)
        self.assertEqual(current_res.data['truck_previous_shifts_today'][0]['truck_plate'], 'WW-901')

        re_pre_res = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(re_pre_res.status_code, 400)
        self.assertEqual(re_pre_res.data.get('code'), 'shift_already_ended')

        re_start_res = self.client.post(
            '/api/driver/shift/start/',
            {'schedule_id': today_schedule.id},
            format='json',
        )
        self.assertEqual(re_start_res.status_code, 400)
        self.assertEqual(re_start_res.data.get('code'), 'shift_already_ended')

    @override_settings(DEBUG=True)
    def test_completed_route_blocks_pre_start_even_in_debug_without_wiping_validations(self):
        today_schedule = self._create_schedule(self.today_day)
        StopValidation.objects.update_or_create(
            schedule=today_schedule,
            stop_order=1,
            collection_date=self.today,
            defaults={'current_status': StopValidationStatus.VERIFIED_COLLECTED},
        )

        current_res = self.client.get('/api/driver/shift/current/')
        self.assertEqual(current_res.status_code, 200)
        self.assertFalse(current_res.data['can_start_shift'])
        self.assertEqual(current_res.data['block_reason'], 'route_completed')

        pre_res = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(pre_res.status_code, 400)
        self.assertEqual(pre_res.data.get('code'), 'route_completed')
        self.assertEqual(
            StopValidation.objects.filter(schedule=today_schedule, collection_date=self.today).count(),
            1,
        )

    def test_suspended_driver_blocked_even_when_scheduled_today(self):
        self._create_schedule(self.today_day)
        DriverProfile.objects.update_or_create(
            user=self.driver,
            defaults={'is_suspended': True},
        )

        current_res = self.client.get('/api/driver/shift/current/')
        self.assertFalse(current_res.data['can_start_shift'])
        self.assertEqual(current_res.data['block_reason'], 'suspended')

        pre_res = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(pre_res.status_code, 403)

        start_res = self.client.post('/api/driver/shift/start/', {}, format='json')
        self.assertEqual(start_res.status_code, 403)

    def test_collection_schedules_paginate_false_returns_list(self):
        self._create_schedule(self.today_day)
        res = self.client.get('/api/driver/collection-schedules/?paginate=false')
        self.assertEqual(res.status_code, 200)
        self.assertIsInstance(res.data, list)
        self.assertEqual(len(res.data), 1)


class DriverShiftAuthorizationSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.driver = User.objects.create_user(
            username='sec_driver_1',
            email='sec_driver_1@example.com',
            password='testpassword123',
            role='driver',
        )
        self.other_driver = User.objects.create_user(
            username='sec_driver_2',
            email='sec_driver_2@example.com',
            password='testpassword123',
            role='driver',
        )
        # App admin created via UserManagement (role='admin', is_staff=False)
        self.role_admin = User.objects.create_user(
            username='sec_role_admin',
            email='sec_role_admin@example.com',
            password='testpassword123',
            role='admin',
            is_staff=False,
        )
        # Django staff admin (role!='admin', is_staff=True)
        self.staff_admin = User.objects.create_user(
            username='sec_staff_admin',
            email='sec_staff_admin@example.com',
            password='testpassword123',
            role='citizen',
            is_staff=True,
        )

        self.truck_1 = Truck.objects.create(
            plate_number='WW-SEC-1',
            model='Compactor',
            status='active',
        )
        self.truck_2 = Truck.objects.create(
            plate_number='WW-SEC-2',
            model='Mini Dump',
            status='active',
        )
        self.truck_1.drivers.add(self.driver)
        self.truck_2.drivers.add(self.other_driver)

        self.today = timezone.localdate()
        self.today_day = DAY_NAMES[self.today.weekday()]

        self.schedule_1 = CollectionSchedule.objects.create(
            truck=self.truck_1,
            driver=self.driver,
            area='Market View Security Route',
            start_time=time(7, 0),
            end_time=time(15, 0),
            days=self.today_day,
            status='PENDING',
            waypoints=[
                {'lat': 13.9414, 'lng': 121.6234, 'label': 'Base'},
                {'lat': 13.9450, 'lng': 121.6260, 'label': 'Stop 1'},
            ],
        )
        self.schedule_2 = CollectionSchedule.objects.create(
            truck=self.truck_2,
            driver=self.other_driver,
            area='Ibabang Dupay Security Route',
            start_time=time(8, 0),
            end_time=time(16, 0),
            days=self.today_day,
            status='PENDING',
            waypoints=[
                {'lat': 13.9414, 'lng': 121.6234, 'label': 'Base'},
                {'lat': 13.9480, 'lng': 121.6290, 'label': 'Stop 1'},
            ],
        )
        self.client.force_authenticate(user=self.driver)

    def test_ordinary_driver_cannot_create_shift_via_generic_post(self):
        res = self.client.post(
            '/api/driver/shift/',
            {
                'driver': self.driver.id,
                'truck': self.truck_1.id,
                'schedule': self.schedule_1.id,
                'is_active': True,
                'status': 'shiftroute',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(DriverShift.objects.count(), 0)

    def test_ordinary_driver_cannot_read_patch_or_put_another_drivers_shift(self):
        other_shift = DriverShift.objects.create(
            driver=self.other_driver,
            truck=self.truck_2,
            schedule=self.schedule_2,
            status='navigate_to_base',
            op_status='heading_to_start',
            is_active=True,
        )

        get_detail = self.client.get(f'/api/driver/shift/{other_shift.id}/')
        self.assertEqual(get_detail.status_code, 404)

        list_res = self.client.get('/api/driver/shift/')
        self.assertEqual(list_res.status_code, 200)
        returned_ids = [
            row['id'] for row in (list_res.data.get('results', list_res.data) if isinstance(list_res.data, dict) else list_res.data)
        ]
        self.assertNotIn(other_shift.id, returned_ids)

        patch_res = self.client.patch(
            f'/api/driver/shift/{other_shift.id}/',
            {'is_active': False, 'status': 'end_shift', 'end_reason': 'driver_ended'},
            format='json',
        )
        self.assertEqual(patch_res.status_code, 403)

        put_res = self.client.put(
            f'/api/driver/shift/{other_shift.id}/',
            {
                'driver': self.driver.id,
                'truck': self.truck_1.id,
                'schedule': self.schedule_1.id,
                'is_active': False,
                'status': 'end_shift',
            },
            format='json',
        )
        self.assertEqual(put_res.status_code, 403)

        other_shift.refresh_from_db()
        self.assertTrue(other_shift.is_active)
        self.assertEqual(other_shift.driver_id, self.other_driver.id)
        self.assertEqual(other_shift.status, 'navigate_to_base')

    def test_ordinary_driver_cannot_mutate_own_lifecycle_fields_via_generic_crud_or_serializer(self):
        pre_res = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(pre_res.status_code, 201)
        shift_id = pre_res.data['id']

        end_res = self.client.post('/api/driver/shift/end/', {}, format='json')
        self.assertEqual(end_res.status_code, 200)

        patch_res = self.client.patch(
            f'/api/driver/shift/{shift_id}/',
            {
                'is_active': True,
                'status': 'shiftroute',
                'ended_at': None,
                'end_reason': '',
                'driver': self.other_driver.id,
                'truck': self.truck_2.id,
                'schedule': self.schedule_2.id,
            },
            format='json',
        )
        self.assertEqual(patch_res.status_code, 403)

        put_res = self.client.put(
            f'/api/driver/shift/{shift_id}/',
            {
                'is_active': True,
                'status': 'shiftroute',
                'driver': self.other_driver.id,
            },
            format='json',
        )
        self.assertEqual(put_res.status_code, 403)

        shift = DriverShift.objects.get(pk=shift_id)
        self.assertFalse(shift.is_active)
        self.assertEqual(shift.status, 'end_shift')
        self.assertEqual(shift.end_reason, 'driver_ended')
        self.assertEqual(shift.driver_id, self.driver.id)

        # Defense-in-depth: serializer itself rejects writing lifecycle fields
        ser = DriverShiftSerializer(
            shift,
            data={
                'is_active': True,
                'status': 'shiftroute',
                'ended_at': None,
                'end_reason': '',
                'driver': self.other_driver.id,
                'truck': self.truck_2.id,
                'schedule': self.schedule_2.id,
            },
            partial=True,
        )
        self.assertTrue(ser.is_valid())
        ser.save()
        shift.refresh_from_db()
        self.assertFalse(shift.is_active)
        self.assertEqual(shift.status, 'end_shift')
        self.assertEqual(shift.end_reason, 'driver_ended')
        self.assertEqual(shift.driver_id, self.driver.id)
        self.assertEqual(shift.truck_id, self.truck_1.id)
        self.assertEqual(shift.schedule_id, self.schedule_1.id)

    def test_ordinary_driver_cannot_delete_ended_shift_and_same_day_restart_remains_blocked(self):
        pre_res = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(pre_res.status_code, 201)
        shift_id = pre_res.data['id']

        end_res = self.client.post('/api/driver/shift/end/', {}, format='json')
        self.assertEqual(end_res.status_code, 200)

        del_res = self.client.delete(f'/api/driver/shift/{shift_id}/')
        self.assertEqual(del_res.status_code, 403)
        self.assertTrue(DriverShift.objects.filter(pk=shift_id, is_active=False).exists())

        re_pre_res = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(re_pre_res.status_code, 400)
        self.assertEqual(re_pre_res.data.get('code'), 'shift_already_ended')

        re_start_res = self.client.post(
            '/api/driver/shift/start/',
            {'schedule_id': self.schedule_1.id},
            format='json',
        )
        self.assertEqual(re_start_res.status_code, 400)
        self.assertEqual(re_start_res.data.get('code'), 'shift_already_ended')

    @override_settings(DEBUG=True)
    def test_ordinary_driver_cannot_call_dev_reset_even_when_debug_true(self):
        StopValidation.objects.update_or_create(
            schedule=self.schedule_1,
            stop_order=1,
            collection_date=self.today,
            defaults={'current_status': StopValidationStatus.READY_FOR_COLLECTION},
        )
        pre_res = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(pre_res.status_code, 201)
        shift_id = pre_res.data['id']
        self.client.post('/api/driver/shift/end/', {}, format='json')

        current_res = self.client.get('/api/driver/shift/current/')
        self.assertEqual(current_res.status_code, 200)
        self.assertFalse(current_res.data.get('can_dev_reset'))

        reset_res = self.client.post(
            '/api/driver/shift/dev-reset/',
            {'phase': 'navigate_to_base', 'shift_id': shift_id},
            format='json',
        )
        self.assertEqual(reset_res.status_code, 403)
        self.assertTrue(DriverShift.objects.filter(pk=shift_id, is_active=False).exists())
        self.assertEqual(
            StopValidation.objects.filter(schedule=self.schedule_1, collection_date=self.today).count(),
            1,
        )

    def test_driver_cannot_update_status_or_extended_mode_against_another_drivers_shift(self):
        other_shift = DriverShift.objects.create(
            driver=self.other_driver,
            truck=self.truck_2,
            schedule=self.schedule_2,
            status='navigate_to_base',
            op_status='heading_to_start',
            is_active=True,
        )
        own_pre = self.client.post('/api/driver/shift/pre_start/', {}, format='json')
        self.assertEqual(own_pre.status_code, 201)
        own_shift_id = own_pre.data['id']

        cross_update = self.client.patch(
            f'/api/driver/shift/{other_shift.id}/update-status/',
            {'status': 'confirm_start'},
            format='json',
        )
        self.assertEqual(cross_update.status_code, 404)

        cross_ext = self.client.post(
            f'/api/driver/shift/{other_shift.id}/extended_mode/',
            {},
            format='json',
        )
        self.assertEqual(cross_ext.status_code, 404)

        other_shift.refresh_from_db()
        self.assertEqual(other_shift.status, 'navigate_to_base')
        self.assertFalse(other_shift.is_extended_mode)

        # Own shift update_status continues to work normally
        own_update = self.client.patch(
            f'/api/driver/shift/{own_shift_id}/update-status/',
            {'status': 'confirm_start'},
            format='json',
        )
        self.assertEqual(own_update.status_code, 200)
        self.assertEqual(own_update.data['status'], 'confirm_start')

    @override_settings(DEBUG=True)
    def test_authorized_admins_role_admin_and_is_staff_retain_permitted_operations(self):
        shift_a = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_1,
            schedule=self.schedule_1,
            status='shiftroute',
            op_status='on_route',
            is_active=True,
        )
        shift_b = DriverShift.objects.create(
            driver=self.other_driver,
            truck=self.truck_2,
            schedule=self.schedule_2,
            status='shiftroute',
            op_status='on_route',
            is_active=True,
        )

        # Ordinary driver cannot force-end another driver's shift
        forbid_force = self.client.post(f'/api/driver/shift/{shift_b.id}/force-end/', {}, format='json')
        self.assertEqual(forbid_force.status_code, 403)

        # 1. role='admin' (is_staff=False) can list all, retrieve any, force-end, and dev-reset in DEBUG
        self.client.force_authenticate(user=self.role_admin)
        list_res = self.client.get('/api/driver/shift/')
        self.assertEqual(list_res.status_code, 200)
        rows = list_res.data.get('results', list_res.data) if isinstance(list_res.data, dict) else list_res.data
        self.assertEqual({r['id'] for r in rows}, {shift_a.id, shift_b.id})

        detail_res = self.client.get(f'/api/driver/shift/{shift_a.id}/')
        self.assertEqual(detail_res.status_code, 200)
        self.assertEqual(detail_res.data['id'], shift_a.id)

        force_res_a = self.client.post(f'/api/driver/shift/{shift_a.id}/force-end/', {}, format='json')
        self.assertEqual(force_res_a.status_code, 200)
        shift_a.refresh_from_db()
        self.assertFalse(shift_a.is_active)
        self.assertEqual(shift_a.end_reason, 'admin_force_ended')

        reset_res = self.client.post(
            '/api/driver/shift/dev-reset/',
            {'driver_id': self.driver.id, 'phase': 'navigate_to_base'},
            format='json',
        )
        self.assertEqual(reset_res.status_code, 200)
        self.assertFalse(DriverShift.objects.filter(pk=shift_a.id).exists())

        # 2. is_staff=True (role!='admin') also retains full admin shift visibility & force-end
        self.client.force_authenticate(user=self.staff_admin)
        staff_detail = self.client.get(f'/api/driver/shift/{shift_b.id}/')
        self.assertEqual(staff_detail.status_code, 200)

        force_res_b = self.client.post(f'/api/driver/shift/{shift_b.id}/force-end/', {}, format='json')
        self.assertEqual(force_res_b.status_code, 200)
        shift_b.refresh_from_db()
        self.assertFalse(shift_b.is_active)
        self.assertEqual(shift_b.end_reason, 'admin_force_ended')

        # Even admins are blocked from dev_reset when DEBUG=False
        with override_settings(DEBUG=False):
            prod_reset = self.client.post('/api/driver/shift/dev-reset/', {}, format='json')
            self.assertEqual(prod_reset.status_code, 403)


class DriverShiftScheduleOwnershipAndTransitionSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.barangay = Barangay.objects.create(name='Barangay San Juan')
        self.driver = User.objects.create_user(
            username='ownership_driver_1',
            email='ownership_driver_1@example.com',
            password='testpassword123',
            role='driver',
        )
        self.other_driver = User.objects.create_user(
            username='ownership_driver_2',
            email='ownership_driver_2@example.com',
            password='testpassword123',
            role='driver',
        )
        self.role_admin = User.objects.create_user(
            username='ownership_admin_role',
            email='ownership_admin_role@example.com',
            password='testpassword123',
            role='admin',
            is_staff=False,
        )
        self.staff_admin = User.objects.create_user(
            username='ownership_admin_staff',
            email='ownership_admin_staff@example.com',
            password='testpassword123',
            role='driver',
            is_staff=True,
        )

        self.truck_a = Truck.objects.create(
            plate_number='TRUCK-OWN-A',
            model='Compactor A',
            status='active',
        )
        self.truck_b = Truck.objects.create(
            plate_number='TRUCK-OWN-B',
            model='Compactor B',
            status='active',
        )
        self.truck_a.drivers.add(self.driver)
        self.truck_b.drivers.add(self.other_driver)

        today = timezone.localdate()
        self.schedule_a = CollectionSchedule.objects.create(
            truck=self.truck_a,
            driver=self.driver,
            date=today,
            days='Mon,Tue,Wed,Thu,Fri,Sat,Sun',
            start_time=time(8, 0),
            end_time=time(17, 0),
            waypoints=[
                {'stop_order': 0, 'lat': 13.931, 'lng': 121.611, 'name': 'Depot', 'barangay_id': self.barangay.id},
                {'stop_order': 1, 'lat': 13.935, 'lng': 121.615, 'name': 'Stop 1', 'barangay_id': self.barangay.id},
                {'stop_order': 2, 'lat': 13.938, 'lng': 121.618, 'name': 'Stop 2', 'barangay_id': self.barangay.id},
            ],
            status='IN_PROGRESS',
        )
        self.schedule_b = CollectionSchedule.objects.create(
            truck=self.truck_b,
            driver=self.other_driver,
            date=today,
            days='Mon,Tue,Wed,Thu,Fri,Sat,Sun',
            start_time=time(8, 0),
            end_time=time(17, 0),
            waypoints=[
                {'stop_order': 0, 'lat': 13.941, 'lng': 121.621, 'name': 'Depot B', 'barangay_id': self.barangay.id},
                {'stop_order': 1, 'lat': 13.945, 'lng': 121.625, 'name': 'Stop B1', 'barangay_id': self.barangay.id},
            ],
            status='IN_PROGRESS',
        )

        self.pickup_a = PickupStatus.objects.create(
            schedule=self.schedule_a,
            driver=self.driver,
            stop_order=1,
            status='PENDING',
        )
        self.pickup_b = PickupStatus.objects.create(
            schedule=self.schedule_b,
            driver=self.other_driver,
            stop_order=1,
            status='PENDING',
        )

        self.client.force_authenticate(user=self.driver)

    def test_extended_mode_with_mismatched_schedule_b_is_rejected_and_leaves_b_untouched(self):
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_a,
            schedule=self.schedule_a,
            status='end_shift',
            op_status='heading_to_dumpsite',
            is_active=True,
            started_at=timezone.now(),
        )

        res = self.client.post(
            f'/api/driver/shift/{shift.id}/extended_mode/',
            {
                'schedule_id': self.schedule_b.id,
                'missed_stop_orders': [1],
            },
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['active_schedule_id'], self.schedule_a.id)

        # Schedule B records must remain completely unchanged
        self.pickup_b.refresh_from_db()
        self.assertEqual(self.pickup_b.status, 'PENDING')
        self.assertEqual(MissedStop.objects.filter(original_schedule=self.schedule_b).count(), 0)

    def test_extended_mode_legitimate_operation_for_schedule_a_succeeds(self):
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_a,
            schedule=self.schedule_a,
            status='end_shift',
            op_status='heading_to_dumpsite',
            is_active=True,
            started_at=timezone.now(),
        )

        res = self.client.post(
            f'/api/driver/shift/{shift.id}/extended_mode/',
            {
                'schedule_id': self.schedule_a.id,
                'missed_stop_orders': [1],
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)

        shift.refresh_from_db()
        self.assertTrue(shift.is_extended_mode)
        self.assertEqual(shift.status, 'shiftroute')

        self.pickup_a.refresh_from_db()
        self.assertEqual(self.pickup_a.status, 'DRIVER_MISSED')
        self.assertEqual(
            MissedStop.objects.filter(original_schedule=self.schedule_a, stop_order=1).count(),
            1,
        )

    def test_shift_with_null_schedule_rejects_supplied_schedule_id_for_extended_and_end(self):
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_a,
            schedule=None,
            status='end_shift',
            op_status='heading_to_dumpsite',
            is_active=True,
            started_at=timezone.now(),
        )

        # Extended mode with supplied schedule ID rejected
        ext_res = self.client.post(
            f'/api/driver/shift/{shift.id}/extended_mode/',
            {
                'schedule_id': self.schedule_b.id,
                'missed_stop_orders': [1],
            },
            format='json',
        )
        self.assertEqual(ext_res.status_code, 409)
        self.assertIsNone(ext_res.data['active_schedule_id'])

        # End shift with supplied schedule ID rejected
        end_res = self.client.post(
            '/api/driver/shift/end/',
            {
                'schedule_id': self.schedule_b.id,
                'missed_stop_orders': [1],
            },
            format='json',
        )
        self.assertEqual(end_res.status_code, 409)
        self.assertIsNone(end_res.data['active_schedule_id'])

        # Target schedule B must remain untouched
        self.pickup_b.refresh_from_db()
        self.assertEqual(self.pickup_b.status, 'PENDING')
        self.assertEqual(MissedStop.objects.filter(original_schedule=self.schedule_b).count(), 0)

    def test_end_shift_with_mismatched_schedule_id_is_rejected(self):
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_a,
            schedule=self.schedule_a,
            status='shiftroute',
            op_status='on_route',
            is_active=True,
            started_at=timezone.now(),
        )

        res = self.client.post(
            '/api/driver/shift/end/',
            {
                'schedule_id': self.schedule_b.id,
                'missed_stop_orders': [1],
            },
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['active_schedule_id'], self.schedule_a.id)

        # Shift must remain active
        shift.refresh_from_db()
        self.assertTrue(shift.is_active)

        self.pickup_b.refresh_from_db()
        self.assertEqual(self.pickup_b.status, 'PENDING')
        self.assertEqual(MissedStop.objects.filter(original_schedule=self.schedule_b).count(), 0)

    def test_legitimate_legacy_shift_ending_with_null_schedule_succeeds(self):
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_a,
            schedule=None,
            status='shiftroute',
            op_status='on_route',
            is_active=True,
            started_at=timezone.now(),
        )

        res = self.client.post('/api/driver/shift/end/', {}, format='json')
        self.assertEqual(res.status_code, 200)

        shift.refresh_from_db()
        self.assertFalse(shift.is_active)
        self.assertEqual(shift.status, 'end_shift')
        self.assertEqual(shift.end_reason, 'driver_ended')

    @override_settings(DEBUG=True)
    def test_ordinary_driver_cannot_bypass_transitions_with_dev_skip(self):
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_a,
            schedule=self.schedule_a,
            status='navigate_to_base',
            op_status='heading_to_start',
            is_active=True,
            started_at=timezone.now(),
        )

        # Ordinary driver with dev_skip=True in DEBUG
        res = self.client.patch(
            f'/api/driver/shift/{shift.id}/update-status/',
            {'status': 'shiftroute', 'dev_skip': True},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        shift.refresh_from_db()
        self.assertEqual(shift.status, 'navigate_to_base')

        # Ordinary driver with dev_skip=True in production (DEBUG=False)
        with override_settings(DEBUG=False):
            res_prod = self.client.patch(
                f'/api/driver/shift/{shift.id}/update-status/',
                {'status': 'shiftroute', 'dev_skip': True},
                format='json',
            )
            self.assertEqual(res_prod.status_code, 400)
            shift.refresh_from_db()
            self.assertEqual(shift.status, 'navigate_to_base')

    def test_ordinary_driver_unknown_status_string_is_rejected(self):
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_a,
            schedule=self.schedule_a,
            status='navigate_to_base',
            op_status='heading_to_start',
            is_active=True,
            started_at=timezone.now(),
        )

        res = self.client.patch(
            f'/api/driver/shift/{shift.id}/update-status/',
            {'status': 'arbitrary_invalid_phase'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('Unrecognized phase status', res.data['error'])
        shift.refresh_from_db()
        self.assertEqual(shift.status, 'navigate_to_base')

    def test_valid_phase_transitions_sequence(self):
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_a,
            schedule=self.schedule_a,
            status='navigate_to_base',
            op_status='heading_to_start',
            is_active=True,
            started_at=timezone.now(),
        )

        steps = [
            ('confirm_start', 'at_base'),
            ('checkin', 'checking_in'),
            ('shiftroute', 'on_route'),
            ('end_shift', 'heading_to_dumpsite'),
            ('shiftroute', 'on_route'),  # Extended mode re-entry
        ]

        for next_status, expected_op_status in steps:
            res = self.client.patch(
                f'/api/driver/shift/{shift.id}/update-status/',
                {'status': next_status},
                format='json',
            )
            self.assertEqual(res.status_code, 200, f'Failed transition to {next_status}')
            self.assertEqual(res.data['status'], next_status)
            shift.refresh_from_db()
            self.assertEqual(shift.status, next_status)
            self.assertEqual(shift.op_status, expected_op_status)

    def test_assignment_to_shiftroute_and_end_shift_transitions_are_blocked(self):
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_a,
            schedule=self.schedule_a,
            status='assignment',
            op_status='off_duty',
            is_active=True,
            started_at=timezone.now(),
        )

        # Direct assignment -> shiftroute is blocked
        res_sr = self.client.patch(
            f'/api/driver/shift/{shift.id}/update-status/',
            {'status': 'shiftroute'},
            format='json',
        )
        self.assertEqual(res_sr.status_code, 400)

        # Direct assignment -> end_shift is blocked
        res_es = self.client.patch(
            f'/api/driver/shift/{shift.id}/update-status/',
            {'status': 'end_shift'},
            format='json',
        )
        self.assertEqual(res_es.status_code, 400)

        # assignment -> navigate_to_base is the only valid forward progression
        res_nb = self.client.patch(
            f'/api/driver/shift/{shift.id}/update-status/',
            {'status': 'navigate_to_base'},
            format='json',
        )
        self.assertEqual(res_nb.status_code, 200)
        shift.refresh_from_db()
        self.assertEqual(shift.status, 'navigate_to_base')

    def test_dev_bypass_permissions_matrix(self):
        shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck_a,
            schedule=self.schedule_a,
            status='navigate_to_base',
            op_status='heading_to_start',
            is_active=True,
            started_at=timezone.now(),
        )

        # 1. Admin in DEBUG=True with dev_skip=True can bypass
        with override_settings(DEBUG=True):
            self.client.force_authenticate(user=self.role_admin)
            res_admin_dbg = self.client.patch(
                f'/api/driver/shift/{shift.id}/update-status/',
                {'status': 'shiftroute', 'dev_skip': True},
                format='json',
            )
            self.assertEqual(res_admin_dbg.status_code, 200)
            shift.refresh_from_db()
            self.assertEqual(shift.status, 'shiftroute')

        # Reset back to navigate_to_base for next check
        shift.status = 'navigate_to_base'
        shift.save(update_fields=['status'])

        # 2. Ordinary driver in DEBUG=True with dev_skip=True is denied bypass
        with override_settings(DEBUG=True):
            self.client.force_authenticate(user=self.driver)
            res_driver_dbg = self.client.patch(
                f'/api/driver/shift/{shift.id}/update-status/',
                {'status': 'shiftroute', 'dev_skip': True},
                format='json',
            )
            self.assertEqual(res_driver_dbg.status_code, 400)
            shift.refresh_from_db()
            self.assertEqual(shift.status, 'navigate_to_base')

        # 3. Admin in DEBUG=False with dev_skip=True is denied bypass
        with override_settings(DEBUG=False):
            self.client.force_authenticate(user=self.role_admin)
            res_admin_prod = self.client.patch(
                f'/api/driver/shift/{shift.id}/update-status/',
                {'status': 'shiftroute', 'dev_skip': True},
                format='json',
            )
            self.assertEqual(res_admin_prod.status_code, 400)
            shift.refresh_from_db()
            self.assertEqual(shift.status, 'navigate_to_base')
