import threading
import time
from django.db import transaction

def delayed_reassign(schedule_id, missed_orders):
    from driver.models import PickupStatus, DriverShift, CollectionSchedule
    
    # 5 minute grace period (5 seconds for dev)
    time.sleep(5)
    
    with transaction.atomic():
        # Check if they are STILL missed
        still_missed = PickupStatus.objects.select_for_update().filter(
            schedule_id=schedule_id,
            stop_order__in=missed_orders,
            status='DRIVER_MISSED'
        )
        
        missed_orders_final = [p.stop_order for p in still_missed]
        if not missed_orders_final:
            return
            
        orig_sched = CollectionSchedule.objects.get(id=schedule_id)

        new_waypoints = []
        for wp in orig_sched.waypoints:
            if wp.get('stopOrder') in missed_orders_final or wp.get('id') in missed_orders_final:
                new_waypoints.append(wp)

        if not new_waypoints:
            return

        # Calculate centroid of missed stops
        lats = [float(wp['lat']) for wp in new_waypoints if 'lat' in wp]
        lngs = [float(wp['lng']) for wp in new_waypoints if 'lng' in wp]
        if not lats or not lngs:
            return
            
        centroid_lat = sum(lats) / len(lats)
        centroid_lng = sum(lngs) / len(lngs)

        from driver.views import haversine
        
        # Find nearest extended driver within 3km
        candidates = DriverShift.objects.filter(
            is_active=True, 
            is_extended_mode=True
        ).exclude(current_latitude__isnull=True).exclude(current_longitude__isnull=True)

        nearest_shift = None
        min_dist = float('inf')
        
        for shift in candidates:
            dist = haversine(
                centroid_lat, centroid_lng,
                float(shift.current_latitude), float(shift.current_longitude)
            )
            if dist <= 3000 and dist < min_dist:
                min_dist = dist
                nearest_shift = shift

        if not nearest_shift:
            return # Stays DRIVER_MISSED

        target_sched = CollectionSchedule.objects.filter(
            driver=nearest_shift.driver,
        ).first()
        
        if not target_sched:
            return
            
        if new_waypoints:
            target_sched.waypoints.extend(new_waypoints)
            target_sched.save(update_fields=['waypoints'])
            
            # Update the pickup statuses to point to the new schedule
            still_missed.update(schedule=target_sched, status='EN_ROUTE')

def trigger_reassignment(schedule_id, missed_orders):
    t = threading.Thread(target=delayed_reassign, args=(schedule_id, missed_orders))
    t.daemon = True
    t.start()
