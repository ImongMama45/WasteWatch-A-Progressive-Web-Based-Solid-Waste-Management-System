"""
watcher/urls.py
---------------
URL patterns for the Watcher module.
"""

from django.urls import path
from django.views.generic import RedirectView
from . import views

app_name = 'watcher'

urlpatterns = [
    path('',                    RedirectView.as_view(url='/watcher/dashboard/', permanent=False)),
    path('dashboard/',          views.dashboard_view,          name='dashboard'),
    path('report/submit/',      views.submit_report_view,      name='submit_report'),
    path('report/<int:report_id>/', views.report_detail_view,  name='report_detail'),
    path('collection/confirm/', views.confirm_collection_view, name='confirm_collection'),
]
