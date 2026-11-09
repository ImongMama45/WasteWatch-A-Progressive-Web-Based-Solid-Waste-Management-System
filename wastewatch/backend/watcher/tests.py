from django.test import TestCase, TransactionTestCase
from django.db import IntegrityError
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from datetime import timedelta
from django.utils import timezone
from accounts.models import Barangay, UserRole
from watcher.models import (
    GarbageReport,
    CollectionConfirmation,
    GarbageHotspot,
    ReportStatus,
    IssueType,
    Severity,
    ReportVote,
    StopValidationStatus,
    ReportStatusHistory,
    HotspotIntervention,
    InterventionType,
    InterventionStatus,
)
from watcher.services import (
    create_or_get_community_post_for_report,
    record_report_status_transition,
)
from community.models import CommunityPost, PostComment, PostType, PostCategory

User = get_user_model()


class StopValidationStatusTests(TestCase):
    def test_stop_validation_status_values(self):
        """
        Ensure all statuses used in views.py are valid enum values.
        """
        assert hasattr(StopValidationStatus, 'PENDING_INSPECTION')
        assert hasattr(StopValidationStatus, 'READY_FOR_COLLECTION')
        assert hasattr(StopValidationStatus, 'EMPTY_STOP')
        assert hasattr(StopValidationStatus, 'COLLECTION_REPORTED')
        assert hasattr(StopValidationStatus, 'VERIFIED_COLLECTED')
        assert hasattr(StopValidationStatus, 'COLLECTION_DISPUTED')


