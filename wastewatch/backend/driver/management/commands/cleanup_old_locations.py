import os
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from driver.models import TruckLocation

class Command(BaseCommand):
    help = 'Deletes TruckLocation records older than 90 days to save database space.'

    def handle(self, *args, **options):
        # Calculate the cutoff date (90 days ago)
        cutoff = timezone.now() - timedelta(days=90)
        
        # Delete the old records
        deleted, _ = TruckLocation.objects.filter(timestamp__lt=cutoff).delete()
        
        # Output success message
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} location records older than {cutoff.date()}"))
