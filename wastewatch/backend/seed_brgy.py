import os
import django
import json

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
django.setup()

from accounts.models import Barangay

b = Barangay.objects.filter(name__icontains='Dupay').first()
if b:
    b.latitude = 13.9333
    b.longitude = 121.6167
    b.boundary_geojson = {
        "type": "Polygon",
        "coordinates": [[[121.61, 13.93], [121.62, 13.93], [121.62, 13.94], [121.61, 13.94], [121.61, 13.93]]]
    }
    b.save()
    print("Seeded", b.name)
else:
    print("No barangay found")
