import json
from rest_framework import serializers
from .models import MunicipalEvent, EventStatus, EventCategory, VALID_EVENT_TRANSITIONS
from accounts.models import Barangay


class MunicipalEventSerializer(serializers.ModelSerializer):
    barangays = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Barangay.objects.all(),
        required=False,
    )
    barangay_details = serializers.SerializerMethodField(read_only=True)
    is_citywide = serializers.BooleanField(read_only=True)
    cover_image_url = serializers.SerializerMethodField(read_only=True)
    created_by_name = serializers.SerializerMethodField(read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = MunicipalEvent
        fields = [
            'id',
            'title',
            'description',
            'start_datetime',
            'end_datetime',
            'location',
            'barangays',
            'barangay_details',
            'is_citywide',
            'category',
            'category_display',
            'organizer',
            'status',
            'status_display',
            'cover_image',
            'cover_image_url',
            'created_by',
            'created_by_name',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at']

    def to_internal_value(self, data):
        mutable = data.copy() if hasattr(data, 'copy') else dict(data)

        # FormData handling for ManyToMany barangays
        # Support array, comma-separated string, or JSON array string
        if 'barangays' in mutable:
            raw_barangays = mutable.get('barangays')
            if isinstance(raw_barangays, str):
                raw_barangays = raw_barangays.strip()
                if not raw_barangays or raw_barangays in ('[]', 'null', 'None'):
                    mutable['barangays'] = []
                elif raw_barangays.startswith('[') and raw_barangays.endswith(']'):
                    try:
                        mutable['barangays'] = json.loads(raw_barangays)
                    except Exception:
                        pass
                else:
                    # comma separated
                    mutable['barangays'] = [b.strip() for b in raw_barangays.split(',') if b.strip()]
            elif raw_barangays is None:
                mutable['barangays'] = []

        # FormData handling for empty cover_image string
        if 'cover_image' in mutable and mutable.get('cover_image') in ('', 'null', 'None'):
            mutable.pop('cover_image', None)

        return super().to_internal_value(mutable)

    def validate(self, attrs):
        start_dt = attrs.get('start_datetime') or getattr(self.instance, 'start_datetime', None)
        end_dt = attrs.get('end_datetime') or getattr(self.instance, 'end_datetime', None)

        if start_dt and end_dt and end_dt <= start_dt:
            raise serializers.ValidationError({
                'end_datetime': 'End date/time must be strictly after the start date/time.'
            })

        # Lifecycle transition check
        if self.instance and 'status' in attrs:
            new_status = attrs['status']
            current_status = self.instance.status
            if new_status != current_status:
                allowed = VALID_EVENT_TRANSITIONS.get(current_status, set())
                if new_status not in allowed:
                    raise serializers.ValidationError({
                        'status': f"Invalid status transition from '{current_status}' to '{new_status}'."
                    })

        return attrs

    def get_barangay_details(self, obj):
        return [{'id': b.id, 'name': b.name} for b in obj.barangays.all()]

    def get_created_by_name(self, obj):
        if obj.created_by:
            name = (obj.created_by.get_full_name() or '').strip()
            if not name and hasattr(obj.created_by, 'username'):
                name = obj.created_by.username
            return name or 'Admin Staff'
        return 'City Administration'

    def get_cover_image_url(self, obj):
        if not obj.cover_image:
            return None
        url = obj.cover_image.url
        if url.startswith('res.cloudinary.com'):
            return f'https://{url}'
        if url.startswith('//res.cloudinary.com'):
            return f'https:{url}'
        request = self.context.get('request')
        if request and not url.startswith('http'):
            return request.build_absolute_uri(url)
        return url
