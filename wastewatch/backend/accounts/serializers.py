from rest_framework import serializers
from .models import User, Barangay

class BarangaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Barangay
        fields = '__all__'

class UserSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    
    class Meta:
        model = User
        fields = [
            'id', 'email', 'full_name', 'role', 'barangay', 
            'barangay_name', 'is_active', 'created_at', 'password'
        ]
        read_only_fields = ['created_at']
        extra_kwargs = {
            'password': {'write_only': True, 'required': False}
        }

    def create(self, validated_data):
        # Handle password correctly
        password = validated_data.pop('password', None)
        user = super().create(validated_data)
        if password:
            user.set_password(password)
            user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        user = super().update(instance, validated_data)
        if password:
            user.set_password(password)
            user.save()
        return user
