from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone
from .models import GarbageReport, ReportStatus, SystemSetting
from driver.models import CollectionSchedule, Truck
from django.contrib.auth import get_user_model

User = get_user_model()

@receiver(post_save, sender=GarbageReport)
def trigger_hotspot_automation(sender, instance, **kwargs):
    """
    When a GarbageReport is approved, check if the threshold is met for that barangay.
    If yes, create a CollectionSchedule if one doesn't exist for today.
    """
    if instance.status == ReportStatus.APPROVED and instance.barangay:
        # Get threshold from settings or default to 10
        try:
            setting = SystemSetting.objects.get(key='hotspot_threshold')
            threshold = int(setting.value)
        except (SystemSetting.DoesNotExist, ValueError):
            threshold = 10
        
        # Count approved reports for this barangay
        approved_count = GarbageReport.objects.filter(
            barangay=instance.barangay,
            status=ReportStatus.APPROVED
        ).count()
        
        if approved_count >= threshold:
            today = timezone.now().date()
            
            # Check if a schedule already exists for this barangay today
            existing_schedule = CollectionSchedule.objects.filter(
                barangays=instance.barangay,
                date=today
            ).exists()
            
            if not existing_schedule:
                # Find an available driver and truck (simplified logic)
                # In a real app, this would be more complex
                driver = User.objects.filter(role='driver').first()
                truck = Truck.objects.filter(status='active').first()
                
                if driver and truck:
                    schedule = CollectionSchedule.objects.create(
                        truck=truck,
                        driver=driver,
                        area=f"Automated Route - {instance.barangay.name}",
                        start_time="08:00:00",
                        end_time="12:00:00",
                        date=today,
                        status='PENDING'
                    )
                    schedule.barangays.add(instance.barangay)
                    print(f"[Automation] Created CollectionSchedule {schedule.id} for {instance.barangay.name}")
