from rest_framework import serializers
from .models import (
    GarbageReport,
    CollectionConfirmation,
    GarbageHotspot,
    Escalation,
    StopValidation,
)

class GarbageReportSerializer(serializers.ModelSerializer):
    barangay_name = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    reported_user_name = serializers.CharField(source='reported_user.full_name', read_only=True, default='')
    approved_by_name = serializers.CharField(source='approved_by.full_name', read_only=True, default='')
    rejected_by_name = serializers.CharField(source='rejected_by.full_name', read_only=True, default='')
    
    class Meta:
        model = GarbageReport
        fields = '__all__'
        read_only_fields = [
            'status', 'user', 'approved_by', 'approved_at',
            'rejected_by', 'rejected_at', 'rejection_reason',
            'created_at', 'updated_at',
            'is_archived',
        ]

    def validate_reported_user(self, value):
        if value and value.role not in ['driver', 'watcher']:
            raise serializers.ValidationError("You can only report drivers or watchers.")
        return value

    def get_barangay_name(self, obj):
        return obj.barangay.name if obj.barangay else "Unknown"

    def get_user_name(self, obj):
        # 1. Anonymous submissions
        if not obj.user:
            return "Anonymous Citizen"
        
        # 2. Privacy Logic: check requester
        request = self.context.get('request')
        if not request:
            return "Community Report"
            
        user = request.user
        
        # 3. Always show full name to Admins and Barangay Officials
        if user.is_authenticated and user.role in ['admin', 'brgy_official']:
            return obj.user.full_name
            
        # 4. Show full name to the Owner
        if user.is_authenticated and user == obj.user:
            return obj.user.full_name
            
        # 5. Public / Other Citizens see anonymized label
        return "Community Report"

class CollectionConfirmationSerializer(serializers.ModelSerializer):
    confirmed_by_name = serializers.CharField(source='confirmed_by.full_name', read_only=True)
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    
    class Meta:
        model = CollectionConfirmation
        fields = '__all__'

class GarbageHotspotSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    report_count = serializers.SerializerMethodField()

    class Meta:
        model = GarbageHotspot
        fields = '__all__'
        read_only_fields = ['assigned_truck', 'dispatch_acknowledged', 'dispatched_at', 'source_report']

    def get_report_count(self, obj):
        # Base count is 1 per row. Clustering in the view will aggregate these.
        return 1

