from django.db import migrations, models


def cleanup_inactive_hotspot_dispatch_state(apps, schema_editor):
    GarbageHotspot = apps.get_model('watcher', 'GarbageHotspot')
    HotspotIntervention = apps.get_model('watcher', 'HotspotIntervention')

    # Ensure all inactive hotspots have clean dispatch state
    inactive_hotspots = GarbageHotspot.objects.filter(is_active=False)
    for hotspot in inactive_hotspots:
        changed = False
        update_fields = []
        if hotspot.assigned_truck_id is not None:
            hotspot.assigned_truck = None
            update_fields.append('assigned_truck')
            changed = True
        if not hotspot.dispatch_acknowledged:
            hotspot.dispatch_acknowledged = True
            update_fields.append('dispatch_acknowledged')
            changed = True
        if hotspot.dispatched_at is not None:
            hotspot.dispatched_at = None
            update_fields.append('dispatched_at')
            changed = True
        if changed:
            hotspot.save(update_fields=update_fields)

        # Cancel any orphan open interventions on inactive hotspots
        HotspotIntervention.objects.filter(
            hotspot=hotspot,
            status__in=['created', 'acknowledged', 'flagged']
        ).update(status='cancelled')


class Migration(migrations.Migration):

    dependencies = [
        ('watcher', '0027_reconcile_inactive_hotspots_and_interventions'),
    ]

    operations = [
        migrations.RunPython(
            cleanup_inactive_hotspot_dispatch_state,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
