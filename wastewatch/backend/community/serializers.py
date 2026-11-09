from rest_framework import serializers
from .models import CommunityPost, PostLike, PostComment, PostReport
from accounts.models import Barangay
from accounts.permissions import is_viewer_authorized_for_report, is_admin_user


class PostCommentSerializer(serializers.ModelSerializer):
    author_id = serializers.SerializerMethodField()
    author_name = serializers.SerializerMethodField()
    author_role = serializers.SerializerMethodField()
    author_avatar = serializers.SerializerMethodField()
    is_author = serializers.SerializerMethodField()

    class Meta:
        model = PostComment
        fields = [
            'id', 'post', 'author_id', 'author_name', 'author_role',
            'author_avatar', 'content', 'is_author', 'is_hidden', 'created_at',
        ]
        read_only_fields = ['id', 'post', 'author_id', 'created_at', 'is_hidden']

    def _is_masked_reporter_comment(self, obj):
        post = getattr(obj, 'post', None)
        if not post or post.report_id is None:
            return False
        report = post.report
        report_user_id = getattr(report, 'user_id', None)
        if report_user_id and report_user_id == obj.author_id:
            request = self.context.get('request')
            user = request.user if request else None
            return not is_viewer_authorized_for_report(user, report)
        return False

    def get_author_id(self, obj):
        if self._is_masked_reporter_comment(obj):
            return None
        return obj.author_id

    def get_author_name(self, obj):
        if self._is_masked_reporter_comment(obj):
            return 'Reporter (Citizen)'
        if not obj.author:
            return 'Lucena Citizen'
        return obj.author.full_name or obj.author.username or 'Lucena Citizen'

    def get_author_role(self, obj):
        if self._is_masked_reporter_comment(obj):
            return None
        return getattr(obj.author, 'role', None) if obj.author else None

    def get_author_avatar(self, obj):
        if self._is_masked_reporter_comment(obj):
            return None
        if obj.author and obj.author.profile_pic:
            try:
                url = obj.author.profile_pic.url
                if url.startswith('res.cloudinary.com'):
                    return f'https://{url}'
                if url.startswith('//res.cloudinary.com'):
                    return f'https:{url}'
                return url
            except Exception:
                return None
        return None

    def get_is_author(self, obj):
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            return False
        return obj.author_id == request.user.id

    def validate_content(self, value):
        text = (value or '').strip()
        if not text:
            raise serializers.ValidationError("Comment cannot be empty.")
        if len(text) > 1000:
            raise serializers.ValidationError("Comment exceeds maximum length of 1000 characters.")
        return text


