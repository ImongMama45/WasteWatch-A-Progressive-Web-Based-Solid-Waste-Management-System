"""
Comprehensive test suite for Stage 1C: MunicipalEvent, NewsItem, and EmergencyAlert integration.

Verifies:
1. MunicipalEvent selection, normalization, visibility matrix (citizen, official, admin),
   preservation of cancelled/completed public lifecycle, and empty barangays = citywide.
2. NewsItem selection, opt-in notice gate (disabled by default), public vs admin visibility,
   barangay scoping, distinct announcement vs news types, and all-day timestamp semantics.
3. EmergencyAlert selection, opt-in notice gate (disabled by default), active vs inactive
   visibility, citywide scoping, emergency_advisory classification, and all-day representation.
"""

from datetime import date, datetime, time, timedelta
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from zoneinfo import ZoneInfo

from accounts.models import Barangay, UserRole
from events.models import EventCategory, EventStatus, MunicipalEvent
from news.models import ContentStatus, EmergencyAlert, NewsCategory, NewsItem, NewsType

from calendar_service.normalizers import (
    MANILA_TZ,
    normalize_emergency_alert,
    normalize_emergency_alerts,
    normalize_municipal_event,
    normalize_municipal_events,
    normalize_news_item,
    normalize_news_items,
)
from calendar_service.selectors import (
    get_normalized_emergency_alerts,
    get_normalized_municipal_events,
    get_normalized_news_items,
    select_emergency_alerts,
    select_municipal_events,
    select_news_items,
)

User = get_user_model()


