"""
Foundational test suite for the WasteWatch Calendar Service (Stage 1A).

Verifies application registration, AppConfig integrity, URL namespace wiring,
absence of premature models or exposed endpoints, and preservation of existing routes.
"""

from django.apps import apps
from django.conf import settings
from django.test import SimpleTestCase
from django.urls import resolve, Resolver404
from rest_framework.test import APISimpleTestCase

import calendar_service.urls as calendar_urls
from calendar_service.apps import CalendarServiceConfig


class CalendarServiceAppFoundationTests(SimpleTestCase):
    """
    Tests for Django application registration, configuration, and architectural boundaries.
    """

    def test_app_is_installed(self):
        """Django registry must recognize calendar_service as an installed application."""
        self.assertTrue(apps.is_installed('calendar_service'))

    def test_app_config_attributes(self):
        """CalendarServiceConfig must load with correct attributes."""
        app_config = apps.get_app_config('calendar_service')
        self.assertIsInstance(app_config, CalendarServiceConfig)
        self.assertEqual(app_config.name, 'calendar_service')
        self.assertEqual(app_config.verbose_name, 'Calendar Service')

    def test_single_registration_in_settings(self):
        """Calendar service must be registered exactly once in INSTALLED_APPS."""
        matched = [
            app for app in settings.INSTALLED_APPS
            if app == 'calendar_service' or app == 'calendar_service.apps.CalendarServiceConfig'
        ]
        self.assertEqual(
            len(matched),
            1,
            f"Expected exactly 1 registration in INSTALLED_APPS, found {len(matched)}: {matched}"
        )

    def test_zero_persistent_models(self):
        """Calendar Service must not define any persistent database models."""
        app_config = apps.get_app_config('calendar_service')
        models = list(app_config.get_models())
        self.assertEqual(
            len(models),
            0,
            f"Calendar Service must have zero models in accordance with Contract v0.2. Found: {models}"
        )

    def test_urls_module_metadata(self):
        """calendar_service.urls must define the canonical app_name and valid urlpatterns."""
        self.assertEqual(getattr(calendar_urls, 'app_name', None), 'calendar_service')
        self.assertIsInstance(calendar_urls.urlpatterns, list)
        self.assertTrue(
            any(getattr(p, 'name', None) == 'calendar-entries' for p in calendar_urls.urlpatterns),
            "urlpatterns must define the 'calendar-entries' route in Stage 1D."
        )


class CalendarServiceURLWiringTests(APISimpleTestCase):
    """
    Tests for URL routing, namespace configuration, and preservation of existing endpoints.
    """

    def test_no_unfinished_api_exposed(self):
        """Unfinished /api/calendar/ endpoint must not resolve to any active view in Stage 1A."""
        with self.assertRaises(Resolver404):
            resolve('/api/calendar/')

    def test_existing_core_routes_preserved(self):
        """Existing application routes must resolve cleanly without interference."""
        # 1. Events API
        match_events = resolve('/api/events/')
        self.assertIsNotNone(match_events.func)

        # 2. Public schedule API
        match_public_sched = resolve('/api/public/schedule/')
        self.assertEqual(match_public_sched.url_name, 'api-public-schedule')

        # 3. News API
        match_news = resolve('/api/news/items/')
        self.assertIsNotNone(match_news.func)

        # 4. Auth Me API
        match_me = resolve('/api/auth/me/')
        self.assertEqual(match_me.url_name, 'api-me')
