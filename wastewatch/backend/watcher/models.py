"""
watcher/models.py
-----------------
Models for the Watcher module — the first feature of WasteWatch.

A Watcher can:
  1. Submit garbage reports (GarbageReport)
  2. Confirm that a truck has collected a dump site (CollectionConfirmation)

Future models that will integrate here without breaking anything:
  - Truck          → can FK to CollectionConfirmation
  - Route          → can FK to GarbageReport for driver assignment
  - VerificationLog → audit trail for status changes
"""

from django.db import models
from django.conf import settings  # Use settings.AUTH_USER_MODEL, not User directly
from cloudinary.models import CloudinaryField

# ---------------------------------------------------------------------------
# Choice classes — defined as classes so they're importable and reusable
# ---------------------------------------------------------------------------

class IssueType(models.TextChoices):
    OVERFLOW       = 'overflow',       'Overflow'
    MISSED         = 'missed',         'Missed Collection'
    ILLEGAL_DUMP   = 'illegal_dumping','Illegal Dumping'
    # Add more types here as needed — no migration needed for the choice list


class Severity(models.TextChoices):
    LOW    = 'low',    'Low'
    MEDIUM = 'medium', 'Medium'
    HIGH   = 'high',   'High'


class ReportStatus(models.TextChoices):
    PENDING   = 'pending',   'Pending'
    APPROVED  = 'approved',  'Approved'
    REJECTED  = 'rejected',  'Rejected'
    RESOLVED  = 'resolved',  'Resolved'
    # Future statuses: 'in_progress', 'assigned', 'verified'


# ---------------------------------------------------------------------------
# GarbageReport
# ---------------------------------------------------------------------------
class GarbageReport(models.Model):
    """
    A report submitted by a Watcher (or any citizen) about a garbage issue.

    Relationships:
      user      → the person who submitted it
      barangay  → where the issue is located

    Future integrations (no model changes needed, just new FKs from other models):
      - Driver app: assign a driver via a new 'AssignedRoute' model
      - Verification: add a 'VerificationLog' FK pointing here
    """

    # Who reported it
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,   # Always reference User this way — avoids circular imports
        on_delete=models.CASCADE,   # Delete reports if user is deleted
        related_name='reports',
        null=True,
        blank=True,
    )

    # Where it is
    barangay = models.ForeignKey(
        'accounts.Barangay',        # String reference to avoid importing across apps
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reports',
    )

    # GPS coordinates — store as decimals for accuracy
    latitude  = models.DecimalField(max_digits=9,  decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True)

    # Address / Landmark
    address = models.CharField(max_length=255, blank=True)

    # Photo evidence
    image = models.ImageField(
        upload_to='reports/',
        null=True,
        blank=True,
    )
    image_2 = models.ImageField(upload_to='reports/', null=True, blank=True)
    image_3 = models.ImageField(upload_to='reports/', null=True, blank=True)
    image_4 = models.ImageField(upload_to='reports/', null=True, blank=True)

    # Classification
    issue_type = models.CharField(
        max_length=20,
        choices=IssueType.choices,
        default=IssueType.OVERFLOW,
    )

    severity = models.CharField(
        max_length=10,
        choices=Severity.choices,
        default=Severity.MEDIUM,
    )

    description = models.TextField(blank=True)
    tags = models.CharField(max_length=255, blank=True, help_text='Comma-separated tags')

    # For misconduct reports
    reported_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='received_misconduct_reports',
        help_text='The person (driver/watcher) being reported for misconduct'
    )

    # Lifecycle status — starts as pending, admin/official changes it
    status = models.CharField(
        max_length=20,
        choices=ReportStatus.choices,
        default=ReportStatus.PENDING,
    )

    # Audit fields
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_reports',
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='rejected_reports',
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)  # Tracks when status changes

    class Meta:
        ordering = ['-created_at']  # Newest first

    def __str__(self):
        user_name = self.user.full_name if self.user else "Anonymous"
        return f'[{self.status.upper()}] {self.issue_type} @ {self.barangay} by {user_name}'


# ---------------------------------------------------------------------------
# CollectionConfirmation
# ---------------------------------------------------------------------------
class CollectionConfirmation(models.Model):
    """
    A Watcher confirms that a garbage truck has collected waste from a dump site.

    This is separate from GarbageReport because it represents a POSITIVE event
    (collection happened) rather than a PROBLEM report.

    Future: add a Truck FK here once the Driver module is built.
    """

    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='confirmations',
    )

    barangay = models.ForeignKey(
        'accounts.Barangay',
        on_delete=models.SET_NULL,
        null=True,
        related_name='confirmations',
    )

    # Optional: link to the specific report that was resolved
    report = models.ForeignKey(
        GarbageReport,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='confirmations',
        help_text='The report this collection resolves (optional)',
    )

    latitude  = models.DecimalField(max_digits=9,  decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True)

    notes = models.TextField(blank=True, help_text='Any extra notes from the watcher')

    confirmed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-confirmed_at']

    def __str__(self):
        return f'Confirmed by {self.confirmed_by.full_name} @ {self.barangay} on {self.confirmed_at:%Y-%m-%d}'

