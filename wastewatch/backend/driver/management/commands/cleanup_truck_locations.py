from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from driver.models import TruckLocation


class Command(BaseCommand):
    help = 'Delete TruckLocation records older than the retention window'

    def add_arguments(self, parser):
        parser.add_argument(
            '--days', type=int, default=30,
            help='Keep records from the last N days (default: 30)'
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Print how many rows would be deleted without deleting'
        )

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=options['days'])
        qs = TruckLocation.objects.filter(timestamp__lt=cutoff)
        count = qs.count()

        if options['dry_run']:
            self.stdout.write(
                self.style.WARNING(
                    f'DRY RUN: would delete {count} rows older than {options["days"]} days '
                    f'(before {cutoff.date()})'
                )
            )
            return

        deleted, _ = qs.delete()
        self.stdout.write(
            self.style.SUCCESS(
                f'Deleted {deleted} TruckLocation records older than {options["days"]} days'
            )
        )