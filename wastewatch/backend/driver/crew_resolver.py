from django.utils import timezone
from driver.models import Truck, CollectionSchedule

def normalize_days(val):
    if not val:
        return set()
    if isinstance(val, list):
        items = val
    else:
        items = val.split(',')
    return set(d.strip()[:3].lower() for d in items if d.strip())

def get_crew_assignment_for(user, today=None):
    if today is None:
        today = timezone.localdate()
        
    truck = Truck.objects.filter(crew=user, status='active').first()
    if not truck:
        return None
        
    weekday_str = today.strftime('%A')[:3].lower()
    
    # Find schedule for today
    schedules = CollectionSchedule.objects.filter(truck=truck).exclude(status='CANCELLED')
    
    today_schedules = []
    for s in schedules:
        if s.date == today:
            today_schedules.append(s)
        elif s.date is None:
            if weekday_str in normalize_days(s.days):
                today_schedules.append(s)
                
    chosen_sched = None
    if today_schedules:
        now_time = timezone.localtime().time()
        
        # Prefer currently active schedule
        for s in today_schedules:
            if s.start_time <= now_time <= s.end_time:
                chosen_sched = s
                break
                
        if not chosen_sched:
            # Prefer upcoming
            upcoming = [s for s in today_schedules if s.start_time > now_time]
            if upcoming:
                chosen_sched = min(upcoming, key=lambda s: s.start_time)
            else:
                chosen_sched = min(today_schedules, key=lambda s: s.start_time)
                
    driver = chosen_sched.driver if chosen_sched and chosen_sched.driver else truck.drivers.first()
    
    return {
        'id': 0, # Legacy mock ID
        'truck': truck.id,
        'truck_plate': truck.plate_number,
        'truck_model': truck.model,
        'driver': driver.id if driver else None,
        'driver_name': driver.full_name if driver else None,
        'crew_members': [c.id for c in truck.crew.all()],
        'crew_names': [{'id': c.id, 'full_name': c.full_name, 'email': c.email} for c in truck.crew.all()],
        'schedule': chosen_sched.id if chosen_sched else None,
        'schedule_area': chosen_sched.area if chosen_sched else None,
        'schedule_days': chosen_sched.days if chosen_sched else None,
        'schedule_start': chosen_sched.start_time.strftime('%H:%M:%S') if chosen_sched and chosen_sched.start_time else None,
        'schedule_end': chosen_sched.end_time.strftime('%H:%M:%S') if chosen_sched and chosen_sched.end_time else None,
        'barangay_name': ', '.join([b.name for b in chosen_sched.barangays.all()]) if chosen_sched else None,
        'date': str(today),
        'is_active': True,
        'notes': '',
        'created_at': None
    }
