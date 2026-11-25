from dataclasses import dataclass
from datetime import date
import json
from typing import Optional, Union
from django.db import transaction
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.contrib.auth import get_user_model
from accounts.models import UserRole
from accounts.permissions import is_admin_user
from analytics.models import ActivityLog
from .models import (
    CollectionSchedule,
    SanitationTeam,
    SanitationTeamMembership,
    ScheduleTeamOverride,
    Worker,
    DriverShift,
)

User = get_user_model()


def _record_team_audit_log(actor, activity_action: str, action_code: str, target_object_id, details: dict) -> None:
    """Persist sanitation team membership audit events using analytics.ActivityLog."""
    ActivityLog.objects.create(
        admin=actor if (actor and getattr(actor, 'is_authenticated', False)) else None,
        action=activity_action,
        module='Teams',
        details=json.dumps({
            'event': action_code,
            'target_object_id': str(target_object_id),
            **(details or {}),
        }),
    )


class ActiveShiftConflictError(ValidationError):
    pass


@dataclass(frozen=True)
class DeploymentTeamLeaderResult:
    user: object
    worker: Worker
    team: SanitationTeam
    leadership_mode: str          # 'watcher' | 'driver'
    has_watcher_assigned: bool    # True if leadership_mode == 'watcher'
    is_driver_team_leader: bool   # True if leadership_mode == 'driver'

    def to_dict(self) -> dict:
        return {
            'user_id': self.user.id,
            'username': self.user.username,
            'full_name': self.worker.full_name,
            'role': getattr(self.user, 'role', ''),
            'team_id': self.team.id,
            'team_code': self.team.code,
            'team_name': self.team.name,
            'leadership_mode': self.leadership_mode,
            'has_watcher_assigned': self.has_watcher_assigned,
            'is_driver_team_leader': self.is_driver_team_leader,
        }


def resolve_deployment_team_leader(
    schedule: Union[CollectionSchedule, int],
    service_date: Optional[date] = None,
) -> DeploymentTeamLeaderResult:
    """
    Authoritative service-level resolution function for deployment Team Leader.
    Resolves the effective SanitationTeam via D-10 precedence (date-specific
    ScheduleTeamOverride -> schedule default_team) and requires a single active
    SanitationTeamMembership(role_in_team='leader') with an active Worker and
    linked active User ('watcher' or 'driver').
    """
    if service_date is None:
        service_date = timezone.localdate()

    if isinstance(schedule, int):
        sched_obj = CollectionSchedule.objects.select_related(
            'default_team',
        ).filter(id=schedule).first()
        if not sched_obj:
            raise ValidationError({'schedule': f"Schedule #{schedule} not found."})
    else:
        sched_obj = schedule

    # 1. Effective team resolution (D-10: Override -> Default Team)
    from .allocation_service import AllocationService
    effective_team = AllocationService.resolve_schedule_team(sched_obj.id, service_date)
    if not effective_team or not effective_team.is_active:
        raise ValidationError({'team': f"Schedule #{sched_obj.id} has no active team resolved for {service_date}."})

    # 2. Authoritative active leader membership on effective_team
    leader_memberships = list(
        SanitationTeamMembership.objects.filter(
            team=effective_team,
            role_in_team='leader',
            is_active=True,
        ).select_related('worker__user').order_by('id')
    )
    if not leader_memberships:
        raise ValidationError({
            'team_leader': f"Team {effective_team.code} has no active Team Leader assigned."
        })
    if len(leader_memberships) > 1:
        raise ValidationError({
            'team_leader': f"Team {effective_team.code} has ambiguous multiple active Team Leaders assigned."
        })

    default_membership = leader_memberships[0]
    candidate_worker = default_membership.worker
    if not candidate_worker or not candidate_worker.is_active:
        raise ValidationError({
            'team_leader': f"Assigned Team Leader for Team {effective_team.code} has no active Worker profile."
        })
    if not candidate_worker.user_id or not candidate_worker.user:
        raise ValidationError({
            'team_leader': f"Assigned Team Leader for Team {effective_team.code} is not linked to a user account."
        })
    candidate_user = candidate_worker.user

    # 3. Validate candidate user active status & eligible system role ('watcher' or 'driver')
    if not getattr(candidate_user, 'is_active', True):
        raise ValidationError({
            'team_leader': f"Candidate leader user '{candidate_user.username}' is inactive."
        })

    sys_role = getattr(candidate_user, 'role', '')
    candidate_name = (getattr(candidate_user, 'full_name', '') or '').strip() or candidate_user.username
    if sys_role not in ('watcher', 'driver'):
        raise ValidationError({
            'team_leader': (
                f"Candidate leader '{candidate_name}' cannot be designated as Team Leader. "
                "Only users with system role 'watcher' or 'driver' are eligible."
            )
        })

    leadership_mode = sys_role
    has_watcher_assigned = (leadership_mode == 'watcher')
    is_driver_team_leader = (leadership_mode == 'driver')

    return DeploymentTeamLeaderResult(
        user=candidate_user,
        worker=candidate_worker,
        team=effective_team,
        leadership_mode=leadership_mode,
        has_watcher_assigned=has_watcher_assigned,
        is_driver_team_leader=is_driver_team_leader,
    )


