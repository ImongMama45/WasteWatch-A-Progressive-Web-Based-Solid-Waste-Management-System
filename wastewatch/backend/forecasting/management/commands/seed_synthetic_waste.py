"""
forecasting/management/commands/seed_synthetic_waste.py
-------------------------------------------------------
Development-only utility to generate synthetic WasteDelivery fixture records.
Strictly forbidden when DEBUG=False to prevent production database corruption.
All created records are explicitly flagged with is_synthetic=True.
"""

import random
from datetime import date, timedelta
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings
from django.utils import timezone

from accounts.models import User, Barangay
from driver.models import Truck
from dumpsite.models import Dumpsite, WasteDelivery


class Command(BaseCommand):
    help = "Generates synthetic WasteDelivery records strictly for local development testing (DEBUG=True only)."

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=60, help="Number of calendar days to seed (default: 60)")

    def handle(self, *args, **options):
        if not getattr(settings, 'DEBUG', False):
            raise CommandError("Synthetic seeding is strictly prohibited in production (DEBUG=False).")

        days_count = options['days']
        today = timezone.localdate()
        yesterday = today - timedelta(days=1)
        start_date = yesterday - timedelta(days=days_count - 1)

        self.stdout.write(f"Seeding synthetic deliveries from {start_date} to {yesterday}...")

        barangays = list(Barangay.objects.all()[:10])
        if not barangays:
            raise CommandError("No barangays found in database. Seed barangays first.")

        truck, _ = Truck.objects.get_or_create(
            plate_number="AAA-111",
            defaults={
                'model': "Isuzu Forward Compactor",
                'max_capacity_kg': 8000,
                'status': "active"
            }
        )

        driver = User.objects.filter(role='driver').first()
        if not driver:
            driver = User.objects.first()

        dumpsite = Dumpsite.objects.first()
        if not dumpsite:
            dumpsite = Dumpsite.objects.create(
                name="Lucena Central Sanitary Landfill",
                type="dumpsite",
                barangay=barangays[0],
                latitude=13.937,
                longitude=121.617
            )

        curr = start_date
        created_count = 0

        while curr <= yesterday:
            # Skip Sundays (scheduled non-collection day in Lucena)
            if curr.weekday() == 6 and random.random() < 0.85:
                curr += timedelta(days=1)
                continue

            # 2 to 4 deliveries per operational day
            trips = random.randint(2, 4)
            for _ in range(trips):
                gross = random.uniform(8500, 11500)
                tare = 4500.0
                est_kg = gross - tare

                d = WasteDelivery.objects.create(
                    truck=truck,
                    driver=driver,
                    dumpsite=dumpsite,
                    date=curr,
                    gross_weight=gross,
                    tare_weight=tare,
                    estimated_kg=est_kg,
                    is_validated=True,
                    is_synthetic=True,  # Mandatory provenance flag (F-01, F-10 fix)
                    remarks="Synthetic fixture record for developer testing"
                )
                sample_brgys = random.sample(barangays, k=random.randint(1, min(3, len(barangays))))
                d.barangays.set(sample_brgys)
                created_count += 1

            curr += timedelta(days=1)

        self.stdout.write(self.style.SUCCESS(
            f"Successfully seeded {created_count} synthetic WasteDelivery records (is_synthetic=True)."
        ))
