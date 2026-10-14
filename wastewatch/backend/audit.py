import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
django.setup()

from driver.models import Truck
from django.contrib.auth import get_user_model

User = get_user_model()

print("--- AUDIT START ---")

# Users in Truck.drivers whose role != 'driver'
bad_drivers = Truck.drivers.through.objects.filter(~django.db.models.Q(user__role='driver'))
if bad_drivers.exists():
    print("Bad drivers:", [(x.truck_id, x.user_id, x.user.role) for x in bad_drivers])
else:
    print("Bad drivers: 0")

# Users in Truck.crew whose employee_type != 'crew_member'
bad_crew = Truck.crew.through.objects.filter(~django.db.models.Q(user__employee_type='crew_member'))
if bad_crew.exists():
    print("Bad crew:", [(x.truck_id, x.user_id, x.user.employee_type) for x in bad_crew])
else:
    print("Bad crew: 0")

# Trucks with > 2 drivers
from django.db.models import Count
too_many_drivers = Truck.objects.annotate(driver_count=Count('drivers')).filter(driver_count__gt=2)
if too_many_drivers.exists():
    print("Too many drivers:", [t.plate_number for t in too_many_drivers])
else:
    print("Too many drivers: 0")

# Users on > 1 active truck (as driver or crew)
active_trucks = Truck.objects.filter(status='active')
user_active_truck_counts = {}
for t in active_trucks:
    for d in t.drivers.all():
        user_active_truck_counts.setdefault(d, []).append(t.plate_number)
    for c in t.crew.all():
        user_active_truck_counts.setdefault(c, []).append(t.plate_number)

mult_active = {u.full_name: plates for u, plates in user_active_truck_counts.items() if len(plates) > 1}
if mult_active:
    print("Users on >1 active truck:", mult_active)
else:
    print("Users on >1 active truck: 0")

print("--- AUDIT END ---")
