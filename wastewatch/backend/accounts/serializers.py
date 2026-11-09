"""
accounts/serializers.py
-----------------------
Three serializers:
  BarangaySerializer — public read-only list
  UserSerializer     — full user representation (used in /me/ and admin)
  RegisterSerializer — write-only registration with barangay + password2 validation
"""

from rest_framework import serializers
from django.utils import timezone
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from .models import User, Barangay, UserRole, BarangayEstablishment
from .validators import normalize_ph_phone


# ---------------------------------------------------------------------------
# Barangay
# ---------------------------------------------------------------------------
class EstablishmentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = BarangayEstablishment
        fields = ['id', 'name', 'count']


class BarangaySerializer(serializers.ModelSerializer):
    establishments = EstablishmentSerializer(many=True, read_only=True)
    users_count = serializers.SerializerMethodField()
    brgy_officials = serializers.SerializerMethodField()

    class Meta:
        model  = Barangay
        fields = ['id', 'name', 'population', 'establishments', 'users_count', 'brgy_officials']

    def get_users_count(self, obj):
        return obj.residents.count()

    def get_brgy_officials(self, obj):
        officials = obj.residents.filter(role=UserRole.BRGY_OFFICIAL)
        return [off.full_name for off in officials]


# ---------------------------------------------------------------------------
# User (read / update)
# ---------------------------------------------------------------------------
class UserSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    dumpsite_name = serializers.CharField(source='dumpsite.name', read_only=True)
    points = serializers.SerializerMethodField()
    is_suspended = serializers.SerializerMethodField()
    suspension_overrides = serializers.SerializerMethodField()

    class Meta:
        model  = User
        fields = [
            'id', 'username', 'email', 'full_name', 'first_name', 'last_name', 'role', 'employee_type',
            'phone_number', 'address_line', 'email_verified', 'email_verified_at',
            'profile_pic',
            'barangay', 'barangay_name',
            'dumpsite', 'dumpsite_name',
            'is_active', 'is_staff', 'is_superuser', 'created_at',
            'points', 'is_suspended', 'suspension_overrides'
        ]
        read_only_fields = ['created_at', 'role', 'points', 'is_suspended', 'suspension_overrides', 'email_verified', 'email_verified_at', 'is_staff', 'is_superuser']

    def get_points(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        if obj.role == 'driver' and (getattr(request.user, 'role', '') == 'admin' or request.user.id == obj.id):
            return getattr(obj.driverprofile, 'points', 0) if hasattr(obj, 'driverprofile') else 0
        return None

    def get_is_suspended(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        if obj.role == 'driver' and (getattr(request.user, 'role', '') == 'admin' or request.user.id == obj.id):
            return getattr(obj.driverprofile, 'is_suspended', False) if hasattr(obj, 'driverprofile') else False
        return None

    def get_suspension_overrides(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        if obj.role == 'driver' and getattr(request.user, 'role', '') == 'admin':
            overrides = obj.suspension_overrides.all().order_by('-created_at')
            return [
                {
                    "id": o.id,
                    "reason": o.reason,
                    "admin_name": o.admin.full_name if o.admin else "System",
                    "created_at": o.created_at.isoformat() if o.created_at else None
                }
                for o in overrides
            ]
        return None


# ---------------------------------------------------------------------------
# Admin User Create / Update  (role + password writable)
# ---------------------------------------------------------------------------
class AdminUserSerializer(serializers.ModelSerializer):
    """
    Used by UserViewSet for admin create/update operations.
    Allows setting role, employee_type, password, dumpsite — all fields
    that the public RegisterSerializer intentionally locks down.
    """
    password      = serializers.CharField(write_only=True, required=False, min_length=6)
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    dumpsite_name = serializers.CharField(source='dumpsite.name', read_only=True)
    points = serializers.SerializerMethodField()
    is_suspended = serializers.SerializerMethodField()
    suspension_overrides = serializers.SerializerMethodField()

    class Meta:
        model  = User
        fields = [
            'id', 'username', 'email', 'full_name', 'first_name', 'last_name', 'role', 'employee_type',
            'phone_number', 'address_line', 'email_verified', 'email_verified_at',
            'profile_pic',
            'barangay', 'barangay_name',
            'dumpsite', 'dumpsite_name',
            'is_active', 'password', 'created_at',
            'points', 'is_suspended', 'suspension_overrides'
        ]
        read_only_fields = ['created_at', 'points', 'is_suspended', 'suspension_overrides']

    def get_points(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        if obj.role == 'driver' and (getattr(request.user, 'role', '') == 'admin' or request.user.id == obj.id):
            return getattr(obj.driverprofile, 'points', 0) if hasattr(obj, 'driverprofile') else 0
        return None

    def get_is_suspended(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        if obj.role == 'driver' and (getattr(request.user, 'role', '') == 'admin' or request.user.id == obj.id):
            return getattr(obj.driverprofile, 'is_suspended', False) if hasattr(obj, 'driverprofile') else False
        return None

    def get_suspension_overrides(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        if obj.role == 'driver' and getattr(request.user, 'role', '') == 'admin':
            overrides = obj.suspension_overrides.all().order_by('-created_at')
            return [
                {
                    "id": o.id,
                    "reason": o.reason,
                    "admin_name": o.admin.full_name if o.admin else "System",
                    "created_at": o.created_at.isoformat() if o.created_at else None
                }
                for o in overrides
            ]
        return None

    def validate(self, attrs):
        role = attrs.get('role', getattr(self.instance, 'role', None))
        employee_type = attrs.get('employee_type', getattr(self.instance, 'employee_type', ''))
        if employee_type == 'crew_member' and role != 'citizen':
            raise serializers.ValidationError({
                'employee_type': 'Only citizens can be designated as crew members.'
            })
        return attrs

    def validate_email(self, value):
        value = value.strip().lower()
        qs = User.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return value

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        # Admin-created staff/official/driver accounts are auto-verified
        if 'email_verified' not in validated_data:
            validated_data['email_verified'] = True
            validated_data['email_verified_at'] = timezone.now()

        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


# ---------------------------------------------------------------------------
# Registration (Citizens Only)
# ---------------------------------------------------------------------------
class RegisterSerializer(serializers.Serializer):
    """
    Public registration serializer strictly for Citizen accounts.
    Specialized accounts (Admins, Watchers, Drivers, Brgy Officials, Dumpsite Operators)
    are provisioned directly by system administrators.
    """

    first_name = serializers.CharField(
        max_length=150,
        required=True,
        error_messages={'required': 'Please enter your first name.'}
    )
    last_name = serializers.CharField(
        max_length=150,
        required=True,
        error_messages={'required': 'Please enter your last name.'}
    )
    email = serializers.EmailField(
        required=True,
        error_messages={'required': 'Please enter your email address.'}
    )
    phone_number = serializers.CharField(
        max_length=20,
        required=True,
        error_messages={'required': 'Please enter your Philippine mobile number.'}
    )
    barangay = serializers.PrimaryKeyRelatedField(
        queryset=Barangay.objects.all(),
        required=True,
        error_messages={'required': 'Please select your barangay in Lucena City.'}
    )
    address_line = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        default=''
    )
    password = serializers.CharField(
        write_only=True,
        min_length=8,
        required=True,
        error_messages={
            'required': 'Please create a password.',
            'min_length': 'Password must be at least 8 characters long.'
        }
    )
    password2 = serializers.CharField(
        write_only=True,
        required=True,
        error_messages={'required': 'Please confirm your password.'}
    )
    accept_terms = serializers.BooleanField(
        required=True,
        error_messages={'required': 'You must agree to the terms and privacy policy.'}
    )
    username = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True
    )
    profile_pic = serializers.ImageField(required=False, allow_null=True)

    # ── Validation ──────────────────────────────────────────────────────────

    def validate_email(self, value):
        cleaned = value.strip().lower()
        if User.objects.filter(email__iexact=cleaned).exists():
            raise serializers.ValidationError('An account with this email address already exists.')
        return cleaned

    def validate_phone_number(self, value):
        normalized = normalize_ph_phone(value)
        # Check if phone number is already registered
        if normalized and User.objects.filter(phone_number=normalized).exists():
            raise serializers.ValidationError('This mobile number is already registered to an account.')
        return normalized

    def validate_accept_terms(self, value):
        if not value:
            raise serializers.ValidationError('You must agree to the terms of service to create an account.')
        return value

    def validate(self, data):
        if data.get('password') != data.get('password2'):
            raise serializers.ValidationError({'password2': 'Passwords do not match.'})

        # Run Django password validators
        password = data.get('password')
        try:
            validate_password(password)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password': list(exc.messages)})

        return data

    # ── Create ──────────────────────────────────────────────────────────────

    def create(self, validated_data):
        password = validated_data.pop('password')
        validated_data.pop('password2', None)
        validated_data.pop('accept_terms', None)
        validated_data.pop('role', None)  # Guaranteed citizen only

        first_name = validated_data.get('first_name', '').strip()
        last_name = validated_data.get('last_name', '').strip()
        full_name = f"{first_name} {last_name}".strip()

        email = validated_data.get('email', '').strip().lower()
        username = validated_data.pop('username', '').strip().lower()
        validated_data.pop('full_name', None)

        # Generate a unique username if not provided or already taken
        if not username:
            base_user = email.split('@')[0]
            candidate = base_user
            idx = 1
            while User.objects.filter(username__iexact=candidate).exists():
                candidate = f"{base_user}_{idx}"
                idx += 1
            username = candidate
        else:
            if User.objects.filter(username__iexact=username).exists():
                username = f"{username}_{int(timezone.now().timestamp()) % 10000}"

        now = timezone.now()
        user = User(
            role=UserRole.CITIZEN,
            username=username,
            full_name=full_name,
            email_verified=False,
            email_verified_at=None,
            terms_accepted_at=now,
            **validated_data
        )
        user.set_password(password)
        user.save()
        return user

# ---------------------------------------------------------------------------
# Barangay Management
# ---------------------------------------------------------------------------
class BarangayListSerializer(serializers.ModelSerializer):
    official_count     = serializers.IntegerField(read_only=True)
    watcher_count      = serializers.IntegerField(read_only=True)
    driver_count       = serializers.IntegerField(read_only=True)
    pending_concerns   = serializers.IntegerField(read_only=True)
    active_hotspots    = serializers.IntegerField(read_only=True)
    open_escalations   = serializers.IntegerField(read_only=True)
    has_unassigned_roles = serializers.BooleanField(read_only=True)

    class Meta:
        model = Barangay
        fields = [
            'id', 'name', 'population', 'official_count', 'watcher_count',
            'driver_count', 'pending_concerns', 'active_hotspots',
            'open_escalations', 'has_unassigned_roles',
        ]

class PersonnelSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'full_name', 'email', 'profile_pic', 'role', 'is_active']

# Dynamic import to prevent circular dependency
def get_hotspot_serializer():
    from watcher.serializers import GarbageHotspotSerializer
    return GarbageHotspotSerializer

def get_escalation_serializer():
    from watcher.serializers import EscalationSerializer
    return EscalationSerializer

def get_report_serializer():
    from watcher.serializers import GarbageReportSerializer
    return GarbageReportSerializer

class BarangayDetailSerializer(serializers.ModelSerializer):
    officials        = serializers.SerializerMethodField()
    watchers         = serializers.SerializerMethodField()
    drivers          = serializers.SerializerMethodField()
    hotspots         = serializers.SerializerMethodField()
    escalations      = serializers.SerializerMethodField()
    pending_concerns = serializers.SerializerMethodField()

    pending_concern_count = serializers.SerializerMethodField()
    active_hotspot_count = serializers.SerializerMethodField()
    open_escalation_count = serializers.SerializerMethodField()

    has_unassigned_roles = serializers.SerializerMethodField()

    class Meta:
        model = Barangay
        fields = [
            'id', 'name', 'population', 'latitude', 'longitude', 'boundary_geojson',
            'officials', 'watchers', 'drivers',
            'hotspots', 'escalations', 'pending_concerns',
            'pending_concern_count', 'active_hotspot_count', 'open_escalation_count',
            'has_unassigned_roles',
        ]

    def get_officials(self, obj):
        return PersonnelSerializer(obj.residents.filter(role=UserRole.BRGY_OFFICIAL), many=True).data

    def get_watchers(self, obj):
        return PersonnelSerializer(obj.residents.filter(role=UserRole.WATCHER), many=True).data

    def get_drivers(self, obj):
        return PersonnelSerializer(obj.residents.filter(role=UserRole.DRIVER), many=True).data

    def get_hotspots(self, obj):
        SerializerClass = get_hotspot_serializer()
        return SerializerClass(obj.hotspots.filter(is_active=True), many=True).data

    def get_escalations(self, obj):
        SerializerClass = get_escalation_serializer()
        return SerializerClass(obj.escalations.all(), many=True).data

    def get_pending_concerns(self, obj):
        SerializerClass = get_report_serializer()
        # Filter for pending reports
        from watcher.models import ReportStatus
        reports = obj.reports.filter(status=ReportStatus.PENDING)
        return SerializerClass(reports, many=True).data

    def get_pending_concern_count(self, obj):
        from watcher.models import ReportStatus
        return obj.reports.filter(status=ReportStatus.PENDING).count()

    def get_active_hotspot_count(self, obj):
        return obj.hotspots.filter(is_active=True).count()

    def get_open_escalation_count(self, obj):
        return obj.escalations.filter(status='pending').count()

    def get_has_unassigned_roles(self, obj):
        return (
            obj.residents.filter(role=UserRole.BRGY_OFFICIAL).count() == 0 or
            obj.residents.filter(role=UserRole.WATCHER).count() == 0 or
            obj.residents.filter(role=UserRole.DRIVER).count() == 0
        )