class CivicVotingAndReportModelTests(TestCase):
    def setUp(self):
        self.barangay = Barangay.objects.create(name='Barangay 1')
        self.citizen = User.objects.create_user(
            username='citizen_juan',
            email='juan@example.com',
            password='password123',
            role=UserRole.CITIZEN,
            barangay=self.barangay,
        )
        self.watcher = User.objects.create_user(
            username='watcher_pedro',
            email='pedro@example.com',
            password='password123',
            role=UserRole.WATCHER,
            barangay=self.barangay,
        )
        self.official = User.objects.create_user(
            username='official_clara',
            email='clara@example.com',
            password='password123',
            role=UserRole.BRGY_OFFICIAL,
            barangay=self.barangay,
        )
        self.driver = User.objects.create_user(
            username='driver_kiko',
            email='kiko@example.com',
            password='password123',
            role=UserRole.DRIVER,
            barangay=self.barangay,
        )
        self.admin = User.objects.create_user(
            username='admin_santos',
            email='admin@example.com',
            password='password123',
            role=UserRole.ADMIN,
        )
        self.report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH,
            status=ReportStatus.APPROVED,
            address='123 Quezon Ave, Lucena',
            description='Trash bin overflowing onto the sidewalk',
        )
        self.client = APIClient()

    def test_report_vote_model_constraints_and_uniqueness(self):
        # Successful vote creation
        vote = ReportVote.objects.create(report=self.report, user=self.citizen, vote_type=1)
        self.assertEqual(vote.vote_type, 1)

        # Duplicate vote by same user on same report raises IntegrityError
        with self.assertRaises(IntegrityError):
            ReportVote.objects.create(report=self.report, user=self.citizen, vote_type=-1)

    def test_report_vote_check_constraint_invalid_values(self):
        # Invalid vote_type (0 or 2) violates check constraint
        with self.assertRaises(IntegrityError):
            ReportVote.objects.create(report=self.report, user=self.watcher, vote_type=0)

    def test_vote_api_upvote_downvote_switch_and_delete(self):
        self.client.force_authenticate(user=self.citizen)

        # 1. Cast Upvote (+1)
        res_up = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_up.status_code, status.HTTP_200_OK)
        self.assertEqual(res_up.data['upvotes'], 1)
        self.assertEqual(res_up.data['downvotes'], 0)
        self.assertEqual(res_up.data['net_votes'], 1)
        self.assertEqual(res_up.data['user_vote'], 1)

        # 2. Idempotent repeated upvote
        res_up_repeat = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_up_repeat.status_code, status.HTTP_200_OK)
        self.assertEqual(res_up_repeat.data['upvotes'], 1)
        self.assertEqual(res_up_repeat.data['net_votes'], 1)

        # 3. Switch to Downvote (-1)
        res_down = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': -1})
        self.assertEqual(res_down.status_code, status.HTTP_200_OK)
        self.assertEqual(res_down.data['upvotes'], 0)
        self.assertEqual(res_down.data['downvotes'], 1)
        self.assertEqual(res_down.data['net_votes'], -1)
        self.assertEqual(res_down.data['user_vote'], -1)

        # 4. Remove vote via DELETE
        res_del = self.client.delete(f'/api/watcher/reports/{self.report.id}/vote/')
        self.assertEqual(res_del.status_code, status.HTTP_200_OK)
        self.assertEqual(res_del.data['upvotes'], 0)
        self.assertEqual(res_del.data['downvotes'], 0)
        self.assertEqual(res_del.data['net_votes'], 0)
        self.assertIsNone(res_del.data['user_vote'])

        # 5. Idempotent repeated DELETE
        res_del_repeat = self.client.delete(f'/api/watcher/reports/{self.report.id}/vote/')
        self.assertEqual(res_del_repeat.status_code, status.HTTP_200_OK)
        self.assertEqual(res_del_repeat.data['upvotes'], 0)

    def test_invalid_vote_type_payloads(self):
        self.client.force_authenticate(user=self.citizen)

        # Zero is invalid
        res1 = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 0})
        self.assertEqual(res1.status_code, status.HTTP_400_BAD_REQUEST)

        # Number other than 1 or -1
        res2 = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 2})
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)

        # Non-numeric string
        res3 = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 'up'})
        self.assertEqual(res3.status_code, status.HTTP_400_BAD_REQUEST)

        # Missing payload
        res4 = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {})
        self.assertEqual(res4.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unauthorized_and_ineligible_roles_cannot_vote(self):
        # Unauthenticated user receives 401 or 403
        res_unauth = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertIn(res_unauth.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

        # Driver role is ineligible (receives 403)
        self.client.force_authenticate(user=self.driver)
        res_driver = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_driver.status_code, status.HTTP_403_FORBIDDEN)

        # Admin role is ineligible to cast votes (receives 403)
        self.client.force_authenticate(user=self.admin)
        res_admin = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_admin.status_code, status.HTTP_403_FORBIDDEN)

        # Watcher role is eligible (receives 200)
        self.client.force_authenticate(user=self.watcher)
        res_watcher = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_watcher.status_code, status.HTTP_200_OK)

        # Official role is eligible (receives 200)
        self.client.force_authenticate(user=self.official)
        res_official = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_official.status_code, status.HTTP_200_OK)

    def test_voting_status_guard_and_permissions(self):
        # 1. Owner cannot vote on their own pending report (400 Bad Request)
        pending_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.PENDING,
            issue_type=IssueType.OVERFLOW,
        )
        self.client.force_authenticate(user=self.citizen)
        res_owner_pending = self.client.post(f'/api/watcher/reports/{pending_report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_owner_pending.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_owner_pending.data['error'], 'Only approved or resolved reports are eligible for community voting.')

        # 2. Another eligible user (watcher Pedro) cannot vote on pending report
        self.client.force_authenticate(user=self.watcher)
        res_watcher_pending = self.client.post(f'/api/watcher/reports/{pending_report.id}/vote/', {'vote_type': 1})
        self.assertIn(res_watcher_pending.status_code, [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND])

        # 3. Approved reports accept votes (200 OK)
        approved_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.APPROVED,
            issue_type=IssueType.OVERFLOW,
        )
        self.client.force_authenticate(user=self.citizen)
        res_app = self.client.post(f'/api/watcher/reports/{approved_report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_app.status_code, status.HTTP_200_OK)
        self.assertEqual(res_app.data['upvotes'], 1)

        # 4. Resolved reports accept votes (200 OK)
        resolved_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.RESOLVED,
            issue_type=IssueType.OVERFLOW,
        )
        res_res = self.client.post(f'/api/watcher/reports/{resolved_report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_res.status_code, status.HTTP_200_OK)
        self.assertEqual(res_res.data['upvotes'], 1)

        # 5. Rejected reports reject votes (400 Bad Request)
        rejected_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.REJECTED,
            issue_type=IssueType.OVERFLOW,
        )
        res_rej = self.client.post(f'/api/watcher/reports/{rejected_report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_rej.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_rej.data['error'], 'Only approved or resolved reports are eligible for community voting.')

        # 6. Archived reports reject votes (400 Bad Request or 404 Not Found)
        archived_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.APPROVED,
            is_archived=True,
            issue_type=IssueType.OVERFLOW,
        )
        res_arc = self.client.post(f'/api/watcher/reports/{archived_report.id}/vote/', {'vote_type': 1})
        self.assertIn(res_arc.status_code, [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND])

    def test_voting_does_not_mutate_report_status_or_history(self):
        """
        Finding 3: Strengthened Status and Business Rule Integrity Verification:
        Community voting is feedback-only and must NEVER modify:
          - GarbageReport.status
          - approved_at, resolved_at, updated_at
          - ReportStatusHistory records
          - CollectionConfirmation records
          - GarbageHotspot records or dispatch state
          - HotspotIntervention records
        Tests both APPROVED and RESOLVED reports.
        Verifies POST/DELETE payloads leak NO voter identities.
        Verifies DELETE removes ONLY the authenticated user's vote and keeps other users' votes intact.
        """
        # Set up a hotspot associated with self.report (APPROVED)
        hotspot = GarbageHotspot.objects.create(
            name='Test Hotspot',
            barangay=self.barangay,
            latitude=13.935,
            longitude=121.615,
            severity=Severity.HIGH,
            source_report=self.report,
            is_active=True,
        )

        # Set up resolved report
        resolved_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.RESOLVED,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.MEDIUM,
            resolved_at=timezone.now() - timedelta(hours=2),
            approved_at=timezone.now() - timedelta(hours=5),
            description='Resolved report for testing voting lifecycle',
        )

        initial_rep_updated_at = self.report.updated_at
        initial_res_updated_at = resolved_report.updated_at
        initial_history_count = ReportStatusHistory.objects.count()
        initial_conf_count = CollectionConfirmation.objects.count()
        initial_hotspot_count = GarbageHotspot.objects.count()
        initial_intervention_count = HotspotIntervention.objects.count()

        # Step 1: Watcher votes (+1) on self.report
        self.client.force_authenticate(user=self.watcher)
        res_w = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_w.status_code, status.HTTP_200_OK)
        self.assertEqual(res_w.data['upvotes'], 1)
        self.assertEqual(res_w.data['downvotes'], 0)
        self.assertEqual(res_w.data['net_votes'], 1)

        # Step 2: Citizen votes (-1) on self.report
        self.client.force_authenticate(user=self.citizen)
        res_c = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': -1})
        self.assertEqual(res_c.status_code, status.HTTP_200_OK)
        self.assertEqual(res_c.data['upvotes'], 1)
        self.assertEqual(res_c.data['downvotes'], 1)
        self.assertEqual(res_c.data['net_votes'], 0)
        self.assertEqual(res_c.data['user_vote'], -1)
        # Verify no voter identity in response
        self.assertNotIn('user_name', res_c.data)
        self.assertNotIn('email', res_c.data)
        self.assertNotIn('user_id', res_c.data)
        self.assertEqual(set(res_c.data.keys()), {'report_id', 'upvotes', 'downvotes', 'net_votes', 'user_vote'})

        # Step 3: Citizen deletes vote on self.report
        res_c_del = self.client.delete(f'/api/watcher/reports/{self.report.id}/vote/')
        self.assertEqual(res_c_del.status_code, status.HTTP_200_OK)
        self.assertIsNone(res_c_del.data['user_vote'])
        self.assertEqual(res_c_del.data['upvotes'], 1, "Watcher's upvote must remain after citizen deletes vote")
        self.assertEqual(res_c_del.data['downvotes'], 0)
        self.assertEqual(res_c_del.data['net_votes'], 1)
        self.assertNotIn('user_name', res_c_del.data)
        self.assertNotIn('email', res_c_del.data)

        # Verify in database: watcher's vote exists, citizen's vote does not
        self.assertTrue(ReportVote.objects.filter(report=self.report, user=self.watcher).exists())
        self.assertFalse(ReportVote.objects.filter(report=self.report, user=self.citizen).exists())

        # Step 4: Voting lifecycle on RESOLVED report
        res_res_up = self.client.post(f'/api/watcher/reports/{resolved_report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_res_up.status_code, status.HTTP_200_OK)
        self.assertEqual(res_res_up.data['upvotes'], 1)

        res_res_del = self.client.delete(f'/api/watcher/reports/{resolved_report.id}/vote/')
        self.assertEqual(res_res_del.status_code, status.HTTP_200_OK)
        self.assertEqual(res_res_del.data['upvotes'], 0)
        self.assertEqual(res_res_del.data['downvotes'], 0)
        self.assertEqual(res_res_del.data['net_votes'], 0)
        self.assertIsNone(res_res_del.data['user_vote'])

        # Step 5: Assert that reports and associated system entities were NOT mutated
        self.report.refresh_from_db()
        resolved_report.refresh_from_db()
        hotspot.refresh_from_db()

        self.assertEqual(self.report.status, ReportStatus.APPROVED)
        self.assertEqual(resolved_report.status, ReportStatus.RESOLVED)
        self.assertEqual(self.report.updated_at, initial_rep_updated_at)
        self.assertEqual(resolved_report.updated_at, initial_res_updated_at)
        self.assertEqual(ReportStatusHistory.objects.count(), initial_history_count)
        self.assertEqual(CollectionConfirmation.objects.count(), initial_conf_count)
        self.assertEqual(GarbageHotspot.objects.count(), initial_hotspot_count)
        self.assertTrue(hotspot.is_active)
        self.assertEqual(HotspotIntervention.objects.count(), initial_intervention_count)

    def test_voting_barangay_scope_enforcement(self):
        """
        Finding 1: Enforce strict barangay scope for civic voting.
        - Citizen, Watcher, Brgy Official may only vote on reports within their assigned barangay.
        - Users without an assigned barangay are rejected (403).
        - Cross-barangay voting is rejected (403).
        - Drivers and Admins are rejected (403).
        - Reports without an assigned barangay cannot receive votes (400).
        """
        other_brgy = Barangay.objects.create(name='Barangay 2')
        citizen_other = User.objects.create_user(
            username='citizen_other', email='other_c@test.com', password='pw',
            role=UserRole.CITIZEN, barangay=other_brgy,
        )
        citizen_no_brgy = User.objects.create_user(
            username='citizen_no_brgy', email='nobrgy_c@test.com', password='pw',
            role=UserRole.CITIZEN, barangay=None,
        )
        watcher_other = User.objects.create_user(
            username='watcher_other', email='other_w@test.com', password='pw',
            role=UserRole.WATCHER, barangay=other_brgy,
        )
        watcher_no_brgy = User.objects.create_user(
            username='watcher_no_brgy', email='nobrgy_w@test.com', password='pw',
            role=UserRole.WATCHER, barangay=None,
        )
        official_other = User.objects.create_user(
            username='official_other', email='other_o@test.com', password='pw',
            role=UserRole.BRGY_OFFICIAL, barangay=other_brgy,
        )
        report_no_brgy = GarbageReport.objects.create(
            user=self.citizen,
            barangay=None,
            status=ReportStatus.APPROVED,
            issue_type=IssueType.OVERFLOW,
            description='Report without barangay',
        )

        # 1. Citizen within assigned barangay succeeds (200 OK)
        self.client.force_authenticate(user=self.citizen)
        res_ok = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_ok.status_code, status.HTTP_200_OK)

        # 2. Citizen outside assigned barangay rejected (403 Forbidden)
        self.client.force_authenticate(user=citizen_other)
        res_cross_c = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_cross_c.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('outside your assigned barangay', res_cross_c.data['error'])

        # 3. Citizen without assigned barangay rejected (403 Forbidden)
        self.client.force_authenticate(user=citizen_no_brgy)
        res_nobrgy_c = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_nobrgy_c.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('without an assigned barangay', res_nobrgy_c.data['error'])

        # 4. Watcher within assigned barangay succeeds (200 OK)
        self.client.force_authenticate(user=self.watcher)
        res_w_ok = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': -1})
        self.assertEqual(res_w_ok.status_code, status.HTTP_200_OK)

        # 5. Watcher outside assigned barangay rejected (403 Forbidden)
        self.client.force_authenticate(user=watcher_other)
        res_cross_w = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_cross_w.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('outside your assigned barangay', res_cross_w.data['error'])

        # 6. Watcher without assigned barangay rejected (403 Forbidden)
        self.client.force_authenticate(user=watcher_no_brgy)
        res_nobrgy_w = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_nobrgy_w.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('without an assigned barangay', res_nobrgy_w.data['error'])

        # 7. Official within assigned barangay succeeds (200 OK)
        self.client.force_authenticate(user=self.official)
        res_o_ok = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_o_ok.status_code, status.HTTP_200_OK)

        # 8. Official outside assigned barangay rejected (403 Forbidden)
        self.client.force_authenticate(user=official_other)
        res_cross_o = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_cross_o.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('outside your assigned barangay', res_cross_o.data['error'])

        # 9. Driver cannot vote (403 Forbidden)
        self.client.force_authenticate(user=self.driver)
        res_drv = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_drv.status_code, status.HTTP_403_FORBIDDEN)

        # 10. Admin cannot vote (403 Forbidden)
        self.client.force_authenticate(user=self.admin)
        res_adm = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_adm.status_code, status.HTTP_403_FORBIDDEN)

        # 11. Report without barangay cannot receive votes (400 Bad Request)
        self.client.force_authenticate(user=self.citizen)
        res_no_rep_brgy = self.client.post(f'/api/watcher/reports/{report_no_brgy.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_no_rep_brgy.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('without an assigned barangay', res_no_rep_brgy.data['error'])

    def test_consistent_404_for_inaccessible_reports(self):
        """
        Finding 2: Missing and inaccessible reports return consistent 404 NOT FOUND for POST and DELETE.
        Does not disclose whether an inaccessible report exists or reveal its status.
        """
        # User B's pending report (inaccessible to User A / self.watcher)
        pending_other = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.PENDING,
            issue_type=IssueType.OVERFLOW,
            description='Private pending report',
        )

        # User B's rejected report (inaccessible to User A)
        rejected_other = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.REJECTED,
            issue_type=IssueType.OVERFLOW,
            description='Private rejected report',
        )

        other_brgy = Barangay.objects.create(name='Barangay Visibility Test')
        unrelated_citizen = User.objects.create_user(
            username='unrelated_c', email='unrel@test.com', password='pw',
            role=UserRole.CITIZEN, barangay=other_brgy,
        )
        self.client.force_authenticate(user=unrelated_citizen)

        # 1. Non-existent report: POST and DELETE return 404
        res_missing_post = self.client.post('/api/watcher/reports/999999/vote/', {'vote_type': 1})
        self.assertEqual(res_missing_post.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_missing_post.data['error'], 'Report not found.')

        res_missing_del = self.client.delete('/api/watcher/reports/999999/vote/')
        self.assertEqual(res_missing_del.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_missing_del.data['error'], 'Report not found.')

        # 2. Inaccessible pending report: POST and DELETE return identical 404
        res_pending_post = self.client.post(f'/api/watcher/reports/{pending_other.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_pending_post.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_pending_post.data['error'], 'Report not found.')

        res_pending_del = self.client.delete(f'/api/watcher/reports/{pending_other.id}/vote/')
        self.assertEqual(res_pending_del.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_pending_del.data['error'], 'Report not found.')

        # 3. Inaccessible rejected report: POST and DELETE return identical 404
        res_rej_post = self.client.post(f'/api/watcher/reports/{rejected_other.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_rej_post.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_rej_post.data['error'], 'Report not found.')

        res_rej_del = self.client.delete(f'/api/watcher/reports/{rejected_other.id}/vote/')
        self.assertEqual(res_rej_del.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_rej_del.data['error'], 'Report not found.')

    def test_delete_vote_on_inaccessible_report_does_not_disclose_counts(self):
        """
        Step 4.0B.5.2 Finding 1:
        When a report becomes rejected or archived, an existing voter may withdraw
        their vote via DELETE. The response must return ONLY report_id and user_vote: None,
        with zero disclosure of consensus counts (upvotes, downvotes, net_votes) or private fields.
        Other users' votes remain intact, and an unrelated user still receives 404.
        """
        rep = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.APPROVED,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH,
            description='Report that will be rejected',
        )

        voter2 = User.objects.create_user(
            username='voter2_citizen', email='voter2@test.com', password='pw',
            role=UserRole.CITIZEN, barangay=self.barangay,
        )

        # Voter 1 (self.watcher) casts upvote (+1)
        ReportVote.objects.create(report=rep, user=self.watcher, vote_type=1)

        # Voter 2 (voter2) casts downvote (-1)
        ReportVote.objects.create(report=rep, user=voter2, vote_type=-1)
        self.assertEqual(rep.votes.count(), 2)

        # Report transitions to REJECTED (now inaccessible to non-owners)
        rep.status = ReportStatus.REJECTED
        rep.save()

        # Voter 1 (self.watcher) withdraws their vote
        self.client.force_authenticate(user=self.watcher)
        res_del = self.client.delete(f'/api/watcher/reports/{rep.id}/vote/')
        self.assertEqual(res_del.status_code, status.HTTP_200_OK)

        # Strictly verify response payload contains ONLY report_id and user_vote: None
        self.assertEqual(set(res_del.data.keys()), {'report_id', 'user_vote'})
        self.assertEqual(res_del.data['report_id'], rep.id)
        self.assertIsNone(res_del.data['user_vote'])
        self.assertNotIn('upvotes', res_del.data)
        self.assertNotIn('downvotes', res_del.data)
        self.assertNotIn('net_votes', res_del.data)
        self.assertNotIn('status', res_del.data)
        self.assertNotIn('barangay', res_del.data)

        # Verify Voter 1's vote is gone
        self.assertFalse(ReportVote.objects.filter(report=rep, user=self.watcher).exists())

        # Verify Voter 2's vote remains intact
        self.assertTrue(ReportVote.objects.filter(report=rep, user=voter2).exists())
        self.assertEqual(ReportVote.objects.get(report=rep, user=voter2).vote_type, -1)

        # Unrelated user (never voted on this inaccessible report) receives 404
        unrelated = User.objects.create_user(
            username='unrelated_voter', email='unrelated_voter@test.com', password='pw',
            role=UserRole.CITIZEN, barangay=self.barangay,
        )
        self.client.force_authenticate(user=unrelated)
        res_unrelated_del = self.client.delete(f'/api/watcher/reports/{rep.id}/vote/')
        self.assertEqual(res_unrelated_del.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_unrelated_del.data['error'], 'Report not found.')

        # Repeat verification for an ARCHIVED report
        rep_archived = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.APPROVED,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.MEDIUM,
            description='Report that will be archived',
        )
        ReportVote.objects.create(report=rep_archived, user=self.watcher, vote_type=1)
        ReportVote.objects.create(report=rep_archived, user=voter2, vote_type=-1)
        rep_archived.is_archived = True
        rep_archived.save()

        self.client.force_authenticate(user=self.watcher)
        res_arch_del = self.client.delete(f'/api/watcher/reports/{rep_archived.id}/vote/')
        self.assertEqual(res_arch_del.status_code, status.HTTP_200_OK)
        self.assertEqual(set(res_arch_del.data.keys()), {'report_id', 'user_vote'})
        self.assertIsNone(res_arch_del.data['user_vote'])
        self.assertNotIn('upvotes', res_arch_del.data)
        self.assertFalse(ReportVote.objects.filter(report=rep_archived, user=self.watcher).exists())
        self.assertTrue(ReportVote.objects.filter(report=rep_archived, user=voter2).exists())

    def test_read_only_get_endpoints_do_not_create_community_post(self):
        # Create a historical report without a linked CommunityPost
        historical_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.MEDIUM,
            status=ReportStatus.APPROVED,
            address='Historical Street, Lucena City',
            description='Report submitted before community post link was added.',
        )
        self.assertFalse(hasattr(historical_report, 'community_post') and historical_report.community_post is not None)
        initial_post_count = CommunityPost.objects.count()

        self.client.force_authenticate(user=self.citizen)

        # 1. GET /api/watcher/reports/{id}/community_post/ returns 404 and does NOT create CommunityPost
        res_get_post = self.client.get(f'/api/watcher/reports/{historical_report.id}/community_post/')
        self.assertEqual(res_get_post.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_get_post.data['error'], 'No community post associated with this report.')
        self.assertEqual(CommunityPost.objects.count(), initial_post_count)

        # 2. GET /api/watcher/reports/{id}/comments/ returns 200 with [] and does NOT create CommunityPost
        res_get_comments = self.client.get(f'/api/watcher/reports/{historical_report.id}/comments/')
        self.assertEqual(res_get_comments.status_code, status.HTTP_200_OK)
        self.assertEqual(res_get_comments.data, [])
        self.assertEqual(CommunityPost.objects.count(), initial_post_count)

        # 3. POST /api/watcher/reports/{id}/comments/ creates linked CommunityPost atomically and adds comment
        res_post_comment = self.client.post(f'/api/watcher/reports/{historical_report.id}/comments/', {
            'content': 'First comment on historical report',
        })
        self.assertEqual(res_post_comment.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_post_comment.data['content'], 'First comment on historical report')
        self.assertEqual(CommunityPost.objects.count(), initial_post_count + 1)

        historical_report.refresh_from_db()
        self.assertIsNotNone(historical_report.community_post)
        self.assertEqual(historical_report.community_post.post_type, PostType.REPORT)

        # 4. Now that post exists, subsequent GET /api/watcher/reports/{id}/community_post/ returns 200
        res_get_post_after = self.client.get(f'/api/watcher/reports/{historical_report.id}/community_post/')
        self.assertEqual(res_get_post_after.status_code, status.HTTP_200_OK)
        self.assertEqual(res_get_post_after.data['id'], historical_report.community_post.id)

        # 5. Subsequent GET /api/watcher/reports/{id}/comments/ returns the comment
        res_get_comments_after = self.client.get(f'/api/watcher/reports/{historical_report.id}/comments/')
        self.assertEqual(res_get_comments_after.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_get_comments_after.data), 1)
        self.assertEqual(res_get_comments_after.data[0]['id'], res_post_comment.data['id'])

    def test_report_list_query_optimization_and_serialization(self):
        # Create multiple reports with votes and comments
        report_a = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH,
            status=ReportStatus.APPROVED,
            address='Report A Street',
        )
        post_a, _ = create_or_get_community_post_for_report(report_a)
        PostComment.objects.create(post=post_a, author=self.citizen, content='Comment 1 on A')
        PostComment.objects.create(post=post_a, author=self.watcher, content='Comment 2 on A')
        ReportVote.objects.create(report=report_a, user=self.citizen, vote_type=1)
        ReportVote.objects.create(report=report_a, user=self.watcher, vote_type=1)

        report_b = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.MISSED,
            severity=Severity.LOW,
            status=ReportStatus.APPROVED,
            address='Report B Street',
        )
        ReportVote.objects.create(report=report_b, user=self.citizen, vote_type=-1)

        report_c = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.ILLEGAL_DUMP,
            severity=Severity.HIGH,
            status=ReportStatus.APPROVED,
            address='Report C Street',
        )

        self.client.force_authenticate(user=self.citizen)

        # Test listing endpoint
        res_list = self.client.get('/api/watcher/reports/')
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        results = res_list.data.get('results', res_list.data) if isinstance(res_list.data, dict) else res_list.data

        # Find items
        item_a = next((r for r in results if r['id'] == report_a.id), None)
        self.assertIsNotNone(item_a)
        self.assertEqual(item_a['upvotes'], 2)
        self.assertEqual(item_a['downvotes'], 0)
        self.assertEqual(item_a['net_votes'], 2)
        self.assertEqual(item_a['user_vote'], 1)
        self.assertEqual(item_a['comment_count'], 2)
        self.assertEqual(item_a['community_post_id'], post_a.id)

        item_b = next((r for r in results if r['id'] == report_b.id), None)
        self.assertIsNotNone(item_b)
        self.assertEqual(item_b['upvotes'], 0)
        self.assertEqual(item_b['downvotes'], 1)
        self.assertEqual(item_b['net_votes'], -1)
        self.assertEqual(item_b['user_vote'], -1)
        self.assertEqual(item_b['comment_count'], 0)
        self.assertIsNone(item_b['community_post_id'])

        item_c = next((r for r in results if r['id'] == report_c.id), None)
        self.assertIsNotNone(item_c)
        self.assertEqual(item_c['upvotes'], 0)
        self.assertEqual(item_c['downvotes'], 0)
        self.assertEqual(item_c['net_votes'], 0)
        self.assertIsNone(item_c['user_vote'])
        self.assertEqual(item_c['comment_count'], 0)

        # Verify detail endpoint also serializes correctly
        res_detail_a = self.client.get(f'/api/watcher/reports/{report_a.id}/')
        self.assertEqual(res_detail_a.status_code, status.HTTP_200_OK)
        self.assertEqual(res_detail_a.data['upvotes'], 2)
        self.assertEqual(res_detail_a.data['downvotes'], 0)
        self.assertEqual(res_detail_a.data['net_votes'], 2)
        self.assertEqual(res_detail_a.data['user_vote'], 1)
        self.assertEqual(res_detail_a.data['comment_count'], 2)


    def test_atomic_report_to_post_creation_and_idempotency(self):
        self.client.force_authenticate(user=self.citizen)

        # Submitting a report via API creates both GarbageReport and CommunityPost
        payload = {
            'issue_type': 'missed',
            'severity': 'medium',
            'address': 'Barangay 1, Lucena City',
            'description': 'Collection truck skipped our street this morning.',
        }
        res = self.client.post('/api/watcher/reports/', payload)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        report_id = res.data['id']

        # CommunityPost was automatically created and linked
        report = GarbageReport.objects.get(id=report_id)
        self.assertTrue(hasattr(report, 'community_post'))
        self.assertIsNotNone(report.community_post)
        self.assertEqual(report.community_post.post_type, PostType.REPORT)
        self.assertEqual(report.community_post.report_id, report.id)

        # Response exposes community_post_id and voting counts
        self.assertEqual(res.data['community_post_id'], report.community_post.id)
        self.assertEqual(res.data['upvotes'], 0)
        self.assertEqual(res.data['downvotes'], 0)
        self.assertEqual(res.data['net_votes'], 0)

        # Calling service function again returns existing post without creating a second post
        post2, created = create_or_get_community_post_for_report(report)
        self.assertFalse(created)
        self.assertEqual(post2.id, report.community_post.id)
        self.assertEqual(CommunityPost.objects.filter(report=report).count(), 1)

    def test_one_to_one_constraint_between_report_and_post(self):
        post1, _ = create_or_get_community_post_for_report(self.report)
        self.assertEqual(post1.report_id, self.report.id)

        # Attempting to manually create a second CommunityPost pointing to the same report violates OneToOneField
        with self.assertRaises(IntegrityError):
            CommunityPost.objects.create(
                author=self.citizen,
                report=self.report,
                content='Attempting duplicate post link',
                post_type=PostType.REPORT,
            )

    def test_unified_comments_delegation_via_report_endpoint(self):
        # 1. Post comment via /api/watcher/reports/{id}/comments/
        self.client.force_authenticate(user=self.citizen)
        res_post_comment = self.client.post(f'/api/watcher/reports/{self.report.id}/comments/', {
            'content': 'I just checked, the pile is still there.'
        })
        self.assertEqual(res_post_comment.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_post_comment.data['content'], 'I just checked, the pile is still there.')

        # 2. Get comments via /api/watcher/reports/{id}/comments/
        res_get_report_comments = self.client.get(f'/api/watcher/reports/{self.report.id}/comments/')
        self.assertEqual(res_get_report_comments.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_get_report_comments.data), 1)

        # 3. Retrieve same comments via Community endpoint /api/community/posts/{post_id}/comments/
        community_post_id = self.report.community_post.id
        res_get_community_comments = self.client.get(f'/api/community/posts/{community_post_id}/comments/')
        self.assertEqual(res_get_community_comments.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_get_community_comments.data), 1)
        self.assertEqual(res_get_community_comments.data[0]['id'], res_post_comment.data['id'])

    def test_step_4_0b_4_unified_community_and_map_view_comment_threads(self):
        post, _ = create_or_get_community_post_for_report(self.report, author=self.citizen)
        hotspot = GarbageHotspot.objects.create(
            name='Test Unified Map Hotspot',
            barangay=self.barangay,
            latitude='13.931000',
            longitude='121.611000',
            source_report=self.report,
            severity='medium',
            is_active=True,
        )

        # 1. Map pins returns correct community_post_id and comment_count = 0
        res_pins = self.client.get('/api/watcher/reports/map_pins/')
        self.assertEqual(res_pins.status_code, status.HTTP_200_OK)
        pin = next((p for p in res_pins.data if p['id'] == hotspot.id), None)
        self.assertIsNotNone(pin)
        self.assertEqual(pin['community_post_id'], post.id)
        self.assertEqual(pin['comment_count'], 0)

        # 2. CommunityPost resolver on report returns the post ID
        res_res = self.client.get(f'/api/watcher/reports/{self.report.id}/community_post/')
        self.assertEqual(res_res.status_code, status.HTTP_200_OK)
        self.assertEqual(res_res.data['id'], post.id)

        # 3. Anonymous user CAN read comments (initially empty) but CANNOT post
        self.client.force_authenticate(user=None)
        res_anon_read = self.client.get(f'/api/community/posts/{post.id}/comments/')
        self.assertEqual(res_anon_read.status_code, status.HTTP_200_OK)
        self.assertEqual(res_anon_read.data, [])

        res_anon_post = self.client.post(f'/api/community/posts/{post.id}/comments/', {'content': 'Anon comment'})
        self.assertIn(res_anon_post.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

        res_anon_map_post = self.client.post(f'/api/watcher/reports/{self.report.id}/comments/', {'content': 'Anon map comment'})
        self.assertIn(res_anon_map_post.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

        # 4. Authenticated user submits comment from Community feed
        self.client.force_authenticate(user=self.watcher)
        res_com_submit = self.client.post(f'/api/community/posts/{post.id}/comments/', {
            'content': 'First comment posted from Community Feed'
        })
        self.assertEqual(res_com_submit.status_code, status.HTTP_201_CREATED)
        comment_1_id = res_com_submit.data['id']

        # 5. Comment is immediately readable from Map View / Report comments
        res_map_read = self.client.get(f'/api/watcher/reports/{self.report.id}/comments/')
        self.assertEqual(res_map_read.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_map_read.data), 1)
        self.assertEqual(res_map_read.data[0]['id'], comment_1_id)
        self.assertEqual(res_map_read.data[0]['content'], 'First comment posted from Community Feed')

        # 6. Map pins comment count is now 1
        res_pins_updated = self.client.get('/api/watcher/reports/map_pins/')
        pin_updated = next((p for p in res_pins_updated.data if p['id'] == hotspot.id), None)
        self.assertEqual(pin_updated['comment_count'], 1)

        # 7. Authenticated user submits second comment from Map View
        res_map_submit = self.client.post(f'/api/watcher/reports/{self.report.id}/comments/', {
            'content': 'Second comment posted from Public Map View'
        })
        self.assertEqual(res_map_submit.status_code, status.HTTP_201_CREATED)
        comment_2_id = res_map_submit.data['id']

        # 8. Both comments are visible from Community feed
        res_com_read = self.client.get(f'/api/community/posts/{post.id}/comments/')
        self.assertEqual(res_com_read.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_com_read.data), 2)
        com_ids = [c['id'] for c in res_com_read.data]
        self.assertIn(comment_1_id, com_ids)
        self.assertIn(comment_2_id, com_ids)

        # 9. Deletion permissions: non-author cannot delete
        self.client.force_authenticate(user=self.citizen)
        res_unauth_del = self.client.delete(f'/api/community/comments/{comment_2_id}/')
        self.assertIn(res_unauth_del.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_401_UNAUTHORIZED])

        # Author can delete
        self.client.force_authenticate(user=self.watcher)
        res_auth_del = self.client.delete(f'/api/community/comments/{comment_2_id}/')
        self.assertEqual(res_auth_del.status_code, status.HTTP_200_OK)

        # Remaining comments count is 1
        res_final_com = self.client.get(f'/api/community/posts/{post.id}/comments/')
        self.assertEqual(len(res_final_com.data), 1)

        # 10. Hidden post security: hidden posts cannot be resolved or commented on by non-admin
        post.is_hidden = True
        post.save()

        self.client.force_authenticate(user=self.citizen)
        res_hidden_resolve = self.client.get(f'/api/watcher/reports/{self.report.id}/community_post/')
        self.assertEqual(res_hidden_resolve.status_code, status.HTTP_404_NOT_FOUND)

        res_hidden_post_comment = self.client.post(f'/api/community/posts/{post.id}/comments/', {'content': 'Cannot comment'})
        self.assertIn(res_hidden_post_comment.status_code, [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND])

    def test_community_post_serializer_report_card_details(self):
        # Cast an upvote on the report
        ReportVote.objects.create(report=self.report, user=self.citizen, vote_type=1)
        post, _ = create_or_get_community_post_for_report(self.report)

        self.client.force_authenticate(user=self.citizen)
        res = self.client.get(f'/api/community/posts/{post.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['post_type'], PostType.REPORT)
        self.assertIsNotNone(res.data['report_details'])
        details = res.data['report_details']
        self.assertEqual(details['id'], self.report.id)
        self.assertEqual(details['issue_type'], 'overflow')
        self.assertEqual(details['status'], 'approved')
        self.assertEqual(details['upvotes'], 1)
        self.assertEqual(details['downvotes'], 0)
        self.assertEqual(details['net_votes'], 1)
        self.assertEqual(details['user_vote'], 1)

    def test_existing_discussion_posts_survive_migration(self):
        # Standard discussion post has post_type='discussion', report=None
        disc = CommunityPost.objects.create(
            author=self.citizen,
            content='What time does the truck pass by Zone 2 on Wednesdays?',
            post_type=PostType.DISCUSSION,
            category=PostCategory.SCHEDULE,
        )
        self.client.force_authenticate(user=self.citizen)
        res = self.client.get(f'/api/community/posts/{disc.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['post_type'], 'discussion')
        self.assertEqual(res.data['category'], 'schedule')
        self.assertIsNone(res.data['report'])
        self.assertIsNone(res.data['report_details'])

    def test_report_editing_lockdown(self):
        # 1. Owner can edit PENDING report
        pending_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.MEDIUM,
            status=ReportStatus.PENDING,
            description='Initial pending description',
        )
        self.client.force_authenticate(user=self.citizen)
        res_patch_pending = self.client.patch(f'/api/watcher/reports/{pending_report.id}/', {
            'description': 'Updated pending description',
        })
        self.assertEqual(res_patch_pending.status_code, status.HTTP_200_OK)
        pending_report.refresh_from_db()
        self.assertEqual(pending_report.description, 'Updated pending description')

        # 2. Owner CANNOT modify APPROVED report
        res_patch_approved = self.client.patch(f'/api/watcher/reports/{self.report.id}/', {
            'description': 'Attempted unauthorized change to approved report',
        })
        self.assertEqual(res_patch_approved.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Owner CANNOT modify RESOLVED report
        resolved_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.LOW,
            status=ReportStatus.RESOLVED,
            description='Resolved report',
        )
        res_patch_resolved = self.client.patch(f'/api/watcher/reports/{resolved_report.id}/', {
            'description': 'Attempted change to resolved report',
        })
        self.assertEqual(res_patch_resolved.status_code, status.HTTP_403_FORBIDDEN)

        # 4. Admin CAN modify
        self.client.force_authenticate(user=self.admin)
        res_admin_patch = self.client.patch(f'/api/watcher/reports/{self.report.id}/', {
            'description': 'Admin moderation update',
        })
        self.assertEqual(res_admin_patch.status_code, status.HTTP_200_OK)

    def test_civic_voting_comprehensive_matrix(self):
        # Ineligible roles: driver, admin
        self.client.force_authenticate(user=self.driver)
        res_driver = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_driver.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.admin)
        res_admin = self.client.post(f'/api/watcher/reports/{self.report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_admin.status_code, status.HTTP_403_FORBIDDEN)

        # Eligible non-owner user (watcher Pedro) can vote on RESOLVED report
        resolved_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.MEDIUM,
            status=ReportStatus.RESOLVED,
            description='Resolved for voting test',
        )
        self.client.force_authenticate(user=self.watcher)
        res_vote_resolved = self.client.post(f'/api/watcher/reports/{resolved_report.id}/vote/', {'vote_type': -1})
        self.assertEqual(res_vote_resolved.status_code, status.HTTP_200_OK)
        self.assertEqual(res_vote_resolved.data['downvotes'], 1)
        self.assertEqual(res_vote_resolved.data['user_vote'], -1)

        # Pending report rejects votes (404 for non-owner, 400 for owner)
        pending_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.MEDIUM,
            status=ReportStatus.PENDING,
            description='Pending report',
        )
        res_vote_pending_watcher = self.client.post(f'/api/watcher/reports/{pending_report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_vote_pending_watcher.status_code, status.HTTP_404_NOT_FOUND)

        self.client.force_authenticate(user=self.citizen)
        res_vote_pending_owner = self.client.post(f'/api/watcher/reports/{pending_report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_vote_pending_owner.status_code, status.HTTP_400_BAD_REQUEST)

        # Rejected report rejects votes (404 for non-owner, 400 for owner)
        rejected_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.MEDIUM,
            status=ReportStatus.REJECTED,
            description='Rejected report',
        )
        self.client.force_authenticate(user=self.watcher)
        res_vote_rejected_watcher = self.client.post(f'/api/watcher/reports/{rejected_report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_vote_rejected_watcher.status_code, status.HTTP_404_NOT_FOUND)

        self.client.force_authenticate(user=self.citizen)
        res_vote_rejected_owner = self.client.post(f'/api/watcher/reports/{rejected_report.id}/vote/', {'vote_type': 1})
        self.assertEqual(res_vote_rejected_owner.status_code, status.HTTP_400_BAD_REQUEST)

        self.client.force_authenticate(user=self.watcher)

        # Vote DELETE works after report is rejected
        ReportVote.objects.create(report=self.report, user=self.watcher, vote_type=1)
        self.report.status = ReportStatus.REJECTED
        self.report.save()

        res_del_rejected = self.client.delete(f'/api/watcher/reports/{self.report.id}/vote/')
        self.assertEqual(res_del_rejected.status_code, status.HTTP_200_OK)
        self.assertIsNone(res_del_rejected.data['user_vote'])
        self.assertFalse(ReportVote.objects.filter(report=self.report, user=self.watcher).exists())

        # Vote DELETE works after report is archived
        ReportVote.objects.create(report=self.report, user=self.watcher, vote_type=1)
        self.report.is_archived = True
        self.report.save()

        res_del_archived = self.client.delete(f'/api/watcher/reports/{self.report.id}/vote/')
        self.assertEqual(res_del_archived.status_code, status.HTTP_200_OK)
        self.assertIsNone(res_del_archived.data['user_vote'])

    def test_shared_comments_and_endpoint_permissions_comprehensive(self):
        # 1. Anonymous comments GET on public approved report: 200 OK
        self.client.logout()
        res_anon_comments = self.client.get(f'/api/watcher/reports/{self.report.id}/comments/')
        self.assertEqual(res_anon_comments.status_code, status.HTTP_200_OK)
        self.assertIsInstance(res_anon_comments.data, list)

        # 2. Anonymous comments POST: 401 or 403
        res_anon_post = self.client.post(f'/api/watcher/reports/{self.report.id}/comments/', {'content': 'Anon comment'})
        self.assertIn(res_anon_post.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

        # 3. Anonymous community_post GET on public report: 200 OK
        post, _ = create_or_get_community_post_for_report(self.report)
        res_anon_post_get = self.client.get(f'/api/watcher/reports/{self.report.id}/community_post/')
        self.assertEqual(res_anon_post_get.status_code, status.HTTP_200_OK)

        # 4. Hidden post behavior
        post.is_hidden = True
        post.save()

        res_hidden_post_get = self.client.get(f'/api/watcher/reports/{self.report.id}/community_post/')
        self.assertEqual(res_hidden_post_get.status_code, status.HTTP_404_NOT_FOUND)

        res_hidden_comments_get = self.client.get(f'/api/watcher/reports/{self.report.id}/comments/')
        self.assertEqual(res_hidden_comments_get.status_code, status.HTTP_200_OK)
        self.assertEqual(res_hidden_comments_get.data, [])

        self.client.force_authenticate(user=self.citizen)
        res_hidden_comments_post = self.client.post(f'/api/watcher/reports/{self.report.id}/comments/', {'content': 'Interacting with hidden'})
        self.assertEqual(res_hidden_comments_post.status_code, status.HTTP_400_BAD_REQUEST)

    def test_collection_confirmation_authorization_and_workflow(self):
        # Create a report and promote to hotspot
        hotspot = GarbageHotspot.objects.create(
            name='Test Hotspot',
            severity='medium',
            barangay=self.barangay,
            latitude=self.report.latitude or 13.9312,
            longitude=self.report.longitude or 121.6172,
            source_report=self.report,
        )

        # 1. Citizen cannot confirm collection (403)
        self.client.force_authenticate(user=self.citizen)
        res_cit = self.client.post('/api/watcher/confirmations/', {'report': self.report.id})
        self.assertEqual(res_cit.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Driver cannot confirm collection (403)
        self.client.force_authenticate(user=self.driver)
        res_drv = self.client.post('/api/watcher/confirmations/', {'report': self.report.id})
        self.assertEqual(res_drv.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Official outside barangay cannot confirm collection (400)
        brgy_other = Barangay.objects.create(name='Barangay Other')
        official_other = User.objects.create_user(
            username='official_other',
            email='other@example.com',
            password='pw',
            role=UserRole.BRGY_OFFICIAL,
            barangay=brgy_other,
        )
        self.client.force_authenticate(user=official_other)
        res_other = self.client.post('/api/watcher/confirmations/', {'report': self.report.id})
        self.assertIn(res_other.status_code, [status.HTTP_400_BAD_REQUEST, status.HTTP_403_FORBIDDEN])

        # 4. Pending report cannot be confirmed (400)
        pending_rep = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.MEDIUM,
            status=ReportStatus.PENDING,
            description='Pending report',
        )
        self.client.force_authenticate(user=self.watcher)
        res_pending_conf = self.client.post('/api/watcher/confirmations/', {'report': pending_rep.id})
        self.assertEqual(res_pending_conf.status_code, status.HTTP_400_BAD_REQUEST)

        # 5. Authorized Watcher confirms eligible approved report
        res_watch_conf = self.client.post('/api/watcher/confirmations/', {'report': self.report.id})
        self.assertEqual(res_watch_conf.status_code, status.HTTP_201_CREATED)

        # Verifications
        self.report.refresh_from_db()
        hotspot = GarbageHotspot.objects.get(source_report=self.report)
        self.assertFalse(hotspot.is_active)

        # Audit information
        conf = CollectionConfirmation.objects.get(id=res_watch_conf.data['id'])
        self.assertEqual(conf.confirmed_by, self.watcher)
        self.assertEqual(conf.barangay, self.barangay)

    def test_garbage_report_serializer_identity_masking(self):
        self.citizen.full_name = 'Juan Dela Cruz'
        self.citizen.save()
        self.driver.full_name = 'Kiko Driver'
        self.driver.save()
        self.report.reported_user = self.driver
        self.report.save()

        # 1. Unrelated citizen (watcher) viewing the report
        self.client.force_authenticate(user=self.watcher)
        res_anon = self.client.get(f'/api/watcher/reports/{self.report.id}/')
        self.assertEqual(res_anon.status_code, status.HTTP_200_OK)
        self.assertIsNone(res_anon.data['user'])
        self.assertEqual(res_anon.data['user_name'], 'Community Waste Report')
        self.assertIsNone(res_anon.data['reported_user'])
        self.assertEqual(res_anon.data['reported_user_name'], '')

        # 2. Report Owner (Juan) sees his own user_name, but reported_user is still hidden
        self.client.force_authenticate(user=self.citizen)
        res_owner = self.client.get(f'/api/watcher/reports/{self.report.id}/')
        self.assertEqual(res_owner.status_code, status.HTTP_200_OK)
        self.assertEqual(res_owner.data['user'], self.citizen.id)
        self.assertEqual(res_owner.data['user_name'], self.citizen.full_name)
        self.assertIsNone(res_owner.data['reported_user'])
        self.assertEqual(res_owner.data['reported_user_name'], '')

        # 3. Admin sees all information
        self.client.force_authenticate(user=self.admin)
        res_admin = self.client.get(f'/api/watcher/reports/{self.report.id}/')
        self.assertEqual(res_admin.status_code, status.HTTP_200_OK)
        self.assertEqual(res_admin.data['user'], self.citizen.id)
        self.assertEqual(res_admin.data['user_name'], self.citizen.full_name)
        self.assertEqual(res_admin.data['reported_user'], self.driver.id)
        self.assertEqual(res_admin.data['reported_user_name'], self.driver.full_name)

    def test_watcher_report_list_query_scaling_3_vs_13(self):
        GarbageReport.objects.all().delete()

        # Create 3 reports
        for i in range(3):
            GarbageReport.objects.create(
                user=self.citizen,
                barangay=self.barangay,
                issue_type=IssueType.OVERFLOW,
                severity=Severity.LOW,
                status=ReportStatus.APPROVED,
                description=f'Report list scaling {i}',
            )

        self.client.force_authenticate(user=self.citizen)

        from django.test.utils import CaptureQueriesContext
        from django.db import connection

        with CaptureQueriesContext(connection) as ctx3:
            res3 = self.client.get('/api/watcher/reports/?page_size=20')
            self.assertEqual(res3.status_code, status.HTTP_200_OK)
            self.assertEqual(len(res3.data['results']), 3)
        q3 = len(ctx3.captured_queries)

        # Create 10 more reports (total 13)
        for i in range(3, 13):
            GarbageReport.objects.create(
                user=self.citizen,
                barangay=self.barangay,
                issue_type=IssueType.OVERFLOW,
                severity=Severity.LOW,
                status=ReportStatus.APPROVED,
                description=f'Report list scaling {i}',
            )

        with CaptureQueriesContext(connection) as ctx13:
            res13 = self.client.get('/api/watcher/reports/?page_size=20')
            self.assertEqual(res13.status_code, status.HTTP_200_OK)
            self.assertEqual(len(res13.data['results']), 13)
        q13 = len(ctx13.captured_queries)

        self.assertEqual(q3, q13)
        self.assertLessEqual(q13, 10)

    def test_pagination_unauthenticated_guard_and_community_bounded(self):
        """
        Step 4.0B.6 Regression Test:
        - Anonymous users attempting ?paginate=false on GarbageReport list remain safely paginated (LIMIT 10).
        - Authenticated ordinary citizens, watchers, and officials CANNOT bypass pagination on general report list.
        - Community posts endpoint strictly enforces CommunityPagination and ignores ?paginate=false / ?all=true.
        - Explicitly authorized exception ('mine' action) works only on its intended scoped endpoint and retains permissions/filtering.
        - Map pins endpoint functions without pagination for complete map rendering.
        """
        GarbageReport.objects.all().delete()
        for i in range(12):
            GarbageReport.objects.create(
                user=self.citizen,
                barangay=self.barangay,
                issue_type=IssueType.OVERFLOW,
                severity=Severity.LOW,
                status=ReportStatus.APPROVED,
                description=f'Pagination guard test report {i}',
            )

        # 1. Anonymous request with ?paginate=false remains safely paginated to standard page size (10)
        anon_client = APIClient()
        res_anon = anon_client.get('/api/watcher/reports/?paginate=false')
        self.assertEqual(res_anon.status_code, status.HTTP_200_OK)
        self.assertIn('results', res_anon.data)
        self.assertEqual(res_anon.data['count'], 12)
        self.assertEqual(len(res_anon.data['results']), 10)

        # 2. Authenticated Citizen attempting ?paginate=false on general list endpoint CANNOT bypass pagination
        self.client.force_authenticate(user=self.citizen)
        res_cit = self.client.get('/api/watcher/reports/?paginate=false')
        self.assertEqual(res_cit.status_code, status.HTTP_200_OK)
        self.assertIn('results', res_cit.data)
        self.assertEqual(res_cit.data['count'], 12)
        self.assertEqual(len(res_cit.data['results']), 10)

        # 3. Authenticated Watcher and Official also CANNOT bypass pagination on general list endpoint
        self.client.force_authenticate(user=self.watcher)
        res_watcher = self.client.get('/api/watcher/reports/?paginate=false')
        self.assertEqual(res_watcher.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_watcher.data['results']), 10)

        self.client.force_authenticate(user=self.official)
        res_off = self.client.get('/api/watcher/reports/?paginate=false')
        self.assertEqual(res_off.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_off.data['results']), 10)

        # 4. Community posts endpoint strictly enforces CommunityPagination (ignores ?paginate=false / ?all=true)
        res_comm = anon_client.get('/api/community/posts/?paginate=false')
        self.assertEqual(res_comm.status_code, status.HTTP_200_OK)
        self.assertIn('results', res_comm.data)
        self.assertLessEqual(len(res_comm.data['results']), 15)

        res_comm_all = self.client.get('/api/community/posts/?all=true')
        self.assertEqual(res_comm_all.status_code, status.HTTP_200_OK)
        self.assertIn('results', res_comm_all.data)
        self.assertLessEqual(len(res_comm_all.data['results']), 15)

        # 5. Explicitly authorized action ('mine') allows ?paginate=false for authenticated users,
        #    strictly scoped to their own reports for map pins
        self.client.force_authenticate(user=self.citizen)
        res_mine = self.client.get('/api/watcher/reports/mine/?paginate=false')
        self.assertEqual(res_mine.status_code, status.HTTP_200_OK)
        self.assertIsInstance(res_mine.data, list)
        self.assertEqual(len(res_mine.data), 12)

        # Verify permission: Anonymous caller to 'mine' is rejected with 401/403
        res_mine_anon = anon_client.get('/api/watcher/reports/mine/?paginate=false')
        self.assertIn(res_mine_anon.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

        # Verify filtering: A report by watcher is NOT leaked to citizen via 'mine'
        GarbageReport.objects.create(
            user=self.watcher,
            barangay=self.barangay,
            issue_type=IssueType.ILLEGAL_DUMP,
            severity=Severity.HIGH,
            status=ReportStatus.APPROVED,
            description='Watcher report'
        )
        res_mine_filtered = self.client.get('/api/watcher/reports/mine/?paginate=false')
        self.assertEqual(len(res_mine_filtered.data), 12)

        # 6. Map pins dedicated endpoint functions unpaginated for public map display
        active_report = GarbageReport.objects.first()
        GarbageHotspot.objects.create(
            name='Test Hotspot',
            barangay=self.barangay,
            latitude=13.9312,
            longitude=121.6172,
            severity=Severity.HIGH,
            source_report=active_report,
            is_active=True,
        )
        res_pins = anon_client.get('/api/watcher/reports/map_pins/')
        self.assertEqual(res_pins.status_code, status.HTTP_200_OK)
        self.assertIsInstance(res_pins.data, list)
        self.assertGreaterEqual(len(res_pins.data), 1)

    def test_hotspot_only_pin_identity_safety_and_report_actions(self):
        """
        Step 4.0B.4.4 Regression Test:
        Demonstrate a true ID-collision scenario:
        - An unrelated GarbageReport is APPROVED and has an active CommunityPost.
        - A hotspot-only pin (source_report=None) shares the exact same primary key ID.
        - Verify map_pins payload strictly returns report_id=None, community_post_id=None, and comment_count=0.
        - Verify a legitimate linked hotspot continues to return its actual report ID and CommunityPost ID.
        """
        # 1. Existing discussion post
        discussion_post = CommunityPost.objects.create(
            author=self.citizen,
            content='General discussion on recycling bins in Lucena',
            post_type=PostType.DISCUSSION,
            category=PostCategory.GENERAL,
        )

        # 2. Create unrelated GarbageReport that is APPROVED and has an active CommunityPost
        unrelated_report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            issue_type=IssueType.ILLEGAL_DUMP,
            severity=Severity.LOW,
            status=ReportStatus.APPROVED,
            description='Separate approved report whose PK will match hotspot_only.id',
        )
        unrelated_post, _ = create_or_get_community_post_for_report(unrelated_report)
        # Add a comment to unrelated_post so its comment_count is > 0
        PostComment.objects.create(
            post=unrelated_post,
            author=self.citizen,
            content='Citizen comment on unrelated report',
        )
        self.assertEqual(unrelated_report.community_post.id, unrelated_post.id)
        self.assertEqual(unrelated_post.comments.count(), 1)

        # 3. Create hotspot-only pin with ID equal to unrelated_report.id, but source_report=None
        hotspot_only = GarbageHotspot.objects.create(
            id=unrelated_report.id,
            name='Hotspot Without Source Report',
            severity='medium',
            barangay=self.barangay,
            latitude=13.9350,
            longitude=121.6180,
            source_report=None,
            is_active=True,
        )
        self.assertEqual(hotspot_only.id, unrelated_report.id)

        # 4. Create linked hotspot with self.report (approved, report.id != hotspot_only.id)
        linked_hotspot = GarbageHotspot.objects.create(
            name='Linked Hotspot',
            severity='high',
            barangay=self.barangay,
            latitude=13.9312,
            longitude=121.6172,
            source_report=self.report,
            is_active=True,
        )
        linked_post, _ = create_or_get_community_post_for_report(self.report)

        # 5. Fetch map pins
        res = self.client.get('/api/watcher/reports/map_pins/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        pin_hotspot = next((p for p in res.data if p['id'] == hotspot_only.id), None)
        self.assertIsNotNone(pin_hotspot)
        # Hotspot-only pin MUST return report_id=None, community_post_id=None, comment_count=0
        # even though an approved GarbageReport with this PK and an active CommunityPost exists in the DB!
        self.assertIsNone(pin_hotspot['report_id'])
        self.assertIsNone(pin_hotspot['community_post_id'])
        self.assertEqual(pin_hotspot['comment_count'], 0)

        # 6. Linked pin MUST return correct report_id and community_post_id
        pin_linked = next((p for p in res.data if p['id'] == linked_hotspot.id), None)
        self.assertIsNotNone(pin_linked)
        self.assertEqual(pin_linked['report_id'], self.report.id)
        self.assertEqual(pin_linked['community_post_id'], linked_post.id)

        # 7. Demonstrate the danger of ID confusion:
        # If a buggy caller were to mistakenly use hotspot_only.id to query watcher community_post endpoint,
        # it would hit unrelated_report and leak unrelated_post:
        res_collision_leak = self.client.get(f'/api/watcher/reports/{hotspot_only.id}/community_post/')
        self.assertEqual(res_collision_leak.status_code, status.HTTP_200_OK)
        self.assertEqual(res_collision_leak.data['id'], unrelated_post.id)
        # This confirms unrelated_report is truly approved and has an active CommunityPost,
        # validating that map_pins returning report_id=None is the essential defense.

        # 8. Discussion post remains distinct and untouched
        self.client.force_authenticate(user=self.citizen)
        res_disc = self.client.get(f'/api/community/posts/{discussion_post.id}/')
        self.assertEqual(res_disc.status_code, status.HTTP_200_OK)
        self.assertIsNone(res_disc.data['report'])
        self.assertIsNone(res_disc.data['report_details'])


class Step40A6BackendCorrectionsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.brgy_a = Barangay.objects.create(name='Barangay Alpha')
        self.brgy_b = Barangay.objects.create(name='Barangay Beta')

        self.owner = User.objects.create_user(
            username='s6_owner',
            email='s6_owner@example.com',
            password='password123',
            full_name='Owner Citizen',
            role=UserRole.CITIZEN,
            barangay=self.brgy_a,
        )
        self.other_citizen = User.objects.create_user(
            username='s6_other_citizen',
            email='s6_other_citizen@example.com',
            password='password123',
            full_name='Other Citizen',
            role=UserRole.CITIZEN,
            barangay=self.brgy_b,
        )
        self.admin = User.objects.create_user(
            username='s6_admin',
            email='s6_admin@example.com',
            password='password123',
            full_name='Admin Staff',
            role=UserRole.ADMIN,
            is_staff=True,
        )
        self.brgy_official_a = User.objects.create_user(
            username='s6_official_a',
            email='s6_official_a@example.com',
            password='password123',
            full_name='Official Alpha',
            role=UserRole.BRGY_OFFICIAL,
            barangay=self.brgy_a,
        )
        self.brgy_official_b = User.objects.create_user(
            username='s6_official_b',
            email='s6_official_b@example.com',
            password='password123',
            full_name='Official Beta',
            role=UserRole.BRGY_OFFICIAL,
            barangay=self.brgy_b,
        )
        self.watcher_a = User.objects.create_user(
            username='s6_watcher_a',
            email='s6_watcher_a@example.com',
            password='password123',
            full_name='Watcher Alpha',
            role=UserRole.WATCHER,
            barangay=self.brgy_a,
        )
        self.watcher_unassigned = User.objects.create_user(
            username='s6_watcher_unassigned',
            email='s6_watcher_unassigned@example.com',
            password='password123',
            full_name='Watcher Unassigned',
            role=UserRole.WATCHER,
            barangay=None,
        )
        self.driver = User.objects.create_user(
            username='s6_driver',
            email='s6_driver@example.com',
            password='password123',
            full_name='Driver Dave',
            role=UserRole.DRIVER,
            barangay=self.brgy_a,
        )

    def test_duplicate_mine_endpoint_removed_and_archived_filtering(self):
        # Owner has 1 approved report and 1 rejected & archived report
        rep_approved = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.LOW,
            status=ReportStatus.APPROVED,
            description='Owner approved report',
        )
        rep_archived = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            issue_type=IssueType.ILLEGAL_DUMP,
            severity=Severity.HIGH,
            status=ReportStatus.REJECTED,
            is_archived=True,
            description='Owner rejected and archived report',
        )
        # Other citizen has 1 approved report
        rep_other = GarbageReport.objects.create(
            user=self.other_citizen,
            barangay=self.brgy_b,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.LOW,
            status=ReportStatus.APPROVED,
            description='Other citizen approved report',
        )

        # 1. Unauthenticated request to mine/ returns 401
        res_anon = self.client.get('/api/watcher/reports/mine/')
        self.assertIn(res_anon.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

        # 2. Owner sees both own approved and own archived report in mine/
        self.client.force_authenticate(user=self.owner)
        res_owner = self.client.get('/api/watcher/reports/mine/')
        self.assertEqual(res_owner.status_code, status.HTTP_200_OK)
        owner_data = res_owner.data.get('results', res_owner.data)
        owner_ids = [r['id'] for r in owner_data]
        self.assertIn(rep_approved.id, owner_ids)
        self.assertIn(rep_archived.id, owner_ids)
        self.assertNotIn(rep_other.id, owner_ids)

        # 3. Other citizen sees only their own report in mine/
        self.client.force_authenticate(user=self.other_citizen)
        res_other = self.client.get('/api/watcher/reports/mine/')
        self.assertEqual(res_other.status_code, status.HTTP_200_OK)
        other_data = res_other.data.get('results', res_other.data)
        other_ids = [r['id'] for r in other_data]
        self.assertEqual(other_ids, [rep_other.id])

    def test_hotspot_preservation_when_interventions_exist(self):
        # Create approved report and hotspot
        report = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            issue_type=IssueType.ILLEGAL_DUMP,
            severity=Severity.HIGH,
            status=ReportStatus.APPROVED,
            latitude='13.931200',
            longitude='121.612300',
        )
        hotspot = GarbageHotspot.objects.create(
            name='Alpha Site 1',
            severity=Severity.HIGH,
            barangay=self.brgy_a,
            latitude='13.931200',
            longitude='121.612300',
            source_report=report,
            is_active=True,
        )
        intervention = HotspotIntervention.objects.create(
            hotspot=hotspot,
            intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.ACKNOWLEDGED,
            created_by=self.admin,
        )

        # Rejection must deactivate hotspot (is_active=False), NOT delete it (which would raise ProtectedError)
        self.client.force_authenticate(user=self.admin)
        res_reject = self.client.post(f'/api/watcher/reports/{report.id}/reject/', {'rejection_reason': 'Invalid submission'})
        self.assertEqual(res_reject.status_code, status.HTTP_200_OK)

        report.refresh_from_db()
        self.assertEqual(report.status, ReportStatus.REJECTED)

        # Hotspot must still exist and be inactive
        hotspot.refresh_from_db()
        self.assertFalse(hotspot.is_active)
        # Intervention must still exist and reference the hotspot
        intervention.refresh_from_db()
        self.assertEqual(intervention.hotspot_id, hotspot.id)

        # Test Collection Confirmation preservation path as well
        report2 = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.MEDIUM,
            status=ReportStatus.APPROVED,
            latitude='13.932200',
            longitude='121.613300',
        )
        hotspot2 = GarbageHotspot.objects.create(
            name='Alpha Site 2',
            severity=Severity.MEDIUM,
            barangay=self.brgy_a,
            latitude='13.932200',
            longitude='121.613300',
            source_report=report2,
            is_active=True,
        )
        intervention2 = HotspotIntervention.objects.create(
            hotspot=hotspot2,
            intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.ACKNOWLEDGED,
            created_by=self.admin,
        )

        self.client.force_authenticate(user=self.watcher_a)
        res_conf = self.client.post('/api/watcher/confirmations/', {'report': report2.id})
        self.assertEqual(res_conf.status_code, status.HTTP_201_CREATED)

        report2.refresh_from_db()
        self.assertEqual(report2.status, ReportStatus.RESOLVED)
        hotspot2.refresh_from_db()
        self.assertFalse(hotspot2.is_active)
        intervention2.refresh_from_db()
        self.assertEqual(intervention2.hotspot_id, hotspot2.id)

    def test_rejected_and_archived_reports_excluded_from_active_map_pins(self):
        # 1. Approved active report + hotspot
        r_app = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.APPROVED,
            latitude='13.931000',
            longitude='121.611000',
        )
        h_app = GarbageHotspot.objects.create(
            name='Active Hotspot',
            barangay=self.brgy_a,
            latitude='13.931000',
            longitude='121.611000',
            source_report=r_app,
            is_active=True,
        )

        # 2. Rejected report + inactive hotspot
        r_rej = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.REJECTED,
            latitude='13.932000',
            longitude='121.612000',
        )
        h_rej = GarbageHotspot.objects.create(
            name='Rejected Hotspot',
            barangay=self.brgy_a,
            latitude='13.932000',
            longitude='121.612000',
            source_report=r_rej,
            is_active=False,
        )

        # 3. Archived report + inactive hotspot
        r_arc = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.REJECTED,
            is_archived=True,
            latitude='13.933000',
            longitude='121.613000',
        )
        h_arc = GarbageHotspot.objects.create(
            name='Archived Hotspot',
            barangay=self.brgy_a,
            latitude='13.933000',
            longitude='121.613000',
            source_report=r_arc,
            is_active=False,
        )

        # 4. Pending report
        r_pen = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.PENDING,
            latitude='13.934000',
            longitude='121.614000',
        )
        h_pen = GarbageHotspot.objects.create(
            name='Pending Hotspot',
            barangay=self.brgy_a,
            latitude='13.934000',
            longitude='121.614000',
            source_report=r_pen,
            is_active=True,
        )

        res_pins = self.client.get('/api/watcher/reports/map_pins/')
        self.assertEqual(res_pins.status_code, status.HTTP_200_OK)
        pin_hotspot_ids = [p['id'] for p in res_pins.data]

        self.assertIn(h_app.id, pin_hotspot_ids)
        self.assertNotIn(h_rej.id, pin_hotspot_ids)
        self.assertNotIn(h_arc.id, pin_hotspot_ids)
        self.assertNotIn(h_pen.id, pin_hotspot_ids)

    def test_atomic_rejection_behavior(self):
        report = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.APPROVED,
            latitude='13.931500',
            longitude='121.611500',
            description='Atomic test report',
        )
        hotspot = GarbageHotspot.objects.create(
            name='Atomic Test Hotspot',
            barangay=self.brgy_a,
            latitude='13.931500',
            longitude='121.611500',
            source_report=report,
            is_active=True,
        )

        self.client.force_authenticate(user=self.brgy_official_a)
        res = self.client.post(f'/api/watcher/reports/{report.id}/reject/', {'rejection_reason': 'Out of scope location'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        report.refresh_from_db()
        self.assertEqual(report.status, ReportStatus.REJECTED)
        self.assertEqual(report.rejection_reason, 'Out of scope location')
        self.assertEqual(report.rejected_by, self.brgy_official_a)
        self.assertIsNotNone(report.rejected_at)

        hotspot.refresh_from_db()
        self.assertFalse(hotspot.is_active)

        # Status transition history record must exist
        hist = ReportStatusHistory.objects.filter(report=report, new_status=ReportStatus.REJECTED).first()
        self.assertIsNotNone(hist)
        self.assertEqual(hist.previous_status, ReportStatus.APPROVED)
        self.assertEqual(hist.changed_by, self.brgy_official_a)
        self.assertEqual(hist.remarks, 'Out of scope location')

    def test_reporter_and_staff_identity_masking_across_endpoints(self):
        report = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.APPROVED,
            approved_by=self.admin,
            approved_at=timezone.now(),
            latitude='13.935000',
            longitude='121.615000',
        )
        hotspot = GarbageHotspot.objects.create(
            name='Alpha Masking Hotspot',
            barangay=self.brgy_a,
            latitude='13.935000',
            longitude='121.615000',
            source_report=report,
            is_active=True,
        )

        # 1. Anonymous viewer on map_pins
        res_anon_pins = self.client.get('/api/watcher/reports/map_pins/')
        pin = next((p for p in res_anon_pins.data if p['id'] == hotspot.id), None)
        self.assertIsNotNone(pin)
        self.assertEqual(pin['user_name'], 'Community Waste Report')

        # 2. Owner viewer on map_pins
        self.client.force_authenticate(user=self.owner)
        res_owner_pins = self.client.get('/api/watcher/reports/map_pins/')
        pin_owner = next((p for p in res_owner_pins.data if p['id'] == hotspot.id), None)
        self.assertIsNotNone(pin_owner)
        self.assertEqual(pin_owner['user_name'], self.owner.full_name)

        # 3. Unrelated citizen on hotspots/{id}/reports
        self.client.force_authenticate(user=self.other_citizen)
        res_unauth_reports = self.client.get(f'/api/watcher/hotspots/{hotspot.id}/reports/')
        self.assertEqual(res_unauth_reports.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_unauth_reports.data), 1)
        self.assertEqual(res_unauth_reports.data[0]['reported_by'], 'Community Waste Report')

        # 4. Owner viewer on hotspots/{id}/reports
        self.client.force_authenticate(user=self.owner)
        res_owner_reports = self.client.get(f'/api/watcher/hotspots/{hotspot.id}/reports/')
        self.assertEqual(res_owner_reports.status_code, status.HTTP_200_OK)
        self.assertEqual(res_owner_reports.data[0]['reported_by'], self.owner.full_name)

        # 5. Staff identity masking in GarbageReportSerializer (reports/{id}/)
        self.client.force_authenticate(user=self.other_citizen)
        res_unauth_detail = self.client.get(f'/api/watcher/reports/{report.id}/')
        self.assertEqual(res_unauth_detail.status_code, status.HTTP_200_OK)
        self.assertIsNone(res_unauth_detail.data['approved_by'])
        self.assertEqual(res_unauth_detail.data['approved_by_name'], '')

        self.client.force_authenticate(user=self.admin)
        res_admin_detail = self.client.get(f'/api/watcher/reports/{report.id}/')
        self.assertEqual(res_admin_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(res_admin_detail.data['approved_by'], self.admin.id)
        self.assertEqual(res_admin_detail.data['approved_by_name'], self.admin.full_name)

    def test_collection_confirmation_role_and_barangay_restrictions(self):
        rep_a = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.APPROVED,
        )
        rep_b = GarbageReport.objects.create(
            user=self.other_citizen,
            barangay=self.brgy_b,
            status=ReportStatus.APPROVED,
        )
        rep_no_brgy = GarbageReport.objects.create(
            user=self.owner,
            barangay=None,
            status=ReportStatus.APPROVED,
        )
        rep_pending = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.PENDING,
        )

        # Watcher A trying to confirm in Barangay B -> 403
        self.client.force_authenticate(user=self.watcher_a)
        res1 = self.client.post('/api/watcher/confirmations/', {'report': rep_b.id})
        self.assertEqual(res1.status_code, status.HTTP_403_FORBIDDEN)

        # Unassigned watcher trying to confirm -> 403
        self.client.force_authenticate(user=self.watcher_unassigned)
        res2 = self.client.post('/api/watcher/confirmations/', {'report': rep_a.id})
        self.assertEqual(res2.status_code, status.HTTP_403_FORBIDDEN)

        # Watcher A trying to confirm report without barangay -> 403
        self.client.force_authenticate(user=self.watcher_a)
        res3 = self.client.post('/api/watcher/confirmations/', {'report': rep_no_brgy.id})
        self.assertEqual(res3.status_code, status.HTTP_403_FORBIDDEN)

        # Barangay Official B trying to confirm report in Barangay A -> 403
        self.client.force_authenticate(user=self.brgy_official_b)
        res4 = self.client.post('/api/watcher/confirmations/', {'report': rep_a.id})
        self.assertEqual(res4.status_code, status.HTTP_403_FORBIDDEN)

        # Driver trying to confirm -> 403
        self.client.force_authenticate(user=self.driver)
        res5 = self.client.post('/api/watcher/confirmations/', {'report': rep_a.id})
        self.assertEqual(res5.status_code, status.HTTP_403_FORBIDDEN)

        # Citizen trying to confirm -> 403
        self.client.force_authenticate(user=self.owner)
        res6 = self.client.post('/api/watcher/confirmations/', {'report': rep_a.id})
        self.assertEqual(res6.status_code, status.HTTP_403_FORBIDDEN)

        # Watcher A confirming PENDING report -> 400
        self.client.force_authenticate(user=self.watcher_a)
        res7 = self.client.post('/api/watcher/confirmations/', {'report': rep_pending.id})
        self.assertEqual(res7.status_code, status.HTTP_400_BAD_REQUEST)

        # Admin confirming report without barangay -> 201
        self.client.force_authenticate(user=self.admin)
        res8 = self.client.post('/api/watcher/confirmations/', {'report': rep_no_brgy.id})
        self.assertEqual(res8.status_code, status.HTTP_201_CREATED)

        # Watcher A confirming valid report in Barangay A -> 201
        self.client.force_authenticate(user=self.watcher_a)
        res9 = self.client.post('/api/watcher/confirmations/', {'report': rep_a.id})
        self.assertEqual(res9.status_code, status.HTTP_201_CREATED)

    def test_concurrent_confirmation_prevention_returns_409(self):
        rep = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.APPROVED,
        )

        # First confirmation succeeds
        self.client.force_authenticate(user=self.watcher_a)
        res1 = self.client.post('/api/watcher/confirmations/', {'report': rep.id})
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Duplicate concurrent / subsequent confirmation returns 409 Conflict
        res2 = self.client.post('/api/watcher/confirmations/', {'report': rep.id})
        self.assertEqual(res2.status_code, status.HTTP_409_CONFLICT)
        self.assertIn('already been confirmed', res2.data['detail'])

    def test_confirmation_records_cannot_be_arbitrarily_edited_or_deleted(self):
        rep = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.APPROVED,
        )
        self.client.force_authenticate(user=self.watcher_a)
        res_create = self.client.post('/api/watcher/confirmations/', {'report': rep.id, 'notes': 'Original notes'})
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        conf_id = res_create.data['id']

        # PUT returns 403 Forbidden
        res_put = self.client.put(f'/api/watcher/confirmations/{conf_id}/', {'notes': 'Tampered notes'})
        self.assertEqual(res_put.status_code, status.HTTP_403_FORBIDDEN)

        # PATCH returns 403 Forbidden
        res_patch = self.client.patch(f'/api/watcher/confirmations/{conf_id}/', {'notes': 'Tampered notes'})
        self.assertEqual(res_patch.status_code, status.HTTP_403_FORBIDDEN)

        # DELETE returns 403 Forbidden
        res_delete = self.client.delete(f'/api/watcher/confirmations/{conf_id}/')
        self.assertEqual(res_delete.status_code, status.HTTP_403_FORBIDDEN)

        # Record still exists unaltered
        conf = CollectionConfirmation.objects.get(id=conf_id)
        self.assertEqual(conf.notes, 'Original notes')

    def test_report_owner_can_privately_view_rejected_and_archived_reports(self):
        rep_rej = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.REJECTED,
            rejection_reason='Duplicate test',
        )
        rep_arc = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.REJECTED,
            is_archived=True,
            rejection_reason='Archived test',
        )

        self.client.force_authenticate(user=self.owner)

        # Detail views accessible to owner
        res_d1 = self.client.get(f'/api/watcher/reports/{rep_rej.id}/')
        self.assertEqual(res_d1.status_code, status.HTTP_200_OK)
        self.assertEqual(res_d1.data['id'], rep_rej.id)

        res_d2 = self.client.get(f'/api/watcher/reports/{rep_arc.id}/')
        self.assertEqual(res_d2.status_code, status.HTTP_200_OK)
        self.assertEqual(res_d2.data['id'], rep_arc.id)

        # List view includes owner's rejected and archived reports
        res_list = self.client.get('/api/watcher/reports/')
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        list_data = res_list.data.get('results', res_list.data)
        ids = [r['id'] for r in list_data]
        self.assertIn(rep_rej.id, ids)
        self.assertIn(rep_arc.id, ids)

    def test_unauthorized_users_cannot_retrieve_rejected_or_archived_reports(self):
        rep_rej = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.REJECTED,
        )
        rep_arc = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.REJECTED,
            is_archived=True,
        )

        # Another citizen cannot retrieve via detail (404)
        self.client.force_authenticate(user=self.other_citizen)
        res1 = self.client.get(f'/api/watcher/reports/{rep_rej.id}/')
        self.assertEqual(res1.status_code, status.HTTP_404_NOT_FOUND)

        res2 = self.client.get(f'/api/watcher/reports/{rep_arc.id}/')
        self.assertEqual(res2.status_code, status.HTTP_404_NOT_FOUND)

        # List view does NOT include other user's rejected or archived reports
        res_list = self.client.get('/api/watcher/reports/')
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        other_list_data = res_list.data.get('results', res_list.data)
        ids = [r['id'] for r in other_list_data]
        self.assertNotIn(rep_rej.id, ids)
        self.assertNotIn(rep_arc.id, ids)

        # Anonymous cannot retrieve
        self.client.force_authenticate(user=None)
        res_anon1 = self.client.get(f'/api/watcher/reports/{rep_rej.id}/')
        self.assertEqual(res_anon1.status_code, status.HTTP_404_NOT_FOUND)

    def test_timestamp_calculations(self):
        t0 = timezone.now() - timedelta(hours=10)
        t_app = t0 + timedelta(hours=2)
        t_res = t0 + timedelta(hours=5)

        report = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.RESOLVED,
            created_at=t0,
            approved_at=t_app,
            resolved_at=t_res,
        )
        # Update created_at directly in DB since auto_now_add sets it to now
        GarbageReport.objects.filter(id=report.id).update(created_at=t0)
        report.refresh_from_db()

        # Model properties
        self.assertEqual(report.time_to_approval, timedelta(hours=2))
        self.assertEqual(report.time_to_resolution, timedelta(hours=5))
        self.assertEqual(report.resolution_duration_after_approval, timedelta(hours=3))

        # Serializer representations
        self.client.force_authenticate(user=self.owner)
        res = self.client.get(f'/api/watcher/reports/{report.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['time_to_approval_seconds'], 7200.0)
        self.assertEqual(res.data['time_to_resolution_seconds'], 18000.0)
        self.assertEqual(res.data['resolution_duration_after_approval_seconds'], 10800.0)

    def test_multiple_status_transitions_and_repeated_resolution_events(self):
        report = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.PENDING,
        )
        record_report_status_transition(report, ReportStatus.PENDING, changed_by=self.owner, remarks='Initial submission')

        # 1. Approval
        t1 = timezone.now()
        report.status = ReportStatus.APPROVED
        report.approved_by = self.admin
        report.approved_at = t1
        report.save()
        record_report_status_transition(report, ReportStatus.APPROVED, changed_by=self.admin, remarks='First approval')

        # 2. First resolution
        t2 = timezone.now()
        report.status = ReportStatus.RESOLVED
        report.resolved_at = t2
        report.save()
        record_report_status_transition(report, ReportStatus.RESOLVED, changed_by=self.watcher_a, remarks='First resolution', resolved_at=t2)

        # 3. Reopening back to approved
        report.status = ReportStatus.APPROVED
        report.save()
        record_report_status_transition(report, ReportStatus.APPROVED, changed_by=self.admin, remarks='Reopened for re-inspection')

        # 4. Second resolution
        t4 = timezone.now()
        report.status = ReportStatus.RESOLVED
        report.resolved_at = t4
        report.save()
        record_report_status_transition(report, ReportStatus.RESOLVED, changed_by=self.admin, remarks='Second resolution', resolved_at=t4)

        histories = list(ReportStatusHistory.objects.filter(report=report).order_by('timestamp', 'id'))
        self.assertEqual(len(histories), 5)

        # Verify statuses
        self.assertEqual(histories[0].new_status, ReportStatus.PENDING)
        self.assertEqual(histories[1].new_status, ReportStatus.APPROVED)
        self.assertEqual(histories[2].new_status, ReportStatus.RESOLVED)
        self.assertEqual(histories[3].new_status, ReportStatus.APPROVED)
        self.assertEqual(histories[4].new_status, ReportStatus.RESOLVED)

    def test_reopening_report_does_not_erase_previous_resolution_history(self):
        report = GarbageReport.objects.create(
            user=self.owner,
            barangay=self.brgy_a,
            status=ReportStatus.RESOLVED,
            resolved_at=timezone.now() - timedelta(days=2),
        )
        record_report_status_transition(report, ReportStatus.RESOLVED, changed_by=self.watcher_a, remarks='Initial resolution')

        # Admin reopens report
        report.status = ReportStatus.APPROVED
        report.save()
        record_report_status_transition(report, ReportStatus.APPROVED, changed_by=self.admin, remarks='Reopened due to community report')

        # Verify historical resolution entry is preserved
        past_res = ReportStatusHistory.objects.filter(report=report, new_status=ReportStatus.RESOLVED).first()
        self.assertIsNotNone(past_res)
        self.assertEqual(past_res.remarks, 'Initial resolution')
        self.assertEqual(report.status, ReportStatus.APPROVED)


