import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
django.setup()

from watcher.serializers import GarbageReportSerializer

data = {
    "issue_type": "overflow",
    "severity": "medium",
    "description": "",
    "address": "",
}

serializer = GarbageReportSerializer(data=data)
if not serializer.is_valid():
    print("Validation Errors:", serializer.errors)
else:
    print("Valid!")
