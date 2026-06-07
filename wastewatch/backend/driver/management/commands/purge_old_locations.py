"""
purge_old_locations.py
-----------------------
Management command to delete TruckLocation rows older than a configurable
number of days. Run this as a scheduled task (cron / Celery beat) in production
to prevent unbounded table growth.

Usage:
    python manage.py purge_old_locations              # default: purge > 90 days
    python manage.py purge_old_locations --days 30    # purge > 30 days
    python manage.py purge_old_locations --dry-run    # preview without deleting

Scheduling examples:
    # Cron — runs every day at 2 AM
    0 2 * * * /path/to/venv/bin/python /path/to/manage.py purge_old_locations

    # Celery beat (celery_app.py)
    from celery.schedules import crontab
    app.conf.beat_schedule = {
        'purge-old-truck-locations': {
            'task': 'driver.tasks.purge_old_locations',
            'schedule': crontab(hour=2, minute=0),
        },
    }
"""

from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from driver.models import TruckLocation


class Command(BaseCommand):
    help = 'Purge TruckLocation rows older than --days (default 90)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--days',
            type=int,
            default=90,
            help='Delete location records older than this many days (default: 90)',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Count records that would be deleted without actually deleting them',
        )

    def handle(self, *args, **options):
        days    = options['days']
        dry_run = options['dry_run']

        cutoff  = timezone.now() - timedelta(days=days)
        qs      = TruckLocation.objects.filter(timestamp__lt=cutoff)
        count   = qs.count()

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f'[DRY RUN] Would delete {count:,} TruckLocation rows '
                    f'older than {days} days (before {cutoff.date()}).'
                )
            )
            return

        if count == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to purge.'))
            return

        deleted, _ = qs.delete()
        self.stdout.write(
            self.style.SUCCESS(
                f'Purged {deleted:,} TruckLocation rows older than '
                f'{days} days (before {cutoff.date()}).'
            )
        )
