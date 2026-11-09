import os
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from wastewatch.settings import _parse_debug_env

User = get_user_model()


class DebugSettingConfigurationTests(TestCase):
    """
    Focused tests for the Django DEBUG boolean parser and authorization isolation.
    """

    def test_debug_environment_parsing_table(self):
        """
        Verify required DEBUG parsing behavior across all required inputs:
        - Unset (None) -> False
        - 'False' -> False
        - 'false' -> False
        - '0' -> False
        - 'True' -> True
        - 'true' -> True
        - '1' -> True
        """
        test_cases = [
            (None, False),
            ('False', False),
            ('false', False),
            ('0', False),
            ('True', True),
            ('true', True),
            ('1', True),
            ('', False),
            ('no', False),
            ('off', False),
            ('random_string', False),
        ]
        for env_val, expected in test_cases:
            with self.subTest(env_val=env_val, expected=expected):
                result = _parse_debug_env(env_val)
                self.assertIs(
                    result,
                    expected,
                    f"Expected _parse_debug_env({env_val!r}) to be {expected}, got {result}",
                )

    def test_dev_reset_requires_admin_even_when_debug_is_true(self):
        """
        Confirm that DEBUG=True never substitutes for application-admin permission.
        An ordinary driver must receive HTTP 403 Forbidden regardless of DEBUG.
        """
        driver = User.objects.create_user(
            username='driver_debug_test',
            password='password123',
            role='driver',
        )
        client = APIClient()
        client.force_authenticate(user=driver)

        with override_settings(DEBUG=True):
            res = client.post('/api/driver/shift/dev-reset/')
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
            self.assertTrue(
                'Admin' in str(res.data) or 'permission' in str(res.data),
                f"Expected permission rejection in response, got: {res.data}"
            )

    def test_dev_reset_rejects_unauthenticated_requests(self):
        """
        Unauthenticated requests must be rejected regardless of DEBUG.
        """
        client = APIClient()
        with override_settings(DEBUG=True):
            res = client.post('/api/driver/shift/dev-reset/')
            self.assertIn(res.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))
