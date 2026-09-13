from django.db import migrations

def migrate_barangay_strings(apps, schema_editor):
    NewsItem = apps.get_model('news', 'NewsItem')
    Barangay = apps.get_model('accounts', 'Barangay')
    for item in NewsItem.objects.all():
        # Old rows that had a barangay name string are now null (city-wide)
        # If you have a specific mapping need, do it here
        item.barangay = None
        item.save(update_fields=['barangay'])

class Migration(migrations.Migration):
    dependencies = [('news', '0002_newsitem_barangay_fk')]
    operations = [migrations.RunPython(migrate_barangay_strings, migrations.RunPython.noop)]