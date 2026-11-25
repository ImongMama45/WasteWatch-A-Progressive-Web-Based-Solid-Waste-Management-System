from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient
from rest_framework import status
from driver.models import Worker, LegacyCrewReconciliationAudit
from driver.worker_service import WorkerService

User = get_user_model()


class WorkerFoundationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin_user = User.objects.create_user(
            username='admin_test',
            email='admin@test.com',
            password='Password123!',
            role='admin',
            is_staff=True,
        )
        self.driver_user = User.objects.create_user(
            username='driver_juan',
            email='driver@test.com',
            password='Password123!',
            role='driver',
            full_name='Juan Dela Cruz',
        )

    def test_worker_creation_with_optional_user(self):
        worker = WorkerService.create_worker(
            employee_id='EMP-TEST-001',
            full_name='Juan Dela Cruz',
            user=self.driver_user,
        )
        self.assertEqual(worker.employee_id, 'EMP-TEST-001')
        self.assertEqual(worker.user, self.driver_user)
        self.assertTrue(worker.is_active)

        # Non-login worker
        non_login_worker = WorkerService.create_worker(
            employee_id='EMP-CREW-999',
            full_name='Non Login Crew Member',
            user=None,
        )
        self.assertIsNone(non_login_worker.user)
        self.assertEqual(non_login_worker.full_name, 'Non Login Crew Member')

    def test_worker_duplicate_employee_id_rejected(self):
        WorkerService.create_worker(
            employee_id='EMP-DUP-01',
            full_name='First Worker',
        )
        with self.assertRaises(ValidationError):
            WorkerService.create_worker(
                employee_id='EMP-DUP-01',
                full_name='Second Worker',
            )

    def test_worker_duplicate_user_linkage_rejected(self):
        WorkerService.create_worker(
            employee_id='EMP-U1',
            full_name='First User Worker',
            user=self.driver_user,
        )
        with self.assertRaises(ValidationError):
            WorkerService.create_worker(
                employee_id='EMP-U2',
                full_name='Second User Worker with Same User',
                user=self.driver_user,
            )

    def test_update_employee_id(self):
        worker = WorkerService.create_worker(
            employee_id='EMP-OLD-01',
            full_name='Update Test Worker',
        )
        updated = WorkerService.update_employee_id(
            worker_id=worker.id,
            new_employee_id='EMP-NEW-01',
            authorized_by=self.admin_user,
        )
        self.assertEqual(updated.employee_id, 'EMP-NEW-01')

    def test_merge_workers_and_repointing(self):
        # Create target permanent worker
        target = WorkerService.create_worker(
            employee_id='EMP-PERM-100',
            full_name='Target Permanent Worker',
            user=None,
        )
        # Create source provisional worker with user
        source = WorkerService.create_worker(
            employee_id='PROV-WORKER-0099',
            full_name='Source Provisional Worker',
            user=self.driver_user,
            allow_provisional=True,
        )
        audit = LegacyCrewReconciliationAudit.objects.create(
            provisional_worker=source,
            raw_name_string='Source Provisional Worker',
            reconciliation_status='PENDING_REVIEW',
        )

        merged = WorkerService.merge_workers(
            source_worker_id=source.id,
            target_worker_id=target.id,
            resolved_by=self.admin_user,
            notes='Merged duplicate legacy crew record',
        )

        self.assertEqual(merged.id, target.id)
        # Target inherits user
        target.refresh_from_db()
        self.assertEqual(target.user, self.driver_user)
        # Source is deactivated
        source.refresh_from_db()
        self.assertFalse(source.is_active)
        self.assertIsNone(source.user)
        # Audit re-pointed
        audit.refresh_from_db()
        self.assertEqual(audit.provisional_worker_id, target.id)

    def test_reconcile_provisional_worker_actions(self):
        # Test Promote
        prov_1 = WorkerService.create_worker(
            employee_id='PROV-WORKER-0001',
            full_name='Pedro Penduko',
            allow_provisional=True,
        )
        audit_1 = LegacyCrewReconciliationAudit.objects.create(
            provisional_worker=prov_1,
            raw_name_string='Pedro Penduko',
            reconciliation_status='PENDING_REVIEW',
        )
        resolved_promote = WorkerService.reconcile_provisional_worker(
            audit_id=audit_1.id,
            action='PROMOTE',
            new_employee_id='EMP-PERM-555',
            notes='Verified official municipal ID',
            resolved_by=self.admin_user,
        )
        self.assertEqual(resolved_promote.reconciliation_status, 'PROMOTED')
        prov_1.refresh_from_db()
        self.assertEqual(prov_1.employee_id, 'EMP-PERM-555')

        # Test Dismiss
        prov_2 = WorkerService.create_worker(
            employee_id='PROV-WORKER-0002',
            full_name='Invalid Entry',
            allow_provisional=True,
        )
        audit_2 = LegacyCrewReconciliationAudit.objects.create(
            provisional_worker=prov_2,
            raw_name_string='Invalid Entry',
            reconciliation_status='PENDING_REVIEW',
        )
        resolved_dismiss = WorkerService.reconcile_provisional_worker(
            audit_id=audit_2.id,
            action='DISMISS',
            notes='Test entry dismissed',
            resolved_by=self.admin_user,
        )
        self.assertEqual(resolved_dismiss.reconciliation_status, 'DISMISSED')
        prov_2.refresh_from_db()
        self.assertFalse(prov_2.is_active)

    def test_api_worker_endpoints(self):
        self.client.force_authenticate(user=self.admin_user)

        # List workers
        resp = self.client.get('/api/driver/workers/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        # Create worker via API
        resp = self.client.post('/api/driver/workers/', {
            'employee_id': 'EMP-API-001',
            'full_name': 'API Worker Test',
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        worker_id = resp.data['id']

        # Update employee id via API
        resp = self.client.post(f'/api/driver/workers/{worker_id}/update-employee-id/', {
            'new_employee_id': 'EMP-API-002',
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['employee_id'], 'EMP-API-002')

    def test_merge_workers_active_shift_409_distinct_user_eligibility_history_and_audit(self):
        from analytics.models import ActivityLog
        from driver.models import (
            CollectionSchedule,
            CrewShift,
            DriverShift,
            SanitationTeamMembership,
            ShiftCrewRosterItem,
            ShiftCrewRosterSnapshot,
            Truck,
        )
        from driver.team_service import ActiveShiftConflictError, TeamService

        from datetime import time
        team = TeamService.create_team(name='Merge Team', code='MRG-1')
        crew_u1 = User.objects.create_user(
            username='merge_c1', email='mc1@example.com', password='pw',
            role='citizen', employee_type='crew_member',
        )
        other_drv = User.objects.create_user(
            username='merge_d2', email='md2@example.com', password='pw', role='driver',
        )
        w_src = Worker.objects.create(employee_id='EMP-MRG-S', full_name='Merge Src', user=crew_u1)
        w_tgt_drv = Worker.objects.create(employee_id='EMP-MRG-D', full_name='Merge Drv', user=other_drv)
        w_tgt_unlinked = Worker.objects.create(employee_id='EMP-MRG-T', full_name='Merge Tgt')

        # 1. Distinct non-null users rejected
        with self.assertRaises(ValidationError):
            WorkerService.merge_workers(w_src.id, w_tgt_drv.id, resolved_by=self.admin_user)

        # 2. Active shift conflict -> 409 via service and API
        TeamService.assign_member(team.id, w_src.id, 'crew', created_by=self.admin_user)
        truck = Truck.objects.create(plate_number='TRK-MRG-1', status='active')
        sched = CollectionSchedule.objects.create(
            truck=truck, default_team=team, start_time=time(7, 0), end_time=time(15, 0)
        )
        cs = CrewShift.objects.create(team=team, schedule=sched, is_active=True)
        snap = ShiftCrewRosterSnapshot.objects.create(crew_shift=cs, staged_by=self.admin_user)
        ShiftCrewRosterItem.objects.create(snapshot=snap, worker=w_src, role_in_roster='crew', is_present=True)

        # Also verify WorkerViewSet.get_serializer_context reports on_active_shift=True for pre-departure CrewShift
        self.client.force_authenticate(user=self.admin_user)
        w_detail = self.client.get(f'/api/driver/workers/{w_src.id}/')
        self.assertEqual(w_detail.status_code, status.HTTP_200_OK)
        self.assertTrue(w_detail.data['on_active_shift'])

        # And when CrewShift is closed on its own but linked DriverShift is active -> still on_active_shift=True
        ds = DriverShift.objects.create(driver=other_drv, truck=truck, schedule=sched, is_active=True)
        cs.driver_shift = ds
        cs.is_active = False
        cs.save(update_fields=['driver_shift', 'is_active'])
        w_detail_ds = self.client.get(f'/api/driver/workers/{w_src.id}/')
        self.assertTrue(w_detail_ds.data['on_active_shift'])

        with self.assertRaises(ActiveShiftConflictError):
            WorkerService.merge_workers(w_src.id, w_tgt_unlinked.id, resolved_by=self.admin_user)

        res_merge_409 = self.client.post(
            f'/api/driver/workers/{w_src.id}/merge/',
            {'target_worker_id': w_tgt_unlinked.id},
            format='json',
        )
        self.assertEqual(res_merge_409.status_code, status.HTTP_409_CONFLICT)

        # Conclude shift and merge cleanly -> preserves old membership history (left_at) & creates new membership + ActivityLog
        ds.is_active = False
        ds.save(update_fields=['is_active'])
        merged = WorkerService.merge_workers(
            w_src.id, w_tgt_unlinked.id, resolved_by=self.admin_user, notes='Clean merge'
        )
        self.assertEqual(merged.id, w_tgt_unlinked.id)
        old_m = SanitationTeamMembership.objects.get(worker=w_src, team=team)
        self.assertFalse(old_m.is_active)
        self.assertIsNotNone(old_m.left_at)
        new_m = SanitationTeamMembership.objects.get(worker=w_tgt_unlinked, team=team, is_active=True)
        self.assertEqual(new_m.role_in_team, 'crew')
        self.assertTrue(ActivityLog.objects.filter(module='Workers', details__contains='WORKER_MERGED').exists())

    def test_merge_workers_and_worker_update_use_select_for_update_of_self(self):
        import inspect
        from driver.views import WorkerViewSet

        merge_src = inspect.getsource(WorkerService.merge_workers)
        self.assertIn("select_for_update(of=('self',))", merge_src)

        update_src = inspect.getsource(WorkerViewSet.update)
        self.assertIn("select_for_update(of=('self',))", update_src)

        # Genuine queryset check: verify Django compiles select_for_update(of=('self',)) on Worker.select_related('user')
        w_chk = WorkerService.create_worker(
            employee_id='EMP-OF-SELF-1', full_name='Of Self Worker', user=self.driver_user
        )
        qs = Worker.objects.select_related('user').filter(pk=w_chk.id).select_for_update(of=('self',))
        self.assertEqual(qs.query.select_for_update_of, ('self',))

    def test_worker_reactivation_with_inactive_user_rejected_and_merge_revalidates_target_membership(self):
        from driver.team_service import TeamService

        # 1. Reactivating an inactive Worker linked to an inactive User must fail with 400
        inact_user = User.objects.create_user(
            username='react_inact_u', email='riu@example.com', password='pw',
            role='citizen', employee_type='crew_member', is_active=False,
        )
        w_inact = Worker.objects.create(
            employee_id='EMP-REACT-1', full_name='Inactive React Worker', user=inact_user, is_active=False
        )
        self.client.force_authenticate(user=self.admin_user)
        res_react = self.client.patch(
            f'/api/driver/workers/{w_inact.id}/',
            {'is_active': True},
            format='json',
        )
        self.assertEqual(res_react.status_code, status.HTTP_400_BAD_REQUEST)
        w_inact.refresh_from_db()
        self.assertFalse(w_inact.is_active)

        # 2. merge_workers transferring a 'driver' user onto a target with active 'crew' membership must fail & rollback
        team = TeamService.create_team(name='Merge Elig Team', code='MET-1')
        w_crew_tgt = WorkerService.create_worker(employee_id='EMP-MET-TGT', full_name='Target Crew')
        TeamService.assign_member(team.id, w_crew_tgt.id, 'crew', created_by=self.admin_user)

        drv_user_2 = User.objects.create_user(
            username='merge_drv_2', email='mdrv2@example.com', password='pw', role='driver',
        )
        w_drv_src = WorkerService.create_worker(
            employee_id='EMP-MET-SRC', full_name='Source Driver No Membership', user=drv_user_2
        )

        with self.assertRaises(ValidationError):
            WorkerService.merge_workers(w_drv_src.id, w_crew_tgt.id, resolved_by=self.admin_user)

        w_drv_src.refresh_from_db()
        w_crew_tgt.refresh_from_db()
        self.assertTrue(w_drv_src.is_active)
        self.assertEqual(w_drv_src.user_id, drv_user_2.id)
        self.assertIsNone(w_crew_tgt.user_id)