class MunicipalEventCalendarIntegrationTests(TestCase):
    """A. MunicipalEvent selection, scoping, and normalization tests."""

    @classmethod
    def setUpTestData(cls):
        cls.brgy_isabang = Barangay.objects.create(name='Isabang')
        cls.brgy_cotta = Barangay.objects.create(name='Cotta')

        # Users
        cls.admin_role_user = User.objects.create_user(
            username='admin_role_c',
            email='admin_role_c@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.ADMIN,
            is_staff=False,
        )
        cls.django_staff_user = User.objects.create_user(
            username='staff_user_c',
            email='staff_c@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.CITIZEN,
            is_staff=True,
        )
        cls.official_isabang = User.objects.create_user(
            username='official_isabang_c',
            email='official_isabang_c@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.BRGY_OFFICIAL,
            barangay=cls.brgy_isabang,
        )
        cls.citizen_user = User.objects.create_user(
            username='citizen_c',
            email='citizen_c@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.CITIZEN,
            barangay=cls.brgy_isabang,
        )

        cls.start_dt = datetime(2026, 11, 15, 8, 0, tzinfo=MANILA_TZ)
        cls.end_dt = datetime(2026, 11, 15, 12, 0, tzinfo=MANILA_TZ)

        # 1. Citywide published event (empty barangays)
        cls.citywide_event = MunicipalEvent.objects.create(
            title='Lucena Grand Clean-up Drive',
            description='Citywide cleanup initiative.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Lucena City Plaza',
            category=EventCategory.CLEANUP,
            status=EventStatus.PUBLISHED,
        )

        # 2. Barangay-specific published event (Isabang)
        cls.isabang_event = MunicipalEvent.objects.create(
            title='Isabang Composting Workshop',
            description='Community orientation on segregation.',
            start_datetime=cls.start_dt + timedelta(days=1),
            end_datetime=cls.end_dt + timedelta(days=1),
            location='Isabang Covered Court',
            category=EventCategory.WORKSHOP,
            status=EventStatus.PUBLISHED,
        )
        cls.isabang_event.barangays.add(cls.brgy_isabang)

        # 3. Barangay-specific published event (Cotta)
        cls.cotta_event = MunicipalEvent.objects.create(
            title='Cotta Coastal Cleanup',
            description='Mangrove clearing along coast.',
            start_datetime=cls.start_dt + timedelta(days=2),
            end_datetime=cls.end_dt + timedelta(days=2),
            location='Cotta Port',
            category=EventCategory.CLEANUP,
            status=EventStatus.PUBLISHED,
        )
        cls.cotta_event.barangays.add(cls.brgy_cotta)

        # 4. Draft event (Citywide)
        cls.draft_event = MunicipalEvent.objects.create(
            title='Upcoming Seminar Draft',
            description='Internal draft proposal.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Lucena City Hall',
            category=EventCategory.WORKSHOP,
            status=EventStatus.DRAFT,
        )

        # 5. Archived event
        cls.archived_event = MunicipalEvent.objects.create(
            title='Old Archived Event',
            description='Archived event record.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Lucena City Hall',
            category=EventCategory.GENERAL,
            status=EventStatus.ARCHIVED,
        )

        # 6. Cancelled public event
        cls.cancelled_event = MunicipalEvent.objects.create(
            title='Cancelled Meeting',
            description='Public notice of cancellation.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Lucena City Hall',
            category=EventCategory.COMMUNITY_MEETING,
            status=EventStatus.CANCELLED,
        )

        # 7. Completed public event
        cls.completed_event = MunicipalEvent.objects.create(
            title='Completed Orientation',
            description='Successfully concluded event.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Lucena City Hall',
            category=EventCategory.WORKSHOP,
            status=EventStatus.COMPLETED,
        )

    def test_published_citywide_and_barangay_visibility_for_public(self):
        """Anonymous and Citizen users see published, cancelled, and completed public events."""
        events = select_municipal_events(
            start_date=date(2026, 11, 14),
            end_date=date(2026, 11, 20),
            user=self.citizen_user,
        )
        ids = [e.id for e in events]

        self.assertIn(self.citywide_event.id, ids)
        self.assertIn(self.isabang_event.id, ids)
        self.assertIn(self.cotta_event.id, ids)
        self.assertIn(self.cancelled_event.id, ids)
        self.assertIn(self.completed_event.id, ids)

        # Drafts and archived must NEVER leak to public
        self.assertNotIn(self.draft_event.id, ids)
        self.assertNotIn(self.archived_event.id, ids)

    def test_empty_barangay_treated_as_citywide_for_municipal_event(self):
        """MunicipalEvent with empty barangays is normalized as scope='citywide' and is_citywide=True."""
        entry = normalize_municipal_event(self.citywide_event)
        self.assertEqual(entry['scope'], 'citywide')
        self.assertTrue(entry['is_citywide'])
        self.assertEqual(entry['location'], 'Lucena City Plaza')
        self.assertEqual(entry['barangays'], [])

    def test_barangay_official_cannot_see_other_barangays_events(self):
        """Barangay Official is strictly locked to citywide + own barangay; cross-barangay blocked."""
        # Querying with own user context
        events = select_municipal_events(
            start_date=date(2026, 11, 14),
            end_date=date(2026, 11, 20),
            user=self.official_isabang,
        )
        ids = [e.id for e in events]

        self.assertIn(self.citywide_event.id, ids)
        self.assertIn(self.isabang_event.id, ids)
        # Cannot see Cotta event
        self.assertNotIn(self.cotta_event.id, ids)

        # Cross-barangay attempt (passing Cotta's barangay_id parameter) is blocked
        manipulated = select_municipal_events(
            start_date=date(2026, 11, 14),
            end_date=date(2026, 11, 20),
            user=self.official_isabang,
            barangay_id=self.brgy_cotta.id,
        )
        m_ids = [e.id for e in manipulated]
        self.assertNotIn(self.cotta_event.id, m_ids)

    def test_admin_visibility_includes_drafts_and_archives(self):
        """Admin users (both role='admin' and is_staff=True) can access drafts and archived events."""
        for admin in [self.admin_role_user, self.django_staff_user]:
            events = select_municipal_events(
                start_date=date(2026, 11, 14),
                end_date=date(2026, 11, 20),
                user=admin,
            )
            ids = [e.id for e in events]
            self.assertIn(self.draft_event.id, ids)
            self.assertIn(self.archived_event.id, ids)
            self.assertIn(self.citywide_event.id, ids)

    def test_normalized_municipal_event_schema(self):
        """Normalized entry conforms to the canonical CalendarEntry contract."""
        entry = normalize_municipal_event(self.isabang_event)
        self.assertEqual(entry['id'], f'event_{self.isabang_event.id}')
        self.assertEqual(entry['source'], 'municipal_event')
        self.assertEqual(entry['source_id'], self.isabang_event.id)
        self.assertEqual(entry['entry_type'], 'municipal_event')
        self.assertEqual(entry['title'], 'Isabang Composting Workshop')
        self.assertEqual(entry['scope'], 'barangay')
        self.assertFalse(entry['is_citywide'])
        self.assertEqual(entry['category'], EventCategory.WORKSHOP)
        self.assertEqual(entry['category_display'], 'Public Orientation & Seminar')
        self.assertEqual(entry['status'], EventStatus.PUBLISHED)
        self.assertEqual(entry['barangays'], [self.brgy_isabang.id])
        self.assertEqual(entry['barangay_details'], [{'id': self.brgy_isabang.id, 'name': 'Isabang'}])
        self.assertFalse(entry['all_day'])
        self.assertTrue(entry['start'].endswith('+08:00'))


