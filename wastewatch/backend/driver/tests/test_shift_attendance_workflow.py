from datetime import time, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay
from driver.allocation_service import AllocationService
from driver.models import (
    CollectionSchedule,
    CommissioningProvenance,
    CrewAttendanceCorrection,
    CrewAttendanceRecord,
    CrewShift,
    DriverShift,
    SanitationTeam,
    ScheduleTeamOverride,
    ShiftCrewRosterSnapshot,
    Truck,
    TruckReplacementRequest,
    TruckRetirementState,
    WatcherShift,
    Worker,
)
from driver.shift_service import ShiftService
from driver.team_service import TeamService
from driver.truck_service import TruckService
from dumpsite.models import Dumpsite
from watcher.models import Escalation, GarbageHotspot, HotspotIntervention, InterventionType

User = get_user_model()


class ShiftAttendanceWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.today = timezone.localdate()
        self.weekday = self.today.strftime('%A')

        self.admin = User.objects.create_user(
            username='wf_admin',
            email='wf_admin@test.local',
            password='pw',
            role='admin',
            is_staff=False,
            full_name='Role Admin',
        )
        self.staff_admin = User.objects.create_user(
            username='wf_staff_admin',
            email='wf_staff_admin@test.local',
            password='pw',
            role='citizen',
            is_staff=True,
            full_name='Staff Admin',
        )
        self.watcher_leader = User.objects.create_user(
            username='wf_watcher_1',
            email='wf_watcher_1@test.local',
            password='pw',
            role='watcher',
            full_name='Watcher Leader One',
        )
        self.other_watcher = User.objects.create_user(
            username='wf_watcher_2',
            email='wf_watcher_2@test.local',
            password='pw',
            role='watcher',
            full_name='Watcher Two',
        )
        self.driver_member = User.objects.create_user(
            username='wf_driver_1',
            email='wf_driver_1@test.local',
            password='pw',
            role='driver',
            full_name='Driver Member',
        )
        self.driver_leader = User.objects.create_user(
            username='wf_driver_2',
            email='wf_driver_2@test.local',
            password='pw',
            role='driver',
            full_name='Driver Leader',
        )
        self.citizen = User.objects.create_user(
            username='wf_citizen',
            email='wf_citizen@test.local',
            password='pw',
            role='citizen',
            full_name='Ordinary Citizen',
        )
        self.operator = User.objects.create_user(
            username='wf_operator',
            email='wf_operator@test.local',
            password='pw',
            role='dumpsite',
            full_name='Facility Operator',
        )

        self.barangay = Barangay.objects.create(name='WF Barangay')
        self.dumpsite = Dumpsite.objects.create(
            name='Lucena Central Dumpsite',
            barangay=self.barangay,
            latitude=13.9400,
            longitude=121.6200,
            operator=self.operator,
        )

        self.truck_1 = Truck.objects.create(
            plate_number='WF-101',
            model='Isuzu Elf',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_2 = Truck.objects.create(
            plate_number='WF-102',
            model='Hino 300',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_3 = Truck.objects.create(
            plate_number='WF-103',
            model='Fuso',
            status='active',
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )

        # Workers
        self.w_watcher = Worker.objects.create(employee_id='WF-W1', full_name='Watcher Leader One', user=self.watcher_leader)
        self.w_other_watcher = Worker.objects.create(employee_id='WF-W2', full_name='Watcher Two', user=self.other_watcher)
        self.w_driver_member = Worker.objects.create(employee_id='WF-D1', full_name='Driver Member', user=self.driver_member)
        self.w_driver_leader = Worker.objects.create(employee_id='WF-D2', full_name='Driver Leader', user=self.driver_leader)
        self.w_crew_a1 = Worker.objects.create(employee_id='WF-CA1', full_name='Crew A1')
        self.w_crew_a2 = Worker.objects.create(employee_id='WF-CA2', full_name='Crew A2')
        self.w_crew_b1 = Worker.objects.create(employee_id='WF-CB1', full_name='Crew B1')
        self.w_crew_b2 = Worker.objects.create(employee_id='WF-CB2', full_name='Crew B2')

        # Watcher-led team
        self.team_watcher = TeamService.create_team(name='Watcher Led WF', code='WF-WL')
        TeamService.assign_member(self.team_watcher.id, self.w_watcher.id, 'leader', created_by=self.admin)
        TeamService.assign_member(self.team_watcher.id, self.w_driver_member.id, 'driver', created_by=self.admin)
        TeamService.assign_member(self.team_watcher.id, self.w_crew_a1.id, 'crew', created_by=self.admin)
        TeamService.assign_member(self.team_watcher.id, self.w_crew_a2.id, 'crew', created_by=self.admin)

        # Driver-led team
        self.team_driver = TeamService.create_team(name='Driver Led WF', code='WF-DL')
        TeamService.assign_member(self.team_driver.id, self.w_driver_leader.id, 'leader', created_by=self.admin)
        TeamService.assign_member(self.team_driver.id, self.w_crew_b1.id, 'crew', created_by=self.admin)
        TeamService.assign_member(self.team_driver.id, self.w_crew_b2.id, 'crew', created_by=self.admin)

        self.sched_watcher = CollectionSchedule.objects.create(
            area='Watcher Zone',
            truck=self.truck_1,
            driver=self.driver_member,
            dumpsite=self.dumpsite,
            default_team=self.team_watcher,
            days=self.weekday,
            start_time=time(6, 0),
            end_time=time(12, 0),
            waypoints=[
                {'lat': 13.9400, 'lng': 121.6200, 'label': 'Dumpsite Base'},
                {'lat': 13.9450, 'lng': 121.6250, 'label': 'Stop 1', 'barangay_id': self.barangay.id},
            ],
        )
        self.sched_watcher.barangays.add(self.barangay)

        self.sched_driver = CollectionSchedule.objects.create(
            area='Driver Zone',
            truck=self.truck_2,
            driver=self.driver_leader,
            dumpsite=self.dumpsite,
            default_team=self.team_driver,
            days=self.weekday,
            start_time=time(7, 0),
            end_time=time(13, 0),
            waypoints=[
                {'lat': 13.9400, 'lng': 121.6200, 'label': 'Dumpsite Base'},
                {'lat': 13.9460, 'lng': 121.6260, 'label': 'Stop 1', 'barangay_id': self.barangay.id},
            ],
        )
        self.sched_driver.barangays.add(self.barangay)

        self.alloc_watcher = AllocationService.allocate_truck_for_schedule(
            self.sched_watcher.id, self.today, self.truck_1.id, team_id=self.team_watcher.id, allocated_by=self.admin
        )
        self.alloc_driver = AllocationService.allocate_truck_for_schedule(
            self.sched_driver.id, self.today, self.truck_2.id, team_id=self.team_driver.id, allocated_by=self.admin
        )

    def _assert_no_immutable_table_updates(self, queries):
        protected = (
            'crew_attendance_record',
            'crew_attendance_correction',
            'shift_crew_roster_snapshot',
            'shift_crew_roster_item',
        )
        for q in queries:
            sql_upper = q['sql'].lstrip().upper()
            if sql_upper.startswith(('UPDATE ', 'DELETE ')):
                for tbl in protected:
                    self.assertNotIn(
                        tbl,
                        q['sql'].lower(),
                        f"Forbidden {sql_upper.split()[0]} executed on PG-immutable table {tbl}: {q['sql']}",
                    )

    def test_1_watcher_pre_departure_attendance_before_driver_shift_links_explicitly(self):
        # Watcher sees ONLY Watcher-led deployment
        self.client.force_authenticate(user=self.watcher_leader)
        list_res = self.client.get(f'/api/watcher/crew-attendance/deployments/?date={self.today}')
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        self.assertEqual([d['schedule_id'] for d in list_res.data], [self.sched_watcher.id])
        self.assertEqual(list_res.data[0]['attendance_status'], 'PENDING')
        self.assertTrue(list_res.data[0]['is_operationally_ready'])

        with CaptureQueriesContext(connection) as ctx:
            # Submit attendance before DriverShift or WatcherShift starts
            sub_res = self.client.post(
                f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
                {
                    'service_date': str(self.today),
                    'records': [
                        {'worker_id': self.w_crew_a1.id, 'status': 'PRESENT'},
                        {'worker_id': self.w_crew_a2.id, 'status': 'LATE'},
                    ],
                },
                format='json',
            )
            self.assertEqual(sub_res.status_code, status.HTTP_201_CREATED)
            self.assertTrue(sub_res.data['attendance_submitted'])
            self.assertIsNone(sub_res.data['deployment']['driver_shift_id'])

            cs = CrewShift.objects.get(allocation=self.alloc_watcher)
            self.assertIsNone(cs.driver_shift_id)
            self.assertIsNone(cs.watcher_shift_id)
            self.assertEqual(cs.team_leader_id, self.watcher_leader.id)
            self.assertEqual(cs.attendance_submitted_by_id, self.watcher_leader.id)
            self.assertIsNotNone(cs.attendance_submitted_at)
            self.assertEqual(CrewAttendanceRecord.objects.filter(crew_shift=cs).count(), 2)
            self.assertTrue(ShiftCrewRosterSnapshot.objects.filter(crew_shift=cs).exists())

            # Driver views my_team_roster BEFORE staging DriverShift -> sees saved attendance
            self.client.force_authenticate(user=self.driver_member)
            roster_res = self.client.get(f'/api/driver/shift/my_team_roster/?schedule_id={self.sched_watcher.id}')
            self.assertEqual(roster_res.status_code, status.HTTP_200_OK)
            self.assertTrue(roster_res.data['attendance_submitted'])
            self.assertTrue(roster_res.data['is_watcher_led'])
            self.assertFalse(roster_res.data['can_submit_attendance'])
            self.assertEqual(roster_res.data['crew_shift_id'], cs.id)
            self.assertEqual(len(roster_res.data['attendance_records']), 2)

            # Driver stages DriverShift independently -> links to existing CrewShift without duplicate snapshot
            pre_res = self.client.post('/api/driver/shift/pre_start/', {
                'schedule_id': self.sched_watcher.id,
                'allocation_id': self.alloc_watcher.id,
            }, format='json')
            self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)

            cs.refresh_from_db()
            self.assertEqual(cs.driver_shift_id, pre_res.data['id'])
            self.assertEqual(CrewShift.objects.filter(allocation=self.alloc_watcher).count(), 1)
            self.assertEqual(ShiftCrewRosterSnapshot.objects.filter(crew_shift=cs).count(), 1)

        self._assert_no_immutable_table_updates(ctx.captured_queries)

    def test_2_watcher_shift_start_after_attendance_attaches_explicitly(self):
        self.client.force_authenticate(user=self.watcher_leader)
        sub_res = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
            {
                'records': [
                    {'worker_id': self.w_crew_a1.id, 'status': 'PRESENT'},
                    {'worker_id': self.w_crew_a2.id, 'status': 'EXCUSED'},
                ],
            },
            format='json',
        )
        self.assertEqual(sub_res.status_code, status.HTTP_201_CREATED)

        ws_res = self.client.post('/api/driver/watcher-shifts/start/', {'schedule_id': self.sched_watcher.id}, format='json')
        self.assertEqual(ws_res.status_code, status.HTTP_201_CREATED)

        cs = CrewShift.objects.get(allocation=self.alloc_watcher)
        self.assertEqual(cs.watcher_shift_id, ws_res.data['id'])

    def test_3_independent_shift_starts_and_no_fabricated_crew_shift(self):
        # Driver starts without WatcherShift -> succeeds, and CrewShift is NOT fabricated
        self.client.force_authenticate(user=self.driver_member)
        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': self.sched_watcher.id,
            'allocation_id': self.alloc_watcher.id,
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)
        self.assertFalse(CrewShift.objects.filter(driver_shift_id=pre_res.data['id']).exists())

        # Watcher starts WatcherShift independently
        self.client.force_authenticate(user=self.watcher_leader)
        ws_res = self.client.post('/api/driver/watcher-shifts/start/', {'schedule_id': self.sched_watcher.id}, format='json')
        self.assertEqual(ws_res.status_code, status.HTTP_201_CREATED)

    def test_4_watcher_attendance_authz_duplicate_substitute_and_missing_dumpsite_guards(self):
        payload = {
            'records': [
                {'worker_id': self.w_crew_a1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_a2.id, 'status': 'ABSENT'},
            ],
        }
        # Non-designated Watcher, Driver, Admin, Citizen all get 403
        for user in (self.other_watcher, self.driver_member, self.admin, self.staff_admin, self.citizen):
            self.client.force_authenticate(user=user)
            res = self.client.post(
                f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
                payload,
                format='json',
            )
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN, f"Expected 403 for {user.username}")

        # Driver-led deployment rejected for Watcher
        self.client.force_authenticate(user=self.watcher_leader)
        res_drv_led = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_driver.id}/submit/',
            {
                'records': [
                    {'worker_id': self.w_crew_b1.id, 'status': 'PRESENT'},
                    {'worker_id': self.w_crew_b2.id, 'status': 'PRESENT'},
                ],
            },
            format='json',
        )
        self.assertEqual(res_drv_led.status_code, status.HTTP_403_FORBIDDEN)

        # SUBSTITUTE rejected
        res_sub = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
            {
                'records': [
                    {'worker_id': self.w_crew_a1.id, 'status': 'SUBSTITUTE'},
                    {'worker_id': self.w_crew_a2.id, 'status': 'PRESENT'},
                ],
            },
            format='json',
        )
        self.assertEqual(res_sub.status_code, status.HTTP_400_BAD_REQUEST)

        # Missing dumpsite rejected
        self.sched_watcher.dumpsite = None
        self.sched_watcher.save(update_fields=['dumpsite'])
        res_no_ds = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
            payload,
            format='json',
        )
        self.assertEqual(res_no_ds.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_no_ds.data.get('code'), 'missing_dumpsite')

        # Restore dumpsite, submit succeeds once, duplicate returns 409
        self.sched_watcher.dumpsite = self.dumpsite
        self.sched_watcher.save(update_fields=['dumpsite'])
        ok = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
            payload,
            format='json',
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED)

        dup = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
            payload,
            format='json',
        )
        self.assertEqual(dup.status_code, status.HTTP_409_CONFLICT)

        # Driver cannot submit or replace Watcher-led attendance
        self.client.force_authenticate(user=self.driver_member)
        drv_try = self.client.post('/api/driver/shift/submit-deployment-attendance/', {
            'schedule_id': self.sched_watcher.id,
            'attendance': payload['records'],
        }, format='json')
        self.assertEqual(drv_try.status_code, status.HTTP_403_FORBIDDEN)

    def test_5_watcher_submission_does_not_end_driver_shift_and_coordinated_closure_matches_timestamp(self):
        self.client.force_authenticate(user=self.watcher_leader)
        ws_res = self.client.post('/api/driver/watcher-shifts/start/', {'schedule_id': self.sched_watcher.id}, format='json')
        self.assertEqual(ws_res.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(user=self.driver_member)
        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': self.sched_watcher.id,
            'allocation_id': self.alloc_watcher.id,
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)
        shift_id = pre_res.data['id']

        # Watcher submits attendance -> DriverShift stays active
        self.client.force_authenticate(user=self.watcher_leader)
        sub_res = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
            {
                'records': [
                    {'worker_id': self.w_crew_a1.id, 'status': 'PRESENT'},
                    {'worker_id': self.w_crew_a2.id, 'status': 'PRESENT'},
                ],
            },
            format='json',
        )
        self.assertEqual(sub_res.status_code, status.HTTP_201_CREATED)
        shift = DriverShift.objects.get(id=shift_id)
        self.assertTrue(shift.is_active)

        # Driver ends DriverShift -> closes DriverShift, CrewShift, and WatcherShift with identical ended_at
        self.client.force_authenticate(user=self.driver_member)
        end_res = self.client.post('/api/driver/shift/end/', {'schedule_id': self.sched_watcher.id}, format='json')
        self.assertEqual(end_res.status_code, status.HTTP_200_OK)

        shift.refresh_from_db()
        cs = CrewShift.objects.get(driver_shift=shift)
        ws = WatcherShift.objects.get(id=ws_res.data['id'])
        self.assertFalse(shift.is_active)
        self.assertFalse(cs.is_active)
        self.assertFalse(ws.is_active)
        self.assertEqual(shift.ended_at, cs.ended_at)
        self.assertEqual(shift.ended_at, ws.ended_at)

    def test_6_driver_led_pre_departure_attendance_never_fabricates_watcher_shift(self):
        self.client.force_authenticate(user=self.driver_leader)
        roster_res = self.client.get(f'/api/driver/shift/my_team_roster/?schedule_id={self.sched_driver.id}')
        self.assertEqual(roster_res.status_code, status.HTTP_200_OK)
        self.assertTrue(roster_res.data['is_driver_team_leader'])
        self.assertTrue(roster_res.data['can_submit_attendance'])
        self.assertFalse(roster_res.data['is_watcher_led'])
        member_ids = {m['worker_id'] for m in roster_res.data['members']}
        self.assertEqual(member_ids, {self.w_crew_b1.id, self.w_crew_b2.id})
        self.assertNotIn(self.w_driver_leader.id, member_ids)

        sub_res = self.client.post('/api/driver/shift/submit-deployment-attendance/', {
            'schedule_id': self.sched_driver.id,
            'allocation_id': self.alloc_driver.id,
            'attendance': [
                {'worker_id': self.w_crew_b1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_b2.id, 'status': 'ABSENT'},
            ],
        }, format='json')
        self.assertEqual(sub_res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(sub_res.data['attendance_submitted'])
        self.assertEqual(WatcherShift.objects.count(), 0)

        cs = CrewShift.objects.get(id=sub_res.data['crew_shift_id'])
        self.assertIsNone(cs.watcher_shift_id)
        self.assertEqual(cs.team_leader_id, self.driver_leader.id)

        # Now Driver stages DriverShift -> links seamlessly
        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': self.sched_driver.id,
            'allocation_id': self.alloc_driver.id,
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)
        cs.refresh_from_db()
        self.assertEqual(cs.driver_shift_id, pre_res.data['id'])
        self.assertEqual(WatcherShift.objects.count(), 0)

    def test_7_ordinary_watcher_crew_member_does_not_block_driver_led_attendance(self):
        # Assigning a role='watcher' user as role_in_team='crew' is strictly rejected
        watcher_user_bad = User.objects.create_user(
            username='wf_watcher_crew', email='wf_watcher_crew@test.local', password='pw', role='watcher'
        )
        w_bad = Worker.objects.create(employee_id='WF-WC-BAD', full_name='Watcher Role Crew', user=watcher_user_bad)
        with self.assertRaises(ValidationError):
            TeamService.assign_member(self.team_driver.id, w_bad.id, 'crew', created_by=self.admin)

        # Assigning an eligible citizen crew_member succeeds and does not fabricate a WatcherShift
        crew_member_user = User.objects.create_user(
            username='wf_citizen_crew',
            email='wf_citizen_crew@test.local',
            password='pw',
            role='citizen',
            employee_type='crew_member',
        )
        w_wc = Worker.objects.create(employee_id='WF-WC1', full_name='Eligible Crew Member', user=crew_member_user)
        TeamService.assign_member(self.team_driver.id, w_wc.id, 'crew', created_by=self.admin)

        self.client.force_authenticate(user=self.driver_leader)
        res = self.client.post('/api/driver/shift/submit-deployment-attendance/', {
            'schedule_id': self.sched_driver.id,
            'attendance': [
                {'worker_id': self.w_crew_b1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_b2.id, 'status': 'LATE'},
                {'worker_id': w_wc.id, 'status': 'PRESENT'},
            ],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(WatcherShift.objects.count(), 0)

    def test_8_append_only_corrections_and_history_in_watcher_and_driver_endpoints(self):
        self.client.force_authenticate(user=self.watcher_leader)
        sub_res = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
            {
                'records': [
                    {'worker_id': self.w_crew_a1.id, 'status': 'ABSENT'},
                    {'worker_id': self.w_crew_a2.id, 'status': 'PRESENT'},
                ],
            },
            format='json',
        )
        self.assertEqual(sub_res.status_code, status.HTTP_201_CREATED)
        rec_id = sub_res.data['records'][0]['id']

        # Unauthorized users cannot correct
        for bad_user in (self.other_watcher, self.driver_member, self.citizen):
            self.client.force_authenticate(user=bad_user)
            bad = self.client.post(
                f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/correct/',
                {'attendance_record_id': rec_id, 'new_status': 'LATE', 'reason': 'Unauthorized'},
                format='json',
            )
            self.assertEqual(bad.status_code, status.HTTP_403_FORBIDDEN)

        # Original Watcher corrects ABSENT -> LATE
        self.client.force_authenticate(user=self.watcher_leader)
        corr_1 = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/correct/',
            {'attendance_record_id': rec_id, 'new_status': 'LATE', 'reason': 'Arrived at staging late'},
            format='json',
        )
        self.assertEqual(corr_1.status_code, status.HTTP_201_CREATED)

        # Staff-only admin (role='citizen', is_staff=True) also passes is_admin_user and can correct
        self.client.force_authenticate(user=self.staff_admin)
        corr_2 = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/correct/',
            {'attendance_record_id': rec_id, 'new_status': 'EXCUSED', 'reason': 'Medical certificate verified'},
            format='json',
        )
        self.assertEqual(corr_2.status_code, status.HTTP_201_CREATED)

        rec = CrewAttendanceRecord.objects.get(id=rec_id)
        self.assertEqual(rec.status, 'ABSENT')
        self.assertEqual(CrewAttendanceCorrection.objects.filter(original_record=rec).count(), 2)

        # Driver my_team_roster exposes full correction history
        self.client.force_authenticate(user=self.driver_member)
        roster_res = self.client.get(f'/api/driver/shift/my_team_roster/?schedule_id={self.sched_watcher.id}')
        self.assertEqual(roster_res.status_code, status.HTTP_200_OK)
        target_rec = next(r for r in roster_res.data['attendance_records'] if r['id'] == rec_id)
        self.assertEqual(target_rec['initial_status'], 'ABSENT')
        self.assertEqual(target_rec['effective_status'], 'EXCUSED')
        self.assertEqual(target_rec['latest_correction_reason'], 'Medical certificate verified')
        self.assertEqual(len(target_rec['corrections']), 2)

    def test_9_date_override_team_leader_enforced_in_watcher_queryset_and_attendance(self):
        # Override watcher-led schedule for today to team_driver (led by driver_leader)
        ScheduleTeamOverride.objects.create(
            schedule=self.sched_watcher,
            team=self.team_driver,
            effective_date=self.today,
            reason='Driver-led team covers today',
            created_by=self.admin,
        )
        self.alloc_watcher.team = self.team_driver
        self.alloc_watcher.save(update_fields=['team'])
        self.sched_watcher.driver = self.driver_leader
        self.sched_watcher.save(update_fields=['driver'])

        # Displaced Watcher no longer sees deployment and gets 403 on submit
        self.client.force_authenticate(user=self.watcher_leader)
        dep_res = self.client.get(f'/api/watcher/crew-attendance/deployments/?date={self.today}')
        self.assertEqual(dep_res.data, [])

        # Driver stages shift, displaced Watcher cannot see it in DriverShiftViewSet
        self.client.force_authenticate(user=self.driver_leader)
        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': self.sched_watcher.id,
            'allocation_id': self.alloc_watcher.id,
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)
        shift_id = pre_res.data['id']

        self.client.force_authenticate(user=self.watcher_leader)
        ds_list = self.client.get('/api/driver/shift/')
        rows = ds_list.data.get('results', ds_list.data) if isinstance(ds_list.data, dict) else ds_list.data
        self.assertNotIn(shift_id, [r['id'] for r in rows])

        # Effective team leader (driver_leader) submits attendance without fabricating WatcherShift
        self.client.force_authenticate(user=self.driver_leader)
        att_res = self.client.post('/api/driver/shift/submit-deployment-attendance/', {
            'schedule_id': self.sched_watcher.id,
            'attendance': [
                {'worker_id': self.w_crew_b1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_b2.id, 'status': 'PRESENT'},
            ],
        }, format='json')
        self.assertEqual(att_res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(WatcherShift.objects.count(), 0)

    def test_10_conclude_shift_atomic_skips_mismatched_and_unrelated_watcher_shifts(self):
        self.client.force_authenticate(user=self.watcher_leader)
        ws_linked = WatcherShift.objects.create(
            watcher=self.watcher_leader, schedule=self.sched_watcher, shift_date=self.today, is_active=True
        )
        ws_other = WatcherShift.objects.create(
            watcher=self.other_watcher, schedule=self.sched_driver, shift_date=self.today, is_active=True
        )
        shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver_member,
            schedule_id=self.sched_watcher.id,
            allocation_id=self.alloc_watcher.id,
        )
        ShiftService.record_initial_attendance(
            shift.id,
            [
                {'worker_id': self.w_crew_a1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_a2.id, 'status': 'PRESENT'},
            ],
            recorded_by=self.watcher_leader,
        )
        # Force a schedule mismatch on the linked WatcherShift
        CrewShift.objects.filter(driver_shift=shift).update(watcher_shift=ws_other)

        ShiftService.conclude_shift_atomic(shift.id, self.admin, end_reason='admin_force_ended')
        ws_other.refresh_from_db()
        ws_linked.refresh_from_db()
        self.assertTrue(ws_other.is_active)
        self.assertTrue(ws_linked.is_active)

    def test_11_truck_replacement_request_server_resolution_and_inspection_choices(self):
        self.client.force_authenticate(user=self.driver_member)
        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': self.sched_watcher.id,
            'allocation_id': self.alloc_watcher.id,
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)

        # Driver passes spoofed truck_id -> server ignores it and binds to alloc_watcher.truck (truck_1)
        req_res = self.client.post('/api/driver/shift/request-truck-replacement/', {
            'truck_id': self.truck_2.id,
            'reason': 'Hydraulic leak before departure',
        }, format='json')
        self.assertEqual(req_res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(req_res.data['truck_id'], self.truck_1.id)
        req_obj = TruckReplacementRequest.objects.get(id=req_res.data['id'])
        self.assertEqual(req_obj.status, 'PENDING')
        self.assertEqual(req_obj.truck_id, self.truck_1.id)

        # Driver cannot execute replace-truck (403)
        exec_res = self.client.post(f'/api/driver/trucks/{self.truck_1.id}/replace-truck/', {
            'replacement_truck_id': self.truck_3.id,
            'schedule_id': self.sched_watcher.id,
            'reason': 'Attempt self replace',
        }, format='json')
        self.assertEqual(exec_res.status_code, status.HTTP_403_FORBIDDEN)

        # TruckService.update_inspection_state aligns strictly with Truck TextChoices
        with self.assertRaises(ValidationError):
            TruckService.update_inspection_state(self.truck_3, user=self.admin, inspection_state='PENDING')
        with self.assertRaises(ValidationError):
            TruckService.update_inspection_state(
                self.truck_3, user=self.admin, inspection_state='FAILED', mechanical_condition='MINOR_DEFECT'
            )

        self.truck_3.last_inspected_dumpsite = self.dumpsite
        self.truck_3.save(update_fields=['last_inspected_dumpsite'])
        updated = TruckService.update_inspection_state(
            self.truck_3,
            user=self.operator,
            inspection_state='PENDING_INSPECTION',
            mechanical_condition='NEEDS_REPAIR',
            reason='Needs brake check',
        )
        self.assertEqual(updated.inspection_state, 'PENDING_INSPECTION')
        self.assertEqual(updated.mechanical_condition, 'NEEDS_REPAIR')

    def test_12_is_admin_user_consistency_across_accounts_analytics_and_watcher(self):
        # Test both role='admin', is_staff=False AND role='citizen', is_staff=True
        for adm in (self.admin, self.staff_admin):
            self.client.force_authenticate(user=adm)
            with self.subTest(admin=adm.username):
                res_users = self.client.get('/api/accounts/users/')
                self.assertEqual(res_users.status_code, status.HTTP_200_OK)

                res_overview = self.client.get('/api/analytics/system-overview/')
                self.assertEqual(res_overview.status_code, status.HTTP_200_OK)

                res_export = self.client.get('/api/analytics/export/')
                self.assertEqual(res_export.status_code, status.HTTP_200_OK)

                hotspot = GarbageHotspot.objects.create(
                    name='Admin Test Hotspot',
                    barangay=self.barangay,
                    latitude=13.94,
                    longitude=121.62,
                    assigned_truck=self.truck_1,
                )
                interv = HotspotIntervention.objects.create(
                    hotspot=hotspot,
                    intervention_type=InterventionType.DISPATCH,
                    truck=self.truck_1,
                    created_by=adm,
                )
                res_cancel = self.client.post(f'/api/watcher/interventions/{interv.id}/cancel/', {}, format='json')
                self.assertEqual(res_cancel.status_code, status.HTTP_200_OK)

                esc = Escalation.objects.create(
                    title='Admin Escalation Check',
                    issue_type='missed',
                    raised_by='Watcher Test',
                    barangay=self.barangay,
                    driver=self.driver_member,
                    truck=self.truck_1,
                    notes='Check',
                    status='pending',
                )
                res_esc = self.client.get('/api/escalations/')
                self.assertEqual(res_esc.status_code, status.HTTP_200_OK)
                esc_rows = res_esc.data.get('results', res_esc.data) if isinstance(res_esc.data, dict) else res_esc.data
                self.assertTrue(any(r['id'] == esc.id for r in esc_rows))

    def test_13_allowany_active_shifts_does_not_sweep_or_mutate_on_anonymous_get(self):
        stale_time = timezone.now() - timedelta(hours=10)
        stale_shift = DriverShift.objects.create(
            driver=self.driver_member,
            truck=self.truck_1,
            schedule=self.sched_watcher,
            is_active=True,
        )
        DriverShift.objects.filter(id=stale_shift.id).update(
            started_at=stale_time,
            last_location_update=stale_time,
        )
        cache.delete('shift_sweep_lock')
        self.client.force_authenticate(user=None)
        with patch('driver.management.commands.sweep_stale_shifts.sweep_stale_shifts') as mock_sweep:
            res = self.client.get('/api/driver/shift/active_shifts/')
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            mock_sweep.assert_not_called()
        stale_shift.refresh_from_db()
        self.assertTrue(stale_shift.is_active)

    def test_14_attendance_submission_rejects_cancelled_completed_and_unavailable_schedules(self):
        payload = {
            'service_date': str(self.today),
            'records': [
                {'worker_id': self.w_crew_a1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_a2.id, 'status': 'PRESENT'},
            ],
        }
        self.client.force_authenticate(user=self.watcher_leader)

        for field, val in (('status', 'CANCELLED'), ('status', 'COMPLETED'), ('is_available', False)):
            orig_val = getattr(self.sched_watcher, field)
            setattr(self.sched_watcher, field, val)
            self.sched_watcher.save(update_fields=[field])
            try:
                res = self.client.post(
                    f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
                    payload,
                    format='json',
                )
                self.assertEqual(
                    res.status_code,
                    status.HTTP_400_BAD_REQUEST,
                    f'Expected 400 when {field}={val!r}, got {res.status_code}',
                )
                self.assertEqual(CrewShift.objects.filter(schedule=self.sched_watcher).count(), 0)

                with self.assertRaises(ValidationError):
                    ShiftService.record_deployment_attendance(
                        schedule_id=self.sched_watcher.id,
                        service_date=self.today,
                        attendance_list=payload['records'],
                        recorded_by=self.watcher_leader,
                        allocation_id=self.alloc_watcher.id,
                    )
            finally:
                setattr(self.sched_watcher, field, orig_val)
                self.sched_watcher.save(update_fields=[field])

    def test_15_active_shift_conflict_returns_409_on_both_initial_attendance_endpoints_and_watcher_start(self):
        from driver.models import ShiftCrewRosterItem

        # Create a second watcher-led schedule/team so watcher_leader can conflict across schedules
        sched_watcher_2 = CollectionSchedule.objects.create(
            area='Watcher Zone 2',
            truck=self.truck_2,
            driver=self.driver_member,
            dumpsite=self.dumpsite,
            default_team=self.team_watcher,
            days=self.weekday,
            start_time=time(13, 0),
            end_time=time(17, 0),
        )

        # Put crew_a1 on an unrelated active pre-departure CrewShift
        other_team = TeamService.create_team(name='Other Conflict Team', code='OCT-1')
        other_cs = CrewShift.objects.create(team=other_team, service_date=self.today, is_active=True)
        other_snap = ShiftCrewRosterSnapshot.objects.create(crew_shift=other_cs, staged_by=self.admin)
        ShiftCrewRosterItem.objects.create(
            snapshot=other_snap, worker=self.w_crew_a1, role_in_roster='crew', is_present=True
        )

        # 1. WatcherCrewAttendanceSubmitView returns 409 Conflict
        self.client.force_authenticate(user=self.watcher_leader)
        res_watcher = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.sched_watcher.id}/submit/',
            {
                'service_date': str(self.today),
                'records': [
                    {'worker_id': self.w_crew_a1.id, 'status': 'PRESENT'},
                    {'worker_id': self.w_crew_a2.id, 'status': 'PRESENT'},
                ],
            },
            format='json',
        )
        self.assertEqual(res_watcher.status_code, status.HTTP_409_CONFLICT)

        # 2. DriverShiftViewSet.attendance returns 409 Conflict when a crew member becomes active on another shift after DriverShift staging
        other_cs.is_active = False
        other_cs.save(update_fields=['is_active'])

        self.client.force_authenticate(user=self.driver_member)
        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': self.sched_watcher.id,
            'allocation_id': self.alloc_watcher.id,
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)
        shift_id = pre_res.data['id']

        other_cs.is_active = True
        other_cs.save(update_fields=['is_active'])

        self.client.force_authenticate(user=self.watcher_leader)
        res_drv_att = self.client.post(
            f'/api/driver/shift/{shift_id}/attendance/',
            {
                'attendance': [
                    {'worker_id': self.w_crew_a1.id, 'status': 'PRESENT'},
                    {'worker_id': self.w_crew_a2.id, 'status': 'PRESENT'},
                ],
            },
            format='json',
        )
        self.assertEqual(res_drv_att.status_code, status.HTTP_409_CONFLICT)

        # Clean up conflict and stage pre-departure CrewShift led by watcher_leader on sched_watcher
        other_cs.is_active = False
        other_cs.save(update_fields=['is_active'])
        DriverShift.objects.filter(id=shift_id).update(is_active=False)

        CrewShift.objects.create(
            schedule=self.sched_watcher,
            service_date=self.today,
            team=self.team_watcher,
            team_leader=self.watcher_leader,
            watcher_shift=None,
            is_active=True,
        )

        # 3. WatcherShiftViewSet.start_shift on sched_watcher_2 returns 409 Conflict due to active CrewShift on sched_watcher
        self.client.force_authenticate(user=self.watcher_leader)
        res_ws_start = self.client.post(
            '/api/driver/watcher-shifts/start/',
            {'schedule_id': sched_watcher_2.id},
            format='json',
        )
        self.assertEqual(res_ws_start.status_code, status.HTTP_409_CONFLICT)

