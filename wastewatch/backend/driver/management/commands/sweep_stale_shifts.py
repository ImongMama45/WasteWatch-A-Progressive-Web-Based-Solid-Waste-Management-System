from datetime import timedelta
import logging

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models.functions import Coalesce
from django.utils import timezone

from driver.models import DriverShift

logger = logging.getLogger(__name__)

# Keep this equal to STALE_SHIFT_MS in frontend/src/utils/shiftState.js
STALE_AFTER = timedelta(hours=getattr(settings, 'SHIFT_STALE_HOURS', 6))


def sweep_stale_shifts(dry_run=False):
    from driver.shift_service import ShiftService

    cutoff = timezone.now() - STALE_AFTER
    stale = (
        DriverShift.objects
        .filter(is_active=True)
        .annotate(last_seen=Coalesce('last_location_update', 'started_at'))
        .filter(last_seen__lt=cutoff)
    )
    closed = []
    for s in stale:
        if dry_run:
            closed.append((s.id, s.truck_id, s.last_seen))
            continue
        try:
            ShiftService.conclude_shift_atomic(
                driver_shift_id=s.id,
                concluded_by=None,
                end_reason='heartbeat_timeout',
                ended_at=s.last_seen,
            )
            closed.append((s.id, s.truck_id, s.last_seen))
        except Exception:
            logger.exception(
                "Failed to conclude stale DriverShift #%s (truck_id=%s, last_seen=%s)",
                s.id,
                s.truck_id,
                s.last_seen,
            )
    if not dry_run:
        try:
            ShiftService.cleanup_stale_unlinked_watcher_shifts()
        except Exception:
            logger.exception("Failed during stale unlinked WatcherShift cleanup")
    return closed


class Command(BaseCommand):
    help = 'Close shifts whose heartbeat has been silent past SHIFT_STALE_HOURS.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Print what would be closed without writing to DB.')

    def handle(self, *args, **opts):
        rows = sweep_stale_shifts(dry_run=opts['dry_run'])
        verb = 'Would close' if opts['dry_run'] else 'Closed'
        for shift_id, truck_id, last_seen in rows:
            self.stdout.write(f'{verb} shift #{shift_id}  truck={truck_id}  last_seen={last_seen}')
        self.stdout.write(self.style.SUCCESS(f'{verb} {len(rows)} shift(s).'))
