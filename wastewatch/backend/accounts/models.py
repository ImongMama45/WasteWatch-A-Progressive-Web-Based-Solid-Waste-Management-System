"""
accounts/models.py
------------------
Core user system for WasteWatch.

Two models live here:
  1. Barangay  — the smallest admin unit (a village/district)
  2. User      — custom user that extends Django's AbstractUser

Why AbstractUser instead of AbstractBaseUser?
  AbstractUser keeps all of Django's built-in auth goodness (sessions,
  permissions, admin integration) while letting us add our own fields.
  AbstractBaseUser gives more control but requires rebuilding everything
  from scratch — overkill for a student project.
"""

from django.db import models
from django.contrib.auth.models import AbstractUser
from cloudinary.models import CloudinaryField
from django.utils import timezone
from datetime import timedelta


# ---------------------------------------------------------------------------
# 1. Barangay
#    Simple lookup table.  Add more fields later (e.g. coordinates, zone).
# ---------------------------------------------------------------------------
class Barangay(models.Model):
    name       = models.CharField(max_length=100, unique=True)
    population = models.PositiveIntegerField(default=0)
    
    # Geographic data for map rendering
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True)
    boundary_geojson = models.JSONField(null=True, blank=True, help_text="GeoJSON representation of the barangay boundary")

    class Meta:
        verbose_name_plural = 'Barangays'
        ordering = ['name']

    def __str__(self):
        return self.name

    def get_establishments_dict(self):
        """Returns {'Hospital': 3, 'Store': 10} — useful for analytics."""
        return {
            e.name: e.count
            for e in self.establishments.all()
        }


class BarangayEstablishment(models.Model):
    """
    Flexible key-value store for establishment counts per barangay.
    Admin can add any type: Hospital, Clinic, School, Store, Church, etc.
    """
    barangay = models.ForeignKey(
        Barangay,
        on_delete=models.CASCADE,
        related_name='establishments',
    )
    name  = models.CharField(
        max_length=100,
        help_text="Type of establishment, e.g. Hospital, School, Store"
    )
    count = models.PositiveIntegerField(
        default=0,
        help_text="Number of this establishment type in the barangay"
    )

    class Meta:
        ordering = ['name']
        unique_together = ['barangay', 'name']  # No duplicate types per barangay
        verbose_name        = 'Establishment'
        verbose_name_plural = 'Establishments'

    def __str__(self):
        return f"{self.barangay.name} — {self.name}: {self.count}"


# ---------------------------------------------------------------------------
# 2. User roles
#    Defined as a plain Python class so they can be imported anywhere without
#    triggering model imports.  Add new roles here — nothing else needs changing.
# ---------------------------------------------------------------------------
class EmployeeType(models.TextChoices):
    NONE        = '',            '—'
    CREW_MEMBER = 'crew_member', 'Crew Member'


class UserRole(models.TextChoices):
    ADMIN         = 'admin',         'Admin'
    BRGY_OFFICIAL = 'brgy_official', 'Brgy Official'
    WATCHER       = 'watcher',       'Watcher'
    DRIVER        = 'driver',        'Driver'
    CITIZEN       = 'citizen',       'Citizen'
    DUMPSITE      = 'dumpsite',      'Dumpsite Operator'


