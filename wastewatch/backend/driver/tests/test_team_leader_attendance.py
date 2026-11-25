from datetime import time
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User
from dumpsite.models import Dumpsite
from driver.allocation_service import AllocationService
from driver.models import (
    CollectionSchedule,
    CrewAttendanceCorrection,
    CrewAttendanceRecord,
    CrewShift,
    DriverShift,
    SanitationTeam,
    SanitationTeamMembership,
    ScheduleTeamOverride,
    Truck,
    WatcherShift,
    Worker,
)
from driver.team_service import (
    TeamService,
    DeploymentTeamLeaderResult,
    resolve_deployment_team_leader,
)


class TeamLeaderAttendanceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.today = timezone.localdate()

        self.admin = User.objects.create_user(
            username='tl_admin', email='tl_admin@test.local', password='pw', role='admin', is_staff=True
        )
        self.watcher = User.objects.create_user(
            username='tl_watcher', email='tl_watcher@test.local', password='pw', role='watcher', full_name='Watcher Leader'
        )
        self.driver_leader = User.objects.create_user(
            username='tl_driver_leader', email='tl_driver_leader@test.local', password='pw', role='driver', full_name='Driver Leader'
        )
        self.driver_member = User.objects.create_user(
            username='tl_driver_member', email='tl_driver_member@test.local', password='pw', role='driver', full_name='Regular Driver'
        )

        self.w_watcher = Worker.objects.create(
            employee_id='W-TL-01', full_name='Watcher Leader', user=self.watcher
        )
        self.w_driver_leader = Worker.objects.create(
            employee_id='W-TL-02', full_name='Driver Leader', user=self.driver_leader
        )
        self.w_driver_member = Worker.objects.create(
            employee_id='W-TL-03', full_name='Regular Driver', user=self.driver_member
        )
        self.w_crew_1 = Worker.objects.create(employee_id='W-TL-04', full_name='Crew One')
        self.w_crew_2 = Worker.objects.create(employee_id='W-TL-05', full_name='Crew Two')

        self.barangay = Barangay.objects.create(name='TL Test Brgy')
        self.dumpsite = Dumpsite.objects.create(
            name='TL Test Dumpsite',
            barangay=self.barangay,
            latitude=13.94,
            longitude=121.62,
        )
        self.truck = Truck.objects.create(
            plate_number='TL-1001',
            model='Isuzu Elf',
            commissioning_provenance='commissioned_verified',
            commissioned_at=timezone.now(),
            retirement_state='operational',
        )

    def _make_schedule(self, team, driver_user, area='TL Zone'):
        weekday = self.today.strftime('%A')
        return CollectionSchedule.objects.create(
            area=area,
            truck=self.truck,
            driver=driver_user,
            dumpsite=self.dumpsite,
            default_team=team,
            days=weekday,
            start_time=time(6, 0),
            end_time=time(12, 0),
        )

    def _setup_driver_led_team(self):
        team = TeamService.create_team(name='Driver Led Team', code='DLT-01')
        TeamService.assign_member(team.id, self.w_driver_leader.id, 'leader', created_by=self.admin)
        TeamService.assign_member(team.id, self.w_crew_1.id, 'crew', created_by=self.admin)
        TeamService.assign_member(team.id, self.w_crew_2.id, 'crew', created_by=self.admin)
        schedule = self._make_schedule(team, self.driver_leader, area='Driver Led Zone')
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule.id, self.today, self.truck.id, team_id=team.id, allocated_by=self.admin
        )
        return team, schedule, alloc

    def _setup_watcher_led_team(self):
        team = TeamService.create_team(name='Watcher Led Team', code='WLT-01')
        TeamService.assign_member(team.id, self.w_watcher.id, 'leader', created_by=self.admin)
        TeamService.assign_member(team.id, self.w_driver_member.id, 'driver', created_by=self.admin)
        TeamService.assign_member(team.id, self.w_crew_1.id, 'crew', created_by=self.admin)
        TeamService.assign_member(team.id, self.w_crew_2.id, 'crew', created_by=self.admin)
        schedule = self._make_schedule(team, self.driver_member, area='Watcher Led Zone')
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule.id, self.today, self.truck.id, team_id=team.id, allocated_by=self.admin
        )
        return team, schedule, alloc

    def test_1_watcher_team_leader_submits_attendance_and_driver_cannot(self):
        _, schedule, alloc = self._setup_watcher_led_team()

        self.client.force_authenticate(user=self.watcher)
        res = self.client.post('/api/driver/watcher-shifts/start/', {'schedule_id': schedule.id}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(user=self.driver_member)
        roster_res = self.client.get(f'/api/driver/shift/my_team_roster/?schedule_id={schedule.id}')
        self.assertEqual(roster_res.status_code, status.HTTP_200_OK)
        self.assertFalse(roster_res.data['can_submit_attendance'])
        self.assertTrue(roster_res.data['has_watcher_assigned'])

        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'LATE'},
            ],
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_403_FORBIDDEN)

        # Stage without attendance succeeds for driver
        pre_ok = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
        }, format='json')
        self.assertEqual(pre_ok.status_code, status.HTTP_201_CREATED)
        shift_id = pre_ok.data['id']

        # Watcher submits initial attendance including LATE
        self.client.force_authenticate(user=self.watcher)
        att_res = self.client.post(f'/api/driver/shift/{shift_id}/attendance/', {
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'LATE'},
            ],
        }, format='json')
        self.assertEqual(att_res.status_code, status.HTTP_201_CREATED)
        crew_shift = CrewShift.objects.get(driver_shift_id=shift_id)
        self.assertEqual(crew_shift.team_leader_id, self.watcher.id)
        self.assertEqual(crew_shift.attendance_submitted_by_id, self.watcher.id)

    def test_2_driver_team_leader_no_watcher_stages_and_submits_attendance(self):
        _, schedule, alloc = self._setup_driver_led_team()
        self.client.force_authenticate(user=self.driver_leader)

        roster_res = self.client.get(f'/api/driver/shift/my_team_roster/?schedule_id={schedule.id}')
        self.assertEqual(roster_res.status_code, status.HTTP_200_OK)
        self.assertTrue(roster_res.data['is_driver_team_leader'])
        self.assertFalse(roster_res.data['has_watcher_assigned'])
        self.assertTrue(roster_res.data['can_submit_attendance'])
        crew_ids = {m['worker_id'] for m in roster_res.data['crew_members']}
        self.assertEqual(crew_ids, {self.w_crew_1.id, self.w_crew_2.id})
        self.assertNotIn(self.w_driver_leader.id, crew_ids)

        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'LATE'},
                {'worker_id': self.w_crew_2.id, 'status': 'EXCUSED'},
            ],
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(pre_res.data['attendance_submitted'])

        shift = DriverShift.objects.get(pk=pre_res.data['id'])
        crew_shift = shift.crew_shift
        self.assertIsNone(crew_shift.watcher_shift_id)
        self.assertEqual(crew_shift.team_leader_id, self.driver_leader.id)
        self.assertEqual(crew_shift.attendance_submitted_by_id, self.driver_leader.id)
        self.assertEqual(WatcherShift.objects.count(), 0)

        statuses = dict(
            CrewAttendanceRecord.objects.filter(driver_shift=shift).values_list('worker_id', 'status')
        )
        self.assertEqual(statuses, {self.w_crew_1.id: 'LATE', self.w_crew_2.id: 'EXCUSED'})

    def test_3_other_driver_not_team_leader_rejected(self):
        _, schedule, alloc = self._setup_watcher_led_team()
        self.client.force_authenticate(user=self.watcher)
        self.client.post('/api/driver/watcher-shifts/start/', {'schedule_id': schedule.id}, format='json')

        self.client.force_authenticate(user=self.driver_member)
        pre_ok = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
        }, format='json')
        shift_id = pre_ok.data['id']

        att_res = self.client.post(f'/api/driver/shift/{shift_id}/attendance/', {
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'ABSENT'},
            ],
        }, format='json')
        self.assertIn(att_res.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))

    def test_4_admin_cannot_submit_initial_attendance(self):
        _, schedule, alloc = self._setup_driver_led_team()
        self.client.force_authenticate(user=self.driver_leader)
        pre_ok = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
        }, format='json')
        shift_id = pre_ok.data['id']

        self.client.force_authenticate(user=self.admin)
        att_res = self.client.post(f'/api/driver/shift/{shift_id}/attendance/', {
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'PRESENT'},
            ],
        }, format='json')
        self.assertIn(att_res.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))

    def test_5_driver_team_leader_does_not_receive_watcher_permissions(self):
        _, schedule, _ = self._setup_driver_led_team()
        self.driver_leader.refresh_from_db()
        self.assertEqual(self.driver_leader.role, 'driver')

        self.client.force_authenticate(user=self.driver_leader)
        res = self.client.post('/api/driver/watcher-shifts/start/', {'schedule_id': schedule.id}, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_6_duplicate_and_conflicting_attendance_prevented(self):
        _, schedule, alloc = self._setup_driver_led_team()
        self.client.force_authenticate(user=self.driver_leader)

        first = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'ABSENT'},
            ],
        }, format='json')
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        # Idempotent retry succeeds without duplicating records
        retry = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'ABSENT'},
            ],
        }, format='json')
        self.assertEqual(retry.status_code, status.HTTP_200_OK)
        self.assertEqual(CrewAttendanceRecord.objects.filter(driver_shift_id=first.data['id']).count(), 2)

        # Conflicting resubmit is rejected
        conflict = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'LATE'},
                {'worker_id': self.w_crew_2.id, 'status': 'ABSENT'},
            ],
        }, format='json')
        self.assertEqual(conflict.status_code, status.HTTP_400_BAD_REQUEST)

    def test_7_append_only_corrections_by_driver_team_leader_and_admin(self):
        _, schedule, alloc = self._setup_driver_led_team()
        self.client.force_authenticate(user=self.driver_leader)
        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'ABSENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'PRESENT'},
            ],
        }, format='json')
        shift_id = pre_res.data['id']
        rec = CrewAttendanceRecord.objects.get(driver_shift_id=shift_id, worker=self.w_crew_1)

        # Other driver cannot correct (404 via ViewSet queryset isolation or 403 via service)
        self.client.force_authenticate(user=self.driver_member)
        other_corr = self.client.post(f'/api/driver/shift/{shift_id}/attendance-correction/', {
            'record_id': rec.id,
            'corrected_status': 'LATE',
            'reason': 'Arrived late',
        }, format='json')
        self.assertIn(other_corr.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))

        # Original submitting Driver-Team Leader can correct
        self.client.force_authenticate(user=self.driver_leader)
        dl_corr = self.client.post(f'/api/driver/shift/{shift_id}/attendance-correction/', {
            'record_id': rec.id,
            'corrected_status': 'LATE',
            'reason': 'Arrived 10 mins after roll-call',
        }, format='json')
        self.assertEqual(dl_corr.status_code, status.HTTP_201_CREATED)

        # Admin can also correct
        self.client.force_authenticate(user=self.admin)
        admin_corr = self.client.post(f'/api/driver/shift/{shift_id}/attendance-correction/', {
            'record_id': rec.id,
            'corrected_status': 'EXCUSED',
            'reason': 'Verified medical note',
        }, format='json')
        self.assertEqual(admin_corr.status_code, status.HTTP_201_CREATED)

        rec.refresh_from_db()
        self.assertEqual(rec.status, 'ABSENT')  # initial record remains immutable
        self.assertEqual(CrewAttendanceCorrection.objects.filter(original_record=rec).count(), 2)

    def test_8_driver_shift_end_closes_crew_shift_and_preserves_attendance(self):
        _, schedule, alloc = self._setup_driver_led_team()
        self.client.force_authenticate(user=self.driver_leader)
        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'LATE'},
            ],
        }, format='json')
        shift_id = pre_res.data['id']

        end_res = self.client.post('/api/driver/shift/end/', {'end_reason': 'completed'}, format='json')
        self.assertEqual(end_res.status_code, status.HTTP_200_OK)

        shift = DriverShift.objects.get(pk=shift_id)
        crew_shift = CrewShift.objects.get(driver_shift=shift)
        self.assertFalse(shift.is_active)
        self.assertFalse(crew_shift.is_active)
        self.assertIsNotNone(crew_shift.ended_at)
        self.assertEqual(CrewAttendanceRecord.objects.filter(driver_shift=shift).count(), 2)

    def test_9_unrelated_watcher_membership_does_not_block_driver_leader(self):
        team, schedule, alloc = self._setup_driver_led_team()
        unrelated_watcher = User.objects.create_user(
            username='tl_unrelated_watcher',
            email='tl_unrelated_watcher@test.local',
            password='pw',
            role='watcher',
            full_name='Unrelated Watcher',
        )
        w_unrelated = Worker.objects.create(
            employee_id='W-TL-99', full_name='Unrelated Watcher', user=unrelated_watcher
        )
        from driver.models import SanitationTeamMembership
        SanitationTeamMembership.objects.create(
            team=team, worker=w_unrelated, role_in_team='crew', is_active=True, created_by=self.admin
        )

        self.client.force_authenticate(user=self.driver_leader)
        roster_res = self.client.get(f'/api/driver/shift/my_team_roster/?schedule_id={schedule.id}')
        self.assertEqual(roster_res.status_code, status.HTTP_200_OK)
        self.assertFalse(roster_res.data['has_watcher_assigned'])
        self.assertTrue(roster_res.data['can_submit_attendance'])

        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'PRESENT'},
                {'worker_id': w_unrelated.id, 'status': 'LATE'},
            ],
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(pre_res.data['attendance_submitted'])
        self.assertEqual(CrewShift.objects.filter(driver_shift_id=pre_res.data['id']).count(), 1)

    def test_10_admin_force_end_closes_driver_led_crew_shift(self):
        _, schedule, alloc = self._setup_driver_led_team()
        self.client.force_authenticate(user=self.driver_leader)
        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'EXCUSED'},
            ],
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)
        shift_id = pre_res.data['id']

        self.client.force_authenticate(user=self.admin)
        force_res = self.client.post(f'/api/driver/shift/{shift_id}/force-end/', {}, format='json')
        self.assertEqual(force_res.status_code, status.HTTP_200_OK)

        shift = DriverShift.objects.get(pk=shift_id)
        crew_shift = CrewShift.objects.get(driver_shift=shift)
        self.assertFalse(shift.is_active)
        self.assertFalse(crew_shift.is_active)
        self.assertIsNotNone(crew_shift.ended_at)
        self.assertIsNone(crew_shift.watcher_shift_id)

    def test_11_resolve_deployment_team_leader_default(self):
        # 1. Watcher-led default team
        team_w, schedule_w, _ = self._setup_watcher_led_team()
        res_w = resolve_deployment_team_leader(schedule_w, self.today)
        self.assertIsInstance(res_w, DeploymentTeamLeaderResult)
        self.assertEqual(res_w.user.id, self.watcher.id)
        self.assertEqual(res_w.worker.id, self.w_watcher.id)
        self.assertEqual(res_w.team.id, team_w.id)
        self.assertEqual(res_w.leadership_mode, 'watcher')
        self.assertTrue(res_w.has_watcher_assigned)
        self.assertFalse(res_w.is_driver_team_leader)
        self.assertNotIn('source', res_w.to_dict())
        self.assertNotIn('is_override', res_w.to_dict())

        # 2. Driver-led default team with dedicated crew members
        w_crew_3 = Worker.objects.create(employee_id='W-TL-08', full_name='Crew Three')
        w_crew_4 = Worker.objects.create(employee_id='W-TL-09', full_name='Crew Four')
        team_d = TeamService.create_team(name='Driver Led Team 11', code='DLT-11')
        TeamService.assign_member(team_d.id, self.w_driver_leader.id, 'leader', created_by=self.admin)
        TeamService.assign_member(team_d.id, w_crew_3.id, 'crew', created_by=self.admin)
        TeamService.assign_member(team_d.id, w_crew_4.id, 'crew', created_by=self.admin)
        schedule_d = self._make_schedule(team_d, self.driver_leader, area='Driver Led Zone 11')

        res_d = resolve_deployment_team_leader(schedule_d, self.today)
        self.assertEqual(res_d.user.id, self.driver_leader.id)
        self.assertEqual(res_d.worker.id, self.w_driver_leader.id)
        self.assertEqual(res_d.team.id, team_d.id)
        self.assertEqual(res_d.leadership_mode, 'driver')
        self.assertFalse(res_d.has_watcher_assigned)
        self.assertTrue(res_d.is_driver_team_leader)

    def test_12_date_team_override_precedence_and_missing_leader_rejection(self):
        # 1. Missing default leader raises ValidationError
        w_no_leader_crew = Worker.objects.create(employee_id='W-TL-12NL', full_name='Crew No Leader 12')
        team_no_leader = TeamService.create_team(name='No Leader Team 12', code='NLT-12')
        TeamService.assign_member(team_no_leader.id, w_no_leader_crew.id, 'crew', created_by=self.admin)
        sched_no_leader = self._make_schedule(team_no_leader, self.driver_member, area='No Leader Zone 12')

        with self.assertRaises(ValidationError) as ctx:
            resolve_deployment_team_leader(sched_no_leader, self.today)
        self.assertIn('no active Team Leader', str(ctx.exception))

        # 2. Schedule default team vs date-specific ScheduleTeamOverride team precedence
        team_w, schedule, _ = self._setup_watcher_led_team()
        w_crew_3 = Worker.objects.create(employee_id='W-TL-12C', full_name='Crew 12C')
        team_ov = TeamService.create_team(name='Override Driver Team 12', code='ODT-12')
        TeamService.assign_member(team_ov.id, self.w_driver_leader.id, 'leader', created_by=self.admin)
        TeamService.assign_member(team_ov.id, w_crew_3.id, 'crew', created_by=self.admin)

        res_default = resolve_deployment_team_leader(schedule, self.today)
        self.assertEqual(res_default.team.id, team_w.id)
        self.assertEqual(res_default.user.id, self.watcher.id)
        self.assertEqual(res_default.leadership_mode, 'watcher')

        ScheduleTeamOverride.objects.create(
            schedule=schedule,
            team=team_ov,
            effective_date=self.today,
            created_by=self.admin,
        )
        res_ov = resolve_deployment_team_leader(schedule, self.today)
        self.assertEqual(res_ov.team.id, team_ov.id)
        self.assertEqual(res_ov.user.id, self.driver_leader.id)
        self.assertEqual(res_ov.leadership_mode, 'driver')
        self.assertFalse(res_ov.has_watcher_assigned)
        self.assertTrue(res_ov.is_driver_team_leader)

        # Different date without override uses schedule default team
        other_date = self.today + timezone.timedelta(days=1)
        res_other = resolve_deployment_team_leader(schedule, other_date)
        self.assertEqual(res_other.team.id, team_w.id)
        self.assertEqual(res_other.user.id, self.watcher.id)

    def test_13_transferred_and_inactive_leader_rejected_without_fallback(self):
        team_w, schedule, _ = self._setup_watcher_led_team()
        team_other = TeamService.create_team(name='Other Team 13', code='OT-13')

        # 1. Transferred leader leaves team with no leader -> raises ValidationError (no fallback to driver/crew)
        TeamService.transfer_member(self.w_watcher.id, team_other.id, 'leader', authorized_by=self.admin)
        with self.assertRaises(ValidationError) as ctx1:
            resolve_deployment_team_leader(schedule, self.today)
        self.assertIn('no active Team Leader', str(ctx1.exception))

        # 2. Inactive leader user rejected without fallback
        TeamService.transfer_member(self.w_watcher.id, team_w.id, 'leader', authorized_by=self.admin)
        self.watcher.is_active = False
        self.watcher.save(update_fields=['is_active'])
        with self.assertRaises(ValidationError) as ctx2:
            resolve_deployment_team_leader(schedule, self.today)
        self.assertIn('inactive', str(ctx2.exception))

        # 3. Inactive leader worker profile rejected without fallback
        self.watcher.is_active = True
        self.watcher.save(update_fields=['is_active'])
        self.w_watcher.is_active = False
        self.w_watcher.save(update_fields=['is_active'])
        with self.assertRaises(ValidationError) as ctx3:
            resolve_deployment_team_leader(schedule, self.today)
        self.assertIn('no active Worker profile', str(ctx3.exception))

    def test_14_unlinked_worker_and_ineligible_roles_rejected(self):
        # 1. Unlinked default leader worker rejected
        team_unlinked = TeamService.create_team(name='Unlinked Leader Team 14', code='ULT-14')
        w_unlinked = Worker.objects.create(employee_id='W-TL-UNL14', full_name='Unlinked Leader', user=None)
        SanitationTeamMembership.objects.create(
            team=team_unlinked, worker=w_unlinked, role_in_team='leader', is_active=True, created_by=self.admin
        )
        sched_unlinked = self._make_schedule(team_unlinked, self.driver_leader, area='Unlinked Zone 14')
        with self.assertRaises(ValidationError) as ctx_unl:
            resolve_deployment_team_leader(sched_unlinked, self.today)
        self.assertIn('not linked to a user account', str(ctx_unl.exception))

        # 2. Ineligible admin and citizen roles rejected as leader
        team_role = TeamService.create_team(name='Ineligible Role Team 14', code='IRT-14')
        w_admin = Worker.objects.create(employee_id='W-TL-ADM14', full_name='Admin Worker', user=self.admin)
        citizen = User.objects.create_user(
            username='tl_citizen14', email='tl_citizen14@test.local', password='pw',
            role='citizen', employee_type='crew_member', full_name='Citizen Crew 14'
        )
        w_citizen = Worker.objects.create(employee_id='W-TL-CIT14', full_name='Citizen Crew 14', user=citizen)
        SanitationTeamMembership.objects.create(
            team=team_role, worker=w_admin, role_in_team='leader', is_active=True, created_by=self.admin
        )
        sched_role = self._make_schedule(team_role, self.driver_member, area='Ineligible Zone 14')

        with self.assertRaises(ValidationError) as ctx_adm:
            resolve_deployment_team_leader(sched_role, self.today)
        self.assertIn("Only users with system role 'watcher' or 'driver' are eligible", str(ctx_adm.exception))

        SanitationTeamMembership.objects.filter(team=team_role).delete()
        SanitationTeamMembership.objects.create(
            team=team_role, worker=w_citizen, role_in_team='leader', is_active=True, created_by=self.admin
        )
        with self.assertRaises(ValidationError) as ctx_cit:
            resolve_deployment_team_leader(sched_role, self.today)
        self.assertIn("Only users with system role 'watcher' or 'driver' are eligible", str(ctx_cit.exception))

    def test_15_serializer_exposes_resolved_leader_fields_and_handles_missing_team(self):
        from driver.serializers import CollectionScheduleSerializer, ScheduleTeamOverrideSerializer

        # 1. Schedule with no default_team serializes gracefully with None
        sched_empty = self._make_schedule(None, self.driver_member, area='Empty Team Zone 15')
        empty_data = CollectionScheduleSerializer(sched_empty).data
        self.assertIsNone(empty_data['effective_team_leader_id'])
        self.assertIsNone(empty_data['effective_team_leader_name'])
        self.assertIsNone(empty_data['effective_team_leader_role'])
        self.assertNotIn('designated_leader_name', empty_data)
        self.assertNotIn('effective_team_leader_source', empty_data)
        self.assertNotIn('effective_team_leader_is_override', empty_data)

        # 2. Watcher-led schedule serializes effective leader
        team_w, schedule, _ = self._setup_watcher_led_team()
        default_data = CollectionScheduleSerializer(schedule).data
        self.assertEqual(default_data['effective_team_leader_id'], self.watcher.id)
        self.assertEqual(default_data['effective_team_leader_name'], self.w_watcher.full_name)
        self.assertEqual(default_data['effective_team_leader_role'], 'watcher')

        # 3. Date team override serializes effective leader for both serializers
        w_crew_3 = Worker.objects.create(employee_id='W-TL-15C', full_name='Crew 15C')
        team_ov = TeamService.create_team(name='Override Driver Team 15', code='ODT-15')
        TeamService.assign_member(team_ov.id, self.w_driver_leader.id, 'leader', created_by=self.admin)
        TeamService.assign_member(team_ov.id, w_crew_3.id, 'crew', created_by=self.admin)

        override = ScheduleTeamOverride.objects.create(
            schedule=schedule,
            team=team_ov,
            effective_date=self.today,
            created_by=self.admin,
        )
        ov_sched_data = CollectionScheduleSerializer(schedule).data
        self.assertEqual(ov_sched_data['effective_team_leader_id'], self.driver_leader.id)
        self.assertEqual(ov_sched_data['effective_team_leader_role'], 'driver')

        ov_data = ScheduleTeamOverrideSerializer(override).data
        self.assertEqual(ov_data['effective_team_leader_id'], self.driver_leader.id)
        self.assertEqual(ov_data['effective_team_leader_name'], self.w_driver_leader.full_name)
        self.assertEqual(ov_data['effective_team_leader_role'], 'driver')
        self.assertNotIn('leader_override', ov_data)
        self.assertNotIn('leader_override_name', ov_data)

    def test_16_date_team_override_leader_submits_attendance_and_default_team_leader_cannot(self):
        _, schedule, _ = self._setup_watcher_led_team()
        team_ov = TeamService.create_team(name='Override Driver Team 16', code='ODT-16')
        TeamService.assign_member(team_ov.id, self.w_driver_leader.id, 'leader', created_by=self.admin)
        SanitationTeamMembership.objects.filter(worker__in=[self.w_crew_1, self.w_crew_2]).update(team=team_ov)

        ScheduleTeamOverride.objects.create(
            schedule=schedule,
            team=team_ov,
            effective_date=self.today,
            reason='Driver-led relief team for today',
            created_by=self.admin,
        )
        alloc = AllocationService.allocate_truck_for_schedule(
            schedule.id, self.today, self.truck.id, team_id=team_ov.id, allocated_by=self.admin
        )

        # Driver-led override team leader submits initial crew attendance via pre_start without WatcherShift
        self.client.force_authenticate(user=self.driver_leader)
        roster_res = self.client.get(f'/api/driver/shift/my_team_roster/?schedule_id={schedule.id}')
        self.assertEqual(roster_res.status_code, status.HTTP_200_OK)
        self.assertTrue(roster_res.data['is_driver_team_leader'])
        self.assertFalse(roster_res.data['has_watcher_assigned'])
        self.assertTrue(roster_res.data['can_submit_attendance'])

        pre_res = self.client.post('/api/driver/shift/pre_start/', {
            'schedule_id': schedule.id,
            'allocation_id': alloc.id,
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'LATE'},
            ],
        }, format='json')
        self.assertEqual(pre_res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(pre_res.data['attendance_submitted'])
        shift_id = pre_res.data['id']

        crew_shift = CrewShift.objects.get(driver_shift_id=shift_id)
        self.assertEqual(crew_shift.team_leader_id, self.driver_leader.id)
        self.assertEqual(crew_shift.attendance_submitted_by_id, self.driver_leader.id)
        self.assertIsNone(crew_shift.watcher_shift_id)
        self.assertEqual(WatcherShift.objects.count(), 0)

        # Default Watcher leader cannot submit attendance or start WatcherShift on this overridden deployment
        self.client.force_authenticate(user=self.watcher)
        att_res = self.client.post(f'/api/driver/shift/{shift_id}/attendance/', {
            'attendance': [
                {'worker_id': self.w_crew_1.id, 'status': 'PRESENT'},
                {'worker_id': self.w_crew_2.id, 'status': 'PRESENT'},
            ],
        }, format='json')
        self.assertIn(att_res.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))

        ws_res = self.client.post('/api/driver/watcher-shifts/start/', {'schedule_id': schedule.id}, format='json')
        self.assertEqual(ws_res.status_code, status.HTTP_403_FORBIDDEN)
