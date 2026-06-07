from django.core.management.base import BaseCommand
from driver.models import CollectionSchedule


class Command(BaseCommand):
    help = "Backfill PickupStatus rows for schedules that already have waypoints."

    def add_arguments(self, parser):
        parser.add_argument(
            '--schedule-id',
            type=int,
            help='Only rebuild pickup statuses for a single schedule.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what would be rebuilt without saving changes.',
        )

    def handle(self, *args, **options):
        qs = CollectionSchedule.objects.select_related('driver', 'truck').prefetch_related('barangays')
        schedule_id = options.get('schedule_id')
        if schedule_id:
            qs = qs.filter(id=schedule_id)

        total = 0
        rebuilt = 0

        for schedule in qs.iterator():
            total += 1
            waypoint_count = len(schedule.waypoints or [])
            if waypoint_count <= 1:
                self.stdout.write(
                    self.style.WARNING(
                        f'Schedule {schedule.id}: skipped (no collection stops)'
                    )
                )
                continue

            stop_count = waypoint_count - 1
            if options['dry_run']:
                self.stdout.write(
                    f'Schedule {schedule.id}: would sync {stop_count} stop(s) '
                    f'for driver={schedule.driver_id}'
                )
            else:
                schedule.sync_pickup_statuses()
                self.stdout.write(
                    self.style.SUCCESS(
                        f'Schedule {schedule.id}: synced {stop_count} stop(s)'
                    )
                )
                rebuilt += 1

        if options['dry_run']:
            self.stdout.write(self.style.NOTICE(f'Dry run complete for {total} schedule(s).'))
        else:
            self.stdout.write(self.style.SUCCESS(
                f'Backfill complete. Rebuilt {rebuilt} schedule(s) out of {total} scanned.'
            ))
