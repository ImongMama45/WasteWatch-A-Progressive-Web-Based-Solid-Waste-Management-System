from datetime import time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, UserRole
from driver.allocation_service import AllocationService
from driver.models import (
    CollectionSchedule,
    CommissioningProvenance,
    DriverShift,
    FuelLog,
    MaintenanceRecordStatus,
    ScheduleTruckAllocation,
    Truck,
    TruckMaintenanceRecord,
    TruckOperationalHoldLog,
    TruckReplacementRequest,
    TruckRetirementState,
    TruckStatus,
    Worker,
    is_truck_dispatchable,
)
from driver.serializers import CollectionScheduleSerializer
from driver.team_service import TeamService
from driver.truck_service import (
    TruckHistoricalAuditService,
    TruckLifecycleConflictError,
    TruckService,
)
from dumpsite.models import Dumpsite, DumpsiteTruckInspection
from watcher.models import GarbageHotspot

User = get_user_model()


class M4TruckRecordsAndFuelTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.today = timezone.localdate()
        self.yesterday = self.today - timedelta(days=1)

        self.admin = User.objects.create_user(
            username='m4_admin',
            email='m4_admin@test.local',
            password='pw',
            role=UserRole.ADMIN,
            is_staff=False,
            full_name='M4 Role Admin',
        )
        self.op_a = User.objects.create_user(
            username='m4_op_a',
            email='m4_op_a@test.local',
            password='pw',
            role=UserRole.DUMPSITE,
            full_name='Operator A',
        )
        self.op_b = User.objects.create_user(
            username='m4_op_b',
            email='m4_op_b@test.local',
            password='pw',
            role=UserRole.DUMPSITE,
            full_name='Operator B',
        )
        self.op_unassigned = User.objects.create_user(
            username='m4_op_unassigned',
            email='m4_op_unassigned@test.local',
            password='pw',
            role=UserRole.DUMPSITE,
            full_name='Unassigned Operator',
        )
        self.driver_a = User.objects.create_user(
            username='m4_driver_a',
            email='m4_driver_a@test.local',
            password='pw',
            role=UserRole.DRIVER,
            full_name='Driver A',
        )
        self.driver_b = User.objects.create_user(
            username='m4_driver_b',
            email='m4_driver_b@test.local',
            password='pw',
            role=UserRole.DRIVER,
            full_name='Driver B',
        )
        self.citizen = User.objects.create_user(
            username='m4_citizen',
            email='m4_citizen@test.local',
            password='pw',
            role=UserRole.CITIZEN,
            full_name='Citizen User',
        )

        self.barangay = Barangay.objects.create(name='M4 Barangay')
        self.dumpsite_a = Dumpsite.objects.create(
            name='Facility A',
            barangay=self.barangay,
            latitude=13.94,
            longitude=121.62,
            operator=self.op_a,
        )
        self.dumpsite_b = Dumpsite.objects.create(
            name='Facility B',
            barangay=self.barangay,
            latitude=13.96,
            longitude=121.64,
            operator=self.op_b,
        )
        self.op_a.dumpsite = self.dumpsite_a
        self.op_a.save(update_fields=['dumpsite'])
        self.op_b.dumpsite = self.dumpsite_b
        self.op_b.save(update_fields=['dumpsite'])

        now = timezone.now()
        self.truck_a1 = Truck.objects.create(
            plate_number='M4-A101',
            model='Isuzu Elf',
            status=TruckStatus.ACTIVE,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_a2 = Truck.objects.create(
            plate_number='M4-A102',
            model='Hino 300',
            status=TruckStatus.ACTIVE,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_pool = Truck.objects.create(
            plate_number='M4-POOL1',
            model='Fuso Canter',
            status=TruckStatus.ACTIVE,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_b1 = Truck.objects.create(
            plate_number='M4-B201',
            model='Foton',
            status=TruckStatus.ACTIVE,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_retired = Truck.objects.create(
            plate_number='M4-RET9',
            model='Retired Truck',
            status=TruckStatus.INACTIVE,
            is_retired=True,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.PERMANENTLY_RETIRED,
        )
        self.truck_uncomm = Truck.objects.create(
            plate_number='M4-UNC0',
            model='Uncommissioned Truck',
            status=TruckStatus.ACTIVE,
        )

        self.truck_a1.drivers.add(self.driver_a)
        self.truck_b1.drivers.add(self.driver_b)

        self.team_a = TeamService.create_team(name='M4 Team A', code='M4-TA')
        self.team_b = TeamService.create_team(name='M4 Team B', code='M4-TB')
        self.w_drv_a = Worker.objects.create(employee_id='M4-DA', full_name='Driver A', user=self.driver_a)
        self.w_drv_b = Worker.objects.create(employee_id='M4-DB', full_name='Driver B', user=self.driver_b)
        TeamService.assign_member(self.team_a.id, self.w_drv_a.id, 'leader', created_by=self.admin)
        TeamService.assign_member(self.team_b.id, self.w_drv_b.id, 'leader', created_by=self.admin)

        self.sched_a = CollectionSchedule.objects.create(
            area='M4 Zone A',
            truck=self.truck_a1,
            driver=self.driver_a,
            dumpsite=self.dumpsite_a,
            default_team=self.team_a,
            days=self.today.strftime('%A'),
            start_time=time(6, 0),
            end_time=time(12, 0),
        )
        self.sched_b = CollectionSchedule.objects.create(
            area='M4 Zone B',
            truck=self.truck_b1,
            driver=self.driver_b,
            dumpsite=self.dumpsite_b,
            default_team=self.team_b,
            days=self.today.strftime('%A'),
            start_time=time(6, 0),
            end_time=time(12, 0),
        )

    def test_1_dumpsite_truck_inspection_driver_post_shift_and_failed_hold_only(self):
        self.truck_a1.status_reason = 'Pre-existing admin status note'
        self.truck_a1.save(update_fields=['status_reason'])

        shift_a = DriverShift.objects.create(
            driver=self.driver_a,
            truck=self.truck_a1,
            schedule=self.sched_a,
            is_active=False,
            status='end_shift',
            ended_at=timezone.now(),
        )
        shift_b = DriverShift.objects.create(
            driver=self.driver_b,
            truck=self.truck_b1,
            schedule=self.sched_b,
            is_active=False,
            status='end_shift',
            ended_at=timezone.now(),
        )

        # Driver cannot submit inspection with mismatched client truck_id (400) or another driver's shift (403)
        self.client.force_authenticate(user=self.driver_a)
        bad_spoof = self.client.post('/api/dumpsite/truck-inspections/', {
            'driver_shift_id': shift_a.id,
            'truck_id': self.truck_b1.id,
            'inspection_state': 'PASSED',
            'mechanical_condition': 'OPERATIONAL',
        }, format='json')
        self.assertEqual(bad_spoof.status_code, status.HTTP_400_BAD_REQUEST)

        bad_other = self.client.post('/api/dumpsite/truck-inspections/', {
            'driver_shift_id': shift_b.id,
            'inspection_state': 'PASSED',
            'mechanical_condition': 'OPERATIONAL',
        }, format='json')
        self.assertEqual(bad_other.status_code, status.HTTP_403_FORBIDDEN)

        # Driver submits FAILED post-shift inspection -> creates TruckOperationalHoldLog ONLY
        res_fail = self.client.post('/api/dumpsite/truck-inspections/', {
            'driver_shift_id': shift_a.id,
            'inspection_state': 'FAILED',
            'mechanical_condition': 'NEEDS_REPAIR',
            'notes': 'Hydraulic hose leak detected post-shift',
            'checklist_data': {'brakes': True, 'hydraulics': False},
        }, format='json')
        self.assertEqual(res_fail.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_fail.data['truck_id'], self.truck_a1.id)
        self.assertEqual(res_fail.data['dumpsite_id'], self.dumpsite_a.id)
        self.assertTrue(res_fail.data['hold_created'])

        self.truck_a1.refresh_from_db()
        self.assertTrue(self.truck_a1.is_operational_hold)
        self.assertEqual(self.truck_a1.hold_dumpsite_id, self.dumpsite_a.id)
        self.assertEqual(self.truck_a1.mechanical_status, 'needs_inspection')
        self.assertEqual(self.truck_a1.inspection_state, 'FAILED')
        self.assertEqual(self.truck_a1.status, TruckStatus.ACTIVE)
        self.assertEqual(self.truck_a1.status_reason, 'Pre-existing admin status note')
        self.assertFalse(self.truck_a1.is_retired)
        self.assertEqual(self.truck_a1.retirement_state, TruckRetirementState.OPERATIONAL)
        self.assertEqual(TruckMaintenanceRecord.objects.filter(truck=self.truck_a1).count(), 0)

        hold_log = TruckOperationalHoldLog.objects.get(truck=self.truck_a1, is_active=True)
        self.assertEqual(hold_log.dumpsite_id, self.dumpsite_a.id)
        self.assertEqual(hold_log.inspection_id, res_fail.data['id'])
        self.assertEqual(hold_log.placed_by_id, self.driver_a.id)

        # Scoping: Operator A sees inspection; Operator B sees none and cannot post to truck_a1
        self.client.force_authenticate(user=self.op_a)
        list_a = self.client.get('/api/dumpsite/truck-inspections/')
        self.assertEqual(list_a.status_code, status.HTTP_200_OK)
        self.assertEqual([r['id'] for r in list_a.data['results']], [res_fail.data['id']])

        self.client.force_authenticate(user=self.op_b)
        list_b = self.client.get('/api/dumpsite/truck-inspections/')
        self.assertEqual(list_b.status_code, status.HTTP_200_OK)
        self.assertEqual(list_b.data['results'], [])
        cross_post = self.client.post('/api/dumpsite/truck-inspections/', {
            'truck_id': self.truck_a1.id,
            'inspection_type': 'FACILITY',
            'inspection_state': 'PASSED',
            'mechanical_condition': 'OPERATIONAL',
        }, format='json')
        self.assertEqual(cross_post.status_code, status.HTTP_403_FORBIDDEN)

        # Admin inspecting retired truck is rejected with 409
        self.client.force_authenticate(user=self.admin)
        ret_res = self.client.post('/api/dumpsite/truck-inspections/', {
            'truck_id': self.truck_retired.id,
            'dumpsite_id': self.dumpsite_a.id,
            'inspection_type': 'FACILITY',
            'inspection_state': 'PASSED',
        }, format='json')
        self.assertEqual(ret_res.status_code, status.HTTP_409_CONFLICT)

    def test_2_operational_hold_log_list_and_cross_facility_clearance_audit(self):
        insp = DumpsiteTruckInspection.objects.create(
            truck=self.truck_a1,
            dumpsite=self.dumpsite_a,
            submitted_by=self.op_a,
            inspection_type='FACILITY',
            inspection_state='FAILED',
            mechanical_condition='NEEDS_REPAIR',
            notes='Worn brake lining',
            hold_created=True,
        )
        TruckService.update_inspection_state(
            self.truck_a1,
            user=self.op_a,
            inspection_state='FAILED',
            mechanical_condition='NEEDS_REPAIR',
            reason='Worn brake lining',
            dumpsite_id=self.dumpsite_a.id,
            inspection=insp,
        )

        # Unassigned operator denied on truck-holds
        self.client.force_authenticate(user=self.op_unassigned)
        self.assertEqual(self.client.get('/api/driver/truck-holds/').status_code, status.HTTP_403_FORBIDDEN)

        # Operator B sees 0 holds and cannot clear Operator A's hold
        self.client.force_authenticate(user=self.op_b)
        res_b = self.client.get('/api/driver/truck-holds/')
        self.assertEqual(res_b.status_code, status.HTTP_200_OK)
        self.assertEqual(res_b.data['results'], [])
        res_clear_b = self.client.post(f'/api/driver/trucks/{self.truck_a1.id}/clear-hold/', {
            'resolution_notes': 'Unauthorized cross-facility clear',
        }, format='json')
        self.assertEqual(res_clear_b.status_code, status.HTTP_403_FORBIDDEN)

        # Operator A views and clears hold, preserving TruckOperationalHoldLog audit row
        self.client.force_authenticate(user=self.op_a)
        res_a = self.client.get('/api/driver/truck-holds/?is_active=true')
        self.assertEqual(res_a.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_a.data['results']), 1)

        res_clear = self.client.post(f'/api/driver/trucks/{self.truck_a1.id}/clear-hold/', {
            'resolution_notes': 'Brake shoes replaced and road tested',
        }, format='json')
        self.assertEqual(res_clear.status_code, status.HTTP_200_OK)

        self.truck_a1.refresh_from_db()
        self.assertFalse(self.truck_a1.is_operational_hold)
        self.assertTrue(is_truck_dispatchable(self.truck_a1))

        hold_log = TruckOperationalHoldLog.objects.get(truck=self.truck_a1)
        self.assertFalse(hold_log.is_active)
        self.assertEqual(hold_log.cleared_by_id, self.op_a.id)
        self.assertIsNotNone(hold_log.cleared_at)
        self.assertEqual(hold_log.resolution_notes, 'Brake shoes replaced and road tested')

    def test_3_maintenance_records_preserve_status_reason_and_respect_active_hold(self):
        self.truck_a1.status_reason = 'Original fleet status note'
        self.truck_a1.save(update_fields=['status_reason'])

        # Place active operational hold via failed inspection
        TruckService.update_inspection_state(
            self.truck_a1,
            user=self.op_a,
            inspection_state='FAILED',
            mechanical_condition='NEEDS_REPAIR',
            reason='Steering play observed',
            dumpsite_id=self.dumpsite_a.id,
        )

        # Operator A creates scheduled maintenance record
        self.client.force_authenticate(user=self.op_a)
        create_res = self.client.post('/api/driver/maintenance-records/', {
            'truck_id': self.truck_a1.id,
            'maintenance_type': 'CORRECTIVE',
            'title': 'Steering linkage overhaul',
            'notes': 'Inspect tie rods and bushings',
            'scheduled_for': str(self.today),
            'cost': '2500.00',
            'odometer_km': '45120.50',
        }, format='json')
        self.assertEqual(create_res.status_code, status.HTTP_201_CREATED)
        rec_id = create_res.data['id']

        self.truck_a1.refresh_from_db()
        self.assertEqual(self.truck_a1.status_reason, 'Original fleet status note')
        self.assertEqual(self.truck_a1.maintenance_status, 'scheduled_maintenance')

        # Cross-facility operator cannot view, patch, start, or complete
        self.client.force_authenticate(user=self.op_b)
        self.assertEqual(self.client.get(f'/api/driver/maintenance-records/{rec_id}/').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.post(f'/api/driver/maintenance-records/{rec_id}/start/', {}, format='json').status_code, status.HTTP_404_NOT_FOUND)

        # Operator A patches, starts, and completes maintenance while hold is still active
        self.client.force_authenticate(user=self.op_a)
        patch_res = self.client.patch(f'/api/driver/maintenance-records/{rec_id}/', {
            'notes': 'Updated: tie rod ends ordered',
        }, format='json')
        self.assertEqual(patch_res.status_code, status.HTTP_200_OK)

        start_res = self.client.post(f'/api/driver/maintenance-records/{rec_id}/start/', {}, format='json')
        self.assertEqual(start_res.status_code, status.HTTP_200_OK)
        self.assertEqual(start_res.data['status'], MaintenanceRecordStatus.IN_PROGRESS)

        self.truck_a1.refresh_from_db()
        self.assertEqual(self.truck_a1.status, TruckStatus.MAINTENANCE)
        self.assertEqual(self.truck_a1.status_reason, 'Original fleet status note')

        complete_res = self.client.post(f'/api/driver/maintenance-records/{rec_id}/complete/', {
            'completion_notes': 'Replaced tie rod ends',
            'cost': '3200.00',
        }, format='json')
        self.assertEqual(complete_res.status_code, status.HTTP_200_OK)
        self.assertEqual(complete_res.data['status'], MaintenanceRecordStatus.COMPLETED)

        # CRITICAL: Hold remains active, mechanical_condition NOT set to OPERATIONAL, status_reason preserved, not retired
        self.truck_a1.refresh_from_db()
        self.assertTrue(self.truck_a1.is_operational_hold)
        self.assertEqual(self.truck_a1.mechanical_condition, 'NEEDS_REPAIR')
        self.assertEqual(self.truck_a1.mechanical_status, 'needs_inspection')
        self.assertEqual(self.truck_a1.status_reason, 'Original fleet status note')
        self.assertFalse(self.truck_a1.is_retired)
        self.assertFalse(is_truck_dispatchable(self.truck_a1))

        # Legacy record-maintenance endpoint also creates/updates TruckMaintenanceRecord & preserves status_reason
        legacy_res = self.client.post(f'/api/driver/trucks/{self.truck_a1.id}/record-maintenance/', {
            'action_type': 'schedule',
            'reason': 'Oil change follow-up',
        }, format='json')
        self.assertEqual(legacy_res.status_code, status.HTTP_200_OK)
        self.truck_a1.refresh_from_db()
        self.assertEqual(self.truck_a1.status_reason, 'Original fleet status note')
        self.assertTrue(TruckMaintenanceRecord.objects.filter(truck=self.truck_a1, title='Oil change follow-up').exists())

    def test_4_truck_scoping_tightened_past_date_vs_current_facility_and_in_use_audit_history(self):
        # Historical past-date schedule, allocation, and closed shift at Facility A
        past_sched_a = CollectionSchedule.objects.create(
            area='Old A Zone',
            truck=self.truck_pool,
            driver=self.driver_a,
            dumpsite=self.dumpsite_a,
            default_team=self.team_a,
            date=self.yesterday,
            start_time=time(6, 0),
            end_time=time(10, 0),
        )
        ScheduleTruckAllocation.objects.create(
            schedule=past_sched_a,
            allocation_date=self.yesterday,
            truck=self.truck_pool,
            team=self.team_a,
            allocated_by=self.admin,
        )
        DriverShift.objects.create(
            driver=self.driver_a,
            truck=self.truck_pool,
            schedule=past_sched_a,
            is_active=False,
            status='end_shift',
            ended_at=timezone.now() - timedelta(days=1),
        )
        self.truck_pool.last_inspected_dumpsite = self.dumpsite_a
        self.truck_pool.save(update_fields=['last_inspected_dumpsite'])

        # Now truck_pool is actively scheduled & allocated at Facility B today
        AllocationService.allocate_truck_for_schedule(
            schedule_id=self.sched_b.id,
            allocation_date=self.today,
            truck_id=self.truck_pool.id,
            team_id=self.team_b.id,
            allocated_by=self.admin,
        )

        # Operator A must NOT see or operate on truck_pool anymore
        self.client.force_authenticate(user=self.op_a)
        res_trucks_a = self.client.get('/api/driver/trucks/?paginate=false')
        self.assertEqual(res_trucks_a.status_code, status.HTTP_200_OK)
        plate_set_a = {t['plate_number'] for t in res_trucks_a.data}
        self.assertNotIn(self.truck_pool.plate_number, plate_set_a)
        self.assertIn(self.truck_a1.plate_number, plate_set_a)
        with self.assertRaises(PermissionDenied):
            TruckService.require_admin_or_facility_operator(self.op_a, truck=self.truck_pool)

        # Operator B DOES see truck_pool
        self.client.force_authenticate(user=self.op_b)
        res_trucks_b = self.client.get('/api/driver/trucks/?paginate=false')
        plate_set_b = {t['plate_number'] for t in res_trucks_b.data}
        self.assertIn(self.truck_pool.plate_number, plate_set_b)

        # in_use filter & summary KPI include IN_TRANSIT
        self.truck_a1.op_status = 'IN_TRANSIT'
        self.truck_a1.save(update_fields=['op_status'])
        self.client.force_authenticate(user=self.op_a)
        in_use_res = self.client.get('/api/driver/trucks/?lifecycle=in_use')
        self.assertEqual(in_use_res.status_code, status.HTTP_200_OK)
        self.assertEqual([t['id'] for t in in_use_res.data['results']], [self.truck_a1.id])
        self.assertEqual(in_use_res.data['summary']['in_use'], 1)

        # audit-history works without FieldError and enforces facility scoping
        TruckService.update_inspection_state(
            self.truck_a1, user=self.op_a, inspection_state='PASSED', reason='Routine check'
        )
        audit_ok = self.client.get(f'/api/driver/trucks/{self.truck_a1.id}/audit-history/')
        self.assertEqual(audit_ok.status_code, status.HTTP_200_OK)
        self.assertTrue(len(audit_ok.data) >= 1)

        self.client.force_authenticate(user=self.op_b)
        audit_cross = self.client.get(f'/api/driver/trucks/{self.truck_a1.id}/audit-history/')
        self.assertIn(audit_cross.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))

        self.client.force_authenticate(user=self.citizen)
        self.assertEqual(
            self.client.get(f'/api/driver/trucks/{self.truck_a1.id}/audit-history/').status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_5_dispatchability_guards_across_allocations_schedules_replacements_and_hotspots(self):
        # Held truck
        held_truck = Truck.objects.create(
            plate_number='M4-HELD1',
            model='Held',
            status=TruckStatus.ACTIVE,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
            is_operational_hold=True,
            hold_dumpsite=self.dumpsite_a,
            hold_reason='Inspection failure',
        )
        held_truck.drivers.add(self.driver_a)

        hotspot = GarbageHotspot.objects.create(
            name='M4 Hotspot',
            barangay=self.barangay,
            latitude=13.94,
            longitude=121.62,
        )

        # 1. AllocationService blocks held, retired, and uncommissioned trucks
        for bad_truck in (held_truck, self.truck_retired, self.truck_uncomm):
            with self.subTest(bad_truck=bad_truck.plate_number):
                with self.assertRaises(ValidationError):
                    AllocationService.allocate_truck_for_schedule(
                        schedule_id=self.sched_a.id,
                        allocation_date=self.today,
                        truck_id=bad_truck.id,
                        team_id=self.team_a.id,
                        allocated_by=self.admin,
                    )

        # Create valid allocation then try updating to held/uncommissioned truck
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.sched_a.id,
            allocation_date=self.today,
            truck_id=self.truck_a1.id,
            team_id=self.team_a.id,
            allocated_by=self.admin,
        )
        with self.assertRaises(ValidationError):
            AllocationService.update_truck_allocation(allocation_id=alloc.id, truck_id=held_truck.id)

        # 2. TruckService.replace_truck_assignment blocks held/uncommissioned/retired
        for bad_truck in (held_truck, self.truck_retired, self.truck_uncomm):
            with self.assertRaises(TruckLifecycleConflictError):
                TruckService.replace_truck_assignment(
                    self.truck_a1,
                    replacement_truck_id=bad_truck.id,
                    schedule_id=self.sched_a.id,
                    user=self.admin,
                    reason='Should fail',
                )

        # 3. CollectionScheduleSerializer blocks held/uncommissioned
        for bad_truck in (held_truck, self.truck_uncomm):
            ser = CollectionScheduleSerializer(data={
                'truck': bad_truck.id,
                'driver': self.driver_a.id,
                'days': 'Monday',
                'start_time': '08:00:00',
                'end_time': '11:00:00',
            })
            self.assertFalse(ser.is_valid())
            self.assertIn('truck', ser.errors)

        # 4. GarbageHotspotViewSet.assign_truck blocks held/uncommissioned/retired
        self.client.force_authenticate(user=self.admin)
        for bad_truck in (held_truck, self.truck_uncomm, self.truck_retired):
            res = self.client.post(
                f'/api/watcher/hotspots/{hotspot.id}/assign-truck/',
                {'truck_id': bad_truck.id},
                format='json',
            )
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_6_replacement_requests_scoping_approve_reject_and_locking(self):
        # Cross-facility request where truck_b1 happened to be last inspected at Facility A
        self.truck_b1.last_inspected_dumpsite = self.dumpsite_a
        self.truck_b1.save(update_fields=['last_inspected_dumpsite'])
        req_b = TruckReplacementRequest.objects.create(
            schedule=self.sched_b,
            truck=self.truck_b1,
            requested_by=self.driver_b,
            reason='B issue',
            status='PENDING',
        )

        # Operator A must NOT see req_b and cannot request replacement on truck_b1
        self.client.force_authenticate(user=self.op_a)
        list_a = self.client.get('/api/driver/truck-replacement-requests/')
        self.assertEqual(list_a.status_code, status.HTTP_200_OK)
        self.assertNotIn(req_b.id, [r['id'] for r in list_a.data['results']])

        cross_req = self.client.post(f'/api/driver/trucks/{self.truck_b1.id}/request-replacement/', {
            'schedule_id': self.sched_b.id,
            'reason': 'Unauthorized request',
        }, format='json')
        self.assertEqual(cross_req.status_code, status.HTTP_403_FORBIDDEN)

        # Driver A creates replacement request for sched_a
        self.client.force_authenticate(user=self.driver_a)
        req_a_res = self.client.post(f'/api/driver/trucks/{self.truck_a1.id}/request-replacement/', {
            'schedule_id': self.sched_a.id,
            'reason': 'Engine overheating',
        }, format='json')
        self.assertEqual(req_a_res.status_code, status.HTTP_201_CREATED)
        req_a_id = req_a_res.data['id']

        # Operator A cannot borrow truck_b1 (bound to Facility B) to approve Facility A request
        self.client.force_authenticate(user=self.op_a)
        borrow_b = self.client.post(f'/api/driver/truck-replacement-requests/{req_a_id}/approve/', {
            'replacement_truck_id': self.truck_b1.id,
            'resolution_notes': 'Try borrowing B truck',
        }, format='json')
        self.assertEqual(borrow_b.status_code, status.HTTP_403_FORBIDDEN)

        # Operator A approves with truck_pool -> executes replacement & marks request APPROVED
        approve_res = self.client.post(f'/api/driver/truck-replacement-requests/{req_a_id}/approve/', {
            'replacement_truck_id': self.truck_pool.id,
            'resolution_notes': 'Assigned backup pool unit',
        }, format='json')
        self.assertEqual(approve_res.status_code, status.HTTP_200_OK)
        self.assertEqual(approve_res.data['status'], 'APPROVED')
        self.assertEqual(approve_res.data['resolved_by'], self.op_a.id)
        self.assertEqual(approve_res.data['resolution_notes'], 'Assigned backup pool unit')

        # Re-approving or rejecting already-resolved request returns 409
        re_reject = self.client.post(f'/api/driver/truck-replacement-requests/{req_a_id}/reject/', {
            'resolution_notes': 'Too late',
        }, format='json')
        self.assertEqual(re_reject.status_code, status.HTTP_409_CONFLICT)

        # Operator B rejects req_b cleanly
        self.client.force_authenticate(user=self.op_b)
        reject_res = self.client.post(f'/api/driver/truck-replacement-requests/{req_b.id}/reject/', {
            'resolution_notes': 'Spare unit unavailable, reschedule',
        }, format='json')
        self.assertEqual(reject_res.status_code, status.HTTP_200_OK)
        self.assertEqual(reject_res.data['status'], 'REJECTED')

    def test_7_driver_shift_viewset_dumpsite_read_only_and_write_denial(self):
        shift_a = DriverShift.objects.create(
            driver=self.driver_a,
            truck=self.truck_a1,
            schedule=self.sched_a,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
        )
        shift_b = DriverShift.objects.create(
            driver=self.driver_b,
            truck=self.truck_b1,
            schedule=self.sched_b,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
        )

        self.client.force_authenticate(user=self.op_a)
        list_res = self.client.get('/api/driver/shift/')
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        rows = list_res.data.get('results', list_res.data) if isinstance(list_res.data, dict) else list_res.data
        self.assertEqual([r['id'] for r in rows], [shift_a.id])

        self.assertEqual(self.client.get(f'/api/driver/shift/{shift_a.id}/').status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(f'/api/driver/shift/{shift_b.id}/').status_code, status.HTTP_404_NOT_FOUND)

        # All write/start/end/phase actions reject dumpsite operator with 403
        self.assertEqual(self.client.post('/api/driver/shift/pre_start/', {'schedule_id': self.sched_a.id}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post('/api/driver/shift/start/', {'schedule_id': self.sched_a.id}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post('/api/driver/shift/end/', {'schedule_id': self.sched_a.id}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.patch(f'/api/driver/shift/{shift_a.id}/update-status/', {'status': 'end_shift'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post(f'/api/driver/shift/{shift_a.id}/extended_mode/', {}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post(f'/api/driver/shift/{shift_a.id}/force-end/', {}, format='json').status_code, status.HTTP_403_FORBIDDEN)

    def test_8_fuel_log_server_side_resolution_and_role_boundaries(self):
        alloc_a = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.sched_a.id,
            allocation_date=self.today,
            truck_id=self.truck_a1.id,
            team_id=self.team_a.id,
            allocated_by=self.admin,
        )
        shift_a = DriverShift.objects.create(
            driver=self.driver_a,
            truck=self.truck_a1,
            allocation=alloc_a,
            schedule=self.sched_a,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
        )

        # Operator and Admin cannot call submit-gauge (Driver only)
        for non_drv in (self.op_a, self.admin):
            self.client.force_authenticate(user=non_drv)
            res = self.client.post('/api/driver/fuel-logs/submit-gauge/', {
                'driver_shift_id': shift_a.id,
                'gauge_percentage': 45,
            }, format='json')
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Driver spoofed truck_id -> 400; out-of-range percentage -> 400
        self.client.force_authenticate(user=self.driver_a)
        self.assertEqual(self.client.post('/api/driver/fuel-logs/submit-gauge/', {
            'driver_shift_id': shift_a.id,
            'truck_id': self.truck_b1.id,
            'gauge_percentage': 50,
        }, format='json').status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.post('/api/driver/fuel-logs/submit-gauge/', {
            'driver_shift_id': shift_a.id,
            'gauge_percentage': 120,
        }, format='json').status_code, status.HTTP_400_BAD_REQUEST)

        # Driver valid submit-gauge resolves truck & dumpsite server-side
        gauge_res = self.client.post('/api/driver/fuel-logs/submit-gauge/', {
            'gauge_percentage': 32.5,
            'notes': 'Quarter tank remaining',
        }, format='json')
        self.assertEqual(gauge_res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(gauge_res.data['truck'], self.truck_a1.id)
        self.assertEqual(gauge_res.data['dumpsite'], self.dumpsite_a.id)
        self.assertEqual(gauge_res.data['status'], 'GAUGE_SUBMITTED')

        # Driver cannot record refill (403)
        self.assertEqual(self.client.post('/api/driver/fuel-logs/record-refill/', {
            'driver_shift_id': shift_a.id,
            'liters_added': 40,
            'fuel_cost': 2600,
            'odometer_km': 12345,
        }, format='json').status_code, status.HTTP_403_FORBIDDEN)

        # Cross-facility Operator B cannot record refill (403)
        self.client.force_authenticate(user=self.op_b)
        self.assertEqual(self.client.post('/api/driver/fuel-logs/record-refill/', {
            'driver_shift_id': shift_a.id,
            'liters_added': 40,
            'fuel_cost': 2600,
            'odometer_km': 12345,
        }, format='json').status_code, status.HTTP_403_FORBIDDEN)

        # Operator A with conflicting client truck_id -> 400
        self.client.force_authenticate(user=self.op_a)
        self.assertEqual(self.client.post('/api/driver/fuel-logs/record-refill/', {
            'driver_shift_id': shift_a.id,
            'truck_id': self.truck_b1.id,
            'liters_added': 40,
            'fuel_cost': 2600,
            'odometer_km': 12345,
        }, format='json').status_code, status.HTTP_400_BAD_REQUEST)

        # Operator A records refill -> preserves gauge_percentage & updates status
        refill_res = self.client.post('/api/driver/fuel-logs/record-refill/', {
            'driver_shift_id': shift_a.id,
            'liters_added': 42.5,
            'fuel_cost': 2850.00,
            'odometer_km': 12345.0,
            'notes': 'Full tank at facility pump',
        }, format='json')
        self.assertEqual(refill_res.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(str(refill_res.data['gauge_percentage'])), Decimal('32.50'))
        self.assertEqual(Decimal(str(refill_res.data['liters_added'])), Decimal('42.50'))
        self.assertEqual(refill_res.data['status'], 'REFILL_RECORDED')
        self.assertEqual(refill_res.data['truck'], self.truck_a1.id)
        self.assertEqual(refill_res.data['dumpsite'], self.dumpsite_a.id)

    def test_9_deletion_boundary_protects_all_4_new_models(self):
        self.client.force_authenticate(user=self.admin)

        # 1. DumpsiteTruckInspection
        t_insp = Truck.objects.create(plate_number='M4-DEL-INSP', model='M')
        DumpsiteTruckInspection.objects.create(
            truck=t_insp, dumpsite=self.dumpsite_a, submitted_by=self.admin, inspection_state='PASSED'
        )
        self.assertEqual(TruckHistoricalAuditService.get_category_a_counts(t_insp)['DumpsiteTruckInspection'], 1)
        self.assertEqual(self.client.delete(f'/api/driver/trucks/{t_insp.id}/').status_code, status.HTTP_409_CONFLICT)

        # 2. TruckOperationalHoldLog
        t_hold = Truck.objects.create(plate_number='M4-DEL-HOLD', model='M')
        TruckOperationalHoldLog.objects.create(truck=t_hold, dumpsite=self.dumpsite_a, reason='Hold')
        self.assertEqual(TruckHistoricalAuditService.get_category_a_counts(t_hold)['TruckOperationalHoldLog'], 1)
        with self.assertRaises(ProtectedError):
            with transaction.atomic():
                t_hold.delete()

        # 3. TruckMaintenanceRecord
        t_maint = Truck.objects.create(plate_number='M4-DEL-MAINT', model='M')
        TruckMaintenanceRecord.objects.create(truck=t_maint, dumpsite=self.dumpsite_a, title='Brake check')
        self.assertEqual(TruckHistoricalAuditService.get_category_a_counts(t_maint)['TruckMaintenanceRecord'], 1)
        self.assertEqual(self.client.delete(f'/api/driver/trucks/{t_maint.id}/').status_code, status.HTTP_409_CONFLICT)

        # 4. FuelLog
        t_fuel = Truck.objects.create(plate_number='M4-DEL-FUEL', model='M')
        shift = DriverShift.objects.create(driver=self.driver_a, is_active=False, ended_at=timezone.now())
        FuelLog.objects.create(
            driver_shift=shift, truck=t_fuel, dumpsite=self.dumpsite_a, driver=self.driver_a, gauge_percentage=50
        )
        self.assertEqual(TruckHistoricalAuditService.get_category_a_counts(t_fuel)['FuelLog'], 1)
        self.assertEqual(self.client.delete(f'/api/driver/trucks/{t_fuel.id}/').status_code, status.HTTP_409_CONFLICT)

    def test_10_r05_permission_hardening_empty_payloads_allocation_maintenance_and_fuellog_zero_id(self):
        alloc_a = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.sched_a.id,
            allocation_date=self.today,
            truck_id=self.truck_a1.id,
            team_id=self.team_a.id,
            allocated_by=self.admin,
        )
        shift_a = DriverShift.objects.create(
            driver=self.driver_a,
            truck=self.truck_a1,
            allocation=alloc_a,
            schedule=self.sched_a,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
        )

        # 1. Unauthorized roles AND cross-facility operator get 403 even on empty {} payloads
        truck_actions = (
            f'/api/driver/trucks/{self.truck_a1.id}/clear-hold/',
            f'/api/driver/trucks/{self.truck_a1.id}/record-maintenance/',
            f'/api/driver/trucks/{self.truck_a1.id}/update-inspection/',
            f'/api/driver/trucks/{self.truck_a1.id}/replace-truck/',
            f'/api/driver/collection-schedules/{self.sched_a.id}/allocate-truck/',
        )
        for actor in (self.citizen, self.driver_a, self.op_unassigned, self.op_b):
            self.client.force_authenticate(user=actor)
            for url in truck_actions:
                with self.subTest(actor=actor.username, url=url):
                    res = self.client.post(url, {}, format='json')
                    self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Assigned operator retains object-level access to ScheduleTruckAllocationViewSet
        #    and legacy TruckMaintenanceRecord(dumpsite=None)
        legacy_maint = TruckMaintenanceRecord.objects.create(
            truck=self.truck_a1,
            dumpsite=None,
            title='Legacy null-dumpsite maintenance',
            status=MaintenanceRecordStatus.SCHEDULED,
        )
        self.client.force_authenticate(user=self.op_a)
        self.assertEqual(
            self.client.get(f'/api/driver/schedule-truck-allocations/{alloc_a.id}/').status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.patch(
                f'/api/driver/maintenance-records/{legacy_maint.id}/',
                {'notes': 'Operator A updated null-dumpsite record'},
                format='json',
            ).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.post(
                f'/api/driver/maintenance-records/{legacy_maint.id}/complete/',
                {'completion_notes': 'Completed'},
                format='json',
            ).status_code,
            status.HTTP_200_OK,
        )

        # 3. FuelLogViewSet rejects truck_id=0 / dumpsite_id=0 with 400 and malformed query params with 400
        self.client.force_authenticate(user=self.driver_a)
        zero_truck_gauge = self.client.post('/api/driver/fuel-logs/submit-gauge/', {
            'driver_shift_id': shift_a.id,
            'truck_id': 0,
            'gauge_percentage': 50,
        }, format='json')
        self.assertEqual(zero_truck_gauge.status_code, status.HTTP_400_BAD_REQUEST)

        zero_ds_gauge = self.client.post('/api/driver/fuel-logs/submit-gauge/', {
            'driver_shift_id': shift_a.id,
            'dumpsite_id': 0,
            'gauge_percentage': 50,
        }, format='json')
        self.assertEqual(zero_ds_gauge.status_code, status.HTTP_400_BAD_REQUEST)

        self.client.force_authenticate(user=self.op_a)
        zero_truck_refill = self.client.post('/api/driver/fuel-logs/record-refill/', {
            'driver_shift_id': shift_a.id,
            'truck_id': 0,
            'liters_added': 20,
            'fuel_cost': 1200,
            'odometer_km': 5000,
        }, format='json')
        self.assertEqual(zero_truck_refill.status_code, status.HTTP_400_BAD_REQUEST)

        self.assertEqual(
            self.client.get('/api/driver/fuel-logs/?truck_id=not-an-int').status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            self.client.get('/api/driver/fuel-logs/?date_from=bad-date').status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_11_r05_fuellog_zero_driver_shift_id_returns_400(self):
        for bad_shift_id in (0, '0'):
            self.client.force_authenticate(user=self.driver_a)
            gauge_res = self.client.post('/api/driver/fuel-logs/submit-gauge/', {
                'driver_shift_id': bad_shift_id,
                'gauge_percentage': 50,
            }, format='json')
            self.assertEqual(gauge_res.status_code, status.HTTP_400_BAD_REQUEST)

            self.client.force_authenticate(user=self.op_a)
            refill_res = self.client.post('/api/driver/fuel-logs/record-refill/', {
                'driver_shift_id': bad_shift_id,
                'liters_added': 20,
                'fuel_cost': 1200,
                'odometer_km': 5000,
            }, format='json')
            self.assertEqual(refill_res.status_code, status.HTTP_400_BAD_REQUEST)