class Step40A8BackendCorrectionsTests(TestCase):
    """
    Focused tests for Step 4.0A.8 targeted backend corrections:
    1. Migration reconciliation of old resolved/rejected/archived hotspots.
    2. Inactive hotspots excluded from every driver-facing endpoint.
    3. Retiring a hotspot preserves interventions but stops active dispatch visibility.
    4. Confirmation records the correct previous_status.
    5. Archive does not create a fake no-op transition.
    6. Reopen followed by reapproval and a second valid confirmation.
    7. resolved_at and duration semantics before, during, and after reopening.
    8. Public status-history responses do not expose identities or identifying remarks.
    9. Authorized viewers receive the appropriate history detail.
    10. Report-less confirmation works without a 500.
    11. Concurrent/state machine transitions validated with atomic locks.
    12. Existing approved owner visibility behavior remains intact.
    """

    def setUp(self):
        self.client = APIClient()

        self.brgy_a = Barangay.objects.create(name='Barangay 40A8-Alpha')
        self.brgy_b = Barangay.objects.create(name='Barangay 40A8-Beta')

        self.owner = User.objects.create_user(
            username='s8_owner',
            email='s8_owner@example.com',
            password='password123',
            full_name='Owner Citizen',
            role=UserRole.CITIZEN,
            barangay=self.brgy_a,
        )
        self.other_citizen = User.objects.create_user(
            username='s8_other',
            email='s8_other@example.com',
            password='password123',
            full_name='Other Citizen',
            role=UserRole.CITIZEN,
            barangay=self.brgy_b,
        )
        self.admin = User.objects.create_user(
            username='s8_admin',
            email='s8_admin@example.com',
            password='password123',
            full_name='Admin Boss',
            role=UserRole.ADMIN,
            is_staff=True,
        )
        self.official_a = User.objects.create_user(
            username='s8_official_a',
            email='s8_official_a@example.com',
            password='password123',
            full_name='Official Alpha',
            role=UserRole.BRGY_OFFICIAL,
            barangay=self.brgy_a,
        )
        self.official_b = User.objects.create_user(
            username='s8_official_b',
            email='s8_official_b@example.com',
            password='password123',
            full_name='Official Beta',
            role=UserRole.BRGY_OFFICIAL,
            barangay=self.brgy_b,
        )
        self.watcher_a = User.objects.create_user(
            username='s8_watcher_a',
            email='s8_watcher_a@example.com',
            password='password123',
            full_name='Watcher Alpha',
            role=UserRole.WATCHER,
            barangay=self.brgy_a,
        )
        self.driver = User.objects.create_user(
            username='s8_driver',
            email='s8_driver@example.com',
            password='password123',
            full_name='Driver Dave',
            role=UserRole.DRIVER,
            barangay=self.brgy_a,
        )

        from driver.models import Truck, TruckStatus, DriverShift
        self.truck = Truck.objects.create(
            plate_number='LCN-40A8',
            model='Isuzu Giga',
            status=TruckStatus.ACTIVE,
        )
        self.driver_shift = DriverShift.objects.create(
            driver=self.driver,
            truck=self.truck,
            is_active=True,
        )

    def test_01_migration_reconciliation_of_old_hotspots(self):
        """1. Reconcile historical hotspots linked to resolved, rejected, or archived reports."""
        from django.apps import apps
        import importlib
        mig_0027 = importlib.import_module('watcher.migrations.0027_reconcile_inactive_hotspots_and_interventions')
        reconcile_inactive_hotspots_and_interventions = mig_0027.reconcile_inactive_hotspots_and_interventions

        rep_res = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.RESOLVED,
            resolved_at=timezone.now(), latitude='13.931', longitude='121.611',
        )
        rep_rej = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.REJECTED,
            rejection_reason='Invalid', latitude='13.932', longitude='121.612',
        )
        rep_arc = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.REJECTED,
            is_archived=True, latitude='13.933', longitude='121.613',
        )
        rep_app = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.APPROVED,
            latitude='13.934', longitude='121.614',
        )

        h_res = GarbageHotspot.objects.create(
            name='Resolved Site', barangay=self.brgy_a, latitude='13.931', longitude='121.611',
            source_report=rep_res, is_active=True, assigned_truck=self.truck, dispatch_acknowledged=True,
        )
        h_rej = GarbageHotspot.objects.create(
            name='Rejected Site', barangay=self.brgy_a, latitude='13.932', longitude='121.612',
            source_report=rep_rej, is_active=True, assigned_truck=self.truck, dispatch_acknowledged=True,
        )
        h_arc = GarbageHotspot.objects.create(
            name='Archived Site', barangay=self.brgy_a, latitude='13.933', longitude='121.613',
            source_report=rep_arc, is_active=True, assigned_truck=self.truck, dispatch_acknowledged=True,
        )
        h_app = GarbageHotspot.objects.create(
            name='Approved Site', barangay=self.brgy_a, latitude='13.934', longitude='121.614',
            source_report=rep_app, is_active=True, assigned_truck=self.truck, dispatch_acknowledged=True,
        )

        i_open = HotspotIntervention.objects.create(
            hotspot=h_res, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.CREATED, truck=self.truck, created_by=self.admin,
        )
        i_collected = HotspotIntervention.objects.create(
            hotspot=h_res, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.COLLECTED, truck=self.truck, created_by=self.admin,
        )

        reconcile_inactive_hotspots_and_interventions(apps, None)

        h_res.refresh_from_db()
        h_rej.refresh_from_db()
        h_arc.refresh_from_db()
        h_app.refresh_from_db()

        self.assertFalse(h_res.is_active)
        self.assertIsNone(h_res.assigned_truck)
        self.assertFalse(h_rej.is_active)
        self.assertIsNone(h_rej.assigned_truck)
        self.assertFalse(h_arc.is_active)
        self.assertIsNone(h_arc.assigned_truck)

        # Approved hotspot remains active
        self.assertTrue(h_app.is_active)
        self.assertEqual(h_app.assigned_truck, self.truck)

        # Active intervention was cancelled, completed intervention preserved
        i_open.refresh_from_db()
        i_collected.refresh_from_db()
        self.assertEqual(i_open.status, InterventionStatus.CANCELLED)
        self.assertEqual(i_collected.status, InterventionStatus.COLLECTED)

    def test_02_inactive_hotspots_excluded_from_driver_facing_endpoints(self):
        """2. Inactive hotspots and dispatches excluded from nearby, assigned, and driver endpoints."""
        h_active = GarbageHotspot.objects.create(
            name='Active Hotspot', barangay=self.brgy_a, latitude='13.931200', longitude='121.612300',
            is_active=True, assigned_truck=self.truck,
        )
        h_inactive = GarbageHotspot.objects.create(
            name='Inactive Hotspot', barangay=self.brgy_a, latitude='13.931300', longitude='121.612400',
            is_active=False, assigned_truck=self.truck,
        )

        i_active = HotspotIntervention.objects.create(
            hotspot=h_active, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.CREATED, truck=self.truck, created_by=self.admin,
        )
        i_inactive = HotspotIntervention.objects.create(
            hotspot=h_inactive, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.CREATED, truck=self.truck, created_by=self.admin,
        )

        self.client.force_authenticate(user=self.driver)

        # Nearby endpoint
        res_nearby = self.client.get('/api/watcher/hotspots/nearby/?lat=13.9312&lng=121.6123')
        self.assertEqual(res_nearby.status_code, status.HTTP_200_OK)
        nearby_ids = [h['id'] for h in res_nearby.data]
        self.assertIn(h_active.id, nearby_ids)
        self.assertNotIn(h_inactive.id, nearby_ids)

        # Assigned endpoint
        res_assigned = self.client.get('/api/watcher/hotspots/assigned/')
        self.assertEqual(res_assigned.status_code, status.HTTP_200_OK)
        assigned_ids = [h['id'] for h in res_assigned.data]
        self.assertIn(h_active.id, assigned_ids)
        self.assertNotIn(h_inactive.id, assigned_ids)

        # Driver intervention endpoint
        res_drv = self.client.get('/api/watcher/interventions/driver/')
        self.assertEqual(res_drv.status_code, status.HTTP_200_OK)
        intervention_ids = [iv['id'] for iv in res_drv.data]
        self.assertIn(i_active.id, intervention_ids)
        self.assertNotIn(i_inactive.id, intervention_ids)

    def test_03_retiring_hotspot_preserves_interventions_stops_active_dispatch(self):
        """3. Manual hotspot retirement preserves interventions without ProtectedError."""
        hotspot = GarbageHotspot.objects.create(
            name='Protected Site', barangay=self.brgy_a, latitude='13.931200', longitude='121.612300',
            is_active=True, assigned_truck=self.truck,
        )
        i_ack = HotspotIntervention.objects.create(
            hotspot=hotspot, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.ACKNOWLEDGED, truck=self.truck, created_by=self.admin,
        )
        i_coll = HotspotIntervention.objects.create(
            hotspot=hotspot, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.COLLECTED, truck=self.truck, created_by=self.admin,
        )

        self.client.force_authenticate(user=self.admin)
        res_del = self.client.delete(f'/api/watcher/hotspots/{hotspot.id}/')
        self.assertEqual(res_del.status_code, status.HTTP_204_NO_CONTENT)

        hotspot.refresh_from_db()
        self.assertFalse(hotspot.is_active)
        self.assertIsNone(hotspot.assigned_truck)

        i_ack.refresh_from_db()
        i_coll.refresh_from_db()
        self.assertEqual(i_ack.status, InterventionStatus.CANCELLED)
        self.assertEqual(i_coll.status, InterventionStatus.COLLECTED)

    def test_04_confirmation_records_correct_previous_status(self):
        """4. Confirmation records APPROVED -> RESOLVED and non-identifying remarks."""
        report = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.APPROVED,
            approved_by=self.official_a, approved_at=timezone.now(),
        )
        record_report_status_transition(report, ReportStatus.APPROVED, changed_by=self.official_a, remarks='Approved')

        self.client.force_authenticate(user=self.watcher_a)
        res = self.client.post('/api/watcher/confirmations/', {'report': report.id, 'notes': 'Cleared debris'})
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        report.refresh_from_db()
        self.assertEqual(report.status, ReportStatus.RESOLVED)

        history = ReportStatusHistory.objects.filter(report=report).order_by('-timestamp', '-id').first()
        self.assertIsNotNone(history)
        self.assertEqual(history.previous_status, ReportStatus.APPROVED)
        self.assertEqual(history.new_status, ReportStatus.RESOLVED)
        self.assertNotIn(self.watcher_a.username, history.remarks)
        self.assertNotIn(self.watcher_a.email, history.remarks)

    def test_05_archive_does_not_create_fake_noop_transition(self):
        """5. Archiving a rejected report does not create a fake REJECTED -> REJECTED transition."""
        report = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.REJECTED,
            rejection_reason='Duplicate ticket',
        )
        record_report_status_transition(report, ReportStatus.REJECTED, changed_by=self.official_a, remarks='Duplicate ticket')

        count_before = ReportStatusHistory.objects.filter(report=report).count()
        self.assertEqual(count_before, 1)

        self.client.force_authenticate(user=self.official_a)
        res = self.client.post(f'/api/watcher/reports/{report.id}/archive/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        report.refresh_from_db()
        self.assertTrue(report.is_archived)

        count_after = ReportStatusHistory.objects.filter(report=report).count()
        self.assertEqual(count_after, count_before)

    def test_06_reopen_followed_by_reapproval_and_second_confirmation(self):
        """6. Full lifecycle: submit -> approve -> resolve -> reopen -> re-approve -> re-confirm."""
        self.client.force_authenticate(user=self.owner)
        res_submit = self.client.post('/api/watcher/reports/', {
            'issue_type': IssueType.ILLEGAL_DUMP,
            'severity': Severity.HIGH,
            'address': 'Quezon Ave',
            'barangay': self.brgy_a.id,
            'description': 'Litter pile',
        })
        self.assertEqual(res_submit.status_code, status.HTTP_201_CREATED)
        report_id = res_submit.data['id']

        # 1. Official approves
        self.client.force_authenticate(user=self.official_a)
        res_app = self.client.post(f'/api/watcher/reports/{report_id}/approve/')
        self.assertEqual(res_app.status_code, status.HTTP_200_OK)
        self.assertEqual(res_app.data['status'], ReportStatus.APPROVED)

        # 2. Watcher confirms collection
        self.client.force_authenticate(user=self.watcher_a)
        res_conf1 = self.client.post('/api/watcher/confirmations/', {'report': report_id})
        self.assertEqual(res_conf1.status_code, status.HTTP_201_CREATED)

        # 3. Official reopens report
        self.client.force_authenticate(user=self.official_a)
        res_reopen = self.client.post(f'/api/watcher/reports/{report_id}/reopen/', {'remarks': 'Waste still present'})
        self.assertEqual(res_reopen.status_code, status.HTTP_200_OK)
        self.assertEqual(res_reopen.data['status'], ReportStatus.PENDING)

        # 4. Official re-approves
        res_reapp = self.client.post(f'/api/watcher/reports/{report_id}/approve/')
        self.assertEqual(res_reapp.status_code, status.HTTP_200_OK)
        self.assertEqual(res_reapp.data['status'], ReportStatus.APPROVED)

        # 5. Watcher confirms collection again
        self.client.force_authenticate(user=self.watcher_a)
        res_conf2 = self.client.post('/api/watcher/confirmations/', {'report': report_id})
        self.assertEqual(res_conf2.status_code, status.HTTP_201_CREATED)

        # Verify full history sequence
        histories = list(ReportStatusHistory.objects.filter(report_id=report_id).order_by('timestamp', 'id'))
        pairs = [(h.previous_status, h.new_status) for h in histories]
        expected_pairs = [
            ('', ReportStatus.PENDING),
            (ReportStatus.PENDING, ReportStatus.APPROVED),
            (ReportStatus.APPROVED, ReportStatus.RESOLVED),
            (ReportStatus.RESOLVED, ReportStatus.PENDING),
            (ReportStatus.PENDING, ReportStatus.APPROVED),
            (ReportStatus.APPROVED, ReportStatus.RESOLVED),
        ]
        self.assertEqual(pairs, expected_pairs)

    def test_07_resolved_at_and_duration_semantics_across_reopen(self):
        """7. resolved_at and duration properties before, during, and after reopening."""
        t0 = timezone.now() - timedelta(hours=6)
        t_app1 = timezone.now() - timedelta(hours=5)
        t_res1 = timezone.now() - timedelta(hours=3)

        report = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.RESOLVED,
            created_at=t0, approved_at=t_app1, resolved_at=t_res1,
        )
        GarbageReport.objects.filter(id=report.id).update(created_at=t0)
        report.refresh_from_db()

        # Before reopening: durations are present
        self.assertIsNotNone(report.time_to_resolution)
        self.assertIsNotNone(report.resolution_duration_after_approval)

        # Reopen: resolved_at cleared, durations become None
        self.client.force_authenticate(user=self.official_a)
        res_reopen = self.client.post(f'/api/watcher/reports/{report.id}/reopen/', {'remarks': 'Reopened'})
        self.assertEqual(res_reopen.status_code, status.HTTP_200_OK)

        report.refresh_from_db()
        self.assertIsNone(report.resolved_at)
        self.assertIsNone(report.time_to_resolution)
        self.assertIsNone(report.resolution_duration_after_approval)
        self.assertIsNone(res_reopen.data['time_to_resolution_seconds'])
        self.assertIsNone(res_reopen.data['resolution_duration_after_approval_seconds'])

    def test_08_public_status_history_masks_identities_and_remarks(self):
        """8. Public / unauthorized callers receive masked status history without changed_by or remarks."""
        report = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.APPROVED,
            approved_by=self.official_a, approved_at=timezone.now(),
        )
        record_report_status_transition(
            report, ReportStatus.APPROVED, changed_by=self.official_a,
            remarks='Confidential staff reasoning: verification passed by alpha team'
        )

        # Anonymous caller
        self.client.logout()
        res_anon = self.client.get(f'/api/watcher/reports/{report.id}/')
        self.assertEqual(res_anon.status_code, status.HTTP_200_OK)
        hist_anon = res_anon.data['status_history']
        self.assertTrue(len(hist_anon) > 0)
        for h in hist_anon:
            self.assertIsNone(h['changed_by'])
            self.assertEqual(h['changed_by_name'], '')
            self.assertEqual(h['remarks'], '')
            self.assertIn('timestamp', h)
            self.assertIn('new_status', h)

        # Unrelated citizen caller
        self.client.force_authenticate(user=self.other_citizen)
        res_other = self.client.get(f'/api/watcher/reports/{report.id}/')
        self.assertEqual(res_other.status_code, status.HTTP_200_OK)
        for h in res_other.data['status_history']:
            self.assertIsNone(h['changed_by'])
            self.assertEqual(h['changed_by_name'], '')
            self.assertEqual(h['remarks'], '')

    def test_09_authorized_viewers_receive_full_history_detail(self):
        """9. Report owners and authorized staff receive full status history detail."""
        report = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.APPROVED,
            approved_by=self.official_a, approved_at=timezone.now(),
        )
        record_report_status_transition(
            report, ReportStatus.APPROVED, changed_by=self.official_a,
            remarks='Approved for collection'
        )

        # Report owner
        self.client.force_authenticate(user=self.owner)
        res_owner = self.client.get(f'/api/watcher/reports/{report.id}/')
        self.assertEqual(res_owner.status_code, status.HTTP_200_OK)
        latest_owner = res_owner.data['status_history'][0]
        self.assertEqual(latest_owner['changed_by'], self.official_a.id)
        self.assertEqual(latest_owner['changed_by_name'], self.official_a.full_name)
        self.assertEqual(latest_owner['remarks'], 'Approved for collection')

        # Assigned barangay official
        self.client.force_authenticate(user=self.official_a)
        res_off = self.client.get(f'/api/watcher/reports/{report.id}/')
        self.assertEqual(res_off.status_code, status.HTTP_200_OK)
        latest_off = res_off.data['status_history'][0]
        self.assertEqual(latest_off['changed_by'], self.official_a.id)
        self.assertEqual(latest_off['remarks'], 'Approved for collection')

    def test_10_reportless_confirmation_works_without_500(self):
        """10. Standalone confirmations without a report succeed with 201 Created."""
        self.client.force_authenticate(user=self.watcher_a)
        res = self.client.post('/api/watcher/confirmations/', {
            'latitude': 13.931200,
            'longitude': 121.612300,
            'notes': 'Routine street collection',
        })
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['barangay'], self.brgy_a.id)
        self.assertIsNone(res.data['report'])

    def test_11_state_machine_transition_validation(self):
        """11. State machine validation prevents invalid source transitions and scope breaches."""
        rep_resolved = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.RESOLVED,
            resolved_at=timezone.now(),
        )
        rep_rejected = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.REJECTED,
            rejection_reason='Not valid',
        )

        self.client.force_authenticate(user=self.official_a)

        # Cannot directly approve a resolved report (must reopen)
        res_app_res = self.client.post(f'/api/watcher/reports/{rep_resolved.id}/approve/')
        self.assertEqual(res_app_res.status_code, status.HTTP_400_BAD_REQUEST)

        # Cannot directly approve a rejected report (must reopen)
        res_app_rej = self.client.post(f'/api/watcher/reports/{rep_rejected.id}/approve/')
        self.assertEqual(res_app_rej.status_code, status.HTTP_400_BAD_REQUEST)

        # Cannot directly reject a resolved report
        res_rej_res = self.client.post(f'/api/watcher/reports/{rep_resolved.id}/reject/', {'rejection_reason': 'Late reject'})
        self.assertEqual(res_rej_res.status_code, status.HTTP_400_BAD_REQUEST)

        # Foreign barangay official cannot approve reports outside their barangay
        self.client.force_authenticate(user=self.official_b)
        rep_pending = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.PENDING,
        )
        res_foreign_app = self.client.post(f'/api/watcher/reports/{rep_pending.id}/approve/')
        self.assertEqual(res_foreign_app.status_code, status.HTTP_403_FORBIDDEN)

        # Foreign watcher cannot confirm reports outside their barangay (gets 403 or 404, not status leak)
        self.client.force_authenticate(user=self.official_b)  # official_b is brgy_b
        res_foreign_conf = self.client.post('/api/watcher/confirmations/', {'report': rep_pending.id})
        self.assertIn(res_foreign_conf.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND])

    def test_12_existing_approved_owner_visibility_remains_intact(self):
        """12. Report owner can privately view rejected and archived reports; public cannot."""
        rep_archived = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.REJECTED,
            is_archived=True, description='Private archived issue',
        )

        # Owner can view
        self.client.force_authenticate(user=self.owner)
        res_owner = self.client.get(f'/api/watcher/reports/{rep_archived.id}/')
        self.assertEqual(res_owner.status_code, status.HTTP_200_OK)

        # Other citizen cannot view
        self.client.force_authenticate(user=self.other_citizen)
        res_other = self.client.get(f'/api/watcher/reports/{rep_archived.id}/')
        self.assertEqual(res_other.status_code, status.HTTP_404_NOT_FOUND)

        # Anonymous caller cannot view
        self.client.logout()
        res_anon = self.client.get(f'/api/watcher/reports/{rep_archived.id}/')
        self.assertEqual(res_anon.status_code, status.HTTP_404_NOT_FOUND)


