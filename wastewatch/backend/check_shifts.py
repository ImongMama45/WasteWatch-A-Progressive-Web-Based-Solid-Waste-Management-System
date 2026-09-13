import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
django.setup()

from driver.models import DriverShift

shift = DriverShift.objects.filter(is_active=True).order_by('-id').first()
if shift:
    print(f"Shift ID: {shift.id}")
    print(f"Driver: {shift.driver.full_name}")
    print(f"Truck: {shift.truck.plate_number if shift.truck else 'None'}")
    print(f"Phase: {shift.status}")
    print(f"Op Status: {shift.op_status}")
else:
    print("No active shifts")

# Print all active shifts
print("\nAll Active Shifts:")
for s in DriverShift.objects.filter(is_active=True):
    print(f"[{s.id}] {s.driver.full_name} | phase: {s.status} | op_status: {s.op_status}")

