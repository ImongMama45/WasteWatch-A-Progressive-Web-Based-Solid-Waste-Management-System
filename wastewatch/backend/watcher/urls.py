"""
watcher/urls.py
---------------
Template-based URL routes have been removed.

Watcher functionality is handled exclusively through the JSON API:
  GET/POST /api/watcher/reports/
  GET/PUT  /api/watcher/reports/<id>/
  GET      /api/watcher/stats/
  POST     /api/watcher/confirm/

See wastewatch/api_urls.py for all active routes.
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
    # No template-based routes. All watcher actions go through /api/watcher/*.
]
