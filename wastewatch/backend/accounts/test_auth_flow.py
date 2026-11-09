"""
accounts/test_auth_flow.py
--------------------------
Unit and API integration tests for citizen email verification and password reset flows.
"""

from django.test import TestCase
from django.core import mail
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status
from django.utils import timezone

from accounts.models import User, Barangay, UserRole
from accounts.emails import generate_verification_token, generate_password_reset_token


class CitizenAuthFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.brgy = Barangay.objects.create(name='Ibabang Dupay', population=12000)

        # Clear mailbox before each test
        mail.outbox = []

    def test_citizen_registration_success_requires_verification(self):
        url = reverse('api-register')
        payload = {
            'first_name': 'Juan',
            'last_name': 'Dela Cruz',
            'email': 'juan@example.com',
            'phone_number': '09171234567',
            'barangay': self.brgy.id,
            'address_line': 'Purok 4, Maharlika Highway',
            'password': 'SecurePassword123!',
            'password2': 'SecurePassword123!',
            'accept_terms': True,
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(res.json().get('verification_required'))

        # User created with role citizen and unverified email
        user = User.objects.get(email='juan@example.com')
        self.assertEqual(user.role, UserRole.CITIZEN)
        self.assertFalse(user.email_verified)
        self.assertEqual(user.phone_number, '+639171234567')
        self.assertEqual(user.address_line, 'Purok 4, Maharlika Highway')
        self.assertIsNotNone(user.terms_accepted_at)

        # Verification email was dispatched
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('Verify Your Email Address', mail.outbox[0].subject)

    def test_unverified_citizen_cannot_login(self):
        user = User.objects.create_user(
            username='maria',
            email='maria@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            email_verified=False
        )

        res = self.client.post(reverse('api-login'), {
            'email': 'maria@example.com',
            'password': 'Password123!'
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.json().get('code'), 'email_not_verified')

    def test_verified_citizen_can_login(self):
        user = User.objects.create_user(
            username='maria',
            email='maria@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            email_verified=True,
            email_verified_at=timezone.now()
        )

        res = self.client.post(reverse('api-login'), {
            'email': 'maria@example.com',
            'password': 'Password123!'
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('user', res.json())

    def test_already_logged_in_user_cannot_login_again(self):
        user = User.objects.create_user(
            username='pedro_login',
            email='pedro_login@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            email_verified=True
        )
        self.client.force_login(user)

        res = self.client.post(reverse('api-login'), {
            'email': 'pedro_login@example.com',
            'password': 'Password123!'
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.json().get('code'), 'already_authenticated')

    def test_already_logged_in_user_cannot_register(self):
        user = User.objects.create_user(
            username='pedro_reg',
            email='pedro_reg@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            email_verified=True
        )
        self.client.force_login(user)

        res = self.client.post(reverse('api-register'), {
            'email': 'newuser@example.com',
            'password': 'Password123!'
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.json().get('code'), 'already_authenticated')

    def test_staff_and_admin_exempt_from_verification_gate(self):
        # Driver created by admin
        driver = User.objects.create_user(
            username='driver1',
            email='driver@wastewatch.gov.ph',
            password='Password123!',
            role=UserRole.DRIVER,
            email_verified=False
        )

        res = self.client.post(reverse('api-login'), {
            'email': 'driver@wastewatch.gov.ph',
            'password': 'Password123!'
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_verify_email_endpoint(self):
        user = User.objects.create_user(
            username='pedro',
            email='pedro@example.com',
            password='Password123!',
            role=UserRole.CITIZEN,
            email_verified=False
        )

        token = generate_verification_token(user)
        res = self.client.post(reverse('api-verify-email'), {'token': token}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        self.assertIsNotNone(user.email_verified_at)

    def test_forgot_and_reset_password_flow(self):
        user = User.objects.create_user(
            username='ana',
            email='ana@example.com',
            password='OldPassword123!',
            role=UserRole.CITIZEN,
            email_verified=True
        )

        # Request forgot password
        res = self.client.post(reverse('api-forgot-password'), {'email': 'ana@example.com'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)

        # Reset password
        uid, token = generate_password_reset_token(user)
        reset_res = self.client.post(reverse('api-reset-password'), {
            'uid': uid,
            'token': token,
            'password': 'BrandNewPassword123!',
            'password2': 'BrandNewPassword123!',
        }, format='json')
        self.assertEqual(reset_res.status_code, status.HTTP_200_OK)

        # Authenticate with new password
        user.refresh_from_db()
        self.assertTrue(user.check_password('BrandNewPassword123!'))
