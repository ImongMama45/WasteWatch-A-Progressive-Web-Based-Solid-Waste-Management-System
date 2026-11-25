from datetime import time, timedelta
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError, PermissionDenied
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status
from accounts.models import Barangay
from dumpsite.models import Dumpsite
from watcher.models import StopValidation, StopValidationStatus
from driver.models import (
    Worker,
    SanitationTeam,
    SanitationTeamMembership,
    Truck,
    CommissioningProvenance,
    TruckRetirementState,
    CollectionSchedule,
    ScheduleTruckAllocation,
    DriverShift,
    WatcherShift,
    CrewShift,
    ShiftCrewRosterSnapshot,
    UnfinishedStopReview,
    MissedStop,
    MissedStopReason,
)
from driver.serializers import CollectionScheduleSerializer
from driver.team_service import TeamService, ActiveShiftConflictError
from driver.allocation_service import AllocationService
from driver.shift_service import ShiftService

User = get_user_model()


class CriticalInvariantsRound2TestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='r2_admin',
            email='r2_admin@example.com',
            password='Password123!',
            role='admin',
        )
        self.watcher = User.objects.create_user(
            username='r2_watcher',
            email='r2_watcher@example.com',
            password='Password123!',
            role='watcher',
        )
        self.other_watcher = User.objects.create_user(
            username='r2_watcher_2',
            email='r2_watcher_2@example.com',
            password='Password123!',
            role='watcher',
        )
        self.driver = User.objects.create_user(
            username='r2_driver',
            email='r2_driver@example.com',
            password='Password123!',
            role='driver',
        )
        self.driver_2 = User.objects.create_user(
            username='r2_driver_2',
            email='r2_driver_2@example.com',
            password='Password123!',
            role='driver',
        )
        self.citizen = User.objects.create_user(
            username='r2_citizen',
            email='r2_citizen@example.com',
            password='Password123!',
            role='citizen',
        )

        self.team_a = TeamService.create_team(name='Round2 Team A', code='R2-A')
        self.team_b = TeamService.create_team(name='Round2 Team B', code='R2-B')

        self.watcher_worker = Worker.objects.create(
            employee_id='EMP-R2-W1',
            full_name='Round2 Watcher One',
            user=self.watcher,
        )
        self.other_watcher_worker = Worker.objects.create(
            employee_id='EMP-R2-W2',
            full_name='Round2 Watcher Two',
            user=self.other_watcher,
        )
        self.driver_worker = Worker.objects.create(
            employee_id='EMP-R2-D1',
            full_name='Round2 Driver One',
            user=self.driver,
        )
        self.collector_1 = Worker.objects.create(
            employee_id='EMP-R2-C1',
            full_name='Round2 Collector One',
        )
        self.collector_2 = Worker.objects.create(
            employee_id='EMP-R2-C2',
            full_name='Round2 Collector Two',
        )
        self.external_worker = Worker.objects.create(
            employee_id='EMP-R2-EXT',
            full_name='External Worker',
        )

        TeamService.assign_member(self.team_a.id, self.watcher_worker.id, 'leader', self.admin)
        TeamService.assign_member(self.team_a.id, self.driver_worker.id, 'driver', self.admin)
        TeamService.assign_member(self.team_a.id, self.collector_1.id, 'crew', self.admin)
        TeamService.assign_member(self.team_a.id, self.collector_2.id, 'crew', self.admin)
        TeamService.assign_member(self.team_b.id, self.other_watcher_worker.id, 'leader', self.admin)

        now = timezone.now()
        self.truck_1 = Truck.objects.create(
            plate_number='R2-TRK-01',
            model='Hino',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_2 = Truck.objects.create(
            plate_number='R2-TRK-02',
            model='Isuzu',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )

        self.barangay = Barangay.objects.create(name='Round2 Brgy')
        self.dumpsite = Dumpsite.objects.create(
            name='Round2 Dumpsite',
            barangay=self.barangay,
            latitude=13.94,
            longitude=121.62,
        )

        self.schedule = CollectionSchedule.objects.create(
            truck=self.truck_1,
            driver=self.driver,
            dumpsite=self.dumpsite,
            default_team=self.team_a,
            start_time=time(7, 0),
            end_time=time(15, 0),
            area='Round2 Zone A',
        )
        self.other_schedule = CollectionSchedule.objects.create(
            truck=self.truck_2,
            driver=self.driver_2,
            dumpsite=self.dumpsite,
            default_team=self.team_b,
            start_time=time(7, 0),
            end_time=time(15, 0),
            area='Round2 Zone B',
        )

    def test_1_watcher_only_initial_attendance_completeness_and_retry_safety(self):
        today = timezone.localdate()
        alloc = AllocationService.allocate_truck_for_schedule(
            self.schedule.id, today, self.truck_1.id, allocated_by=self.admin
        )
        WatcherShift.objects.create(
            watcher=self.watcher, schedule=self.schedule, shift_date=today, is_active=True
        )
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver, schedule_id=self.schedule.id, allocation_id=alloc.id
        )

        crew_payload = [
            {'worker_id': self.collector_1.id, 'status': 'PRESENT'},
            {'worker_id': self.collector_2.id, 'status': 'ABSENT'},
        ]

        # Admin, Driver, unrelated Watcher, and Citizen are all rejected for initial submission
        for unauthorized in (self.admin, self.driver, self.other_watcher, self.citizen):
            self.client.force_authenticate(user=unauthorized)
            res = self.client.post(f'/api/driver/shift/{shift.id}/attendance/', {
                'attendance': crew_payload,
            }, format='json')
            self.assertIn(res.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))

        # Incomplete roster rejected
        self.client.force_authenticate(user=self.watcher)
        res = self.client.post(f'/api/driver/shift/{shift.id}/attendance/', {
            'attendance': [crew_payload[0]],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Driver attendance rejected (crew-only)
        res = self.client.post(f'/api/driver/shift/{shift.id}/attendance/', {
            'attendance': crew_payload + [{'worker_id': self.driver_worker.id, 'status': 'PRESENT'}],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # External worker rejected
        res = self.client.post(f'/api/driver/shift/{shift.id}/attendance/', {
            'attendance': crew_payload + [{'worker_id': self.external_worker.id, 'status': 'PRESENT'}],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Assigned Watcher submits complete crew attendance -> 201
        res = self.client.post(f'/api/driver/shift/{shift.id}/attendance/', {
            'attendance': crew_payload,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(res.data), 2)

        # Identical retry is idempotent (no IntegrityError, no duplicate records)
        retry_records = ShiftService.record_initial_attendance(shift.id, crew_payload, self.watcher)
        self.assertEqual(len(retry_records), 2)

        # Conflicting retry is rejected clearly
        conflicting = [
            {'worker_id': self.collector_1.id, 'status': 'ABSENT'},
            {'worker_id': self.collector_2.id, 'status': 'ABSENT'},
        ]
        with self.assertRaises(ValidationError):
            ShiftService.record_initial_attendance(shift.id, conflicting, self.watcher)

    def test_2_production_start_endpoints_require_allocation_and_watcher_independence(self):
        today = timezone.localdate()

        # Cannot start without pre-existing allocation
        self.client.force_authenticate(user=self.driver)
        res = self.client.post('/api/driver/shift/start/', {'schedule_id': self.schedule.id}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Allocate truck: DriverShift stages independently even before WatcherShift starts (R2)
        alloc = AllocationService.allocate_truck_for_schedule(
            self.schedule.id, today, self.truck_1.id, allocated_by=self.admin
        )

        # WatcherShift spoofing / unauthorized watcher rejected
        self.client.force_authenticate(user=self.other_watcher)
        res = self.client.post('/api/driver/watcher-shifts/start/', {
            'schedule_id': self.schedule.id,
            'watcher': self.watcher.id,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Driver stages via production pre_start independently of WatcherShift; CrewShift is NOT fabricated yet
        self.client.force_authenticate(user=self.driver)
        res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': self.schedule.id,
            'allocation_id': alloc.id,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        shift_id = res.data['id']

        shift = DriverShift.objects.get(id=shift_id)
        self.assertEqual(shift.allocation_id, alloc.id)
        self.assertFalse(CrewShift.objects.filter(driver_shift=shift).exists())
        self.assertTrue(ShiftCrewRosterSnapshot.objects.filter(driver_shift=shift).exists())

        # Assigned Watcher starts WatcherShift independently and submits attendance -> creates linked CrewShift
        self.client.force_authenticate(user=self.watcher)
        res = self.client.post('/api/driver/watcher-shifts/start/', {
            'schedule_id': self.schedule.id,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        att_res = self.client.post(f'/api/driver/shift/{shift.id}/attendance/', {
            'attendance': [
                {'worker_id': self.collector_1.id, 'status': 'PRESENT'},
                {'worker_id': self.collector_2.id, 'status': 'PRESENT'},
            ],
        }, format='json')
        self.assertEqual(att_res.status_code, status.HTTP_201_CREATED)
        shift.refresh_from_db()
        self.assertTrue(CrewShift.objects.filter(driver_shift=shift, is_active=True).exists())

        # WatcherShift cannot be deleted while CrewShift references it (PROTECT)
        ws = shift.crew_shift.watcher_shift
        with self.assertRaises(ProtectedError):
            ws.delete()

        # Production start transitions staged shift to on_duty
        self.client.force_authenticate(user=self.driver)
        res = self.client.post('/api/driver/shift/start/', {
            'schedule_id': self.schedule.id,
            'latitude': 13.9400,
            'longitude': 121.6200,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['op_status'], 'on_duty')

    def test_3_d12_service_date_stop_validation_review_and_admin_resolution(self):
        today = timezone.localdate()
        alloc = AllocationService.allocate_truck_for_schedule(
            self.schedule.id, today, self.truck_1.id, allocated_by=self.admin
        )
        WatcherShift.objects.create(
            watcher=self.watcher, schedule=self.schedule, shift_date=today, is_active=True
        )
        sv_done = StopValidation.objects.create(
            schedule=self.schedule, stop_order=1, collection_date=today,
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
        )
        sv_open = StopValidation.objects.create(
            schedule=self.schedule, stop_order=2, collection_date=today,
            current_status=StopValidationStatus.READY_FOR_COLLECTION,
            pre_validation_remarks='Ready at gate',
        )
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver, schedule_id=self.schedule.id, allocation_id=alloc.id
        )

        # Long free-text reason must not overflow DriverShift.end_reason (max_length=20)
        long_reason = 'Mechanical issue reported near intersection ' * 8
        self.client.force_authenticate(user=self.driver)
        res = self.client.post('/api/driver/shift/end/', {
            'schedule_id': self.schedule.id,
            'ended_early': True,
            'reason': long_reason,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        shift.refresh_from_db()
        self.assertEqual(shift.end_reason, 'driver_ended')
        self.assertEqual(len(shift.end_reason_notes), 255)

        # StopValidation statuses & evidence preserved; no SHIFT_ENDED_EARLY MissedStop
        sv_done.refresh_from_db()
        sv_open.refresh_from_db()
        self.assertEqual(sv_done.current_status, StopValidationStatus.VERIFIED_COLLECTED)
        self.assertEqual(sv_open.current_status, StopValidationStatus.READY_FOR_COLLECTION)
        self.assertEqual(sv_open.pre_validation_remarks, 'Ready at gate')
        self.assertFalse(MissedStop.objects.filter(original_schedule=self.schedule, reason=MissedStopReason.SHIFT_ENDED_EARLY).exists())

        # UnfinishedStopReview created unreviewed (reviewed_by=None)
        reviews = UnfinishedStopReview.objects.filter(shift=shift)
        self.assertEqual(reviews.count(), 1)
        rev = reviews.first()
        self.assertEqual(rev.stop_validation_id, sv_open.id)
        self.assertIsNone(rev.reviewed_by)
        self.assertEqual(rev.resolution_status, 'PENDING')

        # Admin resolves review
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(f'/api/driver/unfinished-stop-reviews/{rev.id}/resolve/', {
            'resolution_status': 'RESOLVED',
            'resolution_notes': 'Reassigned to afternoon run',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        rev.refresh_from_db()
        self.assertEqual(rev.resolution_status, 'RESOLVED')
        self.assertEqual(rev.reviewed_by_id, self.admin.id)

    def test_4_roster_immutability_and_regression_checks(self):
        today = timezone.localdate()
        alloc = AllocationService.allocate_truck_for_schedule(
            self.schedule.id, today, self.truck_1.id, allocated_by=self.admin
        )
        WatcherShift.objects.create(
            watcher=self.watcher, schedule=self.schedule, shift_date=today, is_active=True
        )
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver, schedule_id=self.schedule.id, allocation_id=alloc.id
        )

        # Roster snapshot and items are immutable
        snap = ShiftCrewRosterSnapshot.objects.get(driver_shift=shift)
        with self.assertRaises(ValidationError):
            snap.save()
        with self.assertRaises(ValidationError):
            snap.delete()
        item = snap.items.first()
        item.is_present = False
        with self.assertRaises(ValidationError):
            item.save()
        with self.assertRaises(ValidationError):
            item.delete()

        # Active worker transfer blocked while shift is active
        with self.assertRaises(ActiveShiftConflictError):
            TeamService.transfer_member(self.collector_1.id, self.team_b.id, 'crew', self.admin)

        # CollectionScheduleSerializer.get_dumpsite_detail returns None when dumpsite is None
        no_ds_sched = CollectionSchedule.objects.create(
            area='No Dumpsite Zone', start_time=time(8, 0), end_time=time(12, 0)
        )
        ser = CollectionScheduleSerializer(no_ds_sched)
        self.assertIsNone(ser.data['dumpsite_detail'])

        # Truck with PENDING_INSPECTION is NOT restored to AVAILABLE on shift end
        self.truck_1.inspection_state = 'PENDING_INSPECTION'
        self.truck_1.save(update_fields=['inspection_state'])
        ShiftService.conclude_shift_atomic(shift.id, self.admin, end_reason='completed')
        self.truck_1.refresh_from_db()
        self.assertNotEqual(self.truck_1.op_status, 'AVAILABLE')

    def test_5_allocation_and_override_viewsets_enforce_service_validation(self):
        """
        Round 3 #1: ScheduleTeamOverrideViewSet & ScheduleTruckAllocationViewSet
        must route create/update/partial_update through AllocationService.
        """
        inactive_team = SanitationTeam.objects.create(name='Inactive Team', code='INACT-01', is_active=False)
        today = timezone.localdate()
        tomorrow = today + timedelta(days=1)

        self.client.force_authenticate(user=self.admin)

        # Inactive team rejected on override POST
        res = self.client.post('/api/driver/schedule-team-overrides/', {
            'schedule': self.schedule.id,
            'team': inactive_team.id,
            'effective_date': str(tomorrow),
            'reason': 'Test inactive',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Valid override POST succeeds, then PATCH to inactive team is rejected
        res_ok = self.client.post('/api/driver/schedule-team-overrides/', {
            'schedule': self.schedule.id,
            'team': self.team_b.id,
            'effective_date': str(tomorrow),
            'reason': 'Valid override',
        }, format='json')
        self.assertEqual(res_ok.status_code, status.HTTP_201_CREATED)
        override_id = res_ok.data['id']

        res_patch_bad = self.client.patch(f'/api/driver/schedule-team-overrides/{override_id}/', {
            'team': inactive_team.id,
        }, format='json')
        self.assertEqual(res_patch_bad.status_code, status.HTTP_400_BAD_REQUEST)

        # Allocation ViewSet: inactive truck rejected on POST
        maintenance_truck = Truck.objects.create(plate_number='MAINT-99', status='maintenance', op_status='MAINTENANCE')
        res_alloc_bad = self.client.post('/api/driver/schedule-truck-allocations/', {
            'schedule': self.schedule.id,
            'allocation_date': str(tomorrow),
            'truck': maintenance_truck.id,
            'team': self.team_a.id,
        }, format='json')
        self.assertEqual(res_alloc_bad.status_code, status.HTTP_400_BAD_REQUEST)

        # Valid allocation POST must match effective team (team_b due to tomorrow's override);
        # passing overridden default team (team_a) is rejected (400).
        driver_2_worker = Worker.objects.create(
            employee_id='EMP-R2-D2-T5',
            full_name='Round2 Driver Two',
            user=self.driver_2,
        )
        TeamService.assign_member(self.team_b.id, driver_2_worker.id, 'driver', self.admin)

        other_schedule = CollectionSchedule.objects.create(
            area='Other Route',
            dumpsite=self.dumpsite,
            days='Tuesday',
            start_time='07:00',
            end_time='11:00',
            default_team=self.team_b,
        )
        res_alloc_wrong_team = self.client.post('/api/driver/schedule-truck-allocations/', {
            'schedule': self.schedule.id,
            'allocation_date': str(tomorrow),
            'truck': self.truck_1.id,
            'team': self.team_a.id,
        }, format='json')
        self.assertEqual(res_alloc_wrong_team.status_code, status.HTTP_400_BAD_REQUEST)

        res_alloc_1 = self.client.post('/api/driver/schedule-truck-allocations/', {
            'schedule': self.schedule.id,
            'allocation_date': str(tomorrow),
            'truck': self.truck_1.id,
            'team': self.team_b.id,
        }, format='json')
        self.assertEqual(res_alloc_1.status_code, status.HTTP_201_CREATED)

        truck_2 = Truck.objects.create(
            plate_number='TRK-202',
            status='active',
            op_status='AVAILABLE',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        res_alloc_2 = self.client.post('/api/driver/schedule-truck-allocations/', {
            'schedule': other_schedule.id,
            'allocation_date': str(tomorrow),
            'truck': truck_2.id,
            'team': self.team_b.id,
        }, format='json')
        self.assertEqual(res_alloc_2.status_code, status.HTTP_201_CREATED)
        alloc_2_id = res_alloc_2.data['id']

        res_conflict = self.client.patch(f'/api/driver/schedule-truck-allocations/{alloc_2_id}/', {
            'truck': self.truck_1.id,
        }, format='json')
        self.assertEqual(res_conflict.status_code, status.HTTP_400_BAD_REQUEST)

        # Reused allocation (already used by a DriverShift) cannot be modified via PATCH
        alloc_today = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id, allocation_date=today, truck_id=self.truck_1.id, allocated_by=self.admin
        )
        WatcherShift.objects.create(watcher=self.watcher, schedule=self.schedule, shift_date=today, is_active=True)
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver, schedule_id=self.schedule.id, allocation_id=alloc_today.id
        )
        res_used_patch = self.client.patch(f'/api/driver/schedule-truck-allocations/{alloc_today.id}/', {
            'truck': truck_2.id,
        }, format='json')
        self.assertEqual(res_used_patch.status_code, status.HTTP_409_CONFLICT)
        ShiftService.conclude_shift_atomic(shift.id, self.admin, end_reason='completed')

    def test_6a_transfer_member_blocks_active_watcher_and_crew_leader(self):
        """
        Round 4 D: Active WatcherShift and CrewShift.team_leader block transfer and deactivation.
        """
        today = timezone.localdate()
        ws = WatcherShift.objects.create(
            watcher=self.watcher,
            schedule=self.schedule,
            shift_date=today,
            is_active=True,
        )
        watcher_worker = Worker.objects.get(user=self.watcher)
        watcher_membership = SanitationTeamMembership.objects.get(worker=watcher_worker, is_active=True)

        with self.assertRaises(ActiveShiftConflictError):
            TeamService.transfer_member(watcher_worker.id, self.team_b.id, 'leader', self.admin)
        with self.assertRaises(ActiveShiftConflictError):
            TeamService.deactivate_member(watcher_membership.id, self.admin)

        # Even if WatcherShift were closed, an active CrewShift with team_leader blocks transfer
        ws.is_active = False
        ws.save(update_fields=['is_active'])
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id, allocation_date=today, truck_id=self.truck_1.id, allocated_by=self.admin
        )
        ds = DriverShift.objects.create(driver=self.driver, truck=self.truck_1, schedule=self.schedule, allocation=alloc, is_active=True)
        CrewShift.objects.create(driver_shift=ds, watcher_shift=ws, team=self.team_a, team_leader=self.watcher, is_active=True)

        with self.assertRaises(ActiveShiftConflictError):
            TeamService.transfer_member(watcher_worker.id, self.team_b.id, 'leader', self.admin)

    def test_7_unlinked_watcher_shift_cleanup_and_linked_end_protection(self):
        """
        Round 3 #3: Prior-date unlinked WatcherShifts are safely closed without blocking today,
        current-date unlinked WatcherShifts stay active, and linked WatcherShifts cannot be ended directly.
        """
        today = timezone.localdate()
        yesterday = today - timedelta(days=1)

        stale_ws = WatcherShift.objects.create(
            watcher=self.watcher,
            schedule=self.schedule,
            shift_date=yesterday,
            is_active=True,
        )

        # Watcher starts today's shift -> stale yesterday unlinked WatcherShift is closed cleanly
        self.client.force_authenticate(user=self.watcher)
        res_start = self.client.post('/api/driver/watcher-shifts/start/', {
            'schedule_id': self.schedule.id,
        }, format='json')
        self.assertEqual(res_start.status_code, status.HTTP_201_CREATED)
        today_ws_id = res_start.data['id']

        stale_ws.refresh_from_db()
        self.assertFalse(stale_ws.is_active)
        self.assertEqual(stale_ws.end_reason, 'stale_unlinked_cleanup')
        self.assertIsNotNone(stale_ws.ended_at)

        # Current-date unlinked WatcherShift is NOT closed by cleanup_stale_unlinked_watcher_shifts
        closed_again = ShiftService.cleanup_stale_unlinked_watcher_shifts(watcher_user=self.watcher)
        self.assertEqual(closed_again, [])
        today_ws = WatcherShift.objects.get(id=today_ws_id)
        self.assertTrue(today_ws.is_active)

        # Link today's WatcherShift to a staged DriverShift + CrewShift via official attendance submission
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id, allocation_date=today, truck_id=self.truck_1.id, allocated_by=self.admin
        )
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver, schedule_id=self.schedule.id, allocation_id=alloc.id
        )
        ShiftService.record_initial_attendance(
            shift.id,
            [
                {'worker_id': self.collector_1.id, 'status': 'PRESENT'},
                {'worker_id': self.collector_2.id, 'status': 'PRESENT'},
            ],
            recorded_by=self.watcher,
        )

        # Direct end_shift on linked WatcherShift is rejected (409)
        res_end_blocked = self.client.post(f'/api/driver/watcher-shifts/{today_ws_id}/end/', {}, format='json')
        self.assertEqual(res_end_blocked.status_code, status.HTTP_409_CONFLICT)
        today_ws.refresh_from_db()
        self.assertTrue(today_ws.is_active)

        # Coordinated conclusion closes DriverShift, CrewShift, and WatcherShift together
        ShiftService.conclude_shift_atomic(shift.id, self.admin, end_reason='completed')
        today_ws.refresh_from_db()
        self.assertFalse(today_ws.is_active)
        self.assertEqual(today_ws.end_reason, 'completed')

    def test_8_watcher_shift_blocks_put_patch_delete_and_read_only_serializer(self):
        """
        Round 4 A: WatcherShiftViewSet blocks PUT, PATCH, DELETE (405) even on an active linked shift,
        and WatcherShiftSerializer fields are read-only.
        """
        from driver.serializers import WatcherShiftSerializer
        today = timezone.localdate()
        ws = WatcherShift.objects.create(
            watcher=self.watcher,
            schedule=self.schedule,
            shift_date=today,
            is_active=True,
        )
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id, allocation_date=today, truck_id=self.truck_1.id, allocated_by=self.admin
        )
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver, schedule_id=self.schedule.id, allocation_id=alloc.id
        )
        ShiftService.record_initial_attendance(
            shift.id,
            [
                {'worker_id': self.collector_1.id, 'status': 'PRESENT'},
                {'worker_id': self.collector_2.id, 'status': 'PRESENT'},
            ],
            recorded_by=self.watcher,
        )

        for actor in (self.watcher, self.admin):
            self.client.force_authenticate(user=actor)
            res_put = self.client.put(f'/api/driver/watcher-shifts/{ws.id}/', {'is_active': False}, format='json')
            self.assertEqual(res_put.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
            res_patch = self.client.patch(f'/api/driver/watcher-shifts/{ws.id}/', {'is_active': False}, format='json')
            self.assertEqual(res_patch.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
            res_del = self.client.delete(f'/api/driver/watcher-shifts/{ws.id}/')
            self.assertEqual(res_del.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

        ws.refresh_from_db()
        self.assertTrue(ws.is_active)

        ser = WatcherShiftSerializer(ws, data={'is_active': False, 'schedule': self.schedule.id}, partial=True)
        self.assertTrue(ser.is_valid())
        self.assertEqual(ser.validated_data, {})

    def test_9_used_allocation_create_update_delete_protection(self):
        """
        Round 4 B: Used ScheduleTruckAllocations cannot be reused via create/upsert,
        modified via PATCH/PUT, or deleted via DELETE.
        """
        today = timezone.localdate()
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id, allocation_date=today, truck_id=self.truck_1.id, allocated_by=self.admin
        )
        WatcherShift.objects.create(watcher=self.watcher, schedule=self.schedule, shift_date=today, is_active=True)
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver, schedule_id=self.schedule.id, allocation_id=alloc.id
        )

        self.client.force_authenticate(user=self.admin)

        # Upsert/reuse via POST with same (schedule, truck, date) and different team -> 409 Conflict
        res_post = self.client.post('/api/driver/schedule-truck-allocations/', {
            'schedule': self.schedule.id,
            'allocation_date': str(today),
            'truck': self.truck_1.id,
            'team': self.team_b.id,
        }, format='json')
        self.assertEqual(res_post.status_code, status.HTTP_409_CONFLICT)

        # PATCH team -> 409 Conflict
        res_patch = self.client.patch(f'/api/driver/schedule-truck-allocations/{alloc.id}/', {
            'team': self.team_b.id,
        }, format='json')
        self.assertEqual(res_patch.status_code, status.HTTP_409_CONFLICT)

        # DELETE -> 409 Conflict
        res_del = self.client.delete(f'/api/driver/schedule-truck-allocations/{alloc.id}/')
        self.assertEqual(res_del.status_code, status.HTTP_409_CONFLICT)

        alloc.refresh_from_db()
        shift.refresh_from_db()
        self.assertEqual(alloc.team_id, self.team_a.id)
        self.assertEqual(shift.allocation_id, alloc.id)

    def test_10_schedule_aware_preallocated_truck_and_my_team_roster(self):
        """
        Round 4 E & G: preallocated-truck filters by schedule_id and rejects ambiguous multi-allocations;
        my_team_roster?schedule_id=... resolves via resolve_schedule_team without an allocation ID.
        """
        today = timezone.localdate()
        schedule_2 = CollectionSchedule.objects.create(
            area='Route B',
            dumpsite=self.dumpsite,
            days='Monday',
            start_time='13:00',
            end_time='17:00',
            default_team=self.team_a,
        )
        truck_2 = Truck.objects.create(
            plate_number='TRK-222',
            status='active',
            op_status='AVAILABLE',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )

        alloc_1 = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id, allocation_date=today, truck_id=self.truck_1.id, allocated_by=self.admin
        )
        alloc_2 = AllocationService.allocate_truck_for_schedule(
            schedule_id=schedule_2.id, allocation_date=today, truck_id=truck_2.id, allocated_by=self.admin
        )

        self.client.force_authenticate(user=self.driver)

        # Schedule-scoped lookup returns the exact matching allocation
        res_s2 = self.client.get(f'/api/driver/shift/preallocated-truck/?schedule_id={schedule_2.id}')
        self.assertEqual(res_s2.status_code, status.HTTP_200_OK)
        self.assertTrue(res_s2.data['has_allocation'])
        self.assertEqual(res_s2.data['allocation']['id'], alloc_2.id)

        # Unscoped lookup with multiple allocations across schedules returns 400 (never silently picks one)
        res_ambig = self.client.get('/api/driver/shift/preallocated-truck/')
        self.assertEqual(res_ambig.status_code, status.HTTP_400_BAD_REQUEST)

        # Clear allocations and test my_team_roster?schedule_id=... without any allocation
        ScheduleTruckAllocation.objects.filter(id__in=[alloc_1.id, alloc_2.id]).delete()
        res_roster = self.client.get(f'/api/driver/shift/my_team_roster/?schedule_id={self.schedule.id}')
        self.assertEqual(res_roster.status_code, status.HTTP_200_OK)
        self.assertTrue(res_roster.data['has_team'])
        self.assertEqual(res_roster.data['team']['id'], self.team_a.id)

    def test_11_sweeper_fault_isolation_and_active_shifts_resilience(self):
        """
        Round 4 F: Failure concluding one stale shift is logged and does not block other stale shifts
        or cause active_shifts to return HTTP 500.
        """
        from unittest.mock import patch
        from django.core.cache import cache
        from driver.management.commands.sweep_stale_shifts import sweep_stale_shifts

        stale_time = timezone.now() - timedelta(hours=10)
        truck_2 = Truck.objects.create(plate_number='TRK-333', status='active', op_status='AVAILABLE')
        driver_2 = User.objects.create_user(username='drv2_sweep', email='drv2_sweep@test.com', password='pw', role='driver', full_name='Driver 2')

        s1 = DriverShift.objects.create(driver=self.driver, truck=self.truck_1, schedule=self.schedule, is_active=True)
        s2 = DriverShift.objects.create(driver=driver_2, truck=truck_2, schedule=self.schedule, is_active=True)
        DriverShift.objects.filter(id__in=[s1.id, s2.id]).update(started_at=stale_time, last_location_update=stale_time)

        orig_conclude = ShiftService.conclude_shift_atomic

        def flaky_conclude(driver_shift_id, *args, **kwargs):
            if driver_shift_id == s1.id:
                raise RuntimeError('Simulated DB error on s1')
            return orig_conclude(driver_shift_id, *args, **kwargs)

        with patch.object(ShiftService, 'conclude_shift_atomic', side_effect=flaky_conclude):
            closed = sweep_stale_shifts()

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0][0], s2.id)
        s1.refresh_from_db()
        s2.refresh_from_db()
        self.assertTrue(s1.is_active)
        self.assertFalse(s2.is_active)

        # active_shifts must not return 500 when sweep_stale_shifts raises, and must release lock
        cache.delete('shift_sweep_lock')
        self.client.force_authenticate(user=self.admin)
        with patch('driver.management.commands.sweep_stale_shifts.sweep_stale_shifts', side_effect=RuntimeError('Boom')):
            res = self.client.get('/api/driver/shift/active_shifts/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIsNone(cache.get('shift_sweep_lock'))

    def test_12_round4_edge_cases_override_service_date_roster_and_leader_exclusion(self):
        """
        Round 4 H & I + R2 alignment:
        - Reason-only edit on inactive-team override succeeds; past/used override structural edit/delete blocked.
        - stage_and_start_shift rejects mixed-type manifested_worker_ids (400) and inactive team.
        - conclude_shift_atomic does NOT close mismatched linked WatcherShift (R2 safety).
        - record_initial_attendance excludes Watcher/leader and Driver from crew attendance.
        """
        from driver.models import ScheduleTeamOverride
        today = timezone.localdate()
        yesterday = today - timedelta(days=1)

        inactive_team = SanitationTeam.objects.create(name='Old Inactive', code='OLD-01', is_active=False)
        past_override = ScheduleTeamOverride.objects.create(
            schedule=self.schedule, team=inactive_team, effective_date=yesterday, reason='Old reason'
        )

        self.client.force_authenticate(user=self.admin)

        # Reason-only edit on inactive-team override succeeds
        res_reason = self.client.patch(f'/api/driver/schedule-team-overrides/{past_override.id}/', {
            'reason': 'Updated audit note',
        }, format='json')
        self.assertEqual(res_reason.status_code, status.HTTP_200_OK)

        # Structural change / deletion of past override is blocked (409)
        res_move_past = self.client.patch(f'/api/driver/schedule-team-overrides/{past_override.id}/', {
            'team': self.team_b.id,
        }, format='json')
        self.assertEqual(res_move_past.status_code, status.HTTP_409_CONFLICT)

        res_del_past = self.client.delete(f'/api/driver/schedule-team-overrides/{past_override.id}/')
        self.assertEqual(res_del_past.status_code, status.HTTP_409_CONFLICT)

        # Mixed-type manifested_worker_ids raises controlled ValidationError
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id, allocation_date=today, truck_id=self.truck_1.id, allocated_by=self.admin
        )
        WatcherShift.objects.create(watcher=self.watcher, schedule=self.schedule, shift_date=today, is_active=True)

        with self.assertRaises(ValidationError):
            ShiftService.stage_and_start_shift(
                driver_user=self.driver,
                schedule_id=self.schedule.id,
                allocation_id=alloc.id,
                manifested_worker_ids=[self.collector_1.id, 'bad-id'],
            )

        # Valid stage_and_start_shift: verify leader is excluded from initial attendance requirement
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver,
            schedule_id=self.schedule.id,
            allocation_id=alloc.id,
        )
        watcher_worker = Worker.objects.get(user=self.watcher)
        with self.assertRaises(ValidationError):
            ShiftService.record_initial_attendance(
                shift.id,
                [
                    {'worker_id': self.collector_1.id, 'status': 'PRESENT'},
                    {'worker_id': watcher_worker.id, 'status': 'PRESENT'},
                ],
                recorded_by=self.watcher,
            )

        records = ShiftService.record_initial_attendance(
            shift.id,
            [
                {'worker_id': self.collector_1.id, 'status': 'PRESENT'},
                {'worker_id': self.collector_2.id, 'status': 'PRESENT'},
            ],
            recorded_by=self.watcher,
        )
        self.assertEqual(len(records), 2)
        self.assertEqual({r.worker_id for r in records}, {self.collector_1.id, self.collector_2.id})

        # Mismatched linked WatcherShift schedule is NOT closed on conclude_shift_atomic (R2 safety)
        other_sched = CollectionSchedule.objects.create(
            area='Other', days='Wednesday', start_time='08:00', end_time='12:00', default_team=self.team_a
        )
        ws = shift.crew_shift.watcher_shift
        ws.schedule = other_sched
        ws.save(update_fields=['schedule'])

        ShiftService.conclude_shift_atomic(shift.id, self.admin, end_reason='completed')
        ws.refresh_from_db()
        self.assertTrue(ws.is_active)
        self.assertEqual(ws.end_reason, '')

    def test_13_round5_leader_participation_and_service_date_invariants(self):
        """
        Round 5 M3, M4 & Item 5:
        - stage_and_start_shift checks deployment leader participation even when omitted from manifested_worker_ids.
        - record_initial_attendance rejects shift with no allocation or WatcherShift (no UTC started_at.date() fallback).
        - my_team_roster does not swallow unexpected RuntimeError or substitute an arbitrary leader when schedule resolution fails.
        """
        today = timezone.localdate()
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id, allocation_date=today, truck_id=self.truck_1.id, allocated_by=self.admin
        )
        ws = WatcherShift.objects.create(
            watcher=self.watcher, schedule=self.schedule, shift_date=today, is_active=True
        )
        # Put watcher_worker as team_leader on another active CrewShift so they are already on an active shift
        other_ds = DriverShift.objects.create(
            driver=self.driver_2, truck=self.truck_2, schedule=self.other_schedule, is_active=True
        )
        CrewShift.objects.create(
            driver_shift=other_ds, team=self.team_b, team_leader=self.watcher, is_active=True
        )

        # Even when manifested_worker_ids omits watcher_worker, stage_and_start_shift blocks on leader conflict
        with self.assertRaises(ActiveShiftConflictError):
            ShiftService.stage_and_start_shift(
                driver_user=self.driver,
                schedule_id=self.schedule.id,
                allocation_id=alloc.id,
                manifested_worker_ids=[self.collector_1.id, self.collector_2.id],
            )

        # Conclude other_ds and stage cleanly
        ShiftService.conclude_shift_atomic(other_ds.id, self.admin, end_reason='completed')
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver,
            schedule_id=self.schedule.id,
            allocation_id=alloc.id,
            manifested_worker_ids=[self.collector_1.id, self.collector_2.id],
        )

        # Unlink allocation and watcher_shift from shift -> record_initial_attendance rejects missing service_date
        CrewShift.objects.filter(driver_shift=shift).update(watcher_shift=None)
        DriverShift.objects.filter(id=shift.id).update(allocation=None)
        with self.assertRaises(ValidationError) as ctx:
            ShiftService.record_initial_attendance(
                shift.id,
                [
                    {'worker_id': self.collector_1.id, 'status': 'PRESENT'},
                    {'worker_id': self.collector_2.id, 'status': 'PRESENT'},
                ],
                recorded_by=self.watcher,
            )
        self.assertIn('service_date', ctx.exception.message_dict)

        # my_team_roster must NOT swallow unexpected RuntimeError when resolving schedule leader
        from unittest.mock import patch
        self.client.force_authenticate(user=self.driver)
        with patch('driver.team_service.resolve_deployment_team_leader', side_effect=RuntimeError('unexpected failure')):
            with self.assertRaises(RuntimeError):
                self.client.get(
                    f'/api/driver/shift/my_team_roster/?schedule_id={self.schedule.id}&date={today.isoformat()}'
                )
        ws.delete()

    def test_14_round5b1_core_remediation_checks(self):
        """
        Round 5B.1 focused regression checks:
        - Migration 0049 dependency on 0048_collectionschedule_is_available and RemoveField operations.
        - PostgreSQL-safe locked-query construction (of=('self',)) on nullable schedule select_related.
        - Used allocation cannot be overwritten by TruckService.replace_truck_assignment.
        - Truck replacement follows canonical lock hierarchy.
        - my_team_roster rejects malformed schedule IDs (400), never returns an unrelated team/leader when schedule_id is supplied (returning empty roster for unauthorized cross-team callers), and allows personal membership fallback only when schedule_id is omitted.
        """
        import importlib
        import inspect
        from django.db import migrations as dj_migrations
        from driver.views import DriverShiftViewSet
        from driver.truck_service import TruckService, TruckLifecycleConflictError

        # 1. Migration 0049 dependency and RemoveField operations
        mig_0049 = importlib.import_module('driver.migrations.0049_decouple_crewshift_and_attendance')
        self.assertIn(
            ('driver', '0048_collectionschedule_is_available'),
            mig_0049.Migration.dependencies,
        )
        remove_ops = [
            (op.model_name.lower(), op.name.lower())
            for op in mig_0049.Migration.operations
            if isinstance(op, dj_migrations.RemoveField)
        ]
        self.assertIn(('collectionschedule', 'designated_leader'), remove_ops)
        self.assertIn(('scheduleteamoverride', 'leader_override'), remove_ops)

        # 2. PostgreSQL-safe locked-query construction in DriverShiftViewSet
        import linecache
        linecache.clearcache()
        for method_name in ('dev_reset', 'extended_mode', 'start_shift', 'end_shift'):
            src = inspect.getsource(getattr(DriverShiftViewSet, method_name))
            self.assertNotIn('select_for_update().select_related', src)
            self.assertIn("select_for_update(of=('self',))", src)

        # 3. TruckService.replace_truck_assignment lock hierarchy and used-allocation protection
        replace_src = inspect.getsource(TruckService.replace_truck_assignment)
        idx_sched = replace_src.index('CollectionSchedule.objects.select_for_update()')
        idx_team = replace_src.index('SanitationTeam.objects.filter(id=resolved_team.id, is_active=True).select_for_update()')
        idx_alloc = replace_src.index('ScheduleTruckAllocation.objects.select_for_update()')
        idx_truck = replace_src.index("Truck.objects.filter(pk__in=lock_ids).order_by('pk').select_for_update()")
        self.assertTrue(idx_sched < idx_team < idx_alloc < idx_truck)

        today = timezone.localdate()
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id,
            allocation_date=today,
            truck_id=self.truck_1.id,
            allocated_by=self.admin,
        )
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver,
            schedule_id=self.schedule.id,
            allocation_id=alloc.id,
            manifested_worker_ids=[self.collector_1.id, self.collector_2.id],
        )
        ShiftService.conclude_shift_atomic(shift.id, self.admin, end_reason='completed')

        replacement_truck = Truck.objects.create(
            plate_number='TRK-5B1-REPL',
            model='Hino',
            status='active',
            op_status='AVAILABLE',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        with self.assertRaises(TruckLifecycleConflictError) as ctx:
            TruckService.replace_truck_assignment(
                self.truck_1,
                replacement_truck_id=replacement_truck.id,
                schedule_id=self.schedule.id,
                user=self.admin,
                effective_date=today,
                reason='Replace truck after shift test',
            )
        self.assertEqual(ctx.exception.code, 'allocation_already_used')

        # 4. my_team_roster malformed schedule_id (400), schedule-scoped resolution, and unscoped fallback
        self.client.force_authenticate(user=self.driver)
        for bad_val in ('abc', '-5', '0', ''):
            res_bad = self.client.get(f'/api/driver/shift/my_team_roster/?schedule_id={bad_val}')
            self.assertEqual(res_bad.status_code, 400)

        # Create an unrelated schedule with no team assigned
        unassigned_schedule = CollectionSchedule.objects.create(
            area='Unassigned Schedule 5B1',
            days='Monday',
            start_time='13:00',
            end_time='15:00',
            default_team=None,
        )
        # When schedule_id is supplied for unassigned schedule, must NOT fall back to driver's personal Team A
        res_unassigned = self.client.get(
            f'/api/driver/shift/my_team_roster/?schedule_id={unassigned_schedule.id}&service_date={today.isoformat()}'
        )
        self.assertEqual(res_unassigned.status_code, 200)
        self.assertFalse(res_unassigned.data['has_team'])

        # Create a schedule assigned to Team B (where self.driver is NOT a member)
        other_team_schedule = CollectionSchedule.objects.create(
            area='Other Team Schedule 5B1',
            days='Monday',
            start_time='15:00',
            end_time='17:00',
            default_team=self.team_b,
        )
        res_other = self.client.get(
            f'/api/driver/shift/my_team_roster/?schedule_id={other_team_schedule.id}&service_date={today.isoformat()}'
        )
        self.assertEqual(res_other.status_code, 200)
        self.assertFalse(res_other.data['has_team'])
        self.assertIsNone(res_other.data['team'])
        self.assertIsNone(res_other.data['team_leader'])
        self.assertEqual(res_other.data['crew_members'], [])
        self.assertEqual(res_other.data['members'], [])

        # When schedule_id is omitted and no active shift exists, personal active-team membership fallback works
        res_fallback = self.client.get('/api/driver/shift/my_team_roster/')
        self.assertEqual(res_fallback.status_code, 200)
        self.assertTrue(res_fallback.data['has_team'])
        self.assertEqual(res_fallback.data['team']['id'], self.team_a.id)

    def test_15_my_team_roster_schedule_authorization_matrix(self):
        """
        Gate 2 regression matrix for DriverShiftViewSet.my_team_roster when schedule_id is supplied:
        1. Team A driver cannot retrieve Team B's roster.
        2. Unrelated citizen cannot retrieve Team B's roster.
        3. Team B's active leader can retrieve Team B's roster.
        4. Authorized administrators (both role='admin', is_staff=False and is_staff=True/superuser) can retrieve Team B's roster.
        5. Legitimate non-leader active members (Team A driver on Team A schedule; Team B driver on Team B schedule) retain access.
        6. Malformed/non-positive schedule_id values continue returning 400 Bad Request.
        """
        today = timezone.localdate()
        team_b_sched = CollectionSchedule.objects.create(
            area='Team B Auth Schedule',
            days='Monday',
            start_time=time(8, 0),
            end_time=time(12, 0),
            default_team=self.team_b,
        )
        team_b_driver_worker = Worker.objects.create(
            employee_id='EMP-R2-TB-D2',
            full_name='Team B Driver Two',
            user=self.driver_2,
        )
        team_b_crew = Worker.objects.create(
            employee_id='EMP-R2-TB-C1',
            full_name='Team B Collector One',
        )
        TeamService.assign_member(self.team_b.id, team_b_driver_worker.id, 'driver', self.admin)
        TeamService.assign_member(self.team_b.id, team_b_crew.id, 'crew', self.admin)

        admin_non_staff = User.objects.create_user(
            username='r2_admin_nonstaff',
            email='r2_admin_nonstaff@example.com',
            password='Password123!',
            role='admin',
            is_staff=False,
        )
        staff_admin = User.objects.create_user(
            username='r2_staff_only',
            email='r2_staff_only@example.com',
            password='Password123!',
            role='citizen',
            is_staff=True,
        )

        team_b_url = f'/api/driver/shift/my_team_roster/?schedule_id={team_b_sched.id}&date={today.isoformat()}'

        # 1. Driver belonging to Team A cannot retrieve Team B's roster
        self.client.force_authenticate(user=self.driver)
        res_team_a_drv = self.client.get(team_b_url)
        self.assertEqual(res_team_a_drv.status_code, status.HTTP_200_OK)
        self.assertFalse(res_team_a_drv.data['has_team'])
        self.assertIsNone(res_team_a_drv.data['team'])
        self.assertIsNone(res_team_a_drv.data['team_leader'])
        self.assertIsNone(res_team_a_drv.data['deployment_leader'])
        self.assertEqual(res_team_a_drv.data['crew_members'], [])
        self.assertEqual(res_team_a_drv.data['members'], [])
        self.assertEqual(res_team_a_drv.data['attendance'], [])
        self.assertEqual(res_team_a_drv.data['attendance_records'], [])
        self.assertFalse(res_team_a_drv.data['attendance_submitted'])
        self.assertIsNone(res_team_a_drv.data['driver_shift_id'])

        # 2. Unrelated citizen cannot retrieve Team B's roster
        self.client.force_authenticate(user=self.citizen)
        res_citizen = self.client.get(team_b_url)
        self.assertEqual(res_citizen.status_code, status.HTTP_200_OK)
        self.assertFalse(res_citizen.data['has_team'])
        self.assertIsNone(res_citizen.data['team'])
        self.assertIsNone(res_citizen.data['team_leader'])
        self.assertEqual(res_citizen.data['crew_members'], [])
        self.assertEqual(res_citizen.data['members'], [])

        # 3. Team B's active leader can retrieve Team B's roster
        self.client.force_authenticate(user=self.other_watcher)
        res_leader = self.client.get(team_b_url)
        self.assertEqual(res_leader.status_code, status.HTTP_200_OK)
        self.assertTrue(res_leader.data['has_team'])
        self.assertEqual(res_leader.data['team']['id'], self.team_b.id)
        self.assertEqual(res_leader.data['team_leader']['user_id'], self.other_watcher.id)
        self.assertIn(team_b_crew.id, [m['worker_id'] for m in res_leader.data['crew_members']])

        # 4. Authorized administrators can retrieve Team B's roster (both role='admin', is_staff=False and is_staff=True)
        for admin_user in (admin_non_staff, staff_admin, self.admin):
            self.client.force_authenticate(user=admin_user)
            res_admin = self.client.get(team_b_url)
            self.assertEqual(res_admin.status_code, status.HTTP_200_OK)
            self.assertTrue(res_admin.data['has_team'])
            self.assertEqual(res_admin.data['team']['id'], self.team_b.id)
            self.assertEqual(res_admin.data['team_leader']['user_id'], self.other_watcher.id)

        # 5. Legitimate non-leader active members retain access
        self.client.force_authenticate(user=self.driver)
        res_team_a_member = self.client.get(
            f'/api/driver/shift/my_team_roster/?schedule_id={self.schedule.id}&date={today.isoformat()}'
        )
        self.assertEqual(res_team_a_member.status_code, status.HTTP_200_OK)
        self.assertTrue(res_team_a_member.data['has_team'])
        self.assertEqual(res_team_a_member.data['team']['id'], self.team_a.id)
        self.assertEqual(res_team_a_member.data['team_leader']['user_id'], self.watcher.id)
        team_a_member_ids = [m['worker_id'] for m in res_team_a_member.data['crew_members']]
        self.assertIn(self.collector_1.id, team_a_member_ids)
        self.assertIn(self.collector_2.id, team_a_member_ids)

        self.client.force_authenticate(user=self.driver_2)
        res_team_b_member = self.client.get(team_b_url)
        self.assertEqual(res_team_b_member.status_code, status.HTTP_200_OK)
        self.assertTrue(res_team_b_member.data['has_team'])
        self.assertEqual(res_team_b_member.data['team']['id'], self.team_b.id)
        self.assertEqual(res_team_b_member.data['team_leader']['user_id'], self.other_watcher.id)

        # 6. Malformed/non-positive schedule_id rejection remains intact
        self.client.force_authenticate(user=self.driver)
        for bad_val in ('abc', '-5', '-1', '0', '', '   '):
            res_bad = self.client.get(f'/api/driver/shift/my_team_roster/?schedule_id={bad_val}')
            self.assertEqual(res_bad.status_code, status.HTTP_400_BAD_REQUEST)


