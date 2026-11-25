from django.core.management.base import BaseCommand
from django.db import transaction

from notifications.models import Notification, NotificationReadReceipt


class Command(BaseCommand):
    help = "Idempotently backfill read receipts for legacy direct notifications with is_read=True."

    def handle(self, *args, **options):
        # 1. Query direct notifications that were previously marked is_read=True
        direct_read_qs = Notification.objects.filter(
            user__isnull=False,
            is_read=True,
        ).values('id', 'user_id', 'created_at')

        total_direct_read = direct_read_qs.count()
        self.stdout.write(f"Found {total_direct_read} direct notifications with is_read=True.")

        batch_size = 500
        batch = []
        created_count = 0

        # Idempotently create receipts
        with transaction.atomic():
            for item in direct_read_qs.iterator(chunk_size=batch_size):
                batch.append(
                    NotificationReadReceipt(
                        notification_id=item['id'],
                        user_id=item['user_id'],
                        read_at=item['created_at'],
                        is_archived=False,
                    )
                )
                if len(batch) >= batch_size:
                    created = NotificationReadReceipt.objects.bulk_create(batch, ignore_conflicts=True)
                    created_count += len(created)
                    batch = []

            if batch:
                created = NotificationReadReceipt.objects.bulk_create(batch, ignore_conflicts=True)
                created_count += len(created)

        # Confirm shared notifications remain untouched
        shared_receipts_count = NotificationReadReceipt.objects.filter(
            notification__user__isnull=True
        ).count()

        self.stdout.write(
            self.style.SUCCESS(
                f"Backfill complete: processed {total_direct_read} direct read notifications. "
                f"Receipts on shared notifications: {shared_receipts_count} (must be 0)."
            )
        )

