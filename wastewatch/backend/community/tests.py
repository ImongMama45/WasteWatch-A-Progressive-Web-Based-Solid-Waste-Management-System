from django.test import TestCase, TransactionTestCase
import threading
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from django.db.utils import IntegrityError

from accounts.models import Barangay, UserRole
from community.models import CommunityPost, PostLike, PostComment, PostReport, PostType, PostCategory
from watcher.models import GarbageReport, ReportStatus, IssueType, Severity, ReportVote
from watcher.services import create_or_get_community_post_for_report

User = get_user_model()


class CommunityBackendTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Create barangays
        self.brgy_isabang = Barangay.objects.create(name='Isabang')
        self.brgy_market = Barangay.objects.create(name='Market View')

        # Create regular citizen user
        self.citizen = User.objects.create_user(
            username='citizen_juan',
            email='juan@example.com',
            password='testpassword123',
            full_name='Juan Dela Cruz',
            role=UserRole.CITIZEN,
            barangay=self.brgy_isabang,
        )

        # Create another citizen user
        self.citizen_maria = User.objects.create_user(
            username='citizen_maria',
            email='maria@example.com',
            password='testpassword123',
            full_name='Maria Clara',
            role=UserRole.CITIZEN,
            barangay=self.brgy_market,
        )

        # Create admin user
        self.admin_user = User.objects.create_user(
            username='admin_lucena',
            email='admin@example.com',
            password='testpassword123',
            full_name='City Administrator',
            role=UserRole.ADMIN,
            is_staff=True,
        )

        # Create barangay official user
        self.brgy_official = User.objects.create_user(
            username='official_pedro',
            email='pedro@example.com',
            password='testpassword123',
            full_name='Pedro Penduko',
            role=UserRole.BRGY_OFFICIAL,
            barangay=self.brgy_isabang,
        )

    # 1. Post Creation & Validation
    def test_unauthenticated_cannot_create_post(self):
        response = self.client.post('/api/community/posts/', {
            'content': 'Unauthenticated test post about waste disposal',
        })
        self.assertIn(response.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

    def test_authenticated_citizen_can_create_post(self):
        self.client.force_authenticate(user=self.citizen)
        response = self.client.post('/api/community/posts/', {
            'content': 'Clean-up drive this Saturday morning at Barangay Isabang covered court.',
        })
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['author_name'], 'Juan Dela Cruz')
        self.assertEqual(response.data['barangay_name'], 'Isabang')
        self.assertEqual(response.data['like_count'], 0)
        self.assertEqual(response.data['comment_count'], 0)

        # Verify database record
        post = CommunityPost.objects.get(id=response.data['id'])
        self.assertEqual(post.author, self.citizen)
        self.assertEqual(post.barangay, self.brgy_isabang)

    def test_empty_or_too_short_content_rejected(self):
        self.client.force_authenticate(user=self.citizen)
        response = self.client.post('/api/community/posts/', {'content': '  '})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response_short = self.client.post('/api/community/posts/', {'content': 'hi'})
        self.assertEqual(response_short.status_code, status.HTTP_400_BAD_REQUEST)

    # 2. Post Listing and Privacy / Hidden Moderation
    def test_public_can_view_active_posts(self):
        post = CommunityPost.objects.create(
            author=self.citizen,
            barangay=self.brgy_isabang,
            content='Public post for all citizens.',
        )
        response = self.client.get('/api/community/posts/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Supports paginated response (results) or list
        results = response.data.get('results', response.data)
        self.assertTrue(any(p['id'] == post.id for p in results))

    def test_hidden_posts_not_shown_to_public(self):
        hidden_post = CommunityPost.objects.create(
            author=self.citizen,
            content='Hidden post violating rules',
            is_hidden=True,
        )
        response = self.client.get('/api/community/posts/')
        results = response.data.get('results', response.data)
        self.assertFalse(any(p['id'] == hidden_post.id for p in results))

    # 3. Likes & Duplicate-Like Prevention
    def test_like_and_unlike_flow(self):
        post = CommunityPost.objects.create(
            author=self.citizen,
            content='Neighborhood recycling project update',
        )

        # Like as Maria
        self.client.force_authenticate(user=self.citizen_maria)
        res_like = self.client.post(f'/api/community/posts/{post.id}/like/')
        self.assertEqual(res_like.status_code, status.HTTP_200_OK)
        self.assertTrue(res_like.data['liked'])
        self.assertEqual(res_like.data['like_count'], 1)

        # Database record exists
        self.assertEqual(PostLike.objects.filter(post=post, user=self.citizen_maria).count(), 1)

        # Toggle like (second POST unlikes)
        res_unlike = self.client.post(f'/api/community/posts/{post.id}/like/')
        self.assertEqual(res_unlike.status_code, status.HTTP_200_OK)
        self.assertFalse(res_unlike.data['liked'])
        self.assertEqual(res_unlike.data['like_count'], 0)
        self.assertEqual(PostLike.objects.filter(post=post, user=self.citizen_maria).count(), 0)

    def test_duplicate_like_db_constraint(self):
        post = CommunityPost.objects.create(
            author=self.citizen,
            content='Database constraint verification post',
        )
        PostLike.objects.create(post=post, user=self.citizen_maria)
        with self.assertRaises(IntegrityError):
            PostLike.objects.create(post=post, user=self.citizen_maria)

    # 4. Comments
    def test_comments_creation_and_listing(self):
        post = CommunityPost.objects.create(
            author=self.citizen,
            content='Collection delayed in zone 3 today.',
        )
        # Unauthenticated cannot comment
        res_unauth = self.client.post(f'/api/community/posts/{post.id}/comments/', {
            'content': 'Any update from the truck?',
        })
        self.assertIn(res_unauth.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

        # Authenticated citizen can comment
        self.client.force_authenticate(user=self.citizen_maria)
        res_comment = self.client.post(f'/api/community/posts/{post.id}/comments/', {
            'content': 'Truck just arrived on Main Street!',
        })
        self.assertEqual(res_comment.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_comment.data['author_name'], 'Maria Clara')

        # List comments
        res_list = self.client.get(f'/api/community/posts/{post.id}/comments/')
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_list.data), 1)
        self.assertEqual(res_list.data[0]['content'], 'Truck just arrived on Main Street!')

    def test_user_cannot_delete_other_user_comment(self):
        post = CommunityPost.objects.create(author=self.citizen, content='Discussion')
        comment = PostComment.objects.create(post=post, author=self.citizen_maria, content='My comment')

        # Juan tries to delete Maria's comment
        self.client.force_authenticate(user=self.citizen)
        res_del = self.client.delete(f'/api/community/comments/{comment.id}/')
        self.assertEqual(res_del.status_code, status.HTTP_403_FORBIDDEN)

        # Maria can delete her own comment
        self.client.force_authenticate(user=self.citizen_maria)
        res_del_own = self.client.delete(f'/api/community/comments/{comment.id}/')
        self.assertEqual(res_del_own.status_code, status.HTTP_200_OK)
        self.assertFalse(PostComment.objects.filter(id=comment.id).exists())

    # 5. Reporting and Moderation
    def test_citizen_can_report_post(self):
        post = CommunityPost.objects.create(
            author=self.citizen,
            content='Inappropriate spam link http://example.com',
        )
        self.client.force_authenticate(user=self.citizen_maria)
        res_report = self.client.post(f'/api/community/posts/{post.id}/report/', {
            'reason': 'spam',
            'details': 'Promoting commercial products instead of waste management.',
        })
        self.assertEqual(res_report.status_code, status.HTTP_201_CREATED)
        self.assertEqual(PostReport.objects.filter(post=post, reporter=self.citizen_maria).count(), 1)

    def test_admin_can_moderate_and_hide_post(self):
        post = CommunityPost.objects.create(
            author=self.citizen,
            content='Post that needs to be hidden by admin',
        )
        # Non-admin cannot moderate
        self.client.force_authenticate(user=self.citizen_maria)
        res_forbidden = self.client.patch(f'/api/community/posts/{post.id}/moderate/', {'is_hidden': True})
        self.assertEqual(res_forbidden.status_code, status.HTTP_403_FORBIDDEN)

        # Admin can hide post
        self.client.force_authenticate(user=self.admin_user)
        res_mod = self.client.patch(f'/api/community/posts/{post.id}/moderate/', {'is_hidden': True})
        self.assertEqual(res_mod.status_code, status.HTTP_200_OK)
        post.refresh_from_db()
        self.assertTrue(post.is_hidden)

    def test_announcements_preview_endpoint(self):
        CommunityPost.objects.create(author=self.citizen, content='First post for preview')
        CommunityPost.objects.create(author=self.citizen_maria, content='Second post for preview')

        res_prev = self.client.get('/api/community/posts/preview/')
        self.assertEqual(res_prev.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(res_prev.data), 2)

    # 6. Targeted Step 3.1 & 3.2 Verification & Regression Tests
    def test_ordinary_user_cannot_retrieve_hidden_post_detail(self):
        hidden_post = CommunityPost.objects.create(
            author=self.citizen,
            content='This post was hidden by moderation.',
            is_hidden=True,
        )
        # 1. Anonymous user gets 404
        res_anon = self.client.get(f'/api/community/posts/{hidden_post.id}/')
        self.assertEqual(res_anon.status_code, status.HTTP_404_NOT_FOUND)

        # 2. Authenticated citizen gets 404, even if attempting ?include_hidden=true
        self.client.force_authenticate(user=self.citizen_maria)
        res_auth = self.client.get(f'/api/community/posts/{hidden_post.id}/')
        self.assertEqual(res_auth.status_code, status.HTTP_404_NOT_FOUND)
        res_auth_param = self.client.get(f'/api/community/posts/{hidden_post.id}/?include_hidden=true')
        self.assertEqual(res_auth_param.status_code, status.HTTP_404_NOT_FOUND)

        # 3. Administrator doing ordinary detail retrieval (without explicit include_hidden) gets 404
        self.client.force_authenticate(user=self.admin_user)
        res_admin_ordinary = self.client.get(f'/api/community/posts/{hidden_post.id}/')
        self.assertEqual(res_admin_ordinary.status_code, status.HTTP_404_NOT_FOUND)

        # 4. Administrator using explicit moderation retrieval path (?include_hidden=true) gets 200 OK
        res_admin_mod = self.client.get(f'/api/community/posts/{hidden_post.id}/?include_hidden=true')
        self.assertEqual(res_admin_mod.status_code, status.HTTP_200_OK)
        self.assertEqual(res_admin_mod.data['id'], hidden_post.id)
        self.assertTrue(res_admin_mod.data['is_hidden'])

    def test_ordinary_user_cannot_interact_with_hidden_post(self):
        hidden_post = CommunityPost.objects.create(
            author=self.citizen,
            content='Hidden discussion post.',
            is_hidden=True,
        )
        self.client.force_authenticate(user=self.citizen_maria)

        # Cannot like hidden post
        res_like = self.client.post(f'/api/community/posts/{hidden_post.id}/like/')
        self.assertEqual(res_like.status_code, status.HTTP_404_NOT_FOUND)

        # Cannot comment on hidden post
        res_comment = self.client.post(f'/api/community/posts/{hidden_post.id}/comments/', {
            'content': 'Attempt to comment on hidden post',
        })
        self.assertEqual(res_comment.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_can_restore_hidden_post(self):
        hidden_post = CommunityPost.objects.create(
            author=self.citizen,
            content='Initially hidden post to be unhidden by administrator.',
            is_hidden=True,
        )
        self.client.force_authenticate(user=self.admin_user)

        # Admin unhides the post via moderate endpoint
        res_restore = self.client.patch(
            f'/api/community/posts/{hidden_post.id}/moderate/',
            {'is_hidden': False}
        )
        self.assertEqual(res_restore.status_code, status.HTTP_200_OK)
        hidden_post.refresh_from_db()
        self.assertFalse(hidden_post.is_hidden)

        # Post is now visible in public list
        self.client.force_authenticate(user=None)
        res_list = self.client.get('/api/community/posts/')
        results = res_list.data.get('results', res_list.data)
        self.assertTrue(any(p['id'] == hidden_post.id for p in results))

    def test_hidden_comments_excluded_from_public_comment_list(self):
        post = CommunityPost.objects.create(
            author=self.citizen,
            content='Discussion with regular and hidden comments.',
        )
        PostComment.objects.create(post=post, author=self.citizen, content='Visible comment')
        PostComment.objects.create(post=post, author=self.citizen_maria, content='Offensive hidden comment', is_hidden=True)

        # Public list comments
        res = self.client.get(f'/api/community/posts/{post.id}/comments/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]['content'], 'Visible comment')

    def test_brgy_official_cannot_moderate_post(self):
        post = CommunityPost.objects.create(
            author=self.citizen,
            content='Barangay official role boundary test post.',
        )
        # Brgy official attempts to hide post
        self.client.force_authenticate(user=self.brgy_official)
        res = self.client.patch(f'/api/community/posts/{post.id}/moderate/', {'is_hidden': True})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        post.refresh_from_db()
        self.assertFalse(post.is_hidden)

    def test_like_idempotent_actions(self):
        post = CommunityPost.objects.create(author=self.citizen, content='Idempotent likes test')
        self.client.force_authenticate(user=self.citizen_maria)

        # Explicit action='like'
        res1 = self.client.post(f'/api/community/posts/{post.id}/like/', {'action': 'like'})
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        self.assertTrue(res1.data['liked'])
        self.assertEqual(res1.data['like_count'], 1)

        # Second action='like' is idempotent
        res2 = self.client.post(f'/api/community/posts/{post.id}/like/', {'action': 'like'})
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertTrue(res2.data['liked'])
        self.assertEqual(res2.data['like_count'], 1)
        self.assertEqual(PostLike.objects.filter(post=post, user=self.citizen_maria).count(), 1)

        # Explicit action='unlike'
        res3 = self.client.post(f'/api/community/posts/{post.id}/like/', {'action': 'unlike'})
        self.assertEqual(res3.status_code, status.HTTP_200_OK)
        self.assertFalse(res3.data['liked'])
        self.assertEqual(res3.data['like_count'], 0)

        # Second action='unlike' is idempotent
        res4 = self.client.post(f'/api/community/posts/{post.id}/like/', {'action': 'unlike'})
        self.assertEqual(res4.status_code, status.HTTP_200_OK)
        self.assertFalse(res4.data['liked'])
        self.assertEqual(res4.data['like_count'], 0)
        self.assertEqual(PostLike.objects.filter(post=post, user=self.citizen_maria).count(), 0)

    def test_report_permissions_and_dismissal(self):
        post = CommunityPost.objects.create(author=self.citizen, content='Spam post')
        report = PostReport.objects.create(post=post, reporter=self.citizen_maria, reason='spam', details='Spam link')

        # Citizen cannot view reports list or dismiss
        self.client.force_authenticate(user=self.citizen_maria)
        res_list_citizen = self.client.get('/api/community/reports/')
        self.assertEqual(res_list_citizen.status_code, status.HTTP_403_FORBIDDEN)
        res_dismiss_citizen = self.client.post(f'/api/community/reports/{report.id}/dismiss/')
        self.assertEqual(res_dismiss_citizen.status_code, status.HTTP_403_FORBIDDEN)

        # Admin can view reports
        self.client.force_authenticate(user=self.admin_user)
        res_list_admin = self.client.get('/api/community/reports/')
        self.assertEqual(res_list_admin.status_code, status.HTTP_200_OK)
        report_items = res_list_admin.data if isinstance(res_list_admin.data, list) else res_list_admin.data.get('results', [])
        self.assertTrue(any(r['id'] == report.id for r in report_items))

        # Admin can dismiss report
        res_dismiss_admin = self.client.post(f'/api/community/reports/{report.id}/dismiss/')
        self.assertEqual(res_dismiss_admin.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, 'dismissed')

    def test_repeated_reporting_idempotency_and_no_duplicates(self):
        post = CommunityPost.objects.create(author=self.citizen, content='Questionable post')
        self.client.force_authenticate(user=self.citizen_maria)

        # First report
        res1 = self.client.post(f'/api/community/posts/{post.id}/report/', {
            'reason': 'spam',
            'details': 'First report details',
        })
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(PostReport.objects.filter(post=post, reporter=self.citizen_maria).count(), 1)

        # Second report from same user on same post updates rather than duplicates
        res2 = self.client.post(f'/api/community/posts/{post.id}/report/', {
            'reason': 'misinformation',
            'details': 'Updated report details',
        })
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(PostReport.objects.filter(post=post, reporter=self.citizen_maria).count(), 1)
        report = PostReport.objects.get(post=post, reporter=self.citizen_maria)
        self.assertEqual(report.reason, 'misinformation')
        self.assertEqual(report.details, 'Updated report details')
        self.assertEqual(report.status, 'pending')

    def test_report_card_privacy_and_visibility_rules(self):
        from watcher.models import GarbageReport, ReportStatus, IssueType, Severity

        # 1. Citizen Juan creates a report (status = PENDING by default)
        rep_pending = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.brgy_isabang,
            issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH,
            status=ReportStatus.PENDING,
            address='Pending Street',
        )
        post_pending = CommunityPost.objects.create(
            author=self.citizen,
            report=rep_pending,
            post_type=PostType.REPORT,
            content='Pending report card',
        )

        # 2. Approved report
        rep_approved = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.brgy_isabang,
            issue_type=IssueType.MISSED,
            severity=Severity.MEDIUM,
            status=ReportStatus.APPROVED,
            address='Approved Street',
        )
        post_approved = CommunityPost.objects.create(
            author=self.citizen,
            report=rep_approved,
            post_type=PostType.REPORT,
            content='Approved report card',
        )

        # 3. Resolved report
        rep_resolved = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.brgy_isabang,
            issue_type=IssueType.ILLEGAL_DUMP,
            severity=Severity.LOW,
            status=ReportStatus.RESOLVED,
            address='Resolved Street',
        )
        post_resolved = CommunityPost.objects.create(
            author=self.citizen,
            report=rep_resolved,
            post_type=PostType.REPORT,
            content='Resolved report card',
        )

        # 4. Rejected report
        rep_rejected = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.brgy_isabang,
            issue_type=IssueType.OVERFLOW,
            status=ReportStatus.REJECTED,
            address='Rejected Street',
        )
        post_rejected = CommunityPost.objects.create(
            author=self.citizen,
            report=rep_rejected,
            post_type=PostType.REPORT,
            content='Rejected report card',
        )

        # 5. Archived report
        rep_archived = GarbageReport.objects.create(
            user=self.citizen,
            barangay=self.brgy_isabang,
            issue_type=IssueType.OVERFLOW,
            status=ReportStatus.APPROVED,
            is_archived=True,
            address='Archived Street',
        )
        post_archived = CommunityPost.objects.create(
            author=self.citizen,
            report=rep_archived,
            post_type=PostType.REPORT,
            content='Archived report card',
        )

        # Check Anonymous visitor:
        self.client.logout()
        res_anon = self.client.get('/api/community/posts/')
        self.assertEqual(res_anon.status_code, status.HTTP_200_OK)
        anon_ids = [p['id'] for p in res_anon.data.get('results', res_anon.data)]
        self.assertNotIn(post_pending.id, anon_ids)
        self.assertIn(post_approved.id, anon_ids)
        self.assertIn(post_resolved.id, anon_ids)
        self.assertNotIn(post_rejected.id, anon_ids)
        self.assertNotIn(post_archived.id, anon_ids)

        # Check Unrelated Citizen B (Maria):
        self.client.force_authenticate(user=self.citizen_maria)
        res_maria = self.client.get('/api/community/posts/')
        self.assertEqual(res_maria.status_code, status.HTTP_200_OK)
        maria_ids = [p['id'] for p in res_maria.data.get('results', res_maria.data)]
        self.assertNotIn(post_pending.id, maria_ids)
        self.assertIn(post_approved.id, maria_ids)
        self.assertIn(post_resolved.id, maria_ids)
        self.assertNotIn(post_rejected.id, maria_ids)
        self.assertNotIn(post_archived.id, maria_ids)

        # Check Report Owner (Juan):
        self.client.force_authenticate(user=self.citizen)
        res_juan = self.client.get('/api/community/posts/')
        self.assertEqual(res_juan.status_code, status.HTTP_200_OK)
        juan_ids = [p['id'] for p in res_juan.data.get('results', res_juan.data)]
        self.assertIn(post_pending.id, juan_ids)  # Owner can see their own pending report!
        self.assertIn(post_approved.id, juan_ids)
        self.assertIn(post_resolved.id, juan_ids)
        self.assertNotIn(post_rejected.id, juan_ids)
        self.assertNotIn(post_archived.id, juan_ids)

        # Check Administrator without include_hidden:
        self.client.force_authenticate(user=self.admin_user)
        res_admin = self.client.get('/api/community/posts/')
        self.assertEqual(res_admin.status_code, status.HTTP_200_OK)
        admin_ids = [p['id'] for p in res_admin.data.get('results', res_admin.data)]
        self.assertIn(post_pending.id, admin_ids)
        self.assertIn(post_approved.id, admin_ids)
        self.assertIn(post_resolved.id, admin_ids)
        self.assertNotIn(post_rejected.id, admin_ids)
        self.assertNotIn(post_archived.id, admin_ids)

        # Check Administrator with ?include_hidden=true:
        res_admin_hidden = self.client.get('/api/community/posts/?include_hidden=true')
        self.assertEqual(res_admin_hidden.status_code, status.HTTP_200_OK)
        admin_hidden_ids = [p['id'] for p in res_admin_hidden.data.get('results', res_admin_hidden.data)]
        self.assertIn(post_pending.id, admin_hidden_ids)
        self.assertIn(post_approved.id, admin_hidden_ids)
        self.assertIn(post_resolved.id, admin_hidden_ids)
        self.assertIn(post_rejected.id, admin_hidden_ids)
        self.assertIn(post_archived.id, admin_hidden_ids)

    def test_community_visibility_comprehensive_matrix(self):
        # Create reports in Isabang (pedro's barangay) and Market View (maria's barangay)
        r_isabang_pending = GarbageReport.objects.create(
            user=self.citizen, barangay=self.brgy_isabang, issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH, status=ReportStatus.PENDING, description='Pending Isabang'
        )
        p_isabang_pending, _ = create_or_get_community_post_for_report(r_isabang_pending, author=self.citizen)

        r_isabang_approved = GarbageReport.objects.create(
            user=self.citizen, barangay=self.brgy_isabang, issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH, status=ReportStatus.APPROVED, description='Approved Isabang'
        )
        p_isabang_approved, _ = create_or_get_community_post_for_report(r_isabang_approved, author=self.citizen)

        r_market_pending = GarbageReport.objects.create(
            user=self.citizen_maria, barangay=self.brgy_market, issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH, status=ReportStatus.PENDING, description='Pending Market'
        )
        p_market_pending, _ = create_or_get_community_post_for_report(r_market_pending, author=self.citizen_maria)

        r_isabang_archived = GarbageReport.objects.create(
            user=self.citizen, barangay=self.brgy_isabang, issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH, status=ReportStatus.REJECTED, is_archived=True, description='Archived Isabang'
        )
        p_isabang_archived, _ = create_or_get_community_post_for_report(r_isabang_archived, author=self.citizen)

        # 1. Anonymous: only approved
        self.client.logout()
        res_anon = self.client.get('/api/community/posts/')
        self.assertEqual(res_anon.status_code, status.HTTP_200_OK)
        anon_ids = [p['id'] for p in res_anon.data.get('results', res_anon.data)]
        self.assertIn(p_isabang_approved.id, anon_ids)
        self.assertNotIn(p_isabang_pending.id, anon_ids)
        self.assertNotIn(p_market_pending.id, anon_ids)
        self.assertNotIn(p_isabang_archived.id, anon_ids)

        # Anonymous preview endpoint
        res_preview = self.client.get('/api/community/posts/preview/')
        self.assertEqual(res_preview.status_code, status.HTTP_200_OK)
        prev_ids = [p['id'] for p in res_preview.data]
        self.assertIn(p_isabang_approved.id, prev_ids)
        self.assertNotIn(p_isabang_pending.id, prev_ids)
        self.assertNotIn(p_market_pending.id, prev_ids)

        # 2. Barangay Official (Pedro - Isabang): can see pending in Isabang, but NOT pending in Market View
        self.client.force_authenticate(user=self.brgy_official)
        res_official = self.client.get('/api/community/posts/')
        self.assertEqual(res_official.status_code, status.HTTP_200_OK)
        off_ids = [p['id'] for p in res_official.data.get('results', res_official.data)]
        self.assertIn(p_isabang_approved.id, off_ids)
        self.assertIn(p_isabang_pending.id, off_ids)
        self.assertNotIn(p_market_pending.id, off_ids)
        self.assertNotIn(p_isabang_archived.id, off_ids)

        # 3. Filters
        res_filter_type = self.client.get('/api/community/posts/?post_type=report')
        self.assertEqual(res_filter_type.status_code, status.HTTP_200_OK)
        type_ids = [p['id'] for p in res_filter_type.data.get('results', res_filter_type.data)]
        self.assertIn(p_isabang_approved.id, type_ids)

        res_filter_report = self.client.get(f'/api/community/posts/?report_id={r_isabang_approved.id}')
        self.assertEqual(res_filter_report.status_code, status.HTTP_200_OK)
        rep_ids = [p['id'] for p in res_filter_report.data.get('results', res_filter_report.data)]
        self.assertEqual(rep_ids, [p_isabang_approved.id])

        # 4. Hidden post protection
        p_isabang_approved.is_hidden = True
        p_isabang_approved.save()
        self.client.force_authenticate(user=self.citizen)
        res_hidden_detail = self.client.get(f'/api/community/posts/{p_isabang_approved.id}/')
        self.assertEqual(res_hidden_detail.status_code, status.HTTP_404_NOT_FOUND)

    def test_community_integrity_protections(self):
        r = GarbageReport.objects.create(
            user=self.citizen, barangay=self.brgy_isabang, issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH, status=ReportStatus.APPROVED, description='Integrity Report'
        )
        post, _ = create_or_get_community_post_for_report(r, author=self.citizen)

        self.client.force_authenticate(user=self.citizen)

        # 1. User cannot change post_type via PATCH
        res_patch_type = self.client.patch(f'/api/community/posts/{post.id}/', {'post_type': 'discussion'})
        self.assertEqual(res_patch_type.status_code, status.HTTP_403_FORBIDDEN)

        # 2. User cannot create fake post_type='report'
        res_create_fake = self.client.post('/api/community/posts/', {
            'content': 'Fake report post without official GarbageReport',
            'post_type': 'report',
        })
        self.assertEqual(res_create_fake.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. User cannot inject report ID
        res_inject_report = self.client.post('/api/community/posts/', {
            'content': 'Attempt to link report',
            'report': r.id,
        })
        self.assertEqual(res_inject_report.status_code, status.HTTP_400_BAD_REQUEST)

        # 4. Report owner cannot delete report card
        res_delete_card = self.client.delete(f'/api/community/posts/{post.id}/')
        self.assertEqual(res_delete_card.status_code, status.HTTP_403_FORBIDDEN)

        # 5. Admin can moderate
        self.client.force_authenticate(user=self.admin_user)
        res_admin_mod = self.client.patch(f'/api/community/posts/{post.id}/', {'content': 'Admin moderated text'})
        self.assertEqual(res_admin_mod.status_code, status.HTTP_200_OK)

        # 6. Ordinary discussion author create/edit/delete works
        self.client.force_authenticate(user=self.citizen)
        res_disc = self.client.post('/api/community/posts/', {'content': 'My ordinary discussion post'})
        self.assertEqual(res_disc.status_code, status.HTTP_201_CREATED)
        disc_id = res_disc.data['id']

        res_disc_edit = self.client.patch(f'/api/community/posts/{disc_id}/', {'content': 'Edited discussion post'})
        self.assertEqual(res_disc_edit.status_code, status.HTTP_200_OK)
        self.assertEqual(res_disc_edit.data['content'], 'Edited discussion post')

        res_disc_del = self.client.delete(f'/api/community/posts/{disc_id}/')
        self.assertEqual(res_disc_del.status_code, status.HTTP_204_NO_CONTENT)

    def test_reporter_identity_masking_comprehensive(self):
        r = GarbageReport.objects.create(
            user=self.citizen, barangay=self.brgy_isabang, issue_type=IssueType.OVERFLOW,
            severity=Severity.HIGH, status=ReportStatus.APPROVED, description='Privacy Report'
        )
        post, _ = create_or_get_community_post_for_report(r, author=self.citizen)

        # Add reporter's own comment on the report
        c_reporter = PostComment.objects.create(post=post, author=self.citizen, content='I am the reporter checking in.')
        # Add unrelated commenter
        c_other = PostComment.objects.create(post=post, author=self.citizen_maria, content='I also saw this.')

        # 1. Unauthorized citizen (Maria)
        self.client.force_authenticate(user=self.citizen_maria)
        res_feed = self.client.get(f'/api/community/posts/{post.id}/')
        self.assertEqual(res_feed.status_code, status.HTTP_200_OK)
        self.assertEqual(res_feed.data['author_name'], 'Community Waste Report')
        self.assertIsNone(res_feed.data['author_id'])
        self.assertIsNone(res_feed.data['author_avatar'])
        self.assertIsNone(res_feed.data['author_role'])

        # Comments masking for unauthorized citizen
        res_comments = self.client.get(f'/api/community/posts/{post.id}/comments/')
        self.assertEqual(res_comments.status_code, status.HTTP_200_OK)
        comments_by_id = {c['id']: c for c in res_comments.data}

        # Reporter's comment is masked:
        self.assertIn(c_reporter.id, comments_by_id)
        self.assertIn(comments_by_id[c_reporter.id]['author_name'], ['Community Waste Report', 'Reporter (Citizen)'])
        self.assertIsNone(comments_by_id[c_reporter.id]['author_id'])

        # Unrelated commenter is NOT masked:
        self.assertIn(c_other.id, comments_by_id)
        self.assertEqual(comments_by_id[c_other.id]['author_name'], 'Maria Clara')
        self.assertEqual(comments_by_id[c_other.id]['author_id'], self.citizen_maria.id)

        # 2. Authorized Viewer: Report Owner (Juan) sees his own real identity
        self.client.force_authenticate(user=self.citizen)
        res_owner_detail = self.client.get(f'/api/community/posts/{post.id}/')
        self.assertEqual(res_owner_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(res_owner_detail.data['author_name'], 'Juan Dela Cruz')
        self.assertEqual(res_owner_detail.data['author_id'], self.citizen.id)

        # 3. Authorized Viewer: Admin sees real identity
        self.client.force_authenticate(user=self.admin_user)
        res_admin_detail = self.client.get(f'/api/community/posts/{post.id}/')
        self.assertEqual(res_admin_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(res_admin_detail.data['author_name'], 'Juan Dela Cruz')
        self.assertEqual(res_admin_detail.data['author_id'], self.citizen.id)

    def test_community_query_scaling_3_vs_13(self):
        # Create 13 reports and community posts
        for i in range(13):
            r = GarbageReport.objects.create(
                user=self.citizen, barangay=self.brgy_isabang, issue_type=IssueType.OVERFLOW,
                severity=Severity.MEDIUM, status=ReportStatus.APPROVED, description=f'Scaling report {i}'
            )
            create_or_get_community_post_for_report(r, author=self.citizen)

        self.client.force_authenticate(user=self.citizen)

        from django.test.utils import CaptureQueriesContext
        from django.db import connection

        # Measure query count for 3 records
        with CaptureQueriesContext(connection) as ctx3:
            res3 = self.client.get('/api/community/posts/?page_size=3')
            self.assertEqual(res3.status_code, status.HTTP_200_OK)
            self.assertEqual(len(res3.data['results']), 3)
        q3 = len(ctx3.captured_queries)

        # Measure query count for 13 records
        with CaptureQueriesContext(connection) as ctx13:
            res13 = self.client.get('/api/community/posts/?page_size=13')
            self.assertEqual(res13.status_code, status.HTTP_200_OK)
            self.assertEqual(len(res13.data['results']), 13)
        q13 = len(ctx13.captured_queries)

        # Query count is bounded (O(1)) and identical regardless of 3 vs 13 items
        self.assertEqual(q3, q13)
        self.assertLessEqual(q13, 10)

    def test_community_ordering_by_likes_count_and_created_at(self):
        """
        Verify that ordering by likes_count and -likes_count does not trigger HTTP 500 FieldError
        and correctly orders by the annotated like count.
        """
        # Create 3 posts
        p1 = CommunityPost.objects.create(author=self.citizen, content="Post with 0 likes")
        p2 = CommunityPost.objects.create(author=self.citizen, content="Post with 2 likes")
        p3 = CommunityPost.objects.create(author=self.citizen, content="Post with 1 like")

        # Like p2 twice (citizen + maria)
        PostLike.objects.create(post=p2, user=self.citizen)
        PostLike.objects.create(post=p2, user=self.citizen_maria)

        # Like p3 once (citizen)
        PostLike.objects.create(post=p3, user=self.citizen)

        # 1. Order by -likes_count (descending)
        res_desc = self.client.get('/api/community/posts/?ordering=-likes_count')
        self.assertEqual(res_desc.status_code, status.HTTP_200_OK)
        ids_desc = [p['id'] for p in res_desc.data['results']]
        self.assertEqual(ids_desc[0], p2.id)

        # 2. Order by likes_count (ascending)
        res_asc = self.client.get('/api/community/posts/?ordering=likes_count')
        self.assertEqual(res_asc.status_code, status.HTTP_200_OK)
        ids_asc = [p['id'] for p in res_asc.data['results']]
        self.assertEqual(ids_asc[0], p1.id)

        # 3. Order by created_at
        res_created = self.client.get('/api/community/posts/?ordering=-created_at')
        self.assertEqual(res_created.status_code, status.HTTP_200_OK)



class CommunityConcurrencyTests(TransactionTestCase):
    def test_concurrent_like_toggle_requests(self):
        from django.db import connection
        if connection.vendor == 'sqlite':
            self.skipTest(
                "SQLite does not support row-level locking (select_for_update is a no-op on SQLite). "
                "SQLite table-level locking causes lock escalation collisions during concurrent multi-threaded writes. "
                "Row-level locking with User.objects.select_for_update() is active and targeted for PostgreSQL."
            )

        author = User.objects.create_user(username='c_author', email='ca@example.com', password='pw')
        user = User.objects.create_user(username='c_liker', email='cl@example.com', password='pw')
        post = CommunityPost.objects.create(author=author, content='Concurrency test post')

        results = []
        errors = []

        def do_like():
            from django.db import connection
            try:
                c = APIClient()
                c.force_authenticate(user=user)
                resp = c.post(f'/api/community/posts/{post.id}/like/')
                results.append((resp.status_code, resp.data['liked'], resp.data['like_count']))
            except Exception as e:
                errors.append(e)
            finally:
                connection.close()

        t1 = threading.Thread(target=do_like)
        t2 = threading.Thread(target=do_like)

        t1.start()
        t2.start()

        t1.join()
        t2.join()

        self.assertEqual(len(errors), 0, f"Errors in concurrent like: {errors}")
        self.assertEqual(len(results), 2)
        # Database state must be consistent with like count
        actual_count = PostLike.objects.filter(post=post).count()
        self.assertIn(actual_count, [0, 1])
        # DB uniqueness constraint was never violated
        user_like_count = PostLike.objects.filter(post=post, user=user).count()
        self.assertLessEqual(user_like_count, 1)

