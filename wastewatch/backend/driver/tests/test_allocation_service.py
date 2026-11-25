from datetime import time, timedelta
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status
from django.core.exceptions import ValidationError
from accounts.models import Barangay
from dumpsite.models import Dumpsite
from driver.models import (
    Worker,
    SanitationTeam,
    Truck,
    CommissioningProvenance,
    TruckRetirementState,
    CollectionSchedule,
    ScheduleTeamOverride,
    ScheduleTruckAllocation,
)
from driver.team_service import TeamService
from driver.allocation_service import AllocationService

User = get_user_model()


class AllocationServiceTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='allocadmin',
            email='allocadmin@example.com',
            password='Password123!',
            role='admin'
        )
        self.driver_user = User.objects.create_user(
            username='allocdriver',
            email='allocdriver@example.com',
            password='Password123!',
            role='driver'
        )
        self.driver_user_2 = User.objects.create_user(
            username='allocdriver2',
            email='allocdriver2@example.com',
            password='Password123!',
            role='driver'
        )
        self.watcher_user = User.objects.create_user(
            username='allocwatcher',
            email='allocwatcher@example.com',
            password='Password123!',
            role='watcher'
        )
        self.client.force_authenticate(user=self.admin)

        self.barangay = Barangay.objects.create(name='Alloc Brgy')
        self.dumpsite = Dumpsite.objects.create(
            name='Alloc Dumpsite',
            barangay=self.barangay,
            latitude=13.94,
            longitude=121.62,
        )

        self.team_1 = TeamService.create_team(name='Team Red', code='RED')
        self.team_2 = TeamService.create_team(name='Team Blue', code='BLUE')

        self.watcher_worker = Worker.objects.create(
            employee_id='EMP-WCH-01',
            full_name='Watcher Red',
            user=self.watcher_user
        )
        self.driver_worker = Worker.objects.create(
            employee_id='EMP-DRV-01',
            full_name='Driver Red',
            user=self.driver_user
        )
        self.driver_worker_2 = Worker.objects.create(
            employee_id='EMP-DRV-02',
            full_name='Driver Blue',
            user=self.driver_user_2
        )
        TeamService.assign_member(
            team_id=self.team_1.id,
            worker_id=self.watcher_worker.id,
            role_in_team='leader',
            created_by=self.admin
        )
        TeamService.assign_member(
            team_id=self.team_1.id,
            worker_id=self.driver_worker.id,
            role_in_team='driver',
            created_by=self.admin
        )
        TeamService.assign_member(
            team_id=self.team_2.id,
            worker_id=self.driver_worker_2.id,
            role_in_team='leader',
            created_by=self.admin
        )

        now = timezone.now()
        self.truck = Truck.objects.create(
            plate_number='TRK-ALLOC-01',
            model='Hino 500',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.schedule = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=self.driver_user,
            dumpsite=self.dumpsite,
            default_team=self.team_1,
            start_time=time(8, 0),
            end_time=time(16, 0),
            area='District 1'
        )

        self.today = timezone.localdate()
        self.target_date = self.today + timedelta(days=1)

    def test_resolve_schedule_team_default(self):
        resolved = AllocationService.resolve_schedule_team(self.schedule.id, self.target_date)
        self.assertEqual(resolved, self.team_1)

    def test_resolve_schedule_team_override_precedence(self):
        # Create D-10 date override to team_2
        AllocationService.create_schedule_override(
            schedule_id=self.schedule.id,
            effective_date=self.target_date,
            team_id=self.team_2.id,
            reason='Special holiday coverage',
            created_by=self.admin
        )

        # On target date, override takes precedence
        resolved = AllocationService.resolve_schedule_team(self.schedule.id, self.target_date)
        self.assertEqual(resolved, self.team_2)

        # On another date, default team applies
        other_date = self.target_date + timedelta(days=1)
        resolved_other = AllocationService.resolve_schedule_team(self.schedule.id, other_date)
        self.assertEqual(resolved_other, self.team_1)

    def test_allocate_truck_for_schedule(self):
        allocation = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id,
            allocation_date=self.target_date,
            truck_id=self.truck.id,
            allocated_by=self.admin
        )

        self.assertEqual(allocation.truck, self.truck)
        self.assertEqual(allocation.team, self.team_1)
        self.truck.refresh_from_db()
        self.assertEqual(self.truck.op_status, 'ASSIGNED')

        # Attempt to allocate same truck to another schedule on same date fails
        truck_2 = Truck.objects.create(
            plate_number='TRK-ALLOC-02',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        sched_2 = CollectionSchedule.objects.create(
            truck=truck_2,
            dumpsite=self.dumpsite,
            default_team=self.team_2,
            start_time=time(9, 0),
            end_time=time(17, 0)
        )
        with self.assertRaises(ValidationError):
            AllocationService.allocate_truck_for_schedule(
                schedule_id=sched_2.id,
                allocation_date=self.target_date,
                truck_id=self.truck.id,  # same truck already allocated
                team_id=self.team_2.id,
                allocated_by=self.admin
            )

    def test_get_preallocated_truck_for_driver(self):
        AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id,
            allocation_date=self.target_date,
            truck_id=self.truck.id,
            allocated_by=self.admin
        )

        alloc = AllocationService.get_preallocated_truck_for_driver(
            driver_user=self.driver_user,
            target_date=self.target_date
        )
        self.assertIsNotNone(alloc)
        self.assertEqual(alloc.truck, self.truck)
        self.assertEqual(alloc.team, self.team_1)

    def test_api_schedule_endpoints(self):
        # Resolve team API
        res = self.client.get(f'/api/driver/collection-schedules/{self.schedule.id}/resolve-team/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['code'], 'RED')

        # Set default team API
        res = self.client.post(
            f'/api/driver/collection-schedules/{self.schedule.id}/set-default-team/',
            {'team_id': self.team_2.id},
            format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Allocate truck API (for today so driver preallocated-truck sees it)
        res = self.client.post(
            f'/api/driver/collection-schedules/{self.schedule.id}/allocate-truck/',
            {
                'allocation_date': str(self.today),
                'truck_id': self.truck.id,
                'team_id': self.team_2.id,
            },
            format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        # Driver preallocated truck API (team_2 is led by driver_user_2)
        self.client.force_authenticate(user=self.driver_user_2)
        res = self.client.get('/api/driver/shift/preallocated-truck/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['has_allocation'])

    def test_crew_shift_allocation_blocks_update_upsert_delete(self):
        from django.utils import timezone
        from driver.models import CrewShift
        from driver.team_service import ActiveShiftConflictError

        today = timezone.localdate()
        truck_alt = Truck.objects.create(
            plate_number='TRK-ALLOC-ALT',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id,
            allocation_date=today,
            truck_id=self.truck.id,
            allocated_by=self.admin,
        )
        CrewShift.objects.create(
            allocation=alloc,
            schedule=self.schedule,
            service_date=today,
            team=self.team_1,
            is_active=True,
        )

        with self.assertRaises(ActiveShiftConflictError):
            AllocationService.update_truck_allocation(
                allocation_id=alloc.id,
                truck_id=truck_alt.id,
            )

        with self.assertRaises(ActiveShiftConflictError):
            AllocationService.allocate_truck_for_schedule(
                schedule_id=self.schedule.id,
                allocation_date=today,
                truck_id=self.truck.id,
                allocated_by=self.admin,
            )

        with self.assertRaises(ActiveShiftConflictError):
            AllocationService.delete_truck_allocation(alloc.id)

    def test_delete_allocation_and_override_guards_and_idle_truck_release(self):
        from datetime import timedelta
        from django.utils import timezone
        from driver.models import CrewShift
        from driver.team_service import ActiveShiftConflictError

        today = timezone.localdate()
        future_date = today + timedelta(days=2)
        past_date = today - timedelta(days=1)

        # Past-date override rejected
        with self.assertRaises(ValidationError):
            AllocationService.create_schedule_override(
                schedule_id=self.schedule.id,
                effective_date=past_date,
                team_id=self.team_2.id,
                reason='Past invalid',
                created_by=self.admin,
            )

        # Past-date allocation rejected
        with self.assertRaises(ValidationError):
            AllocationService.allocate_truck_for_schedule(
                schedule_id=self.schedule.id,
                allocation_date=past_date,
                truck_id=self.truck.id,
                allocated_by=self.admin,
            )

        # Explicit mismatched team_id rejected
        with self.assertRaises(ValidationError):
            AllocationService.allocate_truck_for_schedule(
                schedule_id=self.schedule.id,
                allocation_date=future_date,
                truck_id=self.truck.id,
                team_id=self.team_2.id,
                allocated_by=self.admin,
            )

        # Allocate & delete -> truck.op_status reverts to AVAILABLE when idle
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id,
            allocation_date=future_date,
            truck_id=self.truck.id,
            allocated_by=self.admin,
        )
        self.truck.refresh_from_db()
        self.assertEqual(self.truck.op_status, 'ASSIGNED')

        # Override overwrite & delete blocked while allocation or CrewShift exists
        ov = AllocationService.create_schedule_override(
            schedule_id=self.schedule.id,
            effective_date=future_date,
            team_id=self.team_1.id,
            reason='Valid override',
            created_by=self.admin,
        )
        with self.assertRaises(ActiveShiftConflictError):
            AllocationService.create_schedule_override(
                schedule_id=self.schedule.id,
                effective_date=future_date,
                team_id=self.team_2.id,
                reason='Overwrite conflict',
                created_by=self.admin,
            )

        AllocationService.delete_truck_allocation(alloc.id)
        self.truck.refresh_from_db()
        self.assertEqual(self.truck.op_status, 'AVAILABLE')

        CrewShift.objects.create(
            schedule=self.schedule,
            service_date=future_date,
            team=self.team_1,
            is_active=True,
        )
        with self.assertRaises(ActiveShiftConflictError):
            AllocationService.update_schedule_override(override_id=ov.id, team_id=self.team_2.id)
        with self.assertRaises(ActiveShiftConflictError):
            AllocationService.delete_schedule_override(ov.id)

        # Cancelled schedule blocks override and allocation
        self.schedule.status = 'CANCELLED'
        self.schedule.save(update_fields=['status'])
        with self.assertRaises(ValidationError):
            AllocationService.create_schedule_override(
                schedule_id=self.schedule.id,
                effective_date=future_date + timedelta(days=1),
                team_id=self.team_2.id,
                reason='Cancelled',
                created_by=self.admin,
            )
        with self.assertRaises(ValidationError):
            AllocationService.allocate_truck_for_schedule(
                schedule_id=self.schedule.id,
                allocation_date=future_date + timedelta(days=1),
                truck_id=self.truck.id,
                allocated_by=self.admin,
            )

    def test_collection_schedule_save_driver_none_and_update_fields_skip(self):
        from unittest.mock import patch

        sched_team_only = CollectionSchedule.objects.create(
            truck=self.truck,
            driver=None,
            default_team=self.team_1,
            start_time=time(7, 0),
            end_time=time(11, 0),
            area='Team Only Zone',
            waypoints=[
                {'lat': 13.93, 'lng': 121.61, 'label': 'Base'},
                {'lat': 13.94, 'lng': 121.62, 'label': 'Stop 1'},
            ],
        )
        self.assertIsNotNone(sched_team_only.id)

        with patch.object(CollectionSchedule, 'sync_pickup_statuses') as mock_sync:
            sched_team_only.default_team = self.team_2
            sched_team_only.save(update_fields=['default_team'])
            mock_sync.assert_not_called()

    def test_schedule_truck_allocation_viewset_update_and_destroy_canonical_lock_order(self):
        from unittest.mock import patch
        from django.db.models.query import QuerySet
        from rest_framework.test import APIClient

        future_date = timezone.localdate() + timedelta(days=3)
        truck_alt = Truck.objects.create(
            plate_number='TRK-LOCK-2',
            model='Isuzu',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.schedule.id,
            allocation_date=future_date,
            truck_id=self.truck.id,
            allocated_by=self.admin,
        )

        client = APIClient()
        client.force_authenticate(user=self.admin)

        orig_sfu = QuerySet.select_for_update

        def _run_and_capture(fn):
            acquired = []

            def wrapped_sfu(qs, *args, **kwargs):
                acquired.append(qs.model.__name__)
                return orig_sfu(qs, *args, **kwargs)

            with patch.object(QuerySet, 'select_for_update', wrapped_sfu):
                resp = fn()
            return resp, acquired

        patch_resp, patch_locks = _run_and_capture(
            lambda: client.patch(
                f'/api/driver/schedule-truck-allocations/{alloc.id}/',
                {'truck': truck_alt.id},
                format='json',
            )
        )
        self.assertEqual(patch_resp.status_code, 200)
        self.assertIn('CollectionSchedule', patch_locks)
        self.assertIn('ScheduleTruckAllocation', patch_locks)
        self.assertLess(
            patch_locks.index('CollectionSchedule'),
            patch_locks.index('ScheduleTruckAllocation'),
            f'Expected CollectionSchedule before ScheduleTruckAllocation, got {patch_locks}',
        )
        self.assertLess(
            patch_locks.index('SanitationTeam'),
            patch_locks.index('ScheduleTruckAllocation'),
            f'Expected SanitationTeam before ScheduleTruckAllocation, got {patch_locks}',
        )

        del_resp, del_locks = _run_and_capture(
            lambda: client.delete(f'/api/driver/schedule-truck-allocations/{alloc.id}/')
        )
        self.assertEqual(del_resp.status_code, 204)
        self.assertIn('CollectionSchedule', del_locks)
        self.assertIn('ScheduleTruckAllocation', del_locks)
        self.assertLess(
            del_locks.index('CollectionSchedule'),
            del_locks.index('ScheduleTruckAllocation'),
            f'Expected CollectionSchedule before ScheduleTruckAllocation on delete, got {del_locks}',
        )


