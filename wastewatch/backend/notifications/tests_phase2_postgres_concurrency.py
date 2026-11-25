import threading
import time
from django.db import connection, transaction
from django.test import TransactionTestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User, UserRole
from news.models import EmergencyAlert
from notifications.models import (
    EmergencyActivationEvent,
    Notification,
    NotificationType,
)
from notifications.services import update_emergency_alert


class PostgreSQLConcurrencyActivationTests(TransactionTestCase):
    """
    Focused concurrency verification for EmergencyAlert lifecycle on PostgreSQL.
    Verifies that simultaneous activation requests targeting the same initially
    inactive EmergencyAlert cannot create duplicate activation events or duplicate
    emergency notifications under genuine concurrency and row-level locking.
    """

    def setUp(self):
        # Mandatory invariant: This test suite MUST run on PostgreSQL
        if connection.vendor != 'postgresql':
            self.fail(
                f"PostgreSQL concurrency verification cannot run on '{connection.vendor}'. "
                "A genuine PostgreSQL database is strictly required."
            )

        self.barangay = Barangay.objects.create(name='Barangay Concurrency Test')

        self.admin = User.objects.create_user(
            username='admin_concurrency',
            email='admin_concurrency@example.com',
            password='Password123!',
            role=UserRole.ADMIN,
            barangay=self.barangay,
            is_staff=True,
        )

    def _fixture_teardown(self):
        # Override TransactionTestCase._fixture_teardown to prevent `call_command('flush')`,
        # which attempts TRUNCATE across all tables and is blocked by PostgreSQL
        # prevent_roster_mutation() triggers on unrelated shift roster tables.
        Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT).delete()
        EmergencyActivationEvent.objects.all().delete()
        EmergencyAlert.objects.all().delete()
        User.objects.filter(username='admin_concurrency').delete()
        Barangay.objects.filter(name='Barangay Concurrency Test').delete()

    def test_simultaneous_drf_patch_activations_produce_exactly_one_event_and_one_notification(self):
        """
        Verify two simultaneous DRF PATCH requests attempting to activate the same
        inactive alert execute with genuine concurrency and produce exactly one
        EmergencyActivationEvent and one Notification.
        """
        alert = EmergencyAlert.objects.create(
            title='Typhoon Signal Concurrency Warning',
            body='Emergency alert body text for concurrency verification.',
            is_active=False,
        )
        alert_id = alert.pk

        barrier = threading.Barrier(2)
        results = []
        errors = []

        def activation_worker(worker_id):
            connection.close()
            client = APIClient()
            client.force_authenticate(user=self.admin)

            # Synchronize both threads to release simultaneously
            barrier.wait(timeout=10)
            t_start = time.time()
            try:
                response = client.patch(
                    f'/api/news/alerts/{alert_id}/',
                    data={'is_active': True},
                    format='json',
                )
                t_end = time.time()
                results.append({
                    'worker_id': worker_id,
                    'status_code': response.status_code,
                    'data': response.data,
                    'start_time': t_start,
                    'end_time': t_end,
                })
            except Exception as exc:
                t_end = time.time()
                errors.append({
                    'worker_id': worker_id,
                    'exception': exc,
                    'start_time': t_start,
                    'end_time': t_end,
                })
            finally:
                connection.close()

        t1 = threading.Thread(target=activation_worker, args=(1,), name='Worker-1')
        t2 = threading.Thread(target=activation_worker, args=(2,), name='Worker-2')

        t1.start()
        t2.start()

        t1.join(timeout=15)
        t2.join(timeout=15)

        self.assertFalse(t1.is_alive(), "Worker 1 did not finish in time")
        self.assertFalse(t2.is_alive(), "Worker 2 did not finish in time")

        # 0 unhandled exceptions or connection errors
        self.assertEqual(len(errors), 0, f"Encountered unexpected errors during concurrent requests: {errors}")
        self.assertEqual(len(results), 2, f"Expected 2 completed results, got {len(results)}")

        # Print detailed execution timings for verification evidence
        for r in results:
            print(
                f"[Worker {r['worker_id']}] HTTP {r['status_code']} | "
                f"Window: {r['start_time']:.4f} -> {r['end_time']:.4f} "
                f"(Duration: {r['end_time'] - r['start_time']:.4f}s) | "
                f"is_active: {r['data'].get('is_active')}"
            )

        # Both HTTP responses must be 200 OK with is_active=True
        for r in results:
            self.assertEqual(r['status_code'], status.HTTP_200_OK)
            self.assertTrue(r['data'].get('is_active'))

        # Refresh alert from database
        alert.refresh_from_db()
        self.assertTrue(alert.is_active, "EmergencyAlert must be active after concurrent activations")

        # Invariant 1: Exactly ONE EmergencyActivationEvent exists
        events = EmergencyActivationEvent.objects.filter(alert=alert)
        self.assertEqual(
            events.count(),
            1,
            f"Expected exactly 1 EmergencyActivationEvent, found {events.count()}"
        )
        event = events.first()
        self.assertEqual(event.sequence, 1, f"Expected sequence 1, got {event.sequence}")
        self.assertEqual(event.activated_by, self.admin)
        self.assertIsNone(event.deactivated_at, "Activation event must remain open")

        # Invariant 2: Exactly ONE Notification of type EMERGENCY_ALERT was created
        notifs = Notification.objects.filter(type=NotificationType.EMERGENCY_ALERT)
        self.assertEqual(
            notifs.count(),
            1,
            f"Expected exactly 1 EMERGENCY_ALERT notification, found {notifs.count()}"
        )
        notif = notifs.first()
        self.assertIsNone(notif.user, "Emergency notification must be city-wide (user=None)")
        self.assertIsNone(notif.barangay, "Emergency notification must be city-wide (barangay=None)")
        self.assertIn("Typhoon Signal Concurrency Warning", notif.title)

    def test_simultaneous_service_calls_produce_exactly_one_event_and_one_notification(self):
        """
        Verify two simultaneous direct calls to update_emergency_alert on separate
        connections produce exactly one EmergencyActivationEvent and one Notification.
        """
        alert = EmergencyAlert.objects.create(
            title='Direct Service Concurrency Warning',
            body='Direct service call concurrency body.',
            is_active=False,
        )
        alert_id = alert.pk

        barrier = threading.Barrier(2)
        results = []
        errors = []

        def service_worker(worker_id):
            connection.close()
            barrier.wait(timeout=10)
            t_start = time.time()
            try:
                updated = update_emergency_alert(
                    alert_pk=alert_id,
                    actor=self.admin,
                    validated_fields={'is_active': True},
                )
                t_end = time.time()
                results.append({
                    'worker_id': worker_id,
                    'is_active': updated.is_active,
                    'start_time': t_start,
                    'end_time': t_end,
                })
            except Exception as exc:
                t_end = time.time()
                errors.append({
                    'worker_id': worker_id,
                    'exception': exc,
                    'start_time': t_start,
                    'end_time': t_end,
                })
            finally:
                connection.close()

        t1 = threading.Thread(target=service_worker, args=(1,), name='ServiceWorker-1')
        t2 = threading.Thread(target=service_worker, args=(2,), name='ServiceWorker-2')

        t1.start()
        t2.start()

        t1.join(timeout=15)
        t2.join(timeout=15)

        self.assertFalse(t1.is_alive())
        self.assertFalse(t2.is_alive())

        self.assertEqual(len(errors), 0, f"Encountered unexpected errors during concurrent service calls: {errors}")
        self.assertEqual(len(results), 2)

        for r in results:
            print(
                f"[ServiceWorker {r['worker_id']}] Success | "
                f"Window: {r['start_time']:.4f} -> {r['end_time']:.4f} "
                f"(Duration: {r['end_time'] - r['start_time']:.4f}s)"
            )
            self.assertTrue(r['is_active'])

        alert.refresh_from_db()
        self.assertTrue(alert.is_active)

        events = EmergencyActivationEvent.objects.filter(alert=alert)
        self.assertEqual(events.count(), 1)
        self.assertEqual(events.first().sequence, 1)

        notifs = Notification.objects.filter(title__contains='Direct Service Concurrency Warning')
        self.assertEqual(notifs.count(), 1)
