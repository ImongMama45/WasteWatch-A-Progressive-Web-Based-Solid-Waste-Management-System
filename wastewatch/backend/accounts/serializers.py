"""
accounts/serializers.py
-----------------------
Three serializers:
  BarangaySerializer — public read-only list
  UserSerializer     — full user representation (used in /me/ and admin)
  RegisterSerializer — write-only registration with barangay + password2 validation
"""

from rest_framework import serializers
from .models import User, Barangay, UserRole


# ---------------------------------------------------------------------------
# Barangay
# ---------------------------------------------------------------------------
class BarangaySerializer(serializers.ModelSerializer):
    class Meta:
        model  = Barangay
        fields = ['id', 'name']


# ---------------------------------------------------------------------------
# User (read / update)
# ---------------------------------------------------------------------------
class UserSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    dumpsite_name = serializers.CharField(source='dumpsite.name', read_only=True)

    class Meta:
        model  = User
        fields = [
            'id', 'username', 'email', 'full_name', 'first_name', 'last_name', 'role', 'employee_type',
            'profile_pic',
            'barangay', 'barangay_name',
            'dumpsite', 'dumpsite_name',
            'is_active', 'created_at',
        ]
        read_only_fields = ['created_at', 'role']


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

    class Meta:
        model  = User
        fields = [
            'id', 'username', 'email', 'full_name', 'first_name', 'last_name', 'role', 'employee_type',
            'profile_pic',
            'barangay', 'barangay_name',
            'dumpsite', 'dumpsite_name',
            'is_active', 'password', 'created_at',
        ]
        read_only_fields = ['created_at']

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
# Registration
# ---------------------------------------------------------------------------
class RegisterSerializer(serializers.Serializer):
    """
    Accepts the public registration payload.
    password2 is only used for validation; it is NOT stored.
    barangay is required for valid citizens.
    """

    username = serializers.CharField(
        max_length=150, 
        required=True,
        error_messages={'required': 'Mangyaring ilagay ang iyong username.'}
    )
    profile_pic = serializers.ImageField(required=False, allow_null=True)

    first_name = serializers.CharField(
        max_length=150, 
        required=True,
        error_messages={'required': 'Mangyaring ilagay ang iyong unang pangalan (First Name).'}
    )
    last_name = serializers.CharField(
        max_length=150, 
        required=True,
        error_messages={'required': 'Mangyaring ilagay ang iyong huling pangalan (Last Name).'}
    )
    email     = serializers.EmailField(
        required=True,
        error_messages={'required': 'Mangyaring ilagay ang iyong email.'}
    )
    password  = serializers.CharField(
        write_only=True, 
        min_length=8, 
        required=True,
        error_messages={
            'required': 'Mangyaring ilagay ang iyong password.',
            'min_length': 'Ang password ay dapat hindi bababa sa 8 characters.'
        }
    )
    password2 = serializers.CharField(
        write_only=True, 
        required=True,
        error_messages={'required': 'Mangyaring i-confirm ang iyong password.'}
    )
    barangay  = serializers.PrimaryKeyRelatedField(
        queryset=Barangay.objects.all(),
        required=False,
        allow_null=True,
    )
    role      = serializers.CharField(required=False, default=UserRole.CITIZEN)

    # ── Validation ──────────────────────────────────────────────────────────

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('Ang username na ito ay ginagamit na.')
        return value.lower()

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Ang email na ito ay may account na.')
        return value.lower()

    def validate(self, data):
        if data.get('password') != data.pop('password2', None):
            raise serializers.ValidationError({'password': 'Ang password ay hindi tugma.'})
        return data

    # ── Create ──────────────────────────────────────────────────────────────

    def create(self, validated_data):
        password = validated_data.pop('password')
        barangay = validated_data.pop('barangay')
        
        print(f"DEBUG: RegisterSerializer.create - Saving user with barangay_id: {barangay.id if barangay else None} ({barangay.name if barangay else 'None'})")
        
        # Ensure role is popped if it exists in validated_data to avoid multiple values
        validated_data.pop('role', None) 
        
        # Public registration is ALWAYS citizen.
        role     = UserRole.CITIZEN

        # Auto-generate full_name for backend models
        first_name = validated_data.get('first_name', '')
        last_name = validated_data.get('last_name', '')
        validated_data['full_name'] = f"{first_name} {last_name}".strip()

        user = User(
            role=role,
            barangay=barangay,
            **validated_data,
        )
        user.set_password(password)
        user.save()
        return user
