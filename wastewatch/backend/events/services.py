import logging
from django.utils import timezone
from notifications.models import Notification, NotificationType

logger = logging.getLogger(__name__)


class EventNotificationError(Exception):
    """Raised when municipal event notification creation fails."""
    pass


def _format_event_datetime(dt):
    if not dt:
        return ""
    local_dt = timezone.localtime(dt)
    return local_dt.strftime("%b %d, %Y %I:%M %p")


def notify_event_published(event):
    """
    Dispatches notifications when an event is transitioned to PUBLISHED.
    - Citywide: 1 system-wide notification row (barangay=None).
    - Barangay-specific: 1 notification row per assigned barangay.
    Must be executed inside an atomic transaction. Raises EventNotificationError on failure.
    """
    try:
        title = f"Municipal Event: {event.title}"
        dt_str = _format_event_datetime(event.start_datetime)
        body = f"Scheduled: {dt_str}\nLocation: {event.location}\n\n{event.description}"[:250]
        
        target_barangays = list(event.barangays.all())
        if not target_barangays:
            # Citywide notification
            Notification.objects.create(
                user=None,
                barangay=None,
                title=title,
                message=body,
                type=NotificationType.ANNOUNCEMENT,
            )
        else:
            # Multi-barangay atomic batch notification
            rows = [
                Notification(
                    user=None,
                    barangay=b,
                    title=title,
                    message=body,
                    type=NotificationType.ANNOUNCEMENT,
                )
                for b in target_barangays
            ]
            Notification.objects.bulk_create(rows)
    except Exception as exc:
        logger.exception("notify_event_published failed for event pk=%s", event.pk)
        raise EventNotificationError(f"Failed to dispatch notifications for event {event.pk}") from exc


def notify_event_cancelled(event):
    """
    Dispatches notifications when an event is transitioned to CANCELLED.
    - Citywide: 1 system-wide notification row (barangay=None).
    - Barangay-specific: 1 notification row per assigned barangay.
    Must be executed inside an atomic transaction. Raises EventNotificationError on failure.
    """
    try:
        title = f"EVENT CANCELLED: {event.title}"
        dt_str = _format_event_datetime(event.start_datetime)
        body = f"The municipal event '{event.title}' scheduled for {dt_str} at {event.location} has been cancelled."[:250]
        
        target_barangays = list(event.barangays.all())
        if not target_barangays:
            # Citywide notification
            Notification.objects.create(
                user=None,
                barangay=None,
                title=title,
                message=body,
                type=NotificationType.ANNOUNCEMENT,
            )
        else:
            # Multi-barangay atomic batch notification
            rows = [
                Notification(
                    user=None,
                    barangay=b,
                    title=title,
                    message=body,
                    type=NotificationType.ANNOUNCEMENT,
                )
                for b in target_barangays
            ]
            Notification.objects.bulk_create(rows)
    except Exception as exc:
        logger.exception("notify_event_cancelled failed for event pk=%s", event.pk)
        raise EventNotificationError(f"Failed to dispatch cancellation notification for event {event.pk}") from exc
