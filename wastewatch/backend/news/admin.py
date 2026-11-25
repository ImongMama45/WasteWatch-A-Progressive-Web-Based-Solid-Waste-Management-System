from django.contrib import admin
from django.db import transaction
from .models import NewsItem, EmergencyAlert, BarangaySpotlight
from notifications.services import update_emergency_alert

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

    def save_model(self, request, obj, form, change):
        with transaction.atomic():
            if not change:
                # Creation: persist inactive first, then activate if requested
                requested_active = form.cleaned_data.get('is_active', True)
                obj.is_active = False
                super().save_model(request, obj, form, change)
                if requested_active:
                    updated_instance = update_emergency_alert(
                        alert_pk=obj.pk,
                        actor=request.user,
                        validated_fields={'is_active': True}
                    )
                    obj.is_active = updated_instance.is_active
            else:
                # Update: route all form cleaned_data through lock-first lifecycle service
                updated_instance = update_emergency_alert(
                    alert_pk=obj.pk,
                    actor=request.user,
                    validated_fields=form.cleaned_data
                )
                # Rebind model attributes on obj so admin display matches persisted locked row
                for field in ['title', 'body', 'is_active']:
                    if hasattr(updated_instance, field):
                        setattr(obj, field, getattr(updated_instance, field))

@admin.register(BarangaySpotlight)
class BarangaySpotlightAdmin(admin.ModelAdmin):
    list_display = ('barangay', 'achievement', 'score', 'improvement', 'trend')
    list_filter = ('trend',)
    search_fields = ('barangay__name', 'achievement')
