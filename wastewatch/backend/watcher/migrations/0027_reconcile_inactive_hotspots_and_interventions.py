from django.db import migrations, models


def reconcile_inactive_hotspots_and_interventions(apps, schema_editor):
    GarbageHotspot = apps.get_model('watcher', 'GarbageHotspot')
    HotspotIntervention = apps.get_model('watcher', 'HotspotIntervention')

    # Reconcile historical hotspots linked to resolved, rejected, or archived reports
    retired_hotspots = GarbageHotspot.objects.filter(
        models.Q(source_report__status__in=['resolved', 'rejected']) |
        models.Q(source_report__is_archived=True)
    )

    for hotspot in retired_hotspots:
        hotspot.is_active = False
        hotspot.assigned_truck = None
        hotspot.dispatch_acknowledged = False
        hotspot.dispatched_at = None
        hotspot.save(update_fields=['is_active', 'assigned_truck', 'dispatch_acknowledged', 'dispatched_at'])

        # Neutralize active interventions; preserve completed/collected records
        HotspotIntervention.objects.filter(
            hotspot=hotspot,
            status__in=['created', 'acknowledged', 'flagged']
        ).update(status='cancelled')


def reverse_reconcile(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('watcher', '0026_garbagehotspot_is_active_garbagereport_resolved_at_and_more'),
    ]

    operations = [
        migrations.RunPython(
            reconcile_inactive_hotspots_and_interventions,
            reverse_code=reverse_reconcile,
        ),
    ]
