from django.db import models
from django.conf import settings


class NotificationType(models.TextChoices):
    ANNOUNCEMENT    = 'ANNOUNCEMENT',    'Announcement'
    EMERGENCY_ALERT = 'EMERGENCY_ALERT', 'Emergency Alert'
    SCHEDULE_CHANGE = 'SCHEDULE_CHANGE', 'Schedule Change'
    TRUCK_NEAR      = 'TRUCK_NEAR',      'Truck Near'
    COLLECTION_DONE = 'COLLECTION_DONE', 'Collection Done'
    DUMPSITE_INBOUND = 'DUMPSITE_INBOUND', 'Dumpsite Inbound'
    WATCHER_STOP_VERIFIED = 'WATCHER_STOP_VERIFIED', 'Watcher Stop Verified'
    WATCHER_ROUTE_SUMMARY = 'WATCHER_ROUTE_SUMMARY', 'Watcher Route Summary'
    REPORT_UPDATE = 'REPORT_UPDATE', 'Report Update'


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

    # Atomic broadcast tracking
    broadcast_id = models.UUIDField(null=True, blank=True, db_index=True)

    # Read state: legacy field, deprecated in Revision 5.15
    is_read    = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
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


class NotificationReadReceipt(models.Model):
    notification = models.ForeignKey(
        'notifications.Notification',
        on_delete=models.CASCADE,
        related_name='receipts',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notification_receipts',
    )
    read_at = models.DateTimeField(null=True, blank=True)
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['notification', 'user'],
                name='unique_notification_user_receipt',
            )
        ]
        indexes = [
            models.Index(
                fields=['user', 'is_archived', 'read_at'],
                name='notif_rcpt_user_state_idx',
            )
        ]

    def __str__(self):
        status = 'Read' if self.read_at else 'Unread'
        archived = ' (Archived)' if self.is_archived else ''
        return f'Receipt: User {self.user_id} → Notif {self.notification_id} [{status}{archived}]'


class EmergencyActivationEvent(models.Model):
    alert = models.ForeignKey(
        'news.EmergencyAlert',
        on_delete=models.CASCADE,
        related_name='activation_events',
    )
    sequence = models.PositiveIntegerField()
    activated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    activated_at = models.DateTimeField(auto_now_add=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['alert', 'sequence'],
                name='unique_emergency_activation_seq',
            )
        ]
        ordering = ['alert', 'sequence']

    def __str__(self):
        status = 'Active' if self.deactivated_at is None else f'Deactivated ({self.deactivated_at})'
        return f'EmergencyActivationEvent(alert_id={self.alert_id}, seq={self.sequence}, status={status})'



class NotificationReceiptCutover(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    cutover_at = models.DateTimeField()
    recorded_at = models.DateTimeField(auto_now_add=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(id=1),
                name='notification_cutover_singleton',
            )
        ]

    def __str__(self):
        return f'NotificationCutover: {self.cutover_at}'


class NotificationDeduplication(models.Model):
    key = models.CharField(max_length=150)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['key'],
                name='unique_notification_deduplication_key',
            ),
        ]

    def __str__(self):
        return f'{self.key} (expires {self.expires_at})'