# ---------------------------------------------------------------------------
# 3. Custom User model
# ---------------------------------------------------------------------------
class User(AbstractUser):
    """
    Replaces Django's default User.
    - Login is done with EMAIL, not username.
    - Each user belongs to one Barangay (optional at registration).
    - Role controls what the user can see/do in the system.
    """

    # We keep username in the DB (AbstractUser requires it) but we don't
    # use it for login.  Set it to a blank string by default.
    username = models.CharField(max_length=150, unique=True, blank=True)

    full_name = models.CharField(max_length=255)

    # Email is the login identifier — must be unique
    email = models.EmailField(unique=True)

    role = models.CharField(
        max_length=20,
        choices=UserRole.choices,
        default=UserRole.CITIZEN,   # Safe default — least privilege
        # NOTE: The role field is intentionally hidden from the public
        # registration form.  Only admins can change roles via /admin/.
    )

    barangay = models.ForeignKey(
        Barangay,
        on_delete=models.SET_NULL,  # If a barangay is deleted, keep the user
        null=True,
        blank=True,
        related_name='residents',
    )

    dumpsite = models.ForeignKey(
        'dumpsite.Dumpsite',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='staff',
    )

    employee_type = models.CharField(
        max_length=20,
        choices=EmployeeType.choices,
        default='',
        blank=True,
        help_text="Set to 'crew_member' for citizens who serve on collection trucks.",
    )

    profile_pic = CloudinaryField(
        'image',
        null=True,
        blank=True,
        help_text="User's profile picture."
    )

    last_activity = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    # Tell Django to use email as the login field
    USERNAME_FIELD = 'email'

    # These fields are prompted when running: python manage.py createsuperuser
    REQUIRED_FIELDS = ['username', 'full_name']

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.full_name} ({self.email}) — {self.role}'

    # -----------------------------------------------------------------------
    # Helper properties — use these in templates and views instead of
    # comparing role strings directly (easier to refactor later)
    # -----------------------------------------------------------------------
    @property
    def is_watcher(self):
        return self.role == UserRole.WATCHER

    @property
    def is_driver(self):
        return self.role == UserRole.DRIVER

    @property
    def is_brgy_official(self):
        return self.role == UserRole.BRGY_OFFICIAL

    @property
    def is_dumpsite(self):
        return self.role == UserRole.DUMPSITE

    @property
    def is_dumpsite_operator(self):
        """Alias for is_dumpsite — clearer name for the operator role."""
        return self.role == UserRole.DUMPSITE

    @property
    def is_crew_member(self):
        """True when this citizen has been tagged as a crew member."""
        return self.employee_type == EmployeeType.CREW_MEMBER

    @property
    def is_admin_role(self):
        """Separate from Django's is_staff/is_superuser — app-level admin."""
        return self.role == UserRole.ADMIN

    # -----------------------------------------------------------------------
    # Presence status tracking
    # -----------------------------------------------------------------------
    ONLINE_THRESHOLD  = timedelta(minutes=2)
    IDLE_THRESHOLD    = timedelta(minutes=5)

    @property
    def presence_status(self):
        if not self.last_activity:
            return 'offline'
        delta = timezone.now() - self.last_activity
        if delta <= self.ONLINE_THRESHOLD:
            return 'online'
        if delta <= self.IDLE_THRESHOLD:
            return 'idle'
        return 'offline'

    # -----------------------------------------------------------------------
    # Override save() to auto-generate a username from email so AbstractUser
    # doesn't complain about a blank unique field.
    # -----------------------------------------------------------------------
    def save(self, *args, **kwargs):
        if not self.username:
            # Use the part before @ as username, e.g. "juan.dela.cruz"
            self.username = self.email.split('@')[0]
        super().save(*args, **kwargs)

# ---------------------------------------------------------------------------
# 4. Driver Profile & Points Ledger
# ---------------------------------------------------------------------------
class DriverProfile(models.Model):
    """
    Dedicated profile for Driver users to track gamification points,
    suspensions, and disciplinary strikes without polluting the main User model.
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='driverprofile')
    points = models.IntegerField(default=0, help_text="Gamification points. Can be negative.")
    is_suspended = models.BooleanField(default=False, help_text="If true, driver is blocked from starting shifts.")

    def __str__(self):
        return f"{self.user.full_name} Profile"

class PointTransaction(models.Model):
    """
    Ledger for tracking point additions and deductions.
    Provides an audit trail for why a driver has their current point balance.
    """
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='point_transactions')
    escalation = models.ForeignKey('watcher.Escalation', on_delete=models.SET_NULL, null=True, blank=True, related_name='point_transactions', help_text="The escalation that triggered this deduction, if applicable.")
    points = models.IntegerField(help_text="Amount added or deducted (e.g. +50, -100)")
    description = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        sign = "+" if self.points >= 0 else ""
        return f"{self.driver.full_name}: {sign}{self.points} ({self.description})"


class SuspensionOverride(models.Model):
    """
    Audit trail for when an Admin manually lifts a driver's suspension.
    Preserves the history of overrides since DriverProfile.is_suspended is just a snapshot.
    """
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='suspension_overrides')
    admin = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='suspensions_lifted')
    reason = models.TextField(help_text="Justification provided by the admin for lifting the suspension.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Override for {self.driver.full_name} by {self.admin.full_name if self.admin else 'System'}"