def can_inspect_collection_stop(
    user,
    schedule: Union[CollectionSchedule, int, None],
    service_date: Optional[date] = None,
) -> bool:
    """
    Authoritative deployment authorization check for collection stop inspection/verification.
    - Unauthenticated or inactive users fail closed (False).
    - Admins (accounts.permissions.is_admin_user) are always authorized (True).
    - Non-Watcher users are denied (False).
    - Watchers are authorized iff resolve_deployment_team_leader(schedule, service_date)
      resolves leadership_mode == 'watcher' and leader.user.id == user.id.
    - Cancelled schedules and any ValidationError fail closed (False).
    """
    if not user or not getattr(user, 'is_authenticated', False) or not getattr(user, 'is_active', False):
        return False
    if is_admin_user(user):
        return True
    if getattr(user, 'role', None) != UserRole.WATCHER:
        return False
    if schedule is None:
        return False

    if isinstance(schedule, CollectionSchedule):
        sched_obj = schedule
    else:
        try:
            schedule_id = int(schedule)
        except (TypeError, ValueError):
            return False
        sched_obj = CollectionSchedule.objects.select_related(
            'default_team',
        ).filter(id=schedule_id).first()
        if not sched_obj:
            return False

    if getattr(sched_obj, 'status', None) == 'CANCELLED':
        return False

    try:
        leader_result = resolve_deployment_team_leader(sched_obj, service_date=service_date)
    except ValidationError:
        return False

    return bool(
        leader_result.leadership_mode == 'watcher'
        and leader_result.user
        and leader_result.user.id == user.id
    )


def filter_watcher_authorized_schedule_dates(user, schedule_date_pairs) -> set:
    """
    Batch/memoized helper returning the subset of (schedule_id, service_date) pairs
    that `user` is authorized to inspect/verify as the resolved Watcher Team Leader.
    Avoids N+1 queries when scoping StopValidationViewSet / PickupStatusViewSet querysets.
    """
    if not user or not getattr(user, 'is_authenticated', False) or not getattr(user, 'is_active', False):
        return set()

    today = timezone.localdate()
    normalized_pairs = set()
    for raw_sched, raw_date in schedule_date_pairs or ():
        if raw_sched is None:
            continue
        raw_id = getattr(raw_sched, 'id', raw_sched)
        try:
            sched_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if sched_id <= 0:
            continue
        svc_date = raw_date if raw_date is not None else today
        normalized_pairs.add((sched_id, svc_date))

    if not normalized_pairs:
        return set()

    if is_admin_user(user):
        return normalized_pairs

    if getattr(user, 'role', None) != UserRole.WATCHER:
        return set()

    sched_ids = {sid for sid, _ in normalized_pairs}
    dates = {dt for _, dt in normalized_pairs}

    schedules_by_id = {
        s.id: s
        for s in CollectionSchedule.objects.filter(id__in=sched_ids)
        .exclude(status='CANCELLED')
        .select_related('default_team')
    }
    if not schedules_by_id:
        return set()

    overrides_by_key = {}
    for ov in (
        ScheduleTeamOverride.objects.filter(
            schedule_id__in=schedules_by_id.keys(),
            effective_date__in=dates,
        )
        .select_related('team')
        .order_by('id')
    ):
        overrides_by_key.setdefault((ov.schedule_id, ov.effective_date), ov.team)

    candidate_team_ids = set()
    resolved_team_by_pair = {}
    for sid, svc_date in normalized_pairs:
        sched = schedules_by_id.get(sid)
        if not sched:
            continue
        if (sid, svc_date) in overrides_by_key:
            team = overrides_by_key[(sid, svc_date)]
        else:
            team = sched.default_team
        if not team or not team.is_active:
            continue
        resolved_team_by_pair[(sid, svc_date)] = team.id
        candidate_team_ids.add(team.id)

    if not candidate_team_ids:
        return set()

    leaders_by_team = {}
    for m in (
        SanitationTeamMembership.objects.filter(
            team_id__in=candidate_team_ids,
            role_in_team='leader',
            is_active=True,
        )
        .select_related('worker__user')
        .order_by('id')
    ):
        leaders_by_team.setdefault(m.team_id, []).append(m)

    authorized_teams = set()
    for team_id, memberships in leaders_by_team.items():
        if len(memberships) != 1:
            continue
        w = memberships[0].worker
        if not w or not w.is_active or not w.user_id or not w.user:
            continue
        u = w.user
        if not getattr(u, 'is_active', True):
            continue
        if getattr(u, 'role', None) == UserRole.WATCHER and u.id == user.id:
            authorized_teams.add(team_id)

    return {
        pair
        for pair, team_id in resolved_team_by_pair.items()
        if team_id in authorized_teams
    }


