from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from accounts.models import Barangay
from driver.models import (
    Truck, CollectionSchedule, DriverShift,
    MissedStop, MissedStopStatus
)
from watcher.models import StopValidation, StopValidationStatus as SVS
from analytics.services import _compute_tracker_payload
from django.contrib.auth import get_user_model

User = get_user_model()


from django.db import transaction
from django.conf import settings

class Command(BaseCommand):
    help = 'Run tracker scenarios and print states'

    def handle(self, *args, **options):
        if not settings.DEBUG:
            self.stderr.write("Must be run in DEBUG mode.")
            return

        now = timezone.localtime().replace(hour=10, minute=0, second=0, microsecond=0)
        today = now.date()

        # 5-stop route: Base, Stop 1 (b2), Stop 2 (b), Stop 3 (b2), Stop 4 (b)
        wps = [
            {'lat': 14.0, 'lng': 121.0, 'label': 'Base'},
            {'lat': 14.1, 'lng': 121.1, 'label': 'Stop 1 (b2)', 'barangay_id': None}, # placeholder
            {'lat': 14.2, 'lng': 121.2, 'label': 'Stop 2 (b)', 'barangay_id': None},
            {'lat': 14.3, 'lng': 121.3, 'label': 'Stop 3 (b2)', 'barangay_id': None},
            {'lat': 14.4, 'lng': 121.4, 'label': 'Stop 4 (b)', 'barangay_id': None},
        ]
        
        driver = User.objects.filter(role='driver').first()
        if not driver:
            self.stderr.write('No driver user found.')
            return

        def make_sched():
            s = CollectionSchedule.objects.create(
                truck=truck, driver=driver, status='PENDING',
                start_time=(now - timedelta(hours=1)).time(),
                end_time=(now + timedelta(hours=2)).time(),
                waypoints=wps, days=today.strftime('%A'),
            )
            s.barangays.add(b)
            s.barangays.add(b2)
            return s

        def make_shift(s, status='shiftroute', is_active=True,
                       lat=14.0, lng=121.0, ago_min=30,
                       last_fix_min=0, end_phase='', extended=False):
            sh = DriverShift.objects.create(
                driver=driver, schedule=s, truck=truck,
                status=status, is_active=is_active,
                end_shift_phase=end_phase,
                is_extended_mode=extended,
                current_latitude=lat if lat else None,
                current_longitude=lng if lng else None,
                last_location_update=(now - timedelta(minutes=last_fix_min)) if last_fix_min is not None else None,
            )
            DriverShift.objects.filter(pk=sh.pk).update(started_at=now - timedelta(minutes=ago_min))
            return sh

        def sv(s, order, status):
            StopValidation.objects.update_or_create(
                schedule=s, stop_order=order, collection_date=today,
                defaults={'current_status': status},
            )

        def ms(s, order):
            MissedStop.objects.create(
                original_schedule=s, stop_order=order,
                collection_date=today, status=MissedStopStatus.PENDING,
                reason='WATCHER_FLAG', waypoint_data=wps[order],
            )

        def check(label, s, b_id):
            p = _compute_tracker_payload(b_id, today, now)
            for t in p['trucks']:
                if t['schedule_id'] == s.id:
                    self.stdout.write(
                        f'\n--- {label} ---\n'
                        f"  state={t['state']}, away={t['stops_away']}, "
                        f"eta={t['eta_min']}-{t['eta_max']}, "
                        f"done={t['stops_done']}/{t['stops_total']}, "
                        f"stale={t['is_stale']}, behind={t.get('behind')}, "
                        f"fix_age_s={t.get('fix_age_s', 0)}, "
                        f"partial={t.get('partial')}, preparing={t.get('preparing')}"
                    )
                    return
            self.stdout.write(f'\n--- {label} ---\n  (no row returned)')

        with transaction.atomic():
            self.stdout.write("Running tests in atomic transaction block...")

            # ── Reusable fixtures ────────────────────────────────────────────────
            b, _ = Barangay.objects.get_or_create(name='Simulation Barangay')
            b2, _ = Barangay.objects.get_or_create(name='Other Barangay')
            truck, _ = Truck.objects.get_or_create(
                plate_number='SIM-999', defaults={'model': 'Sim Truck'}
            )
            
            wps[1]['barangay_id'] = b2.id
            wps[2]['barangay_id'] = b.id
            wps[3]['barangay_id'] = b2.id
            wps[4]['barangay_id'] = b.id
            
            # Setup: Nothing handled, shift in shiftroute
            s = make_sched()
            sh = make_shift(s, status='shiftroute', lat=14.05, lng=121.05)
            check('1. Nothing handled, shift in shiftroute (expect en_route, away=2)', s, b.id)

            # Stop 1 collected
            sv(s, 1, SVS.COLLECTION_REPORTED)
            check('2. Stop 1 (b2) collected (expect away=1)', s, b.id)

            # Barangay owns stop 2 (order=2). Stop 3 (order=3) collected, stop 2 still pending
            sv(s, 3, SVS.COLLECTION_REPORTED)
            sh.current_latitude = 14.35
            sh.current_longitude = 121.35
            sh.save()
            check('3. Stop 3 collected, stop 2 pending (expect behind=True, no ETA)', s, b.id)

            # Truck within COLLECTION_RADIUS_M of the stop 2 (lat=14.2, lng=121.2)
            sh.current_latitude = 14.2
            sh.current_longitude = 121.2
            sh.save()
            check('4. Truck within radius of pending stop, fresh fix (expect arrived)', s, b.id)

            # Same position, last_location_update 5 minutes old
            sh.last_location_update = now - timedelta(minutes=5)
            sh.save()
            check('5. 5 min old fix (expect en_route, is_stale=True, fix_age_s~=300)', s, b.id)

            # end_shift_phase='dump_site', stops pending
            sh.end_shift_phase = 'dump_site'
            sh.last_location_update = now
            sh.save()
            check('6. end_shift_phase=dump_site (expect unloading)', s, b.id)

            # All barangay stops in MissedStop, shift ended
            sv(s, 2, SVS.COLLECTION_DISPUTED)
            ms(s, 2)
            sv(s, 4, SVS.COLLECTION_DISPUTED)
            ms(s, 4)
            sh.is_active = False
            sh.end_shift_phase = 'at_base'
            sh.save()
            check('7. All brgy stops MissedStop, shift ended (expect missed)', s, b.id)

            # Active shift, end_shift_phase='at_base', zero done, stops pending
            s2 = make_sched()
            sh2 = make_shift(s2, status='shiftroute', is_active=True, end_phase='at_base')
            check('8. Active shift, end_shift_phase=at_base, zero done (expect no_show)', s2, b.id)
            
            # Ended shift, end_shift_phase='', pending stops, zero done
            s3 = make_sched()
            s3.end_time = (now - timedelta(minutes=10)).time()
            s3.save()
            sh3 = make_shift(s3, status='shiftroute', is_active=False, end_phase='')
            check('9. Ended shift, end_shift_phase="", pending stops, past end_time (expect no_show)', s3, b.id)

            # Ended shift, before end_time
            s3b = make_sched()
            sh3b = make_shift(s3b, status='shiftroute', is_active=False, end_phase='')
            check('9b. Ended shift, end_shift_phase="", pending stops, before end_time (expect scheduled)', s3b, b.id)

            transaction.set_rollback(True)
            self.stdout.write('\n\nDone. Transaction rolled back successfully.\n')
