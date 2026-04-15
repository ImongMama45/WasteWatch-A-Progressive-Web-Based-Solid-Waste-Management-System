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
    latitude  = models.DecimalField(max_digits=9,  decimal_places=6)
    longitude = models.DecimalField(max_digits=10, decimal_places=6)

    # Photo evidence
    image = models.ImageField(
        upload_to='reports/%Y/%m/',  # Organized by year/month: media/reports/2026/03/
        null=True,
        blank=True,
    )

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

    # Lifecycle status — starts as pending, admin/official changes it
    status = models.CharField(
        max_length=20,
        choices=ReportStatus.choices,
        default=ReportStatus.PENDING,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)  # Tracks when status changes

    class Meta:
        ordering = ['-created_at']  # Newest first

    def __str__(self):
        return f'[{self.status.upper()}] {self.issue_type} @ {self.barangay} by {self.user.full_name}'


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