class Step40A10BackendCorrectionsTests(TestCase):
    """
    Focused regression test suite verifying Step 4.0A.10 Final Backend Corrections (D1 - D8).
    """

    def setUp(self):
        self.client = APIClient()
        self.brgy_a = Barangay.objects.create(name='Barangay Alpha')
        self.brgy_b = Barangay.objects.create(name='Barangay Beta')


        self.admin = User.objects.create_user(
            username='admin_user_10', email='admin10@wastewatch.org',
            password='Password123!', role='admin', is_staff=True,
        )
        self.official_a = User.objects.create_user(
            username='official_a_10', email='official_a10@wastewatch.org',
            password='Password123!', role='brgy_official', barangay=self.brgy_a,
        )
        self.official_b = User.objects.create_user(
            username='official_b_10', email='official_b10@wastewatch.org',
            password='Password123!', role='brgy_official', barangay=self.brgy_b,
        )
        self.official_no_brgy = User.objects.create_user(
            username='official_no_brgy_10', email='nobrgy10@wastewatch.org',
            password='Password123!', role='brgy_official', barangay=None,
        )
        self.watcher_a = User.objects.create_user(
            username='watcher_a_10', email='watcher_a10@wastewatch.org',
            password='Password123!', role='watcher', barangay=self.brgy_a,
        )
        self.driver_user = User.objects.create_user(
            username='driver_user_10', email='driver10@wastewatch.org',
            password='Password123!', role='driver',
        )
        self.owner = User.objects.create_user(
            username='citizen_owner_10', email='owner10@wastewatch.org',
            password='Password123!', role='citizen',
        )

        from driver.models import Truck, TruckStatus
        self.truck = Truck.objects.create(
            plate_number='QC-9999', model='Isuzu Giga',
            status=TruckStatus.ACTIVE,
        )


    def test_d1_hotspot_reactivation_clears_stale_dispatch_and_cluster_ids_excludes_inactive(self):
        """D1: Reactivated hotspot clears stale dispatch fields; get_cluster_ids excludes inactive."""
        from watcher.views import get_cluster_ids

        # Create report and approve to create hotspot
        report = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.PENDING,
            latitude=13.931100, longitude=121.612200,
        )
        self.client.force_authenticate(user=self.official_a)
        res_app = self.client.post(f'/api/watcher/reports/{report.id}/approve/')
        self.assertEqual(res_app.status_code, status.HTTP_200_OK)

        hotspot = GarbageHotspot.objects.get(source_report=report)
        self.assertTrue(hotspot.is_active)

        # Simulate truck assignment on the hotspot
        hotspot.assigned_truck = self.truck
        hotspot.dispatch_acknowledged = False
        hotspot.dispatched_at = timezone.now()
        hotspot.save()

        # Reject the report (retires the hotspot)
        res_rej = self.client.post(f'/api/watcher/reports/{report.id}/reject/', {'rejection_reason': 'Temporary reject'})
        self.assertEqual(res_rej.status_code, status.HTTP_200_OK)

        hotspot.refresh_from_db()
        self.assertFalse(hotspot.is_active)

        # Check get_cluster_ids excludes the inactive hotspot
        cluster = get_cluster_ids(hotspot.latitude, hotspot.longitude, radius_m=15)
        self.assertNotIn(hotspot.id, cluster)

        # Reopen report to PENDING
        res_reopen = self.client.post(f'/api/watcher/reports/{report.id}/reopen/', {'remarks': 'Reopened for investigation'})
        self.assertEqual(res_reopen.status_code, status.HTTP_200_OK)

        # Re-approve the report -> reactivates the hotspot
        res_app2 = self.client.post(f'/api/watcher/reports/{report.id}/approve/')
        self.assertEqual(res_app2.status_code, status.HTTP_200_OK)

        hotspot.refresh_from_db()
        self.assertTrue(hotspot.is_active)
        self.assertIsNone(hotspot.assigned_truck)
        self.assertTrue(hotspot.dispatch_acknowledged)
        self.assertIsNone(hotspot.dispatched_at)

    def test_d2_prevent_destructive_report_deletion(self):
        """D2: Prevent permanent deletion of reports with operational history (returns 409 Conflict)."""
        report = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.PENDING,
            latitude=13.931100, longitude=121.612200,
        )
        record_report_status_transition(report, ReportStatus.APPROVED, changed_by=self.admin, remarks='Initial approval')
        record_report_status_transition(report, ReportStatus.RESOLVED, changed_by=self.admin, remarks='Resolved')


        hotspot = GarbageHotspot.objects.create(
            source_report=report, name='Hotspot with history',
            latitude=13.931100, longitude=121.612200, barangay=self.brgy_a, is_active=True,
        )
        from watcher.models import HotspotIntervention, InterventionType, InterventionStatus
        HotspotIntervention.objects.create(
            hotspot=hotspot, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.COLLECTED, truck=self.truck,
        )

        self.client.force_authenticate(user=self.admin)
        res_del = self.client.delete(f'/api/watcher/reports/{report.id}/')
        self.assertEqual(res_del.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(GarbageReport.objects.filter(id=report.id).exists())

    def test_d3_barangay_less_official_moderation(self):
        """D3: Barangay officials without barangay cannot moderate; admins can moderate barangay-less reports."""
        rep_no_brgy = GarbageReport.objects.create(
            user=self.owner, barangay=None, status=ReportStatus.PENDING,
        )
        rep_brgy_a = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.PENDING,
        )

        # 1. Official with no barangay attempting to moderate barangay-less report -> 403
        self.client.force_authenticate(user=self.official_no_brgy)
        res1 = self.client.post(f'/api/watcher/reports/{rep_no_brgy.id}/approve/')
        self.assertEqual(res1.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Official with no barangay attempting to moderate report with barangay -> 403
        res2 = self.client.post(f'/api/watcher/reports/{rep_brgy_a.id}/approve/')
        self.assertEqual(res2.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Official in Barangay B attempting to moderate report in Barangay A -> 403
        self.client.force_authenticate(user=self.official_b)
        res3 = self.client.post(f'/api/watcher/reports/{rep_brgy_a.id}/approve/')
        self.assertEqual(res3.status_code, status.HTTP_403_FORBIDDEN)

        # 4. Admin moderating barangay-less report -> 200 OK
        self.client.force_authenticate(user=self.admin)
        res4 = self.client.post(f'/api/watcher/reports/{rep_no_brgy.id}/approve/')
        self.assertEqual(res4.status_code, status.HTTP_200_OK)

    def test_d4_cluster_dispatch_reanchoring_and_cancellation(self):
        """D4: Dispatch is safely re-anchored when anchor is retired with active peers; cancelled when none remain."""
        from watcher.services import retire_hotspot_and_cancel_active_dispatches
        from watcher.models import HotspotIntervention, InterventionType, InterventionStatus

        h1 = GarbageHotspot.objects.create(
            name='Hotspot 1 (Anchor)', latitude=13.931000, longitude=121.612000,
            barangay=self.brgy_a, is_active=True, assigned_truck=self.truck,
        )
        # Hotspot 2 is ~11 meters away (within 15m radius)
        h2 = GarbageHotspot.objects.create(
            name='Hotspot 2 (Peer)', latitude=13.931050, longitude=121.612050,
            barangay=self.brgy_a, is_active=True, assigned_truck=self.truck,
        )

        intervention = HotspotIntervention.objects.create(
            hotspot=h1, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.CREATED, truck=self.truck,
        )

        # Retire h1 (anchor): h2 remains active, so intervention is re-anchored to h2
        retire_hotspot_and_cancel_active_dispatches(h1, cancelled_by=self.admin, reason='Report 1 resolved')

        h1.refresh_from_db()
        h2.refresh_from_db()
        intervention.refresh_from_db()

        self.assertFalse(h1.is_active)
        self.assertIsNone(h1.assigned_truck)
        self.assertTrue(h2.is_active)
        self.assertEqual(h2.assigned_truck, self.truck)
        self.assertEqual(intervention.hotspot, h2)
        self.assertEqual(intervention.status, InterventionStatus.CREATED)

        # Retire h2: no active targets remain in cluster -> intervention is cancelled
        retire_hotspot_and_cancel_active_dispatches(h2, cancelled_by=self.admin, reason='Report 2 resolved')

        h2.refresh_from_db()
        intervention.refresh_from_db()

        self.assertFalse(h2.is_active)
        self.assertIsNone(h2.assigned_truck)
        self.assertEqual(intervention.status, InterventionStatus.CANCELLED)

    def test_d5_status_transition_helper_atomic_and_no_op_rejection(self):
        """D5: record_report_status_transition rejects no-ops and clears approval state on reopen."""
        report = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.PENDING,
        )

        # Transition PENDING -> APPROVED
        record_report_status_transition(report, ReportStatus.APPROVED, changed_by=self.admin, remarks='Approved')
        self.assertEqual(report.status, ReportStatus.APPROVED)
        self.assertIsNotNone(report.approved_at)
        self.assertEqual(report.approved_by, self.admin)

        # Duplicate transition APPROVED -> APPROVED raises ValueError
        with self.assertRaises(ValueError):
            record_report_status_transition(report, ReportStatus.APPROVED, changed_by=self.admin, remarks='No-op')

        # Transition APPROVED -> PENDING clears approved_at and approved_by
        record_report_status_transition(report, ReportStatus.PENDING, changed_by=self.admin, remarks='Reopened')
        self.assertEqual(report.status, ReportStatus.PENDING)
        self.assertIsNone(report.approved_at)
        self.assertIsNone(report.approved_by)

    def test_d6_confirmation_error_leaks_and_malformed_input(self):
        """D6: CollectionConfirmation validates malformed report inputs and prevents cross-barangay discovery."""
        self.client.force_authenticate(user=self.watcher_a)

        # Malformed list input
        res_list = self.client.post('/api/watcher/confirmations/', {'report': [1, 2, 3]}, format='json')
        self.assertEqual(res_list.status_code, status.HTTP_400_BAD_REQUEST)

        # Malformed dict input
        res_dict = self.client.post('/api/watcher/confirmations/', {'report': {'id': 1}}, format='json')
        self.assertEqual(res_dict.status_code, status.HTTP_400_BAD_REQUEST)


        # Report belonging to another barangay returns 403 (checked before status to avoid leaking report status)
        rep_foreign = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_b, status=ReportStatus.APPROVED,
        )
        res_foreign = self.client.post('/api/watcher/confirmations/', {'report': rep_foreign.id})
        self.assertEqual(res_foreign.status_code, status.HTTP_403_FORBIDDEN)


        # Unapproved report in same barangay returns 400 without leaking status
        rep_unapproved = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.PENDING,
        )
        res_unapproved = self.client.post('/api/watcher/confirmations/', {'report': rep_unapproved.id})
        self.assertEqual(res_unapproved.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_unapproved.data.get('detail'), "Report must be in 'approved' status to confirm collection.")

    def test_d8_lifecycle_durations_and_driver_sanitization(self):
        """D8: time_to_approval semantics and HotspotInterventionSerializer masking for drivers."""
        report = GarbageReport.objects.create(
            user=self.owner, barangay=self.brgy_a, status=ReportStatus.PENDING,
        )
        # When PENDING, time_to_approval is None
        self.assertIsNone(report.time_to_approval)

        # When APPROVED, time_to_approval is computed
        record_report_status_transition(report, ReportStatus.APPROVED, changed_by=self.official_a, remarks='Approved')
        report.refresh_from_db()
        self.assertIsNotNone(report.time_to_approval)

        # When reopened to PENDING, time_to_approval becomes None again
        record_report_status_transition(report, ReportStatus.PENDING, changed_by=self.official_a, remarks='Reopened')
        report.refresh_from_db()
        self.assertIsNone(report.time_to_approval)

        # Driver intervention serialization masks staff names and internal moderation remarks
        hotspot = GarbageHotspot.objects.create(
            name='Hotspot Test', latitude=13.931000, longitude=121.612000,
            barangay=self.brgy_a, is_active=True,
        )
        from watcher.models import HotspotIntervention, InterventionType, InterventionStatus
        from watcher.serializers import HotspotInterventionSerializer

        intervention = HotspotIntervention.objects.create(
            hotspot=hotspot, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.CANCELLED, truck=self.truck,
            created_by=self.admin, resolved_by=self.official_a,
            resolution_notes="Report rejected: Inappropriate offensive content in submission",
        )

        from django.test.client import RequestFactory
        factory = RequestFactory()
        req = factory.get('/')
        req.user = self.driver_user

        serializer = HotspotInterventionSerializer(intervention, context={'request': req})
        data = serializer.data

        self.assertIsNone(data['created_by'])
        self.assertEqual(data['created_by_name'], '')
        self.assertIsNone(data['resolved_by'])
        self.assertEqual(data['resolved_by_name'], '')
        self.assertEqual(data['resolution_notes'], 'Dispatch cancelled by operations.')


