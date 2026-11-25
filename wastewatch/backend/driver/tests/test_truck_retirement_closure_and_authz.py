from datetime import time

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay
from dumpsite.models import Dumpsite
from driver.allocation_service import AllocationService
from driver.models import (
    CollectionSchedule,
    CrewAttendanceRecord,
    CrewShift,
    DriverShift,
    SanitationTeam,
    Truck,
    WatcherShift,
    Worker,
)
from driver.shift_service import ShiftService
from driver.team_service import TeamService
from driver.truck_service import TruckService

User = get_user_model()


class TruckRetirementCoordinatedClosureTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='ret_admin', email='ret_admin@example.com', password='Password123!', role='admin'
        )
        self.driver_user = User.objects.create_user(username='ret_driver', email='ret_driver@example.com', password='Password123!', role='driver')
        self.watcher_a = User.objects.create_user(username='ret_watcher_a', email='ret_watcher_a@example.com', password='Password123!', role='watcher')
        self.watcher_b = User.objects.create_user(username='ret_watcher_b', email='ret_watcher_b@example.com', password='Password123!', role='watcher')

        self.team = TeamService.create_team(name='Team Retire', code='RETC')
        self.watcher_worker_a = Worker.objects.create(
            employee_id='EMP-RET-W', full_name='Retire Watcher A', user=self.watcher_a
        )
        self.driver_worker = Worker.objects.create(
            employee_id='EMP-RET-1', full_name='Retire Driver', user=self.driver_user
        )
        self.crew_worker = Worker.objects.create(employee_id='EMP-RET-2', full_name='Retire Crew')
        TeamService.assign_member(
            team_id=self.team.id, worker_id=self.watcher_worker_a.id, role_in_team='leader', created_by=self.admin
        )
        TeamService.assign_member(
            team_id=self.team.id, worker_id=self.driver_worker.id, role_in_team='driver', created_by=self.admin
        )
        TeamService.assign_member(
            team_id=self.team.id, worker_id=self.crew_worker.id, role_in_team='crew', created_by=self.admin
        )

        self.truck = Truck.objects.create(plate_number='RET-CLOSE-01', model='Isuzu', status='active')
        TruckService.commission_truck(self.truck, user=self.admin)
        self.truck.refresh_from_db()

        self.barangay = Barangay.objects.create(name='Retire Brgy')
        self.dumpsite = Dumpsite.objects.create(
            name='Retire Dumpsite',
            barangay=self.barangay,
            latitude=13.94,
            longitude=121.62,
        )

        self.schedule = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver_user,
            dumpsite=self.dumpsite,
            default_team=self.team,
            start_time=time(6, 0),
            end_time=time(14, 0),
            area='Zone Retire',
        )

    def _start_shift(self):
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id,
            allocation_date=timezone.localdate(),
            truck_id=self.truck.id,
            team_id=self.team.id,
            allocated_by=self.admin,
        )
        return ShiftService.stage_and_start_shift(
            driver_user=self.driver_user,
            schedule_id=self.schedule.id,
            allocation_id=alloc.id,
        )

    def test_retirement_closes_driver_crew_and_explicitly_linked_watcher_shift(self):
        linked_watcher_shift = WatcherShift.objects.create(
            watcher=self.watcher_a, schedule=self.schedule, shift_date=timezone.localdate(), is_active=True
        )
        shift = self._start_shift()

        ShiftService.record_initial_attendance(
            driver_shift_id=shift.id,
            attendance_list=[{'worker_id': self.crew_worker.id, 'status': 'PRESENT'}],
            recorded_by=self.watcher_a,
        )
        crew_shift = CrewShift.objects.get(driver_shift=shift)
        self.assertEqual(crew_shift.watcher_shift_id, linked_watcher_shift.id)

        TruckService.retire_truck(self.truck, user=self.admin, reason='End of service life')

        shift.refresh_from_db()
        self.assertFalse(shift.is_active)
        self.assertEqual(shift.end_reason, 'truck_retired')
        self.assertEqual(shift.truck_id, self.truck.id)

        linked_watcher_shift.refresh_from_db()
        self.assertFalse(linked_watcher_shift.is_active)
        self.assertIsNotNone(linked_watcher_shift.ended_at)

        crew_shift.refresh_from_db()
        self.assertFalse(crew_shift.is_active)
        self.assertEqual(crew_shift.watcher_shift_id, linked_watcher_shift.id)
        self.assertEqual(crew_shift.driver_shift_id, shift.id)

        # Attendance history intact
        self.assertEqual(CrewAttendanceRecord.objects.filter(driver_shift=shift).count(), 1)

    def test_unlinked_watcher_shift_on_same_schedule_is_never_closed(self):
        bound = WatcherShift.objects.create(
            watcher=self.watcher_a, schedule=self.schedule, shift_date=timezone.localdate(), is_active=True
        )
        unrelated = WatcherShift.objects.create(
            watcher=self.watcher_b, schedule=self.schedule, shift_date=timezone.localdate(), is_active=True
        )
        shift = self._start_shift()
        ShiftService.record_initial_attendance(
            driver_shift_id=shift.id,
            attendance_list=[{'worker_id': self.crew_worker.id, 'status': 'PRESENT'}],
            recorded_by=self.watcher_a,
        )
        crew_shift = CrewShift.objects.get(driver_shift=shift)
        bound_id = crew_shift.watcher_shift_id
        self.assertEqual(bound_id, bound.id)

        TruckService.retire_truck(self.truck, user=self.admin)

        self.assertFalse(WatcherShift.objects.get(pk=bound.id).is_active)
        self.assertTrue(WatcherShift.objects.get(pk=unrelated.id).is_active)

    def test_no_association_closes_no_watcher_shift(self):
        shift = self._start_shift()
        ShiftService.record_initial_attendance(
            driver_shift_id=shift.id,
            attendance_list=[{'worker_id': self.crew_worker.id, 'status': 'PRESENT'}],
            recorded_by=self.watcher_a,
        )
        crew_shift = CrewShift.objects.get(driver_shift=shift)
        self.assertIsNone(crew_shift.watcher_shift_id)

        # A watcher shift started later on the same schedule/date but not linked to this CrewShift
        stray = WatcherShift.objects.create(
            watcher=self.watcher_b, schedule=self.schedule, shift_date=timezone.localdate(), is_active=True
        )

        TruckService.retire_truck(self.truck, user=self.admin)

        shift.refresh_from_db()
        self.assertFalse(shift.is_active)
        self.assertEqual(shift.end_reason, 'truck_retired')
        stray.refresh_from_db()
        self.assertTrue(stray.is_active)
        self.assertIsNone(stray.ended_at)

    def test_schedule_mismatched_association_is_not_closed(self):
        other_schedule = CollectionSchedule.objects.create(
            start_time=time(15, 0), end_time=time(18, 0), area='Zone Other'
        )
        mismatched = WatcherShift.objects.create(
            watcher=self.watcher_b, schedule=other_schedule, shift_date=timezone.localdate(), is_active=True
        )
        shift = self._start_shift()
        ShiftService.record_initial_attendance(
            driver_shift_id=shift.id,
            attendance_list=[{'worker_id': self.crew_worker.id, 'status': 'PRESENT'}],
            recorded_by=self.watcher_a,
        )
        CrewShift.objects.filter(driver_shift=shift).update(watcher_shift=mismatched)

        TruckService.retire_truck(self.truck, user=self.admin)

        shift.refresh_from_db()
        self.assertFalse(shift.is_active)
        mismatched.refresh_from_db()
        self.assertTrue(mismatched.is_active)

    def test_normal_driver_end_closes_linked_watcher_and_crew_shift_and_keeps_attendance(self):
        watcher_shift = WatcherShift.objects.create(
            watcher=self.watcher_a, schedule=self.schedule, shift_date=timezone.localdate(), is_active=True
        )
        unrelated = WatcherShift.objects.create(
            watcher=self.watcher_b, schedule=self.schedule, shift_date=timezone.localdate(), is_active=True
        )
        shift = self._start_shift()
        ShiftService.record_initial_attendance(
            driver_shift_id=shift.id,
            attendance_list=[{'worker_id': self.crew_worker.id, 'status': 'PRESENT'}],
            recorded_by=self.watcher_a,
        )
        crew_shift = CrewShift.objects.get(driver_shift=shift)
        self.assertEqual(crew_shift.watcher_shift_id, watcher_shift.id)

        client = APIClient()
        client.force_authenticate(user=self.driver_user)
        res = client.post('/api/driver/shift/end/', {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        shift.refresh_from_db()
        self.assertEqual(shift.end_reason, 'driver_ended')
        self.assertFalse(WatcherShift.objects.get(pk=watcher_shift.id).is_active)
        self.assertTrue(WatcherShift.objects.get(pk=unrelated.id).is_active)
        crew_shift.refresh_from_db()
        self.assertFalse(crew_shift.is_active)
        self.assertEqual(crew_shift.watcher_shift_id, watcher_shift.id)
        self.assertEqual(CrewAttendanceRecord.objects.filter(driver_shift=shift).count(), 1)

    def test_admin_force_end_closes_linked_watcher_and_crew_shift(self):
        watcher_shift = WatcherShift.objects.create(
            watcher=self.watcher_a, schedule=self.schedule, shift_date=timezone.localdate(), is_active=True
        )
        shift = self._start_shift()
        ShiftService.record_initial_attendance(
            driver_shift_id=shift.id,
            attendance_list=[{'worker_id': self.crew_worker.id, 'status': 'PRESENT'}],
            recorded_by=self.watcher_a,
        )
        client = APIClient()
        client.force_authenticate(user=self.admin)
        res = client.post(f'/api/driver/shift/{shift.id}/force-end/', {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        shift.refresh_from_db()
        self.assertEqual(shift.end_reason, 'admin_force_ended')
        watcher_shift.refresh_from_db()
        self.assertFalse(watcher_shift.is_active)
        self.assertFalse(CrewShift.objects.get(driver_shift=shift).is_active)

    def test_independent_starts_remain_unchanged(self):
        # DriverShift starts with no WatcherShift present and no attendance submitted -> CrewShift is NOT fabricated
        shift = self._start_shift()
        self.assertTrue(shift.is_active)
        self.assertFalse(CrewShift.objects.filter(driver_shift=shift).exists())
        self.assertEqual(CrewAttendanceRecord.objects.filter(driver_shift=shift).count(), 0)
        # Ending with no association closes the DriverShift cleanly
        ShiftService.conclude_shift_atomic(driver_shift_id=shift.id, concluded_by=self.driver_user)
        shift.refresh_from_db()
        self.assertFalse(shift.is_active)


class TruckLifecycleEndpointAuthorizationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username='authz_admin', email='authz_admin@example.com', password='pw', role='admin', is_staff=True
        )
        self.users = {
            'driver': User.objects.create_user(username='authz_driver', email='authz_driver@example.com', password='pw', role='driver'),
            'watcher': User.objects.create_user(username='authz_watcher', email='authz_watcher@example.com', password='pw', role='watcher'),
            'citizen': User.objects.create_user(username='authz_citizen', email='authz_citizen@example.com', password='pw', role='citizen'),
            'brgy_official': User.objects.create_user(username='authz_brgy', email='authz_brgy@example.com', password='pw', role='brgy_official'),
            'dumpsite': User.objects.create_user(username='authz_dump', email='authz_dump@example.com', password='pw', role='dumpsite'),
        }
        self.uncommissioned = Truck.objects.create(plate_number='AUTHZ-UNC', model='M')
        self.operational = Truck.objects.create(plate_number='AUTHZ-OPS', model='M')
        TruckService.commission_truck(self.operational, user=self.admin)

    def _urls(self):
        return [
            (f'/api/driver/trucks/{self.uncommissioned.id}/commission/', {}),
            (f'/api/driver/trucks/{self.uncommissioned.id}/reconcile-commissioning/',
             {'action': 'declare_uncommissioned', 'verification_notes': 'x'}),
            (f'/api/driver/trucks/{self.operational.id}/retire/', {'reason': 'x'}),
        ]

    def test_non_admin_roles_cannot_invoke_lifecycle_endpoints(self):
        for role, user in self.users.items():
            self.client.force_authenticate(user=user)
            for url, payload in self._urls():
                with self.subTest(role=role, url=url):
                    res = self.client.post(url, payload, format='json')
                    self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.uncommissioned.refresh_from_db()
        self.operational.refresh_from_db()
        self.assertEqual(self.uncommissioned.retirement_state, 'uncommissioned')
        self.assertEqual(self.operational.retirement_state, 'operational')

    def test_anonymous_cannot_invoke_lifecycle_endpoints(self):
        self.client.force_authenticate(user=None)
        for url, payload in self._urls():
            with self.subTest(url=url):
                res = self.client.post(url, payload, format='json')
                self.assertIn(res.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))
        self.operational.refresh_from_db()
        self.assertEqual(self.operational.retirement_state, 'operational')

    def test_non_admin_cannot_bypass_via_ordinary_crud(self):
        for role, user in self.users.items():
            self.client.force_authenticate(user=user)
            with self.subTest(role=role):
                res = self.client.patch(
                    f'/api/driver/trucks/{self.operational.id}/',
                    {'retirement_state': 'permanently_retired', 'is_retired': True},
                    format='json',
                )
                self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
                res = self.client.delete(f'/api/driver/trucks/{self.uncommissioned.id}/')
                self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Truck.objects.filter(pk=self.uncommissioned.id).exists())
        self.operational.refresh_from_db()
        self.assertFalse(self.operational.is_retired)

    def test_admin_ordinary_crud_cannot_bypass_lifecycle_services(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(
            f'/api/driver/trucks/{self.operational.id}/',
            {'retirement_state': 'permanently_retired', 'is_retired': True, 'commissioning_provenance': 'uncommissioned'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.operational.refresh_from_db()
        self.assertEqual(self.operational.retirement_state, 'operational')
        self.assertFalse(self.operational.is_retired)
        self.assertEqual(self.operational.commissioning_provenance, 'commissioned_verified')

    def test_admin_can_perform_lifecycle_operations(self):
        self.client.force_authenticate(user=self.admin)
        url_commission, _ = self._urls()[0]
        res = self.client.post(url_commission, {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        url_retire, payload = self._urls()[2]
        res = self.client.post(url_retire, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.operational.refresh_from_db()
        self.assertEqual(self.operational.retirement_state, 'permanently_retired')

    def test_service_layer_rejects_non_admin_even_if_view_bypassed(self):
        from django.core.exceptions import PermissionDenied
        with self.assertRaises(PermissionDenied):
            TruckService.retire_truck(self.operational, user=self.users['driver'])
        with self.assertRaises(PermissionDenied):
            TruckService.commission_truck(self.uncommissioned, user=self.users['watcher'])

    def test_r07_retire_truck_drains_allocation_linked_shift_and_preserves_history(self):
        from driver.models import FuelLog, TruckMaintenanceRecord, TruckOperationalHoldLog
        from dumpsite.models import DumpsiteTruckInspection

        barangay = Barangay.objects.create(name='R07 Brgy')
        dumpsite = Dumpsite.objects.create(
            name='R07 Dumpsite', barangay=barangay, latitude=13.94, longitude=121.62
        )
        team = TeamService.create_team(name='R07 Team', code='R07T')
        driver_u = self.users['driver']
        drv_worker = Worker.objects.create(employee_id='EMP-R07-D', full_name='R07 Driver', user=driver_u)
        TeamService.assign_member(team.id, drv_worker.id, 'leader', created_by=self.admin)

        sched = CollectionSchedule.objects.create(
            truck=self.operational,
            driver=driver_u,
            dumpsite=dumpsite,
            default_team=team,
            start_time=time(6, 0),
            end_time=time(14, 0),
            area='R07 Zone',
        )
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=sched.id,
            allocation_date=timezone.localdate(),
            truck_id=self.operational.id,
            team_id=team.id,
            allocated_by=self.admin,
        )
        # Active DriverShift linked solely via allocation__truck (shift.truck=None)
        alloc_shift = DriverShift.objects.create(
            driver=driver_u,
            truck=None,
            schedule=sched,
            allocation=alloc,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
        )
        insp = DumpsiteTruckInspection.objects.create(
            truck=self.operational,
            dumpsite=dumpsite,
            driver_shift=alloc_shift,
            submitted_by=self.admin,
            inspection_state='PASSED',
        )
        hold = TruckOperationalHoldLog.objects.create(
            truck=self.operational, dumpsite=dumpsite, is_active=False, reason='Historical hold'
        )
        maint = TruckMaintenanceRecord.objects.create(
            truck=self.operational, dumpsite=dumpsite, title='Historical maintenance'
        )
        fuel = FuelLog.objects.create(
            driver_shift=alloc_shift,
            truck=self.operational,
            dumpsite=dumpsite,
            driver=driver_u,
            gauge_percentage=60,
        )

        retired = TruckService.retire_truck(self.operational, user=self.admin, reason='R07 test retirement')
        self.assertEqual(retired.retirement_state, 'permanently_retired')
        self.assertTrue(retired.is_retired)

        alloc_shift.refresh_from_db()
        self.assertFalse(alloc_shift.is_active)
        self.assertEqual(alloc_shift.end_reason, 'truck_retired')
        self.assertEqual(alloc_shift.allocation_id, alloc.id)

        # All Category A historical attribution preserved
        self.assertTrue(DumpsiteTruckInspection.objects.filter(pk=insp.pk, truck=self.operational).exists())
        self.assertTrue(TruckOperationalHoldLog.objects.filter(pk=hold.pk, truck=self.operational).exists())
        self.assertTrue(TruckMaintenanceRecord.objects.filter(pk=maint.pk, truck=self.operational).exists())
        self.assertTrue(FuelLog.objects.filter(pk=fuel.pk, truck=self.operational).exists())
