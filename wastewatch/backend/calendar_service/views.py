"""
Views for the WasteWatch Calendar Service.

Provides the canonical GET /api/calendar/entries/ public endpoint.
"""

import logging
from rest_framework import permissions, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from .aggregator import aggregate_calendar_entries
from .exceptions import CalendarCapacityError, CalendarDateRangeError, CalendarServiceError
from .serializers import CalendarQuerySerializer

logger = logging.getLogger(__name__)


class CalendarPagination(PageNumberPagination):
    """
    Standard pagination for the Calendar Service.
    - Default page_size: 20
    - Maximum page_size: 50
    - Query parameter: page_size
    """
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 50

    def get_paginated_response(self, data):
        count = self.page.paginator.count
        total_pages = self.page.paginator.num_pages
        current_page = self.page.number
        page_size = self.get_page_size(self.request)

        return Response({
            'count': count,
            'total_pages': total_pages,
            'current_page': current_page,
            'page_size': page_size,
            'next': self.get_next_link(),
            'previous': self.get_previous_link(),
            'results': data,
        })


class CalendarEntryView(APIView):
    """
    GET /api/calendar/entries/

    Aggregated, read-only public endpoint delivering globally sorted, normalized
    calendar entries from CollectionSchedule, MunicipalEvent, and optional notices
    (NewsItem and EmergencyAlert) conforming to Calendar Service Contract v0.2.
    """
    permission_classes = [permissions.AllowAny]
    pagination_class = CalendarPagination

    def get(self, request, *args, **kwargs):
        serializer = CalendarQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        params = serializer.validated_data
        start_date = params['start_date']
        end_date = params['end_date']
        barangay_id = params.get('barangay_id')
        source = params.get('source')
        category = params.get('category')
        status_param = params.get('status')
        include_notices = params.get('include_notices', False)
        paginate = params.get('paginate', True)

        try:
            entries = aggregate_calendar_entries(
                start_date=start_date,
                end_date=end_date,
                user=request.user,
                barangay_id=barangay_id,
                source=source,
                category=category,
                status=status_param,
                include_notices=include_notices,
                paginate=paginate,
            )
        except CalendarCapacityError as exc:
            logger.warning("Calendar capacity limit exceeded: %s", exc)
            return Response(
                {
                    'detail': str(exc),
                    'error': 'capacity_limit_exceeded',
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except CalendarDateRangeError as exc:
            return Response(
                {
                    'detail': str(exc),
                    'error': 'invalid_date_range',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:
            logger.exception("Unexpected server error in calendar entries aggregation: %s", exc)
            return Response(
                {
                    'detail': 'An unexpected server error occurred while retrieving calendar entries.',
                    'error': 'internal_server_error',
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if not paginate:
            return Response({
                'count': len(entries),
                'paginated': False,
                'results': entries,
            })

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(entries, request, view=self)
        if page is not None:
            return paginator.get_paginated_response(page)

        return Response({
            'count': len(entries),
            'paginated': False,
            'results': entries,
        })
