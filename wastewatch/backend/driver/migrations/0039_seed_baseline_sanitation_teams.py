# Data migration to seed baseline Sanitation Teams for WasteWatch
from django.db import migrations


def seed_sanitation_teams(apps, schema_editor):
    SanitationTeam = apps.get_model('driver', 'SanitationTeam')

    base_teams = [
        ('Sanitation Team 1 (Poblacion & City Center)', 'TEAM-01', 'Primary commercial and central district collection team.'),
        ('Sanitation Team 2 (Ilayang Dupay & Ibabang Dupay)', 'TEAM-02', 'High-density residential and arterial road sector.'),
        ('Sanitation Team 3 (Gulang-Gulang)', 'TEAM-03', 'Suburban and institutional sector collection unit.'),
        ('Sanitation Team 4 (Kanlurang Mayao & Silangang Mayao)', 'TEAM-04', 'Highway and industrial corridor response team.'),
        ('Sanitation Team 5 (Market View & Coastal)', 'TEAM-05', 'Public market and waterfront collection operations.'),
        ('Sanitation Team 6 (Isabang & Boundary)', 'TEAM-06', 'Western peripheral zone and transfer station interface.'),
    ]

    for name, code, desc in base_teams:
        SanitationTeam.objects.get_or_create(
            code=code,
            defaults={
                'name': name,
                'description': desc,
                'is_active': True,
            }
        )


def rollback_teams(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('driver', '0038_sanitationteam_sanitationteammembership_and_more'),
    ]

    operations = [
        migrations.RunPython(seed_sanitation_teams, rollback_teams),
    ]

