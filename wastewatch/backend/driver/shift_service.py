from datetime import date
import logging
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.core.exceptions import ValidationError, PermissionDenied
from django.utils import timezone
from accounts.permissions import is_admin_user
from watcher.models import StopValidation, StopValidationStatus
from .models import (
    DriverShift,
    WatcherShift,
    CrewShift,
    ShiftCrewRosterSnapshot,
    ShiftCrewRosterItem,
    CrewAttendanceRecord,
    CrewAttendanceCorrection,
    UnfinishedStopReview,
    CollectionSchedule,
    Truck,
    SanitationTeam,
    SanitationTeamMembership,
    ScheduleTruckAllocation,
    Worker,
    is_truck_dispatchable,
)
from .allocation_service import AllocationService
from .team_service import TeamService, ActiveShiftConflictError

logger = logging.getLogger(__name__)


class DuplicateAttendanceError(ValidationError):
    pass


class ShiftService:
    """
    Domain service for atomic shift lifecycle management,
    D-13 concurrency locking, C1 attendance immutability,
    and D-12 stop status preservation.
    """

    @staticmethod
    def stage_and_start_shift(
        driver_user,
        schedule_id: int,
        truck_id: int = None,
        allocation_id: int = None,
        manifested_worker_ids: list = None,
        duty_type: str = 'normal',
        initial_status: str = 'shiftroute',
        initial_op_status: str = 'on_route',
        latitude=None,
        longitude=None,
    ) -> DriverShift:
        today = timezone.localdate()

        # Normalize and validate manifested_worker_ids before any set/sort/DB lookup (H.7)
        normalized_manifested_ids = None
        if manifested_worker_ids is not None:
            if not isinstance(manifested_worker_ids, (list, tuple)):
                raise ValidationError({
                    'manifested_worker_ids': 'manifested_worker_ids must be a list of integer worker IDs.'
                })
            normalized_manifested_ids = []
            for raw_id in manifested_worker_ids:
                if isinstance(raw_id, bool):
                    raise ValidationError({
                        'manifested_worker_ids': f"Invalid worker ID in roster: {raw_id!r}."
                    })
                try:
                    w_int = int(raw_id)
                except (TypeError, ValueError):
                    raise ValidationError({
                        'manifested_worker_ids': f"Invalid worker ID in roster: {raw_id!r}."
                    })
                if w_int <= 0:
                    raise ValidationError({
                        'manifested_worker_ids': f"Worker ID must be positive: {raw_id!r}."
                    })
                normalized_manifested_ids.append(w_int)
            if len(normalized_manifested_ids) != len(set(normalized_manifested_ids)):
                raise ValidationError({'manifested_worker_ids': 'Duplicate worker IDs are not allowed in shift roster.'})

        with transaction.atomic():
            # 1. Lock Schedule in canonical order
            schedule = CollectionSchedule.objects.filter(id=schedule_id).select_for_update().first()
            if not schedule:
                raise ValidationError({'schedule_id': f"Schedule #{schedule_id} not found."})
            if schedule.status in ('CANCELLED', 'COMPLETED') or not schedule.is_available:
                raise ValidationError({
                    'schedule_id': f"Schedule #{schedule.id} is not active or available for dispatch."
                })
            if not schedule.dumpsite_id:
                raise ValidationError({
                    'schedule_id': f"Schedule #{schedule.id} has no assigned dumpsite facility."
                })

            # 2. Revalidate effective team under lock (D-10: Override -> Default Team only)
            effective_team = AllocationService.resolve_schedule_team(schedule.id, today)
            locked_team = SanitationTeam.objects.filter(id=effective_team.id).select_for_update().first()
            if not locked_team or not locked_team.is_active:
                raise ValidationError({
                    'team': f"Sanitation team {effective_team.code} is inactive and cannot be dispatched."
                })
            effective_team = locked_team

            # 3. Validate and lock pre-existing Allocation (D-11 / D-13)
            # Never auto-create an allocation from driver-supplied truck_id or fall back to schedule.truck.
            allocation = None
            if allocation_id is not None:
                allocation = ScheduleTruckAllocation.objects.filter(id=allocation_id).select_for_update().first()
                if not allocation:
                    raise ValidationError({'allocation_id': f"Allocation #{allocation_id} not found."})
                if allocation.schedule_id != schedule.id or allocation.allocation_date != today:
                    raise ValidationError({
                        'allocation_id': (
                            f"Allocation #{allocation_id} is not authorized for Schedule #{schedule.id} on {today}."
                        )
                    })
            elif truck_id is not None:
                allocation = ScheduleTruckAllocation.objects.filter(
                    schedule=schedule,
                    truck_id=truck_id,
                    allocation_date=today
                ).select_for_update().first()
            else:
                matching_allocations = list(
                    ScheduleTruckAllocation.objects.filter(
                        schedule=schedule,
                        team=effective_team,
                        allocation_date=today,
                    ).order_by('id').select_for_update()
                )
                if len(matching_allocations) == 1:
                    allocation = matching_allocations[0]
                elif len(matching_allocations) > 1:
                    raise ValidationError({
                        'allocation_id': (
                            f"Multiple truck allocations exist for Schedule #{schedule.id} on {today}. "
                            "Explicit allocation_id is required."
                        )
                    })

            if not allocation:
                raise ValidationError({
                    'allocation_id': (
                        f"No valid ScheduleTruckAllocation exists for Schedule #{schedule.id} on {today}."
                    )
                })
            if DriverShift.objects.filter(allocation=allocation).exists():
                raise ValidationError({
                    'allocation_id': f"Allocation #{allocation.id} has already been used by another shift."
                })
            if allocation.team_id != effective_team.id:
                raise ValidationError({
                    'allocation_id': (
                        f"Stale allocation #{allocation.id}: allocated team ({allocation.team.code}) "
                        f"does not match current resolved team ({effective_team.code}) for {today}."
                    )
                })

            truck = Truck.objects.filter(id=allocation.truck_id).select_for_update().first()
            if not truck or not is_truck_dispatchable(truck):
                raise ValidationError({
                    'truck': (
                        f"Truck {truck.plate_number if truck else allocation.truck_id} is not dispatchable."
                    )
                })

            # 4. Lock driver User row (Schedule -> Team -> Allocation -> Truck -> User)
            #    and prevent duplicate active shift for driver or truck across schedules
            User = get_user_model()
            User.objects.filter(pk=driver_user.pk).select_for_update().first()
            if DriverShift.objects.filter(driver=driver_user, is_active=True).exists():
                raise ActiveShiftConflictError({'driver': f"Driver {driver_user.username} already has an active shift."})
            if DriverShift.objects.filter(Q(truck=truck) | Q(allocation__truck=truck), is_active=True).exists():
                raise ActiveShiftConflictError({'truck': f"Truck {truck.plate_number} already has an active shift running."})

            # 5. Lock Worker rows before SanitationTeamMembership to match global lock order:
            #    SanitationTeam -> Truck -> Worker -> SanitationTeamMembership
            team_worker_ids = list(
                SanitationTeamMembership.objects.filter(
                    team=effective_team,
                    is_active=True,
                ).values_list('worker_id', flat=True)
            )
            driver_worker_id = (
                Worker.objects.filter(user=driver_user)
                .values_list('id', flat=True)
                .first()
            )
            worker_ids_to_lock = sorted(
                set(team_worker_ids)
                | ({driver_worker_id} if driver_worker_id else set())
                | (set(normalized_manifested_ids) if normalized_manifested_ids else set())
            )
            locked_workers = {
                w.id: w
                for w in Worker.objects.select_related('user').filter(id__in=worker_ids_to_lock).order_by('id').select_for_update(of=('self',))
            }

            memberships = list(
                SanitationTeamMembership.objects.filter(
                    team=effective_team,
                    is_active=True,
                ).order_by('id').select_for_update(of=('self',))
            )
            member_by_worker_id = {m.worker_id: m for m in memberships}

            # Verify requesting Driver is an authorized active 'driver' or Driver-Team Leader on effective_team
            driver_worker = locked_workers.get(driver_worker_id) if driver_worker_id else None
            if not driver_worker or not driver_worker.is_active or not getattr(driver_user, 'is_active', False):
                raise PermissionDenied(
                    f"Driver {driver_user.username} does not have an active worker profile and user account."
                )
            driver_membership = member_by_worker_id.get(driver_worker.id)
            is_authorized_driver = bool(
                driver_membership and (
                    (
                        driver_membership.role_in_team == 'driver'
                        and getattr(driver_user, 'role', '') == 'driver'
                    )
                    or (
                        driver_membership.role_in_team == 'leader'
                        and getattr(driver_user, 'role', '') == 'driver'
                    )
                )
            )
            if not is_authorized_driver:
                raise PermissionDenied(
                    f"Driver {driver_user.username} is not an active assigned driver for Team {effective_team.code}."
                )

            # Resolve authoritative deployment Team Leader
            service_date = allocation.allocation_date if allocation else today
            deployment_leader = TeamService.resolve_deployment_team_leader(schedule, service_date)
            team_leader_user = deployment_leader.user
            leader_worker = deployment_leader.worker
            leader_user_role = deployment_leader.leadership_mode
            watcher_shift = None

            # Lock any pre-existing CrewShift explicitly tied to this allocation (e.g. Watcher pre-departure attendance)
            existing_crew_shift = (
                CrewShift.objects.filter(allocation=allocation)
                .select_for_update()
                .first()
            )
            if existing_crew_shift:
                if (
                    existing_crew_shift.team_id != effective_team.id
                    or existing_crew_shift.team_leader_id != team_leader_user.id
                ):
                    raise ActiveShiftConflictError({
                        'crew_shift': (
                            f"Existing CrewShift #{existing_crew_shift.id} on allocation #{allocation.id} "
                            "does not match the current resolved team or team leader."
                        )
                    })

            if leader_user_role == 'watcher':
                # Independent lifecycles: WatcherShift is NEVER required to stage DriverShift.
                # If an active WatcherShift explicitly exists for (schedule, service_date, leader), link it.
                candidate_watcher_shifts = list(
                    WatcherShift.objects.filter(
                        schedule=schedule,
                        shift_date=service_date,
                        watcher_id=team_leader_user.id,
                        is_active=True,
                    ).order_by('id').select_for_update(of=('self',))
                )
                for ws in candidate_watcher_shifts:
                    other_crew_qs = CrewShift.objects.filter(watcher_shift=ws)
                    if existing_crew_shift:
                        other_crew_qs = other_crew_qs.exclude(pk=existing_crew_shift.pk)
                    if not other_crew_qs.exists():
                        watcher_shift = ws
                        break
            elif leader_user_role != 'driver':
                raise ValidationError({
                    'team_leader': (
                        f"Assigned Team Leader for Team {effective_team.code} must have role 'watcher' or 'driver'."
                    )
                })

            # Validate normalized_manifested_ids if provided (must belong to effective_team and be active/eligible)
            if normalized_manifested_ids is not None:
                invalid_ids = [w_id for w_id in normalized_manifested_ids if w_id not in member_by_worker_id]
                if invalid_ids:
                    raise ValidationError({
                        'manifested_worker_ids': f"Workers {invalid_ids} are not active members of Team {effective_team.code}."
                    })
                inactive_ids = [
                    w_id for w_id in normalized_manifested_ids
                    if not locked_workers.get(w_id)
                    or not locked_workers[w_id].is_active
                    or (locked_workers[w_id].user_id and not getattr(locked_workers[w_id].user, 'is_active', False))
                ]
                if inactive_ids:
                    raise ValidationError({
                        'manifested_worker_ids': f"Workers {inactive_ids} are inactive or linked to inactive user accounts."
                    })
                target_worker_ids = sorted(set(normalized_manifested_ids) | {driver_worker.id})
            else:
                target_worker_ids = sorted(
                    w_id for w_id in member_by_worker_id.keys()
                    if (
                        locked_workers.get(w_id)
                        and locked_workers[w_id].is_active
                        and (not locked_workers[w_id].user_id or getattr(locked_workers[w_id].user, 'is_active', False))
                    )
                )

            # Reject any roster worker OR resolved deployment leader already participating in another active shift
            participation_worker_ids = sorted(
                set(target_worker_ids) | ({leader_worker.id} if leader_worker else set())
            )
            exclude_ws_id = (
                watcher_shift.id
                if watcher_shift
                else (existing_crew_shift.watcher_shift_id if existing_crew_shift else None)
            )
            exclude_cs_id = existing_crew_shift.id if existing_crew_shift else None
            for w_id in participation_worker_ids:
                if TeamService.is_worker_on_active_shift(
                    w_id,
                    exclude_watcher_shift_id=exclude_ws_id,
                    exclude_crew_shift_id=exclude_cs_id,
                    exclude_driver_shift_schedule_id=schedule.id,
                ):
                    w_obj = locked_workers.get(w_id) or (leader_worker if (leader_worker and leader_worker.id == w_id) else None)
                    w_name = w_obj.full_name if w_obj else f"Worker #{w_id}"
                    raise ActiveShiftConflictError({
                        'worker_id': f"Worker {w_name} is already participating in another active shift."
                    })

            # 6. Create DriverShift (savepoint-guarded against concurrent unique constraint conflicts)
            now = timezone.now()
            try:
                with transaction.atomic():
                    shift = DriverShift.objects.create(
                        driver=driver_user,
                        truck=truck,
                        schedule=schedule,
                        allocation=allocation,
                        status=initial_status,
                        duty_type=duty_type,
                        op_status=initial_op_status,
                        is_active=True,
                        current_latitude=latitude,
                        current_longitude=longitude,
                        last_location_update=now if (latitude is not None and longitude is not None) else None,
                    )
            except IntegrityError as exc:
                raise ActiveShiftConflictError({
                    'active_shift': 'Driver or truck already has an active shift (concurrent start conflict).'
                }) from exc

            # 7. Link pre-existing CrewShift (if Watcher submitted attendance first) WITHOUT fabricating
            # an attendance-submitted CrewShift when attendance has not yet been submitted, and
            # NEVER executing UPDATE on immutable ShiftCrewRosterSnapshot or CrewAttendanceRecord rows.
            if existing_crew_shift:
                existing_crew_shift.driver_shift = shift
                cs_update_fields = ['driver_shift']
                if existing_crew_shift.schedule_id is None:
                    existing_crew_shift.schedule = schedule
                    cs_update_fields.append('schedule')
                if existing_crew_shift.service_date is None:
                    existing_crew_shift.service_date = service_date
                    cs_update_fields.append('service_date')
                if (
                    leader_user_role == 'watcher'
                    and existing_crew_shift.watcher_shift_id is None
                    and watcher_shift is not None
                ):
                    existing_crew_shift.watcher_shift = watcher_shift
                    cs_update_fields.append('watcher_shift')
                existing_crew_shift.save(update_fields=cs_update_fields)

                if not ShiftCrewRosterSnapshot.objects.filter(crew_shift=existing_crew_shift).exists():
                    snapshot = ShiftCrewRosterSnapshot.objects.create(
                        driver_shift=shift,
                        crew_shift=existing_crew_shift,
                        staged_by=driver_user,
                    )
                    for w_id in target_worker_ids:
                        m = member_by_worker_id[w_id]
                        ShiftCrewRosterItem.objects.create(
                            snapshot=snapshot,
                            worker=locked_workers[w_id],
                            role_in_roster=m.role_in_team,
                            is_present=True,
                        )
            else:
                # Create immutable staging Roster Snapshot (D-13 point-in-time manifest)
                snapshot = ShiftCrewRosterSnapshot.objects.create(
                    driver_shift=shift,
                    staged_by=driver_user,
                )
                for w_id in target_worker_ids:
                    m = member_by_worker_id[w_id]
                    ShiftCrewRosterItem.objects.create(
                        snapshot=snapshot,
                        worker=locked_workers[w_id],
                        role_in_roster=m.role_in_team,
                        is_present=True,
                    )

            # 8. Update Truck op_status
            truck.op_status = 'IN_TRANSIT'
            truck.save(update_fields=['op_status'])

            return shift

    @staticmethod
    def record_deployment_attendance(
        schedule_id: int,
        service_date,
        attendance_list: list,
        recorded_by,
        *,
        require_leadership_mode: str = None,
        driver_shift_id: int = None,
        allocation_id: int = None,
        reject_duplicate: bool = False,
    ) -> tuple:
        """
        Records immutable initial crew attendance (C1) for a deployment (schedule + service_date + allocation).
        Creates the authoritative CrewShift (and immutable ShiftCrewRosterSnapshot if not yet staged)
        independently of whether DriverShift or WatcherShift has started.
        NEVER executes UPDATE on trigger-protected tables.
        Returns (records, crew_shift).
        """
        valid_statuses = {'PRESENT', 'ABSENT', 'LATE', 'EXCUSED'}
        target_date = service_date or timezone.localdate()

        if is_admin_user(recorded_by):
            raise PermissionDenied("Administrators cannot submit initial crew attendance on behalf of the Team Leader.")

        user_role = getattr(recorded_by, 'role', '')
        if (
            not recorded_by
            or not getattr(recorded_by, 'is_authenticated', False)
            or not getattr(recorded_by, 'is_active', False)
            or user_role not in ('watcher', 'driver')
        ):
            raise PermissionDenied(
                "Only the designated active Team Leader (Watcher or Driver) may submit initial crew attendance."
            )

        class _ConcurrentShiftOrTeamMove(Exception):
            pass

        observed_shift = None
        if driver_shift_id is not None:
            observed_shift = DriverShift.objects.filter(id=driver_shift_id).values('schedule_id', 'allocation_id').first()
            if not observed_shift:
                raise ValidationError({'driver_shift_id': f"Shift #{driver_shift_id} not found."})
            if observed_shift['schedule_id'] is not None and observed_shift['schedule_id'] != schedule_id:
                raise ValidationError({
                    'driver_shift_id': f"Shift #{driver_shift_id} does not belong to Schedule #{schedule_id}."
                })

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                with transaction.atomic():
                    # Canonical lock order:
                    # CollectionSchedule (1) -> SanitationTeam (2) -> ScheduleTruckAllocation (4)
                    # -> Worker (6, asc id) -> SanitationTeamMembership (7, asc id)
                    # -> DriverShift (8) -> CrewShift (9) -> WatcherShift (10, of=('self',))
                    schedule = CollectionSchedule.objects.filter(id=schedule_id).select_for_update().first()
                    if not schedule:
                        raise ValidationError({'schedule_id': f"Schedule #{schedule_id} not found."})
                    if schedule.status in ('CANCELLED', 'COMPLETED') or not schedule.is_available:
                        raise ValidationError({
                            'schedule_id': f"Schedule #{schedule.id} is not active or available for dispatch."
                        })
                    if not schedule.dumpsite_id:
                        raise ValidationError({
                            'schedule_id': f"Schedule #{schedule.id} has no assigned dumpsite facility."
                        })

                    pre_team = AllocationService.resolve_schedule_team(schedule.id, target_date)
                    effective_team = SanitationTeam.objects.filter(id=pre_team.id, is_active=True).select_for_update().first()
                    if not effective_team:
                        raise ValidationError({'team': f"Resolved team for Schedule #{schedule.id} is inactive."})

                    # Resolve and lock authoritative ScheduleTruckAllocation BEFORE DriverShift
                    allocation = None
                    target_alloc_id = (
                        observed_shift['allocation_id'] if (observed_shift and observed_shift['allocation_id']) else allocation_id
                    )
                    if target_alloc_id is not None:
                        allocation = ScheduleTruckAllocation.objects.filter(
                            id=target_alloc_id,
                            schedule=schedule,
                        ).select_for_update().first()
                        if not allocation:
                            raise ValidationError({
                                'allocation_id': f"Allocation #{target_alloc_id} not found for Schedule #{schedule.id}."
                            })
                        if observed_shift is None and allocation.allocation_date != target_date:
                            raise ValidationError({
                                'allocation_id': f"Allocation #{target_alloc_id} is not for {target_date}."
                            })
                    elif driver_shift_id is None:
                        allocs = list(
                            ScheduleTruckAllocation.objects.filter(
                                schedule=schedule,
                                allocation_date=target_date,
                                team=effective_team,
                            ).order_by('id').select_for_update()
                        )
                        if len(allocs) == 1:
                            allocation = allocs[0]
                        elif len(allocs) > 1:
                            raise ValidationError({
                                'allocation_id': f"Multiple truck allocations exist for Schedule #{schedule.id} on {target_date}."
                            })

                    if allocation is None and driver_shift_id is None:
                        raise ValidationError({
                            'allocation_id': f"No valid ScheduleTruckAllocation exists for Schedule #{schedule.id} on {target_date}."
                        })

                    # Lock Worker (6, asc id) -> SanitationTeamMembership (7, asc id) BEFORE resolving leader
                    team_worker_ids = sorted(
                        SanitationTeamMembership.objects.filter(
                            team=effective_team,
                            is_active=True,
                        ).values_list('worker_id', flat=True)
                    )
                    locked_workers = {
                        w.id: w
                        for w in Worker.objects.select_related('user')
                        .filter(id__in=team_worker_ids)
                        .order_by('id')
                        .select_for_update(of=('self',))
                    }
                    all_memberships = list(
                        SanitationTeamMembership.objects.select_related('worker__user')
                        .filter(team=effective_team, is_active=True)
                        .order_by('id')
                        .select_for_update(of=('self',))
                    )

                    # Resolve and revalidate leader under SanitationTeam -> Worker -> Membership locks
                    deployment_leader = TeamService.resolve_deployment_team_leader(schedule, target_date)
                    if deployment_leader.team.id != effective_team.id:
                        raise _ConcurrentShiftOrTeamMove()

                    if require_leadership_mode and deployment_leader.leadership_mode != require_leadership_mode:
                        if require_leadership_mode == 'watcher':
                            raise PermissionDenied(
                                f"Deployment for Schedule #{schedule.id} on {target_date} is Driver-led; "
                                "Watchers cannot submit initial attendance for it."
                            )
                        raise PermissionDenied(
                            f"Deployment for Schedule #{schedule.id} on {target_date} is Watcher-led; "
                            "Drivers cannot submit or replace Watcher-led initial attendance."
                        )

                    if recorded_by.id != deployment_leader.user.id:
                        if deployment_leader.leadership_mode == 'watcher':
                            raise PermissionDenied(
                                f"Only the designated Watcher Team Leader ({deployment_leader.user.username}) "
                                f"may submit initial crew attendance for Team {effective_team.code}."
                            )
                        raise PermissionDenied(
                            f"Only the designated Driver Team Leader ({deployment_leader.user.username}) "
                            f"may submit initial crew attendance for Team {effective_team.code}."
                        )

                    # Lock DriverShift (8) after Allocation (4) and Membership (7)
                    shift = None
                    if driver_shift_id is not None:
                        shift = DriverShift.objects.filter(id=driver_shift_id).select_for_update().first()
                        if not shift:
                            raise ValidationError({'driver_shift_id': f"Shift #{driver_shift_id} not found."})
                        if shift.schedule_id is not None and shift.schedule_id != schedule.id:
                            raise ValidationError({
                                'driver_shift_id': f"Shift #{driver_shift_id} does not belong to Schedule #{schedule.id}."
                            })
                        if shift.allocation_id != observed_shift['allocation_id']:
                            raise _ConcurrentShiftOrTeamMove()
                    elif allocation is not None:
                        shift = DriverShift.objects.filter(allocation=allocation).select_for_update().first()
                        if shift is not None and shift.schedule_id and shift.schedule_id != schedule.id:
                            raise ValidationError({
                                'driver_shift_id': f"Shift #{shift.id} does not belong to Schedule #{schedule.id}."
                            })

                    # Lock CrewShift (9)
                    crew_q = Q(pk__isnull=True)
                    if allocation is not None:
                        crew_q |= Q(allocation=allocation)
                    if shift is not None:
                        crew_q |= Q(driver_shift=shift)
                    crew_shift = CrewShift.objects.filter(crew_q).order_by('id').select_for_update().first()

                    # Lock WatcherShift (10, of=('self',))
                    watcher_shift = None
                    if deployment_leader.leadership_mode == 'watcher':
                        if crew_shift and crew_shift.watcher_shift_id and crew_shift.watcher_shift.watcher_id != recorded_by.id:
                            raise PermissionDenied(
                                "Only the assigned Watcher who confirmed this shift's WatcherShift may submit initial attendance."
                            )
                        if crew_shift and crew_shift.watcher_shift_id:
                            watcher_shift = (
                                WatcherShift.objects.filter(id=crew_shift.watcher_shift_id)
                                .select_for_update(of=('self',))
                                .first()
                            )
                        else:
                            candidate_ws = list(
                                WatcherShift.objects.filter(
                                    schedule=schedule,
                                    shift_date=target_date,
                                    watcher_id=recorded_by.id,
                                    is_active=True,
                                ).order_by('id').select_for_update(of=('self',))
                            )
                            for ws in candidate_ws:
                                other_qs = CrewShift.objects.filter(watcher_shift=ws)
                                if crew_shift:
                                    other_qs = other_qs.exclude(pk=crew_shift.pk)
                                if not other_qs.exists():
                                    watcher_shift = ws
                                    break

                    # Determine expected crew roster from existing immutable snapshot or active eligible memberships
                    snapshot = None
                    if crew_shift:
                        snapshot = ShiftCrewRosterSnapshot.objects.filter(crew_shift=crew_shift).order_by('-snapshot_timestamp', '-id').first()
                    if snapshot is None and shift is not None:
                        snapshot = shift.roster_snapshots.order_by('-snapshot_timestamp', '-id').first()

                    eligible_memberships = [
                        m for m in all_memberships
                        if (locked_workers.get(m.worker_id, m.worker)).is_active
                        and (
                            not (locked_workers.get(m.worker_id, m.worker)).user_id
                            or getattr((locked_workers.get(m.worker_id, m.worker)).user, 'is_active', False)
                        )
                    ]

                    if snapshot is not None:
                        crew_qs = snapshot.items.exclude(role_in_roster__in=('driver', 'leader')).exclude(worker_id=deployment_leader.worker.id)
                        if shift is not None:
                            crew_qs = crew_qs.exclude(worker__user_id=shift.driver_id)
                        crew_items = list(crew_qs.select_related('worker'))
                        expected_worker_ids = {item.worker_id for item in crew_items}
                    else:
                        crew_memberships = [
                            m for m in eligible_memberships
                            if m.role_in_team == 'crew'
                            and m.worker_id != deployment_leader.worker.id
                            and (not shift or not m.worker.user_id or m.worker.user_id != shift.driver_id)
                        ]
                        expected_worker_ids = {m.worker_id for m in crew_memberships}

                    exclude_ws_id = watcher_shift.id if watcher_shift else (crew_shift.watcher_shift_id if crew_shift else None)
                    exclude_cs_id = crew_shift.id if crew_shift else None
                    check_ids = set(expected_worker_ids)
                    if deployment_leader.worker:
                        check_ids.add(deployment_leader.worker.id)
                    for w_id in sorted(check_ids):
                        if TeamService.is_worker_on_active_shift(
                            w_id,
                            exclude_watcher_shift_id=exclude_ws_id,
                            exclude_crew_shift_id=exclude_cs_id,
                            exclude_driver_shift_id=shift.id if shift else None,
                            exclude_driver_shift_schedule_id=schedule.id,
                        ):
                            w_obj = locked_workers.get(w_id) or deployment_leader.worker
                            w_name = w_obj.full_name if w_obj else f"Worker #{w_id}"
                            raise ActiveShiftConflictError({
                                'worker_id': f"Worker {w_name} is already participating in another active shift."
                            })

                    if not expected_worker_ids:
                        raise ValidationError({'roster': f"Deployment for Schedule #{schedule.id} has no non-driver crew members in its roster."})

                    if not isinstance(attendance_list, list) or not attendance_list:
                        raise ValidationError({'attendance': 'Attendance list cannot be empty.'})

                    submitted_map = {}
                    for idx, entry in enumerate(attendance_list):
                        if not isinstance(entry, dict):
                            raise ValidationError({
                                'attendance': f"Attendance entry at index {idx} must be an object with 'worker_id' and 'status'."
                            })
                        w_id = entry.get('worker_id')
                        raw_status = entry.get('status')
                        if raw_status is not None and not isinstance(raw_status, str):
                            raise ValidationError({'status': f"Invalid attendance status: {raw_status!r}"})
                        stat = (raw_status or 'PRESENT').upper().strip()
                        if stat not in valid_statuses:
                            raise ValidationError({'status': f"Invalid attendance status: {stat}"})
                        try:
                            w_id_int = int(w_id)
                        except (TypeError, ValueError):
                            raise ValidationError({'worker_id': f"Invalid worker_id: {w_id}"})
                        if w_id_int in submitted_map:
                            raise ValidationError({'worker_id': f"Duplicate worker_id #{w_id_int} in attendance submission."})
                        if w_id_int not in expected_worker_ids:
                            raise ValidationError({
                                'worker_id': (
                                    f"Worker #{w_id_int} is not part of the crew roster for Schedule #{schedule.id} "
                                    "(driver, team leader, and external workers are excluded from crew attendance)."
                                )
                            })
                        submitted_map[w_id_int] = stat

                    missing_ids = expected_worker_ids - set(submitted_map.keys())
                    if missing_ids:
                        raise ValidationError({
                            'attendance': (
                                f"Incomplete crew attendance submission. Missing roster worker IDs: {sorted(missing_ids)}"
                            )
                        })

                    existing_rec_q = Q(pk__isnull=True)
                    if crew_shift is not None:
                        existing_rec_q |= Q(crew_shift=crew_shift)
                    if shift is not None:
                        existing_rec_q |= Q(driver_shift=shift)
                    existing_records = list(
                        CrewAttendanceRecord.objects.filter(existing_rec_q).order_by('id')
                    )
                    if existing_records:
                        if reject_duplicate:
                            raise DuplicateAttendanceError({
                                'attendance': f"Initial attendance for Schedule #{schedule.id} on {target_date} has already been submitted."
                            })
                        existing_by_worker = {r.worker_id: r for r in existing_records}
                        if set(existing_by_worker.keys()) == expected_worker_ids:
                            conflicts = [
                                w_id for w_id, stat in submitted_map.items()
                                if existing_by_worker[w_id].status != stat
                            ]
                            if not conflicts:
                                return existing_records, crew_shift
                            raise ValidationError({
                                'attendance': (
                                    f"Initial attendance was already recorded with different "
                                    f"statuses for worker IDs {sorted(conflicts)}. Use the correction API instead."
                                )
                            })
                        raise ValidationError({
                            'attendance': "Attendance records already exist for this shift. Use the correction API."
                        })

                    now = timezone.now()
                    if crew_shift is None:
                        crew_shift = CrewShift.objects.create(
                            driver_shift=shift,
                            watcher_shift=watcher_shift if deployment_leader.leadership_mode == 'watcher' else None,
                            allocation=allocation,
                            schedule=schedule,
                            service_date=target_date,
                            team=effective_team,
                            team_leader=deployment_leader.user,
                            attendance_submitted_by=recorded_by,
                            attendance_submitted_at=now,
                            is_active=(shift.is_active if shift is not None else True),
                        )
                    else:
                        update_fields = []
                        if shift is not None and crew_shift.driver_shift_id != shift.id:
                            crew_shift.driver_shift = shift
                            update_fields.append('driver_shift')
                        if allocation is not None and crew_shift.allocation_id != allocation.id:
                            crew_shift.allocation = allocation
                            update_fields.append('allocation')
                        if crew_shift.schedule_id != schedule.id:
                            crew_shift.schedule = schedule
                            update_fields.append('schedule')
                        if crew_shift.service_date != target_date:
                            crew_shift.service_date = target_date
                            update_fields.append('service_date')
                        if (
                            deployment_leader.leadership_mode == 'watcher'
                            and watcher_shift is not None
                            and crew_shift.watcher_shift_id is None
                        ):
                            crew_shift.watcher_shift = watcher_shift
                            update_fields.append('watcher_shift')
                        if crew_shift.team_leader_id != deployment_leader.user.id:
                            crew_shift.team_leader = deployment_leader.user
                            update_fields.append('team_leader')
                        if crew_shift.attendance_submitted_by_id != recorded_by.id:
                            crew_shift.attendance_submitted_by = recorded_by
                            update_fields.append('attendance_submitted_by')
                        if crew_shift.attendance_submitted_at is None:
                            crew_shift.attendance_submitted_at = now
                            update_fields.append('attendance_submitted_at')
                        if update_fields:
                            crew_shift.save(update_fields=update_fields)

                    if snapshot is None:
                        snapshot = ShiftCrewRosterSnapshot.objects.create(
                            driver_shift=shift,
                            crew_shift=crew_shift,
                            staged_by=recorded_by,
                        )
                        for m in eligible_memberships:
                            ShiftCrewRosterItem.objects.create(
                                snapshot=snapshot,
                                worker=locked_workers.get(m.worker_id, m.worker),
                                role_in_roster=m.role_in_team,
                                is_present=True,
                            )

                    records = []
                    for w_id in sorted(submitted_map.keys()):
                        rec = CrewAttendanceRecord.objects.create(
                            driver_shift=shift,
                            crew_shift=crew_shift,
                            worker_id=w_id,
                            status=submitted_map[w_id],
                            checked_in_by=recorded_by,
                        )
                        records.append(rec)

                    return records, crew_shift
            except _ConcurrentShiftOrTeamMove:
                if attempt == max_attempts - 1:
                    raise ActiveShiftConflictError({
                        'concurrent_change': (
                            f"Deployment team or shift state changed concurrently for Schedule #{schedule_id}; please retry."
                        )
                    })

    @staticmethod
    def record_initial_attendance(
        driver_shift_id: int,
        attendance_list: list,
        recorded_by
    ) -> list:
        """
        Records immutable initial crew attendance (C1) via a DriverShift context.
        Delegates to record_deployment_attendance while preserving shift-scoped validation.
        """
        shift = DriverShift.objects.select_related('schedule', 'allocation', 'crew_shift__watcher_shift').filter(
            id=driver_shift_id
        ).first()
        if not shift:
            raise ValidationError({'driver_shift_id': f"Shift #{driver_shift_id} not found."})

        if is_admin_user(recorded_by):
            raise PermissionDenied("Administrators cannot submit initial crew attendance on behalf of the Team Leader.")

        user_role = getattr(recorded_by, 'role', '')
        if (
            not recorded_by
            or not getattr(recorded_by, 'is_authenticated', False)
            or not getattr(recorded_by, 'is_active', False)
            or user_role not in ('watcher', 'driver')
        ):
            raise PermissionDenied(
                "Only the designated active Team Leader (Watcher or Driver) may submit initial crew attendance."
            )

        schedule = shift.schedule or (shift.allocation.schedule if shift.allocation_id else None)
        if not schedule:
            raise ValidationError({'schedule': f"Shift #{shift.id} has no linked schedule for leader resolution."})

        crew_shift = getattr(shift, 'crew_shift', None)
        if shift.allocation_id and shift.allocation:
            service_date = shift.allocation.allocation_date
        elif crew_shift and crew_shift.watcher_shift_id and crew_shift.watcher_shift:
            service_date = crew_shift.watcher_shift.shift_date
        else:
            raise ValidationError({
                'service_date': (
                    f"Shift #{shift.id} has no truck allocation or confirmed WatcherShift "
                    "to establish an authoritative service date for attendance."
                )
            })

        records, _ = ShiftService.record_deployment_attendance(
            schedule_id=schedule.id,
            service_date=service_date,
            attendance_list=attendance_list,
            recorded_by=recorded_by,
            driver_shift_id=shift.id,
            allocation_id=shift.allocation_id,
        )
        return records

    @staticmethod
    def correct_attendance(
        attendance_record_id: int,
        corrected_status: str,
        reason: str,
        corrected_by,
        driver_shift_id: int = None,
        crew_shift_id: int = None,
    ) -> CrewAttendanceCorrection:
        """
        C1 Safeguard: Append-only correction for attendance.
        """
        corrected_status = corrected_status.upper().strip()
        valid_statuses = {'PRESENT', 'ABSENT', 'LATE', 'EXCUSED'}
        if corrected_status not in valid_statuses:
            raise ValidationError({'corrected_status': f"Invalid status: {corrected_status}"})
        if not reason.strip():
            raise ValidationError({'reason': 'Audit reason is required for attendance correction.'})

        with transaction.atomic():
            rec = (
                CrewAttendanceRecord.objects.select_related('crew_shift')
                .filter(id=attendance_record_id)
                .select_for_update(of=('self',))
                .first()
            )
            if not rec:
                raise ValidationError({'attendance_record_id': f"Record #{attendance_record_id} not found."})
            if driver_shift_id is not None:
                rec_ds_id = rec.driver_shift_id or (rec.crew_shift.driver_shift_id if rec.crew_shift_id else None)
                if rec_ds_id != driver_shift_id:
                    raise ValidationError({
                        'attendance_record_id': f"Record #{attendance_record_id} does not belong to Shift #{driver_shift_id}."
                    })
            if crew_shift_id is not None and rec.crew_shift_id != crew_shift_id:
                raise ValidationError({
                    'attendance_record_id': f"Record #{attendance_record_id} does not belong to CrewShift #{crew_shift_id}."
                })

            # Authorization check: only active original submitting Team Leader (Watcher or Driver) or Admin
            if (
                not corrected_by
                or not getattr(corrected_by, 'is_authenticated', False)
                or not getattr(corrected_by, 'is_active', False)
            ):
                raise PermissionDenied(
                    "Only an active, authenticated Team Leader or Administrator can correct attendance records."
                )
            user_role = getattr(corrected_by, 'role', '')
            is_admin = is_admin_user(corrected_by)
            is_original_submitter = (rec.checked_in_by_id == getattr(corrected_by, 'id', None)) and (user_role in ('watcher', 'driver'))
            if not (is_admin or is_original_submitter):
                raise PermissionDenied(
                    "Only the original submitting Team Leader or an Administrator can correct attendance records."
                )

            # Find the most recent status (deterministic sequence ordering under lock)
            latest_corr = rec.corrections.order_by('-correction_sequence', '-corrected_at').first()
            previous_status = latest_corr.corrected_status if latest_corr else rec.status
            next_seq = (latest_corr.correction_sequence if latest_corr else 0) + 1

            if previous_status == corrected_status:
                raise ValidationError({'corrected_status': f"Worker status is already {corrected_status}."})

            correction = CrewAttendanceCorrection.objects.create(
                original_record=rec,
                correction_sequence=next_seq,
                previous_status=previous_status,
                corrected_status=corrected_status,
                reason=reason.strip(),
                corrected_by=corrected_by,
            )
            return correction

    @staticmethod
    def get_effective_shift_attendance(driver_shift_id: int = None, crew_shift_id: int = None) -> list:
        """
        Deterministic resolution of crew attendance status including append-only corrections.
        """
        if not driver_shift_id and not crew_shift_id:
            return []

        rec_q = Q(pk__isnull=True)
        if crew_shift_id:
            rec_q |= Q(crew_shift_id=crew_shift_id)
            cs = CrewShift.objects.filter(id=crew_shift_id).only('driver_shift_id').first()
            if cs and cs.driver_shift_id:
                rec_q |= Q(driver_shift_id=cs.driver_shift_id)
        if driver_shift_id:
            rec_q |= Q(driver_shift_id=driver_shift_id) | Q(crew_shift__driver_shift_id=driver_shift_id)

        records = (
            CrewAttendanceRecord.objects.filter(rec_q)
            .select_related('worker', 'checked_in_by')
            .prefetch_related('corrections__corrected_by')
            .order_by('id')
        )

        result = []
        for r in records:
            corrections = sorted(
                r.corrections.all(),
                key=lambda c: (c.correction_sequence, c.corrected_at, c.id),
            )
            latest_corr = corrections[-1] if corrections else None
            effective_status = latest_corr.corrected_status if latest_corr else r.status
            corrections_payload = [
                {
                    'id': c.id,
                    'correction_sequence': c.correction_sequence,
                    'previous_status': c.previous_status,
                    'new_status': c.corrected_status,
                    'corrected_status': c.corrected_status,
                    'reason': c.reason,
                    'corrected_by_username': c.corrected_by.username if c.corrected_by_id else None,
                    'corrected_by_name': (
                        (getattr(c.corrected_by, 'full_name', '') or '').strip()
                        or c.corrected_by.username
                    ) if c.corrected_by_id else None,
                    'corrected_at': c.corrected_at,
                }
                for c in corrections
            ]
            result.append({
                'id': r.id,
                'record_id': r.id,
                'worker_id': r.worker.id,
                'worker_name': r.worker.full_name,
                'employee_id': r.worker.employee_id,
                'initial_status': r.status,
                'status': effective_status,
                'effective_status': effective_status,
                'is_corrected': bool(latest_corr),
                'correction_count': len(corrections),
                'latest_correction_reason': latest_corr.reason if latest_corr else None,
                'corrections': corrections_payload,
                'checked_in_by_username': r.checked_in_by.username if r.checked_in_by_id else None,
                'recorded_at': r.recorded_at,
            })
        return result

    @staticmethod
    def _serialize_personal_attendance_record(
        rec: CrewAttendanceRecord,
        viewer_user=None,
        redact_operational_context: bool = True,
    ) -> dict:
        """
        Serializes a single CrewAttendanceRecord using ONLY persisted foreign keys.
        Never reconstructs historical shift/team associations from current team memberships.
        When redact_operational_context=True (for Citizen Crew Members), omits vehicle plates,
        dumpsite details, driver identifiers, and coworkers' records.
        """
        cs = rec.crew_shift if rec.crew_shift_id else None
        ds = rec.driver_shift if rec.driver_shift_id else (cs.driver_shift if (cs and cs.driver_shift_id) else None)
        ws = cs.watcher_shift if (cs and cs.watcher_shift_id) else None
        alloc = (
            cs.allocation
            if (cs and cs.allocation_id)
            else (ds.allocation if (ds and ds.allocation_id) else None)
        )
        team = (
            cs.team
            if (cs and cs.team_id)
            else (alloc.team if (alloc and alloc.team_id) else None)
        )
        sched = (
            cs.schedule
            if (cs and cs.schedule_id)
            else (
                alloc.schedule
                if (alloc and alloc.schedule_id)
                else (
                    ds.schedule
                    if (ds and ds.schedule_id)
                    else (ws.schedule if (ws and ws.schedule_id) else None)
                )
            )
        )

        if cs and cs.service_date:
            service_date = cs.service_date
        elif alloc and alloc.allocation_date:
            service_date = alloc.allocation_date
        elif ws and ws.shift_date:
            service_date = ws.shift_date
        elif ds and ds.started_at:
            service_date = timezone.localdate(ds.started_at)
        elif rec.recorded_at:
            service_date = timezone.localdate(rec.recorded_at)
        else:
            service_date = None

        corrections = sorted(
            rec.corrections.all(),
            key=lambda c: (c.correction_sequence, c.corrected_at, c.id),
        )
        latest_corr = corrections[-1] if corrections else None
        effective_status = latest_corr.corrected_status if latest_corr else rec.status
        corrections_payload = [
            {
                'id': c.id,
                'correction_sequence': c.correction_sequence,
                'previous_status': c.previous_status,
                'new_status': c.corrected_status,
                'corrected_status': c.corrected_status,
                'reason': c.reason,
                'corrected_by_username': c.corrected_by.username if c.corrected_by_id else None,
                'corrected_by_name': (
                    (getattr(c.corrected_by, 'full_name', '') or '').strip()
                    or c.corrected_by.username
                ) if c.corrected_by_id else None,
                'corrected_at': c.corrected_at,
            }
            for c in corrections
        ]

        submitted_by_user = rec.checked_in_by if rec.checked_in_by_id else (
            cs.attendance_submitted_by if (cs and cs.attendance_submitted_by_id) else None
        )
        submitted_by_name = (
            ((getattr(submitted_by_user, 'full_name', '') or '').strip() or submitted_by_user.username)
            if submitted_by_user
            else None
        )
        submitted_by_role = getattr(submitted_by_user, 'role', None) if submitted_by_user else None

        if cs and cs.team_leader_id:
            leadership_mode = getattr(cs.team_leader, 'role', None)
        elif cs and cs.watcher_shift_id:
            leadership_mode = 'watcher'
        elif submitted_by_role in ('watcher', 'driver'):
            leadership_mode = submitted_by_role
        else:
            leadership_mode = None

        shift_started_at = (cs.started_at if cs else None) or (ds.started_at if ds else None)
        shift_ended_at = (
            cs.ended_at
            if (cs and cs.ended_at)
            else (ds.ended_at if (ds and ds.ended_at) else None)
        )
        shift_is_active = bool((cs and cs.is_active) or (ds and ds.is_active))

        can_correct = False
        if viewer_user and getattr(viewer_user, 'is_authenticated', False) and getattr(viewer_user, 'is_active', False):
            v_role = getattr(viewer_user, 'role', '')
            can_correct = bool(
                is_admin_user(viewer_user)
                or (rec.checked_in_by_id == viewer_user.id and v_role in ('watcher', 'driver'))
            )

        payload = {
            'id': rec.id,
            'record_id': rec.id,
            'worker_id': rec.worker_id,
            'worker_name': rec.worker.full_name if rec.worker_id else None,
            'employee_id': rec.worker.employee_id if rec.worker_id else None,
            'crew_shift_id': cs.id if cs else None,
            'service_date': service_date.isoformat() if service_date else None,
            'schedule_id': sched.id if sched else None,
            'schedule_area': sched.area if sched else None,
            'team_id': team.id if team else None,
            'team_name': team.name if team else None,
            'team_code': team.code if team else None,
            'leadership_mode': leadership_mode,
            'initial_status': rec.status,
            'status': effective_status,
            'effective_status': effective_status,
            'is_corrected': bool(latest_corr),
            'correction_count': len(corrections),
            'latest_correction_reason': latest_corr.reason if latest_corr else None,
            'corrections': corrections_payload,
            'checked_in_by_username': rec.checked_in_by.username if rec.checked_in_by_id else None,
            'submitted_by_name': submitted_by_name,
            'submitted_by_role': submitted_by_role,
            'recorded_at': rec.recorded_at,
            'shift_started_at': shift_started_at,
            'shift_ended_at': shift_ended_at,
            'shift_is_active': shift_is_active,
            'can_correct': can_correct,
        }

        if not redact_operational_context:
            payload['driver_shift_id'] = ds.id if ds else None
            payload['watcher_shift_id'] = ws.id if ws else None
            truck = (alloc.truck if (alloc and alloc.truck_id) else None) or (ds.truck if (ds and ds.truck_id) else None)
            payload['truck_plate'] = truck.plate_number if truck else None

        return payload

    @staticmethod
    def get_personal_attendance_history(user) -> dict:
        """
        Stage 5B authoritative personal profile attendance & shift history.
        Strictly scoped to `user` (never trusting client parameters).
        Uses ONLY persisted DB foreign keys — never reconstructs historical records from
        current SanitationTeamMembership or heuristic (team, schedule, date) matching.
        Enforces role-based privacy redaction for Citizen Crew Members.
        """
        if not user or not getattr(user, 'is_authenticated', False):
            raise PermissionDenied("Authentication is required.")

        is_admin = is_admin_user(user)
        user_role = getattr(user, 'role', 'citizen') or 'citizen'
        employee_type = getattr(user, 'employee_type', '') or ''
        is_citizen_only = (user_role == 'citizen' and not is_admin)

        worker = Worker.objects.filter(user=user).first()
        active_membership = None
        if worker:
            m = (
                SanitationTeamMembership.objects
                .filter(worker=worker, is_active=True, team__is_active=True)
                .select_related('team')
                .first()
            )
            if m:
                active_membership = {
                    'membership_id': m.id,
                    'team_id': m.team_id,
                    'team_name': m.team.name,
                    'team_code': m.team.code,
                    'role_in_team': m.role_in_team,
                    'joined_at': m.joined_at,
                }

        personal_attendance = []
        if worker:
            records_qs = (
                CrewAttendanceRecord.objects.filter(worker=worker)
                .select_related(
                    'worker',
                    'checked_in_by',
                    'crew_shift__team',
                    'crew_shift__schedule',
                    'crew_shift__team_leader',
                    'crew_shift__attendance_submitted_by',
                    'crew_shift__allocation__team',
                    'crew_shift__allocation__schedule',
                    'crew_shift__allocation__truck',
                    'crew_shift__driver_shift__schedule',
                    'crew_shift__driver_shift__truck',
                    'crew_shift__driver_shift__allocation__team',
                    'crew_shift__driver_shift__allocation__schedule',
                    'crew_shift__watcher_shift__schedule',
                    'driver_shift__schedule',
                    'driver_shift__truck',
                    'driver_shift__allocation__team',
                    'driver_shift__allocation__schedule',
                    'driver_shift__allocation__truck',
                )
                .prefetch_related('corrections__corrected_by')
                .order_by('-recorded_at', '-id')
            )
            for rec in records_qs:
                personal_attendance.append(
                    ShiftService._serialize_personal_attendance_record(
                        rec,
                        viewer_user=user,
                        redact_operational_context=is_citizen_only,
                    )
                )

        attendance_summary = {
            'total': len(personal_attendance),
            'present': sum(1 for r in personal_attendance if r['effective_status'] == 'PRESENT'),
            'late': sum(1 for r in personal_attendance if r['effective_status'] == 'LATE'),
            'absent': sum(1 for r in personal_attendance if r['effective_status'] == 'ABSENT'),
            'excused': sum(1 for r in personal_attendance if r['effective_status'] == 'EXCUSED'),
            'corrected': sum(1 for r in personal_attendance if r['is_corrected']),
        }

        driver_shifts = []
        watcher_shifts = []
        led_crew_shifts = []
        limitations = []

        if not is_citizen_only:
            if user_role == 'driver' or is_admin:
                ds_qs = (
                    DriverShift.objects.filter(driver=user)
                    .select_related(
                        'truck',
                        'schedule',
                        'allocation__team',
                        'allocation__truck',
                        'allocation__schedule',
                        'crew_shift__team',
                        'crew_shift__team_leader',
                        'crew_shift__attendance_submitted_by',
                    )
                    .order_by('-started_at', '-id')[:50]
                )
                unlinked_ds_count = 0
                for s in ds_qs:
                    cs = getattr(s, 'crew_shift', None)
                    eff_team = s.effective_team or (cs.team if (cs and cs.team_id) else None)
                    eff_sched = s.effective_schedule or (cs.schedule if (cs and cs.schedule_id) else None)
                    eff_truck = s.effective_truck
                    svc_date = (
                        cs.service_date
                        if (cs and cs.service_date)
                        else (
                            s.allocation.allocation_date
                            if (s.allocation_id and s.allocation)
                            else (timezone.localdate(s.started_at) if s.started_at else None)
                        )
                    )
                    if not eff_team and not cs:
                        unlinked_ds_count += 1
                    sub_u = cs.attendance_submitted_by if (cs and cs.attendance_submitted_by_id) else None
                    sub_name = (
                        ((getattr(sub_u, 'full_name', '') or '').strip() or sub_u.username)
                        if sub_u
                        else None
                    )
                    driver_shifts.append({
                        'id': s.id,
                        'status': s.status,
                        'op_status': s.op_status,
                        'is_active': s.is_active,
                        'started_at': s.started_at,
                        'ended_at': s.ended_at,
                        'duration_ms': s.duration_ms,
                        'end_reason': s.end_reason,
                        'end_reason_notes': s.end_reason_notes,
                        'service_date': svc_date.isoformat() if svc_date else None,
                        'schedule_id': eff_sched.id if eff_sched else None,
                        'schedule_area': eff_sched.area if eff_sched else None,
                        'team_id': eff_team.id if eff_team else None,
                        'team_name': eff_team.name if eff_team else None,
                        'team_code': eff_team.code if eff_team else None,
                        'truck_id': eff_truck.id if eff_truck else None,
                        'truck_plate': eff_truck.plate_number if eff_truck else None,
                        'truck_model': eff_truck.model if eff_truck else None,
                        'crew_shift_id': cs.id if cs else None,
                        'attendance_submitted': bool(cs and cs.attendance_submitted_at),
                        'attendance_submitted_at': cs.attendance_submitted_at if cs else None,
                        'attendance_submitted_by_name': sub_name,
                        'leadership_mode': (
                            getattr(cs.team_leader, 'role', None)
                            if (cs and cs.team_leader_id)
                            else ('watcher' if (cs and cs.watcher_shift_id) else None)
                        ),
                    })
                if unlinked_ds_count > 0:
                    limitations.append(
                        f"{unlinked_ds_count} historical DriverShift record(s) precede allocation/CrewShift persistence and omit team attribution rather than inferring it."
                    )

            if user_role == 'watcher' or is_admin:
                ws_qs = (
                    WatcherShift.objects.filter(watcher=user)
                    .select_related(
                        'schedule',
                        'barangay',
                        'crew_shift__team',
                        'crew_shift__allocation__team',
                        'crew_shift__attendance_submitted_by',
                    )
                    .order_by('-shift_date', '-started_at', '-id')[:50]
                )
                unlinked_ws_count = 0
                for ws in ws_qs:
                    cs = getattr(ws, 'crew_shift', None)
                    team = (
                        cs.team
                        if (cs and cs.team_id)
                        else (cs.allocation.team if (cs and cs.allocation_id and cs.allocation.team_id) else None)
                    )
                    if not cs:
                        unlinked_ws_count += 1
                    watcher_shifts.append({
                        'id': ws.id,
                        'shift_date': ws.shift_date.isoformat() if ws.shift_date else None,
                        'is_active': ws.is_active,
                        'end_reason': ws.end_reason,
                        'started_at': ws.started_at,
                        'ended_at': ws.ended_at,
                        'schedule_id': ws.schedule_id,
                        'schedule_area': ws.schedule.area if ws.schedule_id else None,
                        'barangay_id': ws.barangay_id,
                        'barangay_name': ws.barangay.name if ws.barangay_id else None,
                        'crew_shift_id': cs.id if cs else None,
                        'team_id': team.id if team else None,
                        'team_name': team.name if team else None,
                        'team_code': team.code if team else None,
                        'attendance_submitted': bool(cs and cs.attendance_submitted_at),
                        'attendance_submitted_at': cs.attendance_submitted_at if cs else None,
                    })
                if unlinked_ws_count > 0:
                    limitations.append(
                        f"{unlinked_ws_count} WatcherShift record(s) have no persisted CrewShift link; team attribution is omitted rather than fabricated."
                    )

            if user_role in ('driver', 'watcher') or is_admin:
                led_cs_qs = (
                    CrewShift.objects.filter(
                        Q(team_leader=user) | Q(attendance_submitted_by=user)
                    )
                    .select_related(
                        'team',
                        'schedule',
                        'allocation__team',
                        'allocation__schedule',
                        'allocation__truck',
                        'driver_shift__schedule',
                        'driver_shift__truck',
                        'driver_shift__allocation__team',
                        'watcher_shift__schedule',
                        'team_leader',
                        'attendance_submitted_by',
                    )
                    .prefetch_related(
                        'attendance_records__worker',
                        'attendance_records__checked_in_by',
                        'attendance_records__corrections__corrected_by',
                    )
                    .order_by('-service_date', '-started_at', '-id')
                    .distinct()[:50]
                )
                for cs in led_cs_qs:
                    team = cs.team if cs.team_id else (cs.allocation.team if (cs.allocation_id and cs.allocation.team_id) else None)
                    sched = cs.schedule if cs.schedule_id else (cs.allocation.schedule if (cs.allocation_id and cs.allocation.schedule_id) else None)
                    records_serialized = [
                        ShiftService._serialize_personal_attendance_record(
                            r,
                            viewer_user=user,
                            redact_operational_context=False,
                        )
                        for r in sorted(cs.attendance_records.all(), key=lambda x: x.id)
                    ]
                    sub_u = cs.attendance_submitted_by if cs.attendance_submitted_by_id else None
                    sub_name = (
                        ((getattr(sub_u, 'full_name', '') or '').strip() or sub_u.username)
                        if sub_u
                        else None
                    )
                    led_crew_shifts.append({
                        'id': cs.id,
                        'driver_shift_id': cs.driver_shift_id,
                        'watcher_shift_id': cs.watcher_shift_id,
                        'allocation_id': cs.allocation_id,
                        'service_date': cs.service_date.isoformat() if cs.service_date else None,
                        'schedule_id': sched.id if sched else None,
                        'schedule_area': sched.area if sched else None,
                        'team_id': team.id if team else None,
                        'team_name': team.name if team else None,
                        'team_code': team.code if team else None,
                        'team_leader_username': cs.team_leader.username if cs.team_leader_id else None,
                        'leadership_mode': getattr(cs.team_leader, 'role', None) if cs.team_leader_id else None,
                        'attendance_submitted_by_username': sub_u.username if sub_u else None,
                        'attendance_submitted_by_name': sub_name,
                        'attendance_submitted_at': cs.attendance_submitted_at,
                        'is_active': cs.is_active,
                        'started_at': cs.started_at,
                        'ended_at': cs.ended_at,
                        'attendance_count': len(records_serialized),
                        'attendance_records': records_serialized,
                    })

        return {
            'user_id': user.id,
            'username': user.username,
            'full_name': (getattr(user, 'full_name', '') or '').strip() or user.username,
            'role': user_role,
            'employee_type': employee_type,
            'is_crew_member': bool(employee_type == 'crew_member'),
            'is_admin': is_admin,
            'worker': {
                'id': worker.id,
                'employee_id': worker.employee_id,
                'full_name': worker.full_name,
                'is_active': worker.is_active,
            } if worker else None,
            'active_membership': active_membership,
            'attendance_summary': attendance_summary,
            'personal_attendance': personal_attendance,
            'driver_shifts': driver_shifts,
            'watcher_shifts': watcher_shifts,
            'led_crew_shifts': led_crew_shifts,
            'limitations': limitations,
        }

    @staticmethod
    def get_worker_attendance_history(worker_or_id, viewer_user=None) -> dict:
        """
        Admin-only persisted attendance, shift, and team membership history for a canonical Worker
        (supporting both authenticated workers and non-login crew workers).
        """
        if isinstance(worker_or_id, Worker):
            worker = worker_or_id
        else:
            worker = Worker.objects.select_related('user').filter(pk=worker_or_id).first()
            if not worker:
                raise ValidationError({'worker_id': f"Worker #{worker_or_id} not found."})

        memberships = list(
            SanitationTeamMembership.objects.filter(worker=worker)
            .select_related('team', 'created_by')
            .order_by('-is_active', '-joined_at', '-id')
        )
        membership_history = [
            {
                'id': m.id,
                'team_id': m.team_id,
                'team_name': m.team.name,
                'team_code': m.team.code,
                'role_in_team': m.role_in_team,
                'is_active': m.is_active,
                'joined_at': m.joined_at,
                'left_at': m.left_at,
                'created_by_username': m.created_by.username if m.created_by_id else None,
            }
            for m in memberships
        ]
        active_m = next((m for m in membership_history if m['is_active']), None)

        records_qs = (
            CrewAttendanceRecord.objects.filter(worker=worker)
            .select_related(
                'worker',
                'checked_in_by',
                'crew_shift__team',
                'crew_shift__schedule',
                'crew_shift__team_leader',
                'crew_shift__attendance_submitted_by',
                'crew_shift__allocation__team',
                'crew_shift__allocation__schedule',
                'crew_shift__allocation__truck',
                'crew_shift__driver_shift__schedule',
                'crew_shift__driver_shift__truck',
                'crew_shift__driver_shift__allocation__team',
                'crew_shift__watcher_shift__schedule',
                'driver_shift__schedule',
                'driver_shift__truck',
                'driver_shift__allocation__team',
                'driver_shift__allocation__schedule',
                'driver_shift__allocation__truck',
            )
            .prefetch_related('corrections__corrected_by')
            .order_by('-recorded_at', '-id')
        )
        personal_attendance = [
            ShiftService._serialize_personal_attendance_record(
                rec,
                viewer_user=viewer_user,
                redact_operational_context=False,
            )
            for rec in records_qs
        ]
        attendance_summary = {
            'total': len(personal_attendance),
            'present': sum(1 for r in personal_attendance if r['effective_status'] == 'PRESENT'),
            'late': sum(1 for r in personal_attendance if r['effective_status'] == 'LATE'),
            'absent': sum(1 for r in personal_attendance if r['effective_status'] == 'ABSENT'),
            'excused': sum(1 for r in personal_attendance if r['effective_status'] == 'EXCUSED'),
            'corrected': sum(1 for r in personal_attendance if r['is_corrected']),
        }

        driver_shifts = []
        watcher_shifts = []
        led_crew_shifts = []
        limitations = []
        if worker.user_id and worker.user:
            user_hist = ShiftService.get_personal_attendance_history(worker.user)
            driver_shifts = user_hist.get('driver_shifts', [])
            watcher_shifts = user_hist.get('watcher_shifts', [])
            led_crew_shifts = user_hist.get('led_crew_shifts', [])
            limitations = user_hist.get('limitations', [])

        return {
            'worker': {
                'id': worker.id,
                'employee_id': worker.employee_id,
                'full_name': worker.full_name,
                'is_active': worker.is_active,
                'user_id': worker.user_id,
                'user_username': worker.user.username if worker.user_id else None,
                'user_role': getattr(worker.user, 'role', None) if worker.user_id else None,
                'employee_type': getattr(worker.user, 'employee_type', 'crew_member') if worker.user_id else 'crew_member',
            },
            'active_membership': active_m,
            'membership_history': membership_history,
            'attendance_summary': attendance_summary,
            'personal_attendance': personal_attendance,
            'driver_shifts': driver_shifts,
            'watcher_shifts': watcher_shifts,
            'led_crew_shifts': led_crew_shifts,
            'limitations': limitations,
        }

    @staticmethod
    def conclude_shift_atomic(
        driver_shift_id: int,
        concluded_by,
        end_reason: str = 'completed',
        end_reason_notes: str = '',
        ended_at=None,
    ) -> DriverShift:
        """
        Concludes a DriverShift together with its reliably associated CrewShift and WatcherShift
        in one atomic transaction.
        Canonical lock order: Truck (Level 5) -> DriverShift (Level 8) -> CrewShift (Level 9) -> WatcherShift (Level 10).
        D-12 Stop Status Preservation: uses authoritative per-service-date StopValidation records,
        preserves their status and evidence, and creates unreviewed UnfinishedStopReview records
        idempotently (with reviewed_by=None, reviewed_at=None).
        """
        now = ended_at or timezone.now()
        categorical_reason = (end_reason or 'completed').strip()[:20]
        bounded_notes = (end_reason_notes or '').strip()[:255]

        class _ConcurrentShiftTruckMove(Exception):
            pass

        max_attempts = 3
        for attempt in range(max_attempts):
            observed = (
                DriverShift.objects.filter(id=driver_shift_id)
                .values('id', 'is_active', 'truck_id', 'allocation__truck_id')
                .first()
            )
            if not observed:
                raise ValidationError({'driver_shift_id': f"Shift #{driver_shift_id} not found."})
            obs_truck_id = observed['truck_id'] or observed['allocation__truck_id']

            try:
                with transaction.atomic():
                    # 0. Acquire Truck (Level 5) BEFORE DriverShift (Level 8)
                    locked_truck = (
                        Truck.objects.filter(id=obs_truck_id).select_for_update().first()
                        if obs_truck_id is not None
                        else None
                    )
                    shift = (
                        DriverShift.objects.select_related('allocation')
                        .filter(id=driver_shift_id)
                        .select_for_update(of=('self',))
                        .first()
                    )
                    if not shift:
                        raise ValidationError({'driver_shift_id': f"Shift #{driver_shift_id} not found."})
                    if not shift.is_active:
                        return shift

                    actual_truck_id = shift.truck_id or (
                        shift.allocation.truck_id if shift.allocation_id and shift.allocation else None
                    )
                    if actual_truck_id != obs_truck_id:
                        raise _ConcurrentShiftTruckMove()

                    # 1. Close driver shift (end_reason stays categorical <= 20 chars; free text goes to end_reason_notes)
                    shift.is_active = False
                    shift.status = 'end_shift'
                    shift.end_reason = categorical_reason
                    shift.end_reason_notes = bounded_notes
                    shift.ended_at = now
                    shift.current_latitude = None
                    shift.current_longitude = None
                    shift.last_location_update = None
                    if shift.started_at:
                        shift.duration_ms = max(0, int((now - shift.started_at).total_seconds() * 1000))
                    shift.save(update_fields=[
                        'is_active', 'status', 'end_reason', 'end_reason_notes', 'ended_at', 'duration_ms',
                        'current_latitude', 'current_longitude', 'last_location_update',
                    ])

                    # 2. Close linked CrewShift(s) and ONLY the explicitly associated, schedule-matching WatcherShift
                    crew_filter = Q(driver_shift=shift)
                    if shift.allocation_id:
                        crew_filter |= Q(allocation_id=shift.allocation_id, driver_shift__isnull=True)
                    linked_crew_shifts = list(
                        CrewShift.objects.filter(crew_filter).select_for_update().order_by('id')
                    )
                    for crew_shift in linked_crew_shifts:
                        if crew_shift.watcher_shift_id is None:
                            continue
                        linked_watcher_shift = (
                            WatcherShift.objects.select_for_update()
                            .filter(pk=crew_shift.watcher_shift_id, is_active=True)
                            .first()
                        )
                        if linked_watcher_shift is None:
                            continue
                        if shift.schedule_id is None or linked_watcher_shift.schedule_id != shift.schedule_id:
                            logger.warning(
                                "Mismatched or missing schedule on linked WatcherShift #%s (schedule=%s) while concluding DriverShift #%s (schedule=%s). Skipping WatcherShift closure.",
                                linked_watcher_shift.id,
                                linked_watcher_shift.schedule_id,
                                shift.id,
                                shift.schedule_id,
                            )
                            continue
                        linked_watcher_shift.is_active = False
                        linked_watcher_shift.ended_at = now
                        linked_watcher_shift.end_reason = categorical_reason
                        linked_watcher_shift.save(update_fields=['is_active', 'ended_at', 'end_reason'])

                    CrewShift.objects.filter(
                        crew_filter,
                        is_active=True,
                    ).update(is_active=False, ended_at=now)

                    # 3. D-12 Stop Status Preservation using authoritative per-service-date StopValidation data
                    if shift.schedule_id:
                        service_date = (
                            shift.allocation.allocation_date
                            if shift.allocation_id and shift.allocation
                            else (timezone.localdate(shift.started_at) if shift.started_at else timezone.localdate())
                        )
                        resolved_statuses = {
                            StopValidationStatus.VERIFIED_COLLECTED,
                            StopValidationStatus.COLLECTION_REPORTED,
                            StopValidationStatus.EMPTY_STOP,
                            StopValidationStatus.COLLECTION_DISPUTED,
                        }
                        unfinished_validations = StopValidation.objects.filter(
                            schedule_id=shift.schedule_id,
                            collection_date=service_date,
                        ).exclude(current_status__in=resolved_statuses).order_by('stop_order')

                        for sv in unfinished_validations:
                            UnfinishedStopReview.objects.get_or_create(
                                shift=shift,
                                stop_order=sv.stop_order,
                                defaults={
                                    'stop_validation': sv,
                                    'service_date': service_date,
                                    'recorded_status': sv.current_status,
                                    'reason': bounded_notes or categorical_reason,
                                    'resolution_status': 'PENDING',
                                    'reviewed_by': None,
                                    'reviewed_at': None,
                                },
                            )

                    # 4. Release pre-locked Truck ONLY if it passes operational & post-shift inspection checks
                    if shift.truck_id and locked_truck:
                        if (
                            locked_truck.status == 'active'
                            and not locked_truck.is_retired
                            and not locked_truck.is_operational_hold
                            and locked_truck.mechanical_status == 'serviceable'
                            and locked_truck.maintenance_status == 'available'
                            and locked_truck.mechanical_condition == 'OPERATIONAL'
                            and locked_truck.inspection_state == 'PASSED'
                            and locked_truck.op_status != 'MAINTENANCE'
                        ):
                            locked_truck.op_status = 'AVAILABLE'
                            locked_truck.save(update_fields=['op_status'])

                    return shift
            except _ConcurrentShiftTruckMove:
                if attempt == max_attempts - 1:
                    raise ActiveShiftConflictError({
                        'driver_shift_id': f"Shift #{driver_shift_id} truck association changed concurrently; please retry."
                    })

    @staticmethod
    def cleanup_stale_unlinked_watcher_shifts(watcher_user=None, now=None) -> list:
        """
        Safely and idempotently closes prior-date WatcherShifts and orphaned prior-date
        pre-departure CrewShifts (driver_shift__isnull=True) that were never linked to
        any DriverShift.
        - Never closes current-date WatcherShifts or CrewShifts.
        - Never touches CrewAttendanceRecord or ShiftCrewRosterSnapshot rows.
        - Records explicit end_reason='stale_unlinked_cleanup' and ended_at timestamp.
        - Never fabricates DriverShift, CrewShift, attendance, or stop records.
        """
        cutoff_now = now or timezone.now()
        today = timezone.localdate(cutoff_now)
        closed_ids = []

        # 1. Close orphaned prior-date pre-departure CrewShifts (driver_shift__isnull=True)
        #    and their linked prior-date WatcherShifts in canonical CrewShift -> WatcherShift order.
        with transaction.atomic():
            cs_qs = CrewShift.objects.filter(
                driver_shift__isnull=True,
                is_active=True,
                service_date__lt=today,
            )
            if watcher_user is not None:
                cs_qs = cs_qs.filter(
                    Q(watcher_shift__watcher=watcher_user) | Q(team_leader=watcher_user)
                )
            candidate_cs_ids = list(cs_qs.order_by('id').values_list('id', flat=True))

        for cs_id in candidate_cs_ids:
            try:
                with transaction.atomic():
                    cs = (
                        CrewShift.objects
                        .filter(
                            id=cs_id,
                            driver_shift__isnull=True,
                            is_active=True,
                            service_date__lt=today,
                        )
                        .select_for_update()
                        .first()
                    )
                    if not cs:
                        continue
                    if cs.watcher_shift_id:
                        ws = (
                            WatcherShift.objects
                            .filter(id=cs.watcher_shift_id, is_active=True, shift_date__lt=today)
                            .select_for_update(of=('self',))
                            .first()
                        )
                        if ws:
                            ws.is_active = False
                            ws.ended_at = cutoff_now
                            ws.end_reason = 'stale_unlinked_cleanup'
                            ws.save(update_fields=['is_active', 'ended_at', 'end_reason'])
                            closed_ids.append(ws.id)
                    cs.is_active = False
                    cs.ended_at = cutoff_now
                    cs.save(update_fields=['is_active', 'ended_at'])
            except Exception:
                logger.exception(
                    "Failed to clean up stale pre-departure CrewShift #%s (cutoff=%s)",
                    cs_id,
                    cutoff_now,
                )

        # 2. Close remaining prior-date WatcherShifts that were never linked to any CrewShift
        with transaction.atomic():
            qs = WatcherShift.objects.filter(is_active=True, shift_date__lt=today)
            if watcher_user is not None:
                qs = qs.filter(watcher=watcher_user)

            candidate_ids = list(qs.order_by('id').values_list('id', flat=True))

        for ws_id in candidate_ids:
            try:
                with transaction.atomic():
                    ws = (
                        WatcherShift.objects
                        .filter(id=ws_id, is_active=True, shift_date__lt=today)
                        .select_for_update(of=('self',))
                        .first()
                    )
                    if not ws:
                        continue
                    if CrewShift.objects.filter(watcher_shift=ws).exists():
                        continue
                    ws.is_active = False
                    ws.ended_at = cutoff_now
                    ws.end_reason = 'stale_unlinked_cleanup'
                    ws.save(update_fields=['is_active', 'ended_at', 'end_reason'])
                    closed_ids.append(ws.id)
            except Exception:
                logger.exception(
                    "Failed to clean up stale unlinked WatcherShift #%s (cutoff=%s)",
                    ws_id,
                    cutoff_now,
                )

        return closed_ids