class HotspotSeverity(models.TextChoices):
    LOW    = 'low',    'Low'
    MEDIUM = 'medium', 'Medium'
    HIGH   = 'high',   'High'

class GarbageHotspot(models.Model):
    name = models.CharField(max_length=100)
    severity = models.CharField(max_length=10, choices=HotspotSeverity.choices, default=HotspotSeverity.MEDIUM)
    barangay = models.ForeignKey('accounts.Barangay', on_delete=models.CASCADE, related_name='hotspots')
    latitude  = models.DecimalField(max_digits=9,  decimal_places=6)
    longitude = models.DecimalField(max_digits=10, decimal_places=6)
    assigned_truck = models.ForeignKey(
        'driver.Truck', on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_hotspots'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.name} ({self.severity})'

class StopValidationStatus(models.TextChoices):
    PENDING_INSPECTION = 'PENDING_INSPECTION', 'Pending Inspection'
    READY_FOR_COLLECTION = 'READY_FOR_COLLECTION', 'Ready for Collection'
    EMPTY_STOP = 'EMPTY_STOP', 'Empty Stop'
    COLLECTION_REPORTED = 'COLLECTION_REPORTED', 'Collection Reported'
    VERIFIED_COLLECTED = 'VERIFIED_COLLECTED', 'Verified Collected'
    # NOTE: The DB constant is intentionally named COLLECTION_DISPUTED to avoid
    # a data migration. Only the human-readable label is changed to 'Missed'.
    # Do NOT rename the constant without a matching RunPython data migration.
    COLLECTION_DISPUTED = 'COLLECTION_DISPUTED', 'Missed'


class StopValidation(models.Model):
    """
    Centralized two-stage stop validation workflow.
    One row per schedule stop per collection day.
    """
    schedule = models.ForeignKey(
        'driver.CollectionSchedule',
        on_delete=models.CASCADE,
        related_name='stop_validations',
    )
    stop_order = models.PositiveIntegerField(help_text='Waypoint index (1 = first collection stop)')
    collection_date = models.DateField(help_text='The scheduled collection day for this validation cycle')
    barangay = models.ForeignKey(
        'accounts.Barangay',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='stop_validations'
    )
    stop_id = models.CharField(max_length=100, blank=True, null=True, help_text='Stable stop ID from route builder')

    current_status = models.CharField(
        max_length=30,
        choices=StopValidationStatus.choices,
        default=StopValidationStatus.PENDING_INSPECTION,
    )

    # Pre-collection inspection
    pre_validation_watcher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='pre_validations',
    )
    pre_validation_timestamp = models.DateTimeField(null=True, blank=True)
    pre_validation_photo = CloudinaryField('image', null=True, blank=True)
    pre_validation_photo_2 = CloudinaryField('image', null=True, blank=True)
    pre_validation_photo_3 = CloudinaryField('image', null=True, blank=True)
    pre_validation_photo_4 = CloudinaryField('image', null=True, blank=True)
    pre_validation_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    pre_validation_longitude = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True)
    pre_validation_remarks = models.TextField(blank=True)

    # Driver collection
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='driver_stop_collections',
    )
    collection_timestamp = models.DateTimeField(null=True, blank=True)
    collection_photo = CloudinaryField('image', null=True, blank=True)
    collection_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    collection_longitude = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True)
    collection_notes = models.TextField(blank=True)

    # Post-collection verification
    post_validation_watcher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='post_validations',
    )
    post_validation_timestamp = models.DateTimeField(null=True, blank=True)
    post_validation_photo = CloudinaryField('image', null=True, blank=True)
    post_validation_photo_2 = CloudinaryField('image', null=True, blank=True)
    post_validation_photo_3 = CloudinaryField('image', null=True, blank=True)
    post_validation_photo_4 = CloudinaryField('image', null=True, blank=True)
    post_validation_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    post_validation_longitude = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True)
    dispute_reason = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['collection_date', 'schedule_id', 'stop_order']
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'stop_order', 'collection_date'],
                name='unique_stop_validation_per_day',
            )
        ]

    def __str__(self):
        return f'Stop {self.stop_order} on schedule {self.schedule_id} ({self.collection_date}) — {self.current_status}'


class Escalation(models.Model):
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('resolved', 'Resolved'),
    ]
    
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='medium')
    title = models.CharField(max_length=255)
    issue_type = models.CharField(max_length=100)
    reports_count = models.IntegerField(default=1)
    raised_by = models.CharField(max_length=255) # Name of the person/role
    barangay = models.ForeignKey('accounts.Barangay', on_delete=models.CASCADE, related_name='escalations')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_escalations')
    deadline = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-priority', '-created_at']

    def __str__(self):
        return f'{self.title} - {self.status}'


class SystemSetting(models.Model):
    key = models.CharField(max_length=50, unique=True)
    value = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.key
