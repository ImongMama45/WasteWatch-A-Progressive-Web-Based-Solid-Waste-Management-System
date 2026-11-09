"""
Comprehensive test suite for CollectionSchedule selection and normalization (Stage 1B).

Covers:
1. Selector tests (date filtering, one-time vs recurring, lifecycle status, N+1 query avoidance)
2. Recurrence tests (date precedence, weekday expansion, time ranges, Manila timezone)
3. Scope classification tests (precedence: barangay > citywide > area > unassigned)
4. Completion status tests (scheduled, in_progress, operationally_completed, verified_collected, unverified)
5. Sanitization tests (complete omission of driver, truck, dumpsite, and raw waypoint GPS traces)
6. Capacity and bounding tests (93/94-day limits, 100/101-template cap-plus-one overflow detection)
"""

from datetime import date, datetime, time, timedelta
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from zoneinfo import ZoneInfo

from accounts.models import Barangay
from driver.models import CollectionSchedule, DriverShift, Truck
from dumpsite.models import Dumpsite
from watcher.models import StopValidation, StopValidationStatus

from calendar_service.exceptions import CalendarCapacityError, CalendarDateRangeError
from calendar_service.normalizers import (
    classify_schedule_scope,
    determine_completion_status,
    expand_schedule_occurrences,
    normalize_collection_schedule_occurrence,
    normalize_collection_schedules,
)
from calendar_service.selectors import (
    fetch_stop_validations_map,
    get_normalized_collection_schedules,
    select_collection_schedules,
    validate_date_window,
)

User = get_user_model()
MANILA_TZ = ZoneInfo('Asia/Manila')


class CollectionScheduleSelectorTests(TestCase):
    """1. Selector layer tests."""

    @classmethod
    def setUpTestData(cls):
        cls.brgy1 = Barangay.objects.create(name='Ibabang Dupay')
        cls.brgy2 = Barangay.objects.create(name='Ilayang Dupay')

        # One-time schedule for 2026-11-15
        cls.sched_onetime_in = CollectionSchedule.objects.create(
            date=date(2026, 11, 15),
            start_time=time(8, 0),
            end_time=time(12, 0),
            status='PENDING',
        )
        cls.sched_onetime_in.barangays.add(cls.brgy1)

        # One-time schedule outside window (2026-11-01)
        cls.sched_onetime_out = CollectionSchedule.objects.create(
            date=date(2026, 11, 1),
            start_time=time(8, 0),
            end_time=time(12, 0),
            status='PENDING',
        )

        # Recurring schedule
        cls.sched_recurring = CollectionSchedule.objects.create(
            days='Mon, Wed, Fri',
            start_time=time(7, 0),
            end_time=time(11, 0),
            status='PENDING',
        )
        cls.sched_recurring.barangays.add(cls.brgy2)

        # Cancelled schedule
        cls.sched_cancelled = CollectionSchedule.objects.create(
            date=date(2026, 11, 16),
            start_time=time(9, 0),
            end_time=time(13, 0),
            status='CANCELLED',
        )

    def test_select_schedules_in_date_range(self):
        """One-time schedule inside window and recurring schedules are selected."""
        start = date(2026, 11, 10)
        end = date(2026, 11, 20)
        results = select_collection_schedules(start, end)
        ids = [s.id for s in results]

        self.assertIn(self.sched_onetime_in.id, ids)
        self.assertIn(self.sched_recurring.id, ids)
        self.assertNotIn(self.sched_onetime_out.id, ids)
        self.assertNotIn(self.sched_cancelled.id, ids)

    def test_include_cancelled_when_requested(self):
        """Cancelled schedules are included only when explicitly requested."""
        start = date(2026, 11, 10)
        end = date(2026, 11, 20)
        results = select_collection_schedules(start, end, include_cancelled=True)
        ids = [s.id for s in results]
        self.assertIn(self.sched_cancelled.id, ids)

    def test_barangay_filtering(self):
        """Filtering by barangay isolates schedules for that barangay plus citywide schedules."""
        citywide_sched = CollectionSchedule.objects.create(
            area='Citywide',
            days='Tue',
            start_time=time(6, 0),
            end_time=time(10, 0),
        )

        start = date(2026, 11, 10)
        end = date(2026, 11, 20)

        # Filter by brgy1
        res1 = select_collection_schedules(start, end, barangay_id=self.brgy1.id)
        ids1 = [s.id for s in res1]
        self.assertIn(self.sched_onetime_in.id, ids1)
        self.assertIn(citywide_sched.id, ids1)
        self.assertNotIn(self.sched_recurring.id, ids1)  # assigned to brgy2

    def test_query_count_avoids_n_plus_one(self):
        """Batch schedule selection and StopValidation queries must avoid N+1 patterns."""
        start = date(2026, 11, 10)
        end = date(2026, 11, 20)

        # With 4 schedules and prefetched relations, queries must remain strictly bounded (4 or 5 depending on ref_date)
        with self.assertNumQueries(5):
            schedules = select_collection_schedules(start, end)
            for s in schedules:
                _ = list(s.barangays.all())  # Iterating m2m should not trigger extra SQL


