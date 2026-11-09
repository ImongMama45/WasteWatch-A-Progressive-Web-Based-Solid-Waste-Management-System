import os
import django
from django.utils import timezone
from datetime import timedelta
from accounts.models import Barangay
from driver.models import Truck, CollectionSchedule, DriverShift
from watcher.models import StopValidation, StopValidationStatus as SVS, MissedStop
from analytics.services import _compute_tracker_payload
from django.contrib.auth import get_user_model

User = get_user_model()

def _base_sched(b, truck, today, now, wps):
    return CollectionSchedule.objects.create(
        truck=truck,
        status='PENDING',
        start_time=(now - timedelta(hours=1)).time(),
        end_time=(now + timedelta(hours=2)).time(),
        waypoints=wps,
        days=today.strftime('%A')
    )

def _before_shift(b, truck, today, now, wps):
    CollectionSchedule.objects.filter(truck=truck).delete()
    s = _base_sched(b, truck, today, now, wps)
    s.barangays.add(b)
    return s

def _navigate_base(b, truck, driver, today, now, wps):
    s = _before_shift(b, truck, today, now, wps)
    DriverShift.objects.create(
        driver=driver, schedule=s, is_active=True,
        status='navigate_to_base',
        started_at=now - timedelta(minutes=10),
        last_location_update=now,
        current_latitude=14.0, current_longitude=121.0
    )
    return s

def _mid_route(b, truck, driver, today, now, wps):
    s = _before_shift(b, truck, today, now, wps)
    DriverShift.objects.create(
        driver=driver, schedule=s, is_active=True,
        status='collecting',
        started_at=now - timedelta(minutes=30),
        last_location_update=now,
        current_latitude=14.05, current_longitude=121.05
    )
    return s

def _one_collected(b, truck, driver, today, now, wps):
    s = _mid_route(b, truck, driver, today, now, wps)
    StopValidation.objects.create(schedule=s, stop_order=1, collection_date=today, current_status=SVS.COLLECTION_REPORTED)
    return s

def _empty_stop(b, truck, driver, today, now, wps):
    s = _mid_route(b, truck, driver, today, now, wps)
    StopValidation.objects.create(schedule=s, stop_order=1, collection_date=today, current_status=SVS.EMPTY_STOP)
    return s

def _watcher_flagged(b, truck, driver, today, now, wps):
    s = _mid_route(b, truck, driver, today, now, wps)
    StopValidation.objects.create(schedule=s, stop_order=1, collection_date=today, current_status=SVS.COLLECTION_DISPUTED)
    MissedStop.objects.create(original_schedule=s, stop_order=1, collection_date=today, status='PENDING', reason='WATCHER_FLAG')
    return s

def _extended_mode(b, truck, driver, today, now, wps):
    s = _watcher_flagged(b, truck, driver, today, now, wps)
    shift = DriverShift.objects.first()
    shift.is_extended_mode = True
    shift.status = 'collecting'
    shift.save()
    StopValidation.objects.create(schedule=s, stop_order=2, collection_date=today, current_status=SVS.COLLECTION_REPORTED)
    StopValidation.objects.create(schedule=s, stop_order=3, collection_date=today, current_status=SVS.COLLECTION_REPORTED)
    return s

def _no_gps(b, truck, driver, today, now, wps):
    s = _before_shift(b, truck, today, now, wps)
    DriverShift.objects.create(
        driver=driver, schedule=s, is_active=True,
        status='collecting',
        started_at=now - timedelta(minutes=30),
        last_location_update=None,
        current_latitude=None, current_longitude=None
    )
    return s

def _all_done(b, truck, driver, today, now, wps):
    s = _before_shift(b, truck, today, now, wps)
    DriverShift.objects.create(
        driver=driver, schedule=s, is_active=False,
        status='ended', end_shift_phase='calibration_complete',
        started_at=now - timedelta(hours=2),
        last_location_update=now - timedelta(minutes=10)
    )
    for i in range(1, 4):
        StopValidation.objects.create(schedule=s, stop_order=i, collection_date=today, current_status=SVS.COLLECTION_REPORTED)
    return s

def _stops_pending(b, truck, driver, today, now, wps):
    s = _before_shift(b, truck, today, now, wps)
    DriverShift.objects.create(
        driver=driver, schedule=s, is_active=False,
        status='ended', end_shift_phase='at_base',
        started_at=now - timedelta(hours=2),
        last_location_update=now - timedelta(minutes=10)
    )
    StopValidation.objects.create(schedule=s, stop_order=1, collection_date=today, current_status=SVS.COLLECTION_REPORTED)
    return s

def run():
    now = timezone.localtime()
    today = timezone.localdate()
    
    b, _ = Barangay.objects.get_or_create(name='Simulation Barangay')
    truck, _ = Truck.objects.get_or_create(plate_number='SIM-999', defaults={'model': 'Sim'})
    driver, _ = User.objects.get_or_create(username='simdriver', defaults={'role': 'driver'})
    
    wps = [
        {"lat": 14.0, "lng": 121.0, "label": "Base"},
        {"lat": 14.1, "lng": 121.1, "label": "Stop 1", "barangay_id": b.id},
        {"lat": 14.2, "lng": 121.2, "label": "Stop 2", "barangay_id": b.id},
        {"lat": 14.3, "lng": 121.3, "label": "Stop 3", "barangay_id": b.id},
    ]

    scenarios = [
        ("1. before the shift", _before_shift),
        ("2. navigate_to_base", _navigate_base),
        ("3. mid-route", _mid_route),
        ("4. one stop collected", _one_collected),
        ("5. an EMPTY_STOP", _empty_stop),
        ("6. a watcher-flagged stop", _watcher_flagged),
        ("7. extended mode", _extended_mode),
        ("8. a shift with no GPS fix yet", _no_gps),
        ("9. shift ended with all done", _all_done),
        ("10. shift ended with stops pending", _stops_pending),
    ]

    for name, setup_fn in scenarios:
        # Pass the args to the fn
        if setup_fn == _before_shift:
            s = setup_fn(b, truck, today, now, wps)
        else:
            s = setup_fn(b, truck, driver, today, now, wps)
            
        p = _compute_tracker_payload(b.id, today, now)
        print(f"\n--- {name} ---")
        for t in p['trucks']:
            if t['schedule_id'] == s.id:
                print(f"state: {t['state']}, away: {t['stops_away']}, eta: {t['eta_min']}-{t['eta_max']}, "
                      f"done: {t['stops_done']}/{t['stops_total']}, stale: {t['is_stale']}, "
                      f"behind: {t.get('behind')}, partial: {t.get('partial')}")

if __name__ == '__main__':
    run()