class Step40A11ABackendCorrectionsTests(TestCase):
    """
    Step 4.0A.11A: Preserve Collection Confirmation Records.
    Ensures that CollectionConfirmation records survive user account deletion with SET_NULL,
    their report relationships remain intact, and existing behavior is preserved when users exist.
    """
    def setUp(self):
        from watcher.serializers import CollectionConfirmationSerializer
        self.CollectionConfirmationSerializer = CollectionConfirmationSerializer
        self.client = APIClient()
        self.barangay = Barangay.objects.create(name='Barangay A', population=1000)
        self.admin = User.objects.create_superuser(
            username='admin_user_11a', email='admin_11a@example.com',
            password='Password123!', role='admin',
        )
        self.watcher = User.objects.create_user(
            username='watcher_user_11a', email='watcher_11a@example.com',
            password='Password123!', role='watcher', barangay=self.barangay,
            full_name='Watcher Tester',
        )
        self.citizen = User.objects.create_user(
            username='citizen_user_11a', email='citizen_11a@example.com',
            password='Password123!', role='citizen', barangay=self.barangay,
        )
        self.report = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.barangay,
            status=ReportStatus.APPROVED,
            latitude=13.931000,
            longitude=121.612000,
            address='Test Address',
        )

    def test_confirmation_survives_user_deletion(self):
        """Confirm that a confirmation remains after its confirming user is deleted and report relationship stays intact."""
        conf = CollectionConfirmation.objects.create(
            confirmed_by=self.watcher,
            barangay=self.barangay,
            report=self.report,
            notes='Collection completed successfully',
            latitude=13.931000,
            longitude=121.612000,
        )
        conf_id = conf.id
        self.assertEqual(conf.confirmed_by, self.watcher)
        self.assertEqual(conf.report, self.report)
        self.assertIn('Watcher Tester', str(conf))

        # Delete the confirming user
        self.watcher.delete()

        # Confirmation must still exist in the database
        conf.refresh_from_db()
        self.assertEqual(conf.id, conf_id)
        self.assertIsNone(conf.confirmed_by)
        self.assertEqual(conf.report, self.report)
        self.assertEqual(conf.report.id, self.report.id)
        self.assertEqual(conf.notes, 'Collection completed successfully')

        # __str__ must handle None confirmed_by gracefully without raising AttributeError
        self.assertIn('Deleted User', str(conf))

        # Serializer handles None confirmed_by safely
        serializer = self.CollectionConfirmationSerializer(conf)
        self.assertIsNone(serializer.data['confirmed_by'])
        self.assertIsNone(serializer.data['confirmed_by_name'])
        self.assertEqual(serializer.data['report'], self.report.id)
        self.assertEqual(serializer.data['barangay'], self.barangay.id)

        # API view access by admin or authorized personnel continues to work safely
        self.client.force_authenticate(user=self.admin)
        res = self.client.get(f'/api/watcher/confirmations/{conf.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIsNone(res.data['confirmed_by'])
        self.assertIsNone(res.data['confirmed_by_name'])
        self.assertEqual(res.data['report'], self.report.id)

    def test_existing_confirmation_behavior_unchanged_when_user_exists(self):
        """Confirm that normal creation, retrieval, and serialization are unchanged when user exists."""
        self.client.force_authenticate(user=self.watcher)
        res = self.client.post('/api/watcher/confirmations/', {
            'report': self.report.id,
            'notes': 'Normal confirmation',
        })
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['confirmed_by'], self.watcher.id)
        self.assertEqual(res.data['confirmed_by_name'], 'Watcher Tester')
        self.assertEqual(res.data['report'], self.report.id)

        conf = CollectionConfirmation.objects.get(id=res.data['id'])
        self.assertEqual(conf.confirmed_by, self.watcher)
        self.assertEqual(conf.report, self.report)
        self.assertIn('Watcher Tester', str(conf))


