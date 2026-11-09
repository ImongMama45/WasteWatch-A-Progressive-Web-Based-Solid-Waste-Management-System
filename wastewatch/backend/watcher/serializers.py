from django.conf import settings
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from accounts.permissions import is_viewer_authorized_for_report, is_admin_user
from .models import (
    GarbageReport,
    CollectionConfirmation,
    GarbageHotspot,
    Escalation,
    StopValidation,
    ReportVote,
    ReportStatusHistory,
    WatcherReportedSpot,
    WatcherSpotStatus,
    ReportStatus,
)


class ReportStatusHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ReportStatusHistory
        fields = ['id', 'previous_status', 'new_status', 'changed_by', 'changed_by_name', 'timestamp', 'remarks']
        read_only_fields = fields

    def get_changed_by_name(self, obj):
        if not obj.changed_by:
            return ''
        return obj.changed_by.full_name or obj.changed_by.get_full_name() or obj.changed_by.username or ''

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = request.user if request else None

        report = getattr(instance, 'report', None)
        if not is_viewer_authorized_for_report(user, report):
            data['changed_by'] = None
            data['changed_by_name'] = ''
            data['remarks'] = ''
        return data


class ReportVoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportVote
        fields = ['id', 'report', 'user', 'vote_type', 'created_at', 'updated_at']
        read_only_fields = ['id', 'user', 'created_at', 'updated_at']


