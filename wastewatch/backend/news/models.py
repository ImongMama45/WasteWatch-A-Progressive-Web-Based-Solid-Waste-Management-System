from django.db import models
from cloudinary.models import CloudinaryField


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

    def __str__(self):
        target = self.barangay.name if self.barangay else 'City-Wide'
        return f'[{self.type}] {self.title} → {target}'


class EmergencyAlert(models.Model):
    title     = models.CharField(max_length=255)
    body      = models.TextField()
    date      = models.DateField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

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