class Step40A11CClusterDispatchTests(TestCase):
    """
    Step 4.0A.11C: Cluster-wide Dispatch Re-anchoring Regression Tests.
    Ensures that active dispatches anywhere in the cluster are detected and maintained across
    hotspot deactivation, even when the dispatch is attached to a non-anchor peer.
    """
    def setUp(self):
        self.client = APIClient()
        self.barangay = Barangay.objects.create(name='Barangay C', population=2000)
        self.admin = User.objects.create_superuser(
            username='admin_11c', email='admin_11c@example.com',
            password='Password123!', role='admin',
        )
        from driver.models import Truck, TruckStatus
        self.truck = Truck.objects.create(
            plate_number='TRK-11C', model='Isuzu Forward',
            status=TruckStatus.ACTIVE,
        )

    def test_active_dispatch_attached_to_lowest_id_remaining_hotspot(self):
        """Active dispatch attached to the lowest-ID remaining hotspot is preserved."""
        from watcher.services import retire_hotspot_and_cancel_active_dispatches
        from watcher.models import HotspotIntervention, InterventionType, InterventionStatus

        h_retire = GarbageHotspot.objects.create(
            name='Hotspot Retire', latitude=13.931000, longitude=121.612000,
            barangay=self.barangay, is_active=True,
        )
        h_lowest = GarbageHotspot.objects.create(
            name='Hotspot Lowest ID', latitude=13.931050, longitude=121.612050,
            barangay=self.barangay, is_active=True, assigned_truck=self.truck,
        )
        h_other = GarbageHotspot.objects.create(
            name='Hotspot Other Peer', latitude=13.931080, longitude=121.612080,
            barangay=self.barangay, is_active=True, assigned_truck=None,
        )

        # Dispatch attached to h_lowest (lowest ID remaining)
        dispatch = HotspotIntervention.objects.create(
            hotspot=h_lowest, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.CREATED, truck=self.truck,
        )

        retire_hotspot_and_cancel_active_dispatches(h_retire, cancelled_by=self.admin, reason='Retiring primary')

        h_retire.refresh_from_db()
        h_lowest.refresh_from_db()
        h_other.refresh_from_db()
        dispatch.refresh_from_db()

        self.assertFalse(h_retire.is_active)
        self.assertIsNone(h_retire.assigned_truck)
        self.assertEqual(dispatch.status, InterventionStatus.CREATED)
        self.assertEqual(dispatch.hotspot, h_lowest)
        self.assertEqual(h_lowest.assigned_truck, self.truck)
        self.assertEqual(h_other.assigned_truck, self.truck)

    def test_active_dispatch_attached_to_different_remaining_hotspot(self):
        """
        Active dispatch attached to a different remaining hotspot (NOT the lowest-ID anchor).
        Proves that dispatch detection inspects the entire cluster, because the lowest-ID
        hotspot starts with assigned_truck=None and gets updated to the dispatch truck.
        """
        from watcher.services import retire_hotspot_and_cancel_active_dispatches
        from watcher.models import HotspotIntervention, InterventionType, InterventionStatus

        h_retire = GarbageHotspot.objects.create(
            name='Hotspot Retire', latitude=13.931000, longitude=121.612000,
            barangay=self.barangay, is_active=True,
        )
        # h_lowest has lower ID than h_other, but has NO truck initially
        h_lowest = GarbageHotspot.objects.create(
            name='Hotspot Lowest ID (Anchor)', latitude=13.931050, longitude=121.612050,
            barangay=self.barangay, is_active=True, assigned_truck=None,
        )
        # h_other has higher ID, and HAS the active dispatch
        h_other = GarbageHotspot.objects.create(
            name='Hotspot Other Peer (With Dispatch)', latitude=13.931080, longitude=121.612080,
            barangay=self.barangay, is_active=True, assigned_truck=self.truck,
        )

        # Dispatch is on h_other, NOT on h_lowest
        dispatch = HotspotIntervention.objects.create(
            hotspot=h_other, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.ACKNOWLEDGED, truck=self.truck,
        )

        # Before retirement: h_lowest has NO assigned truck
        self.assertIsNone(h_lowest.assigned_truck)

        # Retire h_retire
        retire_hotspot_and_cancel_active_dispatches(h_retire, cancelled_by=self.admin, reason='Retiring anchor')

        h_retire.refresh_from_db()
        h_lowest.refresh_from_db()
        h_other.refresh_from_db()
        dispatch.refresh_from_db()

        self.assertFalse(h_retire.is_active)
        self.assertIsNone(h_retire.assigned_truck)
        # The dispatch on h_other is preserved
        self.assertEqual(dispatch.status, InterventionStatus.ACKNOWLEDGED)
        self.assertEqual(dispatch.hotspot, h_other)
        # Crucial check: h_lowest was updated with the cluster's active dispatch truck!
        self.assertEqual(h_lowest.assigned_truck, self.truck)
        self.assertTrue(h_lowest.dispatch_acknowledged)
        # h_other keeps the truck
        self.assertEqual(h_other.assigned_truck, self.truck)

    def test_flag_only_historical_intervention(self):
        """FLAG-only interventions are preserved without being treated as active truck dispatches."""
        from watcher.services import retire_hotspot_and_cancel_active_dispatches
        from watcher.models import HotspotIntervention, InterventionType, InterventionStatus

        h_retire = GarbageHotspot.objects.create(
            name='Hotspot Retire', latitude=13.931000, longitude=121.612000,
            barangay=self.barangay, is_active=True,
        )
        h_lowest = GarbageHotspot.objects.create(
            name='Hotspot Lowest ID', latitude=13.931050, longitude=121.612050,
            barangay=self.barangay, is_active=True, assigned_truck=None,
        )
        h_other = GarbageHotspot.objects.create(
            name='Hotspot Other Peer', latitude=13.931080, longitude=121.612080,
            barangay=self.barangay, is_active=True, assigned_truck=None,
        )

        # Create a FLAG-only intervention
        flag = HotspotIntervention.objects.create(
            hotspot=h_other, intervention_type=InterventionType.FLAG,
            status=InterventionStatus.FLAGGED, truck=None,
        )

        retire_hotspot_and_cancel_active_dispatches(h_retire, cancelled_by=self.admin, reason='Retiring')

        h_retire.refresh_from_db()
        h_lowest.refresh_from_db()
        h_other.refresh_from_db()
        flag.refresh_from_db()

        self.assertFalse(h_retire.is_active)
        # FLAG must NOT be treated as a truck dispatch
        self.assertIsNone(h_lowest.assigned_truck)
        self.assertIsNone(h_other.assigned_truck)
        # The FLAG intervention itself remains active and intact
        self.assertEqual(flag.status, InterventionStatus.FLAGGED)
        self.assertEqual(flag.hotspot, h_other)

    def test_mixed_flag_and_active_dispatch_interventions(self):
        """Mixed FLAG and active DISPATCH: FLAG is preserved and DISPATCH truck assignment is applied."""
        from watcher.services import retire_hotspot_and_cancel_active_dispatches
        from watcher.models import HotspotIntervention, InterventionType, InterventionStatus

        h_retire = GarbageHotspot.objects.create(
            name='Hotspot Retire', latitude=13.931000, longitude=121.612000,
            barangay=self.barangay, is_active=True,
        )
        h_lowest = GarbageHotspot.objects.create(
            name='Hotspot Lowest ID', latitude=13.931050, longitude=121.612050,
            barangay=self.barangay, is_active=True, assigned_truck=None,
        )
        h_other = GarbageHotspot.objects.create(
            name='Hotspot Other Peer', latitude=13.931080, longitude=121.612080,
            barangay=self.barangay, is_active=True, assigned_truck=None,
        )

        # h_lowest has a FLAG intervention
        flag = HotspotIntervention.objects.create(
            hotspot=h_lowest, intervention_type=InterventionType.FLAG,
            status=InterventionStatus.FLAGGED, truck=None,
        )
        # h_other has an active DISPATCH intervention
        dispatch = HotspotIntervention.objects.create(
            hotspot=h_other, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.CREATED, truck=self.truck,
        )

        retire_hotspot_and_cancel_active_dispatches(h_retire, cancelled_by=self.admin, reason='Retiring')

        h_lowest.refresh_from_db()
        h_other.refresh_from_db()
        flag.refresh_from_db()
        dispatch.refresh_from_db()

        # Both remaining hotspots get the dispatch truck
        self.assertEqual(h_lowest.assigned_truck, self.truck)
        self.assertEqual(h_other.assigned_truck, self.truck)
        # Both interventions keep their respective types and statuses
        self.assertEqual(flag.status, InterventionStatus.FLAGGED)
        self.assertEqual(dispatch.status, InterventionStatus.CREATED)

    def test_no_active_dispatch_anywhere_in_remaining_cluster(self):
        """When no active dispatch exists anywhere in the cluster, truck assignments are cleared."""
        from watcher.services import retire_hotspot_and_cancel_active_dispatches

        h_retire = GarbageHotspot.objects.create(
            name='Hotspot Retire', latitude=13.931000, longitude=121.612000,
            barangay=self.barangay, is_active=True,
        )
        # Simulate a stale truck assignment on a remaining hotspot with no active intervention
        h_lowest = GarbageHotspot.objects.create(
            name='Hotspot Lowest ID', latitude=13.931050, longitude=121.612050,
            barangay=self.barangay, is_active=True, assigned_truck=self.truck,
        )
        h_other = GarbageHotspot.objects.create(
            name='Hotspot Other Peer', latitude=13.931080, longitude=121.612080,
            barangay=self.barangay, is_active=True, assigned_truck=self.truck,
        )

        retire_hotspot_and_cancel_active_dispatches(h_retire, cancelled_by=self.admin, reason='Retiring')

        h_retire.refresh_from_db()
        h_lowest.refresh_from_db()
        h_other.refresh_from_db()

        self.assertFalse(h_retire.is_active)
        self.assertIsNone(h_retire.assigned_truck)
        self.assertIsNone(h_lowest.assigned_truck)
        self.assertIsNone(h_other.assigned_truck)

    def test_final_hotspot_deactivation_with_no_remaining_active_hotspot(self):
        """Deactivating the final hotspot in a cluster cancels all open interventions."""
        from watcher.services import retire_hotspot_and_cancel_active_dispatches
        from watcher.models import HotspotIntervention, InterventionType, InterventionStatus

        h_solo = GarbageHotspot.objects.create(
            name='Hotspot Solo', latitude=13.931000, longitude=121.612000,
            barangay=self.barangay, is_active=True, assigned_truck=self.truck,
        )
        dispatch = HotspotIntervention.objects.create(
            hotspot=h_solo, intervention_type=InterventionType.DISPATCH,
            status=InterventionStatus.CREATED, truck=self.truck,
        )
        flag = HotspotIntervention.objects.create(
            hotspot=h_solo, intervention_type=InterventionType.FLAG,
            status=InterventionStatus.FLAGGED, truck=None,
        )

        retire_hotspot_and_cancel_active_dispatches(h_solo, cancelled_by=self.admin, reason='Last hotspot retired')

        h_solo.refresh_from_db()
        dispatch.refresh_from_db()
        flag.refresh_from_db()

        self.assertFalse(h_solo.is_active)
        self.assertIsNone(h_solo.assigned_truck)
        self.assertEqual(dispatch.status, InterventionStatus.CANCELLED)
        self.assertIn('Last hotspot retired', dispatch.resolution_notes)
        self.assertEqual(flag.status, InterventionStatus.CANCELLED)
        self.assertIn('Last hotspot retired', flag.resolution_notes)