class NewsItemCalendarIntegrationTests(TestCase):
    """B. NewsItem announcement and news selection and normalization tests."""

    @classmethod
    def setUpTestData(cls):
        cls.brgy_isabang = Barangay.objects.create(name='Isabang')
        cls.brgy_cotta = Barangay.objects.create(name='Cotta')

        cls.admin_user = User.objects.create_user(
            username='news_admin',
            email='news_admin@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.ADMIN,
        )
        cls.citizen_user = User.objects.create_user(
            username='news_citizen',
            email='news_citizen@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.CITIZEN,
        )

        cls.pub_date = date(2026, 11, 16)

        # 1. Citywide announcement
        cls.citywide_announcement = NewsItem.objects.create(
            title='Citywide Holiday Collection Advisory',
            description='No pickup on city charter day.',
            type=NewsType.ANNOUNCEMENT,
            category=NewsCategory.ANNOUNCEMENTS,
            status=ContentStatus.PUBLISHED,
            is_active=True,
        )

        # 2. Barangay-specific news
        cls.isabang_news = NewsItem.objects.create(
            title='Isabang Model Barangay Award',
            description='Recognized for 90% waste diversion.',
            type=NewsType.NEWS,
            category=NewsCategory.NEWS,
            status=ContentStatus.PUBLISHED,
            is_active=True,
            barangay=cls.brgy_isabang,
        )

        # 3. Draft news item
        cls.draft_news = NewsItem.objects.create(
            title='Unpublished Announcement Draft',
            description='Draft text.',
            type=NewsType.ANNOUNCEMENT,
            category=NewsCategory.ANNOUNCEMENTS,
            status=ContentStatus.DRAFT,
            is_active=False,
        )

        # 4. Archived news item
        cls.archived_news = NewsItem.objects.create(
            title='Archived Announcement',
            description='Old announcement.',
            type=NewsType.ANNOUNCEMENT,
            category=NewsCategory.ANNOUNCEMENTS,
            status=ContentStatus.ARCHIVED,
            is_active=False,
        )

        NewsItem.objects.filter(
            id__in=[
                cls.citywide_announcement.id,
                cls.isabang_news.id,
                cls.draft_news.id,
                cls.archived_news.id,
            ]
        ).update(date=cls.pub_date)
        cls.citywide_announcement.refresh_from_db()
        cls.isabang_news.refresh_from_db()
        cls.draft_news.refresh_from_db()
        cls.archived_news.refresh_from_db()

    def test_notices_disabled_by_default(self):
        """NewsItem notices are optional and must return empty list when include_notices=False."""
        items_default = select_news_items(
            start_date=date(2026, 11, 10),
            end_date=date(2026, 11, 20),
            user=self.citizen_user,
            include_notices=False,
        )
        self.assertEqual(items_default, [])

    def test_enabled_notices_include_published_and_isolate_drafts(self):
        """When enabled, public queries see published active items and never drafts or archives."""
        items = select_news_items(
            start_date=date(2026, 11, 10),
            end_date=date(2026, 11, 20),
            user=self.citizen_user,
            include_notices=True,
        )
        ids = [i.id for i in items]

        self.assertIn(self.citywide_announcement.id, ids)
        self.assertIn(self.isabang_news.id, ids)
        self.assertNotIn(self.draft_news.id, ids)
        self.assertNotIn(self.archived_news.id, ids)

    def test_admin_can_access_draft_and_archived_notices(self):
        """Admin user with include_notices=True can access draft and archived notices."""
        items = select_news_items(
            start_date=date(2026, 11, 10),
            end_date=date(2026, 11, 20),
            user=self.admin_user,
            include_notices=True,
        )
        ids = [i.id for i in items]
        self.assertIn(self.draft_news.id, ids)
        self.assertIn(self.archived_news.id, ids)

    def test_announcement_and_news_distinction(self):
        """Announcement has entry_type='announcement', while News has entry_type='news'."""
        entry_announcement = normalize_news_item(self.citywide_announcement)
        entry_news = normalize_news_item(self.isabang_news)

        self.assertEqual(entry_announcement['entry_type'], 'announcement')
        self.assertEqual(entry_news['entry_type'], 'news')

    def test_notice_timestamp_semantics_is_all_day_not_activity_schedule(self):
        """Notices are all-day informational entries without fabricated activity times."""
        entry = normalize_news_item(self.citywide_announcement)
        self.assertTrue(entry['all_day'])
        self.assertEqual(entry['start'], '2026-11-16T00:00:00+08:00')
        self.assertEqual(entry['end'], '2026-11-16T23:59:59+08:00')