class CollectionScheduleRecurrenceTests(TestCase):
    """2. Date and recurrence normalization tests."""

    def test_date_precedence_over_days(self):
        """A populated date takes precedence over days and emits exactly one occurrence."""
        sched = CollectionSchedule(
            date=date(2026, 11, 16),  # A Monday
            days='Tue, Thu',  # Ignored because date is populated
            start_time=time(8, 0),
            end_time=time(12, 0),
        )
        # Query window covering 2026-11-15 to 2026-11-20
        occurrences = expand_schedule_occurrences(sched, date(2026, 11, 15), date(2026, 11, 20))
        self.assertEqual(occurrences, [date(2026, 11, 16)])

        # If window does not cover date, emit nothing
        out_occurrences = expand_schedule_occurrences(sched, date(2026, 11, 17), date(2026, 11, 25))
        self.assertEqual(out_occurrences, [])

    def test_recurring_weekday_expansion(self):
        """Recurring schedule emits dates matching days within window."""
        # Window: 2026-11-16 (Mon) to 2026-11-22 (Sun)
        sched = CollectionSchedule(
            days='Mon, Wed, Fri',
            start_time=time(8, 0),
            end_time=time(12, 0),
        )
        occurrences = expand_schedule_occurrences(sched, date(2026, 11, 16), date(2026, 11, 22))
        expected = [
            date(2026, 11, 16),  # Mon
            date(2026, 11, 18),  # Wed
            date(2026, 11, 20),  # Fri
        ]
        self.assertEqual(occurrences, expected)

    def test_invalid_weekdays_omitted(self):
        """Invalid weekday definition emits 0 occurrences and does not fabricate dates."""
        sched = CollectionSchedule(
            days='InvalidDay, Nonsense',
            start_time=time(8, 0),
            end_time=time(12, 0),
        )
        occurrences = expand_schedule_occurrences(sched, date(2026, 11, 16), date(2026, 11, 22))
        self.assertEqual(occurrences, [])

    def test_invalid_time_ranges_omitted(self):
        """Schedules with start_time >= end_time or missing times are safely omitted."""
        # Inverted time
        sched_inverted = CollectionSchedule(
            days='Mon',
            start_time=time(14, 0),
            end_time=time(10, 0),
        )
        self.assertEqual(expand_schedule_occurrences(sched_inverted, date(2026, 11, 16), date(2026, 11, 22)), [])

        # Equal time
        sched_equal = CollectionSchedule(
            days='Mon',
            start_time=time(10, 0),
            end_time=time(10, 0),
        )
        self.assertEqual(expand_schedule_occurrences(sched_equal, date(2026, 11, 16), date(2026, 11, 22)), [])

        # Missing time
        sched_none = CollectionSchedule(
            days='Mon',
            start_time=None,
            end_time=time(10, 0),
        )
        self.assertEqual(expand_schedule_occurrences(sched_none, date(2026, 11, 16), date(2026, 11, 22)), [])

    def test_timezone_manila_awareness(self):
        """Occurrence start and end datetimes must be timezone-aware in Asia/Manila (UTC+8)."""
        sched = CollectionSchedule(
            id=10,
            date=date(2026, 11, 16),
            start_time=time(6, 0),
            end_time=time(14, 0),
            area='Isabang',
        )
        entry = normalize_collection_schedule_occurrence(sched, date(2026, 11, 16))
        # ISO string checks
        self.assertTrue(entry['start'].endswith('+08:00'))
        self.assertTrue(entry['end'].endswith('+08:00'))
        self.assertEqual(entry['start'], '2026-11-16T06:00:00+08:00')
        self.assertEqual(entry['end'], '2026-11-16T14:00:00+08:00')


