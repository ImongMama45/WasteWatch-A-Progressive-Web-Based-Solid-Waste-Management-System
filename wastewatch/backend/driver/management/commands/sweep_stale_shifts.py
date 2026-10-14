from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models.functions import Coalesce
from django.utils import timezone

from driver.models import DriverShift

# Keep this equal to STALE_SHIFT_MS in frontend/src/utils/shiftState.js
STALE_AFTER = timedelta(hours=getattr(settings, 'SHIFT_STALE_HOURS', 6))


def sweep_stale_shifts(dry_run=False):
    cutoff = timezone.now() - STALE_AFTER
    stale = (
        DriverShift.objects
        .filter(is_active=True)
        .annotate(last_seen=Coalesce('last_location_update', 'started_at'))
        .filter(last_seen__lt=cutoff)
    )
    closed = []
    for s in stale:
        closed.append((s.id, s.truck_id, s.last_seen))
        if dry_run:
            continue
        s.is_active = False
        s.end_reason = 'heartbeat_timeout'
        s.ended_at = s.last_seen        # last proof of life, not "now"
        s.duration_ms = int((s.ended_at - s.started_at).total_seconds() * 1000)
        s.save(update_fields=['is_active', 'end_reason', 'ended_at', 'duration_ms'])
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
