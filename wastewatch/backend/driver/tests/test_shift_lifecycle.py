from datetime import time
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status
from django.core.exceptions import ValidationError
from accounts.models import Barangay
from dumpsite.models import Dumpsite
from watcher.models import StopValidation, StopValidationStatus
from driver.models import (
    Worker,
    Truck,
    CommissioningProvenance,
    TruckRetirementState,
    CollectionSchedule,
    DriverShift,
    WatcherShift,
    CrewShift,
    ShiftCrewRosterSnapshot,
    CrewAttendanceRecord,
    CrewAttendanceCorrection,
    UnfinishedStopReview,
)
from driver.team_service import TeamService
from driver.allocation_service import AllocationService
from driver.shift_service import ShiftService

User = get_user_model()


class ShiftLifecycleTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='shiftadmin',
            email='shiftadmin@example.com',
            password='Password123!',
            role='admin'
        )
        self.watcher_user = User.objects.create_user(
            username='shiftwatcher',
            email='shiftwatcher@example.com',
            password='Password123!',
            role='watcher'
        )
        self.driver_user = User.objects.create_user(
            username='shiftdriver',
            email='shiftdriver@example.com',
            password='Password123!',
            role='driver'
        )
        self.client.force_authenticate(user=self.watcher_user)

        self.team = TeamService.create_team(name='Team Staging', code='STAGE')
        self.watcher_worker = Worker.objects.create(
            employee_id='EMP-WCH-89',
            full_name='Watcher Leader 89',
            user=self.watcher_user
        )
        self.driver_worker = Worker.objects.create(
            employee_id='EMP-DRV-90',
            full_name='Driver Staging',
            user=self.driver_user
        )
        self.crew_worker = Worker.objects.create(
            employee_id='EMP-CREW-91',
            full_name='Crew Member 91'
        )

        TeamService.assign_member(
            team_id=self.team.id,
            worker_id=self.watcher_worker.id,
            role_in_team='leader',
            created_by=self.admin
        )
        TeamService.assign_member(
            team_id=self.team.id,
            worker_id=self.driver_worker.id,
            role_in_team='driver',
            created_by=self.admin
        )
        TeamService.assign_member(
            team_id=self.team.id,
            worker_id=self.crew_worker.id,
            role_in_team='crew',
            created_by=self.admin
        )

        self.barangay = Barangay.objects.create(name='Stage Brgy')
        self.dumpsite = Dumpsite.objects.create(
            name='Stage Dumpsite',
            barangay=self.barangay,
            latitude=13.94,
            longitude=121.62,
        )
        self.truck = Truck.objects.create(
            plate_number='TRK-STAGE-01',
            model='Isuzu Forward',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.schedule = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver_user,
            dumpsite=self.dumpsite,
            default_team=self.team,
            start_time=time(6, 0),
            end_time=time(14, 0),
            area='Zone A'
        )

        today = timezone.localdate()
        self.allocation = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id,
            allocation_date=today,
            truck_id=self.truck.id,
            team_id=self.team.id,
            allocated_by=self.admin,
        )
        self.watcher_shift = WatcherShift.objects.create(
            watcher=self.watcher_user,
            schedule=self.schedule,
            shift_date=today,
            is_active=True,
        )

        # Authoritative per-service-date StopValidation records for D-12
        self.sv1 = StopValidation.objects.create(
            schedule=self.schedule,
            stop_order=1,
            collection_date=today,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
        )
        self.sv2 = StopValidation.objects.create(
            schedule=self.schedule,
            stop_order=2,
            collection_date=today,
            current_status=StopValidationStatus.READY_FOR_COLLECTION,
        )

    def test_stage_and_start_shift(self):
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver_user,
            schedule_id=self.schedule.id,
            allocation_id=self.allocation.id,
        )

        self.assertTrue(shift.is_active)
        self.assertEqual(shift.status, 'shiftroute')
        self.assertEqual(shift.op_status, 'on_route')

        self.truck.refresh_from_db()
        self.assertEqual(self.truck.op_status, 'IN_TRANSIT')

        snapshot = ShiftCrewRosterSnapshot.objects.filter(driver_shift=shift).first()
        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot.items.count(), 3)

        # Round 5B.1 decoupled CrewShift: stage_and_start_shift does NOT fabricate CrewShift before attendance
        self.assertEqual(CrewShift.objects.filter(driver_shift=shift).count(), 0)

        # Submitting initial attendance creates and links CrewShift -> WatcherShift -> DriverShift
        ShiftService.record_initial_attendance(
            driver_shift_id=shift.id,
            attendance_list=[{'worker_id': self.crew_worker.id, 'status': 'PRESENT'}],
            recorded_by=self.watcher_user,
        )
        crew_shifts = CrewShift.objects.filter(driver_shift=shift, is_active=True)
        self.assertEqual(crew_shifts.count(), 1)
        self.assertEqual(crew_shifts.first().watcher_shift_id, self.watcher_shift.id)

    def test_attendance_immutability_and_corrections(self):
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver_user,
            schedule_id=self.schedule.id,
            allocation_id=self.allocation.id,
        )

        # 1. Record crew-only initial attendance (excluding leader/Watcher and driver)
        records = ShiftService.record_initial_attendance(
            driver_shift_id=shift.id,
            attendance_list=[
                {'worker_id': self.crew_worker.id, 'status': 'ABSENT'},
            ],
            recorded_by=self.watcher_user
        )
        self.assertEqual(len(records), 1)
        rec_crew = next(r for r in records if r.worker_id == self.crew_worker.id)
        self.assertEqual(rec_crew.status, 'ABSENT')

        # 2. Verify C1 immutability: UPDATE / DELETE rejected
        rec_crew.status = 'PRESENT'
        with self.assertRaises(ValidationError):
            rec_crew.save()

        with self.assertRaises(ValidationError):
            rec_crew.delete()

        # 3. Authorized append-only correction (C1) by Admin
        correction = ShiftService.correct_attendance(
            attendance_record_id=rec_crew.id,
            corrected_status='PRESENT',
            reason='Arrived 10 minutes late due to traffic',
            corrected_by=self.admin
        )
        self.assertEqual(correction.previous_status, 'ABSENT')
        self.assertEqual(correction.corrected_status, 'PRESENT')

        correction.reason = 'Tampered reason'
        with self.assertRaises(ValidationError):
            correction.save()

        with self.assertRaises(ValidationError):
            correction.delete()

        # 4. Check effective attendance projection
        effective = ShiftService.get_effective_shift_attendance(shift.id)
        self.assertEqual(len(effective), 1)
        crew_entry = next(e for e in effective if e['worker_id'] == self.crew_worker.id)
        self.assertEqual(crew_entry['initial_status'], 'ABSENT')
        self.assertEqual(crew_entry['effective_status'], 'PRESENT')
        self.assertTrue(crew_entry['is_corrected'])

    def test_conclude_shift_atomic_and_stop_preservation(self):
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver_user,
            schedule_id=self.schedule.id,
            allocation_id=self.allocation.id,
        )
        ShiftService.record_initial_attendance(
            driver_shift_id=shift.id,
            attendance_list=[{'worker_id': self.crew_worker.id, 'status': 'PRESENT'}],
            recorded_by=self.watcher_user,
        )

        concluded = ShiftService.conclude_shift_atomic(
            driver_shift_id=shift.id,
            concluded_by=self.admin,
            end_reason='admin_force_ended',
            end_reason_notes='breakdown',
        )
        self.assertFalse(concluded.is_active)
        self.assertEqual(concluded.status, 'end_shift')
        self.assertEqual(concluded.end_reason, 'admin_force_ended')
        self.assertEqual(concluded.end_reason_notes, 'breakdown')

        self.assertFalse(CrewShift.objects.filter(driver_shift=shift, is_active=True).exists())
        self.watcher_shift.refresh_from_db()
        self.assertFalse(self.watcher_shift.is_active)

        unfinished_reviews = UnfinishedStopReview.objects.filter(shift=shift)
        self.assertEqual(unfinished_reviews.count(), 1)
        rev = unfinished_reviews.first()
        self.assertEqual(rev.stop_order, 2)
        self.assertEqual(rev.recorded_status, StopValidationStatus.READY_FOR_COLLECTION)
        self.assertIsNone(rev.reviewed_by)
        self.assertIsNone(rev.reviewed_at)

        self.truck.refresh_from_db()
        self.assertEqual(self.truck.op_status, 'AVAILABLE')

    def test_api_shift_attendance_endpoints(self):
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver_user,
            schedule_id=self.schedule.id,
            allocation_id=self.allocation.id,
        )

        res = self.client.get(f'/api/driver/shift/{shift.id}/roster-snapshot/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data['items']), 3)

        res = self.client.post(f'/api/driver/shift/{shift.id}/attendance/', {
            'attendance': [
                {'worker_id': self.crew_worker.id, 'status': 'PRESENT'},
            ]
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(res.data), 1)

        res = self.client.get(f'/api/driver/shift/{shift.id}/attendance/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)

    def test_cleanup_stale_unlinked_watcher_shifts_closes_prior_date_predeparture_crew_shift(self):
        from datetime import timedelta
        from django.core.management import call_command

        today = timezone.localdate()
        yesterday = today - timedelta(days=1)
        # Clear setUp's active watcher_shift so this test exercises clean startup after prior-date cleanup
        self.watcher_shift.delete()

        old_ws = WatcherShift.objects.create(
            watcher=self.watcher_user,
            schedule=self.schedule,
            shift_date=yesterday,
            is_active=True,
        )
        old_cs = CrewShift.objects.create(
            watcher_shift=old_ws,
            schedule=self.schedule,
            service_date=yesterday,
            team=self.team,
            team_leader=self.watcher_user,
            is_active=True,
        )
        snap = ShiftCrewRosterSnapshot.objects.create(crew_shift=old_cs, staged_by=self.watcher_user)
        rec = CrewAttendanceRecord.objects.create(
            crew_shift=old_cs,
            worker=self.crew_worker,
            status='PRESENT',
            checked_in_by=self.watcher_user,
        )

        # Today's unlinked pre-departure CrewShift must NOT be closed
        today_sched = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver_user,
            default_team=self.team,
            start_time=time(13, 0),
            end_time=time(17, 0),
            area='Today Route',
        )
        today_cs = CrewShift.objects.create(
            schedule=today_sched,
            service_date=today,
            team=self.team,
            team_leader=self.watcher_user,
            is_active=True,
        )

        call_command('sweep_stale_shifts')

        old_cs.refresh_from_db()
        old_ws.refresh_from_db()
        today_cs.refresh_from_db()
        self.assertFalse(old_cs.is_active)
        self.assertIsNotNone(old_cs.ended_at)
        self.assertFalse(old_ws.is_active)
        self.assertEqual(old_ws.end_reason, 'stale_unlinked_cleanup')
        self.assertTrue(today_cs.is_active)
        # Immutable audit records preserved untouched
        self.assertTrue(ShiftCrewRosterSnapshot.objects.filter(pk=snap.pk).exists())
        self.assertTrue(CrewAttendanceRecord.objects.filter(pk=rec.pk).exists())

        # Watcher can now start today's WatcherShift cleanly
        today_cs.is_active = False
        today_cs.save(update_fields=['is_active'])
        self.client.force_authenticate(user=self.watcher_user)
        start_ws = self.client.post('/api/driver/watcher-shifts/start/', {'schedule_id': self.schedule.id}, format='json')
        self.assertEqual(start_ws.status_code, status.HTTP_201_CREATED)

    def test_watcher_start_shift_lock_order_and_invalid_schedule_id(self):
        import inspect
        from driver.views import WatcherShiftViewSet

        src = inspect.getsource(WatcherShiftViewSet.start_shift)
        idx_cs = src.index('CrewShift.objects.filter(')
        idx_ws = src.index("WatcherShift.objects.select_for_update(of=('self',))")
        self.assertLess(idx_cs, idx_ws)
        self.assertLess(src.index('cleanup_stale_unlinked_watcher_shifts'), src.index('with transaction.atomic():'))

        self.client.force_authenticate(user=self.watcher_user)
        for bad in ('abc', '-1', '0'):
            res = self.client.post('/api/driver/watcher-shifts/start/', {'schedule_id': bad}, format='json')
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_record_deployment_attendance_inactive_crew_and_active_shift_conflict(self):
        from driver.team_service import ActiveShiftConflictError

        today = timezone.localdate()
        inactive_crew = Worker.objects.create(
            employee_id='EMP-CREW-INACT',
            full_name='Inactive Crew',
            is_active=False,
        )
        # Bypass service to force an inactive worker membership row
        from driver.models import SanitationTeamMembership
        SanitationTeamMembership.objects.create(
            team=self.team,
            worker=inactive_crew,
            role_in_team='crew',
            is_active=True,
            created_by=self.admin,
        )

        # Submitting attendance for inactive_crew fails because inactive workers are filtered out of expected roster
        with self.assertRaises(ValidationError):
            ShiftService.record_deployment_attendance(
                schedule_id=self.schedule.id,
                service_date=today,
                allocation_id=self.allocation.id,
                attendance_list=[
                    {'worker_id': self.crew_worker.id, 'status': 'PRESENT'},
                    {'worker_id': inactive_crew.id, 'status': 'PRESENT'},
                ],
                recorded_by=self.watcher_user,
            )

        # Putting crew_worker on another active CrewShift triggers ActiveShiftConflictError
        other_team = TeamService.create_team(name='Other Stage Team', code='STG-2')
        other_cs = CrewShift.objects.create(team=other_team, service_date=today, is_active=True)
        other_snap = ShiftCrewRosterSnapshot.objects.create(crew_shift=other_cs, staged_by=self.admin)
        from driver.models import ShiftCrewRosterItem
        ShiftCrewRosterItem.objects.create(
            snapshot=other_snap, worker=self.crew_worker, role_in_roster='crew', is_present=True
        )
        with self.assertRaises(ActiveShiftConflictError):
            ShiftService.record_deployment_attendance(
                schedule_id=self.schedule.id,
                service_date=today,
                allocation_id=self.allocation.id,
                attendance_list=[{'worker_id': self.crew_worker.id, 'status': 'PRESENT'}],
                recorded_by=self.watcher_user,
            )

    def test_my_team_roster_and_watcher_detail_filter_inactive_workers_and_users(self):
        today = timezone.localdate()
        inactive_worker = Worker.objects.create(
            employee_id='EMP-ROST-INACT-W',
            full_name='Inactive Roster Worker',
        )
        TeamService.assign_member(self.team.id, inactive_worker.id, 'crew', created_by=self.admin)
        Worker.objects.filter(pk=inactive_worker.id).update(is_active=False)

        deactivated_user = User.objects.create_user(
            username='deact_crew_u',
            email='deact_crew_u@example.com',
            password='Password123!',
            role='citizen',
            employee_type='crew_member',
        )
        inactive_user_worker = Worker.objects.create(
            employee_id='EMP-ROST-INACT-U',
            full_name='Inactive User Worker',
            user=deactivated_user,
        )
        TeamService.assign_member(self.team.id, inactive_user_worker.id, 'crew', created_by=self.admin)
        User.objects.filter(pk=deactivated_user.id).update(is_active=False)

        self.client.force_authenticate(user=self.driver_user)
        roster_res = self.client.get(
            f'/api/driver/shift/my_team_roster/?schedule_id={self.schedule.id}&date={today.isoformat()}'
        )
        self.assertEqual(roster_res.status_code, status.HTTP_200_OK)
        returned_ids = {m['worker_id'] for m in roster_res.data['crew_members']}
        self.assertIn(self.crew_worker.id, returned_ids)
        self.assertNotIn(inactive_worker.id, returned_ids)
        self.assertNotIn(inactive_user_worker.id, returned_ids)

        from watcher.views import _build_watcher_deployment_detail
        from driver.team_service import resolve_deployment_team_leader
        leader_res = resolve_deployment_team_leader(self.schedule, service_date=today)
        detail = _build_watcher_deployment_detail(self.schedule, self.allocation, today, leader_res)
        detail_ids = {m['worker_id'] for m in detail['roster']}
        self.assertIn(self.crew_worker.id, detail_ids)
        self.assertNotIn(inactive_worker.id, detail_ids)
        self.assertNotIn(inactive_user_worker.id, detail_ids)

    def test_r01_conclude_shift_lock_order_truck_before_shift_and_null_truck_edge(self):
        import inspect
        import linecache
        from driver.views import DriverShiftViewSet
        from driver.truck_service import TruckService
        from dumpsite.inspection_views import DumpsiteTruckInspectionViewSet

        linecache.clearcache()
        conclude_src = inspect.getsource(ShiftService.conclude_shift_atomic)
        self.assertLess(
            conclude_src.index('Truck.objects.filter('),
            conclude_src.index('DriverShift.objects.select_related('),
        )
        self.assertLess(
            conclude_src.index('DriverShift.objects.select_related('),
            conclude_src.index('CrewShift.objects.filter(crew_filter).select_for_update()'),
        )
        self.assertNotIn('Truck.objects.filter(id=shift.truck_id).select_for_update()', conclude_src)

        end_src = inspect.getsource(DriverShiftViewSet.end_shift)
        self.assertLess(
            end_src.index('Truck.objects.filter('),
            end_src.index("DriverShift.objects.select_for_update(of=('self',))"),
        )

        retire_src = inspect.getsource(TruckService.retire_truck)
        self.assertNotIn('DriverShift.objects.select_for_update()', retire_src)

        insp_src = inspect.getsource(DumpsiteTruckInspectionViewSet.create)
        self.assertLess(
            insp_src.index('Truck.objects.select_for_update()'),
            insp_src.index("DriverShift.objects.select_for_update(of=('self',))"),
        )

        # Null-truck shift concludes cleanly without errors
        null_shift = DriverShift.objects.create(
            driver=self.driver_user,
            truck=None,
            schedule=self.schedule,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
        )
        concluded_null = ShiftService.conclude_shift_atomic(
            driver_shift_id=null_shift.id,
            concluded_by=self.admin,
            end_reason='completed',
        )
        self.assertFalse(concluded_null.is_active)
        self.assertEqual(concluded_null.end_reason, 'completed')

    def test_r03_stale_truck_shift_swept_on_current_prestart_and_start(self):
        from datetime import timedelta
        from driver.models import ScheduleTeamOverride

        co_driver = User.objects.create_user(
            username='shift_codriver',
            email='shift_codriver@example.com',
            password='Password123!',
            role='driver',
        )
        co_worker = Worker.objects.create(
            employee_id='EMP-DRV-CO',
            full_name='Co Driver',
            user=co_driver,
        )
        team_b = TeamService.create_team(name='Team CoDriver', code='CODE-B')
        TeamService.assign_member(
            team_id=team_b.id,
            worker_id=co_worker.id,
            role_in_team='leader',
            created_by=self.admin,
        )
        today = timezone.localdate()
        ScheduleTeamOverride.objects.create(
            schedule=self.schedule,
            effective_date=today,
            team=team_b,
            reason='Co-driver takeover for stale shift sweep test',
            created_by=self.admin,
        )
        self.allocation.team = team_b
        self.allocation.save(update_fields=['team'])

        stale_time = timezone.now() - timedelta(hours=25)

        # 1. Stale (>6h) shift on truck owned by driver_user is swept on co_driver's GET /current/
        stale_shift_1 = DriverShift.objects.create(
            driver=self.driver_user,
            truck=self.truck,
            schedule=self.schedule,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
        )
        DriverShift.objects.filter(pk=stale_shift_1.pk).update(
            started_at=stale_time,
            last_location_update=stale_time,
        )

        self.client.force_authenticate(user=co_driver)
        cur_res = self.client.get('/api/driver/shift/current/')
        self.assertEqual(cur_res.status_code, status.HTTP_200_OK)
        self.assertTrue(cur_res.data['can_start_shift'])
        stale_shift_1.refresh_from_db()
        self.assertFalse(stale_shift_1.is_active)
        self.assertEqual(stale_shift_1.end_reason, 'heartbeat_timeout')

        # 2. Stale (>6h) shift on truck is swept on POST /pre_start/ (no 409)
        stale_shift_2 = DriverShift.objects.create(
            driver=self.driver_user,
            truck=self.truck,
            schedule=self.schedule,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
        )
        DriverShift.objects.filter(pk=stale_shift_2.pk).update(
            started_at=stale_time,
            last_location_update=stale_time,
        )
        pre_res = self.client.post(
            '/api/driver/shift/pre_start/',
            {'schedule_id': self.schedule.id, 'allocation_id': self.allocation.id},
            format='json',
        )
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED, pre_res.data)
        stale_shift_2.refresh_from_db()
        self.assertFalse(stale_shift_2.is_active)
        self.assertEqual(stale_shift_2.end_reason, 'heartbeat_timeout')

        # End co_driver's pre-start shift via heartbeat_timeout, then test POST /start/ with fresh vs stale shift on truck_2
        ShiftService.conclude_shift_atomic(pre_res.data['id'], self.admin, end_reason='heartbeat_timeout')
        self.schedule.is_available = False
        self.schedule.save(update_fields=['is_available'])
        truck_2 = Truck.objects.create(
            plate_number='TRK-STAGE-02',
            model='Isuzu Elf',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        sched_2 = CollectionSchedule.objects.create(
            truck=truck_2,
            driver=co_driver,
            dumpsite=self.dumpsite,
            default_team=team_b,
            start_time=time(0, 1),
            end_time=time(23, 59),
            area='Zone B',
        )
        alloc_2 = AllocationService.allocate_truck_for_schedule(
            schedule_id=sched_2.id,
            allocation_date=today,
            truck_id=truck_2.id,
            team_id=team_b.id,
            allocated_by=self.admin,
        )

        fresh_shift = DriverShift.objects.create(
            driver=self.driver_user,
            truck=truck_2,
            schedule=sched_2,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
            last_location_update=timezone.now() - timedelta(hours=1),
        )
        cur_blocked = self.client.get('/api/driver/shift/current/')
        self.assertEqual(cur_blocked.status_code, status.HTTP_200_OK)
        self.assertFalse(cur_blocked.data['can_start_shift'])
        self.assertEqual(cur_blocked.data['block_reason'], 'truck_in_use')
        start_blocked = self.client.post(
            '/api/driver/shift/start/',
            {'schedule_id': sched_2.id, 'allocation_id': alloc_2.id},
            format='json',
        )
        self.assertEqual(start_blocked.status_code, status.HTTP_409_CONFLICT)
        fresh_shift.refresh_from_db()
        self.assertTrue(fresh_shift.is_active)

        # 3. Stale (>6h) shift on truck is swept on POST /start/
        DriverShift.objects.filter(pk=fresh_shift.pk).update(
            started_at=stale_time,
            last_location_update=stale_time,
        )
        start_ok = self.client.post(
            '/api/driver/shift/start/',
            {'schedule_id': sched_2.id, 'allocation_id': alloc_2.id},
            format='json',
        )
        self.assertEqual(start_ok.status_code, status.HTTP_201_CREATED, start_ok.data)
        fresh_shift.refresh_from_db()
        self.assertFalse(fresh_shift.is_active)
        self.assertEqual(fresh_shift.end_reason, 'heartbeat_timeout')

    def test_r03_allocation_truck_only_active_shift_blocks_prestart_and_start(self):
        from datetime import timedelta
        from django.db.models import Q
        from driver.models import ScheduleTruckAllocation

        today = timezone.localdate()
        yesterday = today - timedelta(days=1)

        truck_r03 = Truck.objects.create(
            plate_number='TRK-R03-ALLOC',
            model='Isuzu Giga',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        alloc_a_yesterday = ScheduleTruckAllocation.objects.create(
            schedule=self.schedule,
            allocation_date=yesterday,
            truck=truck_r03,
            team=self.team,
            allocated_by=self.admin,
        )
        # Driver A has an active <6h shift with truck=None and allocation__truck=truck_r03
        DriverShift.objects.create(
            driver=self.driver_user,
            truck=None,
            schedule=self.schedule,
            allocation=alloc_a_yesterday,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
            last_location_update=timezone.now() - timedelta(hours=1),
        )

        # Driver B holds today's allocation on the same physical truck_r03
        driver_b = User.objects.create_user(
            username='shift_driver_b_r03',
            email='shift_driver_b_r03@example.com',
            password='Password123!',
            role='driver',
        )
        worker_b = Worker.objects.create(
            employee_id='EMP-DRV-R03-B',
            full_name='Driver B R03',
            user=driver_b,
        )
        team_b = TeamService.create_team(name='Team R03 B', code='R03-B')
        TeamService.assign_member(
            team_id=team_b.id,
            worker_id=worker_b.id,
            role_in_team='leader',
            created_by=self.admin,
        )
        sched_b = CollectionSchedule.objects.create(
            truck=truck_r03,
            driver=driver_b,
            dumpsite=self.dumpsite,
            default_team=team_b,
            start_time=time(0, 1),
            end_time=time(23, 59),
            area='Zone R03 B',
        )
        alloc_b = AllocationService.allocate_truck_for_schedule(
            schedule_id=sched_b.id,
            allocation_date=today,
            truck_id=truck_r03.id,
            team_id=team_b.id,
            allocated_by=self.admin,
        )

        self.client.force_authenticate(user=driver_b)

        cur_res = self.client.get('/api/driver/shift/current/')
        self.assertEqual(cur_res.status_code, status.HTTP_200_OK)
        self.assertFalse(cur_res.data['can_start_shift'])
        self.assertEqual(cur_res.data['block_reason'], 'truck_in_use')

        pre_res = self.client.post(
            '/api/driver/shift/pre_start/',
            {'schedule_id': sched_b.id, 'allocation_id': alloc_b.id},
            format='json',
        )
        self.assertEqual(pre_res.status_code, status.HTTP_409_CONFLICT, pre_res.data)

        start_res = self.client.post(
            '/api/driver/shift/start/',
            {'schedule_id': sched_b.id, 'allocation_id': alloc_b.id},
            format='json',
        )
        self.assertEqual(start_res.status_code, status.HTTP_409_CONFLICT, start_res.data)

        active_count = DriverShift.objects.filter(
            Q(truck=truck_r03) | Q(allocation__truck=truck_r03),
            is_active=True,
        ).count()
        self.assertEqual(active_count, 1)

