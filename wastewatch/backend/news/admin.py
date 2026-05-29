from django.contrib import admin
from .models import NewsItem, EmergencyAlert, BarangaySpotlight

@admin.register(NewsItem)
class NewsItemAdmin(admin.ModelAdmin):
    list_display = ('title', 'type', 'category', 'priority', 'date', 'barangay', 'is_featured', 'is_pinned')
    list_filter = ('type', 'category', 'priority', 'is_featured', 'is_pinned')
    search_fields = ('title', 'description', 'barangay')

@admin.register(EmergencyAlert)
class EmergencyAlertAdmin(admin.ModelAdmin):
    list_display = ('title', 'date', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('title', 'body')

@admin.register(BarangaySpotlight)
class BarangaySpotlightAdmin(admin.ModelAdmin):
    list_display = ('barangay', 'achievement', 'score', 'improvement', 'trend')
    list_filter = ('trend',)
    search_fields = ('barangay__name', 'achievement')
