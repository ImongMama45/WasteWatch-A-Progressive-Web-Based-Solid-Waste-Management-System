"""
Exceptions for the WasteWatch Calendar Service.
"""


class CalendarServiceError(Exception):
    """Base exception for all Calendar Service errors."""
    pass


class CalendarDateRangeError(CalendarServiceError):
    """
    Raised when a requested date range is invalid (e.g. inverted)
    or exceeds the maximum allowable limit (93 inclusive calendar days).
    """
    pass


class CalendarCapacityError(CalendarServiceError):
    """
    Raised when active recurring schedule templates exceed the safety capacity
    limit of 100 templates (overflow detected at 101).
    """
    pass

