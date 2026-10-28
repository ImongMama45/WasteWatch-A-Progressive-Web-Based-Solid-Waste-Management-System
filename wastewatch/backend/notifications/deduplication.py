"""
notifications/deduplication.py
------------------------------
Database-backed deduplication helper for notifications.
Provides safe claiming of deduplication keys across concurrent workers.
"""

import datetime
import logging
import sqlite3
import threading
import time
from typing import Optional

from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from .models import NotificationDeduplication

logger = logging.getLogger(__name__)

DEDUP_CONSTRAINT_NAME = 'unique_notification_deduplication_key'
DEDUP_TABLE_NAME = 'notifications_notificationdeduplication'
DEDUP_SQLITE_ERROR_MSG = f'UNIQUE constraint failed: {DEDUP_TABLE_NAME}.key'

# Opportunistic cleanup configuration
_PRUNE_INTERVAL_SECONDS: float = 600.0  # Run pruning reservation at most once every 10 minutes per process
_last_prune_timestamp: Optional[float] = None
_prune_lock = threading.Lock()


def _reset_prune_throttle_for_testing() -> None:
    """Reset the module-level prune throttle state for testing isolation."""
    global _last_prune_timestamp
    with _prune_lock:
        _last_prune_timestamp = None


def _is_dedup_unique_violation(exc: IntegrityError) -> bool:
    """
    Narrowly classifies whether an IntegrityError was caused by a uniqueness
    violation on the NotificationDeduplication.key constraint.

    Re-raises or returns False for unrelated integrity errors, unknown backends,
    missing diagnostics, or mismatched constraint names.
    """
    cause = exc.__cause__
    if cause is None:
        # Without an underlying cause from the database driver, do not guess
        return False

    vendor = connection.vendor

    # 1. PostgreSQL (psycopg2 / psycopg)
    if vendor == 'postgresql':
        sqlstate = getattr(cause, 'pgcode', None) or getattr(cause, 'sqlstate', None)
        if sqlstate != '23505':
            return False
        diag = getattr(cause, 'diag', None)
        if diag is None:
            return False
        constraint_name = getattr(diag, 'constraint_name', None)
        return constraint_name == DEDUP_CONSTRAINT_NAME

    # 2. SQLite
    if vendor == 'sqlite':
        if isinstance(cause, sqlite3.IntegrityError):
            err_msg = str(cause).strip()
            return err_msg == DEDUP_SQLITE_ERROR_MSG
        err_msg = str(exc).strip()
        return err_msg == DEDUP_SQLITE_ERROR_MSG

    # 3. Unrecognized backends
    return False


def _maybe_prune_expired_records(now: datetime.datetime) -> None:
    """
    Opportunistically prunes deduplication records expired for more than 24 hours.

    Throttling and Concurrency:
        Guarantees at most one prune reservation per interval (_PRUNE_INTERVAL_SECONDS)
        per process. Thread-safe check-and-reserve is protected by `_prune_lock`.
        The lock is strictly released BEFORE executing any database queries to avoid
        holding locks during I/O.
        Using `None` as the initial sentinel ensures the first eligible call reserves
        a prune attempt regardless of system uptime.

    Failure and Transaction Semantics:
        A failed cleanup attempt (or one that encounters a database exception) still
        consumes the reserved interval; failures are logged and do not trigger immediate
        retries, protecting against repeated database pounding.
        If the outer transaction later rolls back, the in-memory timestamp remains
        advanced even though the database DELETE was rolled back. This affects maintenance
        timing only, not claim correctness.

    Process-local Throttling Limitation:
        In multi-process deployments (e.g. Gunicorn/Uvicorn workers), each worker process
        maintains its own `_last_prune_timestamp`. Consequently, each process may execute
        one cleanup reservation per interval independently. This affects only maintenance
        frequency and has zero impact on claim correctness, which relies solely on the
        database unique constraint.

    Transaction Safety:
        The deletion query is isolated inside a nested `transaction.atomic()` savepoint.
        Any database exception during pruning is caught and logged outside that nested
        block, leaving the surrounding transaction intact and usable when savepoints
        are supported.
    """
    global _last_prune_timestamp

    with _prune_lock:
        current_time = time.monotonic()
        if _last_prune_timestamp is not None and (current_time - _last_prune_timestamp < _PRUNE_INTERVAL_SECONDS):
            return
        _last_prune_timestamp = current_time

    # Database operation executed strictly outside the thread lock
    try:
        with transaction.atomic():
            prune_threshold = now - datetime.timedelta(hours=24)
            NotificationDeduplication.objects.filter(expires_at__lt=prune_threshold).delete()
    except Exception:
        logger.exception('Opportunistic pruning of expired deduplication rows failed')


def claim_deduplication_key(key: str, cooldown_seconds: int = 1800) -> bool:
    """
    Safely claims a deduplication key until its expiry.

    Returns:
        True  - if the key was successfully claimed (first claim or replaced expired claim)
        False - if the key is currently active and unexpired (duplicate claim)

    Raises:
        IntegrityError - if an unrelated integrity violation occurred.
    """
    now = timezone.now()
    new_expires_at = now + datetime.timedelta(seconds=cooldown_seconds)

    # Opportunistic pruning of records expired for more than 24 hours (throttled and savepoint-isolated).
    _maybe_prune_expired_records(now)

    # Step 1: In-place atomic update for an already expired row.
    # If the key exists and is expired, update its expires_at to new_expires_at.
    # If two workers race here, only one can update it; the second will see 0 rows updated.
    updated = NotificationDeduplication.objects.filter(
        key=key,
        expires_at__lte=now,
    ).update(expires_at=new_expires_at)

    if updated > 0:
        return True

    # Step 2: Attempt creation inside a nested savepoint (atomic block).
    # If the row does not exist, insert succeeds.
    # If an active unexpired row exists (or was updated by a racing worker),
    # creation raises IntegrityError, savepoint is rolled back cleanly,
    # and the surrounding transaction remains usable.
    try:
        with transaction.atomic():
            NotificationDeduplication.objects.create(
                key=key,
                expires_at=new_expires_at,
            )
        return True
    except IntegrityError as exc:
        if _is_dedup_unique_violation(exc):
            return False
        # Re-raise unrelated integrity errors
        raise
