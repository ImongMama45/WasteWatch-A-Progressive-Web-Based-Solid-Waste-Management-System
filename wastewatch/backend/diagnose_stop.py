"""
Run as:
    python manage.py shell -c "exec(open('diagnose_stop.py').read())"
"""
from driver.models import CollectionSchedule, PickupStatus, TruckCrewAssignment
from django.utils import timezone

today = timezone.localdate()

from accounts.models import User
drivers = User.objects.filter(role='driver')
print(f"\nFound {drivers.count()} driver(s)\n")

for driver in drivers:
    print("=" * 60)
    print(f"Driver: {driver.full_name} (id={driver.id})")
    print("=" * 60)

    assignment = TruckCrewAssignment.objects.filter(
        driver=driver, date=today, is_active=True
    ).select_related('schedule').first()
    print(f"  TruckCrewAssignment today: {assignment}")
    if assignment:
        print(f"    schedule_id: {assignment.schedule_id}")

    schedules = CollectionSchedule.objects.filter(driver=driver)
    print(f"\n  CollectionSchedules ({schedules.count()}):")
    for s in schedules:
        wp_count = len(s.waypoints or [])
        ps_count = PickupStatus.objects.filter(driver=driver, schedule=s).count()
        uncompleted = PickupStatus.objects.filter(
            driver=driver, schedule=s
        ).exclude(status='COMPLETED').count()
        print(f"    id={s.id}  date={s.date}  waypoints={wp_count}  rows={ps_count}  uncompleted={uncompleted}")

        if ps_count == 0 and wp_count > 1:
            print(f"    *** MISSING rows - running sync_pickup_statuses()...")
            s.sync_pickup_statuses()
            new_count = PickupStatus.objects.filter(driver=driver, schedule=s).count()
            print(f"    *** Created {new_count} rows")

    all_ps = PickupStatus.objects.filter(driver=driver).order_by('schedule_id', 'stop_order')
    print(f"\n  PickupStatus rows ({all_ps.count()}):")
    for ps in all_ps:
        addr = (ps.address or '')[:30]
        print(f"    id={ps.id}  sched={ps.schedule_id}  order={ps.stop_order}  status={ps.status}  addr={addr}")

    print() 