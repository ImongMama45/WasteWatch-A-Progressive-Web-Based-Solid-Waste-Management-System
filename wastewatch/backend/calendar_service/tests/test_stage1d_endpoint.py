"""
Comprehensive test suite for Stage 1D: Unified Calendar Aggregator and Public DRF Endpoint.

Covers:
1. Endpoint basics (URL resolution, safe HTTP methods, date bounds validation).
2. Multi-source aggregation and notice opt-in gating.
3. Deterministic global sorting (datetime, priority, source, source_id) and pagination.
4. Parameter validation, query filters, and strict boolean parsing.
5. Authorization and visibility matrix (Anonymous, Citizen, Brgy Official, Watcher,
   Driver, Dumpsite Operator, Admin, Staff).
6. Capacity limits (100 recurring templates -> 503, 31-day unpaginated limit, 250-entry unpaginated limit).
7. Database query efficiency and N+1 prevention.
"""

from datetime import date, datetime, time, timedelta
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from zoneinfo import ZoneInfo

from accounts.models import Barangay, UserRole
from driver.models import CollectionSchedule, Truck
from events.models import EventCategory, EventStatus, MunicipalEvent
from news.models import ContentStatus, EmergencyAlert, NewsCategory, NewsItem, NewsType
from calendar_service.exceptions import CalendarCapacityError

User = get_user_model()
MANILA_TZ = ZoneInfo('Asia/Manila')


