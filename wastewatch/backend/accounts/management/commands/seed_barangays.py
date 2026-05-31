"""
accounts/management/commands/seed_barangays.py
-----------------------------------------------
Idempotent — safe to run multiple times.

Usage:
    python manage.py seed_barangays

Or load via fixture:
    python manage.py loaddata accounts/fixtures/barangays.json
"""

from django.core.management.base import BaseCommand
from accounts.models import Barangay

LUCENA_BARANGAYS = [
    "Barangay 1 (Pob.)",
    "Barangay 10 (Pob.)",
    "Barangay 11 (Pob.)",
    "Barangay 2 (Pob.)",
    "Barangay 3 (Pob.)",
    "Barangay 4 (Pob.)",
    "Barangay 5 (Pob.)",
    "Barangay 6 (Pob.)",
    "Barangay 7 (Pob.)",
    "Barangay 8 (Pob.)",
    "Barangay 9 (Pob.)",
    "Barra",
    "Bocohan",
    "Cotta",
    "Dalahican",
    "Domoit",
    "Gulang-Gulang",
    "Ibabang Dupay",
    "Ibabang Iyam",
    "Ibabang Talim",
    "Ilayang Dupay",
    "Ilayang Iyam",
    "Ilayang Talim",
    "Isabang",
    "Market View",
    "Mayao Castillo",
    "Mayao Crossing",
    "Mayao Kanluran",
    "Mayao Parada",
    "Mayao Silangan",
    "Ransohan",
    "Salinas",
    "Talao-Talao",
]


class Command(BaseCommand):
    help = "Seeds all 33 Lucena City barangays into the database."

    def handle(self, *args, **kwargs):
        created = 0
        skipped = 0

        for name in LUCENA_BARANGAYS:
            _, was_created = Barangay.objects.get_or_create(name=name)
            if was_created:
                created += 1
            else:
                skipped += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done — {created} created, {skipped} already existed."
            )
        )