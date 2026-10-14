import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
django.setup()

from driver.models import Truck
from driver.serializers import TruckSerializer
from django.contrib.auth import get_user_model

User = get_user_model()

# Create dummy users if not exist
driver, _ = User.objects.get_or_create(username='testdriver', defaults={'role': 'driver'})
crew, _ = User.objects.get_or_create(username='testcrew', defaults={'role': 'crew'})

truck = Truck.objects.first()
if not truck:
    print("No trucks found")
else:
    data = {'drivers': [driver.id], 'crew': [crew.id]}
    s = TruckSerializer(truck, data=data, partial=True)
    if s.is_valid():
        updated_truck = s.save()
        print("Updated drivers:", updated_truck.drivers.all())
        print("Updated crew:", updated_truck.crew.all())
        print("Serializer output drivers:", s.data.get('drivers'))
        print("Serializer output driver_details:", s.data.get('driver_details'))
    else:
        print("Errors:", s.errors)
