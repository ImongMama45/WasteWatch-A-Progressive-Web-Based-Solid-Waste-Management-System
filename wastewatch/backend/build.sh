#!/usr/bin/env bash
# exit on error
set -o errexit

pip install -r requirements.txt

python manage.py collectstatic --no-input
python manage.py migrate

# Automatically seed barangays
python manage.py shell -c "from accounts.models import Barangay; [Barangay.objects.get_or_create(name=n) for n in ['Isabang', 'Gulang-Gulang', 'Ilayang Dupay', 'Kanlurang Mayao', 'Market View', 'Ibabang Dupay']]"

# Automatically create a default admin account if it doesn't exist
python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); User.objects.filter(email='admin@example.com').exists() or User.objects.create_superuser(email='admin@example.com', password='adminpassword123', username='admin', full_name='System Admin', role='admin')"