class TeamService:
    """
    Domain service for Sanitation Team management, role assignments,
    and concurrency-safe D-13 membership transfers.
    """

    @staticmethod
    def resolve_deployment_team_leader(
        schedule: Union[CollectionSchedule, int],
        service_date: Optional[date] = None,
    ) -> DeploymentTeamLeaderResult:
        return resolve_deployment_team_leader(schedule, service_date)

    @staticmethod
    def create_team(name: str, code: str, description: str = '') -> SanitationTeam:
        name = name.strip()
        code = code.strip().upper()
        if not name:
            raise ValidationError({'name': 'Team name cannot be empty.'})
        if not code:
            raise ValidationError({'code': 'Team code cannot be empty.'})

        if SanitationTeam.objects.filter(name=name).exists():
            raise ValidationError({'name': f"Team with name '{name}' already exists."})
        if SanitationTeam.objects.filter(code=code).exists():
            raise ValidationError({'code': f"Team with code '{code}' already exists."})

        from django.db import IntegrityError
        try:
            return SanitationTeam.objects.create(
                name=name,
                code=code,
                description=description,
                is_active=True,
            )
        except IntegrityError:
            raise ValidationError({'code': f"Team with name '{name}' or code '{code}' already exists."})

    @staticmethod
    def is_worker_on_active_shift(
        worker_id: int,
        exclude_watcher_shift_id: int = None,
        exclude_crew_shift_id: int = None,
        exclude_driver_shift_id: int = None,
        exclude_driver_shift_schedule_id: int = None,
    ) -> bool:
        """
        Checks across DriverShift, WatcherShift, CrewShift team_leader,
        and shift crew rosters to determine if a worker is actively on duty.
        """
        from django.db.models import Q

        # 1. Check if worker's linked user is an active driver
        ds_qs = DriverShift.objects.filter(driver__worker_profile__id=worker_id, is_active=True)
        if exclude_driver_shift_id is not None:
            ds_qs = ds_qs.exclude(id=exclude_driver_shift_id)
        if exclude_driver_shift_schedule_id is not None:
            ds_qs = ds_qs.exclude(schedule_id=exclude_driver_shift_schedule_id)
        if ds_qs.exists():
            return True

        # 2. Check if worker's linked user is an active Watcher or CrewShift Team Leader
        try:
            from .models import WatcherShift, CrewShift
            ws_qs = WatcherShift.objects.filter(watcher__worker_profile__id=worker_id, is_active=True)
            if exclude_watcher_shift_id is not None:
                ws_qs = ws_qs.exclude(id=exclude_watcher_shift_id)
            if ws_qs.exists():
                return True
            cs_qs = CrewShift.objects.filter(team_leader__worker_profile__id=worker_id).filter(
                Q(is_active=True) | Q(driver_shift__is_active=True)
            )
            if exclude_crew_shift_id is not None:
                cs_qs = cs_qs.exclude(id=exclude_crew_shift_id)
            if exclude_driver_shift_id is not None:
                cs_qs = cs_qs.exclude(driver_shift_id=exclude_driver_shift_id)
            if exclude_driver_shift_schedule_id is not None:
                cs_qs = cs_qs.exclude(schedule_id=exclude_driver_shift_schedule_id)
            if cs_qs.exists():
                return True
        except ImportError:
            pass

        # 3. Check if worker is manifested on an active shift crew roster (if model exists)
        try:
            from .models import ShiftCrewRosterItem
            roster_qs = ShiftCrewRosterItem.objects.filter(worker_id=worker_id).filter(
                Q(snapshot__driver_shift__is_active=True)
                | Q(snapshot__crew_shift__is_active=True)
                | Q(snapshot__crew_shift__driver_shift__is_active=True)
            )
            if exclude_crew_shift_id is not None:
                roster_qs = roster_qs.exclude(snapshot__crew_shift_id=exclude_crew_shift_id)
            if exclude_driver_shift_id is not None:
                roster_qs = roster_qs.exclude(snapshot__driver_shift_id=exclude_driver_shift_id).exclude(
                    snapshot__crew_shift__driver_shift_id=exclude_driver_shift_id
                )
            if exclude_driver_shift_schedule_id is not None:
                roster_qs = roster_qs.exclude(snapshot__driver_shift__schedule_id=exclude_driver_shift_schedule_id).exclude(
                    snapshot__crew_shift__schedule_id=exclude_driver_shift_schedule_id
                )
            if roster_qs.exists():
                return True
        except ImportError:
            pass

        return False

    @staticmethod
    def _validate_worker_role_eligibility(worker: Worker, role_in_team: str) -> None:
        """
        Enforce strict mapping between actual system user roles and allowed operational designations.
        Never mutates user.role.
        """
        linked_user = worker.user if worker.user_id else None
        if linked_user and not getattr(linked_user, 'is_active', False):
            raise ValidationError({
                'worker_id': (
                    f"Worker '{worker.full_name}' is linked to an inactive user account "
                    f"('{linked_user.username}') and cannot hold an active team assignment."
                )
            })
        sys_role = getattr(linked_user, 'role', None) if linked_user else None
        emp_type = getattr(linked_user, 'employee_type', None) if linked_user else None

        if role_in_team == 'leader':
            if not linked_user or sys_role not in ('watcher', 'driver'):
                raise ValidationError({
                    'role_in_team': (
                        f"Worker '{worker.full_name}' cannot be designated as Team Leader. "
                        "Only users with system role 'watcher' or 'driver' are eligible."
                    )
                })
        elif role_in_team == 'driver':
            if not linked_user or sys_role != 'driver':
                raise ValidationError({
                    'role_in_team': (
                        f"Worker '{worker.full_name}' cannot be assigned as Driver. "
                        "Only users with system role 'driver' are eligible."
                    )
                })
        elif role_in_team == 'crew':
            if linked_user and not (sys_role == 'citizen' and emp_type == 'crew_member'):
                raise ValidationError({
                    'role_in_team': (
                        f"Worker '{worker.full_name}' cannot be assigned as Crew Member. "
                        "Crew designation is reserved for crew_member personnel without staff/driver/watcher roles."
                    )
                })

    @staticmethod
    def assign_member(team_id: int, worker_id: int, role_in_team: str, created_by=None) -> SanitationTeamMembership:
        if not created_by:
            raise ValidationError({'created_by': 'Authorizing user (created_by) is required.'})
        role_in_team = role_in_team.lower().strip()
        valid_roles = {'leader', 'driver', 'crew'}
        if role_in_team not in valid_roles:
            raise ValidationError({'role_in_team': f"Role must be one of: {', '.join(valid_roles)}"})

        with transaction.atomic():
            # Global lock order: SanitationTeam -> Worker -> SanitationTeamMembership
            team = SanitationTeam.objects.filter(id=team_id).select_for_update().first()
            if not team:
                raise ValidationError({'team_id': f"Team #{team_id} not found."})
            if not team.is_active:
                raise ValidationError({'team_id': 'Cannot assign members to an inactive team.'})

            worker = Worker.objects.filter(id=worker_id).select_for_update().first()
            if not worker:
                raise ValidationError({'worker_id': f"Worker #{worker_id} not found."})
            if not worker.is_active:
                raise ValidationError({'worker_id': 'Cannot assign an inactive worker.'})

            TeamService._validate_worker_role_eligibility(worker, role_in_team)

            # Lock existing active memberships for worker or team under canonical order
            from django.db.models import Q
            list(
                SanitationTeamMembership.objects.filter(
                    Q(worker=worker) | Q(team=team),
                    is_active=True,
                ).order_by('id').select_for_update()
            )

            # Check if worker already has an active team membership
            existing_active = SanitationTeamMembership.objects.filter(worker=worker, is_active=True).first()
            if existing_active:
                raise ValidationError({
                    'worker_id': f"Worker {worker.full_name} is already an active member of Team '{existing_active.team.name}'."
                })

            if TeamService.is_worker_on_active_shift(worker.id):
                raise ActiveShiftConflictError({
                    'active_shift': f"Worker {worker.full_name} is currently participating in an active operational shift."
                })

            # Validate unique active leader/driver per team
            if role_in_team in ('leader', 'driver'):
                if SanitationTeamMembership.objects.filter(team=team, role_in_team=role_in_team, is_active=True).exists():
                    raise ValidationError({
                        'role_in_team': f"Team '{team.name}' already has an active {role_in_team}."
                    })

            membership = SanitationTeamMembership.objects.create(
                team=team,
                worker=worker,
                role_in_team=role_in_team,
                is_active=True,
                created_by=created_by,
            )
            _record_team_audit_log(
                actor=created_by,
                activity_action='create',
                action_code='TEAM_MEMBER_ASSIGNED',
                target_object_id=membership.id,
                details={
                    'team_id': team.id,
                    'team_code': team.code,
                    'worker_id': worker.id,
                    'role_in_team': role_in_team,
                },
            )
            return membership

    @staticmethod
    def transfer_member(worker_id: int, target_team_id: int, new_role: str, authorized_by=None) -> SanitationTeamMembership:
        if not authorized_by:
            raise ValidationError({'authorized_by': 'Authorizing user (authorized_by) is required.'})
        new_role = new_role.lower().strip()
        valid_roles = {'leader', 'driver', 'crew'}
        if new_role not in valid_roles:
            raise ValidationError({'new_role': f"Role must be one of: {', '.join(valid_roles)}"})

        class _ConcurrentMembershipMove(Exception):
            pass

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                with transaction.atomic():
                    # Pre-read current active team ID; revalidated under full locks below.
                    observed_team_id = (
                        SanitationTeamMembership.objects
                        .filter(worker_id=worker_id, is_active=True)
                        .values_list('team_id', flat=True)
                        .first()
                    )
                    if not observed_team_id:
                        worker_exists = Worker.objects.filter(id=worker_id).exists()
                        if not worker_exists:
                            raise ValidationError({'worker_id': f"Worker #{worker_id} not found."})
                        raise ValidationError({'worker_id': "Worker does not have an active team membership to transfer."})

                    # Global lock order: SanitationTeam (asc id) -> Worker -> SanitationTeamMembership
                    team_ids = sorted({observed_team_id, target_team_id})
                    locked_teams = {
                        t.id: t for t in SanitationTeam.objects.filter(id__in=team_ids).order_by('id').select_for_update()
                    }
                    target_team = locked_teams.get(target_team_id)
                    if not target_team:
                        raise ValidationError({'target_team_id': f"Target Team #{target_team_id} not found."})
                    if not target_team.is_active:
                        raise ValidationError({'target_team_id': 'Cannot transfer to an inactive team.'})

                    worker = Worker.objects.filter(id=worker_id).select_for_update().first()
                    if not worker:
                        raise ValidationError({'worker_id': f"Worker #{worker_id} not found."})
                    if not worker.is_active:
                        raise ValidationError({'worker_id': 'Cannot transfer an inactive worker.'})

                    TeamService._validate_worker_role_eligibility(worker, new_role)

                    current_membership = (
                        SanitationTeamMembership.objects
                        .filter(worker_id=worker_id, is_active=True)
                        .order_by('id')
                        .select_for_update()
                        .first()
                    )
                    if not current_membership:
                        raise ValidationError({'worker_id': f"Worker {worker.full_name} does not have an active team membership to transfer."})

                    # Revalidate: if membership moved concurrently to another team before we locked,
                    # roll back this atomic block to release all locks and retry cleanly.
                    if current_membership.team_id != observed_team_id or current_membership.team_id not in locked_teams:
                        raise _ConcurrentMembershipMove()

                    if current_membership.team_id == target_team_id and current_membership.role_in_team == new_role:
                        raise ValidationError({'target_team_id': 'Worker is already assigned to this team with the same role.'})

                    # Enforce D-13 Active Shift Transfer Lock under Team/Worker/Membership locks
                    if TeamService.is_worker_on_active_shift(worker_id):
                        raise ActiveShiftConflictError({
                            'active_shift': f"Worker {worker.full_name} is currently participating in an active operational shift. Transfers are locked."
                        })

                    # Validate single leader/driver on target team (lock target team's active role row if any)
                    if new_role in ('leader', 'driver'):
                        if (
                            SanitationTeamMembership.objects
                            .filter(team=target_team, role_in_team=new_role, is_active=True)
                            .select_for_update()
                            .exists()
                        ):
                            raise ValidationError({'new_role': f"Target Team '{target_team.name}' already has an active {new_role}."})

                    from_team_id = current_membership.team_id
                    old_role = current_membership.role_in_team
                    previous_membership_id = current_membership.id

                    # Deactivate previous membership
                    current_membership.is_active = False
                    current_membership.left_at = timezone.now()
                    current_membership.save(update_fields=['is_active', 'left_at'])

                    # Create new membership
                    new_membership = SanitationTeamMembership.objects.create(
                        team=target_team,
                        worker=worker,
                        role_in_team=new_role,
                        is_active=True,
                        created_by=authorized_by,
                    )
                    _record_team_audit_log(
                        actor=authorized_by,
                        activity_action='update',
                        action_code='TEAM_MEMBER_TRANSFERRED',
                        target_object_id=new_membership.id,
                        details={
                            'worker_id': worker.id,
                            'from_team_id': from_team_id,
                            'to_team_id': target_team.id,
                            'old_role': old_role,
                            'new_role': new_role,
                            'previous_membership_id': previous_membership_id,
                        },
                    )
                    return new_membership
            except _ConcurrentMembershipMove:
                if attempt == max_attempts - 1:
                    raise ActiveShiftConflictError({
                        'concurrent_transfer': (
                            f"Worker #{worker_id} membership changed concurrently during transfer; please retry."
                        )
                    })

    @staticmethod
    def deactivate_member(membership_id: int, authorized_by=None) -> SanitationTeamMembership:
        class _ConcurrentMembershipChange(Exception):
            pass

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                with transaction.atomic():
                    meta = (
                        SanitationTeamMembership.objects
                        .filter(id=membership_id)
                        .values('team_id', 'worker_id')
                        .first()
                    )
                    if not meta:
                        raise ValidationError({'membership_id': f"Membership #{membership_id} not found."})

                    # Global lock order: SanitationTeam -> Worker -> SanitationTeamMembership
                    SanitationTeam.objects.filter(id=meta['team_id']).select_for_update().first()
                    worker = Worker.objects.filter(id=meta['worker_id']).select_for_update().first()
                    membership = (
                        SanitationTeamMembership.objects
                        .select_for_update()
                        .filter(id=membership_id)
                        .first()
                    )
                    if not membership:
                        raise ValidationError({'membership_id': f"Membership #{membership_id} not found."})
                    if membership.team_id != meta['team_id'] or membership.worker_id != meta['worker_id']:
                        raise _ConcurrentMembershipChange()
                    if not membership.is_active:
                        return membership

                    if TeamService.is_worker_on_active_shift(membership.worker_id):
                        worker_name = worker.full_name if worker else f"Worker #{membership.worker_id}"
                        raise ActiveShiftConflictError({
                            'active_shift': f"Worker {worker_name} is currently on an active shift. Deactivation locked."
                        })

                    membership.is_active = False
                    membership.left_at = timezone.now()
                    membership.save(update_fields=['is_active', 'left_at'])
                    _record_team_audit_log(
                        actor=authorized_by,
                        activity_action='delete',
                        action_code='TEAM_MEMBER_DEACTIVATED',
                        target_object_id=membership.id,
                        details={
                            'team_id': membership.team_id,
                            'worker_id': membership.worker_id,
                            'role_in_team': membership.role_in_team,
                        },
                    )
                    return membership
            except _ConcurrentMembershipChange:
                if attempt == max_attempts - 1:
                    raise ActiveShiftConflictError({
                        'concurrent_change': f"Membership #{membership_id} changed concurrently; please retry."
                    })