class GarbageReportSerializer(serializers.ModelSerializer):
    barangay_name = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    reported_user_name = serializers.CharField(source='reported_user.full_name', read_only=True, default='')
    approved_by_name = serializers.CharField(source='approved_by.full_name', read_only=True, default='')
    rejected_by_name = serializers.CharField(source='rejected_by.full_name', read_only=True, default='')
    upvotes = serializers.SerializerMethodField()
    downvotes = serializers.SerializerMethodField()
    net_votes = serializers.SerializerMethodField()
    user_vote = serializers.SerializerMethodField()
    community_post_id = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    time_to_approval_seconds = serializers.SerializerMethodField()
    time_to_resolution_seconds = serializers.SerializerMethodField()
    resolution_duration_after_approval_seconds = serializers.SerializerMethodField()
    status_history = ReportStatusHistorySerializer(many=True, read_only=True)
    spot_report_count = serializers.SerializerMethodField()
    spot_my_report_count = serializers.SerializerMethodField()
    
    class Meta:
        model = GarbageReport
        fields = '__all__'
        read_only_fields = [
            'status', 'user', 'approved_by', 'approved_at',
            'rejected_by', 'rejected_at', 'rejection_reason',
            'resolved_at',
            'created_at', 'updated_at',
            'is_archived',
            'is_watcher_spot', 'watcher_spot',
        ]

    def get_spot_report_count(self, obj):
        if not obj.watcher_spot_id:
            return None
        from .services import spot_report_counts
        return spot_report_counts(obj.watcher_spot)[0]

    def get_spot_my_report_count(self, obj):
        if not obj.watcher_spot_id:
            return None
        request = self.context.get('request')
        from .services import spot_report_counts
        return spot_report_counts(obj.watcher_spot, getattr(request, 'user', None))[1]

    def validate_reported_user(self, value):
        if value and value.role not in ['driver', 'watcher']:
            raise serializers.ValidationError("You can only report drivers or watchers.")
        return value

    def get_barangay_name(self, obj):
        return obj.barangay.name if obj.barangay else "Unknown"

    def get_user_name(self, obj):
        # Fallback helper; authoritative representation logic is handled in to_representation()
        if not obj.user:
            return "Anonymous Citizen"
        request = self.context.get('request')
        user = request.user if request else None
        if is_viewer_authorized_for_report(user, obj):
            return obj.user.full_name or obj.user.username or "Lucena Citizen"
        return "Community Waste Report"

    def get_upvotes(self, obj):
        if hasattr(obj, 'annotated_upvotes'):
            return obj.annotated_upvotes
        return obj.upvote_count

    def get_downvotes(self, obj):
        if hasattr(obj, 'annotated_downvotes'):
            return obj.annotated_downvotes
        return obj.downvote_count

    def get_net_votes(self, obj):
        up = getattr(obj, 'annotated_upvotes', None)
        down = getattr(obj, 'annotated_downvotes', None)
        if up is not None and down is not None:
            return up - down
        return obj.net_votes

    def get_user_vote(self, obj):
        if hasattr(obj, '_user_vote'):
            return obj._user_vote
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            return None
        vote = obj.votes.filter(user=request.user).first()
        return vote.vote_type if vote else None

    def get_community_post_id(self, obj):
        try:
            return obj.community_post.id if hasattr(obj, 'community_post') and obj.community_post else None
        except Exception:
            return None

    def get_comment_count(self, obj):
        if hasattr(obj, 'annotated_comment_count'):
            return obj.annotated_comment_count
        try:
            if hasattr(obj, 'community_post') and obj.community_post:
                return obj.community_post.comments.filter(is_hidden=False).count()
        except Exception:
            pass
        return 0

    def get_time_to_approval_seconds(self, obj):
        dur = obj.time_to_approval
        return dur.total_seconds() if dur else None

    def get_time_to_resolution_seconds(self, obj):
        dur = obj.time_to_resolution
        return dur.total_seconds() if dur else None

    def get_resolution_duration_after_approval_seconds(self, obj):
        dur = obj.resolution_duration_after_approval
        return dur.total_seconds() if dur else None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = request.user if request else None

        # 1. Reporter identity masking (user ID and user_name)
        if not is_viewer_authorized_for_report(user, instance):
            data['user'] = None
            data['user_name'] = "Community Waste Report"
        elif not instance.user:
            data['user_name'] = "Anonymous Citizen"
        else:
            data['user_name'] = instance.user.full_name or instance.user.username or "Lucena Citizen"

        # 2. Reported user privacy (reported_user and reported_user_name)
        # Only exposed to administrators, assigned barangay officials, or the reported user themselves
        has_operational_need = False
        if user and user.is_authenticated:
            if is_admin_user(user):
                has_operational_need = True
            elif getattr(user, 'role', None) == 'brgy_official' and getattr(user, 'barangay_id', None):
                if instance.barangay_id and instance.barangay_id == user.barangay_id:
                    has_operational_need = True
            elif getattr(instance, 'reported_user_id', None) and instance.reported_user_id == user.id:
                has_operational_need = True

        if not has_operational_need:
            data['reported_user'] = None
            data['reported_user_name'] = ''

        # 3. Staff identity masking (approved_by, approved_by_name, rejected_by, rejected_by_name)
        # Only exposed to administrators or assigned barangay officials for the report's barangay
        is_staff_viewer = False
        if user and user.is_authenticated:
            if is_admin_user(user):
                is_staff_viewer = True
            elif getattr(user, 'role', None) == 'brgy_official' and getattr(user, 'barangay_id', None):
                if instance.barangay_id and instance.barangay_id == user.barangay_id:
                    is_staff_viewer = True

        if not is_staff_viewer:
            data['approved_by'] = None
            data['approved_by_name'] = ''
            data['rejected_by'] = None
            data['rejected_by_name'] = ''

        # 4. Photo Evidence URL normalization (resolves full HTTPS Cloudinary / media URLs)
        cloud_name = getattr(settings, 'CLOUDINARY_STORAGE', {}).get('CLOUD_NAME') or 'dr5ba1lmn'
        resolved_images = []
        for img_field in ['image', 'image_2', 'image_3', 'image_4']:
            raw = getattr(instance, img_field, None)
            if not raw:
                data[img_field] = None
                continue
            u = None
            try:
                if hasattr(raw, 'url') and raw.url:
                    u = raw.url
                else:
                    val = str(raw).strip()
                    if val and val != 'None':
                        u = val
            except Exception:
                val = str(raw).strip()
                if val and val != 'None':
                    u = val

            if u:
                if u.startswith('//'):
                    u = f'https:{u}'
                elif u.startswith('http://res.cloudinary.com'):
                    u = u.replace('http://', 'https://', 1)
                elif u.startswith('image/upload/'):
                    u = f'https://res.cloudinary.com/{cloud_name}/{u}'
                elif not u.startswith('http') and not u.startswith('/media/'):
                    u = f'https://res.cloudinary.com/{cloud_name}/image/upload/{u}'
                elif not u.startswith('http') and request:
                    u = request.build_absolute_uri(u)

                data[img_field] = u
                if u not in resolved_images:
                    resolved_images.append(u)
            else:
                data[img_field] = None

        data['images'] = resolved_images

        return data

