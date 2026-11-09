import os
import django
from datetime import date

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
django.setup()

from driver.models import CollectionSchedule
from django.db.models import Count, Q

print("--- STEP 3B AUDIT START ---")

# Distinct CollectionSchedule.days with row count
days_counts = CollectionSchedule.objects.values('days').annotate(count=Count('id')).order_by('-count')
print("CollectionSchedule.days formats:")
for d in days_counts:
    print(f"  '{d['days']}': {d['count']} rows")

# Schedules where driver is not in truck.drivers
print("\nSchedules with missing driver from truck.drivers:")
bad_schedules = []
for sched in CollectionSchedule.objects.filter(driver__isnull=False, truck__isnull=False):
    if not sched.truck.drivers.filter(id=sched.driver_id).exists():
        print(f"  ID: {sched.id}, Truck: {sched.truck.plate_number}, Driver: {sched.driver.full_name}")

# Overlapping schedule pairs
def normalize_days(val):
    if not val:
        return set()
    if isinstance(val, list):
        items = val
    else:
        items = val.split(',')
    return set(d.strip()[:3].lower() for d in items if d.strip())

def get_mins(t):
    return t.hour * 60 + t.minute if t else 0

print("\nOverlapping schedule pairs:")
schedules = list(CollectionSchedule.objects.filter(truck__isnull=False, driver__isnull=False))
overlaps = []
for i in range(len(schedules)):
    for j in range(i+1, len(schedules)):
        s1 = schedules[i]
        s2 = schedules[j]
        if s1.truck_id == s2.truck_id or s1.driver_id == s2.driver_id:
            days1 = normalize_days(s1.days)
            days2 = normalize_days(s2.days)
            if not days1.intersection(days2):
                continue
            start1 = get_mins(s1.start_time)
            end1 = get_mins(s1.end_time)
            start2 = get_mins(s2.start_time)
            end2 = get_mins(s2.end_time)
            if start1 < end2 and end1 > start2:
                shared = list(days1.intersection(days2))
                overlaps.append((s1.id, s2.id, shared))

for o in overlaps:
    print(f"  Pair: {o[0]} and {o[1]} (Shared days: {o[2]})")

# Overnight or bad data
print("\nOvernight/Bad data schedules (start >= end):")
for s in schedules:
    if get_mins(s.start_time) >= get_mins(s.end_time):
        print(f"  ID: {s.id}")

# Date set vs null
date_set = CollectionSchedule.objects.filter(date__isnull=False).count()
date_null = CollectionSchedule.objects.filter(date__isnull=True).count()
print(f"\nSchedules with specific date: {date_set}")
print(f"Recurring schedules (null date): {date_null}")

print("--- STEP 3B AUDIT END ---")
