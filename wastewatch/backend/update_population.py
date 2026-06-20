import os
import django
import sys

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
django.setup()

from accounts.models import Barangay

population_data = {
  "Barangay 1 (Pob.)": 2346,
  "Barangay 10 (Pob.)": 3835,
  "Barangay 11 (Pob.)": 1785,
  "Barangay 2 (Pob.)": 944,
  "Barangay 3 (Pob.)": 741,
  "Barangay 4 (Pob.)": 2997,
  "Barangay 5 (Pob.)": 2749,
  "Barangay 6 (Pob.)": 863,
  "Barangay 7 (Pob.)": 1515,
  "Barangay 8 (Pob.)": 3337,
  "Barangay 9 (Pob.)": 3206
}

updated_count = 0
not_found = []

for name, pop in population_data.items():
    try:
        b = Barangay.objects.get(name__iexact=name)
        b.population = pop
        b.save()
        updated_count += 1
        print(f"Updated {b.name} -> {pop}")
    except Barangay.DoesNotExist:
        not_found.append(name)
    except Barangay.MultipleObjectsReturned:
        print(f"Multiple barangays found for {name}, skipping.")

print(f"\nSuccessfully updated {updated_count} barangays.")
if not_found:
    print(f"Could not find exact matches for: {', '.join(not_found)}")
