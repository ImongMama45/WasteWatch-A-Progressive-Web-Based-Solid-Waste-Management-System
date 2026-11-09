from django.db import models
from django.conf import settings
from cloudinary.models import CloudinaryField


class ContentStatus(models.TextChoices):
    DRAFT     = 'draft',     'Draft'
    PUBLISHED = 'published', 'Published'
    ARCHIVED  = 'archived',  'Archived'


class NewsType(models.TextChoices):
    ANNOUNCEMENT = 'announcement', 'Announcement'
    NEWS         = 'news',         'News'
    EMERGENCY    = 'emergency',    'Emergency'


class NewsCategory(models.TextChoices):
    GENERAL        = 'General',        'General'
    ANNOUNCEMENTS  = 'Announcements',  'Announcements'
    NEWS           = 'News',           'News'
    SERVICE_UPDATES = 'Service Updates', 'Service Updates'
    COMMUNITY      = 'Community',      'Community'
    CLEANUP_DRIVES = 'Cleanup Drives', 'Cleanup Drives'
    RANKINGS       = 'Rankings',       'Rankings'
    ADVISORIES     = 'Advisories',     'Advisories'
    EMERGENCY      = 'Emergency',      'Emergency'
    EMERGENCIES    = 'Emergencies',    'Emergencies'


class Priority(models.TextChoices):
    LOW    = 'low',    'Low'
    MEDIUM = 'medium', 'Medium'
    HIGH   = 'high',   'High'


class NewsItem(models.Model):
    title       = models.CharField(max_length=255)
    description = models.TextField()
    type        = models.CharField(max_length=20, choices=NewsType.choices, default=NewsType.NEWS)
    category    = models.CharField(max_length=30, choices=NewsCategory.choices, default=NewsCategory.NEWS)
    priority    = models.CharField(max_length=10, choices=Priority.choices, default=Priority.LOW)
    date        = models.DateField(auto_now_add=True)

    # ── Targeting ────────────────────────────────────────────────────────────
    # null  → city-wide (visible to everyone)
    # set   → only shown to that barangay's residents/officials
    barangay = models.ForeignKey(
        'accounts.Barangay',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='news_items',
        help_text='Leave null for city-wide announcements.',
    )

    is_featured = models.BooleanField(default=False)
    is_pinned   = models.BooleanField(default=False)
    is_active   = models.BooleanField(default=True)
    status      = models.CharField(
        max_length=20,
        choices=ContentStatus.choices,
        default=ContentStatus.PUBLISHED,
        db_index=True,
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='news_items',
    )
    updated_at = models.DateTimeField(auto_now=True)

    # Optional cover image uploaded with the announcement
    image = CloudinaryField(
        'image',
        null=True,
        blank=True,
        help_text='Cover image shown on dashboards and the news feed.',
    )

    accent_color = models.CharField(max_length=7, blank=True)
    bg_color     = models.CharField(max_length=7, blank=True)

    class Meta:
        ordering = ['-is_pinned', '-date']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._initial_status = getattr(self, 'status', ContentStatus.PUBLISHED)
        self._initial_is_active = getattr(self, 'is_active', True)

    def save(self, *args, **kwargs):
        update_fields = kwargs.get('update_fields')
        has_update_fields = update_fields is not None
        if has_update_fields:
            update_fields = set(update_fields)

        initial_status = getattr(self, '_initial_status', None)
        initial_is_active = getattr(self, '_initial_is_active', None)

        if has_update_fields:
            if 'status' in update_fields and 'is_active' not in update_fields:
                self.is_active = (self.status == ContentStatus.PUBLISHED)
                update_fields.add('is_active')
            elif 'is_active' in update_fields and 'status' not in update_fields:
                if not self.is_active and self.status == ContentStatus.PUBLISHED:
                    self.status = ContentStatus.ARCHIVED
                elif self.is_active and self.status != ContentStatus.PUBLISHED:
                    self.status = ContentStatus.PUBLISHED
                update_fields.add('status')
            kwargs['update_fields'] = list(update_fields)
        else:
            status_changed = (self.status != initial_status)
            active_changed = (self.is_active != initial_is_active)

            if active_changed and not status_changed:
                if not self.is_active:
                    self.status = ContentStatus.ARCHIVED
                else:
                    self.status = ContentStatus.PUBLISHED
            elif status_changed:
                self.is_active = (self.status == ContentStatus.PUBLISHED)
            else:
                if self.status == ContentStatus.PUBLISHED:
                    if not self.is_active:
                        self.status = ContentStatus.ARCHIVED
                    else:
                        self.is_active = True
                else:
                    self.is_active = False

        super().save(*args, **kwargs)
        self._initial_status = self.status
        self._initial_is_active = self.is_active

    def __str__(self):
        target = self.barangay.name if self.barangay else 'City-Wide'
        return f'[{self.type}] {self.title} → {target}'


class EmergencyAlert(models.Model):
    title      = models.CharField(max_length=255)
    body       = models.TextField()
    date       = models.DateField(auto_now_add=True)
    is_active  = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date']

    def __str__(self):
        return self.title


class BarangaySpotlight(models.Model):
    barangay    = models.ForeignKey('accounts.Barangay', on_delete=models.CASCADE)
    achievement = models.CharField(max_length=255)
    description = models.TextField()
    score       = models.IntegerField()
    improvement = models.CharField(max_length=10)
    trend       = models.CharField(max_length=10, choices=[('up', 'Up'), ('down', 'Down')], default='up')
    icon        = models.CharField(max_length=50, default='award')

    def __str__(self):
        return f'{self.barangay.name} - {self.achievement}'