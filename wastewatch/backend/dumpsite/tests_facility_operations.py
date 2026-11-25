from datetime import time, timedelta
from decimal import Decimal
import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, UserRole
from accounts.serializers import UserSerializer
from analytics.models import ActivityLog
from driver.allocation_service import AllocationService
from driver.models import (
    CollectionSchedule,
    CommissioningProvenance,
    DriverShift,
    FuelLog,
    MaintenanceRecordStatus,
    Truck,
    TruckCrewAssignment,
    TruckMaintenanceRecord,
    TruckOperationalHoldLog,
    TruckRetirementState,
    TruckStatus,
    Worker,
)
from driver.team_service import TeamService
from dumpsite.models import (
    Dumpsite,
    DumpsiteIncident,
    DumpsiteTruckInspection,
    WasteDelivery,
)

User = get_user_model()


class FacilityOperationsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.today = timezone.localdate()
        self.yesterday = self.today - timedelta(days=1)

        self.brgy_a = Barangay.objects.create(name='Brgy Alpha')
        self.brgy_b = Barangay.objects.create(name='Brgy Beta')

        self.admin_role = User.objects.create_user(
            username='fac_admin_role',
            email='fac_admin_role@test.local',
            password='pw',
            role=UserRole.ADMIN,
            is_staff=False,
            full_name='Role Admin',
        )
        self.admin_staff = User.objects.create_user(
            username='fac_admin_staff',
            email='fac_admin_staff@test.local',
            password='pw',
            role=UserRole.CITIZEN,
            is_staff=True,
            full_name='Staff Admin',
        )
        self.op_a = User.objects.create_user(
            username='fac_op_a',
            email='fac_op_a@test.local',
            password='pw',
            role=UserRole.DUMPSITE,
            full_name='Operator A',
        )
        self.op_b = User.objects.create_user(
            username='fac_op_b',
            email='fac_op_b@test.local',
            password='pw',
            role=UserRole.DUMPSITE,
            full_name='Operator B',
        )
        self.op_unassigned = User.objects.create_user(
            username='fac_op_unassigned',
            email='fac_op_unassigned@test.local',
            password='pw',
            role=UserRole.DUMPSITE,
            full_name='Unassigned Operator',
        )
        self.op_operated_only = User.objects.create_user(
            username='fac_op_operated_only',
            email='fac_op_operated_only@test.local',
            password='pw',
            role=UserRole.DUMPSITE,
            full_name='Operated Only Operator',
        )
        self.driver_a = User.objects.create_user(
            username='fac_driver_a',
            email='fac_driver_a@test.local',
            password='pw',
            role=UserRole.DRIVER,
            full_name='Driver A',
        )
        self.driver_b = User.objects.create_user(
            username='fac_driver_b',
            email='fac_driver_b@test.local',
            password='pw',
            role=UserRole.DRIVER,
            full_name='Driver B',
        )
        self.citizen = User.objects.create_user(
            username='fac_citizen',
            email='fac_citizen@test.local',
            password='pw',
            role=UserRole.CITIZEN,
            full_name='Citizen User',
        )

        self.site_a = Dumpsite.objects.create(
            name='Facility Alpha',
            barangay=self.brgy_a,
            latitude=13.94,
            longitude=121.62,
            operator=self.op_a,
            current_fill_kg=Decimal('500.00'),
        )
        self.site_b = Dumpsite.objects.create(
            name='Facility Beta',
            barangay=self.brgy_b,
            latitude=13.96,
            longitude=121.64,
            operator=self.op_b,
        )
        self.site_c = Dumpsite.objects.create(
            name='Facility Gamma',
            barangay=self.brgy_a,
            latitude=13.98,
            longitude=121.66,
            operator=self.op_operated_only,  # user.dumpsite intentionally None
        )
        self.op_a.dumpsite = self.site_a
        self.op_a.save(update_fields=['dumpsite'])
        self.op_b.dumpsite = self.site_b
        self.op_b.save(update_fields=['dumpsite'])

        now = timezone.now()
        self.truck_a = Truck.objects.create(
            plate_number='FAC-A101',
            model='Isuzu Elf',
            status=TruckStatus.ACTIVE,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_a2 = Truck.objects.create(
            plate_number='FAC-A102',
            model='Hino 300',
            status=TruckStatus.ACTIVE,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_b = Truck.objects.create(
            plate_number='FAC-B201',
            model='Foton',
            status=TruckStatus.ACTIVE,
            commissioning_provenance=CommissioningProvenance.COMMISSIONED_VERIFIED,
            commissioned_at=now,
            retirement_state=TruckRetirementState.OPERATIONAL,
        )
        self.truck_a.drivers.add(self.driver_a)
        self.truck_b.drivers.add(self.driver_b)

        self.team_a = TeamService.create_team(name='Fac Team A', code='FAC-TA')
        self.team_b = TeamService.create_team(name='Fac Team B', code='FAC-TB')
        self.w_a = Worker.objects.create(employee_id='FAC-WA', full_name='Driver A', user=self.driver_a)
        self.w_b = Worker.objects.create(employee_id='FAC-WB', full_name='Driver B', user=self.driver_b)
        TeamService.assign_member(self.team_a.id, self.w_a.id, 'leader', created_by=self.admin_role)
        TeamService.assign_member(self.team_b.id, self.w_b.id, 'leader', created_by=self.admin_role)

        self.sched_a = CollectionSchedule.objects.create(
            area='Alpha Zone',
            truck=self.truck_a,
            driver=self.driver_a,
            dumpsite=self.site_a,
            default_team=self.team_a,
            days=self.today.strftime('%A'),
            start_time=time(6, 0),
            end_time=time(12, 0),
        )
        self.sched_b = CollectionSchedule.objects.create(
            area='Beta Zone',
            truck=self.truck_b,
            driver=self.driver_b,
            dumpsite=self.site_b,
            default_team=self.team_b,
            days=self.today.strftime('%A'),
            start_time=time(6, 0),
            end_time=time(12, 0),
        )

    def test_1_is_admin_user_and_pii_leak_fix_on_dumpsite_viewset(self):
        # Anonymous users cannot access dumpsite list/detail (fixes AllowAny PII leak)
        anon_list = self.client.get('/api/dumpsite/dumpsites/')
        self.assertIn(anon_list.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))
        anon_detail = self.client.get(f'/api/dumpsite/dumpsites/{self.site_a.id}/')
        self.assertIn(anon_detail.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

        # Citizen / Driver see sites for route context, but staff_accounts MUST be [] (no PII)
        for non_admin in (self.citizen, self.driver_a):
            self.client.force_authenticate(user=non_admin)
            res = self.client.get(f'/api/dumpsite/dumpsites/{self.site_a.id}/')
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertEqual(res.data['staff_accounts'], [])

        # Both role='admin' (is_staff=False) and is_staff=True admins see all sites, staff_accounts, and can reset_capacity
        for admin_user in (self.admin_role, self.admin_staff):
            self.client.force_authenticate(user=admin_user)
            list_res = self.client.get('/api/dumpsite/dumpsites/')
            self.assertEqual(list_res.status_code, status.HTTP_200_OK)
            rows = list_res.data.get('results', list_res.data) if isinstance(list_res.data, dict) else list_res.data
            self.assertEqual(len(rows), 3)
            site_a_row = next(r for r in rows if r['id'] == self.site_a.id)
            self.assertTrue(len(site_a_row['staff_accounts']) >= 1)

            reset_res = self.client.post(f'/api/dumpsite/dumpsites/{self.site_a.id}/reset_capacity/')
            self.assertEqual(reset_res.status_code, status.HTTP_200_OK)
            self.site_a.refresh_from_db()
            self.assertEqual(float(self.site_a.current_fill_kg), 0.0)

    def test_2_operator_scoping_unassigned_cross_facility_and_operated_dumpsite_fallback(self):
        # Unassigned operator gets [] on list and 403 on all facility actions
        self.client.force_authenticate(user=self.op_unassigned)
        list_res = self.client.get('/api/dumpsite/dumpsites/')
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        rows = list_res.data.get('results', list_res.data) if isinstance(list_res.data, dict) else list_res.data
        self.assertEqual(rows, [])

        for endpoint in ('dashboard', 'monitoring', 'activity', 'inbound_queue', 'deliveries', 'barangay_breakdown'):
            res = self.client.get(f'/api/dumpsite/dumpsites/{self.site_a.id}/{endpoint}/')
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN, endpoint)

        self.assertEqual(
            self.client.post(f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/', {
                'truck': self.truck_a.id,
                'estimated_kg': 100,
                'fill_level': 'half',
            }, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post('/api/dumpsite/waste-deliveries/', {
                'truck': self.truck_a.id,
                'driver': self.driver_a.id,
                'dumpsite': self.site_a.id,
                'date': str(self.today),
                'estimated_kg': 100,
            }, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )

        # Operator linked only via Dumpsite.operator (user.dumpsite is None) can access own facility
        self.client.force_authenticate(user=self.op_operated_only)
        self.assertEqual(
            self.client.get(f'/api/dumpsite/dumpsites/{self.site_c.id}/dashboard/').status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.get(f'/api/dumpsite/dumpsites/{self.site_a.id}/dashboard/').status_code,
            status.HTTP_404_NOT_FOUND,
        )

        # Operator A sees only Site A and is blocked from Site B
        self.client.force_authenticate(user=self.op_a)
        list_a = self.client.get('/api/dumpsite/dumpsites/')
        rows_a = list_a.data.get('results', list_a.data) if isinstance(list_a.data, dict) else list_a.data
        self.assertEqual([r['id'] for r in rows_a], [self.site_a.id])
        self.assertEqual(len(rows_a[0]['staff_accounts']), 1)

        for endpoint in ('dashboard', 'monitoring', 'activity', 'inbound_queue', 'deliveries', 'barangay_breakdown'):
            res = self.client.get(f'/api/dumpsite/dumpsites/{self.site_b.id}/{endpoint}/')
            self.assertIn(res.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND), endpoint)

    def test_3_operator_self_assignment_and_permission_modification_rejected(self):
        # PATCH /api/auth/me/ rejects every restricted field with 403 Forbidden
        self.client.force_authenticate(user=self.op_a)
        restricted_payloads = [
            {'role': 'admin'},
            {'dumpsite': self.site_b.id},
            {'operated_dumpsite': self.site_b.id},
            {'is_staff': True},
            {'is_superuser': True},
            {'employee_type': 'crew_member'},
            {'groups': []},
            {'user_permissions': []},
        ]
        for payload in restricted_payloads:
            res = self.client.patch('/api/auth/me/', payload, format='json')
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN, payload)

        self.op_a.refresh_from_db()
        self.assertEqual(self.op_a.role, UserRole.DUMPSITE)
        self.assertEqual(self.op_a.dumpsite_id, self.site_a.id)
        self.assertFalse(self.op_a.is_staff)

        # Legitimate profile field update succeeds
        ok_res = self.client.patch('/api/auth/me/', {'full_name': 'Operator A Updated'}, format='json')
        self.assertEqual(ok_res.status_code, status.HTTP_200_OK)
        self.op_a.refresh_from_db()
        self.assertEqual(self.op_a.full_name, 'Operator A Updated')

        # UserSerializer protects dumpsite & employee_type as read_only_fields
        ser = UserSerializer(
            self.op_a,
            data={'dumpsite': self.site_b.id, 'employee_type': 'crew_member', 'role': 'admin', 'full_name': 'Same'},
            partial=True,
        )
        self.assertTrue(ser.is_valid(), ser.errors)
        ser.save()
        self.op_a.refresh_from_db()
        self.assertEqual(self.op_a.dumpsite_id, self.site_a.id)
        self.assertEqual(self.op_a.role, UserRole.DUMPSITE)
        self.assertEqual(self.op_a.employee_type, '')

        # Non-admin operator cannot call UserViewSet, assign-operator, remove-operator, or reset_capacity
        self.assertEqual(
            self.client.patch(f'/api/accounts/users/{self.op_a.id}/', {'dumpsite': self.site_b.id}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(f'/api/dumpsite/dumpsites/{self.site_a.id}/assign-operator/', {'user_id': self.op_unassigned.id}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(f'/api/dumpsite/dumpsites/{self.site_a.id}/remove-operator/', {'user_id': self.op_a.id}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(f'/api/dumpsite/dumpsites/{self.site_a.id}/reset_capacity/', {}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_4_admin_assign_remove_operator_and_user_management_sync(self):
        self.client.force_authenticate(user=self.admin_role)

        # Rejects non-dumpsite role (driver) on assign-operator
        bad_role = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/assign-operator/',
            {'user_id': self.driver_a.id, 'make_primary': True},
            format='json',
        )
        self.assertEqual(bad_role.status_code, status.HTTP_400_BAD_REQUEST)

        # Assign unassigned operator as primary on site_a -> updates site_a.operator & user.dumpsite
        res_assign = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/assign-operator/',
            {'user_id': self.op_unassigned.id, 'make_primary': True},
            format='json',
        )
        self.assertEqual(res_assign.status_code, status.HTTP_200_OK)
        self.assertEqual(res_assign.data['operator'], self.op_unassigned.id)
        self.op_unassigned.refresh_from_db()
        self.site_a.refresh_from_db()
        self.assertEqual(self.op_unassigned.dumpsite_id, self.site_a.id)
        self.assertEqual(self.site_a.operator_id, self.op_unassigned.id)
        self.assertTrue(ActivityLog.objects.filter(module='Dumpsite', details__contains='DUMPSITE_OPERATOR_ASSIGNED').exists())

        # Reassign op_unassigned from site_a to site_b -> clears site_a.operator and sets site_b.operator
        res_move = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_b.id}/assign-operator/',
            {'user_id': self.op_unassigned.id, 'make_primary': True},
            format='json',
        )
        self.assertEqual(res_move.status_code, status.HTTP_200_OK)
        self.site_a.refresh_from_db()
        self.site_b.refresh_from_db()
        self.op_unassigned.refresh_from_db()
        self.assertIsNone(self.site_a.operator_id)
        self.assertEqual(self.site_b.operator_id, self.op_unassigned.id)
        self.assertEqual(self.op_unassigned.dumpsite_id, self.site_b.id)

        # Remove operator from site_b
        res_remove = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_b.id}/remove-operator/',
            {'user_id': self.op_unassigned.id},
            format='json',
        )
        self.assertEqual(res_remove.status_code, status.HTTP_200_OK)
        self.site_b.refresh_from_db()
        self.op_unassigned.refresh_from_db()
        self.assertIsNone(self.site_b.operator_id)
        self.assertIsNone(self.op_unassigned.dumpsite_id)

        # AdminUserSerializer sync: assign op_unassigned to site_a via UserViewSet, then change role to driver
        res_user_assign = self.client.patch(
            f'/api/accounts/users/{self.op_unassigned.id}/',
            {'dumpsite': self.site_a.id},
            format='json',
        )
        self.assertEqual(res_user_assign.status_code, status.HTTP_200_OK)
        self.site_a.refresh_from_db()
        self.assertEqual(self.site_a.operator_id, self.op_unassigned.id)

        res_role_change = self.client.patch(
            f'/api/accounts/users/{self.op_unassigned.id}/',
            {'role': UserRole.DRIVER},
            format='json',
        )
        self.assertEqual(res_role_change.status_code, status.HTTP_200_OK)
        self.site_a.refresh_from_db()
        self.op_unassigned.refresh_from_db()
        self.assertIsNone(self.site_a.operator_id)
        self.assertIsNone(self.op_unassigned.dumpsite_id)

    def test_5_dashboard_monitoring_states_and_activity_real_db_counts(self):
        # Seed real records at Facility A and Facility B
        alloc_a = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.sched_a.id,
            allocation_date=self.today,
            truck_id=self.truck_a.id,
            team_id=self.team_a.id,
            allocated_by=self.admin_role,
        )
        sched_a2 = CollectionSchedule.objects.create(
            area='Alpha Zone 2',
            truck=self.truck_a2,
            driver=self.driver_a,
            dumpsite=self.site_a,
            default_team=self.team_a,
            days=self.today.strftime('%A'),
            start_time=time(7, 0),
            end_time=time(13, 0),
        )

        # 1. Active shift heading_to_dumpsite -> 'returning'
        s_ret = DriverShift.objects.create(
            driver=self.driver_a,
            truck=self.truck_a,
            allocation=alloc_a,
            schedule=self.sched_a,
            is_active=True,
            status='shiftroute',
            op_status='heading_to_dumpsite',
        )
        # 2. Closed shift today without post-shift inspection -> 'awaiting_post_shift_inspection'
        driver_a2 = User.objects.create_user(
            username='fac_drv_a2', email='fac_drv_a2@test.local', password='pw', role=UserRole.DRIVER, full_name='Driver A2'
        )
        s_await = DriverShift.objects.create(
            driver=driver_a2,
            truck=self.truck_a2,
            schedule=sched_a2,
            is_active=False,
            status='end_shift',
            op_status='returning_to_base',
            ended_at=timezone.now(),
        )
        # 3. Closed shift today WITH PASSED inspection -> 'shift_completed'
        driver_a3 = User.objects.create_user(
            username='fac_drv_a3', email='fac_drv_a3@test.local', password='pw', role=UserRole.DRIVER, full_name='Driver A3'
        )
        s_done = DriverShift.objects.create(
            driver=driver_a3,
            truck=self.truck_a2,
            schedule=sched_a2,
            is_active=False,
            status='end_shift',
            op_status='off_duty',
            ended_at=timezone.now(),
        )
        DumpsiteTruckInspection.objects.create(
            truck=self.truck_a2,
            dumpsite=self.site_a,
            driver_shift=s_done,
            submitted_by=self.op_a,
            inspection_type='POST_SHIFT',
            inspection_state='PASSED',
            mechanical_condition='OPERATIONAL',
        )

        # Facility B noise that MUST NOT bleed into Facility A
        DriverShift.objects.create(
            driver=self.driver_b,
            truck=self.truck_b,
            schedule=self.sched_b,
            is_active=True,
            status='shiftroute',
            op_status='heading_to_dumpsite',
        )
        WasteDelivery.objects.create(
            truck=self.truck_b,
            driver=self.driver_b,
            dumpsite=self.site_b,
            dumpsite_operator=self.op_b,
            schedule=self.sched_b,
            date=self.today,
            estimated_kg=Decimal('999.00'),
            fill_level='full',
        )

        # Facility A hold, maintenance, fuel, and delivery
        self.truck_a2.is_operational_hold = True
        self.truck_a2.hold_dumpsite = self.site_a
        self.truck_a2.hold_reason = 'Brake inspection'
        self.truck_a2.save(update_fields=['is_operational_hold', 'hold_dumpsite', 'hold_reason'])
        TruckOperationalHoldLog.objects.create(
            truck=self.truck_a2, dumpsite=self.site_a, is_active=True, reason='Brake inspection', placed_by=self.op_a
        )
        TruckMaintenanceRecord.objects.create(
            truck=self.truck_a2,
            dumpsite=self.site_a,
            status=MaintenanceRecordStatus.IN_PROGRESS,
            title='Replace brake pads',
            created_by=self.op_a,
        )
        FuelLog.objects.create(
            driver_shift=s_ret,
            truck=self.truck_a,
            dumpsite=self.site_a,
            driver=self.driver_a,
            gauge_percentage=Decimal('40.00'),
            gauge_submitted_by=self.driver_a,
            gauge_submitted_at=timezone.now(),
        )
        deliv_a = WasteDelivery.objects.create(
            truck=self.truck_a,
            driver=self.driver_a,
            dumpsite=self.site_a,
            dumpsite_operator=self.op_a,
            schedule=self.sched_a,
            date=self.today,
            estimated_kg=Decimal('450.00'),
            fill_level='half',
        )
        deliv_a.barangays.add(self.brgy_a)

        self.client.force_authenticate(user=self.op_a)
        dash_res = self.client.get(f'/api/dumpsite/dumpsites/{self.site_a.id}/dashboard/')
        self.assertEqual(dash_res.status_code, status.HTTP_200_OK)
        summary = dash_res.data['summary']
        self.assertEqual(summary['incoming_trucks'], 1)
        self.assertEqual(summary['active_driver_shifts'], 1)
        self.assertEqual(summary['completed_driver_shifts_today'], 2)
        self.assertEqual(summary['awaiting_post_shift_inspection'], 1)
        self.assertEqual(summary['operational_holds'], 1)
        self.assertEqual(summary['active_maintenance'], 1)
        self.assertEqual(summary['deliveries_today'], 1)
        self.assertEqual(summary['kg_received_today'], 450.0)
        self.assertEqual(summary['barangays_covered_today'], 1)
        self.assertEqual(len(dash_res.data['recent_deliveries']), 1)
        self.assertTrue(len(dash_res.data['recent_activity']) >= 5)

        # Monitoring endpoint
        mon_res = self.client.get(f'/api/dumpsite/dumpsites/{self.site_a.id}/monitoring/')
        self.assertEqual(mon_res.status_code, status.HTTP_200_OK)
        self.assertEqual(mon_res.data['counts']['returning'], 1)
        self.assertEqual(mon_res.data['counts']['awaiting_post_shift_inspection'], 1)
        self.assertEqual(mon_res.data['counts']['shift_completed'], 1)
        self.assertEqual(len(mon_res.data['awaiting_inspection_trucks']), 1)
        self.assertEqual(mon_res.data['awaiting_inspection_trucks'][0]['id'], self.truck_a2.id)

        # Filter monitoring by state
        mon_await = self.client.get(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/monitoring/?state=awaiting_post_shift_inspection'
        )
        self.assertEqual(mon_await.status_code, status.HTTP_200_OK)
        self.assertEqual([r['shift_id'] for r in mon_await.data['results']], [s_await.id])
        self.assertEqual(mon_await.data['counts']['returning'], 1)

        # Activity endpoint scoping & category filter
        act_res = self.client.get(f'/api/dumpsite/dumpsites/{self.site_a.id}/activity/')
        self.assertEqual(act_res.status_code, status.HTTP_200_OK)
        plates = {ev['truck_plate'] for ev in act_res.data['results'] if ev['truck_plate']}
        self.assertNotIn(self.truck_b.plate_number, plates)

        act_fuel = self.client.get(f'/api/dumpsite/dumpsites/{self.site_a.id}/activity/?category=fuel')
        self.assertEqual(act_fuel.status_code, status.HTTP_200_OK)
        self.assertEqual(act_fuel.data['count'], 1)
        self.assertEqual(act_fuel.data['results'][0]['category'], 'fuel')

    def test_6_log_arrival_driver_resolution_and_delivery_incident_scoping(self):
        # 1. log_arrival resolves driver without Truck.driver_id (from TruckCrewAssignment -> truck.drivers.first())
        TruckCrewAssignment.objects.create(
            truck=self.truck_a,
            driver=self.driver_a,
            schedule=self.sched_a,
            date=self.today,
            is_active=True,
        )
        shift_a = DriverShift.objects.create(
            driver=self.driver_a,
            truck=self.truck_a,
            schedule=self.sched_a,
            is_active=True,
            status='end_shift',
            op_status='heading_to_dumpsite',
        )

        self.client.force_authenticate(user=self.op_a)
        arr_res = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/',
            {
                'truck': self.truck_a.id,
                'estimated_kg': 300,
                'fill_level': 'half',
            },
            format='json',
        )
        self.assertEqual(arr_res.status_code, status.HTTP_201_CREATED, arr_res.data)
        self.assertEqual(arr_res.data['driver'], self.driver_a.id)
        self.site_a.refresh_from_db()
        self.assertEqual(float(self.site_a.current_fill_kg), 800.0)
        shift_a.refresh_from_db()
        self.assertEqual(shift_a.op_status, 'returning_to_base')

        # Fallback to truck.drivers.first() when no active shift or crew assignment exists
        shift_a.is_active = False
        shift_a.save(update_fields=['is_active'])
        TruckCrewAssignment.objects.all().delete()
        arr_res2 = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/',
            {
                'truck': self.truck_a.id,
                'estimated_kg': 125,
                'fill_level': 'quarter',
            },
            format='json',
        )
        self.assertEqual(arr_res2.status_code, status.HTTP_201_CREATED)
        self.assertEqual(arr_res2.data['driver'], self.driver_a.id)

        # Cross-facility log_arrival (truck_b or sched_b at site_a) rejected with 403
        cross_arr = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/',
            {
                'truck': self.truck_b.id,
                'schedule': self.sched_b.id,
                'estimated_kg': 100,
                'fill_level': 'half',
            },
            format='json',
        )
        self.assertEqual(cross_arr.status_code, status.HTTP_403_FORBIDDEN)

        # 2. WasteDeliveryViewSet rejects cross-facility create/update & schedule mismatch
        cross_deliv = self.client.post(
            '/api/dumpsite/waste-deliveries/',
            {
                'truck': self.truck_b.id,
                'driver': self.driver_b.id,
                'dumpsite': self.site_b.id,
                'date': str(self.today),
                'estimated_kg': 200,
            },
            format='json',
        )
        self.assertEqual(cross_deliv.status_code, status.HTTP_403_FORBIDDEN)

        # 3. DumpsiteIncidentViewSet rejects cross-facility incident creation
        deliv_b = WasteDelivery.objects.create(
            truck=self.truck_b,
            driver=self.driver_b,
            dumpsite=self.site_b,
            dumpsite_operator=self.op_b,
            date=self.today,
            estimated_kg=Decimal('200.00'),
        )
        cross_inc = self.client.post(
            '/api/dumpsite/dumpsite-incidents/',
            {
                'delivery': deliv_b.id,
                'reason': 'contaminated_load',
                'notes': 'Cross-facility attempt',
            },
            format='json',
        )
        self.assertEqual(cross_inc.status_code, status.HTTP_403_FORBIDDEN)

        # Own-facility incident succeeds
        own_inc = self.client.post(
            '/api/dumpsite/dumpsite-incidents/',
            {
                'delivery': arr_res.data['id'],
                'reason': 'weight_discrepancy',
                'notes': 'Scale recheck',
            },
            format='json',
        )
        self.assertEqual(own_inc.status_code, status.HTTP_201_CREATED)

    def test_7_activity_log_viewset_role_and_facility_scoping(self):
        log_a = ActivityLog.objects.create(
            admin=self.op_a,
            action='update',
            module='Dumpsite',
            details=json.dumps({'event': 'FAC_A_EVENT', 'dumpsite_id': self.site_a.id}),
        )
        log_b = ActivityLog.objects.create(
            admin=self.op_b,
            action='update',
            module='Dumpsite',
            details=json.dumps({'event': 'FAC_B_EVENT', 'dumpsite_id': self.site_b.id}),
        )
        log_cit = ActivityLog.objects.create(
            admin=self.citizen,
            action='create',
            module='Reports',
            details='Citizen submitted report',
        )
        log_other = ActivityLog.objects.create(
            admin=self.admin_role,
            action='system',
            module='Users',
            details='Admin global action',
        )

        # Admin sees all 4
        self.client.force_authenticate(user=self.admin_role)
        res_admin = self.client.get('/api/analytics/logs/')
        self.assertEqual(res_admin.status_code, status.HTTP_200_OK)
        admin_ids = {r['id'] for r in res_admin.data['results']}
        self.assertTrue({log_a.id, log_b.id, log_cit.id, log_other.id}.issubset(admin_ids))

        # Operator A sees ONLY Facility A logs
        self.client.force_authenticate(user=self.op_a)
        res_op_a = self.client.get('/api/analytics/logs/')
        self.assertEqual(res_op_a.status_code, status.HTTP_200_OK)
        op_a_ids = {r['id'] for r in res_op_a.data['results']}
        self.assertIn(log_a.id, op_a_ids)
        self.assertNotIn(log_b.id, op_a_ids)
        self.assertNotIn(log_cit.id, op_a_ids)
        self.assertNotIn(log_other.id, op_a_ids)
        self.assertEqual(res_op_a.data['summary']['all'], len(op_a_ids))

        # Unassigned operator sees 0 logs
        self.client.force_authenticate(user=self.op_unassigned)
        res_unassigned = self.client.get('/api/analytics/logs/')
        self.assertEqual(res_unassigned.status_code, status.HTTP_200_OK)
        self.assertEqual(res_unassigned.data['results'], [])
        self.assertEqual(res_unassigned.data['summary']['all'], 0)

        # Citizen sees ONLY own logs (admin=citizen)
        self.client.force_authenticate(user=self.citizen)
        res_cit = self.client.get('/api/analytics/logs/')
        self.assertEqual(res_cit.status_code, status.HTTP_200_OK)
        cit_ids = {r['id'] for r in res_cit.data['results']}
        self.assertEqual(cit_ids, {log_cit.id})
        self.assertEqual(res_cit.data['summary']['all'], 1)

    def test_8_admin_cannot_log_arrival_operator_only(self):
        """
        Verify that Admin users (both role='admin' and is_staff=True) CANNOT log truck arrivals
        or create waste deliveries (returning 403 Forbidden). Only assigned Dumpsite Operators
        possess on-site execution authority to log arrivals.
        """
        TruckCrewAssignment.objects.create(
            truck=self.truck_a,
            driver=self.driver_a,
            schedule=self.sched_a,
            date=self.today,
            is_active=True,
        )

        arrival_payload = {
            'truck': self.truck_a.id,
            'estimated_kg': 250,
            'fill_level': 'half',
        }
        delivery_payload = {
            'truck': self.truck_a.id,
            'driver': self.driver_a.id,
            'dumpsite': self.site_a.id,
            'date': str(self.today),
            'estimated_kg': 250,
        }

        # 1. Admin role user cannot log arrival or create delivery
        self.client.force_authenticate(user=self.admin_role)
        res_admin_arr = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/',
            arrival_payload,
            format='json',
        )
        self.assertEqual(res_admin_arr.status_code, status.HTTP_403_FORBIDDEN)
        res_admin_del = self.client.post(
            '/api/dumpsite/waste-deliveries/',
            delivery_payload,
            format='json',
        )
        self.assertEqual(res_admin_del.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Staff admin user cannot log arrival or create delivery
        self.client.force_authenticate(user=self.admin_staff)
        res_staff_arr = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/',
            arrival_payload,
            format='json',
        )
        self.assertEqual(res_staff_arr.status_code, status.HTTP_403_FORBIDDEN)
        res_staff_del = self.client.post(
            '/api/dumpsite/waste-deliveries/',
            delivery_payload,
            format='json',
        )
        self.assertEqual(res_staff_del.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Assigned dumpsite operator CAN log arrival
        self.client.force_authenticate(user=self.op_a)
        res_op_arr = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/',
            arrival_payload,
            format='json',
        )
        self.assertEqual(res_op_arr.status_code, status.HTTP_201_CREATED)

    def test_9_b02_r3_log_arrival_and_waste_delivery_strict_operator_only_and_fill_sync(self):
        watcher = User.objects.create_user(
            username='fac_watcher', email='fac_watcher@test.local', password='pw',
            role=UserRole.WATCHER, barangay=self.brgy_a, full_name='Fac Watcher',
        )
        brgy_off = User.objects.create_user(
            username='fac_brgy_off', email='fac_brgy_off@test.local', password='pw',
            role=UserRole.BRGY_OFFICIAL, barangay=self.brgy_a, full_name='Fac Official',
        )
        TruckCrewAssignment.objects.create(
            truck=self.truck_a, driver=self.driver_a, schedule=self.sched_a,
            date=self.today, is_active=True,
        )

        # Negative estimated_kg rejected with 400 for assigned operator
        self.client.force_authenticate(user=self.op_a)
        bad_neg = self.client.post(
            '/api/dumpsite/waste-deliveries/',
            {
                'truck': self.truck_a.id,
                'driver': self.driver_a.id,
                'dumpsite': self.site_a.id,
                'date': str(self.today),
                'estimated_kg': -10,
            },
            format='json',
        )
        self.assertEqual(bad_neg.status_code, status.HTTP_400_BAD_REQUEST)

        # Assigned operator creates WasteDelivery -> increments current_fill_kg atomically
        start_fill = Decimal(self.site_a.current_fill_kg)
        create_res = self.client.post(
            '/api/dumpsite/waste-deliveries/',
            {
                'truck': self.truck_a.id,
                'driver': self.driver_a.id,
                'dumpsite': self.site_a.id,
                'schedule': self.sched_a.id,
                'date': str(self.today),
                'estimated_kg': '150.00',
            },
            format='json',
        )
        self.assertEqual(create_res.status_code, status.HTTP_201_CREATED, create_res.data)
        deliv_id = create_res.data['id']
        self.site_a.refresh_from_db()
        self.assertEqual(self.site_a.current_fill_kg, start_fill + Decimal('150.00'))

        # All non-facility-a-operator roles get 403 on log_arrival(site_a) & WasteDelivery create/update/patch/delete
        denied_actors = [
            self.admin_role,
            self.admin_staff,
            self.op_unassigned,
            self.op_b,  # cross-facility must be 403, not 404
            self.driver_a,
            watcher,
            self.citizen,
            brgy_off,
        ]
        arrival_payload = {'truck': self.truck_a.id, 'estimated_kg': 100, 'fill_level': 'half'}
        delivery_payload = {
            'truck': self.truck_a.id,
            'driver': self.driver_a.id,
            'dumpsite': self.site_a.id,
            'date': str(self.today),
            'estimated_kg': 100,
        }
        for actor in denied_actors:
            self.client.force_authenticate(user=actor)
            with self.subTest(actor=actor.username):
                self.assertEqual(
                    self.client.post(f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/', arrival_payload, format='json').status_code,
                    status.HTTP_403_FORBIDDEN,
                )
                self.assertEqual(
                    self.client.post('/api/dumpsite/waste-deliveries/', delivery_payload, format='json').status_code,
                    status.HTTP_403_FORBIDDEN,
                )
                self.assertEqual(
                    self.client.put(f'/api/dumpsite/waste-deliveries/{deliv_id}/', delivery_payload, format='json').status_code,
                    status.HTTP_403_FORBIDDEN,
                )
                self.assertEqual(
                    self.client.patch(f'/api/dumpsite/waste-deliveries/{deliv_id}/', {'estimated_kg': '999.00'}, format='json').status_code,
                    status.HTTP_403_FORBIDDEN,
                )
                self.assertEqual(
                    self.client.delete(f'/api/dumpsite/waste-deliveries/{deliv_id}/').status_code,
                    status.HTTP_403_FORBIDDEN,
                )

        # Admin & Staff Admin retain read-only 200 on list, retrieve, analytics; Driver retains own list
        for reader in (self.admin_role, self.admin_staff):
            self.client.force_authenticate(user=reader)
            self.assertEqual(self.client.get('/api/dumpsite/waste-deliveries/').status_code, status.HTTP_200_OK)
            self.assertEqual(self.client.get(f'/api/dumpsite/waste-deliveries/{deliv_id}/').status_code, status.HTTP_200_OK)
            self.assertEqual(self.client.get('/api/dumpsite/waste-deliveries/analytics/').status_code, status.HTTP_200_OK)

        self.client.force_authenticate(user=self.driver_a)
        drv_list = self.client.get('/api/dumpsite/waste-deliveries/')
        self.assertEqual(drv_list.status_code, status.HTTP_200_OK)

        # Assigned operator PATCH updates delta & DELETE decrements (clamped at 0.00)
        self.client.force_authenticate(user=self.op_a)
        patch_res = self.client.patch(
            f'/api/dumpsite/waste-deliveries/{deliv_id}/',
            {'estimated_kg': '225.00'},
            format='json',
        )
        self.assertEqual(patch_res.status_code, status.HTTP_200_OK)
        self.site_a.refresh_from_db()
        self.assertEqual(self.site_a.current_fill_kg, start_fill + Decimal('225.00'))

        # Set fill lower than delivery estimated_kg to verify clamp at 0.00 on DELETE
        Dumpsite.objects.filter(pk=self.site_a.pk).update(current_fill_kg=Decimal('50.00'))
        del_res = self.client.delete(f'/api/dumpsite/waste-deliveries/{deliv_id}/')
        self.assertEqual(del_res.status_code, status.HTTP_204_NO_CONTENT)
        self.site_a.refresh_from_db()
        self.assertEqual(self.site_a.current_fill_kg, Decimal('0.00'))

    def test_10_r02_inbound_queue_allocation_backed_shift_and_r04_log_arrival_missing_dumpsite(self):
        alloc_a = AllocationService.allocate_truck_for_schedule(
            schedule_id=self.sched_a.id,
            allocation_date=self.today,
            truck_id=self.truck_a.id,
            team_id=self.team_a.id,
            allocated_by=self.admin_role,
        )
        # Allocation-backed shift with schedule=None and truck=None on the DriverShift row
        shift_alloc = DriverShift.objects.create(
            driver=self.driver_a,
            truck=None,
            schedule=None,
            allocation=alloc_a,
            is_active=True,
            status='end_shift',
            op_status='heading_to_dumpsite',
            last_location_update=timezone.now(),
        )

        self.client.force_authenticate(user=self.op_a)
        q_a = self.client.get(f'/api/dumpsite/dumpsites/{self.site_a.id}/inbound_queue/')
        self.assertEqual(q_a.status_code, status.HTTP_200_OK)
        self.assertEqual(len(q_a.data), 1)
        self.assertEqual(q_a.data[0]['shift_id'], shift_alloc.id)
        self.assertEqual(q_a.data[0]['truck_id'], self.truck_a.id)
        self.assertEqual(q_a.data[0]['truck_plate'], self.truck_a.plate_number)
        self.assertEqual(q_a.data[0]['schedule_id'], self.sched_a.id)

        # Admin sees empty inbound_queue for site_b (not leaked across facilities)
        self.client.force_authenticate(user=self.admin_role)
        q_b = self.client.get(f'/api/dumpsite/dumpsites/{self.site_b.id}/inbound_queue/')
        self.assertEqual(q_b.status_code, status.HTTP_200_OK)
        self.assertEqual(q_b.data, [])

        # R-04: log_arrival rejects schedule with dumpsite=None (400) and never auto-attaches one
        shift_alloc.is_active = False
        shift_alloc.save(update_fields=['is_active'])
        no_ds_sched = CollectionSchedule.objects.create(
            area='Missing Dumpsite Zone',
            truck=self.truck_a,
            driver=self.driver_a,
            dumpsite=None,
            default_team=self.team_a,
            days=self.today.strftime('%A'),
            start_time=time(13, 0),
            end_time=time(17, 0),
        )
        DriverShift.objects.create(
            driver=self.driver_a,
            truck=self.truck_a,
            schedule=no_ds_sched,
            is_active=True,
            status='end_shift',
            op_status='heading_to_dumpsite',
        )

        self.client.force_authenticate(user=self.op_a)
        explicit_bad = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/',
            {
                'truck': self.truck_a.id,
                'schedule': no_ds_sched.id,
                'estimated_kg': 100,
                'fill_level': 'half',
            },
            format='json',
        )
        self.assertEqual(explicit_bad.status_code, status.HTTP_400_BAD_REQUEST)

        # Omitting schedule does NOT auto-attach no_ds_sched from active_shift
        auto_res = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/',
            {
                'truck': self.truck_a.id,
                'estimated_kg': 100,
                'fill_level': 'half',
            },
            format='json',
        )
        self.assertEqual(auto_res.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(auto_res.data.get('schedule'), no_ds_sched.id)

    def test_11_b02_waste_delivery_update_cannot_spoof_or_clear_dumpsite_operator(self):
        self.client.force_authenticate(user=self.op_a)

        # log_arrival still records dumpsite_operator=op_a even with dumpsite_operator read-only
        arr_res = self.client.post(
            f'/api/dumpsite/dumpsites/{self.site_a.id}/log_arrival/',
            {
                'truck': self.truck_a.id,
                'driver': self.driver_a.id,
                'schedule': self.sched_a.id,
                'dumpsite_operator': self.op_b.id,
                'estimated_kg': 100,
                'fill_level': 'half',
            },
            format='json',
        )
        self.assertEqual(arr_res.status_code, status.HTTP_201_CREATED, arr_res.data)
        self.assertEqual(arr_res.data['dumpsite_operator'], self.op_a.id)

        create_res = self.client.post(
            '/api/dumpsite/waste-deliveries/',
            {
                'truck': self.truck_a.id,
                'driver': self.driver_a.id,
                'dumpsite': self.site_a.id,
                'schedule': self.sched_a.id,
                'date': str(self.today),
                'estimated_kg': '120.00',
            },
            format='json',
        )
        self.assertEqual(create_res.status_code, status.HTTP_201_CREATED, create_res.data)
        deliv_id = create_res.data['id']
        deliv = WasteDelivery.objects.get(pk=deliv_id)
        self.assertEqual(deliv.dumpsite_operator_id, self.op_a.id)

        for spoof_op in (self.op_b.id, self.op_unassigned.id, None):
            patch_res = self.client.patch(
                f'/api/dumpsite/waste-deliveries/{deliv_id}/',
                {'dumpsite_operator': spoof_op, 'remarks': 'patch check'},
                format='json',
            )
            self.assertEqual(patch_res.status_code, status.HTTP_200_OK, patch_res.data)
            deliv.refresh_from_db()
            self.assertEqual(deliv.dumpsite_operator_id, self.op_a.id)

            put_res = self.client.put(
                f'/api/dumpsite/waste-deliveries/{deliv_id}/',
                {
                    'truck': self.truck_a.id,
                    'driver': self.driver_a.id,
                    'dumpsite': self.site_a.id,
                    'dumpsite_operator': spoof_op,
                    'schedule': self.sched_a.id,
                    'date': str(self.today),
                    'estimated_kg': '120.00',
                    'remarks': 'put check',
                },
                format='json',
            )
            self.assertEqual(put_res.status_code, status.HTTP_200_OK, put_res.data)
            deliv.refresh_from_db()
            self.assertEqual(deliv.dumpsite_operator_id, self.op_a.id)


