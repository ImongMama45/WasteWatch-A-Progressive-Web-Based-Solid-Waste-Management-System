# Generated manually to add source_report and backfill

from django.db import migrations, models
import django.db.models.deletion

def backfill(apps, schema_editor):
    Hotspot = apps.get_model('watcher', 'GarbageHotspot')
    Report = apps.get_model('watcher', 'GarbageReport')
    import re
    for h in Hotspot.objects.filter(source_report__isnull=True):
        m = re.search(r'Report #(\d+)', h.name or '')
        if m:
            h.source_report = Report.objects.filter(id=int(m.group(1))).first()
            h.save(update_fields=['source_report'])

class Migration(migrations.Migration):

    dependencies = [
        ('watcher', '0017_garbagehotspot_assigned_truck'),
    ]

    operations = [
        migrations.AddField(
            model_name='garbagehotspot',
            name='source_report',
            field=models.ForeignKey(blank=True, help_text='The report that created this hotspot, if any.', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='hotspots', to='watcher.garbagereport'),
        ),
        migrations.RunPython(backfill, reverse_code=migrations.RunPython.noop),
    ]
