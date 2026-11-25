from datetime import time
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User
from analytics.models import ActivityLog
from driver.models import (
    CollectionSchedule,
    CommissioningProvenance,
    DriverShift,
    ScheduleTruckAllocation,
    Truck,
    TruckRetirementState,
    Worker,
)
from driver.team_service import TeamService
from dumpsite.models import Dumpsite


class TeamFleetOperationalClosureTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.today = timezone.localdate()

        self.admin = User.objects.create_user(
            username='oc_admin', email='oc_admin@test.local', password='pw', role='admin', is_staff=True
        )
        self.op_a = User.objects.create_user(
            username='oc_op_a', email='oc_op_a@test.local', password='pw', role='dumpsite'
        )
        self.op_b = User.objects.create_user(
            username='oc_op_b', email='oc_op_b@test.local', password='pw', role='dumpsite'
        )
        self.driver = User.objects.create_user(
            username='oc_driver', email='oc_driver@test.local', password='pw', role='driver', full_name='OC Driver'
        )
        self.watcher = User.objects.create_user(
            username='oc_watcher', email='oc_watcher@test.local', password='pw', role='watcher', full_name='OC Watcher'
        )
        self.crew_user = User.objects.create_user(
            username='oc_crew', email='oc_crew@test.local', password='pw', role='citizen', employee_type='crew_member', full_name='OC Crew'
        )

        self.barangay = Barangay.objects.create(name='OC Brgy')
        self.dumpsite_a = Dumpsite.objects.create(
            name='Dumpsite A', barangay=self.barangay, latitude=13.9, longitude=121.6, operator=self.op_a
        )
        self.dumpsite_b = Dumpsite.objects.create(
            name='Dumpsite B', barangay=self.barangay, latitude=13.95, longitude=121.65, operator=self.op_b
        )

        self.truck_1 = Truck.objects.create(
            plate_number='OC-101', model='Isuzu Elf', status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(), retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_2 = Truck.objects.create(
            plate_number='OC-102', model='Hino 300', status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(), retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_b = Truck.objects.create(
            plate_number='OC-201', model='Fuso', status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(), retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_retired = Truck.objects.create(
            plate_number='OC-999', model='Retired', status='inactive', is_retired=True,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(), retirement_state=TruckRetirementState.PERMANENTLY_RETIRED,
        )

        self.team = TeamService.create_team(name='OC Team', code='OCT-1')
        self.sched_a = CollectionSchedule.objects.create(
            area='Zone A', truck=self.truck_1, driver=self.driver, dumpsite=self.dumpsite_a,
            default_team=self.team, days=self.today.strftime('%A'),
            start_time=time(6, 0), end_time=time(12, 0),
        )
        self.sched_b = CollectionSchedule.objects.create(
            area='Zone B', truck=self.truck_b, driver=self.driver, dumpsite=self.dumpsite_b,
            default_team=self.team, days=self.today.strftime('%A'),
            start_time=time(6, 0), end_time=time(12, 0),
        )

    def test_1_operator_facility_scope_and_cross_dumpsite_denial(self):
        ready_drv = User.objects.create_user(
            username='oc_ready_drv', email='oc_ready_drv@test.local', password='pw', role='driver', full_name='OC Ready Driver'
        )
        w_ready_drv = Worker.objects.create(employee_id='W-OC-RD', full_name='OC Ready Driver', user=ready_drv)
        TeamService.assign_member(self.team.id, w_ready_drv.id, 'leader', created_by=self.admin)

        self.client.force_authenticate(user=self.op_a)

        # Operator A can allocate truck to Schedule A (Dumpsite A)
        res_ok = self.client.post(f'/api/driver/collection-schedules/{self.sched_a.id}/allocate-truck/', {
            'truck_id': self.truck_1.id,
            'allocation_date': str(self.today),
        }, format='json')
        self.assertEqual(res_ok.status_code, status.HTTP_201_CREATED)

        # Operator A cannot allocate truck to Schedule B (Dumpsite B)
        res_cross = self.client.post(f'/api/driver/collection-schedules/{self.sched_b.id}/allocate-truck/', {
            'truck_id': self.truck_b.id,
            'allocation_date': str(self.today),
        }, format='json')
        self.assertEqual(res_cross.status_code, status.HTTP_403_FORBIDDEN)

        # Admin has citywide authority
        self.client.force_authenticate(user=self.admin)
        res_admin = self.client.post(f'/api/driver/collection-schedules/{self.sched_b.id}/allocate-truck/', {
            'truck_id': self.truck_b.id,
            'allocation_date': str(self.today),
        }, format='json')
        self.assertEqual(res_admin.status_code, status.HTTP_201_CREATED)

    def test_2_operator_cannot_modify_team_membership(self):
        w_crew = Worker.objects.create(employee_id='W-OC-1', full_name='OC Crew', user=self.crew_user)
        self.client.force_authenticate(user=self.op_a)
        res = self.client.post(f'/api/driver/teams/{self.team.id}/assign-member/', {
            'worker_id': w_crew.id,
            'role_in_team': 'crew',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        res_tr = self.client.post('/api/driver/teams/transfer-worker/', {
            'worker_id': w_crew.id,
            'to_team_id': self.team.id,
            'role_in_team': 'crew',
        }, format='json')
        self.assertEqual(res_tr.status_code, status.HTTP_403_FORBIDDEN)

    def test_3_operational_hold_clearing_and_separate_maintenance(self):
        self.client.force_authenticate(user=self.op_a)
        # Failed inspection places operational hold ONLY (no automatic maintenance)
        insp_res = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/update-inspection/', {
            'inspection_state': 'FAILED',
            'mechanical_condition': 'NEEDS_REPAIR',
            'reason': 'Brake warning light',
        }, format='json')
        self.assertEqual(insp_res.status_code, status.HTTP_200_OK)
        self.truck_1.refresh_from_db()
        self.assertTrue(self.truck_1.is_operational_hold)
        self.assertEqual(self.truck_1.hold_dumpsite_id, self.dumpsite_a.id)
        self.assertEqual(self.truck_1.maintenance_status, 'available')
        self.assertEqual(self.truck_1.status, 'active')

        # Cross-Dumpsite Operator B cannot clear Operator A's hold
        self.client.force_authenticate(user=self.op_b)
        cross_clear = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/clear-hold/', {
            'resolution_notes': 'Attempt from wrong facility',
        }, format='json')
        self.assertEqual(cross_clear.status_code, status.HTTP_403_FORBIDDEN)

        # Operator A clears hold with resolution notes
        self.client.force_authenticate(user=self.op_a)
        clear_res = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/clear-hold/', {
            'resolution_notes': 'Brake pads inspected and verified safe',
        }, format='json')
        self.assertEqual(clear_res.status_code, status.HTTP_200_OK)
        self.truck_1.refresh_from_db()
        self.assertFalse(self.truck_1.is_operational_hold)

        # Separate maintenance recording
        maint_res = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/record-maintenance/', {
            'action_type': 'start',
            'maintenance_status': 'under_repair',
            'reason': 'Scheduled hydraulic service',
        }, format='json')
        self.assertEqual(maint_res.status_code, status.HTTP_200_OK)
        self.truck_1.refresh_from_db()
        self.assertEqual(self.truck_1.status, 'maintenance')
        self.assertEqual(self.truck_1.maintenance_status, 'under_repair')

    def test_4_truck_replacement_authz_conflicts_and_historical_attribution(self):
        # Historical shift attributed to truck_1
        hist_shift = DriverShift.objects.create(
            driver=self.driver, truck=self.truck_1, schedule=self.sched_a,
            is_active=False, status='end_shift', ended_at=timezone.now(),
        )
        self.truck_1.drivers.add(self.driver)

        # Driver can request replacement but cannot authorize/execute it
        self.client.force_authenticate(user=self.driver)
        req_res = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/request-replacement/', {
            'schedule_id': self.sched_a.id,
            'reason': 'Flat tire',
        }, format='json')
        self.assertEqual(req_res.status_code, status.HTTP_201_CREATED)

        exec_denied = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/replace-truck/', {
            'replacement_truck_id': self.truck_2.id,
            'schedule_id': self.sched_a.id,
            'reason': 'Driver trying to self-replace',
        }, format='json')
        self.assertEqual(exec_denied.status_code, status.HTTP_403_FORBIDDEN)

        # Operator A cannot replace with retired truck (409)
        self.client.force_authenticate(user=self.op_a)
        retired_res = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/replace-truck/', {
            'replacement_truck_id': self.truck_retired.id,
            'schedule_id': self.sched_a.id,
            'reason': 'Invalid retired replacement',
        }, format='json')
        self.assertEqual(retired_res.status_code, status.HTTP_409_CONFLICT)

        # Operator A executes valid replacement with truck_2
        ok_res = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/replace-truck/', {
            'replacement_truck_id': self.truck_2.id,
            'schedule_id': self.sched_a.id,
            'effective_date': str(self.today),
            'reason': 'Mechanical backup swap',
            'transfer_drivers': True,
        }, format='json')
        self.assertEqual(ok_res.status_code, status.HTTP_200_OK)

        # Historical DriverShift.truck attribution preserved!
        hist_shift.refresh_from_db()
        self.assertEqual(hist_shift.truck_id, self.truck_1.id)
        self.assertTrue(
            ScheduleTruckAllocation.objects.filter(schedule=self.sched_a, truck=self.truck_2, allocation_date=self.today).exists()
        )
        self.assertTrue(ActivityLog.objects.filter(module='Trucks', details__contains='TRUCK_REPLACED').exists())

    def test_5_team_leader_eligibility_by_system_role(self):
        w_driver = Worker.objects.create(employee_id='W-EL-D', full_name='Elig Driver', user=self.driver)
        w_watcher = Worker.objects.create(employee_id='W-EL-W', full_name='Elig Watcher', user=self.watcher)
        w_crew = Worker.objects.create(employee_id='W-EL-C', full_name='Elig Crew', user=self.crew_user)

        self.client.force_authenticate(user=self.admin)
        # Crew user cannot be designated as Team Leader or Driver
        bad_leader = self.client.post(f'/api/driver/teams/{self.team.id}/assign-member/', {
            'worker_id': w_crew.id, 'role_in_team': 'leader',
        }, format='json')
        self.assertEqual(bad_leader.status_code, status.HTTP_400_BAD_REQUEST)

        # Watcher cannot be designated as Driver
        bad_driver = self.client.post(f'/api/driver/teams/{self.team.id}/assign-member/', {
            'worker_id': w_watcher.id, 'role_in_team': 'driver',
        }, format='json')
        self.assertEqual(bad_driver.status_code, status.HTTP_400_BAD_REQUEST)

        # Driver can be assigned as driver and changed within same team to leader without altering user.role
        ok_drv = self.client.post(f'/api/driver/teams/{self.team.id}/assign-member/', {
            'worker_id': w_driver.id, 'role_in_team': 'driver',
        }, format='json')
        self.assertEqual(ok_drv.status_code, status.HTTP_201_CREATED)

        same_team_leader = self.client.post('/api/driver/teams/transfer-worker/', {
            'worker_id': w_driver.id, 'target_team_id': self.team.id, 'new_role': 'leader',
        }, format='json')
        self.assertEqual(same_team_leader.status_code, status.HTTP_200_OK)
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.role, 'driver')

    def test_6_schedule_endpoint_anonymous_denied_and_authorized_scoped(self):
        # Anonymous rejected with 401/403
        anon = self.client.get('/api/driver/collection-schedules/?paginate=false')
        self.assertIn(anon.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

        # Citizen rejected with 403
        self.client.force_authenticate(user=self.crew_user)
        cit = self.client.get('/api/driver/collection-schedules/?paginate=false')
        self.assertEqual(cit.status_code, status.HTTP_403_FORBIDDEN)

        # Operator A sees only Dumpsite A schedules
        self.client.force_authenticate(user=self.op_a)
        op_res = self.client.get('/api/driver/collection-schedules/?paginate=false')
        self.assertEqual(op_res.status_code, status.HTTP_200_OK)
        ids = {s['id'] for s in op_res.data}
        self.assertEqual(ids, {self.sched_a.id})

        # Admin sees all schedules
        self.client.force_authenticate(user=self.admin)
        adm_res = self.client.get('/api/driver/collection-schedules/?paginate=false')
        self.assertEqual(adm_res.status_code, status.HTTP_200_OK)
        self.assertEqual({s['id'] for s in adm_res.data}, {self.sched_a.id, self.sched_b.id})

    def test_7_schedule_destroy_409_resolve_team_scoping_and_cross_facility_alloc_guard(self):
        # 1. Operator A cannot resolve_team for Schedule B (Dumpsite B)
        self.client.force_authenticate(user=self.op_a)
        res_cross_rt = self.client.get(f'/api/driver/collection-schedules/{self.sched_b.id}/resolve-team/')
        self.assertEqual(res_cross_rt.status_code, status.HTTP_404_NOT_FOUND)

        # 2. Cross-facility truck isolation: Operator A cannot allocate truck_b (on Schedule B) to Schedule A
        res_cross_truck = self.client.post(f'/api/driver/collection-schedules/{self.sched_a.id}/allocate-truck/', {
            'truck_id': self.truck_b.id,
            'allocation_date': str(self.today),
        }, format='json')
        self.assertEqual(res_cross_truck.status_code, status.HTTP_403_FORBIDDEN)

        # 3. CollectionScheduleViewSet.destroy returns 409 when allocations or shifts exist
        self.client.force_authenticate(user=self.admin)
        alloc = ScheduleTruckAllocation.objects.create(
            schedule=self.sched_a,
            allocation_date=self.today,
            truck=self.truck_1,
            team=self.team,
            allocated_by=self.admin,
        )
        res_del = self.client.delete(f'/api/driver/collection-schedules/{self.sched_a.id}/')
        self.assertEqual(res_del.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(CollectionSchedule.objects.filter(pk=self.sched_a.id).exists())
        alloc.delete()

    def test_8_replacement_request_guards_approve_reject_of_self_and_old_truck_release(self):
        import inspect
        import linecache
        linecache.clearcache()
        from driver.models import CrewShift, TruckReplacementRequest
        from driver.truck_service import TruckService
        from driver.views import TruckReplacementRequestViewSet

        # 1. Verify of=('self',) & canonical lock order in approve/reject/replace_truck_assignment
        reject_src = inspect.getsource(TruckReplacementRequestViewSet.reject)
        self.assertIn("select_for_update(of=('self',))", reject_src)

        approve_src = inspect.getsource(TruckReplacementRequestViewSet.approve)
        self.assertNotIn('TruckReplacementRequest.objects.select_for_update', approve_src)

        replace_src = inspect.getsource(TruckService.replace_truck_assignment)
        self.assertIn("TruckReplacementRequest.objects.select_for_update(of=('self',))", replace_src)
        self.assertNotIn('schedule__isnull=True', replace_src)

        # 2. request_truck_replacement rejects retired truck, invalid schedule_id, and cross-schedule spoofing
        self.client.force_authenticate(user=self.driver)
        res_retired = self.client.post(f'/api/driver/trucks/{self.truck_retired.id}/request-replacement/', {
            'reason': 'Retired truck request',
        }, format='json')
        self.assertEqual(res_retired.status_code, status.HTTP_409_CONFLICT)

        self.truck_1.drivers.add(self.driver)
        res_bad_sched = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/request-replacement/', {
            'schedule_id': 999999,
            'reason': 'Bad schedule id',
        }, format='json')
        self.assertEqual(res_bad_sched.status_code, status.HTTP_400_BAD_REQUEST)

        res_spoof = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/request-replacement/', {
            'schedule_id': self.sched_b.id,
            'reason': 'Cross-schedule spoof',
        }, format='json')
        self.assertEqual(res_spoof.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Valid replacement request approval & old_truck op_status release when idle
        ScheduleTruckAllocation.objects.create(
            schedule=self.sched_a,
            allocation_date=self.today,
            truck=self.truck_1,
            team=self.team,
            allocated_by=self.admin,
        )
        self.truck_1.op_status = 'ASSIGNED'
        self.truck_1.save(update_fields=['op_status'])

        orphan_null_req = TruckReplacementRequest.objects.create(
            truck=self.truck_1,
            schedule=None,
            requested_by=self.driver,
            reason='Unscoped request should NOT be auto-approved',
            status='PENDING',
        )
        req_res = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/request-replacement/', {
            'schedule_id': self.sched_a.id,
            'reason': 'Flat tire before dispatch',
        }, format='json')
        self.assertEqual(req_res.status_code, status.HTTP_201_CREATED)
        req_id = req_res.data['id']

        self.client.force_authenticate(user=self.op_a)
        app_res = self.client.post(f'/api/driver/truck-replacement-requests/{req_id}/approve/', {
            'replacement_truck_id': self.truck_2.id,
            'resolution_notes': 'Approved replacement',
        }, format='json')
        self.assertEqual(app_res.status_code, status.HTTP_200_OK)

        # orphan_null_req was NOT wildcard-approved
        orphan_null_req.refresh_from_db()
        self.assertEqual(orphan_null_req.status, 'PENDING')

        # old_truck reverted to AVAILABLE since no remaining active shifts or allocations >= today
        self.truck_1.refresh_from_db()
        self.assertEqual(self.truck_1.op_status, 'AVAILABLE')
        self.truck_2.refresh_from_db()
        self.assertEqual(self.truck_2.op_status, 'ASSIGNED')

        # 4. CrewShift(allocation=...) blocks replace-truck with 409
        alloc_new = ScheduleTruckAllocation.objects.get(
            schedule=self.sched_a, truck=self.truck_2, allocation_date=self.today
        )
        CrewShift.objects.create(
            allocation=alloc_new,
            schedule=self.sched_a,
            service_date=self.today,
            team=self.team,
            is_active=True,
        )
        truck_3 = Truck.objects.create(
            plate_number='OC-103', model='Fuso', status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(), retirement_state=TruckRetirementState.OPERATIONAL,
        )
        blocked_res = self.client.post(f'/api/driver/trucks/{self.truck_2.id}/replace-truck/', {
            'replacement_truck_id': truck_3.id,
            'schedule_id': self.sched_a.id,
            'reason': 'Should block on CrewShift',
        }, format='json')
        self.assertEqual(blocked_res.status_code, status.HTTP_409_CONFLICT)

    def test_replace_truck_assignment_rejects_cancelled_completed_and_queryset_uses_facility_trucks_q(self):
        import inspect
        import linecache
        linecache.clearcache()
        from driver.models import TruckReplacementRequest
        from driver.truck_service import TruckLifecycleConflictError, TruckService
        from driver.views import TruckReplacementRequestViewSet

        # 1. replace_truck_assignment rejects CANCELLED and COMPLETED schedules
        truck_alt = Truck.objects.create(
            plate_number='OC-104', model='Fuso', status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(), retirement_state=TruckRetirementState.OPERATIONAL,
        )
        for st in ('CANCELLED', 'COMPLETED'):
            self.sched_b.status = st
            self.sched_b.save(update_fields=['status'])
            with self.assertRaises(TruckLifecycleConflictError):
                TruckService.replace_truck_assignment(
                    self.truck_2,
                    replacement_truck_id=truck_alt.id,
                    schedule_id=self.sched_b.id,
                    user=self.admin,
                    effective_date=self.today,
                    reason=f'Should reject {st}',
                )
        self.sched_b.status = 'UPCOMING'
        self.sched_b.save(update_fields=['status'])

        # 2. TruckReplacementRequestViewSet.get_queryset uses TruckService.facility_trucks_q (no historical leak)
        qs_src = inspect.getsource(TruckReplacementRequestViewSet.get_queryset)
        self.assertIn('TruckService.facility_trucks_q', qs_src)

        # Reassign truck_1 from sched_a (facility A) to sched_b (facility B) and create unscoped request
        self.sched_a.truck = None
        self.sched_a.save(update_fields=['truck'])
        ScheduleTruckAllocation.objects.filter(truck=self.truck_1).delete()
        self.sched_b.truck = self.truck_1
        self.sched_b.save(update_fields=['truck'])
        reassigned_req = TruckReplacementRequest.objects.create(
            truck=self.truck_1,
            schedule=None,
            requested_by=self.driver,
            reason='Reassigned truck unscoped request',
            status='PENDING',
        )
        # Historical allocation/schedule on facility A should NOT expose reassigned_req to op_a
        self.client.force_authenticate(user=self.op_a)
        res_a = self.client.get('/api/driver/truck-replacement-requests/')
        self.assertEqual(res_a.status_code, status.HTTP_200_OK)
        rows_a = res_a.data.get('results', res_a.data) if isinstance(res_a.data, dict) else res_a.data
        self.assertNotIn(reassigned_req.id, [r['id'] for r in rows_a])

