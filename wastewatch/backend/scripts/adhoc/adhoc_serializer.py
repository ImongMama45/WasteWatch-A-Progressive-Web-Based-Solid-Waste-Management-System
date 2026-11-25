import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
django.setup()

from driver.serializers import TruckSerializer
s = TruckSerializer()
print(s.fields.keys())