class CollectionScheduleScopeTests(TestCase):
    """3. Scope classification tests."""

    def test_scope_precedence_rules(self):
        """Tests the approved 4-tier precedence: barangay > citywide > area > unassigned."""
        # 1. Explicit barangays -> barangay (even if area says 'Citywide')
        self.assertEqual(classify_schedule_scope(1, 'Citywide'), 'barangay')
        self.assertEqual(classify_schedule_scope(3, ''), 'barangay')

        # 2. No barangays + citywide marker -> citywide
        self.assertEqual(classify_schedule_scope(0, 'citywide'), 'citywide')
        self.assertEqual(classify_schedule_scope(0, 'Citywide'), 'citywide')
        self.assertEqual(classify_schedule_scope(0, 'CITYWIDE'), 'citywide')
        self.assertEqual(classify_schedule_scope(0, 'city-wide'), 'citywide')
        self.assertEqual(classify_schedule_scope(0, 'City-Wide'), 'citywide')

        # 3. No barangays + non-citywide area -> area
        self.assertEqual(classify_schedule_scope(0, 'all barangays'), 'area')
        self.assertEqual(classify_schedule_scope(0, 'Lucena'), 'area')
        self.assertEqual(classify_schedule_scope(0, 'Sector 4'), 'area')
        self.assertEqual(classify_schedule_scope(0, 'municipal'), 'area')

        # 4. No barangays + blank area -> unassigned
        self.assertEqual(classify_schedule_scope(0, ''), 'unassigned')
        self.assertEqual(classify_schedule_scope(0, '   '), 'unassigned')
        self.assertEqual(classify_schedule_scope(0, None), 'unassigned')


