from django.db import models

class NewsType(models.TextChoices):
    ANNOUNCEMENT = 'announcement', 'Announcement'
    NEWS = 'news', 'News'
    EMERGENCY = 'emergency', 'Emergency'

class NewsCategory(models.TextChoices):
    ANNOUNCEMENTS = 'Announcements', 'Announcements'
    NEWS = 'News', 'News'
    CLEANUP_DRIVES = 'Cleanup Drives', 'Cleanup Drives'
    RANKINGS = 'Rankings', 'Rankings'
    ADVISORIES = 'Advisories', 'Advisories'
    EMERGENCIES = 'Emergencies', 'Emergencies'

class Priority(models.TextChoices):
    LOW = 'low', 'Low'
    MEDIUM = 'medium', 'Medium'
    HIGH = 'high', 'High'

class NewsItem(models.Model):
    title = models.CharField(max_length=255)
    description = models.TextField()
    type = models.CharField(max_length=20, choices=NewsType.choices, default=NewsType.NEWS)
    category = models.CharField(max_length=30, choices=NewsCategory.choices, default=NewsCategory.NEWS)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.LOW)
    date = models.DateField(auto_now_add=True)
    barangay = models.CharField(max_length=100, default='City-Wide')
    is_featured = models.BooleanField(default=False)
    is_pinned = models.BooleanField(default=False)
    
    # Optional styling for featured items
    accent_color = models.CharField(max_length=7, blank=True, help_text="HEX color, e.g., #e74c3c")
    bg_color = models.CharField(max_length=7, blank=True, help_text="HEX color, e.g., #7f1d1d")

    class Meta:
        ordering = ['-is_pinned', '-date']

    def __str__(self):
        return self.title

class EmergencyAlert(models.Model):
    title = models.CharField(max_length=255)
    body = models.TextField()
    date = models.DateField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['-date']

    def __str__(self):
        return self.title

class BarangaySpotlight(models.Model):
    barangay = models.ForeignKey('accounts.Barangay', on_delete=models.CASCADE)
    achievement = models.CharField(max_length=255)
    description = models.TextField()
    score = models.IntegerField()
    improvement = models.CharField(max_length=10) # e.g., "+4%"
    trend = models.CharField(max_length=10, choices=[('up', 'Up'), ('down', 'Down')], default='up')
    icon = models.CharField(max_length=50, default='award') # Lucide icon name

    def __str__(self):
        return f"{self.barangay.name} - {self.achievement}"
