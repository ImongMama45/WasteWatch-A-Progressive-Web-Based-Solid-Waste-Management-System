from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    barangay_name = serializers.SerializerMethodField()

    class Meta:
        model  = Notification
        fields = [
            'id', 'title', 'message', 'type',
            'is_read', 'created_at',
            'user', 'barangay', 'barangay_name',
        ]
        read_only_fields = ['created_at']

    def get_barangay_name(self, obj):
        return obj.barangay.name if obj.barangay else None