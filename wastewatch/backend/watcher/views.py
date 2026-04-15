"""
watcher/views.py
----------------
Views for the Watcher module.

All views require login. The login_required decorator redirects
unauthenticated users to /accounts/login/.

Views:
  dashboard_view        — summary stats + report list
  submit_report_view    — create a new garbage report
  confirm_collection_view — confirm a truck collection
  report_detail_view    — view a single report
"""

from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db.models import Count

from .models import GarbageReport, CollectionConfirmation, ReportStatus
from .forms  import ReportForm, CollectionConfirmationForm


# ---------------------------------------------------------------------------
# Helper: get counts for the dashboard stat cards
# ---------------------------------------------------------------------------
def _get_report_stats(user):
    """
    Returns a dict of report counts for the logged-in user.
    Separated from the view so it can be reused (e.g., in an API endpoint later).
    """
    base_qs = GarbageReport.objects.filter(user=user)
    return {
        'total':            base_qs.count(),
        'pending_approval': base_qs.filter(status=ReportStatus.PENDING).count(),
        'resolved':         base_qs.filter(status=ReportStatus.RESOLVED).count(),
        'rejected':         base_qs.filter(status=ReportStatus.REJECTED).count(),
    }


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@login_required
def dashboard_view(request):
    """
    Main screen for a Watcher — matches the Home.png design:
      - Stat cards (Total Reports, Pending Approval, Resolved)
      - My Reports list
      - Quick links: Submit Report, Confirm Collection
    """
    user    = request.user
    reports = GarbageReport.objects.filter(user=user).select_related('barangay')[:10]
    stats   = _get_report_stats(user)

    context = {
        'reports': reports,
        'stats':   stats,
        'user':    user,
    }
    return render(request, 'watcher/dashboard.html', context)


# ---------------------------------------------------------------------------
# Submit Report
# ---------------------------------------------------------------------------
@login_required
def submit_report_view(request):
    """
    GET  — Show the report submission form
    POST — Validate and save the report, link it to the current user
    """
    if request.method == 'POST':
        form = ReportForm(request.POST, request.FILES)  # request.FILES for image upload
        if form.is_valid():
            report = form.save(commit=False)
            report.user   = request.user     # Assign the logged-in user
            report.status = ReportStatus.PENDING  # Always starts pending
            report.save()
            messages.success(request, 'Your report has been submitted!')
            return redirect('watcher:dashboard')
    else:
        # Pre-fill barangay if the user has one
        initial = {}
        if request.user.barangay:
            initial['barangay'] = request.user.barangay
        form = ReportForm(initial=initial)

    return render(request, 'watcher/report_form.html', {'form': form})


# ---------------------------------------------------------------------------
# Confirm Collection
# ---------------------------------------------------------------------------
@login_required
def confirm_collection_view(request):
    """
    Watcher confirms that a garbage truck collected waste at a location.
    """
    if request.method == 'POST':
        form = CollectionConfirmationForm(request.POST)
        if form.is_valid():
            confirmation = form.save(commit=False)
            confirmation.confirmed_by = request.user
            confirmation.save()

            # If linked to a report, mark that report as resolved
            if confirmation.report:
                confirmation.report.status = ReportStatus.RESOLVED
                confirmation.report.save()

            messages.success(request, 'Collection confirmed! Thank you.')
            return redirect('watcher:dashboard')
    else:
        form = CollectionConfirmationForm()

    return render(request, 'watcher/confirm_collection.html', {'form': form})


# ---------------------------------------------------------------------------
# Report Detail (read-only)
# ---------------------------------------------------------------------------
@login_required
def report_detail_view(request, report_id):
    """
    Show a single report.  Users can only see their own reports.
    """
    report = get_object_or_404(GarbageReport, id=report_id, user=request.user)
    return render(request, 'watcher/report_detail.html', {'report': report})
