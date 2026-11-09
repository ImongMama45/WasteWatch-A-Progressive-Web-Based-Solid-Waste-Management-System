"""
accounts/validators.py
----------------------
Validation and normalization helpers for user account information.
"""

import re
from rest_framework import serializers

# Accepts:
#  - +639171234567
#  - 639171234567
#  - 09171234567
#  - 9171234567
# with optional spaces, dashes, or parentheses
PH_PHONE_REGEX = re.compile(r'^(?:\+?63|0)?9\d{9}$')


def normalize_ph_phone(value: str) -> str:
    """
    Cleans and normalizes a Philippine mobile number into +639XXXXXXXXX format.
    Raises serializers.ValidationError if invalid.
    """
    if not value:
        return ''

    # Strip whitespace, dashes, parens
    cleaned = re.sub(r'[\s\-\(\)\.]', '', str(value).strip())

    if not PH_PHONE_REGEX.match(cleaned):
        raise serializers.ValidationError(
            'Please enter a valid Philippine mobile number (e.g. 09171234567 or +639171234567).'
        )

    # Standardize to +639XXXXXXXXX
    if cleaned.startswith('+63'):
        return cleaned
    elif cleaned.startswith('63'):
        return f'+{cleaned}'
    elif cleaned.startswith('0'):
        return f'+63{cleaned[1:]}'
    elif cleaned.startswith('9'):
        return f'+63{cleaned}'

    return cleaned

