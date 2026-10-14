from django.contrib import admin
from .models import ActivityLog

@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ('admin', 'action', 'module', 'timestamp')
    list_filter = ('action', 'module')
