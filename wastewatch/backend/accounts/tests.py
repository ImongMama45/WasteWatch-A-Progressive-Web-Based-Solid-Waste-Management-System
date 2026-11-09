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
            'email': 'newbie@test.com', 'password': 'pass12345Password!', 'password2': 'pass12345Password!',
            'phone_number': '09171234567',
            'accept_terms': True,
            'barangay': brgy.id, 'role': 'admin',
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(User.objects.get(email='newbie@test.com').role, UserRole.CITIZEN)

    def test_admin_list_users_role_all_and_crew(self):
        admin = make_user('admin_test@test.com', role=UserRole.ADMIN)
        self.client.force_authenticate(admin)
        # Create a citizen who is a crew member
        crew_user = make_user('crew_test@test.com', role=UserRole.CITIZEN)
        crew_user.employee_type = 'crew_member'
        crew_user.save()

        # role=all should return all users, not 0
        res_all = self.client.get('/api/accounts/users/', {'role': 'all'})
        self.assertEqual(res_all.status_code, 200)
        results_all = res_all.data.get('results', res_all.data)
        self.assertGreaterEqual(len(results_all), 2)

        # role=crew should return only crew_member
        res_crew = self.client.get('/api/accounts/users/', {'role': 'crew'})
        self.assertEqual(res_crew.status_code, 200)
        results_crew = res_crew.data.get('results', res_crew.data)
        self.assertEqual(len(results_crew), 1)
        self.assertEqual(results_crew[0]['id'], crew_user.id)

        # Admin can toggle crew_member on and off
        res_toggle_off = self.client.patch(f'/api/accounts/users/{crew_user.id}/', {'employee_type': ''}, format='json')
        self.assertEqual(res_toggle_off.status_code, 200)
        crew_user.refresh_from_db()
        self.assertEqual(crew_user.employee_type, '')

        res_toggle_on = self.client.patch(f'/api/accounts/users/{crew_user.id}/', {'employee_type': 'crew_member'}, format='json')
        self.assertEqual(res_toggle_on.status_code, 200)
        crew_user.refresh_from_db()
        self.assertEqual(crew_user.employee_type, 'crew_member')

        # Non-citizen cannot be designated as crew member
        driver_user = make_user('driver_crew_test@test.com', role=UserRole.DRIVER)
        res_driver_crew = self.client.patch(f'/api/accounts/users/{driver_user.id}/', {'employee_type': 'crew_member'}, format='json')
        self.assertEqual(res_driver_crew.status_code, 400)
        self.assertIn('employee_type', res_driver_crew.data)
        driver_user.refresh_from_db()
        self.assertEqual(driver_user.employee_type, '')

    def test_admin_cannot_delete_or_deactivate_admin_accounts(self):
        admin = make_user('admin_guard@test.com', role=UserRole.ADMIN)
        other_admin = make_user('other_admin@test.com', role=UserRole.ADMIN)
        self.client.force_authenticate(admin)

        # 1. Admin cannot delete their own account
        res_del_self = self.client.delete(f'/api/accounts/users/{admin.id}/')
        self.assertEqual(res_del_self.status_code, 400)
        self.assertTrue(User.objects.filter(id=admin.id).exists())

        # 2. Admin cannot delete another admin account
        res_del_other_admin = self.client.delete(f'/api/accounts/users/{other_admin.id}/')
        self.assertEqual(res_del_other_admin.status_code, 400)
        self.assertTrue(User.objects.filter(id=other_admin.id).exists())

        # 3. Admin cannot deactivate their own account
        res_deact_self = self.client.patch(f'/api/accounts/users/{admin.id}/', {'is_active': False}, format='json')
        self.assertEqual(res_deact_self.status_code, 400)
        admin.refresh_from_db()
        self.assertTrue(admin.is_active)

        # 4. Admin cannot edit another admin's account via UserManagement
        res_edit_other_admin = self.client.patch(f'/api/accounts/users/{other_admin.id}/', {'role': 'watcher'}, format='json')
        self.assertEqual(res_edit_other_admin.status_code, 400)
        other_admin.refresh_from_db()
        self.assertEqual(other_admin.role, UserRole.ADMIN)


