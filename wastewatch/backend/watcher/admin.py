from django.contrib import admin
from .models import GarbageReport, CollectionConfirmation, GarbageHotspot, Escalation


@admin.register(GarbageReport)
class GarbageReportAdmin(admin.ModelAdmin):
    list_display  = ('id', 'user', 'barangay', 'issue_type', 'severity', 'status', 'created_at')
    list_filter   = ('status', 'issue_type', 'severity', 'barangay')
    search_fields = ('user__full_name', 'user__email', 'description')
    ordering      = ('-created_at',)

    # Allow admins to change status from the list view
    list_editable = ('status',)


@admin.register(CollectionConfirmation)
class CollectionConfirmationAdmin(admin.ModelAdmin):
    list_display  = ('id', 'confirmed_by', 'barangay', 'report', 'confirmed_at')
    list_filter   = ('barangay',)
    ordering      = ('-confirmed_at',)

@admin.register(GarbageHotspot)
class GarbageHotspotAdmin(admin.ModelAdmin):
    list_display = ('name', 'severity', 'barangay', 'created_at')
    list_filter = ('severity', 'barangay')

@admin.register(Escalation)
class EscalationAdmin(admin.ModelAdmin):
    list_display = ('title', 'priority', 'barangay', 'status', 'assignee', 'created_at')
    list_filter = ('priority', 'status', 'barangay')
    list_editable = ('status', 'priority')