class Step40A11DValidationTests(TestCase):
    """
    Focused regression test suite for Step 4.0A.11D:
    Input validation, non-dict payloads, type guards, identifier parsing,
    and consistent error responses across report and confirmation endpoints.
    """

    def setUp(self):
        self.client = APIClient()
        self.brgy_a = Barangay.objects.create(name='Barangay Alpha 11D')
        self.brgy_b = Barangay.objects.create(name='Barangay Beta 11D')

        self.admin = User.objects.create_user(
            username='admin_11d', email='admin11d@wastewatch.org',
            password='Password123!', role='admin', is_staff=True,
        )
        self.official_a = User.objects.create_user(
            username='official_a_11d', email='official_a11d@wastewatch.org',
            password='Password123!', role='brgy_official', barangay=self.brgy_a,
        )
        self.official_b = User.objects.create_user(
            username='official_b_11d', email='official_b11d@wastewatch.org',
            password='Password123!', role='brgy_official', barangay=self.brgy_b,
        )
        self.watcher_a = User.objects.create_user(
            username='watcher_a_11d', email='watcher_a11d@wastewatch.org',
            password='Password123!', role='watcher', barangay=self.brgy_a,
        )
        self.watcher_b = User.objects.create_user(
            username='watcher_b_11d', email='watcher_b11d@wastewatch.org',
            password='Password123!', role='watcher', barangay=self.brgy_b,
        )
        self.citizen_a = User.objects.create_user(
            username='citizen_a_11d', email='citizen_a11d@wastewatch.org',
            password='Password123!', role='citizen',
        )
        self.citizen_b = User.objects.create_user(
            username='citizen_b_11d', email='citizen_b11d@wastewatch.org',
            password='Password123!', role='citizen',
        )

    def test_reject_validation_missing_and_numeric_and_malformed_reason(self):
        report = GarbageReport.objects.create(
            user=self.citizen_a, barangay=self.brgy_a, status=ReportStatus.PENDING,
            description='Report to reject',
        )
        self.client.force_authenticate(user=self.official_a)

        # Missing reason
        res_missing = self.client.post(f'/api/watcher/reports/{report.id}/reject/', {}, format='json')
        self.assertEqual(res_missing.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_missing.data.get('rejection_reason'), 'This field is required.')

        # Numeric reason
        res_num = self.client.post(f'/api/watcher/reports/{report.id}/reject/', {'rejection_reason': 12345}, format='json')
        self.assertEqual(res_num.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_num.data.get('rejection_reason'), 'Rejection reason must be a string.')

        # Boolean reason
        res_bool = self.client.post(f'/api/watcher/reports/{report.id}/reject/', {'rejection_reason': True}, format='json')
        self.assertEqual(res_bool.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_bool.data.get('rejection_reason'), 'Rejection reason must be a string.')

        # List reason
        res_list = self.client.post(f'/api/watcher/reports/{report.id}/reject/', {'rejection_reason': ['invalid']}, format='json')
        self.assertEqual(res_list.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_list.data.get('rejection_reason'), 'Rejection reason must be a string.')

        # Whitespace-only reason
        res_ws = self.client.post(f'/api/watcher/reports/{report.id}/reject/', {'rejection_reason': '    '}, format='json')
        self.assertEqual(res_ws.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_ws.data.get('rejection_reason'), 'This field is required.')

        # Valid string reason succeeds
        res_valid = self.client.post(f'/api/watcher/reports/{report.id}/reject/', {'rejection_reason': 'Duplicate report'}, format='json')
        self.assertEqual(res_valid.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, ReportStatus.REJECTED)
        self.assertEqual(report.rejection_reason, 'Duplicate report')

    def test_reopen_validation_non_string_remarks_and_defaults(self):
        report = GarbageReport.objects.create(
            user=self.citizen_a, barangay=self.brgy_a, status=ReportStatus.REJECTED,
            rejection_reason='Duplicate report',
        )
        self.client.force_authenticate(user=self.official_a)

        # Numeric remarks
        res_num = self.client.post(f'/api/watcher/reports/{report.id}/reopen/', {'remarks': 999}, format='json')
        self.assertEqual(res_num.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_num.data.get('remarks'), 'Remarks must be a string.')

        # Boolean remarks
        res_bool = self.client.post(f'/api/watcher/reports/{report.id}/reopen/', {'remarks': False}, format='json')
        self.assertEqual(res_bool.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_bool.data.get('remarks'), 'Remarks must be a string.')

        # List remarks
        res_list = self.client.post(f'/api/watcher/reports/{report.id}/reopen/', {'remarks': ['note']}, format='json')
        self.assertEqual(res_list.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_list.data.get('remarks'), 'Remarks must be a string.')

        # Valid string remarks succeeds
        res_valid = self.client.post(f'/api/watcher/reports/{report.id}/reopen/', {'remarks': 'Reopening for reinvestigation'}, format='json')
        self.assertEqual(res_valid.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, ReportStatus.PENDING)

        # Reopen with empty payload defaults remarks safely
        report.status = ReportStatus.RESOLVED
        report.save()
        res_default = self.client.post(f'/api/watcher/reports/{report.id}/reopen/', {}, format='json')
        self.assertEqual(res_default.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, ReportStatus.PENDING)

    def test_non_dictionary_request_bodies(self):
        report = GarbageReport.objects.create(
            user=self.citizen_a, barangay=self.brgy_a, status=ReportStatus.PENDING,
        )
        self.client.force_authenticate(user=self.admin)

        # Non-dict bodies to actions return 400 instead of 500
        res_reject = self.client.post(f'/api/watcher/reports/{report.id}/reject/', [1, 2, 3], format='json')
        self.assertEqual(res_reject.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Invalid request body', res_reject.data.get('error', ''))

        res_reopen = self.client.post(f'/api/watcher/reports/{report.id}/reopen/', [1, 2, 3], format='json')
        self.assertEqual(res_reopen.status_code, status.HTTP_400_BAD_REQUEST)

        res_approve = self.client.post(f'/api/watcher/reports/{report.id}/approve/', ['invalid'], format='json')
        self.assertEqual(res_approve.status_code, status.HTTP_400_BAD_REQUEST)

        res_archive = self.client.post(f'/api/watcher/reports/{report.id}/archive/', 'invalid_string', format='json')
        self.assertEqual(res_archive.status_code, status.HTTP_400_BAD_REQUEST)

        self.client.force_authenticate(user=self.citizen_a)
        res_vote = self.client.post(f'/api/watcher/reports/{report.id}/vote/', [1], format='json')
        self.assertEqual(res_vote.status_code, status.HTTP_400_BAD_REQUEST)

        self.client.force_authenticate(user=self.watcher_a)
        res_conf = self.client.post('/api/watcher/confirmations/', [1, 2, 3], format='json')
        self.assertEqual(res_conf.status_code, status.HTTP_400_BAD_REQUEST)

    def test_negative_zero_decimal_malformed_and_long_ids(self):
        self.client.force_authenticate(user=self.admin)

        invalid_ids = ['-1', '0', '1.5', 'abc', '99999999999999999999999999999999999999999999999999999999']

        for invalid_id in invalid_ids:
            # Report lookup
            res_rep = self.client.get(f'/api/watcher/reports/{invalid_id}/')
            self.assertEqual(res_rep.status_code, status.HTTP_404_NOT_FOUND)

            # Report detail actions
            res_app = self.client.post(f'/api/watcher/reports/{invalid_id}/approve/')
            self.assertEqual(res_app.status_code, status.HTTP_404_NOT_FOUND)

            res_rej = self.client.post(f'/api/watcher/reports/{invalid_id}/reject/', {'rejection_reason': 'test'})
            self.assertEqual(res_rej.status_code, status.HTTP_404_NOT_FOUND)

            res_reopen = self.client.post(f'/api/watcher/reports/{invalid_id}/reopen/')
            self.assertEqual(res_reopen.status_code, status.HTTP_404_NOT_FOUND)

            res_archive = self.client.post(f'/api/watcher/reports/{invalid_id}/archive/')
            self.assertEqual(res_archive.status_code, status.HTTP_404_NOT_FOUND)

            # Confirmation lookup
            res_conf_get = self.client.get(f'/api/watcher/confirmations/{invalid_id}/')
            self.assertEqual(res_conf_get.status_code, status.HTTP_404_NOT_FOUND)

        # Confirmation creation payload with invalid report ID formats
        for bad_report_id in [-1, 0, 1.5, 'abc', '99999999999999999999999999999999999999999999999999999999']:
            res_conf_post = self.client.post('/api/watcher/confirmations/', {'report': bad_report_id}, format='json')
            self.assertEqual(res_conf_post.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn('report', res_conf_post.data)

    def test_vote_identifier_and_type_validation(self):
        report = GarbageReport.objects.create(
            user=self.citizen_a, barangay=self.brgy_a, status=ReportStatus.APPROVED,
        )
        self.client.force_authenticate(user=self.citizen_b)

        # Boolean vote_type is rejected (avoiding int(True) -> 1)
        res_bool_vote = self.client.post(f'/api/watcher/reports/{report.id}/vote/', {'vote_type': True}, format='json')
        self.assertEqual(res_bool_vote.status_code, status.HTTP_400_BAD_REQUEST)

        # Float vote_type is rejected (avoiding int(1.5) -> 1)
        res_float_vote = self.client.post(f'/api/watcher/reports/{report.id}/vote/', {'vote_type': 1.5}, format='json')
        self.assertEqual(res_float_vote.status_code, status.HTTP_400_BAD_REQUEST)

        # Invalid int vote_type
        res_invalid_vote = self.client.post(f'/api/watcher/reports/{report.id}/vote/', {'vote_type': 2}, format='json')
        self.assertEqual(res_invalid_vote.status_code, status.HTTP_400_BAD_REQUEST)

        # Invalid report ID on vote endpoint
        res_bad_id = self.client.post('/api/watcher/reports/0/vote/', {'vote_type': 1}, format='json')
        self.assertEqual(res_bad_id.status_code, status.HTTP_404_NOT_FOUND)

        # Valid vote succeeds
        res_valid = self.client.post(f'/api/watcher/reports/{report.id}/vote/', {'vote_type': 1}, format='json')
        self.assertEqual(res_valid.status_code, status.HTTP_200_OK)
        self.assertEqual(res_valid.data.get('user_vote'), 1)

    def test_missing_versus_inaccessible_records_consistent_404(self):
        # Citizen A creates a private PENDING report
        private_report = GarbageReport.objects.create(
            user=self.citizen_a, barangay=self.brgy_a, status=ReportStatus.PENDING,
            description='Private pending report',
        )

        # Citizen B is unrelated and not authorized to view Citizen A's pending report
        self.client.force_authenticate(user=self.citizen_b)

        nonexistent_id = 99999999

        # Both nonexistent and inaccessible reports return consistent 404 without leaking status
        res_nonexistent = self.client.get(f'/api/watcher/reports/{nonexistent_id}/')
        res_inaccessible = self.client.get(f'/api/watcher/reports/{private_report.id}/')
        self.assertEqual(res_nonexistent.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_inaccessible.status_code, status.HTTP_404_NOT_FOUND)

        # Same consistent 404 for comments endpoint
        res_comments_nonexistent = self.client.get(f'/api/watcher/reports/{nonexistent_id}/comments/')
        res_comments_inaccessible = self.client.get(f'/api/watcher/reports/{private_report.id}/comments/')
        self.assertEqual(res_comments_nonexistent.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_comments_inaccessible.status_code, status.HTTP_404_NOT_FOUND)

        # Collection confirmations: Confirmation A belongs to Barangay Alpha
        conf_a = CollectionConfirmation.objects.create(
            confirmed_by=self.watcher_a, barangay=self.brgy_a,
        )

        # Watcher B is in Barangay Beta and cannot view Confirmation A
        self.client.force_authenticate(user=self.watcher_b)

        res_conf_nonexistent = self.client.get(f'/api/watcher/confirmations/{nonexistent_id}/')
        res_conf_inaccessible = self.client.get(f'/api/watcher/confirmations/{conf_a.id}/')
        self.assertEqual(res_conf_nonexistent.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res_conf_inaccessible.status_code, status.HTTP_404_NOT_FOUND)

        # DELETE path on confirmation returns consistent 403 Forbidden (audit records are immutable)
        res_del_nonexistent = self.client.delete(f'/api/watcher/confirmations/{nonexistent_id}/')
        res_del_inaccessible = self.client.delete(f'/api/watcher/confirmations/{conf_a.id}/')
        self.assertEqual(res_del_nonexistent.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res_del_inaccessible.status_code, status.HTTP_403_FORBIDDEN)

    def test_authorized_users_retain_permissions_and_unauthorized_blocked(self):
        report_a = GarbageReport.objects.create(
            user=self.citizen_a, barangay=self.brgy_a, status=ReportStatus.PENDING,
        )

        # Citizens are blocked with 403 from moderating
        self.client.force_authenticate(user=self.citizen_b)
        res_cit_app = self.client.post(f'/api/watcher/reports/{report_a.id}/approve/')
        self.assertEqual(res_cit_app.status_code, status.HTTP_403_FORBIDDEN)

        res_cit_rej = self.client.post(f'/api/watcher/reports/{report_a.id}/reject/', {'rejection_reason': 'test'})
        self.assertEqual(res_cit_rej.status_code, status.HTTP_403_FORBIDDEN)

        # Cross-barangay official blocked with 403
        self.client.force_authenticate(user=self.official_b)
        res_off_b_app = self.client.post(f'/api/watcher/reports/{report_a.id}/approve/')
        self.assertEqual(res_off_b_app.status_code, status.HTTP_403_FORBIDDEN)

        # Same-barangay official authorized and succeeds
        self.client.force_authenticate(user=self.official_a)
        res_off_a_app = self.client.post(f'/api/watcher/reports/{report_a.id}/approve/')
        self.assertEqual(res_off_a_app.status_code, status.HTTP_200_OK)
        report_a.refresh_from_db()
        self.assertEqual(report_a.status, ReportStatus.APPROVED)


class GeofencedReportAssignmentTests(TestCase):
    """
    Verifies that GarbageReport barangay assignment is strictly determined
    by point-in-polygon geofencing against Lucena City's barangay boundaries
    whenever (latitude, longitude) coordinates are provided, independent of
    anonymous status or reporter profile barangay.
    """

    def setUp(self):
        self.client = APIClient()
        self.brgy_barra = Barangay.objects.create(name='Barra')
        self.brgy_isabang = Barangay.objects.create(name='Isabang')
        self.brgy_gulang = Barangay.objects.create(name='Gulang-Gulang')

        self.citizen_barra = User.objects.create_user(
            username='citizen_from_barra',
            email='barra_user@example.com',
            password='password123',
            role=UserRole.CITIZEN,
            barangay=self.brgy_barra,
        )

    def test_anonymous_report_geotagged_by_coordinates(self):
        """Anonymous citizen report with 'Unknown' address is geo-tagged via coordinates."""
        self.client.logout()
        res = self.client.post(
            '/api/watcher/reports/',
            {
                'issue_type': IssueType.OVERFLOW,
                'severity': Severity.MEDIUM,
                'latitude': '13.948744',
                'longitude': '121.588810',
                'address': 'Unknown',
                'description': 'Anonymous report in Isabang',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        report = GarbageReport.objects.get(id=res.data['id'])
        self.assertIsNone(report.user)
        self.assertEqual(report.barangay, self.brgy_isabang)
        self.assertEqual(res.data['barangay_name'], 'Isabang')

    def test_cross_barangay_reporter_uses_report_coordinates_not_user_barangay(self):
        """Reporter whose profile is Barra reporting coordinates in Isabang gets Isabang."""
        self.client.force_authenticate(user=self.citizen_barra)
        res = self.client.post(
            '/api/watcher/reports/',
            {
                'issue_type': IssueType.ILLEGAL_DUMP,
                'severity': Severity.MEDIUM,
                'latitude': '13.948744',
                'longitude': '121.588810',
                'barangay': self.brgy_barra.id,
                'address': 'Barra Street',
                'description': 'Reported while visiting Isabang',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        report = GarbageReport.objects.get(id=res.data['id'])
        self.assertEqual(report.user, self.citizen_barra)
        self.assertEqual(report.barangay, self.brgy_isabang)
        self.assertNotEqual(report.barangay, self.brgy_barra)

    def test_outside_lucena_coordinates_do_not_fallback_to_user_barangay(self):
        """Coordinates outside Lucena City resolve to barangay=None instead of user.barangay."""
        self.client.force_authenticate(user=self.citizen_barra)
        res = self.client.post(
            '/api/watcher/reports/',
            {
                'issue_type': IssueType.OVERFLOW,
                'severity': Severity.MEDIUM,
                'latitude': '14.599500',
                'longitude': '120.984200',
                'address': 'Manila',
                'description': 'Outside Lucena boundaries',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        report = GarbageReport.objects.get(id=res.data['id'])
        self.assertIsNone(report.barangay)