class BarangayHotspotFilteringTests(APITestCase):
    """
    Step 4.0A.11B: Inactive Hotspot Filtering Tests.
    Ensures that get_active_hotspot_count, get_hotspots, and active_hotspots annotations
    in BarangayManagementViewSet exclude inactive hotspots while preserving them in the database.
    """
    def setUp(self):
        from watcher.models import GarbageHotspot, HotspotSeverity
        self.admin = make_user('admin_brgy@test.com', role=UserRole.ADMIN)
        self.citizen = make_user('citizen_brgy@test.com', role=UserRole.CITIZEN)
        self.brgy1 = Barangay.objects.create(name='Barangay Uno', population=5000)
        self.brgy2 = Barangay.objects.create(name='Barangay Dos', population=3000)

        # In Brgy 1: 2 active hotspots, 1 inactive hotspot
        self.h1_active = GarbageHotspot.objects.create(
            name='Brgy 1 Hotspot Active 1',
            barangay=self.brgy1,
            latitude=13.931,
            longitude=121.612,
            severity=HotspotSeverity.HIGH,
            is_active=True,
        )
        self.h2_active = GarbageHotspot.objects.create(
            name='Brgy 1 Hotspot Active 2',
            barangay=self.brgy1,
            latitude=13.932,
            longitude=121.613,
            severity=HotspotSeverity.MEDIUM,
            is_active=True,
        )
        self.h3_inactive = GarbageHotspot.objects.create(
            name='Brgy 1 Hotspot Inactive',
            barangay=self.brgy1,
            latitude=13.933,
            longitude=121.614,
            severity=HotspotSeverity.LOW,
            is_active=False,
        )

        # In Brgy 2: 1 active hotspot, 2 inactive hotspots
        self.h4_active = GarbageHotspot.objects.create(
            name='Brgy 2 Hotspot Active',
            barangay=self.brgy2,
            latitude=13.940,
            longitude=121.620,
            severity=HotspotSeverity.HIGH,
            is_active=True,
        )
        self.h5_inactive = GarbageHotspot.objects.create(
            name='Brgy 2 Hotspot Inactive 1',
            barangay=self.brgy2,
            latitude=13.941,
            longitude=121.621,
            severity=HotspotSeverity.LOW,
            is_active=False,
        )
        self.h6_inactive = GarbageHotspot.objects.create(
            name='Brgy 2 Hotspot Inactive 2',
            barangay=self.brgy2,
            latitude=13.942,
            longitude=121.622,
            severity=HotspotSeverity.MEDIUM,
            is_active=False,
        )

    def test_barangay_detail_serializer_and_counts_exclude_inactive_hotspots(self):
        """Active hotspot count and hotspot list in detail serializer exclude inactive hotspots."""
        from accounts.serializers import BarangayDetailSerializer

        serializer = BarangayDetailSerializer(self.brgy1)
        data = serializer.data

        # Verify active_hotspot_count only counts active hotspots
        self.assertEqual(data['active_hotspot_count'], 2)

        # Verify hotspots list only includes active hotspots
        returned_hotspot_ids = [h['id'] for h in data['hotspots']]
        self.assertIn(self.h1_active.id, returned_hotspot_ids)
        self.assertIn(self.h2_active.id, returned_hotspot_ids)
        self.assertNotIn(self.h3_inactive.id, returned_hotspot_ids)
        self.assertEqual(len(returned_hotspot_ids), 2)

        # Detail endpoint via API
        self.client.force_authenticate(self.admin)
        res = self.client.get(f'/api/accounts/barangay-management/{self.brgy1.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['active_hotspot_count'], 2)
        api_hotspot_ids = [h['id'] for h in res.data['hotspots']]
        self.assertIn(self.h1_active.id, api_hotspot_ids)
        self.assertIn(self.h2_active.id, api_hotspot_ids)
        self.assertNotIn(self.h3_inactive.id, api_hotspot_ids)

        # Non-admin access check
        self.client.force_authenticate(self.citizen)
        res_denied = self.client.get(f'/api/accounts/barangay-management/{self.brgy1.id}/')
        self.assertEqual(res_denied.status_code, 403)

    def test_barangay_list_annotation_excludes_inactive_hotspots(self):
        """BarangayManagement list endpoint active_hotspots annotation excludes inactive hotspots."""
        self.client.force_authenticate(self.admin)
        res = self.client.get('/api/accounts/barangay-management/')
        self.assertEqual(res.status_code, 200)

        # Match results for brgy1 and brgy2
        results_data = res.data.get('results', res.data)
        brgy1_data = next(b for b in results_data if b['id'] == self.brgy1.id)
        brgy2_data = next(b for b in results_data if b['id'] == self.brgy2.id)

        # Brgy 1 has 3 total hotspots, but only 2 active
        self.assertEqual(brgy1_data['active_hotspots'], 2)
        # Brgy 2 has 3 total hotspots, but only 1 active
        self.assertEqual(brgy2_data['active_hotspots'], 1)

    def test_historical_inactive_hotspots_remain_stored_in_database(self):
        """Inactive hotspots and their relationships remain intact in the database."""
        from watcher.models import GarbageHotspot
        self.assertTrue(GarbageHotspot.objects.filter(id=self.h3_inactive.id, is_active=False).exists())
        self.assertTrue(GarbageHotspot.objects.filter(id=self.h5_inactive.id, is_active=False).exists())
        self.assertTrue(GarbageHotspot.objects.filter(id=self.h6_inactive.id, is_active=False).exists())
        self.assertEqual(self.brgy1.hotspots.count(), 3)
        self.assertEqual(self.brgy2.hotspots.count(), 3)

