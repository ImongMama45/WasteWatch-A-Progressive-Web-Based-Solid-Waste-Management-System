from django.db import models
from django.conf import settings
from cloudinary.models import CloudinaryField


class PostType(models.TextChoices):
    DISCUSSION = 'discussion', 'Discussion'
    REPORT = 'report', 'Problem Report'


class PostCategory(models.TextChoices):
    GENERAL = 'general', 'General Inquiry'
    SCHEDULE = 'schedule', 'Collection Schedule'
    CLEANUP = 'cleanup', 'Cleanup Initiative'
    ADVISORY = 'advisory', 'Civic Advisory'


class CommunityPost(models.Model):
    """
    Citizen-centered civic discussion post regarding waste management,
    neighborhood cleanliness, collection concerns, and community initiatives.
    Can also represent a public-facing civic waste problem report linked
    to an authoritative GarbageReport.
    """
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='community_posts',
    )
    barangay = models.ForeignKey(
        'accounts.Barangay',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='community_posts',
        help_text="Author's barangay or tagged barangay for this discussion.",
    )
    post_type = models.CharField(
        max_length=20,
        choices=PostType.choices,
        default=PostType.DISCUSSION,
        help_text="Type of community post: discussion or problem report.",
    )
    category = models.CharField(
        max_length=30,
        choices=PostCategory.choices,
        default=PostCategory.GENERAL,
        blank=True,
        help_text="Topic category for civic discussion.",
    )
    report = models.OneToOneField(
        'watcher.GarbageReport',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='community_post',
        help_text="Linked authoritative GarbageReport if post_type is report (one-to-one).",
    )
    content = models.TextField(
        help_text="Main content of the discussion post or report summary."
    )
    image = CloudinaryField(
        'image',
        null=True,
        blank=True,
        help_text="Optional photo attachment for discussion posts.",
    )
    is_hidden = models.BooleanField(
        default=False,
        help_text="Flagged or hidden by moderators/administrators.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Community Post'
        verbose_name_plural = 'Community Posts'

    def __str__(self):
        author_name = getattr(self.author, 'full_name', '') or getattr(self.author, 'username', 'User')
        snippet = self.content[:40] + ('...' if len(self.content) > 40 else '')
        return f"{author_name}: {snippet}"

    @property
    def like_count(self):
        return self.likes.count()

    @property
    def comment_count(self):
        return self.comments.filter(is_hidden=False).count()


class PostLike(models.Model):
    """
    Tracks likes on a community post. Prevents duplicate likes at the database level.
    """
    post = models.ForeignKey(
        CommunityPost,
        on_delete=models.CASCADE,
        related_name='likes',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='community_post_likes',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = ('post', 'user')
        verbose_name = 'Post Like'
        verbose_name_plural = 'Post Likes'

    def __str__(self):
        return f"{self.user} liked post #{self.post_id}"


class PostComment(models.Model):
    """
    Comments on community posts.
    """
    post = models.ForeignKey(
        CommunityPost,
        on_delete=models.CASCADE,
        related_name='comments',
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='community_post_comments',
    )
    content = models.TextField()
    is_hidden = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']
        verbose_name = 'Post Comment'
        verbose_name_plural = 'Post Comments'

    def __str__(self):
        author_name = getattr(self.author, 'full_name', '') or getattr(self.author, 'username', 'User')
        return f"Comment by {author_name} on post #{self.post_id}"


class PostReport(models.Model):
    """
    Reports of inappropriate posts submitted by community members.
    """
    REPORT_REASONS = [
        ('spam', 'Spam or Advertising'),
        ('offensive', 'Inappropriate or Offensive Language'),
        ('misinformation', 'False or Misleading Information'),
        ('harassment', 'Harassment or Bullying'),
        ('other', 'Other Issue'),
    ]

    STATUS_CHOICES = [
        ('pending', 'Pending Review'),
        ('reviewed', 'Reviewed'),
        ('dismissed', 'Dismissed'),
        ('actioned', 'Actioned / Hidden'),
    ]

    post = models.ForeignKey(
        CommunityPost,
        on_delete=models.CASCADE,
        related_name='reports',
    )
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='community_post_reports',
    )
    reason = models.CharField(max_length=50, choices=REPORT_REASONS, default='other')
    details = models.TextField(blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = ('post', 'reporter')
        verbose_name = 'Post Report'
        verbose_name_plural = 'Post Reports'

    def __str__(self):
        return f"Report #{self.id} on post #{self.post_id} by {self.reporter}"
