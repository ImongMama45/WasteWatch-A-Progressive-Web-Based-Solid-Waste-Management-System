import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
django.setup()

from driver.models import DriverShift

updated = DriverShift.objects.filter(is_active=True, op_status='at_dumpsite').update(op_status='returning_to_base')
print(f"Updated {updated} shifts to returning_to_base.")
