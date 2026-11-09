"""
Serializers for the WasteWatch Calendar Service API.

Validates query parameters for GET /api/calendar/entries/.
"""

import datetime
from rest_framework import serializers

from accounts.models import Barangay
from .exceptions import CalendarDateRangeError

SUPPORTED_SOURCES = {
    'collection_schedule',
    'municipal_event',
    'news_item',
    'emergency_alert',
    'all',
}

TRUE_BOOLEAN_VALUES = {'true', '1', 't', 'yes'}
FALSE_BOOLEAN_VALUES = {'false', '0', 'f', 'no'}


def parse_strict_boolean(value, field_name, default=False):
    """
    Parses a query parameter value into a strict boolean.
    Rejects malformed values by raising a ValidationError.
    """
    if value is None or value == '':
        return default
    if isinstance(value, bool):
        return value
    val_str = str(value).strip().lower()
    if val_str in TRUE_BOOLEAN_VALUES:
        return True
    if val_str in FALSE_BOOLEAN_VALUES:
        return False
    raise serializers.ValidationError(
        f"Invalid boolean value '{value}' for '{field_name}'. "
        f"Must be true/false, 1/0, t/f, or yes/no."
    )


class CalendarQuerySerializer(serializers.Serializer):
    """
    Validates GET /api/calendar/entries/ query parameters.
    """
    start_date = serializers.DateField(
        required=True,
        input_formats=['%Y-%m-%d'],
        error_messages={
            'required': 'start_date is required (YYYY-MM-DD).',
            'invalid': 'start_date must be in YYYY-MM-DD format.',
        },
    )
    end_date = serializers.DateField(
        required=True,
        input_formats=['%Y-%m-%d'],
        error_messages={
            'required': 'end_date is required (YYYY-MM-DD).',
            'invalid': 'end_date must be in YYYY-MM-DD format.',
        },
    )
    barangay_id = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        default=None,
    )
    source = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        default=None,
    )
    category = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        default=None,
    )
    status = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        default=None,
    )
    include_notices = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        default=None,
    )
    paginate = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        default=None,
    )
    page = serializers.IntegerField(
        required=False,
        default=1,
        min_value=1,
        error_messages={
            'min_value': 'page must be an integer greater than or equal to 1.',
            'invalid': 'page must be a valid integer.',
        },
    )
    page_size = serializers.IntegerField(
        required=False,
        default=20,
        min_value=1,
        max_value=50,
        error_messages={
            'min_value': 'page_size must be at least 1.',
            'max_value': 'page_size cannot exceed 50.',
            'invalid': 'page_size must be a valid integer between 1 and 50.',
        },
    )

    def validate_source(self, value):
        if not value:
            return None
        cleaned = value.strip().lower()
        if cleaned not in SUPPORTED_SOURCES:
            raise serializers.ValidationError(
                f"Unsupported source '{value}'. Supported sources: {', '.join(sorted(SUPPORTED_SOURCES))}."
            )
        return cleaned

    def validate_barangay_id(self, value):
        if not value:
            return None
        cleaned = str(value).strip()
        if cleaned.lower() == 'citywide':
            return 'citywide'
        try:
            b_id = int(cleaned)
        except (ValueError, TypeError):
            raise serializers.ValidationError(f"Invalid barangay_id '{value}'. Must be an integer or 'citywide'.")

        if not Barangay.objects.filter(pk=b_id).exists():
            raise serializers.ValidationError(f"Barangay with id {b_id} does not exist.")
        return b_id

    def validate(self, attrs):
        start_date = attrs['start_date']
        end_date = attrs['end_date']

        if start_date > end_date:
            raise serializers.ValidationError(
                {'date_range': 'Inverted date range: start_date must be on or before end_date.'}
            )

        inclusive_days = (end_date - start_date).days + 1
        if inclusive_days > 93:
            raise serializers.ValidationError(
                {'date_range': f'Requested date range ({inclusive_days} days) exceeds maximum allowed limit of 93 days.'}
            )

        # Parse boolean parameters strictly
        raw_include_notices = attrs.get('include_notices')
        attrs['include_notices'] = parse_strict_boolean(
            raw_include_notices,
            field_name='include_notices',
            default=False,
        )

        raw_paginate = attrs.get('paginate')
        attrs['paginate'] = parse_strict_boolean(
            raw_paginate,
            field_name='paginate',
            default=True,
        )

        # Unpaginated constraints
        if not attrs['paginate']:
            if inclusive_days > 31:
                raise serializers.ValidationError(
                    {'paginate': f'Unpaginated calendar retrieval (?paginate=false) is limited to a maximum of 31 days (requested {inclusive_days} days).'}
                )

        # Clean string filters
        for param in ('category', 'status'):
            val = attrs.get(param)
            if val is not None:
                cleaned = str(val).strip()
                attrs[param] = cleaned if cleaned and cleaned != 'all' else None

        return attrs
