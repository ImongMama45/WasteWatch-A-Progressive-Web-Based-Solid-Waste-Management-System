from rest_framework.test import APITestCase

from .models import User, Barangay, UserRole
from .permissions import is_admin_user


def make_user(email, role=UserRole.CITIZEN, **extra):
    return User.objects.create_user(
        username=email.split('@')[0],
        email=email,
        password='pass12345',
        full_name=email.split('@')[0],
        role=role,
        **extra,
    )


class UserViewSetPermissionTests(APITestCase):
    """Regression tests for the UserViewSet privilege-escalation hole."""

    def setUp(self):
        self.citizen = make_user('citizen@test.com')
        self.other = make_user('other@test.com')
        self.admin_role = make_user('admin@test.com', role=UserRole.ADMIN)  # is_staff=False
        self.users_url = '/api/accounts/users/'

    def detail(self, user):
        return f'{self.users_url}{user.id}/'

    # ── The escalation itself ────────────────────────────────────────────────
    def test_citizen_cannot_promote_self_to_admin(self):
        self.client.force_authenticate(self.citizen)
        res = self.client.patch(self.detail(self.citizen), {'role': 'admin'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.citizen.refresh_from_db()
        self.assertEqual(self.citizen.role, UserRole.CITIZEN)

    def test_citizen_cannot_change_another_user(self):
        self.client.force_authenticate(self.citizen)
        res = self.client.patch(self.detail(self.other), {'role': 'admin'}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_citizen_cannot_set_password_of_another_user(self):
        self.client.force_authenticate(self.citizen)
        res = self.client.patch(self.detail(self.other), {'password': 'hijacked1'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.assertTrue(User.objects.get(pk=self.other.pk).check_password('pass12345'))

    # ── Data exposure ────────────────────────────────────────────────────────
    def test_citizen_cannot_list_or_retrieve_users(self):
        self.client.force_authenticate(self.citizen)
        self.assertEqual(self.client.get(self.users_url).status_code, 403)
        self.assertEqual(self.client.get(self.detail(self.other)).status_code, 403)

    def test_citizen_cannot_create_or_delete_users(self):
        self.client.force_authenticate(self.citizen)
        res = self.client.post(self.users_url, {
            'email': 'new@test.com', 'full_name': 'New', 'role': 'admin', 'password': 'pass12345',
        }, format='json')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.client.delete(self.detail(self.other)).status_code, 403)
        self.assertTrue(User.objects.filter(pk=self.other.pk).exists())

    def test_anonymous_is_rejected(self):
        res = self.client.get(self.users_url)
        self.assertIn(res.status_code, (401, 403))

    # ── Admins still work ────────────────────────────────────────────────────
    def test_role_admin_without_is_staff_can_manage_users(self):
        self.assertFalse(self.admin_role.is_staff)
        self.client.force_authenticate(self.admin_role)
        self.assertEqual(self.client.get(self.users_url).status_code, 200)
        res = self.client.patch(self.detail(self.other), {'is_active': False}, format='json')
        self.assertEqual(res.status_code, 200)
        self.other.refresh_from_db()
        self.assertFalse(self.other.is_active)

    def test_admin_can_change_a_role(self):
        self.client.force_authenticate(self.admin_role)
        res = self.client.patch(self.detail(self.other), {'role': 'watcher'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.other.refresh_from_db()
        self.assertEqual(self.other.role, UserRole.WATCHER)

    def test_staff_only_user_passes_both_viewset_and_lift_suspension_checks(self):
        # is_staff=True but role='citizen': must be treated as admin everywhere.
        staff = make_user('staff@test.com')
        staff.is_staff = True
        staff.save()
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.get(self.users_url).status_code, 200)
        # `other` is not a driver, so a permitted caller gets 400, never 403.
        res = self.client.patch(f'{self.detail(self.other)}lift_suspension/', {'reason': 'x'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_citizen_cannot_lift_suspension(self):
        self.client.force_authenticate(self.citizen)
        res = self.client.patch(f'{self.detail(self.other)}lift_suspension/', {'reason': 'x'}, format='json')
        self.assertEqual(res.status_code, 403)


class IsAdminUserHelperTests(APITestCase):
    def test_helper(self):
        self.assertFalse(is_admin_user(None))
        self.assertFalse(is_admin_user(make_user('c@test.com')))
        self.assertTrue(is_admin_user(make_user('a@test.com', role=UserRole.ADMIN)))
        staff = make_user('s@test.com')
        staff.is_staff = True
        self.assertTrue(is_admin_user(staff))


class SelfServiceEndpointsStillWorkTests(APITestCase):
    """Locking down UserViewSet must not break what citizens legitimately do."""

    def test_citizen_can_read_own_profile_via_me(self):
        citizen = make_user('me@test.com')
        self.client.force_authenticate(citizen)
        res = self.client.get('/api/auth/me/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['email'], 'me@test.com')

    def test_me_patch_cannot_change_role(self):
        citizen = make_user('me2@test.com')
        self.client.force_authenticate(citizen)
        self.client.patch('/api/auth/me/', {'role': 'admin', 'full_name': 'Renamed'}, format='json')
        citizen.refresh_from_db()
        self.assertEqual(citizen.role, UserRole.CITIZEN)
        self.assertEqual(citizen.full_name, 'Renamed')

    def test_public_registration_always_creates_a_citizen(self):
        brgy = Barangay.objects.create(name='Test Brgy')
        res = self.client.post('/api/auth/register/', {
            'username': 'newbie', 'first_name': 'New', 'last_name': 'Bie',
            'email': 'newbie@test.com', 'password': 'pass12345', 'password2': 'pass12345',
            'barangay': brgy.id, 'role': 'admin',
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(User.objects.get(email='newbie@test.com').role, UserRole.CITIZEN)
