from rest_framework import viewsets, permissions, response
from rest_framework.decorators import action
from django.db.models import Count, Sum, Avg, Q, F
from django.utils.dateparse import parse_date
from django.utils import timezone
from datetime import timedelta, datetime

from .models import SystemKPI, TruckPerformance, BarangayPerformance, IssueTrend, ActivityLog
from .serializers import (
    SystemKPISerializer, 
    TruckPerformanceSerializer, 
    BarangayPerformanceSerializer, 
    IssueTrendSerializer,
    ActivityLogSerializer
)

from watcher.models import GarbageReport, ReportStatus, IssueType, GarbageHotspot, Escalation
from driver.models import WasteDelivery, CollectionSchedule, PickupStatus, Truck, DriverShift
from accounts.models import Barangay

from django.http import HttpResponse
import csv

class AnalyticsViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'])
    def export_csv(self, request):
        date_from, date_to = self._get_date_range(request)
        brgy_filter = self._get_barangay_filter(request)
        
        reports = GarbageReport.objects.filter(
            created_at__date__range=[date_from, date_to]
        ).filter(brgy_filter).select_related('barangay', 'user')
        
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="wastewatch_analytics_{date_from}_to_{date_to}.csv"'
        
        writer = csv.writer(response)
        writer.writerow(['ID', 'Timestamp', 'Barangay', 'Category', 'Status', 'Address', 'User'])
        
        for r in reports:
            writer.writerow([
                r.id, 
                r.created_at, 
                r.barangay.name if r.barangay else 'N/A',
                r.issue_type,
                r.status,
                r.address,
                r.user.username if r.user else 'Anonymous'
            ])
            
        return response

    def _get_date_range(self, request):
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        
        if date_from:
            date_from = parse_date(date_from)
        if date_to:
            date_to = parse_date(date_to)
            
        # Default to last 30 days if not provided
        if not date_to:
            date_to = timezone.now().date()
        if not date_from:
            date_from = date_to - timedelta(days=30)
            
        return date_from, date_to

    def _get_barangay_filter(self, request):
        barangay_id = request.query_params.get('barangay_id')
        if barangay_id and barangay_id != 'all':
            return Q(barangay_id=barangay_id)
        return Q()

    def _get_area_filter(self, request):
        area = request.query_params.get('route')
        if area and area != 'All Routes':
            return Q(area=area)
        return Q()

    @action(detail=False, methods=['get'])
    def dashboard(self, request):
        user = request.user
        role = user.role
        date_from, date_to = self._get_date_range(request)
        brgy_filter = self._get_barangay_filter(request)
        area_filter = self._get_area_filter(request)
        
        # Base querysets with date filters
        reports_qs = GarbageReport.objects.filter(created_at__date__range=[date_from, date_to]).filter(brgy_filter)
        deliveries_qs = WasteDelivery.objects.filter(date__range=[date_from, date_to]).filter(brgy_filter)
        schedules_qs = CollectionSchedule.objects.filter(date__range=[date_from, date_to]).filter(brgy_filter).filter(area_filter)
        
        # If filtering by area, also filter deliveries linked to those schedules
        if area_filter:
            deliveries_qs = deliveries_qs.filter(schedule__area=request.query_params.get('route'))

        data = {
            'filters': {
                'date_from': date_from,
                'date_to': date_to,
                'barangay_id': request.query_params.get('barangay_id', 'all')
            },
            'summary': {},
            'charts': {},
            'insights': []
        }

        # 1. GENERAL STATS (Common for many roles)
        total_reports = reports_qs.count()
        resolved_reports = reports_qs.filter(status=ReportStatus.RESOLVED).count()
        pending_reports = reports_qs.filter(status=ReportStatus.PENDING).count()
        rejected_reports = reports_qs.filter(status=ReportStatus.REJECTED).count()
        
        res_rate = (resolved_reports / total_reports * 100) if total_reports > 0 else 0
        
        data['summary'] = {
            'total_reports': total_reports,
            'resolved_reports': resolved_reports,
            'pending_reports': pending_reports,
            'rejected_reports': rejected_reports,
            'resolution_rate': round(res_rate, 1),
        }

        # 2. ROLE-SPECIFIC ANALYTICS
        if role == 'citizen':
            # Contribution score (placeholder logic: 10 pts per resolved report)
            user_reports = reports_qs.filter(user=user)
            data['summary']['my_reports'] = user_reports.count()
            data['summary']['my_resolved'] = user_reports.filter(status=ReportStatus.RESOLVED).count()
            data['summary']['participation_score'] = data['summary']['my_resolved'] * 10
            
            # Community Trends
            data['trends'] = {
                'top_category': reports_qs.values('issue_type').annotate(count=Count('id')).order_by('-count').first(),
                'top_location': reports_qs.values('address').annotate(count=Count('id')).order_by('-count').first(),
            }

        elif role == 'driver':
            # Collection Performance
            completed_pickups = PickupStatus.objects.filter(
                schedule__in=schedules_qs, 
                status='COMPLETED'
            ).count()
            total_pickups = PickupStatus.objects.filter(schedule__in=schedules_qs).count()
            
            data['summary'].update({
                'total_trips': schedules_qs.count(),
                'completed_routes': schedules_qs.filter(status='COMPLETED').count(),
                'waste_collected_kg': float(deliveries_qs.aggregate(total=Sum('net_weight'))['total'] or 0),
                'completion_rate': round((completed_pickups / total_pickups * 100), 1) if total_pickups > 0 else 0
            })

        elif role == 'watcher':
            # Validation Stats
            reviewed_count = reports_qs.filter(status__in=[ReportStatus.APPROVED, ReportStatus.REJECTED, ReportStatus.RESOLVED]).count()
            data['summary'].update({
                'reports_reviewed': reviewed_count,
                'approvals': reports_qs.filter(status=ReportStatus.APPROVED).count(),
                'rejections': rejected_reports,
            })

        elif role == 'brgy_official' or role == 'admin':
            # Hotspot Monitoring
            hotspots = GarbageHotspot.objects.filter(brgy_filter)
            data['summary']['active_hotspots'] = hotspots.count()
            
            # Escalations
            escalations = Escalation.objects.filter(brgy_filter, created_at__date__range=[date_from, date_to])
            data['summary']['escalations_total'] = escalations.count()
            data['summary']['escalations_resolved'] = escalations.filter(status='resolved').count()

            if role == 'admin':
                # City-Wide Totals
                from django.contrib.auth import get_user_model
                User = get_user_model()
                data['summary'].update({
                    'total_users': User.objects.count(),
                    'total_drivers': User.objects.filter(role='driver').count(),
                    'total_watchers': User.objects.filter(role='watcher').count(),
                    'total_officials': User.objects.filter(role='brgy_official').count(),
                })

        # 3. PERFORMANCE DATA (Fleet & Barangay Rankings)
        # Fleet (Truck) Performance
        trucks_perf = Truck.objects.annotate(
            routes_count=Count('schedules', filter=Q(schedules__date__range=[date_from, date_to]), distinct=True),
            completed_count=Count('schedules', filter=Q(schedules__date__range=[date_from, date_to], schedules__status='COMPLETED'), distinct=True),
            missed_count=Count('schedules', filter=Q(schedules__date__range=[date_from, date_to], schedules__status='CANCELLED'), distinct=True),
            total_kg=Sum('deliveries__net_weight', filter=Q(deliveries__date__range=[date_from, date_to])),
            avg_fill=Avg('current_capacity') # Current snapshot as proxy for performance
        ).values('plate_number', 'driver__full_name', 'routes_count', 'completed_count', 'missed_count', 'total_kg', 'avg_fill')
        data['fleet'] = list(trucks_perf)

        # Barangay Performance (Leaderboard)
        brgy_perf = Barangay.objects.annotate(
            reports_count=Count('reports', filter=Q(reports__created_at__date__range=[date_from, date_to]), distinct=True),
            resolved_count=Count('reports', filter=Q(reports__created_at__date__range=[date_from, date_to], reports__status=ReportStatus.RESOLVED), distinct=True),
            total_kg=Sum('waste_deliveries__net_weight', filter=Q(waste_deliveries__date__range=[date_from, date_to]))
        ).values('name', 'reports_count', 'resolved_count', 'total_kg')
        data['barangays'] = list(brgy_perf)

        # Map Data (Barangay Scores & Hotspots)
        map_stats = Barangay.objects.annotate(
            h_count=Count('hotspots', distinct=True)
        ).values('name', 'h_count')
        
        # Calculate scores manually from brgy_perf for consistency
        brgy_scores = { b['name']: 0 for b in map_stats }
        for b in brgy_perf:
            if b['reports_count'] > 0:
                brgy_scores[b['name']] = round((b['resolved_count'] / b['reports_count']) * 100)
            else:
                brgy_scores[b['name']] = 100 # Perfect score if no reports? Or 0? Let's say 100.
        
        data['map_data'] = {
            m['name']: {
                'score': brgy_scores.get(m['name'], 100),
                'hotspots': m['h_count']
            } for m in map_stats
        }

        # 4. CHARTS DATA
        # Report Trend (Daily)
        trend_data = reports_qs.extra(select={'day': "date(created_at)"}).values('day').annotate(count=Count('id')).order_by('day')
        data['charts']['report_trend'] = list(trend_data)
        
        # Waste Category Breakdown
        category_data = reports_qs.values('issue_type').annotate(value=Count('id'))
        data['charts']['waste_categories'] = list(category_data)

        # Barangay Comparison (for Admin)
        if role == 'admin':
            brgy_comparison = Barangay.objects.annotate(
                report_count=Count('reports', filter=Q(reports__created_at__date__range=[date_from, date_to])),
                res_rate=Avg(
                    F('reports__status') == ReportStatus.RESOLVED, 
                    filter=Q(reports__created_at__date__range=[date_from, date_to])
                )
            ).values('name', 'report_count', 'res_rate').order_by('-report_count')
            data['charts']['barangay_comparison'] = list(brgy_comparison)

        # 4. DYNAMIC INSIGHTS ENGINE (Basic Logic)
        self._generate_insights(data, reports_qs, date_from, date_to)

        return response.Response(data)

    def _generate_insights(self, data, reports_qs, date_from, date_to):
        # Comparison with previous period
        days_diff = (date_to - date_from).days
        prev_date_from = date_from - timedelta(days=days_diff)
        
        prev_reports = GarbageReport.objects.filter(
            created_at__date__range=[prev_date_from, date_from]
        )
        if data['filters']['barangay_id'] != 'all':
            prev_reports = prev_reports.filter(barangay_id=data['filters']['barangay_id'])
            
        curr_count = reports_qs.count()
        prev_count = prev_reports.count()
        
        if prev_count > 0:
            change = ((curr_count - prev_count) / prev_count) * 100
            trend = "increased" if change > 0 else "decreased"
            data['insights'].append(f"Waste reports {trend} by {abs(round(change, 1))}% compared to previous period.")
        
        top_cat = reports_qs.values('issue_type').annotate(count=Count('id')).order_by('-count').first()
        if top_cat:
            data['insights'].append(f"{top_cat['issue_type'].replace('_', ' ').title()} is the most common issue in this period.")

        res_rate = data['summary']['resolution_rate']
        if res_rate > 80:
            data['insights'].append("Excellent resolution rate achieved this period.")
        elif res_rate < 30 and curr_count > 5:
            data['insights'].append("Resolution rate is low; attention required for pending reports.")

class SystemKPIViewSet(viewsets.ModelViewSet):
    queryset = SystemKPI.objects.all()
    serializer_class = SystemKPISerializer

class TruckPerformanceViewSet(viewsets.ModelViewSet):
    queryset = TruckPerformance.objects.all()
    serializer_class = TruckPerformanceSerializer

class BarangayPerformanceViewSet(viewsets.ModelViewSet):
    queryset = BarangayPerformance.objects.all()
    serializer_class = BarangayPerformanceSerializer

class IssueTrendViewSet(viewsets.ModelViewSet):
    queryset = IssueTrend.objects.all()
    serializer_class = IssueTrendSerializer

class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ActivityLog.objects.all().order_by('-timestamp')
    serializer_class = ActivityLogSerializer
    permission_classes = [permissions.IsAuthenticated]
