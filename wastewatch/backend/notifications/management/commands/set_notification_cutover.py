import json
from datetime import datetime
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from analytics.models import ActivityLog
from notifications.models import Notification, NotificationReceiptCutover


class Command(BaseCommand):
    help = "Set the authoritative notification cutover timestamp for baseline unread calculation."

    def add_arguments(self, parser):
        parser.add_argument(
            '--now',
            action='store_true',
            help='Set cutover timestamp to current time.',
        )
        parser.add_argument(
            '--at',
            type=str,
            help='Set cutover timestamp to explicit ISO-8601 string (e.g. 2026-11-16T12:00:00Z).',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Override existing cutover timestamp or allow timestamp earlier than latest notification.',
        )

    def handle(self, *args, **options):
        use_now = options.get('now')
        at_str = options.get('at')
        force = options.get('force')

        if not use_now and not at_str:
            raise CommandError("Must specify either --now or --at <ISO-TIMESTAMP>.")
        if use_now and at_str:
            raise CommandError("Cannot specify both --now and --at.")

        if use_now:
            target_dt = timezone.now()
        else:
            parsed = parse_datetime(at_str)
            if not parsed:
                try:
                    parsed = datetime.fromisoformat(at_str)
                except ValueError:
                    raise CommandError(f"Invalid ISO-8601 datetime format: {at_str}")
            if timezone.is_naive(parsed):
                target_dt = timezone.make_aware(parsed)
            else:
                target_dt = parsed

        existing = NotificationReceiptCutover.objects.filter(pk=1).first()
        prev_iso = existing.cutover_at.isoformat() if existing else None
        if existing and not force:
            raise CommandError(
                f"Cutover timestamp already exists ({existing.cutover_at.isoformat()}). Use --force to update."
            )

        latest_notif = Notification.objects.order_by('-created_at').first()
        if latest_notif and target_dt < latest_notif.created_at and not force:
            raise CommandError(
                f"Target timestamp ({target_dt.isoformat()}) is earlier than latest notification "
                f"({latest_notif.created_at.isoformat()}). Use --force to override."
            )

        cutover, _ = NotificationReceiptCutover.objects.update_or_create(
            id=1,
            defaults={
                'cutover_at': target_dt,
            }
        )

        # Audit log entry in ActivityLog
        try:
            ActivityLog.objects.create(
                admin=None,
                action='system',
                module='Notifications',
                details=json.dumps({
                    'operation': 'set_notification_cutover',
                    'previous_cutover_at': prev_iso,
                    'new_cutover_at': target_dt.isoformat(),
                    'force': bool(force),
                }),
            )
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"Warning: ActivityLog recording failed: {e}"))

        self.stdout.write(
            self.style.SUCCESS(f"Successfully recorded notification cutover timestamp: {target_dt.isoformat()}")
        )

