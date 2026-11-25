from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from django.core.exceptions import ValidationError
from datetime import time, date, timedelta
from django.utils import timezone
from driver.models import (
    Worker,
    SanitationTeam,
    SanitationTeamMembership,
    Truck,
    CollectionSchedule,
    ScheduleTeamOverride,
    DriverShift,
)
from driver.team_service import TeamService, ActiveShiftConflictError

User = get_user_model()


class TeamManagementTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='teamadmin',
            email='teamadmin@example.com',
            password='Password123!',
            role='admin'
        )
        self.client.force_authenticate(user=self.admin)

        # Create linked users for role-restricted positions
        self.watcher_user = User.objects.create_user(
            username='watcher_lead',
            email='wlead@example.com',
            password='Password123!',
            role='watcher'
        )
        self.driver_user = User.objects.create_user(
            username='driver_worker',
            email='dworker@example.com',
            password='Password123!',
            role='driver'
        )
        self.citizen_crew_user = User.objects.create_user(
            username='citizen_crew',
            email='ccrew@example.com',
            password='Password123!',
            role='citizen',
            employee_type='crew_member'
        )

        # Create workers
        self.worker1 = Worker.objects.create(
            employee_id='EMP-TEST-01',
            full_name='Team Leader One',
            user=self.watcher_user
        )
        self.worker2 = Worker.objects.create(
            employee_id='EMP-TEST-02',
            full_name='Driver Two',
            user=self.driver_user
        )
        self.worker3 = Worker.objects.create(
            employee_id='EMP-TEST-03',
            full_name='Collector Three',
            user=self.citizen_crew_user
        )
        self.worker4 = Worker.objects.create(
            employee_id='EMP-TEST-04',
            full_name='Collector Four'  # non-login crew
        )

        self.team_a = TeamService.create_team(name='Team Alpha', code='ALPHA')
        self.team_b = TeamService.create_team(name='Team Bravo', code='BRAVO')

    def test_assign_member_and_roles(self):
        # Assign eligible watcher as leader
        mem_leader = TeamService.assign_member(
            team_id=self.team_a.id,
            worker_id=self.worker1.id,
            role_in_team='leader',
            created_by=self.admin
        )
        self.assertTrue(mem_leader.is_active)
        self.assertEqual(mem_leader.role_in_team, 'leader')

        # Assign eligible driver as driver
        mem_driver = TeamService.assign_member(
            team_id=self.team_a.id,
            worker_id=self.worker2.id,
            role_in_team='driver',
            created_by=self.admin
        )
        self.assertTrue(mem_driver.is_active)
        self.assertEqual(mem_driver.role_in_team, 'driver')

        # Attempt second active leader on Team Alpha should fail
        watcher_user2 = User.objects.create_user(
            username='watcher_lead_2',
            email='wlead2@example.com',
            password='Password123!',
            role='watcher'
        )
        worker_leader_2 = Worker.objects.create(
            employee_id='EMP-TEST-05',
            full_name='Team Leader Two',
            user=watcher_user2
        )
        with self.assertRaises(ValidationError):
            TeamService.assign_member(
                team_id=self.team_a.id,
                worker_id=worker_leader_2.id,
                role_in_team='leader',
                created_by=self.admin
            )

        # Attempt to assign non-driver as driver should fail
        with self.assertRaises(ValidationError):
            TeamService.assign_member(
                team_id=self.team_a.id,
                worker_id=self.worker3.id,
                role_in_team='driver',
                created_by=self.admin
            )

    def test_single_active_membership_per_worker(self):
        # Assign worker3 to Team Alpha
        TeamService.assign_member(
            team_id=self.team_a.id,
            worker_id=self.worker3.id,
            role_in_team='crew',
            created_by=self.admin
        )

        # Attempt to assign worker3 to Team Bravo without transferring should fail
        with self.assertRaises(ValidationError):
            TeamService.assign_member(
                team_id=self.team_b.id,
                worker_id=self.worker3.id,
                role_in_team='crew',
                created_by=self.admin
            )

    def test_transfer_member(self):
        TeamService.assign_member(
            team_id=self.team_a.id,
            worker_id=self.worker3.id,
            role_in_team='crew',
            created_by=self.admin
        )

        new_mem = TeamService.transfer_member(
            worker_id=self.worker3.id,
            target_team_id=self.team_b.id,
            new_role='crew',
            authorized_by=self.admin
        )

        self.assertEqual(new_mem.team, self.team_b)
        self.assertTrue(new_mem.is_active)

        # Previous membership is now deactivated
        old_mem = SanitationTeamMembership.objects.filter(team=self.team_a, worker=self.worker3).first()
        self.assertFalse(old_mem.is_active)
        self.assertIsNotNone(old_mem.left_at)

    def test_transfer_blocked_during_active_shift(self):
        truck = Truck.objects.create(plate_number='TRK-TEST-99', status='active')
        schedule = CollectionSchedule.objects.create(
            truck=truck,
            driver=self.driver_user,
            start_time=time(8, 0),
            end_time=time(17, 0)
        )

        TeamService.assign_member(
            team_id=self.team_a.id,
            worker_id=self.worker2.id,
            role_in_team='driver',
            created_by=self.admin
        )

        # Create active shift
        shift = DriverShift.objects.create(
            driver=self.driver_user,
            schedule=schedule,
            truck=truck,
            is_active=True
        )

        # Attempt transfer should raise ActiveShiftConflictError
        with self.assertRaises(ActiveShiftConflictError):
            TeamService.transfer_member(
                worker_id=self.worker2.id,
                target_team_id=self.team_b.id,
                new_role='driver',
                authorized_by=self.admin
            )

        # Conclude shift
        shift.is_active = False
        shift.save()

        # Now transfer succeeds
        transferred = TeamService.transfer_member(
            worker_id=self.worker2.id,
            target_team_id=self.team_b.id,
            new_role='driver',
            authorized_by=self.admin
        )
        self.assertEqual(transferred.team, self.team_b)

    def test_team_api_endpoints(self):
        # List teams
        res = self.client.get('/api/driver/teams/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Assign member via API
        assign_url = f'/api/driver/teams/{self.team_a.id}/assign-member/'
        res = self.client.post(assign_url, {
            'worker_id': self.worker4.id,
            'role': 'crew'
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        # Transfer member via API
        transfer_url = '/api/driver/teams/transfer-worker/'
        res = self.client.post(transfer_url, {
            'worker_id': self.worker4.id,
            'target_team_id': self.team_b.id,
            'new_role': 'crew'
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_five_team_server_side_pagination(self):
        initial_teams = SanitationTeam.objects.count()
        # Add teams to test multi-page 5-team pagination
        needed = max(10, 12 - initial_teams)
        for i in range(1, needed + 1):
            TeamService.create_team(name=f'Pagination Team {i}', code=f'PG-{i:02d}')

        total_teams = SanitationTeam.objects.count()
        expected_pages = (total_teams + 4) // 5

        # 1. Default request without page_size should strictly default to 5 teams per page
        res = self.client.get('/api/driver/teams/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], total_teams)
        self.assertEqual(res.data['total_pages'], expected_pages)
        self.assertEqual(res.data['current_page'], 1)
        self.assertEqual(res.data['page_size'], 5)
        self.assertEqual(len(res.data['results']), 5)
        self.assertIsNotNone(res.data['next'])
        self.assertIsNone(res.data['previous'])

        # 2. Page 2 request
        res_p2 = self.client.get('/api/driver/teams/?page=2')
        self.assertEqual(res_p2.status_code, status.HTTP_200_OK)
        self.assertEqual(res_p2.data['current_page'], 2)
        self.assertEqual(len(res_p2.data['results']), 5)
        self.assertIsNotNone(res_p2.data['previous'])

        # 3. Last page request has remaining items
        res_last = self.client.get(f'/api/driver/teams/?page={expected_pages}')
        self.assertEqual(res_last.status_code, status.HTTP_200_OK)
        self.assertEqual(res_last.data['current_page'], expected_pages)
        expected_last_count = total_teams - (expected_pages - 1) * 5
        self.assertEqual(len(res_last.data['results']), expected_last_count)
        self.assertIsNone(res_last.data['next'])
        self.assertIsNotNone(res_last.data['previous'])

        # 4. Explicit unpaginated retrieval (?all=true) returns all teams
        res_all = self.client.get('/api/driver/teams/?all=true')
        self.assertEqual(res_all.status_code, status.HTTP_200_OK)
        self.assertIsInstance(res_all.data, list)
        self.assertEqual(len(res_all.data), total_teams)

        # 5. Filters applied before pagination
        res_filter = self.client.get('/api/driver/teams/?search=ALPHA')
        self.assertEqual(res_filter.status_code, status.HTTP_200_OK)
        self.assertEqual(res_filter.data['count'], 1)
        self.assertEqual(len(res_filter.data['results']), 1)
        self.assertEqual(res_filter.data['results'][0]['code'], 'ALPHA')

    def test_pool_filters_and_search(self):
        # Assign worker1 to team_a
        TeamService.assign_member(self.team_a.id, self.worker1.id, 'leader', created_by=self.admin)

        # 1. pool_filter=available: returns only workers without active team membership
        res_avail = self.client.get('/api/driver/workers/?pool_filter=available&all=true')
        self.assertEqual(res_avail.status_code, status.HTTP_200_OK)
        avail_ids = {w['id'] for w in res_avail.data}
        self.assertNotIn(self.worker1.id, avail_ids)
        self.assertIn(self.worker2.id, avail_ids)
        self.assertIn(self.worker3.id, avail_ids)
        self.assertIn(self.worker4.id, avail_ids)

        # 2. pool_filter=watchers: returns only watcher workers
        res_watchers = self.client.get('/api/driver/workers/?pool_filter=watchers&all=true')
        self.assertEqual(res_watchers.status_code, status.HTTP_200_OK)
        watcher_ids = {w['id'] for w in res_watchers.data}
        self.assertIn(self.worker1.id, watcher_ids)
        self.assertNotIn(self.worker2.id, watcher_ids)
        self.assertNotIn(self.worker3.id, watcher_ids)

        # 3. pool_filter=drivers: returns only driver workers
        res_drivers = self.client.get('/api/driver/workers/?pool_filter=drivers&all=true')
        self.assertEqual(res_drivers.status_code, status.HTTP_200_OK)
        driver_ids = {w['id'] for w in res_drivers.data}
        self.assertIn(self.worker2.id, driver_ids)
        self.assertNotIn(self.worker1.id, driver_ids)
        self.assertNotIn(self.worker3.id, driver_ids)

        # 4. pool_filter=crew: returns non-login crew and citizen crew members
        res_crew = self.client.get('/api/driver/workers/?pool_filter=crew&all=true')
        self.assertEqual(res_crew.status_code, status.HTTP_200_OK)
        crew_ids = {w['id'] for w in res_crew.data}
        self.assertIn(self.worker3.id, crew_ids)
        self.assertIn(self.worker4.id, crew_ids)
        self.assertNotIn(self.worker1.id, crew_ids)
        self.assertNotIn(self.worker2.id, crew_ids)

        # 5. Search by active team name and team code
        res_search_name = self.client.get('/api/driver/workers/?search=Alpha&all=true')
        self.assertEqual(res_search_name.status_code, status.HTTP_200_OK)
        search_ids = {w['id'] for w in res_search_name.data}
        self.assertIn(self.worker1.id, search_ids)
        self.assertNotIn(self.worker2.id, search_ids)

        res_search_code = self.client.get('/api/driver/workers/?search=ALPHA&all=true')
        self.assertEqual(res_search_code.status_code, status.HTTP_200_OK)
        search_code_ids = {w['id'] for w in res_search_code.data}
        self.assertIn(self.worker1.id, search_code_ids)
        self.assertNotIn(self.worker2.id, search_code_ids)

    def test_workload_aggregation_and_deduplication(self):
        today = timezone.localdate()

        # Assign worker1 (watcher) to team_a as leader
        TeamService.assign_member(self.team_a.id, self.worker1.id, 'leader', created_by=self.admin)
        # Assign worker2 (driver) to team_a as driver
        TeamService.assign_member(self.team_a.id, self.worker2.id, 'driver', created_by=self.admin)

        # Schedule 1: Default for team_a, PENDING -> counted
        s1 = CollectionSchedule.objects.create(
            area='Active Route 1',
            default_team=self.team_a,
            driver=self.driver_user,
            start_time=time(7, 0),
            end_time=time(11, 0),
            status='PENDING',
        )
        # Schedule 2: Default for team_b, with override for team_a on tomorrow -> counted for team_a
        s2 = CollectionSchedule.objects.create(
            area='Active Route 2',
            default_team=self.team_b,
            start_time=time(8, 0),
            end_time=time(12, 0),
            status='PENDING',
        )
        ScheduleTeamOverride.objects.create(
            schedule=s2,
            team=self.team_a,
            effective_date=today + timedelta(days=1),
            created_by=self.admin,
        )
        # Schedule 3: Default for team_a, CANCELLED -> excluded
        CollectionSchedule.objects.create(
            area='Cancelled Route',
            default_team=self.team_a,
            driver=self.driver_user,
            start_time=time(9, 0),
            end_time=time(13, 0),
            status='CANCELLED',
        )
        # Schedule 4: Default for team_a, COMPLETED -> excluded
        CollectionSchedule.objects.create(
            area='Completed Route',
            default_team=self.team_a,
            driver=self.driver_user,
            start_time=time(10, 0),
            end_time=time(14, 0),
            status='COMPLETED',
        )
        # Schedule 5: Default for team_a, expired single date (yesterday) -> excluded
        CollectionSchedule.objects.create(
            area='Expired Route',
            default_team=self.team_a,
            date=today - timedelta(days=2),
            start_time=time(11, 0),
            end_time=time(15, 0),
            status='PENDING',
        )
        # Schedule 6: Default for team_a AND Override for team_a (deduplication check) -> counted ONCE
        s6 = CollectionSchedule.objects.create(
            area='Deduplication Route',
            default_team=self.team_a,
            start_time=time(12, 0),
            end_time=time(16, 0),
            status='PENDING',
        )
        ScheduleTeamOverride.objects.create(
            schedule=s6,
            team=self.team_a,
            effective_date=today + timedelta(days=2),
            created_by=self.admin,
        )

        # Schedule 7: Direct driver assignment for driver_user, not associated with team_a
        s7 = CollectionSchedule.objects.create(
            area='Direct Driver Route',
            default_team=self.team_b,
            driver=self.driver_user,
            start_time=time(13, 0),
            end_time=time(17, 0),
            status='PENDING',
        )

        res = self.client.get('/api/driver/workers/?all=true')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        workers_map = {w['id']: w for w in res.data}

        # Worker 1 (Watcher leader of team_a):
        # Team schedules for team_a = s1, s2, s6 = 3 distinct active schedules.
        # Direct driver schedules = 0.
        w1_data = workers_map[self.worker1.id]
        self.assertFalse(w1_data['is_available'])
        self.assertEqual(w1_data['team_schedule_count'], 3)
        self.assertEqual(w1_data['direct_driver_schedules_count'], 0)
        self.assertEqual(w1_data['workload']['team_membership_count'], 1)
        self.assertEqual(w1_data['workload']['team_schedule_count'], 3)
        self.assertEqual(w1_data['workload']['direct_driver_schedules_count'], 0)
        self.assertEqual(w1_data['workload']['total_schedule_count'], 3)
        self.assertEqual(w1_data['active_deployments_count'], 3)

        # Worker 2 (Driver of team_a, with direct driver schedules s1 and s7):
        # Team schedules for team_a = s1, s2, s6 = 3 distinct schedules.
        # Direct driver schedules for driver_user = s1, s7 = 2 schedules.
        # Total distinct unique schedules = {s1, s2, s6, s7} = 4 schedules (s1 deduplicated).
        w2_data = workers_map[self.worker2.id]
        self.assertFalse(w2_data['is_available'])
        self.assertEqual(w2_data['team_schedule_count'], 3)
        self.assertEqual(w2_data['direct_driver_schedules_count'], 2)
        self.assertEqual(w2_data['workload']['team_membership_count'], 1)
        self.assertEqual(w2_data['workload']['team_schedule_count'], 3)
        self.assertEqual(w2_data['workload']['direct_driver_schedules_count'], 2)
        self.assertEqual(w2_data['workload']['total_schedule_count'], 4)
        self.assertEqual(w2_data['active_deployments_count'], 4)

        # Worker 4 (Unassigned crew):
        w4_data = workers_map[self.worker4.id]
        self.assertTrue(w4_data['is_available'])
        self.assertEqual(w4_data['team_schedule_count'], 0)
        self.assertEqual(w4_data['direct_driver_schedules_count'], 0)
        self.assertEqual(w4_data['workload']['team_membership_count'], 0)
        self.assertEqual(w4_data['workload']['total_schedule_count'], 0)
        self.assertEqual(w4_data['active_deployments_count'], 0)

    def test_position_overwrite_protection_via_api(self):
        # Assign leader to team_a
        TeamService.assign_member(self.team_a.id, self.worker1.id, 'leader', created_by=self.admin)
        # Assign driver to team_a
        TeamService.assign_member(self.team_a.id, self.worker2.id, 'driver', created_by=self.admin)

        # Create another eligible watcher and driver
        w_watcher2 = Worker.objects.create(
            employee_id='EMP-W-NEW', full_name='New Watcher',
            user=User.objects.create_user(username='w2new', email='w2new@example.com', password='Password123!', role='watcher')
        )
        w_driver2 = Worker.objects.create(
            employee_id='EMP-D-NEW', full_name='New Driver',
            user=User.objects.create_user(username='d2new', email='d2new@example.com', password='Password123!', role='driver')
        )

        # Attempt to assign a second leader via API should return 400 Bad Request
        res_leader = self.client.post(f'/api/driver/teams/{self.team_a.id}/assign-member/', {
            'worker_id': w_watcher2.id,
            'role': 'leader'
        }, format='json')
        self.assertEqual(res_leader.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already has an active leader', str(res_leader.data))

        # Attempt to assign a second driver via API should return 400 Bad Request
        res_driver = self.client.post(f'/api/driver/teams/{self.team_a.id}/assign-member/', {
            'worker_id': w_driver2.id,
            'role': 'driver'
        }, format='json')
        self.assertEqual(res_driver.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already has an active driver', str(res_driver.data))

    def test_transfer_workflow_and_active_shift_conflict_api(self):
        truck = Truck.objects.create(plate_number='TRK-TEST-TRANS', status='active')
        schedule = CollectionSchedule.objects.create(
            truck=truck,
            driver=self.driver_user,
            start_time=time(8, 0),
            end_time=time(17, 0)
        )

        TeamService.assign_member(self.team_a.id, self.worker2.id, 'driver', created_by=self.admin)

        # 1. Active shift conflict returns 409
        shift = DriverShift.objects.create(
            driver=self.driver_user,
            schedule=schedule,
            truck=truck,
            is_active=True
        )

        res_conflict = self.client.post('/api/driver/teams/transfer-worker/', {
            'worker_id': self.worker2.id,
            'target_team_id': self.team_b.id,
            'new_role': 'driver'
        }, format='json')
        self.assertEqual(res_conflict.status_code, status.HTTP_409_CONFLICT)

        # 2. Conclude shift and retry transfer -> succeeds with 200
        shift.is_active = False
        shift.save()

        res_success = self.client.post('/api/driver/teams/transfer-worker/', {
            'worker_id': self.worker2.id,
            'target_team_id': self.team_b.id,
            'new_role': 'driver'
        }, format='json')
        self.assertEqual(res_success.status_code, status.HTTP_200_OK)

        # Verify old membership deactivated and new membership active
        old_mem = SanitationTeamMembership.objects.filter(team=self.team_a, worker=self.worker2).first()
        self.assertFalse(old_mem.is_active)
        self.assertIsNotNone(old_mem.left_at)

        new_mem = SanitationTeamMembership.objects.filter(team=self.team_b, worker=self.worker2).first()
        self.assertTrue(new_mem.is_active)
        self.assertEqual(new_mem.role_in_team, 'driver')

    def test_assign_and_transfer_reject_inactive_user_and_inactive_worker(self):
        inactive_user = User.objects.create_user(
            username='inactive_drv',
            email='inactive_drv@example.com',
            password='Password123!',
            role='driver',
            is_active=False,
        )
        w_inactive_user = Worker.objects.create(
            employee_id='EMP-INACT-U',
            full_name='Inactive User Driver',
            user=inactive_user,
        )
        with self.assertRaises(ValidationError) as ctx1:
            TeamService.assign_member(self.team_a.id, w_inactive_user.id, 'driver', created_by=self.admin)
        self.assertIn('worker_id', ctx1.exception.message_dict)

        inactive_worker = Worker.objects.create(
            employee_id='EMP-INACT-W',
            full_name='Inactive Worker',
            is_active=False,
        )
        with self.assertRaises(ValidationError):
            TeamService.assign_member(self.team_a.id, inactive_worker.id, 'crew', created_by=self.admin)

        # Assign active worker4 then deactivate directly -> transfer_member rejects inactive worker
        TeamService.assign_member(self.team_a.id, self.worker4.id, 'crew', created_by=self.admin)
        Worker.objects.filter(pk=self.worker4.id).update(is_active=False)
        with self.assertRaises(ValidationError) as ctx2:
            TeamService.transfer_member(self.worker4.id, self.team_b.id, 'crew', authorized_by=self.admin)
        self.assertIn('worker_id', ctx2.exception.message_dict)

    def test_assign_and_transfer_require_actor_and_emit_activity_logs(self):
        from analytics.models import ActivityLog

        with self.assertRaises(ValidationError) as ctx1:
            TeamService.assign_member(self.team_a.id, self.worker4.id, 'crew', created_by=None)
        self.assertIn('created_by', ctx1.exception.message_dict)

        m = TeamService.assign_member(self.team_a.id, self.worker4.id, 'crew', created_by=self.admin)
        self.assertTrue(
            ActivityLog.objects.filter(module='Teams', details__contains='TEAM_MEMBER_ASSIGNED').exists()
        )

        with self.assertRaises(ValidationError) as ctx2:
            TeamService.transfer_member(self.worker4.id, self.team_b.id, 'crew', authorized_by=None)
        self.assertIn('authorized_by', ctx2.exception.message_dict)

        transferred = TeamService.transfer_member(self.worker4.id, self.team_b.id, 'crew', authorized_by=self.admin)
        self.assertTrue(
            ActivityLog.objects.filter(module='Teams', details__contains='TEAM_MEMBER_TRANSFERRED').exists()
        )

        TeamService.deactivate_member(transferred.id, authorized_by=self.admin)
        self.assertTrue(
            ActivityLog.objects.filter(module='Teams', details__contains='TEAM_MEMBER_DEACTIVATED').exists()
        )

    def test_team_and_membership_serializer_role_fields_and_unlinked_none(self):
        from driver.serializers import SanitationTeamSerializer, SanitationTeamMembershipSerializer

        mem_unlinked = TeamService.assign_member(self.team_a.id, self.worker4.id, 'crew', created_by=self.admin)
        mem_driver = TeamService.assign_member(self.team_a.id, self.worker2.id, 'driver', created_by=self.admin)

        team_data = SanitationTeamSerializer(self.team_a).data
        unlinked_entry = next(m for m in team_data['crew_members'] if m['id'] == self.worker4.id)
        self.assertIsNone(unlinked_entry['system_role'])
        self.assertIsNone(unlinked_entry['employee_type'])

        mem_drv_data = SanitationTeamMembershipSerializer(mem_driver).data
        self.assertEqual(mem_drv_data['worker_system_role'], 'driver')
        mem_unlinked_data = SanitationTeamMembershipSerializer(mem_unlinked).data
        self.assertIsNone(mem_unlinked_data['worker_system_role'])
        self.assertIsNone(mem_unlinked_data['worker_employee_type'])

    def test_viewset_patch_delete_bypasses_and_citizen_get_blocked(self):
        TeamService.assign_member(self.team_a.id, self.worker4.id, 'crew', created_by=self.admin)

        # Citizen cannot GET teams, workers, or team-memberships (OD-4)
        self.client.force_authenticate(user=self.citizen_crew_user)
        self.assertEqual(self.client.get('/api/driver/workers/').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.get('/api/driver/teams/').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.get('/api/driver/team-memberships/').status_code, status.HTTP_403_FORBIDDEN)

        # Admin cannot deactivate/delete Worker or Team with active membership via generic PATCH/DELETE
        self.client.force_authenticate(user=self.admin)
        res_w_patch = self.client.patch(
            f'/api/driver/workers/{self.worker4.id}/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(res_w_patch.status_code, status.HTTP_409_CONFLICT)

        res_w_del = self.client.delete(f'/api/driver/workers/{self.worker4.id}/')
        self.assertEqual(res_w_del.status_code, status.HTTP_409_CONFLICT)

        res_t_patch = self.client.patch(
            f'/api/driver/teams/{self.team_a.id}/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(res_t_patch.status_code, status.HTTP_409_CONFLICT)

        res_t_del = self.client.delete(f'/api/driver/teams/{self.team_a.id}/')
        self.assertEqual(res_t_del.status_code, status.HTTP_409_CONFLICT)
