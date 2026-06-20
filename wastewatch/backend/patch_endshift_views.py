import re

file_path = r"d:\Coding\Waste Watch\wastewatch\backend\driver\views.py"
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

old_end_shift = """    @action(detail=False, methods=['post'], url_path='end')
    def end_shift(self, request):
        driver = request.user
        with transaction.atomic():
            shift = DriverShift.objects.select_for_update().filter(driver=driver, is_active=True).first()
            if not shift:
                return Response({'error': 'No active shift found.'}, status=status.HTTP_400_BAD_REQUEST)
            
            now = timezone.now()
            shift.ended_at    = now
            shift.duration_ms = int((now - shift.started_at).total_seconds() * 1000)
            shift.is_active   = False
            shift.current_latitude    = None
            shift.current_longitude   = None
            shift.last_location_update = None
            shift.save()"""

new_end_shift = """    @action(detail=False, methods=['post'], url_path='end')
    def end_shift(self, request):
        driver = request.user
        missed_stop_orders = request.data.get('missed_stop_orders', [])
        schedule_id = request.data.get('schedule_id')

        with transaction.atomic():
            shift = DriverShift.objects.select_for_update().filter(driver=driver, is_active=True).first()
            if not shift:
                return Response({'error': 'No active shift found.'}, status=status.HTTP_400_BAD_REQUEST)
            
            now = timezone.now()
            shift.ended_at    = now
            shift.duration_ms = int((now - shift.started_at).total_seconds() * 1000)
            shift.is_active   = False
            shift.current_latitude    = None
            shift.current_longitude   = None
            shift.last_location_update = None
            shift.save()
            
            if schedule_id and missed_stop_orders:
                from driver.models import PickupStatus
                PickupStatus.objects.filter(
                    schedule_id=schedule_id,
                    stop_order__in=missed_stop_orders
                ).update(status='DRIVER_MISSED')
                
                from driver.reassignment import trigger_reassignment
                trigger_reassignment(schedule_id, missed_stop_orders)"""

content = content.replace(old_end_shift, new_end_shift)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("end_shift patched successfully.")
