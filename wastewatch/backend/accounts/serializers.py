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
            'id', 'email', 'full_name', 'role',
            'barangay', 'barangay_name',
            'dumpsite', 'dumpsite_name',
            'is_active', 'created_at',
        ]
        read_only_fields = ['created_at', 'role']


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------
class RegisterSerializer(serializers.Serializer):
    """
    Accepts the public registration payload.
    password2 is only used for validation; it is NOT stored.
    barangay is required for valid citizens.
    """

    full_name = serializers.CharField(
        max_length=255, 
        required=True,
        error_messages={'required': 'Mangyaring ilagay ang iyong buong pangalan.'}
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

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Ang email na ito ay may account na.')
        return value.lower()

    def validate(self, data):
        if data.get('password') != data.pop('password2', None):
            raise serializers.ValidationError({'password': 'Ang password ay hindi tugma.'})
        if not data.get('barangay'):
            raise serializers.ValidationError({'barangay': 'Mangyaring piliin ang iyong barangay.'})
        return data

    # ── Create ──────────────────────────────────────────────────────────────

    def create(self, validated_data):
        password = validated_data.pop('password')
        barangay = validated_data.pop('barangay')
        # Ensure role is popped if it exists in validated_data to avoid multiple values
        validated_data.pop('role', None) 
        
        # Public registration is ALWAYS citizen.
        role     = UserRole.CITIZEN

        user = User(
            role=role,
            barangay=barangay,
            **validated_data,
        )
        user.set_password(password)
        user.save()
        return user
