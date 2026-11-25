import datetime
import json
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Barangay, User, UserRole
from driver.models import Truck, CollectionSchedule, SanitationTeam
from dumpsite.models import Dumpsite
from notifications.models import Notification, NotificationType
from analytics.models import ActivityLog
from notifications.services import (
    create_collection_schedule,
    update_collection_schedule,
    capture_schedule_snapshot,
    process_schedule_lifecycle_change,
)


class Phase3CollectionScheduleLifecycleTests(TestCase):
    """
    Focused verification tests for CollectionSchedule notification lifecycle (Phase 3).
    Ensures resident notifications are emitted reliably for meaningful changes,
    suppressed for internal operational/metadata edits, and protected against duplicates.
    """

    def setUp(self):
        self.b1 = Barangay.objects.create(name='Barangay Uno')
        self.b2 = Barangay.objects.create(name='Barangay Dos')
        self.b3 = Barangay.objects.create(name='Barangay Tres')

        self.truck1 = Truck.objects.create(plate_number='TRK-101', status='active')
        self.truck2 = Truck.objects.create(plate_number='TRK-102', status='active')

        self.driver1 = User.objects.create_user(
            username='driver_one',
            email='driver1@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
            barangay=self.b1,
        )
        self.truck1.drivers.add(self.driver1)

        self.driver2 = User.objects.create_user(
            username='driver_two',
            email='driver2@example.com',
            password='Password123!',
            role=UserRole.DRIVER,
            barangay=self.b2,
        )
        self.truck2.drivers.add(self.driver2)

        self.admin = User.objects.create_user(
            username='admin_user',
            email='admin@example.com',
            password='Password123!',
            role=UserRole.ADMIN,
            is_staff=True,
        )

        self.dumpsite1 = Dumpsite.objects.create(
            name='Central Eco-Park',
            latitude=13.9311,
            longitude=121.6172,
            barangay=self.b1,
        )
        self.dumpsite2 = Dumpsite.objects.create(
            name='North Transfer Station',
            latitude=13.9450,
            longitude=121.6250,
            barangay=self.b2,
        )

        self.team1 = SanitationTeam.objects.create(
            name='Alpha Sanitation Team',
            code='TEAM-ALPHA',
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    # ── Test 1: Schedule Publication ─────────────────────────────────────────
    def test_01_schedule_publication_notifies_affected_barangays(self):
        """
        Verify creating an active schedule with barangays dispatches a publication
        notification to each affected barangay and logs an ActivityLog entry.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'frequency': 'Weekly',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id, self.b2.id],
            actor=self.admin,
        )

        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        self.assertEqual(notifs.count(), 2)

        b1_notif = notifs.filter(barangay=self.b1).first()
        self.assertIsNotNone(b1_notif)
        self.assertEqual(b1_notif.title, 'Collection Schedule Published')
        self.assertIn('Barangay Uno', b1_notif.message)
        self.assertIn('Days: Mon, Wed', b1_notif.message)
        self.assertIn('8:00 AM', b1_notif.message)
        # Invariant: No internal driver or truck leak
        self.assertNotIn('TRK-101', b1_notif.message)
        self.assertNotIn('driver_one', b1_notif.message)

        b2_notif = notifs.filter(barangay=self.b2).first()
        self.assertIsNotNone(b2_notif)
        self.assertEqual(b2_notif.title, 'Collection Schedule Published')

        # Broadcast ID is shared across the batch
        self.assertEqual(b1_notif.broadcast_id, b2_notif.broadcast_id)

        # Audit log verification
        log = ActivityLog.objects.filter(module='CollectionSchedule', action='create').first()
        self.assertIsNotNone(log)
        details = json.loads(log.details)
        self.assertEqual(details['operation'], 'schedule_publish')
        self.assertEqual(details['schedule_id'], schedule.pk)

    # ── Test 2: Cancellation and Reinstatement ────────────────────────────────
    def test_02_cancellation_and_reinstatement_send_correct_notifications(self):
        """
        Verify cancelling an active schedule sends cancellation notifications,
        and reinstating it sends reinstatement notifications.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # 1. Cancel schedule
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'status': 'CANCELLED'},
            actor=self.admin,
        )
        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        self.assertEqual(notifs.count(), 1)
        cancel_notif = notifs.first()
        self.assertEqual(cancel_notif.title, 'Collection Schedule Cancelled')
        self.assertEqual(cancel_notif.barangay, self.b1)
        self.assertIn('cancelled until further notice', cancel_notif.message)

        Notification.objects.all().delete()

        # 2. Reinstate schedule
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'status': 'PENDING'},
            actor=self.admin,
        )
        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        self.assertEqual(notifs.count(), 1)
        reinstate_notif = notifs.first()
        self.assertEqual(reinstate_notif.title, 'Collection Schedule Reinstated')
        self.assertEqual(reinstate_notif.barangay, self.b1)
        self.assertIn('reinstated', reinstate_notif.message)

    # ── Test 3: Barangay Additions and Removals ───────────────────────────────
    def test_03_barangay_additions_and_removals_target_only_affected_residents(self):
        """
        Verify that changing schedule barangay coverage:
        - Notifies newly added barangay of publication.
        - Notifies removed barangay of removal.
        - DOES NOT notify retained barangay if schedule details did not change.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id, self.b2.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # Update barangays: keep b2, remove b1, add b3
        update_collection_schedule(
            schedule_pk=schedule.pk,
            barangay_ids=[self.b2.id, self.b3.id],
            actor=self.admin,
        )

        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        # Exactly 2 notifications: 1 for added (b3), 1 for removed (b1)
        self.assertEqual(notifs.count(), 2)

        # Added notification
        b3_notif = notifs.filter(barangay=self.b3).first()
        self.assertIsNotNone(b3_notif)
        self.assertEqual(b3_notif.title, 'Collection Schedule Published')
        self.assertIn('Barangay Tres', b3_notif.message)

        # Removed notification
        b1_notif = notifs.filter(barangay=self.b1).first()
        self.assertIsNotNone(b1_notif)
        self.assertEqual(b1_notif.title, 'Collection Schedule Removed')
        self.assertIn('Barangay Uno', b1_notif.message)
        self.assertIn('no longer covers', b1_notif.message)

        # Retained barangay (b2) received zero notifications
        self.assertFalse(notifs.filter(barangay=self.b2).exists())

    # ── Test 4: Collection Day and Date Changes ───────────────────────────────
    def test_04_collection_day_and_date_changes_dispatch_correctly(self):
        """
        Verify changes to recurring collection days or one-time collection date
        notify retained barangays, while cosmetic reordering of days does not.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # 1. Cosmetic reordering 'Mon, Wed' -> 'Wed, Mon' should NOT dispatch
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'days': 'Wed, Mon'},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 0)

        # 2. Actual day change 'Mon, Wed' -> 'Tue, Thu' DOES dispatch
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'days': 'Tue, Thu'},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(Notification.objects.first().title, 'Collection Schedule Updated')
        self.assertIn('Days: Tue, Thu', Notification.objects.first().message)

        Notification.objects.all().delete()

        # 3. One-time schedule date change
        schedule.date = datetime.date(2026, 11, 20)
        schedule.save()
        Notification.objects.all().delete()

        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'date': datetime.date(2026, 11, 25)},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(Notification.objects.first().title, 'Collection Schedule Updated')
        self.assertIn('Nov 25, 2026', Notification.objects.first().message)

    # ── Test 5: Start-Time Changes (<30m suppressed, >=30m notified) ─────────
    def test_05_start_time_threshold_guards(self):
        """
        Verify that start time shifts under 30 minutes generate no notification,
        while shifts of 30 minutes or greater generate a notification.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # 1. Shift by 15 minutes (08:00 -> 08:15) -> Suppressed
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'start_time': datetime.time(8, 15)},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 0)

        # 2. Shift by 29 minutes from initial 08:00 (08:15 -> 08:29) -> 14m delta -> Suppressed
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'start_time': datetime.time(8, 29)},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 0)

        # 3. Shift by 31 minutes (08:29 -> 09:00) -> 31m delta -> Notified!
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'start_time': datetime.time(9, 0)},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(Notification.objects.first().title, 'Collection Schedule Updated')
        self.assertIn('9:00 AM', Notification.objects.first().message)

    # ── Test 6: Frequency Changes vs Irrelevant Metadata ─────────────────────
    def test_06_frequency_changes_notify_irrelevant_metadata_does_not(self):
        """
        Verify meaningful frequency changes notify, while administrative metadata
        (area label, end_time) does not notify residents.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'frequency': 'Weekly',
                'area': 'Zone A',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # 1. Administrative area label edit -> No notification
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'area': 'Zone A - Administrative Tag'},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 0)

        # 2. Internal end_time edit -> No notification
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'end_time': datetime.time(13, 0)},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 0)

        # 3. Meaningful frequency change ('Weekly' -> 'Bi-weekly') -> Notified!
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'frequency': 'Bi-weekly'},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(Notification.objects.first().title, 'Collection Schedule Updated')
        self.assertIn('Bi-weekly', Notification.objects.first().message)

    # ── Test 7: Internal Operations Excluded ──────────────────────────────────
    def test_07_internal_operational_assignments_do_not_notify(self):
        """
        Verify that internal operational assignments (truck, driver, dumpsite,
        sanitation team) do not send resident notifications.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # 1. Truck reassignment
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'truck': self.truck2},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 0)

        # 2. Driver reassignment
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'driver': self.driver2},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 0)

        # 3. Dumpsite allocation
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'dumpsite': self.dumpsite1},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 0)

        # 4. Sanitation Team assignment
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'default_team': self.team1},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.count(), 0)

    # ── Test 8: Repeated Unchanged Saves Do Not Duplicate ─────────────────────
    def test_08_repeated_unchanged_saves_do_not_duplicate_notifications(self):
        """
        Verify that repeated saves or updates with identical data produce zero notifications.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'frequency': 'Weekly',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        for _ in range(5):
            update_collection_schedule(
                schedule_pk=schedule.pk,
                validated_fields={
                    'start_time': datetime.time(8, 0),
                    'end_time': datetime.time(12, 0),
                    'days': 'Mon, Wed',
                    'frequency': 'Weekly',
                    'status': 'PENDING',
                },
                barangay_ids=[self.b1.id],
                actor=self.admin,
            )

        self.assertEqual(Notification.objects.count(), 0)

    # ── Test 9: Dispatch Failure Rolls Back Changes ───────────────────────────
    def test_09_dispatch_failure_rolls_back_schedule_and_notifications(self):
        """
        Verify that an unhandled failure during notification creation rolls back
        the schedule mutation and any associated notifications in the atomic block.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        with patch('notifications.models.Notification.objects.create', side_effect=RuntimeError('Database write failure')):
            with self.assertRaises(RuntimeError):
                update_collection_schedule(
                    schedule_pk=schedule.pk,
                    validated_fields={'days': 'Fri, Sun', 'status': 'CANCELLED'},
                    actor=self.admin,
                )

        schedule.refresh_from_db()
        # Days and status must remain rolled back to original values
        self.assertEqual(schedule.days, 'Mon, Wed')
        self.assertEqual(schedule.status, 'PENDING')
        self.assertEqual(Notification.objects.count(), 0)

    # ── Test 10: DRF Write Paths and Automated Watcher Integration ────────────
    def test_10_drf_write_paths_and_automated_watcher_integration(self):
        """
        Verify DRF POST, PATCH, and DELETE endpoints, plus automated watcher signal
        routes trigger lifecycle handling properly.
        """
        # 1. DRF POST create
        create_payload = {
            'truck': self.truck1.id,
            'driver': self.driver1.id,
            'start_time': '08:00:00',
            'end_time': '12:00:00',
            'days': 'Mon, Wed',
            'status': 'PENDING',
            'barangays': [self.b1.id],
        }
        res_create = self.client.post('/api/driver/collection-schedules/', data=create_payload, format='json')
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        sched_id = res_create.data['id']

        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        self.assertEqual(notifs.count(), 1)
        self.assertEqual(notifs.first().title, 'Collection Schedule Published')
        Notification.objects.all().delete()

        # 2. DRF PATCH start_time shift >= 30m
        patch_payload = {'start_time': '09:00:00'}
        res_patch = self.client.patch(f'/api/driver/collection-schedules/{sched_id}/', data=patch_payload, format='json')
        self.assertEqual(res_patch.status_code, status.HTTP_200_OK)

        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        self.assertEqual(notifs.count(), 1)
        self.assertEqual(notifs.first().title, 'Collection Schedule Updated')
        Notification.objects.all().delete()

        # 3. DRF DELETE schedule
        res_del = self.client.delete(f'/api/driver/collection-schedules/{sched_id}/')
        self.assertEqual(res_del.status_code, status.HTTP_204_NO_CONTENT)

        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        self.assertEqual(notifs.count(), 1)
        self.assertEqual(notifs.first().title, 'Collection Schedule Cancelled')
        Notification.objects.all().delete()

        # 4. Automated Route creation (watcher automation path)
        sched_auto = CollectionSchedule.objects.create(
            truck=self.truck1,
            driver=self.driver1,
            area=f"Automated Route - {self.b2.name}",
            start_time="08:00:00",
            end_time="12:00:00",
            date=timezone.localdate(),
            status='PENDING'
        )
        sched_auto.barangays.add(self.b2)
        process_schedule_lifecycle_change(before_snapshot=None, after_schedule=sched_auto)

        auto_notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE, barangay=self.b2)
        self.assertEqual(auto_notifs.count(), 1)
        self.assertEqual(auto_notifs.first().title, 'Collection Schedule Published')

    # ── Test 11: Unavailable to Available Transition ─────────────────────────
    def test_11_unavailable_to_available_transition(self):
        """
        Verify False -> True availability transition notifies affected barangays
        that collection is available.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
                'is_available': False,
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        # Because initially is_available=False, no notification was sent to residents
        self.assertEqual(Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE).count(), 0)

        # Transition False -> True
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'is_available': True},
            actor=self.admin,
        )

        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        self.assertEqual(notifs.count(), 1)
        notif = notifs.first()
        self.assertEqual(notif.barangay, self.b1)
        self.assertIn(notif.title, ('Collection Schedule Reinstated', 'Collection Schedule Published'))
        self.assertIn('Barangay Uno', notif.message)

        # Invariant: Availability changed to True, but operational status remained PENDING
        schedule.refresh_from_db()
        self.assertTrue(schedule.is_available)
        self.assertEqual(schedule.status, 'PENDING')

    # ── Test 12: Available to Unavailable Transition ─────────────────────────
    def test_12_available_to_unavailable_transition(self):
        """
        Verify True -> False availability transition notifies previously affected
        barangays that collection is no longer available.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
                'is_available': True,
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # Transition True -> False
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'is_available': False},
            actor=self.admin,
        )

        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        self.assertEqual(notifs.count(), 1)
        notif = notifs.first()
        self.assertEqual(notif.barangay, self.b1)
        self.assertEqual(notif.title, 'Collection Schedule Cancelled')
        self.assertIn('cancelled until further notice', notif.message)

        # Invariant: Availability changed to False, but operational status remained PENDING
        schedule.refresh_from_db()
        self.assertFalse(schedule.is_available)
        self.assertEqual(schedule.status, 'PENDING')

    # ── Test 13: Unchanged Availability (No Notification) ───────────────────
    def test_13_unchanged_availability_no_notification(self):
        """
        Verify unchanged availability (False -> False, or True -> True without
        resident-facing operational edits) generates ZERO notifications.
        """
        # 1. False -> False: editing an unavailable schedule
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'CANCELLED',
                'is_available': False,
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # Update while remaining unavailable
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'start_time': datetime.time(9, 30), 'days': 'Tue, Thu'},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE).count(), 0)

        # 2. True -> True: editing internal operational metadata on an active schedule
        schedule_active = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
            },
            barangay_ids=[self.b2.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # Update only truck/driver/dumpsite (unchanged availability and unchanged resident-facing fields)
        update_collection_schedule(
            schedule_pk=schedule_active.pk,
            validated_fields={'truck': self.truck2, 'driver': self.driver2},
            actor=self.admin,
        )
        self.assertEqual(Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE).count(), 0)

    # ── Test 14: Combined Status and Availability (No Duplicates) ───────────
    def test_14_combined_status_and_availability_transition_does_not_dispatch_duplicates(self):
        """
        Verify simultaneous status and availability changes produce exactly ONE
        notification per affected barangay for that single lifecycle operation.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id, self.b2.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()
        ActivityLog.objects.all().delete()

        # Simultaneous change to unavailable: status='CANCELLED' and is_available=False
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'status': 'CANCELLED', 'is_available': False},
            actor=self.admin,
        )

        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        # Exactly 2 notifications (one for b1, one for b2), NOT 4!
        self.assertEqual(notifs.count(), 2)
        b1_notif = notifs.filter(barangay=self.b1).first()
        b2_notif = notifs.filter(barangay=self.b2).first()
        self.assertIsNotNone(b1_notif)
        self.assertIsNotNone(b2_notif)
        self.assertEqual(b1_notif.title, 'Collection Schedule Cancelled')
        self.assertEqual(b2_notif.title, 'Collection Schedule Cancelled')
        self.assertEqual(b1_notif.broadcast_id, b2_notif.broadcast_id)
        # Single activity log operation
        logs = ActivityLog.objects.filter(module='CollectionSchedule', action='update')
        self.assertEqual(logs.count(), 1)

        Notification.objects.all().delete()
        ActivityLog.objects.all().delete()

        # Simultaneous change to available: status='PENDING' and is_available=True
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'status': 'PENDING', 'is_available': True},
            actor=self.admin,
        )

        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        # Exactly 2 notifications (one for b1, one for b2), NOT 4!
        self.assertEqual(notifs.count(), 2)
        b1_reinstate = notifs.filter(barangay=self.b1).first()
        b2_reinstate = notifs.filter(barangay=self.b2).first()
        self.assertIsNotNone(b1_reinstate)
        self.assertIsNotNone(b2_reinstate)
        self.assertEqual(b1_reinstate.title, 'Collection Schedule Reinstated')
        self.assertEqual(b2_reinstate.title, 'Collection Schedule Reinstated')
        self.assertEqual(b1_reinstate.broadcast_id, b2_reinstate.broadcast_id)

    # ── Test 15: Dispatch Failure Rolls Back Availability Change ─────────────
    def test_15_dispatch_failure_rolls_back_availability_change_and_notification(self):
        """
        Verify that if notification dispatch raises an exception, the entire
        transaction rolls back, reverting both schedule state changes and notifications.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()
        ActivityLog.objects.all().delete()

        # Simulate exception during Notification creation on cancellation
        with patch('notifications.models.Notification.objects.create', side_effect=RuntimeError("Simulated dispatch failure")):
            with self.assertRaises(RuntimeError):
                update_collection_schedule(
                    schedule_pk=schedule.pk,
                    validated_fields={'status': 'CANCELLED', 'is_available': False},
                    actor=self.admin,
                )

        # Invariant: Schedule status was rolled back to PENDING and is_available is True
        schedule.refresh_from_db()
        self.assertEqual(schedule.status, 'PENDING')
        self.assertTrue(schedule.is_available)

        # Invariant: No notification or ActivityLog row survived rollback
        self.assertEqual(Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE).count(), 0)
        self.assertEqual(ActivityLog.objects.filter(module='CollectionSchedule', action='update').count(), 0)

    # ── Test 16: Operational Status Changes Do Not Mutate Availability ───────
    def test_16_operational_status_change_does_not_mutate_availability(self):
        """
        Verify updating operational status (e.g. COMPLETED or CANCELLED) does not
        unintentionally alter the persisted is_available field.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
                'is_available': True,
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # Update status to COMPLETED
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'status': 'COMPLETED'},
            actor=self.admin,
        )
        schedule.refresh_from_db()
        self.assertEqual(schedule.status, 'COMPLETED')
        self.assertTrue(schedule.is_available)
        # Marking COMPLETED does not trigger cancellation or unpublication
        self.assertEqual(Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE).count(), 0)

    # ── Test 17: Reactivating Availability Preserves Valid Operational Status 
    def test_17_reactivating_availability_preserves_valid_operational_status(self):
        """
        Verify reactivating availability (is_available=True) on a COMPLETED schedule
        preserves status='COMPLETED' without overwriting it to 'PENDING'.
        """
        schedule = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'COMPLETED',
                'is_available': False,
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()

        # Reactivate availability without specifying status
        update_collection_schedule(
            schedule_pk=schedule.pk,
            validated_fields={'is_available': True},
            actor=self.admin,
        )
        schedule.refresh_from_db()
        self.assertTrue(schedule.is_available)
        # CRITICAL INVARIANT: operational status is preserved as COMPLETED
        self.assertEqual(schedule.status, 'COMPLETED')

        # Resident notification was emitted indicating schedule is available
        notifs = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE, barangay=self.b1)
        self.assertEqual(notifs.count(), 1)
        self.assertIn(notifs.first().title, ('Collection Schedule Reinstated', 'Collection Schedule Published'))

    # ── Test 18: Effective Availability Transition Matrix ────────────────────
    def test_18_effective_availability_transition_matrix(self):
        """
        Verify the exact 6 effective availability transition cases:
        Resident availability = is_available AND (status != CANCELLED)
        1. CANCELLED + unavailable -> CANCELLED + available: no reinstatement notification.
        2. CANCELLED + available -> PENDING + available: one reinstatement notification per affected barangay.
        3. CANCELLED + unavailable -> PENDING + unavailable: no reinstatement notification.
        4. PENDING + available -> CANCELLED + available: one cancellation notification per affected barangay.
        5. PENDING + available -> PENDING + unavailable: one cancellation notification per affected barangay.
        6. Combined changes that produce only one effective availability transition must never dispatch duplicate notifications.
        """
        # Case 1: CANCELLED + unavailable -> CANCELLED + available
        # Effective: False -> False. Must produce NO notification.
        s1 = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'CANCELLED',
                'is_available': False,
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()
        update_collection_schedule(
            schedule_pk=s1.pk,
            validated_fields={'is_available': True},  # status remains CANCELLED
            actor=self.admin,
        )
        s1.refresh_from_db()
        self.assertEqual(s1.status, 'CANCELLED')
        self.assertTrue(s1.is_available)
        self.assertEqual(Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE).count(), 0)

        # Case 2: CANCELLED + available -> PENDING + available
        # Effective: False -> True. Must produce ONE reinstatement notification per affected barangay.
        update_collection_schedule(
            schedule_pk=s1.pk,
            validated_fields={'status': 'PENDING'},  # is_available remains True
            actor=self.admin,
        )
        s1.refresh_from_db()
        self.assertEqual(s1.status, 'PENDING')
        self.assertTrue(s1.is_available)
        notifs_c2 = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE, barangay=self.b1)
        self.assertEqual(notifs_c2.count(), 1)
        self.assertEqual(notifs_c2.first().title, 'Collection Schedule Reinstated')
        Notification.objects.all().delete()

        # Case 3: CANCELLED + unavailable -> PENDING + unavailable
        # Effective: False -> False. Must produce NO reinstatement notification.
        s3 = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'CANCELLED',
                'is_available': False,
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()
        update_collection_schedule(
            schedule_pk=s3.pk,
            validated_fields={'status': 'PENDING'},  # is_available remains False
            actor=self.admin,
        )
        s3.refresh_from_db()
        self.assertEqual(s3.status, 'PENDING')
        self.assertFalse(s3.is_available)
        self.assertEqual(Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE).count(), 0)

        # Case 4: PENDING + available -> CANCELLED + available
        # Effective: True -> False. Must produce ONE cancellation notification per affected barangay.
        s4 = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
                'is_available': True,
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()
        update_collection_schedule(
            schedule_pk=s4.pk,
            validated_fields={'status': 'CANCELLED'},  # is_available remains True
            actor=self.admin,
        )
        s4.refresh_from_db()
        self.assertEqual(s4.status, 'CANCELLED')
        self.assertTrue(s4.is_available)
        notifs_c4 = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE, barangay=self.b1)
        self.assertEqual(notifs_c4.count(), 1)
        self.assertEqual(notifs_c4.first().title, 'Collection Schedule Cancelled')
        Notification.objects.all().delete()

        # Case 5: PENDING + available -> PENDING + unavailable
        # Effective: True -> False. Must produce ONE cancellation notification per affected barangay.
        s5 = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
                'is_available': True,
            },
            barangay_ids=[self.b1.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()
        update_collection_schedule(
            schedule_pk=s5.pk,
            validated_fields={'is_available': False},  # status remains PENDING
            actor=self.admin,
        )
        s5.refresh_from_db()
        self.assertEqual(s5.status, 'PENDING')
        self.assertFalse(s5.is_available)
        notifs_c5 = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE, barangay=self.b1)
        self.assertEqual(notifs_c5.count(), 1)
        self.assertEqual(notifs_c5.first().title, 'Collection Schedule Cancelled')
        Notification.objects.all().delete()

        # Case 6: Combined changes producing only one effective availability transition
        # Effective: True -> False (PENDING + available -> CANCELLED + unavailable)
        # Must never dispatch duplicate notifications (exactly 1 per barangay).
        s6 = create_collection_schedule(
            validated_fields={
                'truck': self.truck1,
                'driver': self.driver1,
                'start_time': datetime.time(8, 0),
                'end_time': datetime.time(12, 0),
                'days': 'Mon, Wed',
                'status': 'PENDING',
                'is_available': True,
            },
            barangay_ids=[self.b1.id, self.b2.id],
            actor=self.admin,
        )
        Notification.objects.all().delete()
        update_collection_schedule(
            schedule_pk=s6.pk,
            validated_fields={'status': 'CANCELLED', 'is_available': False},
            actor=self.admin,
        )
        s6.refresh_from_db()
        self.assertEqual(s6.status, 'CANCELLED')
        self.assertFalse(s6.is_available)
        notifs_c6 = Notification.objects.filter(type=NotificationType.SCHEDULE_CHANGE)
        # Exactly 2 notifications: 1 for b1, 1 for b2; NOT 4!
        self.assertEqual(notifs_c6.count(), 2)
        self.assertEqual(notifs_c6.filter(barangay=self.b1).count(), 1)
        self.assertEqual(notifs_c6.filter(barangay=self.b2).count(), 1)
        for n in notifs_c6:
            self.assertEqual(n.title, 'Collection Schedule Cancelled')
