from datetime import time
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Barangay, EmployeeType, UserRole
from driver.models import (
    CollectionSchedule,
    CrewAttendanceCorrection,
    CrewAttendanceRecord,
    CrewShift,
    DriverShift,
    SanitationTeam,
    ScheduleTruckAllocation,
    Truck,
    WatcherShift,
    Worker,
)
from driver.shift_service import ShiftService
from driver.team_service import TeamService
from dumpsite.models import Dumpsite

User = get_user_model()


class Stage5BProfileAttendanceTests(APITestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.today_day_name = self.today.strftime('%A')

        self.barangay = Barangay.objects.create(name='Brgy Stage5B')
        self.dumpsite = Dumpsite.objects.create(
            name='Stage5B Central Dumpsite',
            barangay=self.barangay,
            latitude=13.9400,
            longitude=121.6200,
            max_capacity_kg=100000,
            current_fill_kg=1000,
        )

        # Admin variants (role='admin' non-staff AND role='citizen' is_staff=True)
        self.admin_role_user = User.objects.create_user(
            username='s5b_admin_role',
            email='s5b_admin_role@example.com',
            password='Password123!',
            role=UserRole.ADMIN,
            is_staff=False,
            full_name='Role Admin',
        )
        self.staff_admin_user = User.objects.create_user(
            username='s5b_staff_admin',
            email='s5b_staff_admin@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            is_staff=True,
            full_name='Staff Admin',
        )

        # Watchers
        self.watcher_leader = User.objects.create_user(
            username='s5b_watcher_leader',
            email='s5b_watcher_leader@example.com',
            password='Password123!',
            role=UserRole.WATCHER,
            barangay=self.barangay,
            full_name='Watcher Team Leader',
        )
        self.other_watcher = User.objects.create_user(
            username='s5b_other_watcher',
            email='s5b_other_watcher@example.com',
            password='Password123!',
            role=UserRole.WATCHER,
            barangay=self.barangay,
            full_name='Other Watcher',
        )

        # Drivers
        self.driver_watcher_team = User.objects.create_user(
            username='s5b_driver_wteam',
            email='s5b_driver_wteam@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
            full_name='Driver On Watcher Team',
        )
        self.driver_leader = User.objects.create_user(
            username='s5b_driver_leader',
            email='s5b_driver_leader@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
            full_name='Driver Team Leader',
        )

        # Crew Members (Citizen + employee_type='crew_member') and Non-Login Worker
        self.crew_user_a = User.objects.create_user(
            username='s5b_crew_a',
            email='s5b_crew_a@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            employee_type=EmployeeType.CREW_MEMBER,
            barangay=self.barangay,
            full_name='Crew Member Alpha',
        )
        self.crew_user_b = User.objects.create_user(
            username='s5b_crew_b',
            email='s5b_crew_b@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            employee_type=EmployeeType.CREW_MEMBER,
            barangay=self.barangay,
            full_name='Crew Member Bravo',
        )
        self.plain_citizen = User.objects.create_user(
            username='s5b_plain_citizen',
            email='s5b_plain_citizen@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            barangay=self.barangay,
            full_name='Plain Resident',
        )
        self.dumpsite_operator = User.objects.create_user(
            username='s5b_dumpsite_op',
            email='s5b_dumpsite_op@example.com',
            password='Password123!',
            role=UserRole.DUMPSITE,
            dumpsite=self.dumpsite,
            full_name='Dumpsite Operator',
        )

        # Canonical Workers
        self.w_watcher_leader = Worker.objects.create(
            employee_id='EMP-S5B-WL1',
            full_name='Watcher Team Leader',
            user=self.watcher_leader,
        )
        self.w_other_watcher = Worker.objects.create(
            employee_id='EMP-S5B-WL2',
            full_name='Other Watcher',
            user=self.other_watcher,
        )
        self.w_driver_wteam = Worker.objects.create(
            employee_id='EMP-S5B-DW1',
            full_name='Driver On Watcher Team',
            user=self.driver_watcher_team,
        )
        self.w_driver_leader = Worker.objects.create(
            employee_id='EMP-S5B-DL1',
            full_name='Driver Team Leader',
            user=self.driver_leader,
        )
        self.w_crew_a = Worker.objects.create(
            employee_id='EMP-S5B-CA1',
            full_name='Crew Member Alpha',
            user=self.crew_user_a,
        )
        self.w_crew_b = Worker.objects.create(
            employee_id='EMP-S5B-CB1',
            full_name='Crew Member Bravo',
            user=self.crew_user_b,
        )
        self.w_non_login = Worker.objects.create(
            employee_id='EMP-S5B-NL1',
            full_name='Non Login Collector',
            user=None,
        )

        # Teams: Team Alpha (Watcher-led) and Team Beta (Driver-led)
        self.team_alpha = SanitationTeam.objects.create(
            name='Stage5B Team Alpha',
            code='S5B-ALPHA',
            is_active=True,
        )
        TeamService.assign_member(self.team_alpha.id, self.w_watcher_leader.id, 'leader', self.admin_role_user)
        TeamService.assign_member(self.team_alpha.id, self.w_driver_wteam.id, 'driver', self.admin_role_user)
        TeamService.assign_member(self.team_alpha.id, self.w_crew_a.id, 'crew', self.admin_role_user)
        TeamService.assign_member(self.team_alpha.id, self.w_crew_b.id, 'crew', self.admin_role_user)

        self.team_beta = SanitationTeam.objects.create(
            name='Stage5B Team Beta',
            code='S5B-BETA',
            is_active=True,
        )
        TeamService.assign_member(self.team_beta.id, self.w_driver_leader.id, 'leader', self.admin_role_user)
        TeamService.assign_member(self.team_beta.id, self.w_non_login.id, 'crew', self.admin_role_user)

        # Trucks
        self.truck_alpha = Truck.objects.create(
            plate_number='S5B-TRK-01',
            model='Hino Compactor',
            commissioning_provenance='commissioned_verified',
            commissioned_at=timezone.now(),
            retirement_state='operational',
        )
        self.truck_beta = Truck.objects.create(
            plate_number='S5B-TRK-02',
            model='Isuzu Elf',
            commissioning_provenance='commissioned_verified',
            commissioned_at=timezone.now(),
            retirement_state='operational',
        )

        # Schedules & Allocations
        self.schedule_alpha = CollectionSchedule.objects.create(
            area='Alpha Route North',
            days=self.today_day_name,
            date=self.today,
            start_time=time(6, 0),
            end_time=time(14, 0),
            default_team=self.team_alpha,
            truck=self.truck_alpha,
            driver=self.driver_watcher_team,
            dumpsite=self.dumpsite,
            is_available=True,
        )
        self.alloc_alpha = ScheduleTruckAllocation.objects.create(
            schedule=self.schedule_alpha,
            allocation_date=self.today,
            truck=self.truck_alpha,
            team=self.team_alpha,
            allocated_by=self.admin_role_user,
        )

        self.schedule_beta = CollectionSchedule.objects.create(
            area='Beta Route South',
            days=self.today_day_name,
            date=self.today,
            start_time=time(7, 0),
            end_time=time(15, 0),
            default_team=self.team_beta,
            truck=self.truck_beta,
            driver=self.driver_leader,
            dumpsite=self.dumpsite,
            is_available=True,
        )
        self.alloc_beta = ScheduleTruckAllocation.objects.create(
            schedule=self.schedule_beta,
            allocation_date=self.today,
            truck=self.truck_beta,
            team=self.team_beta,
            allocated_by=self.admin_role_user,
        )

    def _submit_alpha_watcher_attendance(self):
        self.client.force_authenticate(user=self.watcher_leader)
        res = self.client.post(
            f'/api/watcher/crew-attendance/deployments/{self.schedule_alpha.id}/submit/',
            {
                'service_date': self.today.isoformat(),
                'records': [
                    {'worker_id': self.w_crew_a.id, 'status': 'PRESENT'},
                    {'worker_id': self.w_crew_b.id, 'status': 'LATE'},
                ],
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        return res.data

    def test_1_crew_member_profile_attendance_privacy_and_redaction(self):
        """
        Crew Member A receives ONLY their own attendance records on /api/driver/shift/my-attendance-history/
        and /api/driver/shift/my_team_roster/, with coworker records, truck plates, and driver details redacted.
        """
        self._submit_alpha_watcher_attendance()

        self.client.force_authenticate(user=self.crew_user_a)
        res = self.client.get('/api/driver/shift/my-attendance-history/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.data

        self.assertTrue(data['is_crew_member'])
        self.assertEqual(data['worker']['id'], self.w_crew_a.id)
        self.assertEqual(len(data['personal_attendance']), 1)

        rec = data['personal_attendance'][0]
        self.assertEqual(rec['worker_id'], self.w_crew_a.id)
        self.assertEqual(rec['initial_status'], 'PRESENT')
        self.assertEqual(rec['effective_status'], 'PRESENT')
        self.assertEqual(rec['team_code'], 'S5B-ALPHA')
        self.assertEqual(rec['schedule_area'], 'Alpha Route North')
        self.assertFalse(rec['can_correct'])
        # Privacy redaction checks: no truck_plate, no driver_shift_id, no coworker records
        self.assertNotIn('truck_plate', rec)
        self.assertNotIn('driver_shift_id', rec)
        self.assertEqual(data['driver_shifts'], [])
        self.assertEqual(data['watcher_shifts'], [])
        self.assertEqual(data['led_crew_shifts'], [])

        # my_team_roster also redacts coworkers' attendance records for citizen crew members
        roster_res = self.client.get(
            f'/api/driver/shift/my_team_roster/?schedule_id={self.schedule_alpha.id}&date={self.today.isoformat()}'
        )
        self.assertEqual(roster_res.status_code, status.HTTP_200_OK)
        att_worker_ids = [r['worker_id'] for r in roster_res.data['attendance_records']]
        self.assertEqual(att_worker_ids, [self.w_crew_a.id])
        self.assertNotIn(self.w_crew_b.id, att_worker_ids)
        self.assertEqual(roster_res.data['crew_members'], [])

    def test_2_cross_person_isolation_and_unauthorized_endpoint_access(self):
        """
        Users cannot inspect another person's attendance history via query parameters or Admin endpoints.
        """
        self._submit_alpha_watcher_attendance()

        for caller in (self.crew_user_a, self.plain_citizen, self.driver_watcher_team, self.watcher_leader, self.dumpsite_operator):
            self.client.force_authenticate(user=caller)

            # Attempting to pass another user_id or worker_id on self-history endpoint returns 403
            res_u = self.client.get(f'/api/driver/shift/my-attendance-history/?user_id={self.crew_user_b.id}')
            self.assertEqual(res_u.status_code, status.HTTP_403_FORBIDDEN)

            res_w = self.client.get(f'/api/driver/shift/my-attendance-history/?worker_id={self.w_crew_b.id}')
            self.assertEqual(res_w.status_code, status.HTTP_403_FORBIDDEN)

            # Admin-only endpoints reject non-admin callers with 403
            self.assertEqual(
                self.client.get(f'/api/driver/workers/{self.w_crew_b.id}/attendance-history/').status_code,
                status.HTTP_403_FORBIDDEN,
            )
            self.assertEqual(
                self.client.get(f'/api/accounts/users/{self.crew_user_b.id}/attendance-history/').status_code,
                status.HTTP_403_FORBIDDEN,
            )
            self.assertEqual(
                self.client.get('/api/driver/crew-shifts/').status_code,
                status.HTTP_403_FORBIDDEN,
            )

    def test_3_persisted_history_preserved_after_team_transfer_and_no_fabrication(self):
        """
        Transferring a Crew Member to another team preserves historical team attribution on past records.
        An active DriverShift without submitted attendance never fabricates attendance records.
        """
        # 1. Before any attendance is submitted, starting a DriverShift does NOT fabricate attendance
        ShiftService.stage_and_start_shift(
            driver_user=self.driver_watcher_team,
            schedule_id=self.schedule_alpha.id,
            allocation_id=self.alloc_alpha.id,
        )
        self.client.force_authenticate(user=self.crew_user_a)
        pre_res = self.client.get('/api/driver/shift/my-attendance-history/')
        self.assertEqual(pre_res.status_code, status.HTTP_200_OK)
        self.assertEqual(pre_res.data['personal_attendance'], [])

        # 2. Watcher Leader submits attendance on Team Alpha, then concludes shift so Crew A can transfer
        self._submit_alpha_watcher_attendance()
        active_ds = DriverShift.objects.get(allocation=self.alloc_alpha)
        ShiftService.conclude_shift_atomic(
            driver_shift_id=active_ds.id,
            concluded_by=self.driver_watcher_team,
            end_reason='completed',
        )

        # Transfer Crew Member A from Team Alpha to Team Beta
        TeamService.transfer_member(
            worker_id=self.w_crew_a.id,
            target_team_id=self.team_beta.id,
            new_role='crew',
            authorized_by=self.admin_role_user,
        )

        self.client.force_authenticate(user=self.crew_user_a)
        post_res = self.client.get('/api/driver/shift/my-attendance-history/')
        self.assertEqual(post_res.status_code, status.HTTP_200_OK)
        # Current active membership is Team Beta, but historical attendance record still shows Team Alpha
        self.assertEqual(post_res.data['active_membership']['team_code'], 'S5B-BETA')
        self.assertEqual(len(post_res.data['personal_attendance']), 1)
        self.assertEqual(post_res.data['personal_attendance'][0]['team_code'], 'S5B-ALPHA')

    def test_4_watcher_led_and_driver_led_history_views(self):
        """
        Watcher-led and Driver-led attendance submissions populate respective Team Leader histories
        without leaking coworkers' private records to non-leader Drivers.
        """
        # Case A: Watcher-led submission on Schedule Alpha (pre-departure, before DriverShift starts)
        self._submit_alpha_watcher_attendance()

        self.client.force_authenticate(user=self.watcher_leader)
        watcher_hist = self.client.get('/api/driver/shift/my-attendance-history/').data
        self.assertEqual(len(watcher_hist['led_crew_shifts']), 1)
        self.assertEqual(watcher_hist['led_crew_shifts'][0]['attendance_count'], 2)
        self.assertTrue(all(r['can_correct'] for r in watcher_hist['led_crew_shifts'][0]['attendance_records']))

        # Start DriverShift on Schedule Alpha; non-leader Driver sees their DriverShift but NOT coworkers' records
        ShiftService.stage_and_start_shift(
            driver_user=self.driver_watcher_team,
            schedule_id=self.schedule_alpha.id,
            allocation_id=self.alloc_alpha.id,
        )
        self.client.force_authenticate(user=self.driver_watcher_team)
        drv_hist = self.client.get('/api/driver/shift/my-attendance-history/').data
        self.assertEqual(len(drv_hist['driver_shifts']), 1)
        self.assertTrue(drv_hist['driver_shifts'][0]['attendance_submitted'])
        self.assertEqual(drv_hist['led_crew_shifts'], [])
        self.assertEqual(drv_hist['personal_attendance'], [])

        # Case B: Driver-led submission on Schedule Beta (no Watcher on Team Beta)
        ws_count_before = WatcherShift.objects.count()
        self.client.force_authenticate(user=self.driver_leader)
        drv_submit = self.client.post(
            '/api/driver/shift/submit-deployment-attendance/',
            {
                'schedule_id': self.schedule_beta.id,
                'service_date': self.today.isoformat(),
                'records': [
                    {'worker_id': self.w_non_login.id, 'status': 'EXCUSED'},
                ],
            },
            format='json',
        )
        self.assertEqual(drv_submit.status_code, status.HTTP_201_CREATED, drv_submit.data)
        self.assertEqual(WatcherShift.objects.count(), ws_count_before)

        drv_leader_hist = self.client.get('/api/driver/shift/my-attendance-history/').data
        self.assertEqual(len(drv_leader_hist['led_crew_shifts']), 1)
        led_records = drv_leader_hist['led_crew_shifts'][0]['attendance_records']
        self.assertEqual(len(led_records), 1)
        self.assertEqual(led_records[0]['worker_id'], self.w_non_login.id)
        self.assertEqual(led_records[0]['effective_status'], 'EXCUSED')
        self.assertTrue(led_records[0]['can_correct'])

    def test_5_immutability_and_append_only_correction_permissions(self):
        """
        Initial attendance records are immutable; only the original submitting Team Leader and Admin
        (both role='admin' and is_staff=True) can append corrections; SUBSTITUTE is rejected.
        """
        # Admin cannot submit initial attendance
        for admin_u in (self.admin_role_user, self.staff_admin_user):
            self.client.force_authenticate(user=admin_u)
            res_init = self.client.post(
                f'/api/watcher/crew-attendance/deployments/{self.schedule_alpha.id}/submit/',
                {
                    'service_date': self.today.isoformat(),
                    'records': [{'worker_id': self.w_crew_a.id, 'status': 'PRESENT'}],
                },
                format='json',
            )
            self.assertEqual(res_init.status_code, status.HTTP_403_FORBIDDEN)

        # Watcher Leader submits initial attendance
        self._submit_alpha_watcher_attendance()
        rec_a = CrewAttendanceRecord.objects.get(worker=self.w_crew_a)
        cs = rec_a.crew_shift

        # Model immutability check
        rec_a.status = 'ABSENT'
        with self.assertRaises(ValidationError):
            rec_a.save()
        with self.assertRaises(ValidationError):
            rec_a.delete()

        # Unauthorized users cannot append a correction (Crew Member, non-submitter Driver, other Watcher, Dumpsite)
        for unauthorized in (self.crew_user_a, self.driver_watcher_team, self.other_watcher, self.dumpsite_operator):
            self.client.force_authenticate(user=unauthorized)
            res_unauth = self.client.post(
                '/api/driver/shift/correct-deployment-attendance/',
                {
                    'record_id': rec_a.id,
                    'corrected_status': 'LATE',
                    'reason': 'Unauthorized attempt',
                },
                format='json',
            )
            self.assertIn(res_unauth.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST))

        # Original submitting Watcher Team Leader can append correction #1
        self.client.force_authenticate(user=self.watcher_leader)
        corr_1 = self.client.post(
            '/api/driver/shift/correct-deployment-attendance/',
            {
                'record_id': rec_a.id,
                'corrected_status': 'LATE',
                'reason': 'Arrived 15 minutes after roll call',
            },
            format='json',
        )
        self.assertEqual(corr_1.status_code, status.HTTP_201_CREATED, corr_1.data)
        self.assertEqual(corr_1.data['correction_sequence'], 1)

        # Invalid status SUBSTITUTE is rejected with 400
        bad_status = self.client.post(
            '/api/driver/shift/correct-deployment-attendance/',
            {
                'record_id': rec_a.id,
                'corrected_status': 'SUBSTITUTE',
                'reason': 'Should be rejected',
            },
            format='json',
        )
        self.assertEqual(bad_status.status_code, status.HTTP_400_BAD_REQUEST)

        # Admin (both role='admin' non-staff and is_staff=True) can append corrections via CrewShiftViewSet
        self.client.force_authenticate(user=self.admin_role_user)
        corr_2 = self.client.post(
            f'/api/driver/crew-shifts/{cs.id}/attendance-correction/',
            {
                'record_id': rec_a.id,
                'corrected_status': 'EXCUSED',
                'reason': 'Approved medical certificate by Admin',
            },
            format='json',
        )
        self.assertEqual(corr_2.status_code, status.HTTP_201_CREATED, corr_2.data)
        self.assertEqual(corr_2.data['correction_sequence'], 2)

        self.client.force_authenticate(user=self.staff_admin_user)
        corr_3 = self.client.post(
            f'/api/driver/crew-shifts/{cs.id}/attendance-correction/',
            {
                'record_id': rec_a.id,
                'corrected_status': 'PRESENT',
                'reason': 'Reverified timecard by Staff Admin',
            },
            format='json',
        )
        self.assertEqual(corr_3.status_code, status.HTTP_201_CREATED, corr_3.data)
        self.assertEqual(corr_3.data['correction_sequence'], 3)

        # Crew Member A sees initial_status='PRESENT', effective_status='PRESENT', and all 3 ordered corrections
        self.client.force_authenticate(user=self.crew_user_a)
        crew_hist = self.client.get('/api/driver/shift/my-attendance-history/').data
        item = crew_hist['personal_attendance'][0]
        self.assertEqual(item['initial_status'], 'PRESENT')
        self.assertEqual(item['effective_status'], 'PRESENT')
        self.assertTrue(item['is_corrected'])
        self.assertEqual(item['correction_count'], 3)
        self.assertEqual([c['correction_sequence'] for c in item['corrections']], [1, 2, 3])
        self.assertEqual([c['corrected_status'] for c in item['corrections']], ['LATE', 'EXCUSED', 'PRESENT'])

    def test_6_admin_citywide_oversight_endpoints_and_staff_parity(self):
        """
        Both role='admin' (is_staff=False) and role='citizen' (is_staff=True) can inspect
        standalone CrewShifts, worker attendance history (including non-login workers), and user history.
        """
        self._submit_alpha_watcher_attendance()
        cs = CrewShift.objects.get(allocation=self.alloc_alpha)

        for admin_u in (self.admin_role_user, self.staff_admin_user):
            self.client.force_authenticate(user=admin_u)

            # 1. CrewShiftViewSet list, attendance, and roster-snapshot
            cs_list = self.client.get('/api/driver/crew-shifts/?standalone_only=true')
            self.assertEqual(cs_list.status_code, status.HTTP_200_OK)
            results = cs_list.data.get('results', cs_list.data)
            self.assertTrue(any(item['id'] == cs.id for item in results))

            cs_att = self.client.get(f'/api/driver/crew-shifts/{cs.id}/attendance/')
            self.assertEqual(cs_att.status_code, status.HTTP_200_OK)
            self.assertEqual(len(cs_att.data), 2)

            cs_snap = self.client.get(f'/api/driver/crew-shifts/{cs.id}/roster-snapshot/')
            self.assertEqual(cs_snap.status_code, status.HTTP_200_OK)
            self.assertEqual(cs_snap.data['crew_shift'], cs.id)

            # 2. WorkerViewSet attendance-history (including non-login worker)
            w_hist = self.client.get(f'/api/driver/workers/{self.w_crew_a.id}/attendance-history/')
            self.assertEqual(w_hist.status_code, status.HTTP_200_OK)
            self.assertEqual(w_hist.data['worker']['id'], self.w_crew_a.id)
            self.assertEqual(len(w_hist.data['personal_attendance']), 1)

            nl_hist = self.client.get(f'/api/driver/workers/{self.w_non_login.id}/attendance-history/')
            self.assertEqual(nl_hist.status_code, status.HTTP_200_OK)
            self.assertEqual(nl_hist.data['worker']['id'], self.w_non_login.id)
            self.assertIsNone(nl_hist.data['worker']['user_id'])

            # 3. UserViewSet attendance-history
            u_hist = self.client.get(f'/api/accounts/users/{self.crew_user_a.id}/attendance-history/')
            self.assertEqual(u_hist.status_code, status.HTTP_200_OK)
            self.assertEqual(u_hist.data['user_id'], self.crew_user_a.id)
            self.assertEqual(len(u_hist.data['personal_attendance']), 1)
