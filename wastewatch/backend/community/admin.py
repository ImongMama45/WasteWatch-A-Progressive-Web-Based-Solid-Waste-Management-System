from django.contrib import admin
from .models import CommunityPost, PostLike, PostComment, PostReport


@admin.action(description="Hide selected posts from community feed")
def hide_selected_posts(modeladmin, request, queryset):
    queryset.update(is_hidden=True)


@admin.action(description="Unhide / restore selected posts")
def unhide_selected_posts(modeladmin, request, queryset):
    queryset.update(is_hidden=False)


@admin.register(CommunityPost)
class CommunityPostAdmin(admin.ModelAdmin):
    list_display = ('id', 'author', 'barangay', 'content_snippet', 'like_count', 'comment_count', 'is_hidden', 'created_at')
    list_filter = ('is_hidden', 'barangay', 'created_at')
    search_fields = ('content', 'author__full_name', 'author__email', 'author__username')
    actions = [hide_selected_posts, unhide_selected_posts]
    readonly_fields = ('created_at', 'updated_at')

    def content_snippet(self, obj):
        return obj.content[:50] + ('...' if len(obj.content) > 50 else '')
    content_snippet.short_description = 'Content'


@admin.register(PostComment)
class PostCommentAdmin(admin.ModelAdmin):
    list_display = ('id', 'post_id', 'author', 'content_snippet', 'is_hidden', 'created_at')
    list_filter = ('is_hidden', 'created_at')
    search_fields = ('content', 'author__full_name', 'author__email')
    readonly_fields = ('created_at', 'updated_at')

    def content_snippet(self, obj):
        return obj.content[:40] + ('...' if len(obj.content) > 40 else '')
    content_snippet.short_description = 'Comment'


@admin.register(PostLike)
class PostLikeAdmin(admin.ModelAdmin):
    list_display = ('id', 'post_id', 'user', 'created_at')
    search_fields = ('user__full_name', 'user__email')
    readonly_fields = ('created_at',)


@admin.register(PostReport)
class PostReportAdmin(admin.ModelAdmin):
    list_display = ('id', 'post_id', 'reporter', 'reason', 'status', 'created_at')
    list_filter = ('status', 'reason', 'created_at')
    search_fields = ('reason', 'details', 'reporter__full_name', 'reporter__email')
    readonly_fields = ('created_at',)