class CalendarEndpointBasicsTests(APITestCase):
    """1. Endpoint HTTP basics and parameter validation."""

    def setUp(self):
        self.url = '/api/calendar/entries/'
        self.brgy = Barangay.objects.create(name='Ibabang Dupay')

    def test_url_resolves_and_get_succeeds(self):
        """GET /api/calendar/entries/ returns HTTP 200 with required date parameters."""
        response = self.client.get(self.url, {
            'start_date': '2026-11-10',
            'end_date': '2026-11-16',
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('results', response.data)
        self.assertIn('count', response.data)

    def test_unsafe_http_methods_rejected(self):
        """POST, PUT, PATCH, DELETE operations return HTTP 405 Method Not Allowed."""
        payload = {'title': 'Test'}
        self.assertEqual(self.client.post(self.url, payload).status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertEqual(self.client.put(self.url, payload).status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertEqual(self.client.patch(self.url, payload).status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_missing_required_dates_rejected(self):
        """Missing start_date or end_date returns HTTP 400."""
        # Missing start_date
        res1 = self.client.get(self.url, {'end_date': '2026-11-20'})
        self.assertEqual(res1.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('start_date', res1.data)

        # Missing end_date
        res2 = self.client.get(self.url, {'start_date': '2026-11-10'})
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('end_date', res2.data)

    def test_malformed_dates_rejected(self):
        """Invalid date formats return HTTP 400 Bad Request."""
        res = self.client.get(self.url, {
            'start_date': 'not-a-date',
            'end_date': '2026/11/20',
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_inverted_dates_rejected(self):
        """start_date after end_date returns HTTP 400 Bad Request."""
        res = self.client.get(self.url, {
            'start_date': '2026-11-20',
            'end_date': '2026-11-10',
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('date_range', res.data)

    def test_date_range_93_days_boundary(self):
        """Exactly 93 inclusive calendar days is accepted; 94 days is rejected."""
        start = date(2026, 1, 1)
        valid_93 = start + timedelta(days=92)  # 93 inclusive days
        invalid_94 = start + timedelta(days=93)  # 94 inclusive days

        res_valid = self.client.get(self.url, {
            'start_date': start.isoformat(),
            'end_date': valid_93.isoformat(),
        })
        self.assertEqual(res_valid.status_code, status.HTTP_200_OK)

        res_invalid = self.client.get(self.url, {
            'start_date': start.isoformat(),
            'end_date': invalid_94.isoformat(),
        })
        self.assertEqual(res_invalid.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('date_range', res_invalid.data)


class CalendarSourceAggregationTests(APITestCase):
    """2. Source aggregation and notice opt-in gating."""

    @classmethod
    def setUpTestData(cls):
        cls.url = '/api/calendar/entries/'
        cls.brgy = Barangay.objects.create(name='Gulang-Gulang')

        cls.truck = Truck.objects.create(plate_number='LCN-555')

        # 1. Collection Schedule (Recurring Monday)
        cls.schedule = CollectionSchedule.objects.create(
            truck=cls.truck,
            days='Mon',
            start_time=time(8, 0),
            end_time=time(10, 0),
            frequency='Weekly',
            status='PENDING',
            waypoints=[{'lat': 13.9, 'lng': 121.6}],
        )
        cls.schedule.barangays.add(cls.brgy)

        # 2. Municipal Event
        cls.event = MunicipalEvent.objects.create(
            title='Tree Planting Activity',
            description='Community greening.',
            start_datetime=datetime(2026, 11, 16, 9, 0, tzinfo=MANILA_TZ),
            end_datetime=datetime(2026, 11, 16, 12, 0, tzinfo=MANILA_TZ),
            location='Lucena City Park',
            category=EventCategory.TREE_PLANTING,
            status=EventStatus.PUBLISHED,
        )

        # 3. News Item Announcement
        cls.news = NewsItem.objects.create(
            title='Advisory on Route Adjustments',
            description='Holiday schedule in effect.',
            type=NewsType.ANNOUNCEMENT,
            category=NewsCategory.ANNOUNCEMENTS,
            status=ContentStatus.PUBLISHED,
            is_active=True,
        )

        # 4. Emergency Alert
        cls.alert = EmergencyAlert.objects.create(
            title='Typhoon Signal Alert',
            body='Collection operations suspended.',
            is_active=True,
        )

        target_date = date(2026, 11, 16)
        NewsItem.objects.filter(id=cls.news.id).update(date=target_date)
        EmergencyAlert.objects.filter(id=cls.alert.id).update(date=target_date)
        cls.news.refresh_from_db()
        cls.alert.refresh_from_db()

    def test_notices_excluded_by_default(self):
        """By default, notices (NewsItem and EmergencyAlert) are excluded from the aggregated feed."""
        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        sources = [item['source'] for item in res.data['results']]

        self.assertIn('collection_schedule', sources)
        self.assertIn('municipal_event', sources)
        self.assertNotIn('news_item', sources)
        self.assertNotIn('emergency_alert', sources)

    def test_notices_included_when_requested(self):
        """When include_notices=true, NewsItems and EmergencyAlerts are included."""
        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'include_notices': 'true',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        sources = [item['source'] for item in res.data['results']]

        self.assertIn('collection_schedule', sources)
        self.assertIn('municipal_event', sources)
        self.assertIn('news_item', sources)
        self.assertIn('emergency_alert', sources)

    def test_distinct_entry_types_preserved(self):
        """Aggregator preserves distinct canonical entry_type values."""
        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'include_notices': '1',
        })
        entry_types = {item['entry_type'] for item in res.data['results']}
        self.assertIn('collection_schedule', entry_types)
        self.assertIn('municipal_event', entry_types)
        self.assertIn('announcement', entry_types)
        self.assertIn('emergency_advisory', entry_types)


class CalendarGlobalSortingAndPaginationTests(APITestCase):
    """3. Deterministic global sorting and pagination mechanics."""

    @classmethod
    def setUpTestData(cls):
        cls.url = '/api/calendar/entries/'
        cls.brgy = Barangay.objects.create(name='Cotta')
        cls.truck = Truck.objects.create(plate_number='LCN-777')

        # We create concurrent occurrences on 2026-11-16 at 00:00:00 to test tie-breaking
        # Priority ranking: emergency_advisory (0) < municipal_event (1) < collection_schedule (2) < announcement (3)

        cls.alert = EmergencyAlert.objects.create(
            title='Alert Priority 0',
            body='Emergency alert.',
            is_active=True,
        )
        cls.event = MunicipalEvent.objects.create(
            title='Event Priority 1',
            description='Municipal event.',
            start_datetime=datetime(2026, 11, 16, 0, 0, tzinfo=MANILA_TZ),
            end_datetime=datetime(2026, 11, 16, 1, 0, tzinfo=MANILA_TZ),
            location='Lucena City Hall',
            category=EventCategory.GENERAL,
            status=EventStatus.PUBLISHED,
        )
        cls.sched = CollectionSchedule.objects.create(
            truck=cls.truck,
            days='Mon',
            start_time=time(0, 0),
            end_time=time(1, 0),
            frequency='Weekly',
            status='PENDING',
            waypoints=[{'lat': 13.9, 'lng': 121.6}],
        )
        cls.sched.barangays.add(cls.brgy)

        cls.news = NewsItem.objects.create(
            title='Announcement Priority 3',
            description='Civic announcement.',
            type=NewsType.ANNOUNCEMENT,
            category=NewsCategory.ANNOUNCEMENTS,
            status=ContentStatus.PUBLISHED,
            is_active=True,
        )

        NewsItem.objects.filter(id=cls.news.id).update(date=date(2026, 11, 16))
        EmergencyAlert.objects.filter(id=cls.alert.id).update(date=date(2026, 11, 16))
        cls.news.refresh_from_db()
        cls.alert.refresh_from_db()

    def test_deterministic_priority_tie_breaking(self):
        """When entries share the exact same start datetime, global sort order follows priority ranking."""
        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'include_notices': 'true',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        results = res.data['results']

        self.assertEqual(len(results), 4)
        # Expected order:
        # 1. emergency_advisory (priority 0)
        # 2. municipal_event (priority 1)
        # 3. collection_schedule (priority 2)
        # 4. announcement (priority 3)
        self.assertEqual(results[0]['entry_type'], 'emergency_advisory')
        self.assertEqual(results[1]['entry_type'], 'municipal_event')
        self.assertEqual(results[2]['entry_type'], 'collection_schedule')
        self.assertEqual(results[3]['entry_type'], 'announcement')

    def test_pagination_mechanics_and_page_boundaries(self):
        """Pagination slices after global sorting without data loss or duplication across pages."""
        # Request page 1 with page_size=2
        res1 = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'include_notices': 'true',
            'page': 1,
            'page_size': 2,
        })
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        self.assertEqual(res1.data['count'], 4)
        self.assertEqual(res1.data['total_pages'], 2)
        self.assertEqual(res1.data['current_page'], 1)
        self.assertEqual(res1.data['page_size'], 2)
        self.assertIsNotNone(res1.data['next'])
        self.assertIsNone(res1.data['previous'])
        self.assertEqual(len(res1.data['results']), 2)

        # Request page 2 with page_size=2
        res2 = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'include_notices': 'true',
            'page': 2,
            'page_size': 2,
        })
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(res2.data['current_page'], 2)
        self.assertIsNone(res2.data['next'])
        self.assertIsNotNone(res2.data['previous'])
        self.assertEqual(len(res2.data['results']), 2)

        # Verify page 1 and page 2 are disjoint and together cover all 4 items
        p1_ids = [item['id'] for item in res1.data['results']]
        p2_ids = [item['id'] for item in res2.data['results']]
        self.assertEqual(set(p1_ids).intersection(set(p2_ids)), set())
        self.assertEqual(len(set(p1_ids + p2_ids)), 4)

    def test_page_size_max_cap_validation(self):
        """page_size defaults to 20 and rejects values above 50."""
        # Valid page_size 50
        res_50 = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'page_size': 50,
        })
        self.assertEqual(res_50.status_code, status.HTTP_200_OK)

        # Invalid page_size 51
        res_51 = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'page_size': 51,
        })
        self.assertEqual(res_51.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('page_size', res_51.data)

    def test_unpaginated_mode_and_response_envelope(self):
        """paginate=false returns an unpaginated payload with paginated=False."""
        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'include_notices': 'true',
            'paginate': 'false',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(res.data['paginated'])
        self.assertEqual(res.data['count'], 4)
        self.assertEqual(len(res.data['results']), 4)

    def test_unpaginated_mode_rejects_ranges_over_31_days(self):
        """paginate=false returns HTTP 400 if the date range exceeds 31 calendar days."""
        start = date(2026, 1, 1)
        end_32 = start + timedelta(days=31)  # 32 inclusive days

        res = self.client.get(self.url, {
            'start_date': start.isoformat(),
            'end_date': end_32.isoformat(),
            'paginate': 'false',
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('paginate', res.data)


class CalendarFiltersAndBooleanValidationTests(APITestCase):
    """4. Source, category, status, and boolean parameter validation."""

    @classmethod
    def setUpTestData(cls):
        cls.url = '/api/calendar/entries/'
        cls.brgy_isabang = Barangay.objects.create(name='Isabang')
        cls.brgy_cotta = Barangay.objects.create(name='Cotta')

        cls.event = MunicipalEvent.objects.create(
            title='Cleanup Drive',
            description='Lucena cleanup.',
            start_datetime=datetime(2026, 11, 16, 8, 0, tzinfo=MANILA_TZ),
            end_datetime=datetime(2026, 11, 16, 12, 0, tzinfo=MANILA_TZ),
            location='Lucena Plaza',
            category=EventCategory.CLEANUP,
            status=EventStatus.PUBLISHED,
        )
        cls.event.barangays.add(cls.brgy_isabang)

    def test_filter_by_source(self):
        """?source=municipal_event returns only municipal event records."""
        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'source': 'municipal_event',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        for item in res.data['results']:
            self.assertEqual(item['source'], 'municipal_event')

    def test_unsupported_source_rejected(self):
        """Passing an unsupported source returns HTTP 400."""
        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'source': 'invalid_source',
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('source', res.data)

    def test_filter_by_barangay_id(self):
        """?barangay_id=<id> filters entries to specified barangay and citywide entries."""
        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'barangay_id': self.brgy_isabang.id,
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [item['id'] for item in res.data['results']]
        self.assertIn(f'event_{self.event.id}', ids)

    def test_nonexistent_barangay_id_rejected(self):
        """Nonexistent barangay_id returns HTTP 400 Bad Request."""
        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'barangay_id': 999999,
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('barangay_id', res.data)

    def test_strict_boolean_parsing(self):
        """True/false strings are parsed accurately; malformed strings return HTTP 400."""
        # Valid boolean representations
        for val in ['true', '1', 't', 'yes', 'TRUE']:
            res = self.client.get(self.url, {
                'start_date': '2026-11-16',
                'end_date': '2026-11-16',
                'include_notices': val,
            })
            self.assertEqual(res.status_code, status.HTTP_200_OK)

        for val in ['false', '0', 'f', 'no', 'FALSE']:
            res = self.client.get(self.url, {
                'start_date': '2026-11-16',
                'end_date': '2026-11-16',
                'include_notices': val,
            })
            self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Malformed boolean string
        res_malformed = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'include_notices': 'maybe',
        })
        self.assertEqual(res_malformed.status_code, status.HTTP_400_BAD_REQUEST)


class CalendarAuthorizationAndVisibilityTests(APITestCase):
    """5. Role-based visibility and sanitization checks."""

    @classmethod
    def setUpTestData(cls):
        cls.url = '/api/calendar/entries/'
        cls.brgy_isabang = Barangay.objects.create(name='Isabang')
        cls.brgy_cotta = Barangay.objects.create(name='Cotta')

        # Users
        cls.citizen = User.objects.create_user(
            username='auth_citizen',
            email='citizen@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.CITIZEN,
        )
        cls.official_isabang = User.objects.create_user(
            username='auth_official_isabang',
            email='official@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.BRGY_OFFICIAL,
            barangay=cls.brgy_isabang,
        )
        cls.watcher = User.objects.create_user(
            username='auth_watcher',
            email='watcher@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.WATCHER,
        )
        cls.driver = User.objects.create_user(
            username='auth_driver',
            email='driver@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.DRIVER,
        )
        cls.dumpsite = User.objects.create_user(
            username='auth_dumpsite',
            email='dumpsite@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.DUMPSITE,
        )
        cls.admin_role = User.objects.create_user(
            username='auth_admin_role',
            email='admin@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.ADMIN,
            is_staff=False,
        )
        cls.staff_admin = User.objects.create_user(
            username='auth_staff_admin',
            email='staff@lucena.gov.ph',
            password='testpassword123',
            role=UserRole.CITIZEN,
            is_staff=True,
        )

        # Published event (Isabang)
        cls.event_isabang = MunicipalEvent.objects.create(
            title='Isabang Clean-up',
            description='Public cleanup.',
            start_datetime=datetime(2026, 11, 16, 8, 0, tzinfo=MANILA_TZ),
            end_datetime=datetime(2026, 11, 16, 12, 0, tzinfo=MANILA_TZ),
            location='Isabang Plaza',
            category=EventCategory.CLEANUP,
            status=EventStatus.PUBLISHED,
        )
        cls.event_isabang.barangays.add(cls.brgy_isabang)

        # Published event (Cotta)
        cls.event_cotta = MunicipalEvent.objects.create(
            title='Cotta Coastal Meeting',
            description='Coastal meeting.',
            start_datetime=datetime(2026, 11, 16, 9, 0, tzinfo=MANILA_TZ),
            end_datetime=datetime(2026, 11, 16, 11, 0, tzinfo=MANILA_TZ),
            location='Cotta Port',
            category=EventCategory.COMMUNITY_MEETING,
            status=EventStatus.PUBLISHED,
        )
        cls.event_cotta.barangays.add(cls.brgy_cotta)

        # Draft event
        cls.event_draft = MunicipalEvent.objects.create(
            title='Draft Private Workshop',
            description='Internal draft.',
            start_datetime=datetime(2026, 11, 16, 14, 0, tzinfo=MANILA_TZ),
            end_datetime=datetime(2026, 11, 16, 16, 0, tzinfo=MANILA_TZ),
            location='City Hall',
            category=EventCategory.WORKSHOP,
            status=EventStatus.DRAFT,
        )

    def test_anonymous_and_citizen_visibility(self):
        """Anonymous and Citizen callers see published events and never draft events."""
        # Anonymous
        res_anon = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
        })
        ids_anon = [item['id'] for item in res_anon.data['results']]
        self.assertIn(f'event_{self.event_isabang.id}', ids_anon)
        self.assertIn(f'event_{self.event_cotta.id}', ids_anon)
        self.assertNotIn(f'event_{self.event_draft.id}', ids_anon)

        # Citizen
        self.client.force_authenticate(user=self.citizen)
        res_cit = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
        })
        ids_cit = [item['id'] for item in res_cit.data['results']]
        self.assertIn(f'event_{self.event_isabang.id}', ids_cit)
        self.assertIn(f'event_{self.event_cotta.id}', ids_cit)
        self.assertNotIn(f'event_{self.event_draft.id}', ids_cit)

    def test_barangay_official_boundary_enforcement(self):
        """Barangay Official is locked to their own barangay and cannot bypass via barangay_id."""
        self.client.force_authenticate(user=self.official_isabang)

        # Normal query
        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
        })
        ids = [item['id'] for item in res.data['results']]
        self.assertIn(f'event_{self.event_isabang.id}', ids)
        self.assertNotIn(f'event_{self.event_cotta.id}', ids)

        # Cross-barangay override attempt
        res_cross = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'barangay_id': self.brgy_cotta.id,
        })
        ids_cross = [item['id'] for item in res_cross.data['results']]
        self.assertNotIn(f'event_{self.event_cotta.id}', ids_cross)

    def test_operational_roles_receive_public_only_sanitized_access(self):
        """Watcher, Driver, and Dumpsite operators receive sanitized public access without drafts."""
        disallowed_keys = {
            'driver', 'driver_id', 'driver_name',
            'truck', 'truck_id', 'plate_number',
            'dumpsite', 'dumpsite_id', 'dumpsite_coordinates',
            'gps', 'raw_gps', 'waypoints', 'route_geometry',
        }

        for user in [self.watcher, self.driver, self.dumpsite]:
            with self.subTest(role=user.role):
                self.client.force_authenticate(user=user)
                res = self.client.get(self.url, {
                    'start_date': '2026-11-16',
                    'end_date': '2026-11-16',
                })
                self.assertEqual(res.status_code, status.HTTP_200_OK)
                ids = [item['id'] for item in res.data['results']]

                # Drafts are isolated
                self.assertNotIn(f'event_{self.event_draft.id}', ids)
                self.assertIn(f'event_{self.event_isabang.id}', ids)

                # Sanitization check
                for item in res.data['results']:
                    all_keys = set(item.keys()) | set(item.get('metadata', {}).keys())
                    self.assertTrue(disallowed_keys.isdisjoint(all_keys))

    def test_admin_and_staff_visibility(self):
        """Admin users (both role='admin' and is_staff=True) can access draft events."""
        for admin in [self.admin_role, self.staff_admin]:
            with self.subTest(admin=admin.username):
                self.client.force_authenticate(user=admin)
                res = self.client.get(self.url, {
                    'start_date': '2026-11-16',
                    'end_date': '2026-11-16',
                })
                self.assertEqual(res.status_code, status.HTTP_200_OK)
                ids = [item['id'] for item in res.data['results']]
                self.assertIn(f'event_{self.event_draft.id}', ids)


