from datetime import date
from django.contrib.auth import get_user_model
from django.db import transaction
from django.core.exceptions import ValidationError
from django.utils import timezone
from .models import (
    CollectionSchedule,
    Truck,
    SanitationTeam,
    SanitationTeamMembership,
    ScheduleTeamOverride,
    ScheduleTruckAllocation,
    Worker,
    is_truck_dispatchable,
)

User = get_user_model()
_UNSET = object()


class AllocationService:
    """
    Domain service for D-10 Schedule-Team resolution, date-specific overrides,
    and D-11 Pre-allocated Truck binding.
    """

    @staticmethod
    def resolve_schedule_team(schedule_id: int, target_date: date = None) -> SanitationTeam:
        if target_date is None:
            target_date = timezone.localdate()

        schedule = CollectionSchedule.objects.filter(id=schedule_id).first()
        if not schedule:
            raise ValidationError({'schedule_id': f"Schedule #{schedule_id} not found."})

        # 1. Date-specific override takes top precedence (D-10)
        override = ScheduleTeamOverride.objects.filter(
            schedule=schedule,
            effective_date=target_date
        ).select_related('team').first()

        if override:
            if not override.team.is_active:
                raise ValidationError({
                    'team': f"Override team {override.team.code} for Schedule #{schedule_id} on {target_date} is inactive."
                })
            return override.team

        # 2. Schedule default team (D-10 baseline)
        if schedule.default_team:
            if not schedule.default_team.is_active:
                raise ValidationError({
                    'team': f"Default team {schedule.default_team.code} for Schedule #{schedule_id} is inactive."
                })
            return schedule.default_team

        raise ValidationError({
            'team': (
                f"Schedule #{schedule_id} has no ScheduleTeamOverride for {target_date} "
                "and no default_team configured."
            )
        })

    @staticmethod
    def _validate_team_readiness_for_allocation(
        schedule: CollectionSchedule,
        target_date: date,
        resolved_team: SanitationTeam,
    ) -> None:
        from .team_service import TeamService

        team_worker_ids = sorted(
            SanitationTeamMembership.objects.filter(
                team=resolved_team,
                is_active=True,
            ).values_list('worker_id', flat=True)
        )
        if team_worker_ids:
            list(
                Worker.objects.select_related('user')
                .filter(id__in=team_worker_ids)
                .order_by('id')
                .select_for_update(of=('self',))
            )
        active_memberships = list(
            SanitationTeamMembership.objects.select_related('worker__user')
            .filter(team=resolved_team, is_active=True)
            .order_by('id')
            .select_for_update(of=('self',))
        )

        # 1. Must have a valid active Team Leader (Watcher or Driver)
        TeamService.resolve_deployment_team_leader(schedule, target_date)

        # 2. Must have at least one active, non-suspended Driver (either role_in_team='driver' or Driver-Team Leader)
        has_eligible_driver = False
        for m in active_memberships:
            if m.role_in_team not in ('driver', 'leader'):
                continue
            w = m.worker
            if not w or not w.is_active or not w.user_id or not w.user:
                continue
            u = w.user
            if not getattr(u, 'is_active', False) or getattr(u, 'role', None) != 'driver':
                continue
            profile = getattr(u, 'driverprofile', None)
            is_suspended = bool(
                getattr(u, 'is_suspended', False)
                or (profile and getattr(profile, 'is_suspended', False))
            )
            if not is_suspended:
                has_eligible_driver = True
                break

        if not has_eligible_driver:
            raise ValidationError({
                'team_id': (
                    f"Team {resolved_team.code} has no active, non-suspended Driver "
                    "and is not ready for truck allocation."
                )
            })

    @staticmethod
    def set_schedule_default_team(
        schedule_id: int,
        team_id: int,
    ) -> CollectionSchedule:
        from .models import DriverShift, CrewShift, WatcherShift
        from .team_service import ActiveShiftConflictError

        today = timezone.localdate()
        with transaction.atomic():
            schedule = CollectionSchedule.objects.filter(id=schedule_id).select_for_update().first()
            if not schedule:
                raise ValidationError({'schedule_id': f"Schedule #{schedule_id} not found."})
            if schedule.status in ('CANCELLED', 'COMPLETED'):
                raise ValidationError({
                    'schedule_id': f"Cannot change default team for a {schedule.status.lower()} schedule."
                })

            team = SanitationTeam.objects.filter(id=team_id, is_active=True).select_for_update().first()
            if not team:
                raise ValidationError({'team_id': f"Active team #{team_id} not found."})

            if schedule.default_team_id == team.id:
                return schedule

            if (
                DriverShift.objects.filter(schedule=schedule, is_active=True).exists()
                or CrewShift.objects.filter(schedule=schedule, is_active=True).exists()
                or WatcherShift.objects.filter(schedule=schedule, is_active=True).exists()
            ):
                raise ActiveShiftConflictError({
                    'schedule_id': (
                        f"Cannot change default team for Schedule #{schedule.id} while an active "
                        "shift exists."
                    )
                })

            if ScheduleTruckAllocation.objects.filter(schedule=schedule, allocation_date__gte=today).exists():
                raise ActiveShiftConflictError({
                    'schedule_id': (
                        f"Cannot change default team for Schedule #{schedule.id} while today or future "
                        "truck allocations exist."
                    )
                })

            schedule.default_team = team
            schedule.save(update_fields=['default_team'])
            return schedule

    @staticmethod
    def create_schedule_override(
        schedule_id: int,
        effective_date: date,
        team_id: int,
        reason: str = '',
        created_by=None,
    ) -> ScheduleTeamOverride:
        from .models import DriverShift, CrewShift
        from .team_service import ActiveShiftConflictError

        today = timezone.localdate()
        if effective_date < today:
            raise ValidationError({
                'effective_date': 'Cannot create a schedule team override for a past date.'
            })

        with transaction.atomic():
            schedule = CollectionSchedule.objects.filter(id=schedule_id).select_for_update().first()
            if not schedule:
                raise ValidationError({'schedule_id': f"Schedule #{schedule_id} not found."})
            if schedule.status in ('CANCELLED', 'COMPLETED'):
                raise ValidationError({
                    'schedule_id': f"Cannot create a team override for a {schedule.status.lower()} schedule."
                })

            team = SanitationTeam.objects.filter(id=team_id, is_active=True).select_for_update().first()
            if not team:
                raise ValidationError({'team_id': f"Active team #{team_id} not found."})

            existing_override = (
                ScheduleTeamOverride.objects
                .filter(schedule=schedule, effective_date=effective_date)
                .select_for_update()
                .first()
            )
            if (
                DriverShift.objects.filter(schedule=schedule, allocation__allocation_date=effective_date).exists()
                or CrewShift.objects.filter(schedule=schedule, service_date=effective_date).exists()
                or (
                    existing_override
                    and ScheduleTruckAllocation.objects.filter(schedule=schedule, allocation_date=effective_date).exists()
                )
                or ScheduleTruckAllocation.objects.filter(
                    schedule=schedule, allocation_date=effective_date
                ).exclude(team=team).exists()
            ):
                raise ActiveShiftConflictError({
                    'override_id': (
                        f"Cannot create or overwrite schedule team override for Schedule #{schedule.id} on {effective_date} "
                        "because a conflicting truck allocation or shift already exists for this date."
                    )
                })
            if existing_override:
                existing_override.team = team
                existing_override.reason = reason.strip()
                existing_override.created_by = created_by
                existing_override.save(update_fields=['team', 'reason', 'created_by'])
                return existing_override

            return ScheduleTeamOverride.objects.create(
                schedule=schedule,
                effective_date=effective_date,
                team=team,
                reason=reason.strip(),
                created_by=created_by,
            )

    @staticmethod
    def update_schedule_override(
        override_id: int,
        schedule_id: int = None,
        effective_date: date = None,
        team_id: int = None,
        reason: str = None,
    ) -> ScheduleTeamOverride:
        from .models import DriverShift, CrewShift
        from .team_service import ActiveShiftConflictError

        class _ConcurrentOverrideMove(Exception):
            pass

        today = timezone.localdate()
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                with transaction.atomic():
                    observed = (
                        ScheduleTeamOverride.objects
                        .filter(id=override_id)
                        .values('schedule_id', 'team_id')
                        .first()
                    )
                    if not observed:
                        raise ValidationError({'override_id': f"Override #{override_id} not found."})
                    observed_schedule_id = observed['schedule_id']
                    observed_team_id = observed['team_id']
                    target_schedule_id = schedule_id if schedule_id is not None else observed_schedule_id
                    target_team_id_obs = team_id if team_id is not None else observed_team_id

                    # Canonical lock order: CollectionSchedule (1, asc id) -> SanitationTeam (2, asc id) -> ScheduleTeamOverride (3)
                    schedule_ids = sorted({observed_schedule_id, target_schedule_id})
                    locked_schedules = {
                        s.id: s
                        for s in CollectionSchedule.objects.filter(id__in=schedule_ids).order_by('id').select_for_update()
                    }
                    schedule = locked_schedules.get(target_schedule_id)
                    if not schedule:
                        raise ValidationError({'schedule_id': f"Schedule #{target_schedule_id} not found."})

                    team_ids = sorted({observed_team_id, target_team_id_obs})
                    locked_teams = {
                        t.id: t
                        for t in SanitationTeam.objects.filter(id__in=team_ids).order_by('id').select_for_update()
                    }

                    override = ScheduleTeamOverride.objects.filter(id=override_id).select_for_update().first()
                    if not override:
                        raise ValidationError({'override_id': f"Override #{override_id} not found."})
                    if (
                        override.schedule_id != observed_schedule_id
                        or override.schedule_id not in locked_schedules
                        or override.team_id not in locked_teams
                    ):
                        raise _ConcurrentOverrideMove()

                    target_date = effective_date if effective_date is not None else override.effective_date
                    target_team_id = team_id if team_id is not None else override.team_id
                    if target_team_id not in locked_teams:
                        raise _ConcurrentOverrideMove()
                    team = locked_teams.get(target_team_id)

                    is_structural_change = (
                        target_schedule_id != override.schedule_id
                        or target_date != override.effective_date
                        or target_team_id != override.team_id
                    )

                    if is_structural_change:
                        if override.effective_date < today:
                            raise ActiveShiftConflictError({
                                'effective_date': 'Historical schedule team overrides from past dates cannot be reassigned.'
                            })
                        if target_date < today:
                            raise ValidationError({
                                'effective_date': 'Target override effective_date cannot be in the past.'
                            })
                        if schedule.status in ('CANCELLED', 'COMPLETED'):
                            raise ValidationError({
                                'schedule_id': f"Cannot move override to a {schedule.status.lower()} schedule."
                            })
                        if (
                            DriverShift.objects.filter(
                                schedule_id=override.schedule_id,
                                allocation__allocation_date=override.effective_date,
                            ).exists()
                            or CrewShift.objects.filter(
                                schedule_id=override.schedule_id,
                                service_date=override.effective_date,
                            ).exists()
                            or ScheduleTruckAllocation.objects.filter(
                                schedule_id=override.schedule_id,
                                allocation_date=override.effective_date,
                            ).exists()
                        ):
                            raise ActiveShiftConflictError({
                                'override_id': 'Cannot modify schedule/date/team of an override already used by a truck allocation or shift.'
                            })
                        if (
                            DriverShift.objects.filter(
                                schedule_id=schedule.id,
                                allocation__allocation_date=target_date,
                            ).exists()
                            or CrewShift.objects.filter(
                                schedule_id=schedule.id,
                                service_date=target_date,
                            ).exists()
                            or ScheduleTruckAllocation.objects.filter(
                                schedule_id=schedule.id,
                                allocation_date=target_date,
                            ).exists()
                        ):
                            raise ActiveShiftConflictError({
                                'effective_date': f"Cannot reassign override onto Schedule #{schedule.id} on {target_date} because an allocation or shift already exists."
                            })

                    if target_team_id != override.team_id:
                        if not team or not team.is_active:
                            raise ValidationError({'team_id': f"Active team #{target_team_id} not found."})
                    else:
                        if not team:
                            raise ValidationError({'team_id': f"Team #{target_team_id} not found."})

                    update_fields = ['schedule', 'effective_date', 'team', 'reason']

                    if (
                        ScheduleTeamOverride.objects
                        .filter(schedule=schedule, effective_date=target_date)
                        .exclude(id=override.id)
                        .exists()
                    ):
                        raise ValidationError({
                            'effective_date': f"An override already exists for Schedule #{schedule.id} on {target_date}."
                        })

                    override.schedule = schedule
                    override.effective_date = target_date
                    override.team = team
                    if reason is not None:
                        override.reason = reason.strip()
                    override.save(update_fields=update_fields)
                    return override
            except _ConcurrentOverrideMove:
                if attempt == max_attempts - 1:
                    raise ActiveShiftConflictError({
                        'concurrent_change': f"Override #{override_id} changed concurrently; please retry."
                    })

    @staticmethod
    def delete_schedule_override(override_id: int) -> None:
        from .models import DriverShift, CrewShift
        from .team_service import ActiveShiftConflictError

        class _ConcurrentOverrideMove(Exception):
            pass

        today = timezone.localdate()
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                with transaction.atomic():
                    observed = ScheduleTeamOverride.objects.filter(id=override_id).values('schedule_id').first()
                    if not observed:
                        raise ValidationError({'override_id': f"Override #{override_id} not found."})
                    CollectionSchedule.objects.filter(id=observed['schedule_id']).select_for_update().first()
                    override = ScheduleTeamOverride.objects.filter(id=override_id).select_for_update().first()
                    if not override:
                        raise ValidationError({'override_id': f"Override #{override_id} not found."})
                    if override.schedule_id != observed['schedule_id']:
                        raise _ConcurrentOverrideMove()
                    if override.effective_date < today:
                        raise ActiveShiftConflictError({
                            'effective_date': 'Historical schedule team overrides from past dates cannot be deleted.'
                        })
                    if (
                        DriverShift.objects.filter(
                            schedule_id=override.schedule_id,
                            allocation__allocation_date=override.effective_date,
                        ).exists()
                        or CrewShift.objects.filter(
                            schedule_id=override.schedule_id,
                            service_date=override.effective_date,
                        ).exists()
                        or ScheduleTruckAllocation.objects.filter(
                            schedule_id=override.schedule_id,
                            allocation_date=override.effective_date,
                        ).exists()
                    ):
                        raise ActiveShiftConflictError({
                            'override_id': 'Cannot delete an override that is already referenced by a truck allocation or shift.'
                        })
                    override.delete()
                    return
            except _ConcurrentOverrideMove:
                if attempt == max_attempts - 1:
                    raise ActiveShiftConflictError({
                        'concurrent_change': f"Override #{override_id} changed schedule concurrently; please retry."
                    })

    @staticmethod
    def allocate_truck_for_schedule(
        schedule_id: int,
        allocation_date: date,
        truck_id: int,
        team_id: int = None,
        allocated_by=None
    ) -> ScheduleTruckAllocation:
        from .models import DriverShift, CrewShift
        from .team_service import ActiveShiftConflictError

        today = timezone.localdate()
        if allocation_date < today:
            raise ValidationError({'allocation_date': 'Cannot allocate a truck for a past date.'})

        parsed_team_id = None
        if team_id is not None:
            try:
                parsed_team_id = int(team_id)
            except (TypeError, ValueError):
                raise ValidationError({'team_id': 'Invalid team_id.'})

        with transaction.atomic():
            # 1. Lock and validate Schedule
            schedule = CollectionSchedule.objects.filter(id=schedule_id).select_for_update().first()
            if not schedule:
                raise ValidationError({'schedule_id': f"Schedule #{schedule_id} not found."})
            if schedule.status in ('CANCELLED', 'COMPLETED'):
                raise ValidationError({
                    'schedule_id': f"Cannot allocate a truck for a {schedule.status.lower()} schedule."
                })

            # 2. Resolve and lock SanitationTeam BEFORE ScheduleTruckAllocation & Truck
            effective_team = AllocationService.resolve_schedule_team(schedule_id, allocation_date)
            resolved_team = SanitationTeam.objects.filter(id=effective_team.id, is_active=True).select_for_update().first()

            # 3. Lock any matching allocation on (schedule, truck, allocation_date) BEFORE Truck
            #    and check active/used shift conflict (409) BEFORE team/schedule 400 validations.
            existing_alloc = (
                ScheduleTruckAllocation.objects
                .filter(schedule=schedule, truck_id=truck_id, allocation_date=allocation_date)
                .select_for_update()
                .first()
            )
            if existing_alloc and (
                DriverShift.objects.filter(allocation=existing_alloc).exists()
                or CrewShift.objects.filter(allocation=existing_alloc).exists()
            ):
                raise ActiveShiftConflictError({
                    'allocation_id': (
                        f"Allocation #{existing_alloc.id} has already been used by a DriverShift or CrewShift "
                        "and cannot be modified or reused."
                    )
                })

            if not resolved_team:
                raise ValidationError({'team_id': f"Resolved team for Schedule #{schedule_id} is inactive."})
            if parsed_team_id is not None and parsed_team_id != effective_team.id:
                raise ValidationError({
                    'team_id': (
                        f"Team #{parsed_team_id} does not match Schedule #{schedule_id}'s effective team "
                        f"({effective_team.code}) for {allocation_date}."
                    )
                })
            if not schedule.dumpsite_id:
                raise ValidationError({
                    'schedule_id': f"Schedule #{schedule_id} has no assigned dumpsite facility."
                })
            if schedule.date is not None and schedule.date != allocation_date:
                raise ValidationError({
                    'allocation_date': (
                        f"Single-date Schedule #{schedule_id} is scheduled for {schedule.date}, "
                        f"not {allocation_date}."
                    )
                })

            # 4. Lock and validate Truck
            truck = Truck.objects.filter(id=truck_id).select_for_update().first()
            if not truck:
                raise ValidationError({'truck_id': f"Truck #{truck_id} not found."})
            if not is_truck_dispatchable(truck):
                raise ValidationError({
                    'truck_id': (
                        f"Truck {truck.plate_number} is not dispatchable "
                        f"(status='{truck.status}', state='{truck.retirement_state}', "
                        f"provenance='{truck.commissioning_provenance}', is_retired={truck.is_retired}, "
                        f"hold={truck.is_operational_hold}, mechanical_status='{truck.mechanical_status}', "
                        f"maintenance_status='{truck.maintenance_status}', mechanical_condition='{truck.mechanical_condition}')."
                    )
                })

            # 5. Validate team readiness under Worker -> SanitationTeamMembership locks (after Truck)
            AllocationService._validate_team_readiness_for_allocation(schedule, allocation_date, resolved_team)

            # 6. Check for existing allocation for this truck on another schedule on this date
            existing_truck_alloc = ScheduleTruckAllocation.objects.filter(
                truck=truck,
                allocation_date=allocation_date
            ).exclude(schedule=schedule).first()
            if existing_truck_alloc:
                raise ValidationError({
                    'truck_id': f"Truck {truck.plate_number} is already allocated to Schedule #{existing_truck_alloc.schedule_id} on {allocation_date}."
                })

            if existing_alloc:
                existing_alloc.team = resolved_team
                existing_alloc.allocated_by = allocated_by
                existing_alloc.save(update_fields=['team', 'allocated_by'])
                allocation = existing_alloc
            else:
                allocation = ScheduleTruckAllocation.objects.create(
                    schedule=schedule,
                    truck=truck,
                    allocation_date=allocation_date,
                    team=resolved_team,
                    allocated_by=allocated_by,
                )

            # Update truck op_status
            if truck.op_status == 'AVAILABLE':
                truck.op_status = 'ASSIGNED'
                truck.save(update_fields=['op_status'])

            return allocation

    @staticmethod
    def update_truck_allocation(
        allocation_id: int,
        schedule_id: int = None,
        allocation_date: date = None,
        truck_id: int = None,
        team_id: int = None,
        actor=None,
    ) -> ScheduleTruckAllocation:
        from .models import DriverShift, CrewShift
        from .team_service import ActiveShiftConflictError
        from .truck_service import TruckService

        class _ConcurrentAllocationMove(Exception):
            pass

        parsed_team_id = None
        if team_id is not None:
            try:
                parsed_team_id = int(team_id)
            except (TypeError, ValueError):
                raise ValidationError({'team_id': 'Invalid team_id.'})

        today = timezone.localdate()
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                with transaction.atomic():
                    # 1. Pre-read schedule_id & truck_id without lock so we can lock in canonical order
                    observed = (
                        ScheduleTruckAllocation.objects
                        .filter(id=allocation_id)
                        .values('schedule_id', 'allocation_date', 'truck_id')
                        .first()
                    )
                    if not observed:
                        raise ValidationError({'allocation_id': f"Allocation #{allocation_id} not found."})

                    observed_schedule_id = observed['schedule_id']
                    observed_truck_id = observed['truck_id']
                    target_schedule_id = schedule_id if schedule_id is not None else observed_schedule_id
                    target_date = allocation_date if allocation_date is not None else observed['allocation_date']
                    target_truck_id = truck_id if truck_id is not None else observed_truck_id

                    if target_date < today:
                        raise ValidationError({'allocation_date': 'Cannot move or update an allocation to a past date.'})

                    # 2. Lock old & target schedules in ascending ID order (matches stage_and_start_shift)
                    schedule_ids = sorted({observed_schedule_id, target_schedule_id})
                    locked_schedules = {
                        s.id: s
                        for s in CollectionSchedule.objects.filter(id__in=schedule_ids).order_by('id').select_for_update()
                    }
                    schedule = locked_schedules.get(target_schedule_id)
                    if not schedule:
                        raise ValidationError({'schedule_id': f"Schedule #{target_schedule_id} not found."})
                    if actor is not None:
                        old_schedule = locked_schedules.get(observed_schedule_id)
                        if old_schedule:
                            TruckService.require_admin_or_facility_operator(actor, schedule=old_schedule)
                        if target_schedule_id != observed_schedule_id:
                            TruckService.require_admin_or_facility_operator(actor, schedule=schedule)

                    # 3. Resolve and lock SanitationTeam BEFORE ScheduleTruckAllocation & Truck
                    effective_team = AllocationService.resolve_schedule_team(target_schedule_id, target_date)
                    resolved_team = SanitationTeam.objects.filter(id=effective_team.id, is_active=True).select_for_update().first()

                    # 4. Lock Allocation BEFORE Truck and check active/used shift conflict (409) first
                    allocation = ScheduleTruckAllocation.objects.filter(id=allocation_id).select_for_update().first()
                    if not allocation:
                        raise ValidationError({'allocation_id': f"Allocation #{allocation_id} not found."})
                    if (
                        allocation.schedule_id != observed_schedule_id
                        or allocation.schedule_id not in locked_schedules
                        or allocation.truck_id != observed_truck_id
                    ):
                        raise _ConcurrentAllocationMove()

                    if (
                        DriverShift.objects.filter(allocation=allocation).exists()
                        or CrewShift.objects.filter(allocation=allocation).exists()
                    ):
                        raise ActiveShiftConflictError({
                            'allocation_id': f"Allocation #{allocation.id} has already been used by a DriverShift or CrewShift and cannot be modified."
                        })

                    if schedule.status in ('CANCELLED', 'COMPLETED'):
                        raise ValidationError({
                            'schedule_id': f"Cannot allocate a truck for a {schedule.status.lower()} schedule."
                        })
                    if not schedule.dumpsite_id:
                        raise ValidationError({
                            'schedule_id': f"Schedule #{schedule.id} has no assigned dumpsite facility."
                        })
                    if not resolved_team:
                        raise ValidationError({'team_id': f"Resolved team for Schedule #{target_schedule_id} is inactive."})
                    if parsed_team_id is not None and parsed_team_id != effective_team.id:
                        raise ValidationError({
                            'team_id': (
                                f"Team #{parsed_team_id} does not match Schedule #{target_schedule_id}'s effective team "
                                f"({effective_team.code}) for {target_date}."
                            )
                        })

                    # Re-derive target_date and target_truck_id from the locked allocation if not explicitly supplied
                    target_date = allocation_date if allocation_date is not None else allocation.allocation_date
                    target_truck_id = truck_id if truck_id is not None else allocation.truck_id
                    if target_date < today:
                        raise ValidationError({'allocation_date': 'Cannot update an allocation on a past date.'})
                    if schedule.date is not None and schedule.date != target_date:
                        raise ValidationError({
                            'allocation_date': (
                                f"Single-date Schedule #{schedule.id} is scheduled for {schedule.date}, "
                                f"not {target_date}."
                            )
                        })

                    # 5. Lock old & target Trucks in ascending PK order
                    truck_ids = sorted({observed_truck_id, target_truck_id})
                    locked_trucks = {
                        t.id: t
                        for t in Truck.objects.filter(id__in=truck_ids).order_by('id').select_for_update()
                    }
                    truck = locked_trucks.get(target_truck_id)
                    old_truck = locked_trucks.get(observed_truck_id)
                    if not truck:
                        raise ValidationError({'truck_id': f"Truck #{target_truck_id} not found."})
                    if actor is not None:
                        if old_truck:
                            TruckService.require_admin_or_facility_operator(actor, schedule=locked_schedules.get(observed_schedule_id), truck=old_truck)
                        if truck.id != observed_truck_id or target_schedule_id != observed_schedule_id:
                            TruckService.require_admin_or_facility_operator(actor, schedule=schedule, truck=truck)
                    if not is_truck_dispatchable(truck):
                        raise ValidationError({
                            'truck_id': (
                                f"Truck {truck.plate_number} is not dispatchable "
                                f"(status='{truck.status}', state='{truck.retirement_state}', "
                                f"provenance='{truck.commissioning_provenance}', is_retired={truck.is_retired}, "
                                f"hold={truck.is_operational_hold}, mechanical_status='{truck.mechanical_status}', "
                                f"maintenance_status='{truck.maintenance_status}', mechanical_condition='{truck.mechanical_condition}')."
                            )
                        })

                    # 6. Validate team readiness under Worker -> SanitationTeamMembership locks (after Truck)
                    AllocationService._validate_team_readiness_for_allocation(schedule, target_date, resolved_team)

                    # 7. Re-read and validate allocation's schedule, team, truck, and active-shift usage
                    allocation.refresh_from_db()
                    if (
                        allocation.schedule_id != observed_schedule_id
                        or allocation.schedule_id not in locked_schedules
                        or allocation.truck_id != observed_truck_id
                    ):
                        raise _ConcurrentAllocationMove()

                    rechecked_team = AllocationService.resolve_schedule_team(target_schedule_id, target_date)
                    if rechecked_team.id != resolved_team.id or not resolved_team.is_active:
                        raise _ConcurrentAllocationMove()
                    if parsed_team_id is not None and parsed_team_id != rechecked_team.id:
                        raise ValidationError({
                            'team_id': f"Team #{parsed_team_id} does not match Schedule #{target_schedule_id}'s effective team."
                        })

                    if (
                        DriverShift.objects.filter(allocation=allocation).exists()
                        or CrewShift.objects.filter(allocation=allocation).exists()
                    ):
                        raise ActiveShiftConflictError({
                            'allocation_id': f"Allocation #{allocation.id} has already been used by a DriverShift or CrewShift and cannot be modified."
                        })

                    conflict = (
                        ScheduleTruckAllocation.objects
                        .filter(truck=truck, allocation_date=target_date)
                        .exclude(id=allocation.id)
                        .first()
                    )
                    if conflict:
                        raise ValidationError({
                            'truck_id': f"Truck {truck.plate_number} is already allocated to Schedule #{conflict.schedule_id} on {target_date}."
                        })

                    allocation.schedule = schedule
                    allocation.allocation_date = target_date
                    allocation.truck = truck
                    allocation.team = resolved_team
                    allocation.save(update_fields=['schedule', 'allocation_date', 'truck', 'team'])

                    if truck.op_status == 'AVAILABLE':
                        truck.op_status = 'ASSIGNED'
                        truck.save(update_fields=['op_status'])

                    if old_truck and old_truck.id != truck.id and old_truck.op_status == 'ASSIGNED':
                        still_assigned = (
                            DriverShift.objects.filter(truck=old_truck, is_active=True).exists()
                            or ScheduleTruckAllocation.objects.filter(truck=old_truck, allocation_date__gte=today).exists()
                        )
                        if not still_assigned:
                            old_truck.op_status = 'AVAILABLE'
                            old_truck.save(update_fields=['op_status'])

                    return allocation
            except _ConcurrentAllocationMove:
                if attempt == max_attempts - 1:
                    raise ActiveShiftConflictError({
                        'concurrent_change': f"Allocation #{allocation_id} changed schedule concurrently; please retry."
                    })

    @staticmethod
    def delete_truck_allocation(allocation_id: int, actor=None) -> None:
        from .models import DriverShift, CrewShift
        from .team_service import ActiveShiftConflictError
        from .truck_service import TruckService

        class _ConcurrentAllocationMove(Exception):
            pass

        today = timezone.localdate()
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                with transaction.atomic():
                    observed = ScheduleTruckAllocation.objects.filter(id=allocation_id).values('schedule_id', 'truck_id').first()
                    if not observed:
                        raise ValidationError({'allocation_id': f"Allocation #{allocation_id} not found."})
                    locked_schedule = CollectionSchedule.objects.filter(id=observed['schedule_id']).select_for_update().first()
                    allocation = ScheduleTruckAllocation.objects.filter(id=allocation_id).select_for_update().first()
                    if not allocation:
                        raise ValidationError({'allocation_id': f"Allocation #{allocation_id} not found."})
                    if allocation.schedule_id != observed['schedule_id'] or allocation.truck_id != observed['truck_id']:
                        raise _ConcurrentAllocationMove()

                    truck = Truck.objects.filter(id=allocation.truck_id).select_for_update().first() if allocation.truck_id else None
                    if actor is not None:
                        TruckService.require_admin_or_facility_operator(actor, schedule=locked_schedule, truck=truck)

                    if (
                        DriverShift.objects.filter(allocation=allocation).exists()
                        or CrewShift.objects.filter(allocation=allocation).exists()
                    ):
                        raise ActiveShiftConflictError({
                            'allocation_id': f"Allocation #{allocation.id} is referenced by a DriverShift or CrewShift and cannot be deleted."
                        })
                    if allocation.allocation_date < today:
                        raise ActiveShiftConflictError({
                            'allocation_date': 'Historical truck allocations from past dates cannot be deleted.'
                        })
                    allocation.delete()

                    if truck and truck.op_status == 'ASSIGNED':
                        still_assigned = (
                            DriverShift.objects.filter(truck=truck, is_active=True).exists()
                            or ScheduleTruckAllocation.objects.filter(truck=truck, allocation_date__gte=today).exists()
                        )
                        if not still_assigned:
                            truck.op_status = 'AVAILABLE'
                            truck.save(update_fields=['op_status'])
                    return
            except _ConcurrentAllocationMove:
                if attempt == max_attempts - 1:
                    raise ActiveShiftConflictError({
                        'concurrent_change': f"Allocation #{allocation_id} changed concurrently; please retry."
                    })

    @staticmethod
    def get_preallocated_truck_for_driver(driver_user, target_date: date = None, schedule_id: int = None):
        if target_date is None:
            target_date = timezone.localdate()

        worker = Worker.objects.filter(user=driver_user, is_active=True).first()
        if not worker:
            return None

        membership = SanitationTeamMembership.objects.filter(
            worker=worker,
            is_active=True,
            team__is_active=True,
        ).select_related('team').first()
        if not membership:
            return None

        qs = ScheduleTruckAllocation.objects.filter(
            team=membership.team,
            allocation_date=target_date,
        )
        if schedule_id is not None:
            qs = qs.filter(schedule_id=schedule_id)

        allocations = list(qs.select_related('truck', 'schedule', 'team').order_by('id'))
        if not allocations:
            return None
        if len(allocations) > 1:
            if schedule_id is not None:
                raise ValidationError({
                    'allocation_id': (
                        f"Multiple truck allocations exist for Schedule #{schedule_id} on {target_date}. "
                        "Explicit allocation_id is required."
                    )
                })
            raise ValidationError({
                'allocation_id': (
                    f"Multiple truck allocations exist for Team {membership.team.code} on {target_date}. "
                    "Specify schedule_id or explicit allocation_id."
                )
            })
        return allocations[0]

