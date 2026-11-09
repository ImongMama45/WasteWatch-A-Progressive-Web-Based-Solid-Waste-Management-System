from django.db import models
from django.conf import settings
from django.core.exceptions import ValidationError
from cloudinary.models import CloudinaryField


class EventStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    PUBLISHED = 'published', 'Published'
    CANCELLED = 'cancelled', 'Cancelled'
    COMPLETED = 'completed', 'Completed'
    ARCHIVED = 'archived', 'Archived'


class EventCategory(models.TextChoices):
    CLEANUP = 'cleanup', 'Cleanup Drive'
    COMMUNITY_MEETING = 'community_meeting', 'Community Meeting'
    HAZARDOUS_WASTE = 'hazardous_waste', 'Special Waste Collection'
    TREE_PLANTING = 'tree_planting', 'Tree Planting'
    WORKSHOP = 'workshop', 'Public Orientation & Seminar'
    GENERAL = 'general', 'General Municipal Event'


# Permitted state transitions dictionary
VALID_EVENT_TRANSITIONS = {
    EventStatus.DRAFT: {EventStatus.PUBLISHED, EventStatus.ARCHIVED},
    EventStatus.PUBLISHED: {EventStatus.CANCELLED, EventStatus.COMPLETED, EventStatus.ARCHIVED, EventStatus.DRAFT},
    EventStatus.CANCELLED: {EventStatus.ARCHIVED, EventStatus.DRAFT},
    EventStatus.COMPLETED: {EventStatus.ARCHIVED},
    EventStatus.ARCHIVED: {EventStatus.DRAFT},
}


class MunicipalEvent(models.Model):
    title = models.CharField(max_length=255)
    description = models.TextField()
    start_datetime = models.DateTimeField(db_index=True)
    end_datetime = models.DateTimeField(db_index=True)
    location = models.CharField(max_length=255)
    
    # Applicable barangays. If empty, the event is considered citywide.
    barangays = models.ManyToManyField(
        'accounts.Barangay',
        blank=True,
        related_name='municipal_events',
        help_text='Leave empty if the event is citywide.',
    )
    
    category = models.CharField(
        max_length=50,
        choices=EventCategory.choices,
        default=EventCategory.GENERAL,
        db_index=True,
    )
    organizer = models.CharField(max_length=255, default='Lucena City CENRO')
    status = models.CharField(
        max_length=20,
        choices=EventStatus.choices,
        default=EventStatus.DRAFT,
        db_index=True,
    )
    cover_image = CloudinaryField('image', folder='events/', null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_events',
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['start_datetime']
        indexes = [
            models.Index(fields=['status', 'start_datetime']),
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._initial_status = self.status

    def __str__(self):
        return f"{self.title} ({self.get_status_display()})"

    @property
    def is_citywide(self):
        if self.pk is None:
            return True
        return not self.barangays.exists()

    def clean(self):
        super().clean()
        if self.start_datetime and self.end_datetime:
            if self.end_datetime <= self.start_datetime:
                raise ValidationError({
                    'end_datetime': 'End date/time must be strictly after the start date/time.'
                })
        
        # Validate status transitions if the record already exists in database
        if self.pk and hasattr(self, '_initial_status') and self._initial_status:
            if self.status != self._initial_status:
                allowed = VALID_EVENT_TRANSITIONS.get(self._initial_status, set())
                if self.status not in allowed:
                    raise ValidationError({
                        'status': f"Invalid status transition from '{self._initial_status}' to '{self.status}'."
                    })

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)
        self._initial_status = self.status
