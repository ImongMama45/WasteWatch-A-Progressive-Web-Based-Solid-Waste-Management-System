"""
accounts/admin.py
-----------------
Register models so they appear in Django's /admin/ panel.
This is where admins can change user roles.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, Barangay


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """
    Extend Django's built-in UserAdmin to show our custom fields.
    The 'role' field is intentionally only available here (not in public forms).
    """
    list_display  = ('email', 'full_name', 'role', 'barangay', 'created_at')
    list_filter   = ('role', 'barangay', 'is_active')
    search_fields = ('email', 'full_name')
    ordering      = ('-created_at',)

    # Show our extra fields in the detail view
    fieldsets = BaseUserAdmin.fieldsets + (
        ('WasteWatch Info', {
            'fields': ('full_name', 'role', 'barangay')
        }),
    )

    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ('WasteWatch Info', {
            'fields': ('full_name', 'email', 'role', 'barangay')
        }),
    )


@admin.register(Barangay)
class BarangayAdmin(admin.ModelAdmin):
    list_display  = ('id', 'name')
    search_fields = ('name',)