class CollectionScheduleCompletionTests(TestCase):
    """4. Operational completion normalization tests."""

    def setUp(self):
        self.today = date(2026, 11, 16)
        # Waypoints: Index 0 is Depot; Indices 1 and 2 are collection stops. (Total expected = 2)
        self.waypoints = [
            {'lat': 13.93, 'lng': 121.61, 'label': 'Depot'},
            {'lat': 13.94, 'lng': 121.62, 'label': 'Stop 1'},
            {'lat': 13.95, 'lng': 121.63, 'label': 'Stop 2'},
        ]
        self.sched = CollectionSchedule(
            id=42,
            waypoints=self.waypoints,
            start_time=time(6, 0),
            end_time=time(14, 0),
            status='PENDING',
        )

    def test_future_occurrence_is_scheduled(self):
        """Future occurrences are always 'scheduled'."""
        future_date = date(2026, 11, 18)
        status = determine_completion_status(self.sched, future_date, reference_date=self.today)
        self.assertEqual(status, 'scheduled')

    def test_today_unresolved_is_in_progress(self):
        """Current-day occurrences with missing or unresolved stops are 'in_progress'."""
        # No evidence
        self.assertEqual(
            determine_completion_status(self.sched, self.today, stop_dict=None, reference_date=self.today),
            'in_progress',
        )

        # Partial evidence (only Stop 1 recorded)
        partial_stops = {1: StopValidationStatus.VERIFIED_COLLECTED}
        self.assertEqual(
            determine_completion_status(self.sched, self.today, stop_dict=partial_stops, reference_date=self.today),
            'in_progress',
        )

        # Pending inspection stop
        pending_stops = {
            1: StopValidationStatus.VERIFIED_COLLECTED,
            2: StopValidationStatus.PENDING_INSPECTION,
        }
        self.assertEqual(
            determine_completion_status(self.sched, self.today, stop_dict=pending_stops, reference_date=self.today),
            'in_progress',
        )

    def test_all_stops_verified_collected(self):
        """When every stop reaches VERIFIED_COLLECTED, status is 'verified_collected'."""
        stops = {
            1: StopValidationStatus.VERIFIED_COLLECTED,
            2: StopValidationStatus.VERIFIED_COLLECTED,
        }
        status = determine_completion_status(self.sched, self.today, stop_dict=stops, reference_date=self.today)
        self.assertEqual(status, 'verified_collected')

    def test_all_stops_resolved_with_non_verified_states(self):
        """When all stops are resolved, but not all verified collected, status is 'operationally_completed'."""
        # 1. Driver reported + Verified collected
        stops_reported = {
            1: StopValidationStatus.COLLECTION_REPORTED,
            2: StopValidationStatus.VERIFIED_COLLECTED,
        }
        self.assertEqual(
            determine_completion_status(self.sched, self.today, stop_dict=stops_reported, reference_date=self.today),
            'operationally_completed',
        )

        # 2. Disputed (Missed) + Verified collected
        stops_disputed = {
            1: StopValidationStatus.COLLECTION_DISPUTED,
            2: StopValidationStatus.VERIFIED_COLLECTED,
        }
        self.assertEqual(
            determine_completion_status(self.sched, self.today, stop_dict=stops_disputed, reference_date=self.today),
            'operationally_completed',
        )

        # 3. Empty stop + Reported
        stops_empty = {
            1: StopValidationStatus.EMPTY_STOP,
            2: StopValidationStatus.COLLECTION_REPORTED,
        }
        self.assertEqual(
            determine_completion_status(self.sched, self.today, stop_dict=stops_empty, reference_date=self.today),
            'operationally_completed',
        )

    def test_past_occurrence_no_evidence_is_unverified(self):
        """Past occurrences lacking evidence are 'unverified', never assumed completed."""
        past_date = date(2026, 11, 10)
        self.assertEqual(
            determine_completion_status(self.sched, past_date, stop_dict=None, reference_date=self.today),
            'unverified',
        )
        self.assertEqual(
            determine_completion_status(self.sched, past_date, stop_dict={}, reference_date=self.today),
            'unverified',
        )

    def test_past_occurrence_partial_evidence_is_unverified(self):
        """Past occurrences with partial evidence remain 'unverified'."""
        past_date = date(2026, 11, 10)
        partial_stops = {1: StopValidationStatus.VERIFIED_COLLECTED}
        self.assertEqual(
            determine_completion_status(self.sched, past_date, stop_dict=partial_stops, reference_date=self.today),
            'unverified',
        )

    def test_schedule_status_alone_does_not_imply_completion(self):
        """CollectionSchedule.status='COMPLETED' does not override missing occurrence evidence."""
        past_date = date(2026, 11, 10)
        completed_sched = CollectionSchedule(
            id=99,
            waypoints=self.waypoints,
            start_time=time(6, 0),
            end_time=time(14, 0),
            status='COMPLETED',  # Administrative status
        )
        # Without StopValidation records, historical status remains unverified
        self.assertEqual(
            determine_completion_status(completed_sched, past_date, stop_dict=None, reference_date=self.today),
            'unverified',
        )

    def test_malformed_waypoints_safe_handling(self):
        """Empty or single waypoint schedules do not fabricate completion."""
        # Empty waypoints
        empty_sched = CollectionSchedule(id=1, waypoints=[], start_time=time(6, 0), end_time=time(14, 0))
        self.assertEqual(
            determine_completion_status(empty_sched, self.today, reference_date=self.today),
            'in_progress',
        )
        self.assertEqual(
            determine_completion_status(empty_sched, date(2026, 11, 10), reference_date=self.today),
            'unverified',
        )

        # Single waypoint (depot only, 0 stops)
        depot_only = CollectionSchedule(
            id=2,
            waypoints=[{'lat': 13.9, 'lng': 121.6}],
            start_time=time(6, 0),
            end_time=time(14, 0),
        )
        self.assertEqual(
            determine_completion_status(depot_only, date(2026, 11, 10), reference_date=self.today),
            'unverified',
        )


