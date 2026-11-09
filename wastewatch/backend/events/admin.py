from django.contrib import admin
from .models import MunicipalEvent


@admin.register(MunicipalEvent)
class MunicipalEventAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'status', 'start_datetime', 'end_datetime', 'organizer', 'is_citywide')
    list_filter = ('status', 'category', 'organizer', 'start_datetime')
    search_fields = ('title', 'description', 'location', 'organizer')
    filter_horizontal = ('barangays',)
    readonly_fields = ('created_at', 'updated_at')
