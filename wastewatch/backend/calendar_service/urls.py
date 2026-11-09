"""
URL configuration for the Calendar Service application.

Registers the canonical consolidated public calendar endpoint at /api/calendar/entries/.
"""

from django.urls import path
from .views import CalendarEntryView

app_name = 'calendar_service'

urlpatterns = [
    path('entries/', CalendarEntryView.as_view(), name='calendar-entries'),
]