class CollectionConfirmationSerializer(serializers.ModelSerializer):
    confirmed_by_name = serializers.SerializerMethodField()
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    
    class Meta:
        model = CollectionConfirmation
        fields = '__all__'
        read_only_fields = ['id', 'confirmed_by', 'confirmed_at', 'barangay']

    def get_confirmed_by_name(self, obj):
        return obj.confirmed_by.full_name if obj.confirmed_by else None

    def validate(self, attrs):
        request = self.context.get('request')
        user = request.user if request else None
        if not user or not user.is_authenticated:
            raise serializers.ValidationError("Authentication required to confirm collections.")

        if user.role not in ['admin', 'brgy_official', 'watcher']:
            raise PermissionDenied(
                f"Role '{user.role}' is not authorized to confirm waste collections."
            )

        report = attrs.get('report')
        if report:
            if not is_admin_user(user):
                if not report.barangay:
                    raise PermissionDenied("Report without an assigned barangay requires admin confirmation.")
                if report.barangay_id != getattr(user, 'barangay_id', None):
                    raise PermissionDenied("Cannot confirm collection for reports outside your assigned barangay.")


            if report.is_archived:
                raise serializers.ValidationError("Cannot confirm collection on an archived report.")
            if report.status == 'resolved':
                raise serializers.ValidationError("This report has already been confirmed / resolved.")
            if report.status != 'approved':
                raise serializers.ValidationError("Report must be in 'approved' status to confirm collection.")

        return attrs


class GarbageHotspotSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    report_count = serializers.SerializerMethodField()
    is_watcher_spot = serializers.SerializerMethodField()

    class Meta:
        model = GarbageHotspot
        fields = '__all__'
        read_only_fields = ['assigned_truck', 'dispatch_acknowledged', 'dispatched_at', 'source_report', 'is_active']

    def get_report_count(self, obj):
        # Base count is 1 per row. Clustering in the view will aggregate these.
        return 1

    def get_is_watcher_spot(self, obj):
        report = obj.source_report
        return bool(report and report.is_watcher_spot)

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
    truck_model = serializers.CharField(source='truck.model', read_only=True)
    driver_open_escalations = serializers.SerializerMethodField()
    
    class Meta:
        model = Escalation
        fields = '__all__'
        read_only_fields = ['driver_acknowledged', 'resolved_by', 'resolved_at', 'created_at', 'updated_at']

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

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = request.user if request else None

        # Drivers and unauthorized viewers only receive operational information
        # Mask moderation remarks, internal personnel IDs, and non-operational details
        if not user or not user.is_authenticated or (not is_admin_user(user) and getattr(user, 'role', None) != 'brgy_official'):
            data['created_by'] = None
            data['created_by_name'] = ''
            data['acknowledged_by'] = None
            data['acknowledged_by_name'] = ''
            data['resolved_by'] = None
            data['resolved_by_name'] = ''
            notes = data.get('resolution_notes') or ''
            if 'Report rejected:' in notes or 'Cancelled:' in notes:
                data['resolution_notes'] = 'Dispatch cancelled by operations.'
        return data



class WatcherReportedSpotSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True, default='')
    first_reported_by_name = serializers.SerializerMethodField()
    rejected_by_name = serializers.CharField(source='rejected_by.full_name', read_only=True, default='')
    report_count = serializers.SerializerMethodField()
    my_report_count = serializers.SerializerMethodField()
    latest_report = serializers.SerializerMethodField()

    class Meta:
        model = WatcherReportedSpot
        fields = [
            'id', 'latitude', 'longitude', 'barangay', 'barangay_name',
            'status', 'first_reported_by', 'first_reported_by_name',
            'last_reported_at', 'rejected_by', 'rejected_by_name',
            'rejected_at', 'rejection_reason', 'created_at', 'updated_at',
            'report_count', 'my_report_count', 'latest_report',
        ]
        read_only_fields = fields

    def get_first_reported_by_name(self, obj):
        if not obj.first_reported_by:
            return 'Watcher'
        return obj.first_reported_by.full_name or obj.first_reported_by.username or 'Watcher'

    def get_report_count(self, obj):
        from .services import spot_report_counts
        return spot_report_counts(obj)[0]

    def get_my_report_count(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        from .services import spot_report_counts
        return spot_report_counts(obj, user)[1]

    def get_latest_report(self, obj):
        rep = obj.reports.filter(status=ReportStatus.APPROVED).order_by('-created_at').first()
        if not rep:
            rep = obj.reports.order_by('-created_at').first()
        if not rep:
            return None

        # Resolve image URLs
        resolved_images = []
        for img_field in ('image', 'image_2', 'image_3', 'image_4'):
            f = getattr(rep, img_field, None)
            if not f:
                continue
            try:
                u = f.url
                if u.startswith('//'):
                    u = f'https:{u}'
                elif not u.startswith('http') and not u.startswith('/media/'):
                    request = self.context.get('request')
                    if request:
                        u = request.build_absolute_uri(u)
                resolved_images.append(u)
            except Exception:
                pass

        return {
            'id': rep.id,
            'issue_type': rep.issue_type,
            'severity': rep.severity,
            'description': rep.description,
            'address': rep.address,
            'created_at': rep.created_at.isoformat(),
            'images': resolved_images,
        }