class CollectionScheduleSanitizationTests(TestCase):
    """5. Field sanitization tests."""

    @classmethod
    def setUpTestData(cls):
        cls.driver = User.objects.create_user(
            username='driver_secret_01',
            email='secret_driver@lucena.gov.ph',
            password='testpassword123',
            role='driver',
            first_name='Juan',
            last_name='Dela Cruz',
        )
        cls.truck = Truck.objects.create(
            plate_number='PLATE-XYZ-999',
            model='Heavy Compactor 5000',
            status='active',
        )
        cls.sanitation_brgy = Barangay.objects.create(name='Sanitation Brgy')
        cls.dumpsite = Dumpsite.objects.create(
            name='Lucena Central Sanitary Landfill',
            barangay=cls.sanitation_brgy,
            latitude=13.912345,
            longitude=121.654321,
        )
        cls.sched = CollectionSchedule.objects.create(
            date=date(2026, 11, 16),
            start_time=time(6, 0),
            end_time=time(14, 0),
            area='Isabang West',
            frequency='Bi-weekly',
            driver=cls.driver,
            truck=cls.truck,
            dumpsite=cls.dumpsite,
            waypoints=[
                {'lat': 13.931234, 'lng': 121.611234, 'label': 'Secret Depot'},
                {'lat': 13.945678, 'lng': 121.625678, 'label': 'Secret Stop 1'},
            ],
            status='PENDING',
        )

    def test_sanitization_removes_sensitive_operational_fields(self):
        """Normalized entry must not expose driver, truck, dumpsite, or waypoint GPS coordinates."""
        entry = normalize_collection_schedule_occurrence(self.sched, date(2026, 11, 16))

        # Check top-level keys
        forbidden_keys = {'driver', 'driver_id', 'driver_name', 'truck', 'truck_id', 'plate_number', 'dumpsite', 'waypoints'}
        self.assertFalse(forbidden_keys.intersection(entry.keys()))

        # Check values in metadata
        metadata = entry['metadata']
        for k, v in metadata.items():
            self.assertNotIn('Juan', str(v))
            self.assertNotIn('PLATE-XYZ', str(v))
            self.assertNotIn('Landfill', str(v))
            self.assertNotIn('13.931234', str(v))

        # Check entry string representation
        entry_str = str(entry)
        self.assertNotIn('Juan', entry_str)
        self.assertNotIn('Dela Cruz', entry_str)
        self.assertNotIn('PLATE-XYZ-999', entry_str)
        self.assertNotIn('Landfill', entry_str)
        self.assertNotIn('13.931234', entry_str)
        self.assertNotIn('121.611234', entry_str)


