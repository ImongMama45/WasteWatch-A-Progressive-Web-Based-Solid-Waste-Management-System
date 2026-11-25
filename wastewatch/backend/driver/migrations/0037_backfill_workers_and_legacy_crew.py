# Generated data migration for WasteWatch Canonical Worker Backfill
from django.db import migrations, models


def backfill_workers(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    Worker = apps.get_model('driver', 'Worker')
    Truck = apps.get_model('driver', 'Truck')
    TruckCrewAssignment = apps.get_model('driver', 'TruckCrewAssignment')
    LegacyCrewReconciliationAudit = apps.get_model('driver', 'LegacyCrewReconciliationAudit')

    # 1. Backfill from accounts.User for drivers, watchers, and registered crew members
    relevant_users = User.objects.filter(
        models.Q(role__in=['driver', 'watcher']) | models.Q(employee_type='crew_member')
    ).order_by('id')

    for user in relevant_users:
        if not Worker.objects.filter(user=user).exists():
            prefix = 'EMP-CREW' if user.employee_type == 'crew_member' else 'EMP'
            emp_id = f"{prefix}-{user.id:04d}"
            # Ensure uniqueness
            counter = 1
            candidate_id = emp_id
            while Worker.objects.filter(employee_id=candidate_id).exists():
                candidate_id = f"{emp_id}-{counter}"
                counter += 1

            full_name = getattr(user, 'full_name', '') or user.username
            Worker.objects.create(
                employee_id=candidate_id,
                full_name=full_name.strip() or f"User {user.id}",
                user=user,
                is_active=user.is_active,
            )

    # 2. Extract legacy unauthenticated crew names from Truck.past_crew_names and TruckCrewAssignment
    prov_seq = 0
    seen_raw_names = set()

    for truck in Truck.objects.exclude(past_crew_names__isnull=True).exclude(past_crew_names=''):
        raw_names_str = truck.past_crew_names or ''
        # Split by comma or newline
        for chunk in raw_names_str.replace('\n', ',').split(','):
            cleaned = chunk.strip()
            if cleaned and cleaned.lower() not in seen_raw_names:
                seen_raw_names.add(cleaned.lower())
                prov_seq += 1
                prov_id = f"PROV-WORKER-{prov_seq:04d}"
                while Worker.objects.filter(employee_id=prov_id).exists():
                    prov_seq += 1
                    prov_id = f"PROV-WORKER-{prov_seq:04d}"

                prov_worker = Worker.objects.create(
                    employee_id=prov_id,
                    full_name=cleaned,
                    user=None,
                    is_active=True,
                )
                LegacyCrewReconciliationAudit.objects.create(
                    provisional_worker=prov_worker,
                    raw_name_string=cleaned,
                    reconciliation_status='PENDING_REVIEW',
                    notes=f"Extracted from Truck {truck.plate_number} past_crew_names. Awaiting administrative verification.",
                )


def reverse_backfill(apps, schema_editor):
    LegacyCrewReconciliationAudit = apps.get_model('driver', 'LegacyCrewReconciliationAudit')
    Worker = apps.get_model('driver', 'Worker')
    LegacyCrewReconciliationAudit.objects.all().delete()
    Worker.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('driver', '0036_worker_legacycrewreconciliationaudit'),
    ]

    operations = [
        migrations.RunPython(backfill_workers, reverse_backfill),
    ]

