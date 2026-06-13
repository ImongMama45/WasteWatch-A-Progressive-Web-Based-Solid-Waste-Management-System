from rest_framework import serializers
from .models import NewsItem, EmergencyAlert, BarangaySpotlight
from accounts.models import Barangay

class NewsItemSerializer(serializers.ModelSerializer):
    # Read: resolved name for display
    barangay_name = serializers.SerializerMethodField()
    # Write: accept a barangay PK (or null for city-wide)
    barangay = serializers.PrimaryKeyRelatedField(
        queryset=Barangay.objects.all(),
        allow_null=True,
        required=False,
    )
    # Full URL of the cover image (read-only convenience field)
    image_url = serializers.SerializerMethodField()

    # Explicit boolean fields so multipart "true"/"false" strings are coerced
    is_pinned   = serializers.BooleanField(required=False, default=False)
    is_featured = serializers.BooleanField(required=False, default=False)
    is_active   = serializers.BooleanField(required=False, default=True)

    class Meta:
        model  = NewsItem
        fields = [
            'id', 'title', 'description', 'type', 'category', 'priority',
            'date', 'barangay', 'barangay_name',
            'is_featured', 'is_pinned', 'is_active',
            'image', 'image_url',
            'accent_color', 'bg_color',
        ]
        read_only_fields = ['date']

    def to_internal_value(self, data):
        # FormData sends empty string for null barangay — convert to None
        # so PrimaryKeyRelatedField with allow_null=True accepts it
        mutable = data.copy() if hasattr(data, 'copy') else dict(data)
        if mutable.get('barangay') in ('', 'null', 'None', None):
            mutable['barangay'] = None
        return super().to_internal_value(mutable)

    def get_barangay_name(self, obj):
        return obj.barangay.name if obj.barangay else 'City-Wide'

    def get_image_url(self, obj):
        if not obj.image:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.image.url)
        return obj.image.url


class EmergencyAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model  = EmergencyAlert
        fields = '__all__'


class BarangaySpotlightSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)

    class Meta:
        model  = BarangaySpotlight
        fields = '__all__'