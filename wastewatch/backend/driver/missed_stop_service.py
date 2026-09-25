from django.utils import timezone
from django.db import transaction
from django.db.models import F
from driver.models import MissedStop, MissedStopReason, MissedStopStatus, DriverPerformance

def create_missed_stops(schedule, stop_orders, reason, date=None, early_end_reason=None):
    """
    Bulk creates MissedStop records idempotently.
    Applies Escalation logic and DriverPerformance debit for penalized reasons.
    """
    if not schedule or not schedule.waypoints or not stop_orders:
        return []

    if date is None:
        date = timezone.localdate()
        
    created_stops = []
    
    # We only penalize driver and escalate for WATCHER_FLAG and DRIVER_SKIP
    is_penalized = reason in [MissedStopReason.WATCHER_FLAG, MissedStopReason.DRIVER_SKIP]
    
    with transaction.atomic():
        # Get or create DriverPerformance for the original driver if penalized
        if is_penalized and schedule.driver:
            DriverPerformance.objects.get_or_create(driver=schedule.driver)
            
        for stop_order in stop_orders:
            # Safely fetch waypoint data from schedule.waypoints list
            # Note: waypoints is typically 0-indexed in JSON but stop_order is 1-indexed
            try:
                waypoint_data = schedule.waypoints[stop_order]
            except IndexError:
                # Fallback if there's a mismatch
                waypoint_data = {'stop_order': stop_order}
                
            # Idempotency check: Don't duplicate if already exists
            missed_stop, created = MissedStop.objects.get_or_create(
                original_schedule=schedule,
                stop_order=stop_order,
                collection_date=date,
                defaults={
                    'waypoint_data': waypoint_data,
                    'reason': reason,
                    'early_end_reason': early_end_reason,
                    'status': MissedStopStatus.PENDING,
                }
            )
            
            if created:
                created_stops.append(missed_stop)
                
                # Apply DriverPerformance penalty (-25 pts) and increment missed_stops_caused
                if is_penalized and schedule.driver:
                    DriverPerformance.objects.filter(driver=schedule.driver).update(
                        total_points=F('total_points') - 25,
                        missed_stops_caused=F('missed_stops_caused') + 1
                    )
                
                # Auto-create Escalation for penalized reasons.
                # Requires a barangay — skip silently if waypoint lacks one.
                if is_penalized:
                    from watcher.models import Escalation
                    barangay_id = waypoint_data.get('barangay_id')

                    if barangay_id:
                        escalation = Escalation.objects.create(
                            title=f"Missed Collection — Stop {stop_order}",
                            issue_type='missed_collection',
                            priority='high' if reason == MissedStopReason.WATCHER_FLAG else 'medium',
                            raised_by='System (Auto)',
                            barangay_id=barangay_id,
                            status='pending'
                        )
                        # Link escalation to the missed stop
                        missed_stop.escalation = escalation
                        missed_stop.save(update_fields=['escalation'])
                    
    return created_stops

def resolve_missed_stop(missed_stop_id, collecting_shift):
    """
    Marks a PENDING missed stop as RESOLVED.
    Closes the Escalation and credits the collecting driver (+50 pts).
    Locks the row with select_for_update to prevent double claims.
    """
    with transaction.atomic():
        try:
            missed_stop = MissedStop.objects.select_for_update().get(id=missed_stop_id, status=MissedStopStatus.PENDING)
        except MissedStop.DoesNotExist:
            return None # Already claimed or doesn't exist
            
        missed_stop.status = MissedStopStatus.RESOLVED
        missed_stop.resolved_by_shift = collecting_shift
        missed_stop.resolved_at = timezone.now()
        missed_stop.save(update_fields=['status', 'resolved_by_shift', 'resolved_at'])
        
        # Resolve Escalation if exists
        if missed_stop.escalation_id:
            from watcher.models import Escalation
            Escalation.objects.filter(id=missed_stop.escalation_id).update(status='resolved')
            
        # Credit the collecting driver (+50 points)
        if collecting_shift and collecting_shift.driver:
            DriverPerformance.objects.get_or_create(driver=collecting_shift.driver)
            DriverPerformance.objects.filter(driver=collecting_shift.driver).update(
                total_points=F('total_points') + 50,
                missed_stops_recovered=F('missed_stops_recovered') + 1
            )
            
        # Synchronize with the watcher's StopValidation so the map shows it as collected
        try:
            from watcher.models import StopValidation, StopValidationStatus
            StopValidation.objects.filter(
                schedule=missed_stop.original_schedule,
                stop_order=missed_stop.stop_order,
                collection_date=missed_stop.collection_date
            ).update(
                current_status=StopValidationStatus.COLLECTION_REPORTED,
                collection_timestamp=timezone.now(),
                driver=collecting_shift.driver if collecting_shift else None,
                collection_notes="[RESOLVED MISSED STOP] " + (missed_stop.reason or "")
            )
        except Exception:
            pass
            
        return missed_stop
