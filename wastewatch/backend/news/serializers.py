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
    # Resolved author name
    author_name = serializers.SerializerMethodField()

    # Explicit boolean fields so multipart "true"/"false" strings are coerced
    is_pinned   = serializers.BooleanField(required=False, default=False)
    is_featured = serializers.BooleanField(required=False, default=False)
    is_active   = serializers.BooleanField(required=False, default=True)

    class Meta:
        model  = NewsItem
        fields = [
            'id', 'title', 'description', 'type', 'category', 'priority',
            'status', 'date', 'updated_at', 'author', 'author_name',
            'barangay', 'barangay_name',
            'is_featured', 'is_pinned', 'is_active',
            'image', 'image_url',
            'accent_color', 'bg_color',
        ]
        read_only_fields = ['date', 'updated_at', 'author_name']

    def to_internal_value(self, data):
        # FormData sends empty string for null barangay — convert to None
        # so PrimaryKeyRelatedField with allow_null=True accepts it
        mutable = data.copy() if hasattr(data, 'copy') else dict(data)
        if mutable.get('barangay') in ('', 'null', 'None', None):
            mutable['barangay'] = None

        # Synchronize status and is_active for incoming payload
        if 'status' in mutable and mutable['status']:
            if mutable['status'] == 'published':
                mutable['is_active'] = True
            elif mutable['status'] in ('draft', 'archived'):
                mutable['is_active'] = False
        elif 'is_active' in mutable:
            raw_active = mutable['is_active']
            if isinstance(raw_active, str):
                is_active = raw_active.lower() == 'true'
            else:
                is_active = bool(raw_active)
            if not is_active:
                mutable['status'] = 'draft'
            else:
                mutable['status'] = 'published'

        return super().to_internal_value(mutable)

    def get_barangay_name(self, obj):
        return obj.barangay.name if obj.barangay else 'City-Wide'

    def get_author_name(self, obj):
        if obj.author:
            name = (obj.author.get_full_name() or '').strip()
            if not name and hasattr(obj.author, 'username'):
                name = obj.author.username
            return name or 'Staff'
        return 'City Official'

    def get_image_url(self, obj):
        if not obj.image:
            return None
        url = obj.image.url
        if url.startswith('res.cloudinary.com'):
            return f'https://{url}'
        if url.startswith('//res.cloudinary.com'):
            return f'https:{url}'
        request = self.context.get('request')
        if request and not url.startswith('http'):
            return request.build_absolute_uri(url)
        return url


class EmergencyAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model  = EmergencyAlert
        fields = '__all__'


class BarangaySpotlightSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)

    class Meta:
        model  = BarangaySpotlight
        fields = '__all__'