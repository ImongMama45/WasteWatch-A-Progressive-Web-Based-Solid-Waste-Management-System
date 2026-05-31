"""
accounts/serializers.py
-----------------------
Three serializers:
  BarangaySerializer — public read-only list
  UserSerializer     — full user representation (used in /me/ and admin)
  RegisterSerializer — write-only registration with barangay + password2 validation
"""

from rest_framework import serializers
from .models import User, Barangay


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

    class Meta:
        model  = User
        fields = [
            'id', 'email', 'full_name', 'role',
            'barangay', 'barangay_name',
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
    barangay is required so every citizen account belongs to a barangay.
    """

    full_name = serializers.CharField(max_length=255)
    email     = serializers.EmailField()
    password  = serializers.CharField(write_only=True, min_length=8)
    password2 = serializers.CharField(write_only=True)
    barangay  = serializers.PrimaryKeyRelatedField(
        queryset=Barangay.objects.all(),
        required=True,
        allow_null=False,
    )

    # ── Validation ──────────────────────────────────────────────────────────

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return value.lower()

    def validate(self, data):
        if data['password'] != data.pop('password2'):
            raise serializers.ValidationError({'password': 'Passwords do not match.'})
        if not data.get('barangay'):
            raise serializers.ValidationError({'barangay': 'Please select your barangay.'})
        return data

    # ── Create ──────────────────────────────────────────────────────────────

    def create(self, validated_data):
        password = validated_data.pop('password')
        barangay = validated_data.pop('barangay')

        user = User(
            role='citizen',   # always citizen on public registration
            barangay=barangay,
            **validated_data,
        )
        user.set_password(password)
        user.save()
        return user
