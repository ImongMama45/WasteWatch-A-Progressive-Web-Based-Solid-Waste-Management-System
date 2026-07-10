import os
import django
import random
from datetime import time

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
django.setup()

from django.contrib.auth import get_user_model
from accounts.models import Barangay, UserRole
from driver.models import Truck, CollectionSchedule, RouteAssignment, PickupStatus, TruckCrewAssignment, DriverShift
from dumpsite.models import Dumpsite, WasteDelivery

User = get_user_model()

print("Cleaning up old data...")
# Delete related data that protects user deletion
WasteDelivery.objects.all().delete()

# Delete all users except admin
User.objects.exclude(role=UserRole.ADMIN).delete()

# Delete existing trucks, schedules, assignments to ensure clean state
Truck.objects.all().delete()
CollectionSchedule.objects.all().delete()
RouteAssignment.objects.all().delete()
PickupStatus.objects.all().delete()
TruckCrewAssignment.objects.all().delete()
DriverShift.objects.all().delete()

barangays = Barangay.objects.all()
print(f"Found {barangays.count()} barangays.")

dumpsite = Dumpsite.objects.first()

for idx, b in enumerate(barangays, start=1):
    safe_name = b.name.lower().replace(' ', '_').replace('.', '').replace('(', '').replace(')', '').replace('-', '_')
    
    # 1. Create Brgy Official
    official = User.objects.create_user(
        email=f"official_{safe_name}@lucena.gov.ph",
        password="password123",
        full_name=f"Official {b.name}",
        role=UserRole.BRGY_OFFICIAL,
        barangay=b,
        username=f"official_{safe_name}"
    )
    
    # 2. Create Watcher
    watcher = User.objects.create_user(
        email=f"watcher_{safe_name}@lucena.gov.ph",
        password="password123",
        full_name=f"Watcher {b.name}",
        role=UserRole.WATCHER,
        barangay=b,
        username=f"watcher_{safe_name}"
    )
    
    # 3. Create Driver
    driver = User.objects.create_user(
        email=f"driver_{safe_name}@lucena.gov.ph",
        password="password123",
        full_name=f"Driver {b.name}",
        role=UserRole.DRIVER,
        barangay=b,
        username=f"driver_{safe_name}"
    )
    
    # 4. Create Truck
    truck = Truck.objects.create(
        plate_number=f"LUC-{1000 + idx}",
        model="Hino 500 Series Garbage Compactor",
        status="active",
        current_capacity=0,
        max_capacity_kg=2500.00
    )
    truck.drivers.add(driver)
    
    # 5. Create Route / Collection Schedule
    # Generate some simple waypoints inside the barangay for the route
    lat = float(b.latitude) if b.latitude else 13.9314
    lng = float(b.longitude) if b.longitude else 121.6172
    
    waypoints = [
        {"lat": lat + 0.001, "lng": lng + 0.001, "label": f"{b.name} Stop 1", "barangay_id": b.id},
        {"lat": lat - 0.001, "lng": lng - 0.001, "label": f"{b.name} Stop 2", "barangay_id": b.id},
        {"lat": lat + 0.002, "lng": lng - 0.001, "label": f"{b.name} Stop 3", "barangay_id": b.id},
    ]
    
    schedule = CollectionSchedule.objects.create(
        truck=truck,
        driver=driver,
        area=f"Route - {b.name}",
        start_time=time(6, 0),  # 6:00 AM
        end_time=time(14, 0),   # 2:00 PM
        days="Mon, Wed, Fri",
        dumpsite=dumpsite,
        waypoints=waypoints
    )
    schedule.barangays.add(b)
    
    print(f"[{idx}/33] Created fixtures for {b.name}")

print("Seed data creation complete!")