class EmergencyAlertCalendarIntegrationTests(TestCase):
    """C. EmergencyAlert advisory selection and normalization tests."""

    @classmethod
    def setUpTestData(cls):
        cls.citizen_user = User.objects.create_user(
            username='alert_citizen',
            email='alert_citizen@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.CITIZEN,
        )
        cls.admin_user = User.objects.create_user(
            username='alert_admin',
            email='alert_admin@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.ADMIN,
        )

        cls.alert_date = date(2026, 11, 16)

        # 1. Active emergency alert
        cls.active_alert = EmergencyAlert.objects.create(
            title='Typhoon Signal No. 2 Warning',
            body='Collection services suspended during storm.',
            is_active=True,
        )

        # 2. Inactive emergency alert
        cls.inactive_alert = EmergencyAlert.objects.create(
            title='Old Flood Advisory Lifted',
            body='Normal operations resumed.',
            is_active=False,
        )

        EmergencyAlert.objects.filter(
            id__in=[cls.active_alert.id, cls.inactive_alert.id]
        ).update(date=cls.alert_date)
        cls.active_alert.refresh_from_db()
        cls.inactive_alert.refresh_from_db()

    def test_emergency_alerts_disabled_by_default(self):
        """EmergencyAlerts are optional and return empty list when include_notices=False."""
        alerts = select_emergency_alerts(
            start_date=date(2026, 11, 10),
            end_date=date(2026, 11, 20),
            user=self.citizen_user,
            include_notices=False,
        )
        self.assertEqual(alerts, [])

    def test_enabled_alerts_include_active_only_for_public(self):
        """When enabled, non-admin queries see active alerts and never inactive alerts."""
        alerts = select_emergency_alerts(
            start_date=date(2026, 11, 10),
            end_date=date(2026, 11, 20),
            user=self.citizen_user,
            include_notices=True,
        )
        ids = [a.id for a in alerts]
        self.assertIn(self.active_alert.id, ids)
        self.assertNotIn(self.inactive_alert.id, ids)

    def test_admin_can_access_inactive_alerts(self):
        """Admin can access inactive alerts when notices are enabled."""
        alerts = select_emergency_alerts(
            start_date=date(2026, 11, 10),
            end_date=date(2026, 11, 20),
            user=self.admin_user,
            include_notices=True,
        )
        ids = [a.id for a in alerts]
        self.assertIn(self.active_alert.id, ids)
        self.assertIn(self.inactive_alert.id, ids)

    def test_normalized_emergency_alert_schema(self):
        """EmergencyAlert normalizes to all-day emergency_advisory entry."""
        entry = normalize_emergency_alert(self.active_alert)
        self.assertEqual(entry['id'], f'alert_{self.active_alert.id}')
        self.assertEqual(entry['source'], 'emergency_alert')
        self.assertEqual(entry['entry_type'], 'emergency_advisory')
        self.assertEqual(entry['title'], 'Typhoon Signal No. 2 Warning')
        self.assertEqual(entry['scope'], 'citywide')
        self.assertTrue(entry['is_citywide'])
        self.assertTrue(entry['all_day'])
        self.assertEqual(entry['status'], 'active')
        self.assertEqual(entry['start'], '2026-11-16T00:00:00+08:00')
        self.assertEqual(entry['end'], '2026-11-16T23:59:59+08:00')


