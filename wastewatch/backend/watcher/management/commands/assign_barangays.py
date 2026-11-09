from django.core.management.base import BaseCommand
from watcher.models import GarbageReport, GarbageHotspot
from watcher.geofence import resolve_barangay_from_coords, point_in_ring


# Backwards-compatible helpers for any external callers importing from this command
def point_in_polygon(x, y, poly):
    return point_in_ring(x, y, poly)


def point_in_multi_polygon(x, y, multipoly):
    for poly in multipoly:
        if not poly:
            continue
        if point_in_ring(x, y, poly[0]):
            if not any(point_in_ring(x, y, hole) for hole in poly[1:]):
                return True
    return False


class Command(BaseCommand):
    help = 'Assigns or reconciles report barangays strictly from GPS coordinates against Lucena GeoJSON boundaries'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Log intended assignments without saving to the database',
        )
        parser.add_argument(
            '--reconcile-all',
            action='store_true',
            help='Also fix reports whose saved barangay disagrees with their GPS coordinates',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        reconcile_all = options['reconcile_all']

        qs = GarbageReport.objects.exclude(latitude__isnull=True).exclude(longitude__isnull=True).select_related('barangay')
        if not reconcile_all:
            qs = qs.filter(barangay__isnull=True)

        count = 0
        hotspot_count = 0
        for report in qs:
            db_brgy = resolve_barangay_from_coords(report.latitude, report.longitude, create_if_missing=False)
            if db_brgy:
                if report.barangay_id != db_brgy.id:
                    old_name = report.barangay.name if report.barangay else 'None'
                    report.barangay = db_brgy
                    if not dry_run:
                        report.save(update_fields=['barangay'])
                        updated_hs = GarbageHotspot.objects.filter(source_report=report).exclude(barangay=db_brgy).update(barangay=db_brgy)
                        hotspot_count += updated_hs
                    count += 1
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"{'[DRY RUN] ' if dry_run else ''}Report #{report.id}: {old_name} -> {db_brgy.name}"
                        )
                    )
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f"Report #{report.id} ({report.latitude}, {report.longitude}) is outside Lucena City polygons"
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Updated {count} report(s) and {hotspot_count} linked hotspot(s)."
            )
        )