class CalendarCapacityAndPerformanceTests(APITestCase):
    """6. Capacity limits, unpaginated constraints, and query count benchmarks."""

    def setUp(self):
        self.url = '/api/calendar/entries/'
        self.brgy = Barangay.objects.create(name='Ibabang Dupay')
        self.truck = Truck.objects.create(plate_number='LCN-100')

    def test_unpaginated_max_entries_cap_250(self):
        """Unpaginated result exceeding 250 entries returns HTTP 503 capacity error."""
        # Create 251 one-time events on 2026-11-16
        events = [
            MunicipalEvent(
                title=f'Cleanup #{i}',
                description='Event',
                start_datetime=datetime(2026, 11, 16, 8, 0, tzinfo=MANILA_TZ),
                end_datetime=datetime(2026, 11, 16, 9, 0, tzinfo=MANILA_TZ),
                location='City Hall',
                category=EventCategory.CLEANUP,
                status=EventStatus.PUBLISHED,
            )
            for i in range(251)
        ]
        MunicipalEvent.objects.bulk_create(events)

        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'paginate': 'false',
        })
        self.assertEqual(res.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(res.data.get('error'), 'capacity_limit_exceeded')
        self.assertNotIn('results', res.data)

    def test_paginated_requests_below_global_cap_succeed(self):
        """Paginated requests with aggregated entries below the global cap (1000) succeed."""
        events = [
            MunicipalEvent(
                title=f'Event #{i}',
                description='Event',
                start_datetime=datetime(2026, 11, 16, 8, 0, tzinfo=MANILA_TZ),
                end_datetime=datetime(2026, 11, 16, 9, 0, tzinfo=MANILA_TZ),
                location='City Hall',
                category=EventCategory.CLEANUP,
                status=EventStatus.PUBLISHED,
            )
            for i in range(500)
        ]
        MunicipalEvent.objects.bulk_create(events)

        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'page': 1,
            'page_size': 20,
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 500)
        self.assertEqual(len(res.data['results']), 20)

    def test_paginated_requests_exceeding_global_cap_trigger_503(self):
        """Paginated requests with aggregated entries exceeding global cap (1000) return HTTP 503 without partial results."""
        events = [
            MunicipalEvent(
                title=f'OverCap Event #{i}',
                description='Event',
                start_datetime=datetime(2026, 11, 16, 8, 0, tzinfo=MANILA_TZ),
                end_datetime=datetime(2026, 11, 16, 9, 0, tzinfo=MANILA_TZ),
                location='City Hall',
                category=EventCategory.CLEANUP,
                status=EventStatus.PUBLISHED,
            )
            for i in range(1001)
        ]
        MunicipalEvent.objects.bulk_create(events)

        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
            'page': 1,
            'page_size': 20,
        })
        self.assertEqual(res.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(res.data.get('error'), 'capacity_limit_exceeded')
        self.assertNotIn('results', res.data)

    def test_recurring_schedule_overflow_triggers_503(self):
        """Active recurring templates exceeding 100 trigger HTTP 503 capacity error."""
        schedules = [
            CollectionSchedule(
                truck=self.truck,
                days='Mon',
                start_time=time(8, 0),
                end_time=time(10, 0),
                frequency='Weekly',
                status='PENDING',
                waypoints=[{'lat': 13.9, 'lng': 121.6}],
            )
            for _ in range(101)
        ]
        CollectionSchedule.objects.bulk_create(schedules)

        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
        })
        self.assertEqual(res.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(res.data.get('error'), 'capacity_limit_exceeded')
        self.assertNotIn('results', res.data)

    def test_completed_and_cancelled_templates_do_not_consume_active_capacity(self):
        """Completed and cancelled recurring templates do not count against the 100 active template cap."""
        # 50 active recurring templates
        active_scheds = [
            CollectionSchedule(
                truck=self.truck,
                days='Mon',
                start_time=time(8, 0),
                end_time=time(10, 0),
                frequency='Weekly',
                status='PENDING',
                waypoints=[{'lat': 13.9, 'lng': 121.6}],
            )
            for _ in range(50)
        ]
        # 60 completed recurring templates (110 total templates, but only 50 active)
        completed_scheds = [
            CollectionSchedule(
                truck=self.truck,
                days='Mon',
                start_time=time(8, 0),
                end_time=time(10, 0),
                frequency='Weekly',
                status='COMPLETED',
                waypoints=[{'lat': 13.9, 'lng': 121.6}],
            )
            for _ in range(60)
        ]
        CollectionSchedule.objects.bulk_create(active_scheds + completed_scheds)

        res = self.client.get(self.url, {
            'start_date': '2026-11-16',
            'end_date': '2026-11-16',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_source_filter_avoids_querying_irrelevant_sources(self):
        """When ?source=municipal_event is passed, collection schedules, news, and alerts are not queried in SQL."""
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get(self.url, {
                'start_date': '2026-11-16',
                'end_date': '2026-11-16',
                'source': 'municipal_event',
            })
            self.assertEqual(res.status_code, status.HTTP_200_OK)

        queries_sql = " ".join(q['sql'].lower() for q in ctx.captured_queries)
        self.assertIn('events_municipalevent', queries_sql)
        self.assertNotIn('driver_collectionschedule', queries_sql)
        self.assertNotIn('news_newsitem', queries_sql)
        self.assertNotIn('news_emergencyalert', queries_sql)

    def test_database_query_efficiency_and_n_plus_one_prevention(self):
        """Query count remains strictly bounded and avoids N+1 queries when loading mixed sources."""
        # Seed several schedules, events, news, and alerts
        CollectionSchedule.objects.create(
            truck=self.truck,
            days='Mon',
            start_time=time(8, 0),
            end_time=time(10, 0),
            frequency='Weekly',
            status='PENDING',
            waypoints=[{'lat': 13.9, 'lng': 121.6}],
        )
        MunicipalEvent.objects.create(
            title='Park Cleanup',
            description='Clean park.',
            start_datetime=datetime(2026, 11, 16, 9, 0, tzinfo=MANILA_TZ),
            end_datetime=datetime(2026, 11, 16, 12, 0, tzinfo=MANILA_TZ),
            location='City Park',
            category=EventCategory.CLEANUP,
            status=EventStatus.PUBLISHED,
        )
        item = NewsItem.objects.create(
            title='Notice',
            description='Advisory',
            type=NewsType.ANNOUNCEMENT,
            category=NewsCategory.ANNOUNCEMENTS,
            status=ContentStatus.PUBLISHED,
            is_active=True,
        )
        alert = EmergencyAlert.objects.create(
            title='Alert',
            body='Emergency alert',
            is_active=True,
        )
        NewsItem.objects.filter(id=item.id).update(date=date(2026, 11, 16))
        EmergencyAlert.objects.filter(id=alert.id).update(date=date(2026, 11, 16))

        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(self.url, {
                'start_date': '2026-11-16',
                'end_date': '2026-11-16',
                'include_notices': 'true',
            })
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Baseline inspection: A bounded mixed-source query must complete in <= 10 database queries
        query_count = len(ctx.captured_queries)
        self.assertLessEqual(query_count, 10, f"Query count ({query_count}) exceeded maximum expected threshold.")
