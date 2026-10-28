"""
Focused tests for Notification deduplication foundation (Step 1).
"""

import datetime
import sqlite3
import threading
import unittest
from unittest.mock import MagicMock, patch

from django.db import IntegrityError, connection, transaction, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from accounts.models import Barangay
from notifications.models import NotificationDeduplication
from notifications.deduplication import (
    claim_deduplication_key,
    _is_dedup_unique_violation,
    _reset_prune_throttle_for_testing,
    DEDUP_CONSTRAINT_NAME,
    DEDUP_SQLITE_ERROR_MSG,
)


class NotificationDeduplicationTests(TestCase):
    def setUp(self):
        super().setUp()
        _reset_prune_throttle_for_testing()

    def tearDown(self):
        _reset_prune_throttle_for_testing()
        super().tearDown()

    def test_first_claim_succeeds(self):
        """A first valid claim succeeds and stores an unexpired row."""
        key = 'truck_near_shift_1_stop_1'
        res = claim_deduplication_key(key, cooldown_seconds=60)
        self.assertTrue(res)

        record = NotificationDeduplication.objects.get(key=key)
        self.assertGreater(record.expires_at, timezone.now())

    def test_duplicate_unexpired_claim_fails(self):
        """A duplicate unexpired claim returns False without creating extra rows."""
        key = 'truck_near_shift_1_stop_2'
        first = claim_deduplication_key(key, cooldown_seconds=120)
        self.assertTrue(first)

        second = claim_deduplication_key(key, cooldown_seconds=120)
        self.assertFalse(second)

        self.assertEqual(NotificationDeduplication.objects.filter(key=key).count(), 1)

    def test_expired_claim_can_be_replaced(self):
        """An expired claim can be replaced by updating the row in place."""
        key = 'truck_near_shift_1_stop_3'
        past_time = timezone.now() - datetime.timedelta(seconds=30)
        NotificationDeduplication.objects.create(key=key, expires_at=past_time)

        # Attempt to claim the expired key
        res = claim_deduplication_key(key, cooldown_seconds=300)
        self.assertTrue(res)

        # Confirm exactly one row exists and its expiration was updated to the future
        self.assertEqual(NotificationDeduplication.objects.filter(key=key).count(), 1)
        record = NotificationDeduplication.objects.get(key=key)
        self.assertGreater(record.expires_at, timezone.now())

    def test_sqlite_classifier_behavior_live(self):
        """Verify SQLite exact error message matching on actual database."""
        if connection.vendor != 'sqlite':
            self.skipTest('SQLite live test only')

        key = 'live_sqlite_dup_test'
        NotificationDeduplication.objects.create(
            key=key,
            expires_at=timezone.now() + datetime.timedelta(minutes=5),
        )

        caught_exc = None
        try:
            with transaction.atomic():
                NotificationDeduplication.objects.create(
                    key=key,
                    expires_at=timezone.now() + datetime.timedelta(minutes=5),
                )
        except IntegrityError as exc:
            caught_exc = exc

        self.assertIsNotNone(caught_exc)
        self.assertTrue(_is_dedup_unique_violation(caught_exc))

        # Confirm claim helper handles it cleanly
        self.assertFalse(claim_deduplication_key(key, cooldown_seconds=300))

    def test_classifier_postgresql_diagnostics_unit(self):
        """Unit test error classifier for PostgreSQL with SQLSTATE 23505 and exact constraint name."""
        # 1. psycopg2 pattern: pgcode + diag.constraint_name
        cause_psycopg2 = Exception('duplicate key value violates unique constraint')
        cause_psycopg2.pgcode = '23505'
        cause_psycopg2.diag = MagicMock()
        cause_psycopg2.diag.constraint_name = DEDUP_CONSTRAINT_NAME
        exc_psycopg2 = IntegrityError('duplicate key')
        exc_psycopg2.__cause__ = cause_psycopg2

        with patch.object(connection, 'vendor', 'postgresql'):
            self.assertTrue(_is_dedup_unique_violation(exc_psycopg2))

        # 2. psycopg3 pattern: sqlstate + diag.constraint_name
        cause_psycopg3 = Exception('duplicate key value violates unique constraint')
        cause_psycopg3.sqlstate = '23505'
        cause_psycopg3.diag = MagicMock()
        cause_psycopg3.diag.constraint_name = DEDUP_CONSTRAINT_NAME
        exc_psycopg3 = IntegrityError('duplicate key')
        exc_psycopg3.__cause__ = cause_psycopg3

        with patch.object(connection, 'vendor', 'postgresql'):
            self.assertTrue(_is_dedup_unique_violation(exc_psycopg3))

    def test_unrelated_uniqueness_and_integrity_errors_not_swallowed(self):
        """Unrelated integrity errors, missing diagnostics, and wrong constraints must return False / re-raise."""
        # 1. PostgreSQL: mismatched constraint name
        cause = Exception('duplicate key')
        cause.pgcode = '23505'
        cause.diag = MagicMock()
        cause.diag.constraint_name = 'some_unrelated_constraint'
        exc = IntegrityError('duplicate key')
        exc.__cause__ = cause

        with patch.object(connection, 'vendor', 'postgresql'):
            self.assertFalse(_is_dedup_unique_violation(exc))

        # 2. PostgreSQL: wrong SQLSTATE (e.g. 23502 NOT NULL violation)
        cause_not_null = Exception('null value in column')
        cause_not_null.pgcode = '23502'
        cause_not_null.diag = MagicMock()
        cause_not_null.diag.constraint_name = DEDUP_CONSTRAINT_NAME
        exc_not_null = IntegrityError('null value')
        exc_not_null.__cause__ = cause_not_null

        with patch.object(connection, 'vendor', 'postgresql'):
            self.assertFalse(_is_dedup_unique_violation(exc_not_null))

        # 3. PostgreSQL: missing diag attribute
        cause_no_diag = Exception('duplicate key without diag')
        cause_no_diag.pgcode = '23505'
        cause_no_diag.diag = None
        exc_no_diag = IntegrityError('error')
        exc_no_diag.__cause__ = cause_no_diag

        with patch.object(connection, 'vendor', 'postgresql'):
            self.assertFalse(_is_dedup_unique_violation(exc_no_diag))

        # 4. SQLite: unrelated table unique violation
        cause_other_table = sqlite3.IntegrityError('UNIQUE constraint failed: accounts_barangay.name')
        exc_other_table = IntegrityError('duplicate barangay')
        exc_other_table.__cause__ = cause_other_table

        with patch.object(connection, 'vendor', 'sqlite'):
            self.assertFalse(_is_dedup_unique_violation(exc_other_table))

        # 5. SQLite: unrelated NOT NULL violation
        cause_sqlite_null = sqlite3.IntegrityError('NOT NULL constraint failed: notifications_notificationdeduplication.key')
        exc_sqlite_null = IntegrityError('null key')
        exc_sqlite_null.__cause__ = cause_sqlite_null

        with patch.object(connection, 'vendor', 'sqlite'):
            self.assertFalse(_is_dedup_unique_violation(exc_sqlite_null))

        # 6. Missing __cause__
        exc_orphan = IntegrityError('orphan error')
        exc_orphan.__cause__ = None
        self.assertFalse(_is_dedup_unique_violation(exc_orphan))

        # 7. Unrecognized database vendor
        with patch.object(connection, 'vendor', 'mysql'):
            exc_mysql = IntegrityError('mysql err')
            self.assertFalse(_is_dedup_unique_violation(exc_mysql))

        # 8. Real database NOT NULL statement failure is not swallowed and re-raises
        with self.assertRaises(IntegrityError):
            # Passing key=None executes real SQL statement INSERT with NULL key, violating NOT NULL
            claim_deduplication_key(key=None, cooldown_seconds=60)

    def test_sqlite_classifier_fallback_branch(self):
        """Test SQLite classifier fallback branch when cause is not direct sqlite3.IntegrityError."""
        cause = Exception('custom driver wrapper')
        exc = IntegrityError(DEDUP_SQLITE_ERROR_MSG)
        exc.__cause__ = cause

        with patch.object(connection, 'vendor', 'sqlite'):
            self.assertTrue(_is_dedup_unique_violation(exc))

            # Mismatched error message must return False
            exc_mismatch = IntegrityError('UNIQUE constraint failed: accounts_barangay.name')
            exc_mismatch.__cause__ = cause
            self.assertFalse(_is_dedup_unique_violation(exc_mismatch))

    def test_deduplication_key_length_boundary(self):
        """Verify that maximum allowable key length (150 chars) and typical key formats succeed."""
        # Test exact 150-char boundary
        key_150 = 'x' * 150
        self.assertTrue(claim_deduplication_key(key_150, cooldown_seconds=60))
        self.assertTrue(NotificationDeduplication.objects.filter(key=key_150).exists())

        # Test typical real-world key formats
        key_shift = 'truck_near_shift_987654321_stop_123'
        self.assertTrue(claim_deduplication_key(key_shift, cooldown_seconds=60))
        self.assertLess(len(key_shift), 150)

    def test_pruning_throttle_thread_concurrency(self):
        """
        Verify that concurrent worker threads in the same process cannot reserve
        multiple pruning attempts for the same interval.
        """
        _reset_prune_throttle_for_testing()
        now = timezone.now()
        prune_reservations = []

        mock_qs = MagicMock()

        def spy_filter(*args, **kwargs):
            prune_reservations.append(threading.get_ident())
            return mock_qs

        barrier = threading.Barrier(5)

        def worker():
            barrier.wait(timeout=5)
            from notifications.deduplication import _maybe_prune_expired_records
            _maybe_prune_expired_records(now)

        with patch('notifications.deduplication.transaction.atomic'), \
             patch('notifications.deduplication.NotificationDeduplication.objects.filter', side_effect=spy_filter):
            threads = [threading.Thread(target=worker) for _ in range(5)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=5)

        # Exactly one thread must have reserved and executed the pruning query
        self.assertEqual(len(prune_reservations), 1)

    def test_expired_record_pruning_does_not_remove_unexpired_rows(self):
        """Pruning deletes records older than 24 hours without touching active or recently expired records."""
        now = timezone.now()

        active_key = 'active_key_1'
        recent_expired_key = 'recent_expired_key_2'
        ancient_expired_key = 'ancient_expired_key_3'

        NotificationDeduplication.objects.create(
            key=active_key,
            expires_at=now + datetime.timedelta(hours=2),
        )
        NotificationDeduplication.objects.create(
            key=recent_expired_key,
            expires_at=now - datetime.timedelta(hours=4),  # expired 4h ago (< 24h)
        )
        NotificationDeduplication.objects.create(
            key=ancient_expired_key,
            expires_at=now - datetime.timedelta(hours=26),  # expired 26h ago (> 24h)
        )

        # Claiming a new key triggers opportunistic pruning
        claim_deduplication_key('trigger_pruning_key', cooldown_seconds=60)

        # Active record MUST remain
        self.assertTrue(NotificationDeduplication.objects.filter(key=active_key).exists())
        # Recently expired record MUST remain
        self.assertTrue(NotificationDeduplication.objects.filter(key=recent_expired_key).exists())
        # Ancient expired record MUST have been pruned
        self.assertFalse(NotificationDeduplication.objects.filter(key=ancient_expired_key).exists())

    def test_transaction_savepoint_behavior_after_duplicate_claim(self):
        """An expected duplicate collision inside an atomic block must not corrupt the surrounding transaction."""
        key = 'savepoint_test_key'

        with transaction.atomic():
            # Initial claim succeeds
            self.assertTrue(claim_deduplication_key(key, cooldown_seconds=60))

            # Perform a database write in the surrounding transaction
            b = Barangay.objects.create(name='Barangay Savepoint Alpha')

            # Competing duplicate claim is rejected
            self.assertFalse(claim_deduplication_key(key, cooldown_seconds=60))

            # Surrounding transaction remains intact and can continue making queries and writes
            b.name = 'Barangay Savepoint Alpha Renamed'
            b.save()

            reloaded = Barangay.objects.get(pk=b.pk)
            self.assertEqual(reloaded.name, 'Barangay Savepoint Alpha Renamed')

    def test_pruning_failure_recovers_savepoint_live_sqlite(self):
        """
        Regression test for savepoint recovery using real database-level statement failure on SQLite.
        Uses a temporary SQLite database trigger to force an abort during the DELETE query,
        proving that the inner savepoint rolls back the statement failure and leaves the surrounding
        transaction usable.
        """
        if connection.vendor != 'sqlite':
            self.skipTest('SQLite trigger test only')

        _reset_prune_throttle_for_testing()
        key = 'pruning_savepoint_recovery_live_key'

        # Create an old record that matches the prune criteria
        ancient_time = timezone.now() - datetime.timedelta(hours=25)
        NotificationDeduplication.objects.create(key='ancient_row_for_trigger', expires_at=ancient_time)

        # Create an SQLite trigger that forces the database engine to abort on DELETE
        with connection.cursor() as cursor:
            cursor.execute('''
                CREATE TRIGGER test_prune_engine_abort
                BEFORE DELETE ON notifications_notificationdeduplication
                BEGIN
                    SELECT RAISE(ABORT, 'Database engine forced abort during pruning delete');
                END;
            ''')

        try:
            with transaction.atomic():
                # Initial write in surrounding transaction
                b = Barangay.objects.create(name='Barangay Pre-Prune Trigger Error')

                # Pruning runs, SQLite engine raises statement abort, inner savepoint rolls back cleanly
                claimed = claim_deduplication_key(key, cooldown_seconds=60)
                self.assertTrue(claimed)

                # Crucial check: outer transaction can still execute queries and writes
                b.name = 'Barangay Post-Prune Trigger Error Renamed'
                b.save()

                reloaded = Barangay.objects.get(pk=b.pk)
                self.assertEqual(reloaded.name, 'Barangay Post-Prune Trigger Error Renamed')
                self.assertTrue(NotificationDeduplication.objects.filter(key=key).exists())
        finally:
            with connection.cursor() as cursor:
                cursor.execute('DROP TRIGGER IF EXISTS test_prune_engine_abort;')
            NotificationDeduplication.objects.filter(key='ancient_row_for_trigger').delete()

    def test_pruning_frequency_is_bounded(self):
        """
        Verify that opportunistic pruning is throttled to run at most once per
        interval, preventing deletion queries on every single claim.
        """
        from notifications import deduplication

        prune_calls = []
        orig_filter = NotificationDeduplication.objects.filter

        def spy_filter(*args, **kwargs):
            if 'expires_at__lt' in kwargs:
                prune_calls.append(kwargs)
            return orig_filter(*args, **kwargs)

        with patch.object(NotificationDeduplication.objects, 'filter', side_effect=spy_filter):
            # First claim: prune timestamp is None -> pruning executes
            claim_deduplication_key('bounded_key_1', cooldown_seconds=60)
            self.assertEqual(len(prune_calls), 1)

            # Immediate second claim: within throttle interval -> pruning skipped
            claim_deduplication_key('bounded_key_2', cooldown_seconds=60)
            self.assertEqual(len(prune_calls), 1)

            # Immediate third claim: still within throttle interval -> pruning skipped
            claim_deduplication_key('bounded_key_3', cooldown_seconds=60)
            self.assertEqual(len(prune_calls), 1)

            # Advance time beyond _PRUNE_INTERVAL_SECONDS
            with deduplication._prune_lock:
                deduplication._last_prune_timestamp -= (deduplication._PRUNE_INTERVAL_SECONDS + 1)

            # Fourth claim: interval elapsed -> pruning executes again
            claim_deduplication_key('bounded_key_4', cooldown_seconds=60)
            self.assertEqual(len(prune_calls), 2)


