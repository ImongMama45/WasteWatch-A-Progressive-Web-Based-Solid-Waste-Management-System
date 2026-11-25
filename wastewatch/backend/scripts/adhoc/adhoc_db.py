import os
import sys
import django
import traceback

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "wastewatch.settings")
django.setup()

from accounts.models import User

try:
    count = User.objects.count()
    print("SUCCESS! User count:", count)
except Exception as e:
    print("FAILED!")
    traceback.print_exc()
