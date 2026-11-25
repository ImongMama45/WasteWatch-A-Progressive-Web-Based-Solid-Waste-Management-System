import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "wastewatch.settings")
django.setup()

from watcher.models import StopValidation
from watcher.views import StopValidationViewSet
import json

# Get the most recently modified StopValidation
val = StopValidation.objects.exclude(post_validation_timestamp__isnull=True).order_by('-post_validation_timestamp').first()
if not val:
    print("No recent validations.")
    exit(0)

class DummyRequest:
    pass

class DummyUser:
    full_name = "Dummy Watcher"

req = DummyRequest()
req.user = DummyUser()

viewset = StopValidationViewSet()
viewset.request = req

try:
    print(f"Testing notify_driver for validation ID {val.id} (Schedule: {val.schedule_id}, Stop: {val.stop_order})")
    viewset._notify_driver(val, "Test message", "Test Status")
    print("Success! No 500 error.")
except Exception as e:
    import traceback
    traceback.print_exc()
