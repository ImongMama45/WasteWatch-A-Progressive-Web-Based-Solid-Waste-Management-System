#!/usr/bin/env bash
# exit on error
set -o errexit

pip install -r requirements.txt

python manage.py collectstatic --no-input
python manage.py migrate

# Automatically seed barangays
python manage.py shell -c "from accounts.models import Barangay; [Barangay.objects.get_or_create(name=n) for n in ['Isabang', 'Gulang-Gulang', 'Ilayang Dupay', 'Kanlurang Mayao', 'Market View', 'Ibabang Dupay']]"

# Seed all demo users for presentation
python manage.py shell -c "
from django.contrib.auth import get_user_model
from accounts.models import Barangay

User = get_user_model()
brgy = Barangay.objects.first()

DEMO_USERS = [
    dict(email='admin@wastewatch.com',   password='Admin@123',   username='demo_admin',   full_name='Demo Admin',           role='admin',         is_staff=True, is_superuser=True),
    dict(email='driver@wastewatch.com',  password='Driver@123',  username='demo_driver',  full_name='Demo Driver',          role='driver'),
    dict(email='watcher@wastewatch.com', password='Watcher@123', username='demo_watcher', full_name='Demo Watcher',         role='watcher'),
    dict(email='citizen@wastewatch.com', password='Citizen@123', username='demo_citizen', full_name='Demo Citizen',         role='citizen'),
    dict(email='official@wastewatch.com',password='Official@123',username='demo_official',full_name='Demo Brgy Official',   role='brgy_official'),
    dict(email='dumpsite@wastewatch.com',password='Dumpsite@123',username='demo_dumpsite',full_name='Demo Dumpsite Operator',role='dumpsite'),
]

for u in DEMO_USERS:
    if not User.objects.filter(email=u['email']).exists():
        is_staff = u.pop('is_staff', False)
        is_superuser = u.pop('is_superuser', False)
        role = u['role']
        user = User(**u)
        user.set_password(u['password'])
        user.is_staff = is_staff
        user.is_superuser = is_superuser
        if role in ('driver', 'watcher', 'brgy_official', 'citizen') and brgy:
            user.barangay = brgy
        user.save()
        print(f'Created {role} user: {u[\"email\"]}')
    else:
        print(f'User already exists: {u[\"email\"]}')
"