class OperationalRolesStage1CAuthorizationTests(TestCase):
    """
    Targeted authorization and sanitization tests for operational roles:
    - Watcher (UserRole.WATCHER)
    - Driver (UserRole.DRIVER)
    - Dumpsite Operator (UserRole.DUMPSITE)

    Verifies:
    1. Operational accounts are strictly non-admin and receive public-calendar visibility only.
    2. MunicipalEvent: published, cancelled, and completed public events are visible; drafts/archives are excluded.
    3. NewsItem & EmergencyAlert: notices are opt-in (disabled by default); when enabled, only published/active
       notices are visible; draft, archived, or inactive notices are excluded.
    4. Scoping: explicit barangay filters are respected without cross-barangay leakage.
    5. Sanitization: normalized outputs do not expose driver IDs, truck plates, dumpsite coords, raw GPS/waypoints,
       or private administrative/author metadata.
    """

    @classmethod
    def setUpTestData(cls):
        cls.brgy_isabang = Barangay.objects.create(name='Isabang')
        cls.brgy_cotta = Barangay.objects.create(name='Cotta')

        # Operational users
        cls.watcher_user = User.objects.create_user(
            username='op_watcher',
            email='op_watcher@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.WATCHER,
            barangay=cls.brgy_isabang,
            is_staff=False,
        )
        cls.driver_user = User.objects.create_user(
            username='op_driver',
            email='op_driver@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.DRIVER,
            barangay=cls.brgy_isabang,
            is_staff=False,
        )
        cls.dumpsite_user = User.objects.create_user(
            username='op_dumpsite',
            email='op_dumpsite@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.DUMPSITE,
            barangay=None,
            is_staff=False,
        )

        cls.operational_users = [
            cls.watcher_user,
            cls.driver_user,
            cls.dumpsite_user,
        ]

        cls.start_dt = datetime(2026, 11, 15, 8, 0, tzinfo=MANILA_TZ)
        cls.end_dt = datetime(2026, 11, 15, 12, 0, tzinfo=MANILA_TZ)

        # Municipal Events
        cls.event_citywide_published = MunicipalEvent.objects.create(
            title='Lucena Public City Clean-up',
            description='Citywide event.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Lucena City Plaza',
            category=EventCategory.CLEANUP,
            status=EventStatus.PUBLISHED,
        )

        cls.event_isabang_published = MunicipalEvent.objects.create(
            title='Isabang Community Orientation',
            description='Orientation event.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Isabang Covered Court',
            category=EventCategory.WORKSHOP,
            status=EventStatus.PUBLISHED,
        )
        cls.event_isabang_published.barangays.add(cls.brgy_isabang)

        cls.event_cotta_published = MunicipalEvent.objects.create(
            title='Cotta Coastal Cleanup',
            description='Coastal cleanup event.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Cotta Port',
            category=EventCategory.CLEANUP,
            status=EventStatus.PUBLISHED,
        )
        cls.event_cotta_published.barangays.add(cls.brgy_cotta)

        cls.event_cancelled = MunicipalEvent.objects.create(
            title='Cancelled Orientation',
            description='Cancelled event notice.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Lucena City Hall',
            category=EventCategory.GENERAL,
            status=EventStatus.CANCELLED,
        )

        cls.event_completed = MunicipalEvent.objects.create(
            title='Concluded Clean-up Drive',
            description='Completed event record.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Lucena City Hall',
            category=EventCategory.CLEANUP,
            status=EventStatus.COMPLETED,
        )

        cls.event_draft = MunicipalEvent.objects.create(
            title='Draft Private Event',
            description='Internal draft.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Lucena City Hall',
            category=EventCategory.GENERAL,
            status=EventStatus.DRAFT,
        )

        cls.event_archived = MunicipalEvent.objects.create(
            title='Archived Old Event',
            description='Archived record.',
            start_datetime=cls.start_dt,
            end_datetime=cls.end_dt,
            location='Lucena City Hall',
            category=EventCategory.GENERAL,
            status=EventStatus.ARCHIVED,
        )

        # News Items
        cls.pub_date = date(2026, 11, 16)
        cls.news_citywide_published = NewsItem.objects.create(
            title='Citywide Waste Advisory',
            description='Public notice.',
            type=NewsType.ANNOUNCEMENT,
            category=NewsCategory.ANNOUNCEMENTS,
            status=ContentStatus.PUBLISHED,
            is_active=True,
        )
        cls.news_isabang_published = NewsItem.objects.create(
            title='Isabang Waste Segregation Drive',
            description='Barangay notice.',
            type=NewsType.NEWS,
            category=NewsCategory.NEWS,
            status=ContentStatus.PUBLISHED,
            is_active=True,
            barangay=cls.brgy_isabang,
        )
        cls.news_cotta_published = NewsItem.objects.create(
            title='Cotta Waste Collection Notice',
            description='Barangay notice.',
            type=NewsType.NEWS,
            category=NewsCategory.NEWS,
            status=ContentStatus.PUBLISHED,
            is_active=True,
            barangay=cls.brgy_cotta,
        )
        cls.news_draft = NewsItem.objects.create(
            title='Draft Admin News',
            description='Draft item.',
            type=NewsType.ANNOUNCEMENT,
            category=NewsCategory.ANNOUNCEMENTS,
            status=ContentStatus.DRAFT,
            is_active=False,
        )
        cls.news_archived = NewsItem.objects.create(
            title='Archived Old News',
            description='Archived item.',
            type=NewsType.ANNOUNCEMENT,
            category=NewsCategory.ANNOUNCEMENTS,
            status=ContentStatus.ARCHIVED,
            is_active=False,
        )
        cls.news_inactive_published = NewsItem.objects.create(
            title='Deactivated Published News',
            description='Inactive item.',
            type=NewsType.NEWS,
            category=NewsCategory.NEWS,
            status=ContentStatus.PUBLISHED,
            is_active=False,
        )

        NewsItem.objects.filter(
            id__in=[
                cls.news_citywide_published.id,
                cls.news_isabang_published.id,
                cls.news_cotta_published.id,
                cls.news_draft.id,
                cls.news_archived.id,
                cls.news_inactive_published.id,
            ]
        ).update(date=cls.pub_date)

        cls.news_citywide_published.refresh_from_db()
        cls.news_isabang_published.refresh_from_db()
        cls.news_cotta_published.refresh_from_db()
        cls.news_draft.refresh_from_db()
        cls.news_archived.refresh_from_db()
        cls.news_inactive_published.refresh_from_db()

        # Emergency Alerts
        cls.alert_active = EmergencyAlert.objects.create(
            title='Typhoon Public Advisory',
            body='Public advisory alert text.',
            is_active=True,
        )
        cls.alert_inactive = EmergencyAlert.objects.create(
            title='Old Lifted Warning',
            body='Deactivated alert text.',
            is_active=False,
        )

        EmergencyAlert.objects.filter(
            id__in=[cls.alert_active.id, cls.alert_inactive.id]
        ).update(date=cls.pub_date)

        cls.alert_active.refresh_from_db()
        cls.alert_inactive.refresh_from_db()

    def test_operational_roles_municipal_events_visibility(self):
        """Watcher, Driver, and Dumpsite operators receive public MunicipalEvent visibility only."""
        for user in self.operational_users:
            with self.subTest(role=user.role):
                # 1. Broad query (no barangay filter)
                events = select_municipal_events(
                    start_date=date(2026, 11, 14),
                    end_date=date(2026, 11, 20),
                    user=user,
                )
                ids = [e.id for e in events]

                # Public visible events included
                self.assertIn(self.event_citywide_published.id, ids)
                self.assertIn(self.event_isabang_published.id, ids)
                self.assertIn(self.event_cotta_published.id, ids)
                self.assertIn(self.event_cancelled.id, ids)
                self.assertIn(self.event_completed.id, ids)

                # Internal non-public events strictly isolated
                self.assertNotIn(self.event_draft.id, ids)
                self.assertNotIn(self.event_archived.id, ids)

                # 2. Filtered query by specific barangay (Isabang)
                filtered_events = select_municipal_events(
                    start_date=date(2026, 11, 14),
                    end_date=date(2026, 11, 20),
                    user=user,
                    barangay_id=self.brgy_isabang.id,
                )
                f_ids = [e.id for e in filtered_events]
                self.assertIn(self.event_citywide_published.id, f_ids)
                self.assertIn(self.event_isabang_published.id, f_ids)
                self.assertNotIn(self.event_cotta_published.id, f_ids)

    def test_operational_roles_notices_disabled_by_default(self):
        """Notices remain opt-in and return empty lists for operational roles when include_notices=False."""
        for user in self.operational_users:
            with self.subTest(role=user.role):
                news = select_news_items(
                    start_date=date(2026, 11, 10),
                    end_date=date(2026, 11, 20),
                    user=user,
                    include_notices=False,
                )
                self.assertEqual(news, [])

                alerts = select_emergency_alerts(
                    start_date=date(2026, 11, 10),
                    end_date=date(2026, 11, 20),
                    user=user,
                    include_notices=False,
                )
                self.assertEqual(alerts, [])

    def test_operational_roles_news_items_visibility_when_enabled(self):
        """With include_notices=True, operational roles see only published active news."""
        for user in self.operational_users:
            with self.subTest(role=user.role):
                items = select_news_items(
                    start_date=date(2026, 11, 10),
                    end_date=date(2026, 11, 20),
                    user=user,
                    include_notices=True,
                )
                ids = [i.id for i in items]

                self.assertIn(self.news_citywide_published.id, ids)
                self.assertIn(self.news_isabang_published.id, ids)
                self.assertIn(self.news_cotta_published.id, ids)

                # Draft, archived, and inactive items never leak
                self.assertNotIn(self.news_draft.id, ids)
                self.assertNotIn(self.news_archived.id, ids)
                self.assertNotIn(self.news_inactive_published.id, ids)

                # Barangay scope filtering
                scoped_items = select_news_items(
                    start_date=date(2026, 11, 10),
                    end_date=date(2026, 11, 20),
                    user=user,
                    barangay_id=self.brgy_isabang.id,
                    include_notices=True,
                )
                s_ids = [i.id for i in scoped_items]
                self.assertIn(self.news_citywide_published.id, s_ids)
                self.assertIn(self.news_isabang_published.id, s_ids)
                self.assertNotIn(self.news_cotta_published.id, s_ids)

    def test_operational_roles_emergency_alerts_visibility_when_enabled(self):
        """With include_notices=True, operational roles see only active alerts."""
        for user in self.operational_users:
            with self.subTest(role=user.role):
                alerts = select_emergency_alerts(
                    start_date=date(2026, 11, 10),
                    end_date=date(2026, 11, 20),
                    user=user,
                    include_notices=True,
                )
                ids = [a.id for a in alerts]

                self.assertIn(self.alert_active.id, ids)
                self.assertNotIn(self.alert_inactive.id, ids)

    def test_operational_roles_sanitization_guarantees(self):
        """Normalized dictionaries for operational callers contain no sensitive operational metadata."""
        disallowed_keys = {
            'driver', 'driver_id', 'driver_name',
            'truck', 'truck_id', 'plate_number', 'registration_plate',
            'dumpsite', 'dumpsite_id', 'dumpsite_coordinates',
            'gps', 'raw_gps', 'waypoints', 'route_geometry',
            'author', 'author_id', 'created_by', 'created_by_id',
        }

        for user in self.operational_users:
            with self.subTest(role=user.role):
                # MunicipalEvent normalized entries
                norm_events = get_normalized_municipal_events(
                    start_date=date(2026, 11, 14),
                    end_date=date(2026, 11, 20),
                    user=user,
                )
                for entry in norm_events:
                    entry_keys = set(entry.keys()) | set(entry.get('metadata', {}).keys())
                    self.assertTrue(disallowed_keys.isdisjoint(entry_keys))
                    self.assertIn('title', entry)
                    self.assertIn('start_datetime', entry)
                    self.assertIn('location', entry)

                # NewsItem normalized entries
                norm_news = get_normalized_news_items(
                    start_date=date(2026, 11, 10),
                    end_date=date(2026, 11, 20),
                    user=user,
                    include_notices=True,
                )
                for entry in norm_news:
                    entry_keys = set(entry.keys()) | set(entry.get('metadata', {}).keys())
                    self.assertTrue(disallowed_keys.isdisjoint(entry_keys))
                    self.assertIn('title', entry)
                    self.assertIn('start_datetime', entry)
                    self.assertIn('all_day', entry)

                # EmergencyAlert normalized entries
                norm_alerts = get_normalized_emergency_alerts(
                    start_date=date(2026, 11, 10),
                    end_date=date(2026, 11, 20),
                    user=user,
                    include_notices=True,
                )
                for entry in norm_alerts:
                    entry_keys = set(entry.keys()) | set(entry.get('metadata', {}).keys())
                    self.assertTrue(disallowed_keys.isdisjoint(entry_keys))
                    self.assertIn('title', entry)
                    self.assertIn('scope', entry)
                    self.assertEqual(entry['scope'], 'citywide')
