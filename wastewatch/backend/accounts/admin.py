"""
accounts/admin.py
-----------------
Register models so they appear in Django's /admin/ panel.
This is where admins can change user roles.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import Barangay, BarangayEstablishment , User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """
    Extend Django's built-in UserAdmin to show our custom fields.
    The 'role' field is intentionally only available here (not in public forms).
    """
    list_display  = ('email', 'full_name', 'role', 'barangay', 'phone_number', 'email_verified', 'created_at')
    list_filter   = ('role', 'email_verified', 'barangay', 'is_active')
    search_fields = ('email', 'full_name', 'phone_number')
    ordering      = ('-created_at',)

    # Show our extra fields in the detail view
    fieldsets = BaseUserAdmin.fieldsets + (
        ('WasteWatch Info', {
            'fields': ('full_name', 'role', 'barangay', 'phone_number', 'address_line', 'email_verified', 'email_verified_at', 'terms_accepted_at')
        }),
    )

    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ('WasteWatch Info', {
            'fields': ('full_name', 'email', 'role', 'barangay', 'phone_number', 'address_line', 'email_verified')
        }),
    )



class EstablishmentInline(admin.TabularInline):
    model  = BarangayEstablishment
    extra  = 1   # Show one blank row by default
    fields = ['name', 'count']

@admin.register(Barangay)
class BarangayAdmin(admin.ModelAdmin):
    list_display  = ['name', 'population']
    inlines       = [EstablishmentInline]