class CommunityPostSerializer(serializers.ModelSerializer):
    author_id = serializers.SerializerMethodField()
    author_name = serializers.SerializerMethodField()
    author_role = serializers.SerializerMethodField()
    author_avatar = serializers.SerializerMethodField()
    barangay_name = serializers.SerializerMethodField()
    barangay = serializers.PrimaryKeyRelatedField(
        queryset=Barangay.objects.all(),
        allow_null=True,
        required=False,
    )
    image_url = serializers.SerializerMethodField()
    like_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    has_liked = serializers.SerializerMethodField()
    is_author = serializers.SerializerMethodField()
    report_details = serializers.SerializerMethodField()

    class Meta:
        model = CommunityPost
        fields = [
            'id', 'author_id', 'author_name', 'author_role', 'author_avatar',
            'barangay', 'barangay_name', 'post_type', 'category', 'report',
            'report_details', 'content', 'image', 'image_url',
            'like_count', 'comment_count', 'has_liked', 'is_author',
            'is_hidden', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'author_id', 'post_type', 'like_count', 'comment_count', 'is_hidden',
            'created_at', 'updated_at', 'report', 'report_details',
        ]

    def to_internal_value(self, data):
        mutable = data.copy() if hasattr(data, 'copy') else dict(data)
        if mutable.get('barangay') in ('', 'null', 'None', None):
            mutable['barangay'] = None
        return super().to_internal_value(mutable)

    def _is_masked_report_post(self, obj):
        if obj.report_id is not None:
            request = self.context.get('request')
            user = request.user if request else None
            return not is_viewer_authorized_for_report(user, obj.report)
        return False

    def get_author_id(self, obj):
        if self._is_masked_report_post(obj):
            return None
        return obj.author_id

    def get_author_name(self, obj):
        if self._is_masked_report_post(obj):
            return 'Community Waste Report'
        if not obj.author:
            return 'Lucena Citizen'
        return obj.author.full_name or obj.author.username or 'Lucena Citizen'

    def get_author_role(self, obj):
        if self._is_masked_report_post(obj):
            return None
        return getattr(obj.author, 'role', None) if obj.author else None

    def get_author_avatar(self, obj):
        if self._is_masked_report_post(obj):
            return None
        if obj.author and obj.author.profile_pic:
            try:
                url = obj.author.profile_pic.url
                if url.startswith('res.cloudinary.com'):
                    return f'https://{url}'
                if url.startswith('//res.cloudinary.com'):
                    return f'https:{url}'
                return url
            except Exception:
                return None
        return None

    def get_barangay_name(self, obj):
        return obj.barangay.name if obj.barangay else None

    def get_image_url(self, obj):
        if not obj.image:
            return None
        try:
            url = obj.image.url
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

    def get_like_count(self, obj):
        if hasattr(obj, 'annotated_like_count'):
            return obj.annotated_like_count
        return obj.like_count

    def get_comment_count(self, obj):
        if hasattr(obj, 'annotated_comment_count'):
            return obj.annotated_comment_count
        return obj.comment_count

    def get_has_liked(self, obj):
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            return False
        if hasattr(obj, '_user_liked_ids'):
            return request.user.id in obj._user_liked_ids
        return obj.likes.filter(user=request.user).exists()

    def get_is_author(self, obj):
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            return False
        return obj.author_id == request.user.id

    def get_report_details(self, obj):
        if not obj.report:
            return None
        rep = obj.report
        images = []
        for img_field in [getattr(rep, 'image', None), getattr(rep, 'image_2', None), getattr(rep, 'image_3', None), getattr(rep, 'image_4', None)]:
            if img_field:
                try:
                    url = img_field.url
                    if url.startswith('res.cloudinary.com'):
                        url = f'https://{url}'
                    elif url.startswith('//res.cloudinary.com'):
                        url = f'https:{url}'
                    images.append(url)
                except Exception:
                    pass

        request = self.context.get('request')
        upvotes = getattr(rep, 'annotated_upvotes', None)
        if upvotes is None:
            upvotes = rep.upvote_count
        downvotes = getattr(rep, 'annotated_downvotes', None)
        if downvotes is None:
            downvotes = rep.downvote_count
        net_votes = upvotes - downvotes

        if hasattr(rep, '_user_vote'):
            user_vote = rep._user_vote
        elif request and request.user and request.user.is_authenticated:
            v = rep.votes.filter(user=request.user).first()
            user_vote = v.vote_type if v else None
        else:
            user_vote = None

        return {
            'id': rep.id,
            'issue_type': rep.issue_type,
            'issue_type_label': rep.get_issue_type_display(),
            'severity': rep.severity,
            'status': rep.status,
            'status_label': rep.get_status_display(),
            'address': rep.address,
            'latitude': float(rep.latitude) if rep.latitude else None,
            'longitude': float(rep.longitude) if rep.longitude else None,
            'images': images,
            'upvotes': upvotes,
            'downvotes': downvotes,
            'net_votes': net_votes,
            'user_vote': user_vote,
            'created_at': rep.created_at,
        }

    def validate_content(self, value):
        text = (value or '').strip()
        if not text:
            raise serializers.ValidationError("Post content cannot be empty.")
        if len(text) < 3:
            raise serializers.ValidationError("Post content must be at least 3 characters.")
        if len(text) > 2500:
            raise serializers.ValidationError("Post content exceeds maximum length of 2500 characters.")
        return text


class PostReportSerializer(serializers.ModelSerializer):
    reporter_name = serializers.SerializerMethodField()
    post_content_snippet = serializers.SerializerMethodField()

    class Meta:
        model = PostReport
        fields = [
            'id', 'post', 'reporter', 'reporter_name',
            'reason', 'details', 'status', 'created_at',
            'post_content_snippet',
        ]
        read_only_fields = ['id', 'reporter', 'created_at']

    def get_reporter_name(self, obj):
        if not obj.reporter:
            return 'Citizen'
        return obj.reporter.full_name or obj.reporter.username or 'Citizen'

    def get_post_content_snippet(self, obj):
        if not obj.post:
            return ''
        return obj.post.content[:80] + ('...' if len(obj.post.content) > 80 else '')

