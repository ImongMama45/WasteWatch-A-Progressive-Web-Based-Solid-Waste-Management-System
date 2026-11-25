from datetime import time
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User, UserRole
from accounts.permissions import can_vote_on_report
from driver.allocation_service import AllocationService
from driver.models import (
    CollectionSchedule,
    CommissioningProvenance,
    CrewShift,
    DriverShift,
    PickupStatus,
    SanitationTeam,
    SanitationTeamMembership,
    ScheduleTeamOverride,
    Truck,
    TruckRetirementState,
    TruckStatus,
    UnfinishedStopReview,
    WatcherShift,
    Worker,
)
from driver.shift_service import ShiftService
from driver.team_service import (
    TeamService,
    can_inspect_collection_stop,
    filter_watcher_authorized_schedule_dates,
)
from dumpsite.models import Dumpsite
from watcher.models import (
    GarbageReport,
    IssueType,
    ReportStatus,
    Severity,
    StopValidation,
    StopValidationStatus,
)


class Stage5AWatcherRouteIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.today = timezone.localdate()

        # Three barangays across Lucena City
        self.brgy_a = Barangay.objects.create(name='Brgy Alpha')
        self.brgy_b = Barangay.objects.create(name='Brgy Beta')
        self.brgy_c = Barangay.objects.create(name='Brgy Gamma')

        self.dumpsite = Dumpsite.objects.create(
            name='Lucena Central Base',
            latitude=13.930,
            longitude=121.610,
            barangay=self.brgy_a,
        )

        # Users
        self.admin = User.objects.create_superuser(
            username='s5a_admin',
            email='s5a_admin@test.com',
            password='Password123!',
            role=UserRole.ADMIN,
            full_name='Stage 5A Admin',
        )
        self.watcher_1 = User.objects.create_user(
            username='s5a_watcher_1',
            email='s5a_watcher_1@test.com',
            password='Password123!',
            role=UserRole.WATCHER,
            barangay=self.brgy_a,
            full_name='Watcher One',
        )
        self.watcher_2 = User.objects.create_user(
            username='s5a_watcher_2',
            email='s5a_watcher_2@test.com',
            password='Password123!',
            role=UserRole.WATCHER,
            barangay=self.brgy_b,
            full_name='Watcher Two',
        )
        self.watcher_no_brgy = User.objects.create_user(
            username='s5a_watcher_nobrgy',
            email='s5a_watcher_nobrgy@test.com',
            password='Password123!',
            role=UserRole.WATCHER,
            barangay=None,
            full_name='Watcher No Barangay',
        )
        self.driver_1 = User.objects.create_user(
            username='s5a_driver_1',
            email='s5a_driver_1@test.com',
            password='Password123!',
            role=UserRole.DRIVER,
            barangay=self.brgy_a,
            full_name='Driver One',
        )
        self.driver_2 = User.objects.create_user(
            username='s5a_driver_2',
            email='s5a_driver_2@test.com',
            password='Password123!',
            role=UserRole.DRIVER,
            barangay=self.brgy_a,
            full_name='Driver Two',
        )
        self.crew_citizen = User.objects.create_user(
            username='s5a_crew_1',
            email='s5a_crew_1@test.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            employee_type='crew_member',
            barangay=self.brgy_a,
            full_name='Crew Member One',
        )
        self.citizen = User.objects.create_user(
            username='s5a_citizen',
            email='s5a_citizen@test.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            barangay=self.brgy_a,
            full_name='Ordinary Citizen',
        )

        # Workers & Teams
        self.w_watcher_1 = Worker.objects.create(employee_id='S5A-W1', full_name='Watcher One', user=self.watcher_1)
        self.w_watcher_2 = Worker.objects.create(employee_id='S5A-W2', full_name='Watcher Two', user=self.watcher_2)
        self.w_watcher_nobrgy = Worker.objects.create(
            employee_id='S5A-WNB', full_name='Watcher No Barangay', user=self.watcher_no_brgy
        )
        self.w_driver_1 = Worker.objects.create(employee_id='S5A-D1', full_name='Driver One', user=self.driver_1)
        self.w_driver_2 = Worker.objects.create(employee_id='S5A-D2', full_name='Driver Two', user=self.driver_2)
        self.w_crew_1 = Worker.objects.create(employee_id='S5A-C1', full_name='Crew Member One', user=self.crew_citizen)

        # Team 1: Watcher-led (Watcher 1)
        self.team_1 = TeamService.create_team(name='Route Team Alpha', code='S5A-T1')
        TeamService.assign_member(self.team_1.id, self.w_watcher_1.id, 'leader', created_by=self.admin)
        TeamService.assign_member(self.team_1.id, self.w_driver_1.id, 'driver', created_by=self.admin)
        TeamService.assign_member(self.team_1.id, self.w_crew_1.id, 'crew', created_by=self.admin)

        # Team 2: Watcher-led (Watcher 2)
        self.team_2 = TeamService.create_team(name='Route Team Beta', code='S5A-T2')
        TeamService.assign_member(self.team_2.id, self.w_watcher_2.id, 'leader', created_by=self.admin)

        # Team 3: Driver-led (Driver 2)
        self.team_driver_led = TeamService.create_team(name='Driver Led Team', code='S5A-TD')
        TeamService.assign_member(self.team_driver_led.id, self.w_driver_2.id, 'leader', created_by=self.admin)

        # Team 4: No active leader
        self.team_no_leader = TeamService.create_team(name='No Leader Team', code='S5A-NL')

        # Trucks
        self.truck_1 = Truck.objects.create(
            plate_number='S5A-101',
            model='Isuzu Elf',
            status=TruckStatus.ACTIVE,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_2 = Truck.objects.create(
            plate_number='S5A-202',
            model='Hino 300',
            status=TruckStatus.ACTIVE,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=timezone.now(),
            retirement_state=TruckRetirementState.OPERATIONAL,
        )

        # Schedule S1: multi-barangay route (A, B, C, plus a stop with barangay_id=None) assigned to Team 1
        self.sched_1 = CollectionSchedule.objects.create(
            truck=self.truck_1,
            driver=self.driver_1,
            dumpsite=self.dumpsite,
            default_team=self.team_1,
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(6, 0),
            end_time=time(10, 0),
            area='Multi-Barangay Route 1',
            waypoints=[
                {'lat': 13.930, 'lng': 121.610, 'label': 'Dumpsite Base', 'is_base': True},
                {'lat': 13.932, 'lng': 121.612, 'label': 'Stop 1 Alpha', 'barangay_id': self.brgy_a.id},
                {'lat': 13.942, 'lng': 121.622, 'label': 'Stop 2 Beta', 'barangay_id': self.brgy_b.id},
                {'lat': 13.952, 'lng': 121.632, 'label': 'Stop 3 Gamma', 'barangay_id': self.brgy_c.id},
                {'lat': 13.962, 'lng': 121.642, 'label': 'Stop 4 Unmapped'},
            ],
        )
        self.sched_1.barangays.add(self.brgy_a, self.brgy_b, self.brgy_c)

        # Schedule S2: lies inside Brgy Alpha (Watcher 1's home barangay), assigned to Team 2 (Watcher 2)
        self.sched_2 = CollectionSchedule.objects.create(
            truck=self.truck_2,
            driver=self.driver_2,
            dumpsite=self.dumpsite,
            default_team=self.team_2,
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(8, 0),
            end_time=time(12, 0),
            area='Other Team Home Brgy Route',
            waypoints=[
                {'lat': 13.930, 'lng': 121.610, 'label': 'Dumpsite Base', 'is_base': True},
                {'lat': 13.933, 'lng': 121.613, 'label': 'Other Team Stop A', 'barangay_id': self.brgy_a.id},
            ],
        )
        self.sched_2.barangays.add(self.brgy_a)

        # Schedule S3: Driver-led team in Brgy Alpha
        self.sched_driver_led = CollectionSchedule.objects.create(
            truck=self.truck_2,
            driver=self.driver_2,
            dumpsite=self.dumpsite,
            default_team=self.team_driver_led,
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(10, 0),
            end_time=time(13, 0),
            area='Driver Led Brgy Alpha',
            waypoints=[
                {'lat': 13.930, 'lng': 121.610, 'label': 'Base', 'is_base': True},
                {'lat': 13.934, 'lng': 121.614, 'label': 'Driver Led Stop', 'barangay_id': self.brgy_a.id},
            ],
        )
        self.sched_driver_led.barangays.add(self.brgy_a)

        # Schedule S4: No team / un-teamed in Brgy Alpha
        self.sched_unteamed = CollectionSchedule.objects.create(
            truck=self.truck_2,
            driver=self.driver_2,
            dumpsite=self.dumpsite,
            default_team=None,
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(11, 0),
            end_time=time(14, 0),
            area='Unteamed Brgy Alpha',
            waypoints=[
                {'lat': 13.930, 'lng': 121.610, 'label': 'Base', 'is_base': True},
                {'lat': 13.935, 'lng': 121.615, 'label': 'Unteamed Stop', 'barangay_id': self.brgy_a.id},
            ],
        )

        # Ensure today's StopValidation rows exist cleanly
        self.s1_v1 = StopValidation.objects.get(schedule=self.sched_1, stop_order=1, collection_date=self.today)
        self.s1_v2 = StopValidation.objects.get(schedule=self.sched_1, stop_order=2, collection_date=self.today)
        self.s1_v3 = StopValidation.objects.get(schedule=self.sched_1, stop_order=3, collection_date=self.today)
        self.s1_v4 = StopValidation.objects.get(schedule=self.sched_1, stop_order=4, collection_date=self.today)
        self.s2_v1 = StopValidation.objects.get(schedule=self.sched_2, stop_order=1, collection_date=self.today)
        self.sd_v1 = StopValidation.objects.get(schedule=self.sched_driver_led, stop_order=1, collection_date=self.today)
        self.su_v1 = StopValidation.objects.get(schedule=self.sched_unteamed, stop_order=1, collection_date=self.today)

    # ------------------------------------------------------------------
    # Area (1): Cross-barangay route validation authorization (R2, R4, D-9)
    # ------------------------------------------------------------------

    def test_cross_barangay_list_retrieve_pre_inspect_post_verify_without_watcher_shift(self):
        # D-9: No WatcherShift exists yet for watcher_1 (home barangay = Brgy Alpha)
        self.assertFalse(WatcherShift.objects.filter(watcher=self.watcher_1, is_active=True).exists())
        self.assertTrue(can_inspect_collection_stop(self.watcher_1, self.sched_1, service_date=self.today))

        self.client.force_authenticate(user=self.watcher_1)
        res_list = self.client.get('/api/watcher/stop-validations/')
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        rows = res_list.data if isinstance(res_list.data, list) else res_list.data.get('results', [])
        ids = {r['id'] for r in rows}

        # All 4 stops on S1 (Brgy A, B, C, and barangay=None) are visible
        self.assertEqual(ids, {self.s1_v1.id, self.s1_v2.id, self.s1_v3.id, self.s1_v4.id})

        # Cross-barangay retrieve works
        self.assertEqual(self.client.get(f'/api/watcher/stop-validations/{self.s1_v2.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/watcher/stop-validations/{self.s1_v4.id}/').status_code, 200)

        # Pre-inspect Stop 2 (Brgy Beta) without WatcherShift -> 200 OK
        res_pre_2 = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': self.sched_1.id,
            'stop_order': 2,
            'outcome': 'present',
            'lat': 13.942,
            'lng': 121.622,
            'notes': 'Cross-barangay pre-inspection',
        })
        self.assertEqual(res_pre_2.status_code, status.HTTP_200_OK)
        self.s1_v2.refresh_from_db()
        self.assertEqual(self.s1_v2.current_status, StopValidationStatus.READY_FOR_COLLECTION)
        self.assertEqual(self.s1_v2.pre_validation_watcher_id, self.watcher_1.id)

        # Post-verify Stop 3 (Brgy Gamma) without WatcherShift -> 200 OK
        res_post_3 = self.client.post('/api/watcher/stop-validations/post-verify/', {
            'schedule_id': self.sched_1.id,
            'stop_order': 3,
            'outcome': 'success',
            'lat': 13.952,
            'lng': 121.632,
        })
        self.assertEqual(res_post_3.status_code, status.HTTP_200_OK)
        self.s1_v3.refresh_from_db()
        self.assertEqual(self.s1_v3.current_status, StopValidationStatus.VERIFIED_COLLECTED)
        self.assertEqual(self.s1_v3.post_validation_watcher_id, self.watcher_1.id)

        # Pre-inspect Stop 4 (StopValidation.barangay is None) -> 200 OK
        self.assertIsNone(self.s1_v4.barangay_id)
        res_pre_4 = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': self.sched_1.id,
            'stop_order': 4,
            'outcome': 'empty',
            'lat': 13.962,
            'lng': 121.642,
        })
        self.assertEqual(res_pre_4.status_code, status.HTTP_200_OK)
        self.s1_v4.refresh_from_db()
        self.assertEqual(self.s1_v4.current_status, StopValidationStatus.EMPTY_STOP)

    def test_watcher_with_null_home_barangay_authorized_via_deployment_leader(self):
        team_nb = TeamService.create_team(name='No Brgy Leader Team', code='S5A-NB')
        TeamService.assign_member(team_nb.id, self.w_watcher_nobrgy.id, 'leader', created_by=self.admin)
        sched_nb = CollectionSchedule.objects.create(
            truck=self.truck_1,
            driver=self.driver_1,
            dumpsite=self.dumpsite,
            default_team=team_nb,
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(7, 0),
            end_time=time(11, 0),
            waypoints=[
                {'lat': 13.930, 'lng': 121.610, 'is_base': True},
                {'lat': 13.945, 'lng': 121.625, 'label': 'NB Stop', 'barangay_id': self.brgy_b.id},
            ],
        )
        sv_nb = StopValidation.objects.get(schedule=sched_nb, stop_order=1, collection_date=self.today)

        self.assertIsNone(self.watcher_no_brgy.barangay_id)
        self.client.force_authenticate(user=self.watcher_no_brgy)

        res = self.client.get('/api/watcher/stop-validations/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = {r['id'] for r in (res.data if isinstance(res.data, list) else res.data.get('results', []))}
        self.assertEqual(ids, {sv_nb.id})

        res_pre = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': sched_nb.id,
            'stop_order': 1,
            'outcome': 'present',
            'lat': 13.945,
            'lng': 121.625,
        })
        self.assertEqual(res_pre.status_code, status.HTTP_200_OK)

    def test_schedule_team_override_switches_watcher_stop_authorization(self):
        ScheduleTeamOverride.objects.create(
            schedule=self.sched_1,
            effective_date=self.today,
            team=self.team_2,
            reason='Same-day reassignment',
            created_by=self.admin,
        )

        self.assertFalse(can_inspect_collection_stop(self.watcher_1, self.sched_1, service_date=self.today))
        self.assertTrue(can_inspect_collection_stop(self.watcher_2, self.sched_1, service_date=self.today))

        # Watcher 1 loses access to S1
        self.client.force_authenticate(user=self.watcher_1)
        rows_w1 = self.client.get('/api/watcher/stop-validations/').data
        rows_w1 = rows_w1 if isinstance(rows_w1, list) else rows_w1.get('results', [])
        self.assertEqual(len(rows_w1), 0)
        self.assertEqual(self.client.get(f'/api/watcher/stop-validations/{self.s1_v1.id}/').status_code, 404)
        self.assertEqual(
            self.client.post('/api/watcher/stop-validations/pre-inspect/', {
                'schedule_id': self.sched_1.id, 'stop_order': 1, 'outcome': 'present', 'lat': 13.932, 'lng': 121.612,
            }).status_code,
            403,
        )

        # Watcher 2 gains access to all S1 stops (A, B, C, unmapped)
        self.client.force_authenticate(user=self.watcher_2)
        rows_w2 = self.client.get('/api/watcher/stop-validations/').data
        rows_w2 = rows_w2 if isinstance(rows_w2, list) else rows_w2.get('results', [])
        ids_w2 = {r['id'] for r in rows_w2}
        self.assertTrue({self.s1_v1.id, self.s1_v2.id, self.s1_v3.id, self.s1_v4.id}.issubset(ids_w2))
        self.assertEqual(
            self.client.post('/api/watcher/stop-validations/pre-inspect/', {
                'schedule_id': self.sched_1.id, 'stop_order': 3, 'outcome': 'present', 'lat': 13.952, 'lng': 121.632,
            }).status_code,
            200,
        )

    def test_cancelled_schedule_denied_for_watcher_stop_inspection(self):
        self.sched_1.status = 'CANCELLED'
        self.sched_1.save(update_fields=['status'])

        self.assertFalse(can_inspect_collection_stop(self.watcher_1, self.sched_1, service_date=self.today))
        self.client.force_authenticate(user=self.watcher_1)
        rows = self.client.get('/api/watcher/stop-validations/').data
        rows = rows if isinstance(rows, list) else rows.get('results', [])
        self.assertEqual(len(rows), 0)
        self.assertEqual(
            self.client.post('/api/watcher/stop-validations/pre-inspect/', {
                'schedule_id': self.sched_1.id, 'stop_order': 1, 'outcome': 'present', 'lat': 13.932, 'lng': 121.612,
            }).status_code,
            403,
        )

    # ------------------------------------------------------------------
    # Area (2): Rejection of unrelated teams/deployments & spoofing (R2)
    # ------------------------------------------------------------------

    def test_unrelated_teams_in_home_barangay_rejected_and_spoofing_ignored(self):
        # s2_v1, sd_v1, and su_v1 are ALL in Brgy Alpha (watcher_1's home barangay),
        # but belong to Team 2, Driver-led Team, and Unteamed schedules respectively.
        self.client.force_authenticate(user=self.watcher_1)

        # 1. List with spoofed query params cannot leak S2/S3/S4
        res_list = self.client.get(
            f'/api/watcher/stop-validations/?barangay_id={self.brgy_a.id}&team_id={self.team_1.id}'
        )
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        rows = res_list.data if isinstance(res_list.data, list) else res_list.data.get('results', [])
        ids = {r['id'] for r in rows}
        self.assertNotIn(self.s2_v1.id, ids)
        self.assertNotIn(self.sd_v1.id, ids)
        self.assertNotIn(self.su_v1.id, ids)

        # 2. Explicit ?schedule_id= for unauthorized schedules returns empty
        for unauth_sched in (self.sched_2, self.sched_driver_led, self.sched_unteamed):
            res_q = self.client.get(f'/api/watcher/stop-validations/?schedule_id={unauth_sched.id}')
            self.assertEqual(res_q.status_code, status.HTTP_200_OK)
            q_rows = res_q.data if isinstance(res_q.data, list) else res_q.data.get('results', [])
            self.assertEqual(len(q_rows), 0)

        # 3. Direct retrieve returns 404
        for unauth_val in (self.s2_v1, self.sd_v1, self.su_v1):
            self.assertEqual(self.client.get(f'/api/watcher/stop-validations/{unauth_val.id}/').status_code, 404)

        # 4. Pre-inspect & post-verify with spoofed barangay_id/team_id/watcher_id return 403
        for unauth_sched, lat, lng in (
            (self.sched_2, 13.933, 121.613),
            (self.sched_driver_led, 13.934, 121.614),
            (self.sched_unteamed, 13.935, 121.615),
        ):
            res_pre = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
                'schedule_id': unauth_sched.id,
                'stop_order': 1,
                'outcome': 'present',
                'lat': lat,
                'lng': lng,
                'team_id': self.team_1.id,
                'barangay_id': self.brgy_a.id,
                'watcher_id': self.watcher_2.id,
            })
            self.assertEqual(res_pre.status_code, status.HTTP_403_FORBIDDEN)

            res_post = self.client.post('/api/watcher/stop-validations/post-verify/', {
                'schedule_id': unauth_sched.id,
                'stop_order': 1,
                'outcome': 'success',
                'lat': lat,
                'lng': lng,
                'team_id': self.team_1.id,
                'barangay_id': self.brgy_a.id,
            })
            self.assertEqual(res_post.status_code, status.HTTP_403_FORBIDDEN)

    def test_driver_leader_crew_and_missing_leadership_fail_closed(self):
        # Driver leader on driver-led team cannot perform Watcher stop actions
        self.assertFalse(can_inspect_collection_stop(self.driver_2, self.sched_driver_led, service_date=self.today))
        self.client.force_authenticate(user=self.driver_2)
        self.assertEqual(
            self.client.post('/api/watcher/stop-validations/pre-inspect/', {
                'schedule_id': self.sched_driver_led.id, 'stop_order': 1, 'outcome': 'present',
                'lat': 13.934, 'lng': 121.614,
            }).status_code,
            403,
        )

        # Crew citizen cannot access StopValidationViewSet
        self.assertFalse(can_inspect_collection_stop(self.crew_citizen, self.sched_1, service_date=self.today))
        self.client.force_authenticate(user=self.crew_citizen)
        self.assertEqual(self.client.get('/api/watcher/stop-validations/').status_code, 403)

        # Team with 0 active leaders fails closed
        sched_nl = CollectionSchedule.objects.create(
            truck=self.truck_2,
            driver=self.driver_2,
            dumpsite=self.dumpsite,
            default_team=self.team_no_leader,
            days='Mon, Tue, Wed, Thu, Fri, Sat, Sun',
            start_time=time(12, 0),
            end_time=time(15, 0),
            waypoints=[{'lat': 13.930, 'lng': 121.610, 'is_base': True}, {'lat': 13.936, 'lng': 121.616}],
        )
        self.assertFalse(can_inspect_collection_stop(self.watcher_1, sched_nl, service_date=self.today))
        self.assertEqual(
            filter_watcher_authorized_schedule_dates(self.watcher_1, [(sched_nl.id, self.today)]),
            set(),
        )

    def test_pickup_status_viewset_hardening_for_watcher_and_citizen(self):
        # PickupStatus rows exist on both sched_1 and sched_2
        ps_s1 = PickupStatus.objects.filter(schedule=self.sched_1).first()
        ps_s2 = PickupStatus.objects.filter(schedule=self.sched_2).first()
        self.assertIsNotNone(ps_s1)
        self.assertIsNotNone(ps_s2)

        # Watcher 1 only sees sched_1 pickup statuses, never sched_2 even with ?schedule_id= / ?driver_id=
        self.client.force_authenticate(user=self.watcher_1)
        res_w = self.client.get(f'/api/driver/stops/?schedule_id={self.sched_2.id}&driver_id={self.driver_2.id}')
        self.assertEqual(res_w.status_code, status.HTTP_200_OK)
        rows_w = res_w.data if isinstance(res_w.data, list) else res_w.data.get('results', [])
        self.assertEqual(len(rows_w), 0)

        res_w_own = self.client.get('/api/driver/stops/')
        self.assertEqual(res_w_own.status_code, status.HTTP_200_OK)
        rows_w_own = res_w_own.data if isinstance(res_w_own.data, list) else res_w_own.data.get('results', [])
        self.assertTrue(all(r['schedule'] == self.sched_1.id for r in rows_w_own))
        self.assertGreater(len(rows_w_own), 0)

        # Citizen receives empty queryset even with ?schedule_id= / ?driver_id=
        self.client.force_authenticate(user=self.citizen)
        res_c = self.client.get(f'/api/driver/stops/?schedule_id={self.sched_1.id}&driver_id={self.driver_1.id}')
        self.assertEqual(res_c.status_code, status.HTTP_200_OK)
        rows_c = res_c.data if isinstance(res_c.data, list) else res_c.data.get('results', [])
        self.assertEqual(len(rows_c), 0)

        # Driver 1 cannot spy on Driver 2 via ?driver_id=
        self.client.force_authenticate(user=self.driver_1)
        res_d = self.client.get(f'/api/driver/stops/?driver_id={self.driver_2.id}')
        self.assertEqual(res_d.status_code, status.HTTP_200_OK)
        rows_d = res_d.data if isinstance(res_d.data, list) else res_d.data.get('results', [])
        self.assertEqual(len(rows_d), 0)

    # ------------------------------------------------------------------
    # Area (3): Preservation of residential reporting & community voting (R2)
    # ------------------------------------------------------------------

    def test_civic_voting_and_confirmations_remain_strictly_home_barangay_scoped(self):
        # Even while Watcher 1 has an active WatcherShift on cross-barangay S1 (covering Brgy Beta)
        WatcherShift.objects.create(
            watcher=self.watcher_1,
            schedule=self.sched_1,
            barangay=self.brgy_a,
            shift_date=self.today,
            is_active=True,
        )

        report_alpha = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.brgy_a,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH,
            status=ReportStatus.APPROVED,
            address='Alpha Street',
            description='Approved report in Alpha',
        )
        report_beta = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.brgy_b,
            issue_type=IssueType.ILLEGAL_DUMP,
            severity=Severity.HIGH,
            status=ReportStatus.APPROVED,
            address='Beta Street',
            description='Approved report in Beta',
        )

        # Permission helper check
        self.assertTrue(can_vote_on_report(self.watcher_1, report_alpha))
        self.assertFalse(can_vote_on_report(self.watcher_1, report_beta))

        self.client.force_authenticate(user=self.watcher_1)

        # Voting in Brgy Alpha -> 200 OK; Voting in Brgy Beta -> 403 Forbidden
        self.assertEqual(
            self.client.post(f'/api/watcher/reports/{report_alpha.id}/vote/', {'vote_type': 1}).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(f'/api/watcher/reports/{report_beta.id}/vote/', {'vote_type': 1}).status_code,
            403,
        )

        # Residential CollectionConfirmation in Brgy Beta -> 403 Forbidden
        res_conf_beta = self.client.post('/api/watcher/confirmations/', {
            'report': report_beta.id,
            'notes': 'Trying outside home barangay',
        })
        self.assertEqual(res_conf_beta.status_code, status.HTTP_403_FORBIDDEN)

        # Residential GarbageReport creation remains PENDING and watcher_spot remains watcher-only
        res_cit_report = self.client.post('/api/watcher/reports/', {
            'issue_type': IssueType.OVERFLOW,
            'severity': Severity.MEDIUM,
            'address': '100 Alpha Rd',
            'description': 'Residential report',
            'is_watcher_spot': False,
        })
        self.assertEqual(res_cit_report.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_cit_report.data['status'], ReportStatus.PENDING)

        res_spot = self.client.post('/api/watcher/reports/', {
            'issue_type': IssueType.OVERFLOW,
            'severity': Severity.HIGH,
            'address': '200 Beta Rd',
            'description': 'Watcher spot',
            'latitude': 13.942,
            'longitude': 121.622,
            'is_watcher_spot': True,
        })
        self.assertEqual(res_spot.status_code, status.HTTP_201_CREATED)

        # Citizen cannot see watcher spots in reports feed
        self.client.force_authenticate(user=self.citizen)
        res_feed = self.client.get('/api/watcher/reports/')
        self.assertEqual(res_feed.status_code, status.HTTP_200_OK)
        feed_rows = res_feed.data if isinstance(res_feed.data, list) else res_feed.data.get('results', [])
        self.assertFalse(any(r.get('is_watcher_spot') for r in feed_rows))

    # ------------------------------------------------------------------
    # Area (7): Critical shift & collection lifecycle regressions (R4)
    # ------------------------------------------------------------------

    def test_shift_lifecycle_and_d9_order_independence_preserved(self):
        allocation = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.sched_1.id,
            allocation_date=self.today,
            truck_id=self.truck_1.id,
            team_id=self.team_1.id,
            allocated_by=self.admin,
        )

        # D-9: Pre-inspect Brgy Beta stop BEFORE starting WatcherShift
        self.client.force_authenticate(user=self.watcher_1)
        res_pre_before = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': self.sched_1.id,
            'stop_order': 2,
            'outcome': 'present',
            'lat': 13.942,
            'lng': 121.622,
        })
        self.assertEqual(res_pre_before.status_code, status.HTTP_200_OK)

        # Start WatcherShift
        res_ws = self.client.post('/api/driver/watcher-shifts/start/', {'schedule_id': self.sched_1.id})
        self.assertIn(res_ws.status_code, (200, 201))
        ws_id = res_ws.data['id']

        # Pre-inspect Brgy Gamma stop AFTER starting WatcherShift
        res_pre_after = self.client.post('/api/watcher/stop-validations/pre-inspect/', {
            'schedule_id': self.sched_1.id,
            'stop_order': 3,
            'outcome': 'empty',
            'lat': 13.952,
            'lng': 121.632,
        })
        self.assertEqual(res_pre_after.status_code, status.HTTP_200_OK)

        # Driver stages & starts shift, Watcher submits crew attendance -> creates linked CrewShift
        driver_shift = ShiftService.stage_and_start_shift(
            driver_user=self.driver_1,
            schedule_id=self.sched_1.id,
            allocation_id=allocation.id,
        )
        ShiftService.record_deployment_attendance(
            schedule_id=self.sched_1.id,
            service_date=self.today,
            attendance_list=[{'worker_id': self.w_crew_1.id, 'status': 'PRESENT'}],
            recorded_by=self.watcher_1,
            require_leadership_mode='watcher',
            allocation_id=allocation.id,
        )

        # Watcher cannot unilaterally end WatcherShift while linked CrewShift / DriverShift active -> 409 Conflict
        res_end = self.client.post(f'/api/driver/watcher-shifts/{ws_id}/end/')
        self.assertEqual(res_end.status_code, status.HTTP_409_CONFLICT)

        # Coordinated Driver conclusion closes DriverShift, CrewShift, and WatcherShift,
        # generates UnfinishedStopReview (D-12), and preserves StopValidation statuses!
        ShiftService.conclude_shift_atomic(
            driver_shift_id=driver_shift.id,
            concluded_by=self.driver_1,
            end_reason='completed',
        )

        driver_shift.refresh_from_db()
        ws_obj = WatcherShift.objects.get(id=ws_id)
        cs_obj = CrewShift.objects.get(driver_shift=driver_shift)
        self.assertFalse(driver_shift.is_active)
        self.assertFalse(ws_obj.is_active)
        self.assertFalse(cs_obj.is_active)

        self.s1_v1.refresh_from_db()
        self.s1_v2.refresh_from_db()
        self.s1_v3.refresh_from_db()
        self.assertEqual(self.s1_v1.current_status, StopValidationStatus.PENDING_INSPECTION)
        self.assertEqual(self.s1_v2.current_status, StopValidationStatus.READY_FOR_COLLECTION)
        self.assertEqual(self.s1_v3.current_status, StopValidationStatus.EMPTY_STOP)

        # Unfinished stops (stop 1, stop 2, stop 4) recorded for review; empty stop 3 not marked unfinished
        unfinished_orders = set(
            UnfinishedStopReview.objects.filter(shift=driver_shift).values_list('stop_order', flat=True)
        )
        self.assertEqual(unfinished_orders, {1, 2, 4})