class CollectionScheduleCapacityTests(TestCase):
    """6. Capacity bounding and performance tests."""

    def test_date_range_limits(self):
        """Window sizes <= 93 days are accepted; 94 days or inverted ranges are rejected."""
        # 93 inclusive days (e.g. 2026-01-01 to 2026-04-03)
        start = date(2026, 1, 1)
        end_93 = start + timedelta(days=92)  # 93 inclusive days
        self.assertEqual(validate_date_window(start, end_93), 93)

        # 94 inclusive days
        end_94 = start + timedelta(days=93)  # 94 inclusive days
        with self.assertRaises(CalendarDateRangeError):
            validate_date_window(start, end_94)

        # Inverted date range
        with self.assertRaises(CalendarDateRangeError):
            validate_date_window(date(2026, 11, 20), date(2026, 11, 10))

    def test_recurring_template_overflow_detection(self):
        """100 recurring templates are processed; 101 triggers controlled CalendarCapacityError."""
        # Create 100 templates
        templates = [
            CollectionSchedule(
                days='Mon',
                start_time=time(6, 0),
                end_time=time(14, 0),
                area=f'Area {i}',
                status='PENDING',
            ) for i in range(100)
        ]
        CollectionSchedule.objects.bulk_create(templates)

        start = date(2026, 11, 16)
        end = date(2026, 11, 22)

        # 100 templates should be accepted without raising CalendarCapacityError
        schedules_100 = select_collection_schedules(start, end)
        self.assertGreaterEqual(len(schedules_100), 100)

        # Add 101st template
        CollectionSchedule.objects.create(
            days='Tue',
            start_time=time(6, 0),
            end_time=time(14, 0),
            area='Area 101',
            status='PENDING',
        )

        # 101 templates must trigger controlled capacity exception
        with self.assertRaises(CalendarCapacityError):
            select_collection_schedules(start, end)

    def test_end_to_end_normalized_pipeline(self):
        """Verifies full batch selection, stop validation mapping, and normalized output."""
        driver_user = User.objects.create_user(
            username='pipeline_driver',
            email='pipeline_driver@lucena.gov.ph',
            password='testpassword123',
            role='driver',
        )
        brgy = Barangay.objects.create(name='Barangay Cotta')
        sched = CollectionSchedule.objects.create(
            date=date(2026, 11, 16),
            start_time=time(8, 0),
            end_time=time(12, 0),
            driver=driver_user,
            status='PENDING',
            waypoints=[
                {'lat': 13.9, 'lng': 121.6, 'label': 'Depot'},
                {'lat': 13.91, 'lng': 121.61, 'label': 'Stop 1'},
            ],
        )
        sched.barangays.add(brgy)

        # Create verified stop validation
        StopValidation.objects.create(
            schedule=sched,
            stop_order=1,
            collection_date=date(2026, 11, 16),
            current_status=StopValidationStatus.VERIFIED_COLLECTED,
        )

        entries = get_normalized_collection_schedules(
            start_date=date(2026, 11, 15),
            end_date=date(2026, 11, 20),
            reference_date=date(2026, 11, 16),
        )

        # Find our entry
        matched = [e for e in entries if e['source_id'] == sched.id]
        self.assertEqual(len(matched), 1)
        entry = matched[0]
        self.assertEqual(entry['id'], f'sched_{sched.id}_20261116')
        self.assertEqual(entry['scope'], 'barangay')
        self.assertEqual(entry['status'], 'verified_collected')
        self.assertEqual(entry['barangays'], [brgy.id])
        self.assertEqual(entry['metadata']['total_stops'], 1)
        self.assertEqual(entry['metadata']['resolved_stops'], 1)


