from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver
from django.utils import timezone
from django.db import transaction
from django.db.models import F
from datetime import timedelta

from .models import GarbageReport, ReportStatus, SystemSetting, Escalation
from driver.models import CollectionSchedule, Truck
from accounts.models import DriverProfile, PointTransaction
from notifications.models import Notification, NotificationType
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


@receiver(pre_save, sender=Escalation)
def stash_escalation_state(sender, instance, **kwargs):
    """
    Stashes the old status to be safely used in post_save.
    Also calculates and sets points_deducted on the instance before it saves to the DB.
    """
    if instance._state.adding:
        instance._old_status = None
        instance._old_points_deducted = 0
        return
        
    try:
        old_instance = Escalation.objects.get(pk=instance.pk)
        instance._old_status = old_instance.status
        instance._old_points_deducted = old_instance.points_deducted
    except Escalation.DoesNotExist:
        # Catch race conditions with deletion
        instance._old_status = None
        instance._old_points_deducted = 0
        
    # Pre-calculate points to be deducted so it persists on the row
    if instance._old_status == 'pending' and instance.status == 'approved' and instance._old_points_deducted == 0:
        penalty = 0
        if instance.priority == 'low':
            penalty = 50
        elif instance.priority == 'medium':
            penalty = 100
        elif instance.priority == 'high':
            penalty = 200
        instance.points_deducted = penalty


@receiver(post_save, sender=Escalation)
def escalation_consequences(sender, instance, created, **kwargs):
    """
    Applies point deductions and driver suspensions when an Escalation transitions to 'approved'.
    Auto-lifts suspension if it transitions to 'resolved' or 'rejected' and no other active tickets exist.
    """
    if not instance.driver:
        return
        
    # 1. Informational early warning on creation
    if created:
        Notification.objects.create(
            user=instance.driver,
            title="New Escalation Filed",
            message=f"An escalation ({instance.get_priority_display()} severity) has been filed regarding your shift in Brgy. {instance.barangay.name if instance.barangay else 'Unknown'}.",
            type=NotificationType.REPORT_UPDATE
        )
        return
        
    old_status = getattr(instance, '_old_status', None)
    
    if old_status == 'pending' and instance.status == 'approved':
        with transaction.atomic():
            # Lock the driver profile to serialize concurrent approvals for this driver
            profile, _ = DriverProfile.objects.select_for_update().get_or_create(user=instance.driver)
            
            # Idempotency guard: prevent double-deduction on concurrent double-approve requests
            if PointTransaction.objects.filter(escalation=instance).exists():
                return
            
            penalty = instance.points_deducted
            if penalty > 0:
                DriverProfile.objects.filter(pk=profile.pk).update(points=F('points') - penalty)
                PointTransaction.objects.create(
                    driver=instance.driver,
                    escalation=instance,
                    points=-penalty,
                    description=f"Penalty for Escalation ID: {instance.id}"
                )
                
            ninety_days_ago = timezone.now() - timedelta(days=90)
            unresolved_count = Escalation.objects.filter(
                driver=instance.driver,
                status__in=['pending', 'approved'],
                created_at__gte=ninety_days_ago
            ).count()
            
            if unresolved_count >= 3 or instance.priority == 'high':
                DriverProfile.objects.filter(pk=profile.pk).update(is_suspended=True)
                
    elif old_status in ['pending', 'approved'] and instance.status in ['resolved', 'rejected']:
        with transaction.atomic():
            profile, _ = DriverProfile.objects.select_for_update().get_or_create(user=instance.driver)
            remaining_unresolved = Escalation.objects.filter(
                driver=instance.driver,
                status__in=['pending', 'approved']
            ).count()
            
            if remaining_unresolved == 0:
                DriverProfile.objects.filter(pk=profile.pk).update(is_suspended=False)