class StopValidationSerializer(serializers.ModelSerializer):
    schedule_id = serializers.IntegerField(source='schedule.id', read_only=True)
    route_id = serializers.IntegerField(source='schedule.id', read_only=True)
    stop_id = serializers.IntegerField(source='stop_order', read_only=True)
    label = serializers.SerializerMethodField()
    lat = serializers.SerializerMethodField()
    lng = serializers.SerializerMethodField()
    driver_name = serializers.CharField(source='driver.full_name', read_only=True)
    truck_plate = serializers.CharField(source='schedule.truck.plate_number', read_only=True)
    barangay_names = serializers.SerializerMethodField()
    pre_validation_watcher_name = serializers.CharField(source='pre_validation_watcher.full_name', read_only=True)
    post_validation_watcher_name = serializers.CharField(source='post_validation_watcher.full_name', read_only=True)
    collection_photo_url = serializers.SerializerMethodField()
    pre_validation_photo_url = serializers.SerializerMethodField()
    post_validation_photo_url = serializers.SerializerMethodField()
    barangay_id = serializers.IntegerField(source='barangay.id', read_only=True)
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)

    class Meta:
        model = StopValidation
        fields = [
            'id', 'schedule_id', 'route_id', 'stop_id', 'stop_order', 'collection_date',
            'current_status', 'label', 'lat', 'lng',
            'barangay_id', 'barangay_name',
            'pre_validation_watcher', 'pre_validation_watcher_name',
            'pre_validation_timestamp', 'pre_validation_photo', 'pre_validation_photo_url',
            'pre_validation_latitude', 'pre_validation_longitude', 'pre_validation_remarks',
            'driver', 'driver_name', 'truck_plate', 'barangay_names',
            'collection_timestamp', 'collection_photo', 'collection_photo_url',
            'collection_latitude', 'collection_longitude', 'collection_notes',
            'post_validation_watcher', 'post_validation_watcher_name',
            'post_validation_timestamp', 'post_validation_photo', 'post_validation_photo_url',
            'post_validation_latitude', 'post_validation_longitude', 'dispute_reason',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def _photo_url(self, field):
        if not field:
            return None
        try:
            url = field.url
            if url.startswith('res.cloudinary.com'):
                return f'https://{url}'
            if url.startswith('//res.cloudinary.com'):
                return f'https:{url}'
            request = self.context.get('request')
            if request and not url.startswith('http'):
                return request.build_absolute_uri(url)
            return url
        except Exception:
            return None

    def get_label(self, obj):
        waypoints = obj.schedule.waypoints or []
        if obj.stop_order < len(waypoints):
            wp = waypoints[obj.stop_order]
            if isinstance(wp, dict):
                return wp.get('label') or wp.get('address') or f'Stop {obj.stop_order}'
        return f'Stop {obj.stop_order}'

    def get_lat(self, obj):
        waypoints = obj.schedule.waypoints or []
        if obj.stop_order < len(waypoints):
            wp = waypoints[obj.stop_order]
            if isinstance(wp, dict) and wp.get('lat') is not None:
                return float(wp['lat'])
        return None

    def get_lng(self, obj):
        waypoints = obj.schedule.waypoints or []
        if obj.stop_order < len(waypoints):
            wp = waypoints[obj.stop_order]
            if isinstance(wp, dict) and wp.get('lng') is not None:
                return float(wp['lng'])
        return None

    def get_barangay_names(self, obj):
        return ', '.join(b.name for b in obj.schedule.barangays.all())

    def get_collection_photo_url(self, obj):
        return self._photo_url(obj.collection_photo)

    def get_pre_validation_photo_url(self, obj):
        return self._photo_url(obj.pre_validation_photo)

    def get_post_validation_photo_url(self, obj):
        return self._photo_url(obj.post_validation_photo)


class EscalationSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    assignee_name = serializers.CharField(source='assignee.full_name', read_only=True)
    driver_name = serializers.CharField(source='driver.full_name', read_only=True)
    truck_plate = serializers.CharField(source='truck.plate_number', read_only=True)
    driver_open_escalations = serializers.SerializerMethodField()
    
    class Meta:
        model = Escalation
        fields = '__all__'
        read_only_fields = ['status', 'driver_acknowledged', 'resolved_by', 'resolved_at', 'points_deducted', 'created_at', 'updated_at']

    def get_driver_open_escalations(self, obj):
        if not obj.driver:
            return 0
        return Escalation.objects.filter(driver=obj.driver, status__in=['pending', 'approved']).exclude(id=obj.id).count()

class HotspotInterventionSerializer(serializers.ModelSerializer):
    hotspot_name = serializers.CharField(source='hotspot.name', read_only=True)
    hotspot_latitude = serializers.DecimalField(source='hotspot.latitude', max_digits=9, decimal_places=6, read_only=True)
    hotspot_longitude = serializers.DecimalField(source='hotspot.longitude', max_digits=10, decimal_places=6, read_only=True)
    truck_plate = serializers.CharField(source='truck.plate_number', read_only=True)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    acknowledged_by_name = serializers.CharField(source='acknowledged_by.full_name', read_only=True)
    resolved_by_name = serializers.CharField(source='resolved_by.full_name', read_only=True)

    class Meta:
        from .models import HotspotIntervention
        model = HotspotIntervention
        fields = '__all__'
        read_only_fields = ['status', 'acknowledged_by', 'resolved_by', 'resolved_at', 'created_at', 'updated_at']
