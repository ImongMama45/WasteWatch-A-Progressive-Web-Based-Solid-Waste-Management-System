from django.test import TestCase
from watcher.models import StopValidationStatus

class StopValidationStatusTests(TestCase):
    def test_stop_validation_status_values(self):
        """
        Ensure all statuses used in views.py are valid enum values.
        This prevents bugs where a string or renamed enum value throws an AttributeError.
        """
        assert hasattr(StopValidationStatus, 'PENDING_INSPECTION')
        assert hasattr(StopValidationStatus, 'READY_FOR_COLLECTION')
        assert hasattr(StopValidationStatus, 'EMPTY_STOP')
        assert hasattr(StopValidationStatus, 'COLLECTION_REPORTED')
        assert hasattr(StopValidationStatus, 'VERIFIED_COLLECTED')
        assert hasattr(StopValidationStatus, 'COLLECTION_DISPUTED')
