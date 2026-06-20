from django.db import models
from django.conf import settings


class NotificationType(models.TextChoices):
    ANNOUNCEMENT    = 'ANNOUNCEMENT',    'Announcement'
    SCHEDULE_CHANGE = 'SCHEDULE_CHANGE', 'Schedule Change'
    TRUCK_NEAR      = 'TRUCK_NEAR',      'Truck Near'
    COLLECTION_DONE = 'COLLECTION_DONE', 'Collection Done'
    DUMPSITE_INBOUND = 'DUMPSITE_INBOUND', 'Dumpsite Inbound'
    WATCHER_STOP_VERIFIED = 'WATCHER_STOP_VERIFIED', 'Watcher Stop Verified'
    WATCHER_ROUTE_SUMMARY = 'WATCHER_ROUTE_SUMMARY', 'Watcher Route Summary'


class Notification(models.Model):
    # Targeting — both nullable so a single row can be:
    #   personal    → user set,     barangay null
    #   barangay    → user null,    barangay set
    #   system-wide → user null,    barangay null
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='notifications',
    )
    barangay = models.ForeignKey(
        'accounts.Barangay',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='notifications',
    )

    title   = models.CharField(max_length=200)
    message = models.TextField()
    type    = models.CharField(
        max_length=50,
        choices=NotificationType.choices,
        default=NotificationType.ANNOUNCEMENT,
    )

    # Read state: per-user; for barangay-wide notifications
    # this stays False until explicitly marked by each recipient.
    is_read    = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            # Hot path: fetch all notifications for one user fast
            models.Index(fields=['user', '-created_at'], name='notif_user_created_idx'),
            # Hot path: fetch unread count for badge
            models.Index(fields=['user', 'is_read'],     name='notif_user_read_idx'),
            # Hot path: barangay-wide broadcast lookup
            models.Index(fields=['barangay', '-created_at'], name='notif_brgy_created_idx'),
        ]

    def __str__(self):
        target = self.user.full_name if self.user else (
            self.barangay.name if self.barangay else 'System-wide'
        )
        return f'[{self.type}] {self.title} → {target}'