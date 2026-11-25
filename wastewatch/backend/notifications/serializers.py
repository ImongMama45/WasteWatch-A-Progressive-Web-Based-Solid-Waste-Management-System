from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    barangay_name = serializers.SerializerMethodField()
    is_read = serializers.SerializerMethodField()
    read_at = serializers.SerializerMethodField()
    is_archived = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            'id', 'title', 'message', 'type',
            'is_read', 'read_at', 'is_archived', 'created_at',
            'user', 'barangay', 'barangay_name',
            'broadcast_id',
        ]
        read_only_fields = ['created_at']

    def get_barangay_name(self, obj):
        return obj.barangay.name if obj.barangay else None

    def get_is_read(self, obj):
        if not hasattr(obj, '_rcpt_exists'):
            raise AttributeError(f"Notification {obj.pk} is missing receipt annotations.")
        if obj._rcpt_exists:
            return obj._rcpt_read_at is not None
        return bool(obj._historical_shared)

    def get_read_at(self, obj):
        if not hasattr(obj, '_rcpt_read_at'):
            raise AttributeError(f"Notification {obj.pk} is missing receipt annotations.")
        return obj._rcpt_read_at

    def get_is_archived(self, obj):
        if not hasattr(obj, '_rcpt_archived'):
            raise AttributeError(f"Notification {obj.pk} is missing receipt annotations.")
        return bool(obj._rcpt_archived)
