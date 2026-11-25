from datetime import date, time, timedelta
import unittest

from django.apps import apps
from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, OperationalError, connection, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase, RequestFactory
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import UserRole, EmployeeType, Barangay
from analytics.models import ActivityLog
from driver.admin import TruckAdmin
from driver.models import (
    Truck,
    TruckStatus,
    CommissioningProvenance,
    TruckRetirementState,
    CollectionSchedule,
    DriverShift,
    TruckLocation,
    TruckCrewAssignment,
    ScheduleTruckAllocation,
    TeamScheduleTruckAssignment,
    SanitationTeam,
    Worker,
    is_truck_dispatchable,
)
from driver.truck_service import (
    TruckService,
    TruckHistoricalAuditService,
    TruckAssignmentService,
    TruckLifecycleConflictError,
)
from dumpsite.models import Dumpsite, WasteDelivery, TruckFillEstimate
from watcher.models import Escalation, HotspotIntervention, GarbageHotspot

User = get_user_model()


class TruckLifecycleStage1Tests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.factory = RequestFactory()

        self.admin = User.objects.create_user(
            username='stage1_admin',
            email='stage1_admin@test.com',
            password='pw',
            role=UserRole.ADMIN,
            is_staff=True,
            full_name='Stage 1 Admin',
        )
        self.driver = User.objects.create_user(
            username='stage1_driver',
            email='stage1_driver@test.com',
            password='pw',
            role=UserRole.DRIVER,
            full_name='Stage 1 Driver',
        )
        self.crew_user = User.objects.create_user(
            username='stage1_crew',
            email='stage1_crew@test.com',
            password='pw',
            role=UserRole.CITIZEN,
            employee_type=EmployeeType.CREW_MEMBER,
            full_name='Stage 1 Crew',
        )
        self.citizen = User.objects.create_user(
            username='stage1_citizen',
            email='stage1_citizen@test.com',
            password='pw',
            role=UserRole.CITIZEN,
            full_name='Stage 1 Citizen',
        )

        self.barangay = Barangay.objects.create(name='Barangay Stage1')
        self.dumpsite = Dumpsite.objects.create(
            name='Stage1 Landfill',
            latitude=13.93,
            longitude=121.61,
            barangay=self.barangay,
        )
        self.team = SanitationTeam.objects.create(name='Team Stage1', code='STG1')

    # -------------------------------------------------------------------------
    # 1. Migration & Legacy Commissioning Backfill Verification
    # -------------------------------------------------------------------------
    def test_legacy_backfill_classifications_and_zero_date_fabrication(self):
        import importlib
        mig_mod = importlib.import_module('driver.migrations.0043_truck_lifecycle_and_deletion_boundary')

        truck_with_history = Truck.objects.create(plate_number='LEG-HIST-01', model='Hino')
        DriverShift.objects.create(
            driver=self.driver,
            truck=truck_with_history,
            is_active=False,
            ended_at=timezone.now(),
        )

        truck_no_history = Truck.objects.create(plate_number='LEG-NOHIST-01', model='Isuzu')
        # Even if it has a Category B schedule reference, it has 0 Category A history
        CollectionSchedule.objects.create(
            truck=truck_no_history,
            driver=self.driver,
            start_time=time(8, 0),
            end_time=time(16, 0),
            area='Area Legacy',
        )

        mig_mod.backfill_legacy_truck_commissioning_state(apps, connection.schema_editor())

        truck_with_history.refresh_from_db()
        self.assertEqual(
            truck_with_history.commissioning_provenance,
            CommissioningProvenance.COMMISSIONED_DATE_UNKNOWN,
        )
        self.assertEqual(truck_with_history.retirement_state, TruckRetirementState.OPERATIONAL)
        self.assertIsNone(truck_with_history.commissioned_at)
        self.assertFalse(truck_with_history.is_retired)

        truck_no_history.refresh_from_db()
        self.assertEqual(
            truck_no_history.commissioning_provenance,
            CommissioningProvenance.LEGACY_UNRECONCILED,
        )
        self.assertEqual(truck_no_history.retirement_state, TruckRetirementState.LEGACY_RECONCILIATION)
        self.assertIsNone(truck_no_history.commissioned_at)
        self.assertFalse(truck_no_history.is_retired)

    # -------------------------------------------------------------------------
    # 2. All 10 Database CheckConstraints (C0a, C0b, C1-C7)
    # -------------------------------------------------------------------------
    def test_all_8_valid_states_accepted_and_invalid_states_rejected_by_db_constraints(self):
        now = timezone.now()
        valid_states = [
            ('uncommissioned', 'uncommissioned', None, False),
            ('commissioned_verified', 'operational', now, False),
            ('commissioned_verified', 'retirement_in_progress', now, True),
            ('commissioned_verified', 'permanently_retired', now, True),
            ('commissioned_date_unknown', 'operational', None, False),
            ('commissioned_date_unknown', 'retirement_in_progress', None, True),
            ('commissioned_date_unknown', 'permanently_retired', None, True),
            ('legacy_unreconciled', 'legacy_reconciliation', None, False),
        ]
        for idx, (prov, state, comm_at, retired) in enumerate(valid_states):
            t = Truck.objects.create(
                plate_number=f'VALID-{idx}',
                model='Valid Model',
                commissioning_provenance=prov,
                retirement_state=state,
                commissioned_at=comm_at,
                is_retired=retired,
            )
            self.assertEqual(t.commissioning_provenance, prov)
            self.assertEqual(t.retirement_state, state)

        # Invalid combinations that must be rejected by C0a, C0b, C1-C7
        invalid_states = [
            # C0a: invalid provenance string
            ('bogus_provenance', 'uncommissioned', None, False),
            # C0b: invalid retirement_state string
            ('uncommissioned', 'bogus_state', None, False),
            # C1/C2: uncommissioned with non-null commissioned_at or operational state
            ('uncommissioned', 'uncommissioned', now, False),
            ('uncommissioned', 'operational', None, False),
            ('uncommissioned', 'uncommissioned', None, True),
            # C3: commissioned_verified with NULL timestamp or uncommissioned state
            ('commissioned_verified', 'operational', None, False),
            ('commissioned_verified', 'uncommissioned', now, False),
            # C4: commissioned_date_unknown with non-null timestamp
            ('commissioned_date_unknown', 'operational', now, False),
            # C5a/C5b: legacy_unreconciled mismatch
            ('legacy_unreconciled', 'operational', None, False),
            ('legacy_unreconciled', 'legacy_reconciliation', now, False),
            ('legacy_unreconciled', 'legacy_reconciliation', None, True),
            # C6: operational with is_retired=True
            ('commissioned_verified', 'operational', now, True),
            # C7: retirement_in_progress or permanently_retired with is_retired=False
            ('commissioned_verified', 'retirement_in_progress', now, False),
            ('commissioned_verified', 'permanently_retired', now, False),
        ]

        base_truck = Truck.objects.create(plate_number='INV-TEST', model='Test')
        for prov, state, comm_at, retired in invalid_states:
            with self.subTest(prov=prov, state=state, comm_at=comm_at, retired=retired):
                with self.assertRaises(IntegrityError):
                    with transaction.atomic():
                        Truck.objects.filter(pk=base_truck.pk).update(
                            commissioning_provenance=prov,
                            retirement_state=state,
                            commissioned_at=comm_at,
                            is_retired=retired,
                        )

    # -------------------------------------------------------------------------
    # 3. Protected Lifecycle Fields on Ordinary CRUD (POST/PUT/PATCH)
    # -------------------------------------------------------------------------
    def test_protected_lifecycle_fields_cannot_be_written_via_ordinary_crud(self):
        self.client.force_authenticate(user=self.admin)

        res = self.client.post(
            '/api/driver/trucks/',
            {
                'plate_number': 'CRUD-PROT-01',
                'model': 'Compactor',
                'commissioning_provenance': 'commissioned_verified',
                'retirement_state': 'operational',
                'commissioned_at': '2026-01-01T00:00:00Z',
                'is_retired': True,
                'is_operational_hold': True,
                'hold_reason': 'Injected hold',
                'mechanical_status': 'disabled',
                'maintenance_status': 'under_repair',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        truck = Truck.objects.get(plate_number='CRUD-PROT-01')
        self.assertEqual(truck.commissioning_provenance, CommissioningProvenance.UNCOMMISSIONED)
        self.assertEqual(truck.retirement_state, TruckRetirementState.UNCOMMISSIONED)
        self.assertIsNone(truck.commissioned_at)
        self.assertFalse(truck.is_retired)
        self.assertFalse(truck.is_operational_hold)
        self.assertEqual(truck.hold_reason, '')
        self.assertEqual(truck.mechanical_status, 'serviceable')
        self.assertEqual(truck.maintenance_status, 'available')

        # PATCH attempt to spoof commissioning or retirement fields
        patch_res = self.client.patch(
            f'/api/driver/trucks/{truck.id}/',
            {
                'model': 'Updated Compactor',
                'commissioning_provenance': 'commissioned_date_unknown',
                'retirement_state': 'operational',
                'is_retired': True,
                'is_operational_hold': True,
            },
            format='json',
        )
        self.assertEqual(patch_res.status_code, status.HTTP_200_OK)
        truck.refresh_from_db()
        self.assertEqual(truck.model, 'Updated Compactor')
        self.assertEqual(truck.commissioning_provenance, CommissioningProvenance.UNCOMMISSIONED)
        self.assertEqual(truck.retirement_state, TruckRetirementState.UNCOMMISSIONED)
        self.assertFalse(truck.is_retired)
        self.assertFalse(truck.is_operational_hold)

    # -------------------------------------------------------------------------
    # 4. Controlled Initial Commissioning Path
    # -------------------------------------------------------------------------
    def test_controlled_initial_commissioning_endpoint_and_service(self):
        truck = Truck.objects.create(plate_number='COMM-NEW-01', model='Hino 300')
        self.assertFalse(is_truck_dispatchable(truck))

        # Citizen / Driver forbidden
        self.client.force_authenticate(user=self.driver)
        res_forbidden = self.client.post(f'/api/driver/trucks/{truck.id}/commission/', {}, format='json')
        self.assertEqual(res_forbidden.status_code, status.HTTP_403_FORBIDDEN)

        # Admin commissions truck
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(
            f'/api/driver/trucks/{truck.id}/commission/',
            {'notes': 'Accepted into CGSO municipal fleet.'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['commissioning_provenance'], CommissioningProvenance.COMMISSIONED_VERIFIED)
        self.assertEqual(res.data['retirement_state'], TruckRetirementState.OPERATIONAL)
        self.assertIsNotNone(res.data['commissioned_at'])
        self.assertTrue(res.data['is_dispatchable'])

        truck.refresh_from_db()
        self.assertTrue(is_truck_dispatchable(truck))
        self.assertTrue(
            ActivityLog.objects.filter(
                module='Trucks',
                details__contains='TRUCK_COMMISSIONED',
            ).exists()
        )

        # Second commission attempt on already-commissioned truck fails with 409 Conflict
        res_dup = self.client.post(f'/api/driver/trucks/{truck.id}/commission/', {}, format='json')
        self.assertEqual(res_dup.status_code, status.HTTP_409_CONFLICT)

    # -------------------------------------------------------------------------
    # 5. Legacy Reconciliation Workflow
    # -------------------------------------------------------------------------
    def test_legacy_reconciliation_confirm_and_declare_uncommissioned_guards(self):
        self.client.force_authenticate(user=self.admin)

        # Case 1: confirm_commissioned_date_unknown
        leg_1 = Truck.objects.create(
            plate_number='REC-UNK-01',
            model='Legacy 1',
            commissioning_provenance=CommissioningProvenance.LEGACY_UNRECONCILED,
            retirement_state=TruckRetirementState.LEGACY_RECONCILIATION,
        )
        res1 = self.client.post(
            f'/api/driver/trucks/{leg_1.id}/reconcile-commissioning/',
            {
                'action': 'confirm_commissioned_date_unknown',
                'verification_notes': 'Paper dispatch logbook from 2022 confirms route service.',
            },
            format='json',
        )
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        leg_1.refresh_from_db()
        self.assertEqual(leg_1.commissioning_provenance, CommissioningProvenance.COMMISSIONED_DATE_UNKNOWN)
        self.assertEqual(leg_1.retirement_state, TruckRetirementState.OPERATIONAL)
        self.assertIsNone(leg_1.commissioned_at)
        self.assertTrue(is_truck_dispatchable(leg_1))

        # Case 2: declare_uncommissioned blocked if Category B reference exists (zero silent detachment)
        leg_2 = Truck.objects.create(
            plate_number='REC-PHANTOM-01',
            model='Legacy Phantom',
            commissioning_provenance=CommissioningProvenance.LEGACY_UNRECONCILED,
            retirement_state=TruckRetirementState.LEGACY_RECONCILIATION,
        )
        sched = CollectionSchedule.objects.create(
            truck=leg_2,
            driver=self.driver,
            start_time=time(7, 0),
            end_time=time(15, 0),
            area='Zone Phantom',
        )
        res_blocked_b = self.client.post(
            f'/api/driver/trucks/{leg_2.id}/reconcile-commissioning/',
            {
                'action': 'declare_uncommissioned',
                'verification_notes': 'Never delivered.',
            },
            format='json',
        )
        self.assertEqual(res_blocked_b.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res_blocked_b.data['code'], 'operational_references_exist')
        sched.refresh_from_db()
        self.assertEqual(sched.truck_id, leg_2.id)

        # Detach schedule explicitly, then declare_uncommissioned succeeds
        sched.truck = None
        sched.save(update_fields=['truck'])
        res_ok = self.client.post(
            f'/api/driver/trucks/{leg_2.id}/reconcile-commissioning/',
            {
                'action': 'declare_uncommissioned',
                'verification_notes': 'Never delivered; schedule detached.',
            },
            format='json',
        )
        self.assertEqual(res_ok.status_code, status.HTTP_200_OK)
        self.assertTrue(res_ok.data['eligible_for_physical_deletion'])

    # -------------------------------------------------------------------------
    # 6. Physical Deletion Protections Across All Surfaces & Dependencies
    # -------------------------------------------------------------------------
    def test_physical_deletion_blocked_for_commissioned_legacy_or_dependent_trucks(self):
        self.client.force_authenticate(user=self.admin)

        # A. Commissioned truck cannot be deleted
        comm_truck = Truck.objects.create(plate_number='DEL-COMM-01', model='M')
        TruckService.commission_truck(comm_truck, user=self.admin)

        del_res = self.client.delete(f'/api/driver/trucks/{comm_truck.id}/')
        self.assertEqual(del_res.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(Truck.objects.filter(pk=comm_truck.id).exists())

        with self.assertRaises(ProtectedError):
            with transaction.atomic():
                comm_truck.delete()

        # B. Legacy unreconciled truck cannot be deleted
        leg_truck = Truck.objects.create(
            plate_number='DEL-LEG-01',
            model='M',
            commissioning_provenance=CommissioningProvenance.LEGACY_UNRECONCILED,
            retirement_state=TruckRetirementState.LEGACY_RECONCILIATION,
        )
        del_leg = self.client.delete(f'/api/driver/trucks/{leg_truck.id}/')
        self.assertEqual(del_leg.status_code, status.HTTP_409_CONFLICT)

        # C. Uncommissioned truck with Category A dependency (ScheduleTruckAllocation / TeamScheduleTruckAssignment)
        self.assertIs(TeamScheduleTruckAssignment, ScheduleTruckAllocation)
        uncomm_with_alloc = Truck.objects.create(plate_number='DEL-ALLOC-01', model='M')
        sched = CollectionSchedule.objects.create(
            start_time=time(6, 0),
            end_time=time(14, 0),
            area='Area Alloc',
        )
        ScheduleTruckAllocation.objects.create(
            schedule=sched,
            truck=uncomm_with_alloc,
            team=self.team,
            allocation_date=date(2026, 11, 20),
            allocated_by=self.admin,
        )
        del_alloc = self.client.delete(f'/api/driver/trucks/{uncomm_with_alloc.id}/')
        self.assertEqual(del_alloc.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(Truck.objects.filter(pk=uncomm_with_alloc.id).exists())

        # D. Uncommissioned truck with Category B dependency (CollectionSchedule) blocks delete & preserves schedule.driver
        uncomm_with_sched = Truck.objects.create(plate_number='DEL-SCHED-01', model='M')
        sched_b = CollectionSchedule.objects.create(
            truck=uncomm_with_sched,
            driver=self.driver,
            start_time=time(8, 0),
            end_time=time(12, 0),
            area='Area B',
        )
        with self.assertRaises(ProtectedError):
            with transaction.atomic():
                uncomm_with_sched.delete()
        sched_b.refresh_from_db()
        self.assertEqual(sched_b.driver_id, self.driver.id)

        # E. Bulk QuerySet.delete() blocked
        with self.assertRaises(ProtectedError):
            with transaction.atomic():
                Truck.objects.filter(pk=uncomm_with_sched.id).delete()

        # F. TruckAdmin permissions and bulk delete_selected disabled
        truck_admin = TruckAdmin(Truck, AdminSite())
        req = self.factory.get('/admin/driver/truck/')
        req.user = self.admin
        self.assertNotIn('delete_selected', truck_admin.get_actions(req))
        self.assertFalse(truck_admin.has_delete_permission(req, obj=comm_truck))
        self.assertFalse(truck_admin.has_delete_permission(req, obj=uncomm_with_sched))

        # G. Eligible uncommissioned truck with 0 dependencies succeeds
        pristine_truck = Truck.objects.create(plate_number='DEL-OK-01', model='Pristine')
        self.assertTrue(truck_admin.has_delete_permission(req, obj=pristine_truck))
        del_ok = self.client.delete(f'/api/driver/trucks/{pristine_truck.id}/')
        self.assertEqual(del_ok.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Truck.objects.filter(pk=pristine_truck.id).exists())

    def test_stage_aware_historical_audit_fails_closed_when_migrated_table_missing(self):
        from unittest.mock import patch
        pristine_truck = Truck.objects.create(plate_number='STG5-FAILCLOSED', model='M')
        with patch.object(
            TruckHistoricalAuditService, 'is_migration_applied', return_value=True
        ), patch.object(
            connection.introspection, 'table_names', return_value=[]
        ):
            with self.assertRaises(OperationalError):
                TruckHistoricalAuditService.get_category_a_counts(pristine_truck)

    # -------------------------------------------------------------------------
    # 7. Permanent Retirement Workflow & end_reason='truck_retired' Semantics
    # -------------------------------------------------------------------------
    def test_retire_truck_drains_active_shift_detaches_references_and_preserves_history(self):
        self.client.force_authenticate(user=self.admin)

        truck = Truck.objects.create(plate_number='RET-01', model='Isuzu')
        TruckService.commission_truck(truck, user=self.admin)
        truck.drivers.add(self.driver)
        truck.crew.add(self.crew_user)

        sched = CollectionSchedule.objects.create(
            truck=truck,
            driver=self.driver,
            default_team=self.team,
            start_time=time(6, 0),
            end_time=time(14, 0),
            area='Retirement Zone',
        )
        hotspot = GarbageHotspot.objects.create(
            name='Retirement Hotspot',
            barangay=self.barangay,
            latitude=13.93,
            longitude=121.61,
            assigned_truck=truck,
        )
        active_shift = DriverShift.objects.create(
            driver=self.driver,
            truck=truck,
            schedule=sched,
            is_active=True,
            status='shiftroute',
            op_status='on_route',
        )
        loc = TruckLocation.objects.create(
            driver=self.driver,
            truck=truck,
            shift=active_shift,
            latitude=13.931,
            longitude=121.611,
        )

        # Call retire endpoint
        res = self.client.post(
            f'/api/driver/trucks/{truck.id}/retire/',
            {'reason': 'End of municipal service life'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['retirement_state'], TruckRetirementState.PERMANENTLY_RETIRED)
        self.assertTrue(res.data['is_retired'])
        self.assertFalse(res.data['is_dispatchable'])

        # Verify truck state
        truck.refresh_from_db()
        self.assertEqual(truck.retirement_state, TruckRetirementState.PERMANENTLY_RETIRED)
        self.assertTrue(truck.is_retired)
        self.assertEqual(truck.status, TruckStatus.INACTIVE)
        self.assertEqual(truck.drivers.count(), 0)
        self.assertEqual(truck.crew.count(), 0)

        # Verify Category B operational references detached
        sched.refresh_from_db()
        self.assertIsNone(sched.truck_id)
        hotspot.refresh_from_db()
        self.assertIsNone(hotspot.assigned_truck_id)

        # Verify active shift closed with end_reason='truck_retired' and historical FK preserved
        active_shift.refresh_from_db()
        self.assertFalse(active_shift.is_active)
        self.assertEqual(active_shift.end_reason, 'truck_retired')
        self.assertEqual(active_shift.truck_id, truck.id)

        # Verify GPS breadcrumb history preserved (not cascaded)
        loc.refresh_from_db()
        self.assertEqual(loc.truck_id, truck.id)

        # Verify live-map active_shifts classifies truck_retired as 'done' (not 'abandoned')
        map_res = self.client.get('/api/driver/shift/active_shifts/')
        self.assertEqual(map_res.status_code, status.HTTP_200_OK)
        retired_shift_entry = next((s for s in map_res.data if s['id'] == active_shift.id), None)
        self.assertIsNotNone(retired_shift_entry)
        self.assertEqual(retired_shift_entry['end_reason'], 'truck_retired')
        self.assertEqual(retired_shift_entry['status'], 'done')

        # Verify retired truck cannot be physically deleted
        del_res = self.client.delete(f'/api/driver/trucks/{truck.id}/')
        self.assertEqual(del_res.status_code, status.HTTP_409_CONFLICT)

    # -------------------------------------------------------------------------
    # 8. PostgreSQL-Only Staging Verification Suite (Skipped on SQLite)
    # -------------------------------------------------------------------------
    @unittest.skipUnless(connection.vendor == 'postgresql', 'Requires PostgreSQL staging database')
    def test_postgres_security_definer_function_and_privilege_boundary(self):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT prosecdef, proconfig
                FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'truck_delete_uncommissioned';
                """
            )
            row = cursor.fetchone()
            self.assertIsNotNone(row)
            prosecdef, proconfig = row
            self.assertTrue(prosecdef)
            self.assertIn('search_path=pg_catalog, public', proconfig or [])