class PostgreSQLIntegrationTests(TransactionTestCase):
    @unittest.skipUnless(connection.vendor == 'postgresql', 'Requires PostgreSQL test database for transaction abort recovery test')
    def test_pruning_savepoint_recovery_aborted_transaction_postgresql(self):
        """
        On PostgreSQL, any SQL statement error aborts the transaction block.
        This test verifies that an actual statement error (division by zero) inside the nested savepoint
        rolls back cleanly so the outer transaction can continue without encountering
        'current transaction is aborted, commands ignored until end of transaction block'.
        """
        key = 'pg_savepoint_recovery_key'
        _reset_prune_throttle_for_testing()

        orig_filter = NotificationDeduplication.objects.filter
        injected_failures_count = 0

        def rejected_sql_filter(*args, **kwargs):
            nonlocal injected_failures_count
            # Intercept specifically the pruning cleanup query inside the nested savepoint
            if 'expires_at__lt' in kwargs:
                injected_failures_count += 1
                with connection.cursor() as cursor:
                    # Execute a statement rejected by the database engine
                    cursor.execute("SELECT 1 / 0;")
            return orig_filter(*args, **kwargs)

        with transaction.atomic():
            b = Barangay.objects.create(name='Barangay PG Savepoint')

            # Pruning executes inside the nested atomic savepoint; rejected SQL causes
            # the savepoint to roll back and the pruning error handler to catch the failure.
            with patch.object(NotificationDeduplication.objects, 'filter', side_effect=rejected_sql_filter):
                claimed = claim_deduplication_key(key, cooldown_seconds=60)
                self.assertTrue(claimed)

            # Explicitly assert that the injected SQL failure occurred exactly once during pruning
            self.assertEqual(
                injected_failures_count, 1,
                "Expected injected PostgreSQL SQL failure to occur exactly once during pruning"
            )

            # If savepoint was missing or corrupted, any subsequent query on PostgreSQL would fail with
            # 'current transaction is aborted, commands ignored until end of transaction block'.
            # Both write (UPDATE) and read (SELECT) must succeed on the outer transaction.
            b.name = 'Barangay PG Savepoint Renamed'
            b.save()
            self.assertEqual(Barangay.objects.get(pk=b.pk).name, 'Barangay PG Savepoint Renamed')
            self.assertTrue(NotificationDeduplication.objects.filter(key=key).exists())

    @unittest.skipUnless(connection.vendor == 'postgresql', 'Requires PostgreSQL test database for multi-connection concurrency test')
    def test_concurrent_expired_key_replacement_postgresql(self):
        """Two concurrent workers trying to replace the same expired key: exactly one wins on PostgreSQL."""
        key = 'concurrent_expired_key'
        past = timezone.now() - datetime.timedelta(minutes=10)
        NotificationDeduplication.objects.create(key=key, expires_at=past)

        results = []
        worker_errors = []
        barrier = threading.Barrier(2)

        def worker():
            connections['default'].close()
            try:
                barrier.wait(timeout=5)
                won = claim_deduplication_key(key, cooldown_seconds=60)
                results.append(won)
            except Exception as exc:
                worker_errors.append(exc)
            finally:
                connections['default'].close()

        t1 = threading.Thread(target=worker)
        t2 = threading.Thread(target=worker)

        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        # Propagate actual worker exceptions if any
        if worker_errors:
            self.fail(f"Worker thread failed with exception: {worker_errors[0]}")

        # Invariant: exactly one worker wins
        self.assertEqual(len(results), 2)
        self.assertEqual(sorted(results), [False, True])

        # Verify final database state: exactly 1 row exists and expires_at was updated to future
        records = list(NotificationDeduplication.objects.filter(key=key))
        self.assertEqual(len(records), 1)
        self.assertGreater(records[0].expires_at, timezone.now())

