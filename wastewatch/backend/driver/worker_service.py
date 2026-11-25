import json
from django.db import transaction
from django.core.exceptions import ValidationError
from django.utils import timezone
from analytics.models import ActivityLog
from .models import Worker, LegacyCrewReconciliationAudit, SanitationTeam, SanitationTeamMembership
from .team_service import TeamService, ActiveShiftConflictError


def _record_worker_audit_log(actor, activity_action: str, action_code: str, target_object_id, details: dict) -> None:
    """Persist canonical worker lifecycle audit events using analytics.ActivityLog."""
    ActivityLog.objects.create(
        admin=actor if (actor and getattr(actor, 'is_authenticated', False)) else None,
        action=activity_action,
        module='Workers',
        details=json.dumps({
            'event': action_code,
            'target_object_id': str(target_object_id),
            **(details or {}),
        }),
    )


class WorkerService:
    """
    Core domain service managing canonical Worker identities,
    atomic merges, employee ID updates, and legacy crew reconciliation.
    """

    @staticmethod
    def create_worker(
        employee_id: str,
        full_name: str,
        user=None,
        is_active: bool = True,
        *,
        allow_provisional: bool = False,
    ) -> Worker:
        from django.contrib.auth import get_user_model

        employee_id = (employee_id or '').strip()
        full_name = (full_name or '').strip()
        if not employee_id:
            raise ValidationError({'employee_id': 'Employee ID cannot be empty.'})
        if not full_name:
            raise ValidationError({'full_name': 'Full name cannot be empty.'})
        if not allow_provisional and employee_id.upper().startswith('PROV-'):
            raise ValidationError({
                'employee_id': (
                    "Provisional 'PROV-' employee IDs are reserved for legacy reconciliation "
                    "and cannot be created directly."
                )
            })

        with transaction.atomic():
            if Worker.objects.filter(employee_id=employee_id).exists():
                raise ValidationError({'employee_id': f"Worker with employee ID '{employee_id}' already exists."})

            if user is not None:
                User = get_user_model()
                locked_user = User.objects.filter(pk=user.pk).select_for_update().first()
                if not locked_user:
                    raise ValidationError({'user': 'Linked user account not found.'})
                if not getattr(locked_user, 'is_active', False):
                    raise ValidationError({
                        'user': f"User '{locked_user.username}' is inactive and cannot be linked to a Worker."
                    })
                sys_role = getattr(locked_user, 'role', None)
                emp_type = getattr(locked_user, 'employee_type', None)
                eligible = (
                    sys_role in ('driver', 'watcher')
                    or (sys_role == 'citizen' and emp_type == 'crew_member')
                )
                if not eligible:
                    raise ValidationError({
                        'user': (
                            f"User '{locked_user.username}' with role '{sys_role}' is not eligible "
                            "to be linked to an operational sanitation Worker."
                        )
                    })
                if Worker.objects.filter(user=locked_user).exists():
                    raise ValidationError({'user': f"User '{locked_user.username}' is already linked to a canonical Worker."})
                user = locked_user

            from django.db import IntegrityError
            try:
                return Worker.objects.create(
                    employee_id=employee_id,
                    full_name=full_name,
                    user=user,
                    is_active=is_active,
                )
            except IntegrityError:
                raise ValidationError({'employee_id': f"Worker with employee ID '{employee_id}' or linked user already exists."})

    @staticmethod
    def update_employee_id(worker_id: int, new_employee_id: str, authorized_by=None) -> Worker:
        new_employee_id = new_employee_id.strip()
        if not new_employee_id:
            raise ValidationError({'new_employee_id': 'Employee ID cannot be empty.'})

        with transaction.atomic():
            worker = Worker.objects.filter(id=worker_id).select_for_update().first()
            if not worker:
                raise ValidationError({'worker_id': f"Worker #{worker_id} not found."})

            if Worker.objects.filter(employee_id=new_employee_id).exclude(id=worker_id).exists():
                raise ValidationError({'new_employee_id': f"Employee ID '{new_employee_id}' is already in use."})

            old_id = worker.employee_id
            worker.employee_id = new_employee_id
            worker.save(update_fields=['employee_id', 'updated_at'])
            _record_worker_audit_log(
                actor=authorized_by,
                activity_action='update',
                action_code='WORKER_EMPLOYEE_ID_UPDATED',
                target_object_id=worker.id,
                details={
                    'old_id': old_id,
                    'new_id': new_employee_id,
                    'authorized_by_id': getattr(authorized_by, 'id', None),
                },
            )
            return worker

    @staticmethod
    def merge_workers(source_worker_id: int, target_worker_id: int, resolved_by=None, notes: str = '') -> Worker:
        if source_worker_id == target_worker_id:
            raise ValidationError({'target_worker_id': 'Cannot merge a worker into itself.'})

        class _ConcurrentWorkerMerge(Exception):
            pass

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                with transaction.atomic():
                    # Pre-read active team IDs so canonical lock order holds:
                    # SanitationTeam (asc id) -> Worker (asc id) -> SanitationTeamMembership (asc id)
                    observed_team_ids = sorted(set(
                        SanitationTeamMembership.objects
                        .filter(worker_id__in=[source_worker_id, target_worker_id], is_active=True)
                        .values_list('team_id', flat=True)
                    ))
                    locked_teams = {}
                    if observed_team_ids:
                        locked_teams = {
                            t.id: t
                            for t in SanitationTeam.objects.filter(id__in=observed_team_ids).order_by('id').select_for_update()
                        }

                    first_id, second_id = sorted([source_worker_id, target_worker_id])
                    locked_workers = {
                        w.id: w
                        for w in Worker.objects.select_related('user').filter(id__in=[first_id, second_id]).order_by('id').select_for_update(of=('self',))
                    }

                    source_worker = locked_workers.get(source_worker_id)
                    target_worker = locked_workers.get(target_worker_id)

                    if not source_worker:
                        raise ValidationError({'source_worker_id': f"Source Worker #{source_worker_id} not found."})
                    if not target_worker:
                        raise ValidationError({'target_worker_id': f"Target Worker #{target_worker_id} not found."})

                    active_memberships = list(
                        SanitationTeamMembership.objects
                        .select_related('team')
                        .filter(worker_id__in=[source_worker_id, target_worker_id], is_active=True)
                        .order_by('id')
                        .select_for_update(of=('self',))
                    )
                    if any(m.team_id not in locked_teams for m in active_memberships):
                        raise _ConcurrentWorkerMerge()

                    if not source_worker.is_active:
                        raise ValidationError({'source_worker_id': 'Cannot merge an inactive source worker.'})
                    if not target_worker.is_active:
                        raise ValidationError({'target_worker_id': 'Cannot merge into an inactive target worker.'})

                    if TeamService.is_worker_on_active_shift(source_worker.id):
                        raise ActiveShiftConflictError({
                            'active_shift': f"Source worker '{source_worker.full_name}' is currently participating in an active shift."
                        })
                    if TeamService.is_worker_on_active_shift(target_worker.id):
                        raise ActiveShiftConflictError({
                            'active_shift': f"Target worker '{target_worker.full_name}' is currently participating in an active shift."
                        })

                    if (
                        source_worker.user_id
                        and target_worker.user_id
                        and source_worker.user_id != target_worker.user_id
                    ):
                        raise ValidationError({
                            'target_worker_id': (
                                'Cannot merge workers linked to two distinct user accounts. '
                                'Unlink or resolve account conflict first.'
                            )
                        })

                    src_memberships = [m for m in active_memberships if m.worker_id == source_worker.id]
                    tgt_memberships = [m for m in active_memberships if m.worker_id == target_worker.id]

                    # Re-point User link if source has user and target does not
                    transferred_user = source_worker.user if (source_worker.user_id and not target_worker.user_id) else None
                    if transferred_user is not None:
                        source_worker.user = None
                        source_worker.save(update_fields=['user', 'updated_at'])
                        target_worker.user = transferred_user
                        target_worker.save(update_fields=['user', 'updated_at'])
                        for m in tgt_memberships:
                            TeamService._validate_worker_role_eligibility(target_worker, m.role_in_team)

                    for membership in src_memberships:
                        if not tgt_memberships:
                            if not resolved_by:
                                raise ValidationError({
                                    'resolved_by': 'Authorizing user (resolved_by) is required when transferring active team membership.'
                                })
                            if not membership.team or not membership.team.is_active:
                                raise ValidationError({
                                    'team': f"Cannot carry over active membership to inactive Team '{membership.team.name if membership.team else membership.team_id}'."
                                })
                            TeamService._validate_worker_role_eligibility(target_worker, membership.role_in_team)
                            now = timezone.now()
                            membership.is_active = False
                            membership.left_at = now
                            membership.save(update_fields=['is_active', 'left_at'])
                            new_m = SanitationTeamMembership.objects.create(
                                team=membership.team,
                                worker=target_worker,
                                role_in_team=membership.role_in_team,
                                is_active=True,
                                created_by=resolved_by,
                            )
                            tgt_memberships.append(new_m)
                        else:
                            membership.is_active = False
                            membership.left_at = timezone.now()
                            membership.save(update_fields=['is_active', 'left_at'])

                    # Re-point legacy reconciliation records
                    LegacyCrewReconciliationAudit.objects.filter(
                        provisional_worker=source_worker
                    ).update(provisional_worker=target_worker)

                    # Soft-deactivate source worker
                    source_worker.is_active = False
                    source_worker.save(update_fields=['is_active', 'updated_at'])

                    _record_worker_audit_log(
                        actor=resolved_by,
                        activity_action='update',
                        action_code='WORKER_MERGED',
                        target_object_id=target_worker.id,
                        details={
                            'source_worker_id': source_worker.id,
                            'target_worker_id': target_worker.id,
                            'resolved_by_id': getattr(resolved_by, 'id', None),
                            'notes': notes or '',
                        },
                    )
                    return target_worker
            except _ConcurrentWorkerMerge:
                if attempt == max_attempts - 1:
                    raise ActiveShiftConflictError({
                        'concurrent_merge': (
                            f"Team membership changed concurrently while merging worker #{source_worker_id}; please retry."
                        )
                    })

    @staticmethod
    def reconcile_provisional_worker(
        audit_id: int,
        action: str,
        target_worker_id: int = None,
        new_employee_id: str = None,
        notes: str = '',
        resolved_by=None
    ) -> LegacyCrewReconciliationAudit:
        action = action.upper().strip()
        valid_actions = {'PROMOTE', 'MERGE', 'DISMISS'}
        if action not in valid_actions:
            raise ValidationError({'action': f"Action must be one of: {', '.join(valid_actions)}"})

        with transaction.atomic():
            audit = (
                LegacyCrewReconciliationAudit.objects
                .select_for_update()
                .select_related('provisional_worker')
                .filter(id=audit_id)
                .first()
            )
            if not audit:
                raise ValidationError({'audit_id': f"Reconciliation record #{audit_id} not found."})

            if audit.reconciliation_status != 'PENDING_REVIEW':
                raise ValidationError({'audit_id': f"Record #{audit_id} is already resolved as '{audit.reconciliation_status}'."})

            worker = audit.provisional_worker

            if action == 'PROMOTE':
                if not new_employee_id:
                    raise ValidationError({'new_employee_id': 'Promoting a provisional worker requires an official employee ID.'})
                WorkerService.update_employee_id(worker.id, new_employee_id, authorized_by=resolved_by)
                audit.reconciliation_status = 'PROMOTED'
                audit.notes = notes or f"Promoted provisional worker to permanent ID {new_employee_id}."

            elif action == 'MERGE':
                if not target_worker_id:
                    raise ValidationError({'target_worker_id': 'Merging requires specifying an existing target worker ID.'})
                WorkerService.merge_workers(worker.id, target_worker_id, resolved_by=resolved_by, notes=notes)
                audit.reconciliation_status = 'MERGED'
                audit.notes = notes or f"Merged provisional worker #{worker.id} into permanent Worker #{target_worker_id}."

            elif action == 'DISMISS':
                worker.is_active = False
                worker.save(update_fields=['is_active', 'updated_at'])
                audit.reconciliation_status = 'DISMISSED'
                audit.notes = notes or 'Dismissed invalid provisional worker record.'

            audit.resolved_by = resolved_by
            audit.resolved_at = timezone.now()
            audit.save()
            return audit