class CollectionScheduleLifecycleSemanticsTests(TestCase):
    """
    Focused tests for the 6-case lifecycle matrix and recurring template rules:
    - One-time | PENDING -> Include if date is in range
    - One-time | COMPLETED -> Preserve eligible historical occurrence
    - One-time | CANCELLED -> Exclude
    - Recurring | PENDING -> Expand matching weekdays
    - Recurring | COMPLETED -> Do not generate future occurrences
    - Recurring | CANCELLED -> Exclude
    """

    def setUp(self):
        self.ref_date = date(2026, 11, 16)  # Monday
        self.past_date = date(2026, 11, 10)  # Tuesday
        self.future_date = date(2026, 11, 20)  # Friday

    def test_matrix_one_time_pending_included_in_range(self):
        """One-time PENDING schedule is included if date falls within window."""
        sched = CollectionSchedule.objects.create(
            date=self.future_date,
            start_time=time(8, 0),
            end_time=time(12, 0),
            status='PENDING',
        )
        occurrences = expand_schedule_occurrences(
            sched, date(2026, 11, 15), date(2026, 11, 25), reference_date=self.ref_date
        )
        self.assertEqual(occurrences, [self.future_date])

    def test_matrix_one_time_completed_historical_preserved(self):
        """One-time COMPLETED historical schedule is preserved and normalized."""
        sched = CollectionSchedule.objects.create(
            date=self.past_date,
            start_time=time(8, 0),
            end_time=time(12, 0),
            status='COMPLETED',
        )
        occurrences = expand_schedule_occurrences(
            sched, date(2026, 11, 8), date(2026, 11, 15), reference_date=self.ref_date
        )
        self.assertEqual(occurrences, [self.past_date])

        entry = normalize_collection_schedule_occurrence(
            sched, self.past_date, stop_validations=None, reference_date=self.ref_date
        )
        self.assertEqual(entry['id'], f'sched_{sched.id}_20261110')
        self.assertEqual(entry['status'], 'unverified')  # without evidence, unverified
        self.assertEqual(entry['metadata']['schedule_lifecycle'], 'COMPLETED')

    def test_matrix_one_time_completed_future_excluded(self):
        """One-time COMPLETED schedule with future date does not generate future occurrences."""
        sched = CollectionSchedule.objects.create(
            date=self.future_date,
            start_time=time(8, 0),
            end_time=time(12, 0),
            status='COMPLETED',
        )
        occurrences = expand_schedule_occurrences(
            sched, date(2026, 11, 15), date(2026, 11, 25), reference_date=self.ref_date
        )
        self.assertEqual(occurrences, [])

    def test_matrix_one_time_cancelled_excluded(self):
        """One-time CANCELLED schedule is excluded."""
        sched = CollectionSchedule.objects.create(
            date=self.past_date,
            start_time=time(8, 0),
            end_time=time(12, 0),
            status='CANCELLED',
        )
        occurrences = expand_schedule_occurrences(
            sched, date(2026, 11, 8), date(2026, 11, 25), reference_date=self.ref_date
        )
        self.assertEqual(occurrences, [])

    def test_matrix_recurring_pending_expands_weekdays(self):
        """Recurring PENDING schedule expands matching weekdays across past and future."""
        sched = CollectionSchedule.objects.create(
            days='Mon, Fri',
            start_time=time(8, 0),
            end_time=time(12, 0),
            status='PENDING',
        )
        # 2026-11-13 (Fri, past), 2026-11-16 (Mon, ref_date), 2026-11-20 (Fri, future)
        occurrences = expand_schedule_occurrences(
            sched, date(2026, 11, 12), date(2026, 11, 22), reference_date=self.ref_date
        )
        expected = [date(2026, 11, 13), date(2026, 11, 16), date(2026, 11, 20)]
        self.assertEqual(occurrences, expected)

    def test_matrix_recurring_completed_does_not_generate_future_occurrences(self):
        """Recurring COMPLETED template does not generate future occurrences."""
        sched = CollectionSchedule.objects.create(
            days='Mon, Fri',
            start_time=time(8, 0),
            end_time=time(12, 0),
            status='COMPLETED',
        )
        # Window spanning past to future: 2026-11-12 to 2026-11-22
        occurrences = expand_schedule_occurrences(
            sched, date(2026, 11, 12), date(2026, 11, 22), reference_date=self.ref_date
        )
        # Must only emit past/current occurrences: 2026-11-13 (Fri) and 2026-11-16 (Mon)
        # Must NOT emit 2026-11-20 (Fri)
        expected = [date(2026, 11, 13), date(2026, 11, 16)]
        self.assertEqual(occurrences, expected)
        self.assertNotIn(date(2026, 11, 20), occurrences)

        # Purely future window: 2026-11-17 to 2026-11-25
        future_occurrences = expand_schedule_occurrences(
            sched, date(2026, 11, 17), date(2026, 11, 25), reference_date=self.ref_date
        )
        self.assertEqual(future_occurrences, [])

    def test_matrix_recurring_cancelled_excluded(self):
        """Recurring CANCELLED schedule is excluded."""
        sched = CollectionSchedule.objects.create(
            days='Mon, Wed, Fri',
            start_time=time(8, 0),
            end_time=time(12, 0),
            status='CANCELLED',
        )
        occurrences = expand_schedule_occurrences(
            sched, date(2026, 11, 12), date(2026, 11, 22), reference_date=self.ref_date
        )
        self.assertEqual(occurrences, [])

    def test_completed_template_does_not_consume_capacity(self):
        """Completed and cancelled recurring templates do not consume the active template capacity."""
        # Create 100 PENDING recurring templates
        pending_templates = [
            CollectionSchedule(
                days='Mon',
                start_time=time(6, 0),
                end_time=time(14, 0),
                area=f'Active Area {i}',
                status='PENDING',
            ) for i in range(100)
        ]
        CollectionSchedule.objects.bulk_create(pending_templates)

        # Add 5 COMPLETED and 3 CANCELLED recurring templates
        completed_templates = [
            CollectionSchedule(
                days='Wed',
                start_time=time(6, 0),
                end_time=time(14, 0),
                area=f'Completed Area {i}',
                status='COMPLETED',
            ) for i in range(5)
        ]
        CollectionSchedule.objects.bulk_create(completed_templates)

        cancelled_templates = [
            CollectionSchedule(
                days='Fri',
                start_time=time(6, 0),
                end_time=time(14, 0),
                area=f'Cancelled Area {i}',
                status='CANCELLED',
            ) for i in range(3)
        ]
        CollectionSchedule.objects.bulk_create(cancelled_templates)

        # Query future window: only the 100 PENDING templates are eligible
        start = date(2026, 11, 17)
        end = date(2026, 11, 23)
        # Should not raise CalendarCapacityError because active eligible templates = 100 <= 100
        schedules = select_collection_schedules(start, end, reference_date=self.ref_date)
        self.assertEqual(len(schedules), 100)

        # Adding a 101st PENDING template must trigger CalendarCapacityError
        CollectionSchedule.objects.create(
            days='Mon',
            start_time=time(6, 0),
            end_time=time(14, 0),
            area='Active Overflow 101',
            status='PENDING',
        )
        with self.assertRaises(CalendarCapacityError):
            select_collection_schedules(start, end, reference_date=self.ref_date)

    def test_historical_completion_uses_stop_validation_not_template_status(self):
        """Historical completion classification relies strictly on StopValidation evidence, not schedule.status."""
        driver_user = User.objects.create_user(
            username='history_driver',
            email='history_driver@lucena.gov.ph',
            password='testpassword123',
            role='driver',
        )
        sched = CollectionSchedule.objects.create(
            date=self.past_date,
            start_time=time(8, 0),
            end_time=time(12, 0),
            driver=driver_user,
            status='COMPLETED',  # Administrative status
            waypoints=[
                {'lat': 13.9, 'lng': 121.6, 'label': 'Depot'},
                {'lat': 13.91, 'lng': 121.61, 'label': 'Stop 1'},
            ],
        )

        # 1. With no StopValidation evidence: status must be 'unverified' even though template is 'COMPLETED'
        status_unverified = determine_completion_status(
            sched, self.past_date, stop_dict=None, reference_date=self.ref_date
        )
        self.assertEqual(status_unverified, 'unverified')

        # 2. With verified StopValidation: status is 'verified_collected'
        StopValidation.objects.update_or_create(
            schedule=sched,
            stop_order=1,
            collection_date=self.past_date,
            defaults={'current_status': StopValidationStatus.VERIFIED_COLLECTED},
        )
        val_map = fetch_stop_validations_map([sched.id], [self.past_date])
        stops = val_map.get((sched.id, self.past_date), {})
        status_verified = determine_completion_status(
            sched, self.past_date, stop_dict=stops, reference_date=self.ref_date
        )
        self.assertEqual(status_verified, 'verified_collected')
