import threading
import uuid
import unittest
from datetime import time, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, connection
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, DriverProfile
from driver.allocation_service import AllocationService
from driver.models import (
    CollectionSchedule,
    CommissioningProvenance,
    CrewAttendanceRecord,
    CrewShift,
    DriverShift,
    SanitationTeam,
    SanitationTeamMembership,
    ScheduleTeamOverride,
    ScheduleTruckAllocation,
    Truck,
    TruckCrewAssignment,
    TruckRetirementState,
    WatcherShift,
    Worker,
)
from driver.shift_service import ShiftService
from driver.team_service import ActiveShiftConflictError, TeamService
from driver.worker_service import WorkerService
from dumpsite.models import Dumpsite, WasteDelivery

User = get_user_model()


class DriverRound5B2ConflictAndPGConcurrencyTests(TransactionTestCase):
    """
    Group 8 PostgreSQL Concurrency Prep + Round 5B.2 Group 2-5 Conflict & Integrity Suite.

    - Override `_fixture_teardown` to avoid `flush` (`TRUNCATE`), which is blocked on
      PostgreSQL by `prevent_attendance_mutation()` (0042) and `prevent_roster_mutation()` (0044).
    - SQLite-compatible tests verify all Group 2-5 validation, locking wrappers, and
      HTTP 409 conflict / IntegrityError mappings.
    - `@unittest.skipUnless(connection.vendor == 'postgresql', ...)` tests exercise
      real multi-threaded PostgreSQL row locks (`select_for_update(of=('self',))`),
      barriers, and partial unique constraints.
    """

    def setUp(self):
        self.tag = uuid.uuid4().hex[:8]
        self.today = timezone.localdate()
        self.tomorrow = self.today + timedelta(days=1)
        self.yesterday = self.today - timedelta(days=1)
        self.client = APIClient()

        self.admin = User.objects.create_superuser(
            username=f'pg_adm_{self.tag}',
            email=f'pg_adm_{self.tag}@example.com',
            password='Password123!',
            role='admin',
        )
        self.watcher = User.objects.create_user(
            username=f'pg_wch_{self.tag}',
            email=f'pg_wch_{self.tag}@example.com',
            password='Password123!',
            role='watcher',
            full_name='PG Watcher',
        )
        self.driver = User.objects.create_user(
            username=f'pg_drv_{self.tag}',
            email=f'pg_drv_{self.tag}@example.com',
            password='Password123!',
            role='driver',
            full_name='PG Driver',
        )
        self.driver_2 = User.objects.create_user(
            username=f'pg_drv2_{self.tag}',
            email=f'pg_drv2_{self.tag}@example.com',
            password='Password123!',
            role='driver',
            full_name='PG Driver Two',
        )
        self.crew_user = User.objects.create_user(
            username=f'pg_crw_{self.tag}',
            email=f'pg_crw_{self.tag}@example.com',
            password='Password123!',
            role='citizen',
            employee_type='crew_member',
            full_name='PG Crew User',
        )

        self.barangay = Barangay.objects.create(name=f'PG Brgy {self.tag}')
        self.dumpsite = Dumpsite.objects.create(
            name=f'PG Dumpsite {self.tag}',
            barangay=self.barangay,
            latitude=13.9400,
            longitude=121.6200,
        )

        self.team_a = TeamService.create_team(name=f'PG Team A {self.tag}', code=f'PGA-{self.tag[:6]}')
        self.team_b = TeamService.create_team(name=f'PG Team B {self.tag}', code=f'PGB-{self.tag[:6]}')

        self.w_watcher = Worker.objects.create(
            employee_id=f'PG-W-{self.tag}', full_name='PG Watcher', user=self.watcher
        )
        self.w_driver = Worker.objects.create(
            employee_id=f'PG-D-{self.tag}', full_name='PG Driver', user=self.driver
        )
        self.w_driver_2 = Worker.objects.create(
            employee_id=f'PG-D2-{self.tag}', full_name='PG Driver Two', user=self.driver_2
        )
        self.w_crew = Worker.objects.create(
            employee_id=f'PG-C-{self.tag}', full_name='PG Crew', user=self.crew_user
        )

        TeamService.assign_member(self.team_a.id, self.w_watcher.id, 'leader', created_by=self.admin)
        TeamService.assign_member(self.team_a.id, self.w_driver.id, 'driver', created_by=self.admin)
        TeamService.assign_member(self.team_a.id, self.w_crew.id, 'crew', created_by=self.admin)
        TeamService.assign_member(self.team_b.id, self.w_driver_2.id, 'leader', created_by=self.admin)

        now = timezone.now()
        self.truck_1 = Truck.objects.create(
            plate_number=f'PG1-{self.tag[:6]}',
            model='Hino 500',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_2 = Truck.objects.create(
            plate_number=f'PG2-{self.tag[:6]}',
            model='Isuzu Elf',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )

        weekday = self.today.strftime('%A')
        self.sched_1 = CollectionSchedule.objects.create(
            area=f'PG Route 1 {self.tag}',
            truck=self.truck_1,
            driver=self.driver,
            dumpsite=self.dumpsite,
            default_team=self.team_a,
            days=weekday,
            start_time=time(7, 0),
            end_time=time(15, 0),
        )
        self.sched_1.barangays.add(self.barangay)
        self.sched_2 = CollectionSchedule.objects.create(
            area=f'PG Route 2 {self.tag}',
            truck=self.truck_2,
            driver=self.driver,
            dumpsite=self.dumpsite,
            default_team=self.team_a,
            days=weekday,
            start_time=time(16, 0),
            end_time=time(20, 0),
        )
        self.sched_2.barangays.add(self.barangay)

    def _fixture_teardown(self):
        # Trigger-safe teardown: never run `flush` (TRUNCATE), and never DELETE
        # rows in tables guarded by prevent_attendance_mutation() / prevent_roster_mutation().
        DriverShift.objects.filter(is_active=True).update(is_active=False, ended_at=timezone.now())
        CrewShift.objects.filter(is_active=True).update(is_active=False, ended_at=timezone.now())
        WatcherShift.objects.filter(is_active=True).update(is_active=False, ended_at=timezone.now())
        SanitationTeamMembership.objects.filter(is_active=True).update(is_active=False, left_at=timezone.now())
        if connection.vendor != 'postgresql':
            with connection.constraint_checks_disabled():
                WasteDelivery.objects.all().delete()
                TruckCrewAssignment.objects.all().delete()
                CrewAttendanceRecord.objects.all().delete()
                CrewShift.objects.all().delete()
                DriverShift.objects.all().delete()
                WatcherShift.objects.all().delete()
                ScheduleTruckAllocation.objects.all().delete()
                ScheduleTeamOverride.objects.all().delete()
                CollectionSchedule.objects.all().delete()
                SanitationTeamMembership.objects.all().delete()
                Worker.objects.all().delete()
                SanitationTeam.objects.all().delete()
                with connection.cursor() as cur:
                    cur.execute('DELETE FROM driver_truck_drivers')
                    cur.execute('DELETE FROM driver_truck_crew')
                    cur.execute('DELETE FROM driver_truck')
                Dumpsite.objects.all().delete()
                Barangay.objects.all().delete()
                User.objects.all().delete()

    # ------------------------------------------------------------------
    # Group 2 & 3: Worker / Membership / Accounts / Merge Guards
    # ------------------------------------------------------------------

    def test_group2_and_group3_eligibility_accounts_and_merge_guards(self):
        # 1. WorkerService.create_worker rejects PROV- unless allow_provisional=True
        with self.assertRaises(ValidationError):
            WorkerService.create_worker(employee_id=f'PROV-{self.tag}', full_name='Bad Prov')

        # Rejects inactive linked user and ineligible role (plain citizen without crew_member)
        inactive_drv = User.objects.create_user(
            username=f'pg_inact_{self.tag}',
            email=f'pg_inact_{self.tag}@example.com',
            password='pw',
            role='driver',
            is_active=False,
        )
        with self.assertRaises(ValidationError):
            WorkerService.create_worker(
                employee_id=f'PG-INACT-{self.tag}', full_name='Inactive User', user=inactive_drv
            )

        plain_cit = User.objects.create_user(
            username=f'pg_cit_{self.tag}',
            email=f'pg_cit_{self.tag}@example.com',
            password='pw',
            role='citizen',
        )
        with self.assertRaises(ValidationError):
            WorkerService.create_worker(
                employee_id=f'PG-CIT-{self.tag}', full_name='Plain Citizen', user=plain_cit
            )

        # 2. BarangayManagementViewSet.assign_personnel blocks role mutation during active shift or active incompatible membership (409)
        self.client.force_authenticate(user=self.admin)
        res_mem_conflict = self.client.patch(
            f'/api/accounts/barangay-management/{self.barangay.id}/assign-personnel/',
            {'user_id': self.driver.id, 'role': 'watcher'},
            format='json',
        )
        self.assertEqual(res_mem_conflict.status_code, status.HTTP_409_CONFLICT)

        # Active shift also blocks even compatible role changes via assign_personnel
        ds = DriverShift.objects.create(
            driver=self.driver, truck=self.truck_1, schedule=self.sched_1, is_active=True
        )
        res_shift_conflict = self.client.patch(
            f'/api/accounts/barangay-management/{self.barangay.id}/assign-personnel/',
            {'user_id': self.driver.id, 'role': 'watcher'},
            format='json',
        )
        self.assertEqual(res_shift_conflict.status_code, status.HTTP_409_CONFLICT)
        ds.is_active = False
        ds.save(update_fields=['is_active'])

        # 3. WorkerService.merge_workers rejects carrying active membership onto an inactive team
        inactive_team = TeamService.create_team(name=f'PG Inact Team {self.tag}', code=f'PGI-{self.tag[:5]}')
        w_src = WorkerService.create_worker(employee_id=f'PG-MSRC-{self.tag}', full_name='Merge Src')
        w_tgt = WorkerService.create_worker(employee_id=f'PG-MTGT-{self.tag}', full_name='Merge Tgt')
        TeamService.assign_member(inactive_team.id, w_src.id, 'crew', created_by=self.admin)
        SanitationTeam.objects.filter(id=inactive_team.id).update(is_active=False)

        with self.assertRaises(ValidationError):
            WorkerService.merge_workers(w_src.id, w_tgt.id, resolved_by=self.admin)

    # ------------------------------------------------------------------
    # Group 4: Allocation, Override, Default Team & TruckCrewAssignment
    # ------------------------------------------------------------------

    def test_group4_allocation_validation_past_delete_default_team_and_legacy_tca(self):
        self.client.force_authenticate(user=self.admin)

        # 1. Missing dumpsite_id rejected
        sched_no_ds = CollectionSchedule.objects.create(
            area='No Dumpsite', default_team=self.team_a, start_time=time(8, 0), end_time=time(12, 0)
        )
        with self.assertRaises(ValidationError):
            AllocationService.allocate_truck_for_schedule(
                sched_no_ds.id, self.today, self.truck_1.id, allocated_by=self.admin
            )

        # 2. Single-date schedule mismatch rejected
        sched_single = CollectionSchedule.objects.create(
            area='Single Date',
            dumpsite=self.dumpsite,
            default_team=self.team_a,
            date=self.tomorrow,
            start_time=time(8, 0),
            end_time=time(12, 0),
        )
        with self.assertRaises(ValidationError):
            AllocationService.allocate_truck_for_schedule(
                sched_single.id, self.today, self.truck_1.id, allocated_by=self.admin
            )

        # 3. Team without active non-suspended driver rejected
        team_no_drv = TeamService.create_team(name=f'No Drv {self.tag}', code=f'ND-{self.tag[:5]}')
        w_lead_only = Worker.objects.create(
            employee_id=f'PG-LO-{self.tag}',
            full_name='Lead Only',
            user=User.objects.create_user(
                username=f'pg_lo_{self.tag}',
                email=f'pg_lo_{self.tag}@example.com',
                password='pw',
                role='watcher',
            ),
        )
        TeamService.assign_member(team_no_drv.id, w_lead_only.id, 'leader', created_by=self.admin)
        sched_no_drv = CollectionSchedule.objects.create(
            area='No Driver Team Sched',
            dumpsite=self.dumpsite,
            default_team=team_no_drv,
            start_time=time(8, 0),
            end_time=time(12, 0),
        )
        with self.assertRaises(ValidationError):
            AllocationService.allocate_truck_for_schedule(
                sched_no_drv.id, self.today, self.truck_1.id, allocated_by=self.admin
            )

        # Suspended driver also rejected
        DriverProfile.objects.create(user=self.driver_2, is_suspended=True)
        sched_susp_drv = CollectionSchedule.objects.create(
            area='Suspended Driver Sched',
            dumpsite=self.dumpsite,
            default_team=self.team_b,
            start_time=time(8, 0),
            end_time=time(12, 0),
        )
        with self.assertRaises(ValidationError):
            AllocationService.allocate_truck_for_schedule(
                sched_susp_drv.id, self.today, self.truck_1.id, allocated_by=self.admin
            )

        # 4. Past-date allocation deletion rejected (409)
        past_alloc = ScheduleTruckAllocation.objects.create(
            schedule=self.sched_1, truck=self.truck_1, team=self.team_a, allocation_date=self.yesterday
        )
        res_del_past = self.client.delete(f'/api/driver/schedule-truck-allocations/{past_alloc.id}/')
        self.assertEqual(res_del_past.status_code, status.HTTP_409_CONFLICT)

        # 5. set_schedule_default_team blocked when future allocation exists (409)
        alloc_today = AllocationService.allocate_truck_for_schedule(
            self.sched_1.id, self.today, self.truck_1.id, allocated_by=self.admin
        )
        res_def_team = self.client.post(
            f'/api/driver/collection-schedules/{self.sched_1.id}/set-default-team/',
            {'team_id': self.team_b.id},
            format='json',
        )
        self.assertEqual(res_def_team.status_code, status.HTTP_409_CONFLICT)

        # ScheduleTeamOverrideViewSet.create returns 409 when allocation exists on date
        ScheduleTeamOverride.objects.create(
            schedule=self.sched_1, team=self.team_a, effective_date=self.today, created_by=self.admin
        )
        res_ov_conflict = self.client.post(
            '/api/driver/schedule-team-overrides/',
            {'schedule': self.sched_1.id, 'team': self.team_b.id, 'effective_date': str(self.today)},
            format='json',
        )
        self.assertEqual(res_ov_conflict.status_code, status.HTTP_409_CONFLICT)

        # 6. Legacy TruckCrewAssignment serializer barangay_name & active DriverShift / WasteDelivery guards
        res_tca = self.client.post(
            '/api/driver/crew-assignments/',
            {
                'truck': self.truck_2.id,
                'driver': self.driver.id,
                'schedule': self.sched_1.id,
                'date': str(self.today),
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(res_tca.status_code, status.HTTP_201_CREATED)
        self.assertIn(self.barangay.name, res_tca.data['barangay_name'])
        tca_id = res_tca.data['id']

        ds = DriverShift.objects.create(
            driver=self.driver, truck=self.truck_2, schedule=self.sched_1, is_active=True
        )
        self.assertEqual(
            self.client.patch(f'/api/driver/crew-assignments/{tca_id}/', {'notes': 'edit'}, format='json').status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(
            self.client.delete(f'/api/driver/crew-assignments/{tca_id}/').status_code,
            status.HTTP_409_CONFLICT,
        )
        ds.is_active = False
        ds.save(update_fields=['is_active'])

        WasteDelivery.objects.create(
            truck=self.truck_2,
            driver=self.driver,
            dumpsite=self.dumpsite,
            schedule=self.sched_1,
            crew_assignment_id=tca_id,
            date=self.today,
            estimated_kg=500,
        )
        self.assertEqual(
            self.client.delete(f'/api/driver/crew-assignments/{tca_id}/').status_code,
            status.HTTP_409_CONFLICT,
        )
        alloc_today.delete()

    # ------------------------------------------------------------------
    # Group 5: WatcherShift, CrewShift & DriverShift Guards
    # ------------------------------------------------------------------

    def test_group5_watcher_and_driver_shift_guards_and_integrity_409(self):
        # 1. WatcherShiftViewSet.start_shift rejects CANCELLED schedule (400) and IntegrityError (409)
        self.client.force_authenticate(user=self.watcher)
        self.sched_2.status = 'CANCELLED'
        self.sched_2.save(update_fields=['status'])
        res_cancel = self.client.post(
            '/api/driver/watcher-shifts/start/', {'schedule_id': self.sched_2.id}, format='json'
        )
        self.assertEqual(res_cancel.status_code, status.HTTP_400_BAD_REQUEST)
        self.sched_2.status = 'PENDING'
        self.sched_2.save(update_fields=['status'])

        with patch('driver.views.WatcherShift.objects.create', side_effect=IntegrityError('duplicate')):
            res_ws_409 = self.client.post(
                '/api/driver/watcher-shifts/start/', {'schedule_id': self.sched_1.id}, format='json'
            )
        self.assertEqual(res_ws_409.status_code, status.HTTP_409_CONFLICT)

        # 2. record_deployment_attendance rejects non-dict entries with 400 (not 500)
        AllocationService.allocate_truck_for_schedule(
            self.sched_1.id, self.today, self.truck_1.id, allocated_by=self.admin
        )
        res_bad_att = self.client.post(
            '/api/watcher/crew-attendance/deployments/{}/submit/'.format(self.sched_1.id),
            {'records': ['not-a-dict']},
            format='json',
        )
        self.assertEqual(res_bad_att.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. correct_attendance rejects inactive corrected_by user
        records, _ = ShiftService.record_deployment_attendance(
            schedule_id=self.sched_1.id,
            service_date=self.today,
            attendance_list=[{'worker_id': self.w_crew.id, 'status': 'PRESENT'}],
            recorded_by=self.watcher,
        )
        self.watcher.is_active = False
        self.watcher.save(update_fields=['is_active'])
        with self.assertRaises(PermissionDenied):
            ShiftService.correct_attendance(
                attendance_record_id=records[0].id,
                corrected_status='LATE',
                reason='Late arrival',
                corrected_by=self.watcher,
            )
        self.watcher.is_active = True
        self.watcher.save(update_fields=['is_active'])

        # 4. DriverShift IntegrityError in pre_start_shift -> 409 CONFLICT
        self.client.force_authenticate(user=self.driver)
        with patch('driver.shift_service.DriverShift.objects.create', side_effect=IntegrityError('unique_active_shift_per_driver')):
            res_ds_409 = self.client.post(
                '/api/driver/shift/pre_start/', {'schedule_id': self.sched_1.id}, format='json'
            )
        self.assertEqual(res_ds_409.status_code, status.HTTP_409_CONFLICT)

    # ------------------------------------------------------------------
    # Group 8: Real PostgreSQL Multi-Threaded Concurrency Tests
    # ------------------------------------------------------------------

    @unittest.skipUnless(connection.vendor == 'postgresql', 'Requires real PostgreSQL row locks and unique constraints')
    def test_pg_concurrent_driver_shift_start_across_schedules_no_500_and_single_active(self):
        alloc_1 = AllocationService.allocate_truck_for_schedule(
            self.sched_1.id, self.today, self.truck_1.id, allocated_by=self.admin
        )
        alloc_2 = AllocationService.allocate_truck_for_schedule(
            self.sched_2.id, self.today, self.truck_2.id, allocated_by=self.admin
        )

        barrier = threading.Barrier(2)
        results = []
        errors = []

        def worker(sched_id, alloc_id):
            connection.close()
            cli = APIClient()
            cli.force_authenticate(user=self.driver)
            barrier.wait(timeout=10)
            try:
                resp = cli.post(
                    '/api/driver/shift/pre_start/',
                    {'schedule_id': sched_id, 'allocation_id': alloc_id},
                    format='json',
                )
                results.append(resp.status_code)
            except Exception as exc:
                errors.append(exc)
            finally:
                connection.close()

        t1 = threading.Thread(target=worker, args=(self.sched_1.id, alloc_1.id))
        t2 = threading.Thread(target=worker, args=(self.sched_2.id, alloc_2.id))
        t1.start()
        t2.start()
        t1.join(timeout=15)
        t2.join(timeout=15)

        self.assertEqual(errors, [])
        self.assertEqual(sorted(results), [201, 409])
        self.assertEqual(DriverShift.objects.filter(driver=self.driver, is_active=True).count(), 1)

    @unittest.skipUnless(connection.vendor == 'postgresql', 'Requires real PostgreSQL row locks and unique constraints')
    def test_pg_concurrent_watcher_shift_start_across_schedules_single_active(self):
        barrier = threading.Barrier(2)
        results = []
        errors = []

        def worker(sched_id):
            connection.close()
            cli = APIClient()
            cli.force_authenticate(user=self.watcher)
            barrier.wait(timeout=10)
            try:
                resp = cli.post(
                    '/api/driver/watcher-shifts/start/',
                    {'schedule_id': sched_id},
                    format='json',
                )
                results.append(resp.status_code)
            except Exception as exc:
                errors.append(exc)
            finally:
                connection.close()

        t1 = threading.Thread(target=worker, args=(self.sched_1.id,))
        t2 = threading.Thread(target=worker, args=(self.sched_2.id,))
        t1.start()
        t2.start()
        t1.join(timeout=15)
        t2.join(timeout=15)

        self.assertEqual(errors, [])
        self.assertEqual(sorted(results), [201, 409])
        self.assertEqual(WatcherShift.objects.filter(watcher=self.watcher, is_active=True).count(), 1)

    @unittest.skipUnless(connection.vendor == 'postgresql', 'Requires real PostgreSQL row locks and unique constraints')
    def test_pg_concurrent_membership_transfer_and_allocation_delete_vs_shift_start(self):
        # 1. Concurrent WorkerViewSet.update + WorkerService.merge_workers (verifies of=('self',) on PG)
        w_extra = WorkerService.create_worker(employee_id=f'PG-EX-{self.tag}', full_name='PG Extra')
        w_tgt = WorkerService.create_worker(employee_id=f'PG-ET-{self.tag}', full_name='PG Extra Target')
        TeamService.assign_member(self.team_a.id, w_extra.id, 'crew', created_by=self.admin)

        barrier = threading.Barrier(2)
        statuses = []

        def transfer_a():
            connection.close()
            barrier.wait(timeout=10)
            try:
                TeamService.transfer_member(w_extra.id, self.team_b.id, 'crew', authorized_by=self.admin)
                statuses.append('ok_b')
            except (ValidationError, ActiveShiftConflictError):
                statuses.append('conflict_b')
            finally:
                connection.close()

        def merge_b():
            connection.close()
            barrier.wait(timeout=10)
            try:
                WorkerService.merge_workers(w_extra.id, w_tgt.id, resolved_by=self.admin)
                statuses.append('merged')
            except (ValidationError, ActiveShiftConflictError):
                statuses.append('conflict_merge')
            finally:
                connection.close()

        t1 = threading.Thread(target=transfer_a)
        t2 = threading.Thread(target=merge_b)
        t1.start()
        t2.start()
        t1.join(timeout=15)
        t2.join(timeout=15)

        self.assertEqual(len(statuses), 2)
        self.assertLessEqual(
            SanitationTeamMembership.objects.filter(worker_id__in=[w_extra.id, w_tgt.id], is_active=True).count(),
            1,
        )

        # 2. Concurrent allocation delete vs DriverShift stage_and_start_shift
        alloc = AllocationService.allocate_truck_for_schedule(
            self.sched_1.id, self.today, self.truck_1.id, allocated_by=self.admin
        )
        barrier2 = threading.Barrier(2)
        race_outcomes = []

        def delete_alloc():
            connection.close()
            cli = APIClient()
            cli.force_authenticate(user=self.admin)
            barrier2.wait(timeout=10)
            resp = cli.delete(f'/api/driver/schedule-truck-allocations/{alloc.id}/')
            race_outcomes.append(('delete', resp.status_code))
            connection.close()

        def start_drv():
            connection.close()
            cli = APIClient()
            cli.force_authenticate(user=self.driver)
            barrier2.wait(timeout=10)
            resp = cli.post(
                '/api/driver/shift/pre_start/',
                {'schedule_id': self.sched_1.id, 'allocation_id': alloc.id},
                format='json',
            )
            race_outcomes.append(('start', resp.status_code))
            connection.close()

        t3 = threading.Thread(target=delete_alloc)
        t4 = threading.Thread(target=start_drv)
        t3.start()
        t4.start()
        t3.join(timeout=15)
        t4.join(timeout=15)

        outcome_map = dict(race_outcomes)
        self.assertIn(outcome_map['delete'], (204, 409))
        self.assertIn(outcome_map['start'], (201, 400))
        # Invariant: if deleted (204), no DriverShift started; if started (201), delete got 409
        if outcome_map['delete'] == 204:
            self.assertEqual(outcome_map['start'], 400)
        if outcome_map['start'] == 201:
            self.assertEqual(outcome_map['delete'], 409)
