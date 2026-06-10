"""
Daily reset: initialize PENDING_INSPECTION rows for today's scheduled stops.
Run via cron at the start of each collection day.
"""
from django.core.management.base import BaseCommand

from watcher.stop_validation_service import reset_completed_validations


class Command(BaseCommand):
    help = 'Initialize stop validations for today and hide expired completed stops.'

    def handle(self, *args, **options):
        created = reset_completed_validations()
        self.stdout.write(self.style.SUCCESS(f'Initialized {len(created)} stop validation(s) for today.'))
