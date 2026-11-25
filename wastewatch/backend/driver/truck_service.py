import json
from datetime import timedelta
from django.core.exceptions import ValidationError, PermissionDenied
from django.db import connection, transaction, OperationalError
from django.db.models import Exists, OuterRef, Q
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from accounts.permissions import is_admin_user
from analytics.models import ActivityLog
from driver.models import (
    Truck,
    TruckStatus,
    CommissioningProvenance,
    TruckRetirementState,
    DriverShift,
    TruckLocation,
    TruckCrewAssignment,
    ScheduleTruckAllocation,
    CollectionSchedule,
    SanitationTeam,
    TruckReplacementRequest,
    TruckOperationalHoldLog,
    TruckMaintenanceRecord,
    MaintenanceRecordStatus,
    MaintenanceType,
    FuelLog,
    is_truck_dispatchable,
)


def _record_truck_audit_log(actor, action_code, target_object_id, details):
    """Persist truck lifecycle audit events using analytics.ActivityLog."""
    activity_action = 'delete' if action_code == 'TRUCK_UNCOMMISSIONED_DELETED' else 'update'
    ActivityLog.objects.create(
        admin=actor if (actor and getattr(actor, 'is_authenticated', False)) else None,
        action=activity_action,
        module='Trucks',
        details=json.dumps({
            'event': action_code,
            'target_object_id': str(target_object_id),
            **(details or {}),
        }),
    )


class TruckLifecycleConflictError(ValidationError):
    """Raised when a lifecycle transition or deletion violates state or dependency preconditions (HTTP 409)."""
    def __init__(self, message, code='lifecycle_conflict', details=None):
        super().__init__(message, code=code)
        self.error_code = code
        self.details = details or {}


class TruckHistoricalAuditService:
    """
    Canonical relationship and dependency inspector for driver.Truck.
    Separates Category A (historical records that permanently prohibit physical deletion)
    from Category B (live operational references that must be detached before deletion).
    Includes fail-closed stage-aware checks for planned cross-app tables:
      - dumpsite_dumpsitetruckinspection (dumpsite.0006_dumpsite_truck_inspection)
    """

    STAGE_AWARE_TABLES = [
        {
            'key': 'DumpsiteTruckInspection',
            'app': 'dumpsite',
            'migration': '0006_dumpsite_truck_inspection',
            'table': 'dumpsite_dumpsitetruckinspection',
            'sql': 'SELECT COUNT(1) FROM dumpsite_dumpsitetruckinspection WHERE truck_id = %s',
            'params_fn': lambda truck_id: [truck_id],
        },
    ]

    @classmethod
    def is_migration_applied(cls, app_label: str, migration_name: str) -> bool:
        """
        Process-safe check against django_migrations without stale class-level caching.
        Fails closed with OperationalError if django_migrations cannot be queried.
        """
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT 1 FROM django_migrations WHERE app = %s AND name = %s",
                    [app_label, migration_name],
                )
                return bool(cursor.fetchone())
        except Exception as exc:
            raise OperationalError(
                f"CRITICAL: Failed to inspect django_migrations for ({app_label}, {migration_name}): {exc}"
            ) from exc

    @classmethod
    def is_stage_5_active(cls) -> bool:
        return cls.is_migration_applied('driver', '0050_truck_records_and_fuel')

    @classmethod
    def get_category_a_counts(cls, truck) -> dict:
        """
        Return exact record counts for all Category A historical models referencing `truck`.
        Covers existing repository models plus stage-aware cross-app models.
        """
        from dumpsite.models import WasteDelivery, TruckFillEstimate
        from watcher.models import Escalation, HotspotIntervention

        truck_id = truck.pk if hasattr(truck, 'pk') else int(truck)
        counts = {
            'DriverShift': DriverShift.objects.filter(truck_id=truck_id).count(),
            'WasteDelivery': WasteDelivery.objects.filter(truck_id=truck_id).count(),
            'TruckLocation': TruckLocation.objects.filter(truck_id=truck_id).count(),
            'TruckCrewAssignment': TruckCrewAssignment.objects.filter(truck_id=truck_id).count(),
            'TruckFillEstimate': TruckFillEstimate.objects.filter(truck_id=truck_id).count(),
            'Escalation': Escalation.objects.filter(truck_id=truck_id).count(),
            'HotspotIntervention': HotspotIntervention.objects.filter(truck_id=truck_id).count(),
            'ScheduleTruckAllocation': ScheduleTruckAllocation.objects.filter(truck_id=truck_id).count(),
            'TruckReplacementRequest': TruckReplacementRequest.objects.filter(truck_id=truck_id).count(),
            'TruckOperationalHoldLog': TruckOperationalHoldLog.objects.filter(truck_id=truck_id).count(),
            'TruckMaintenanceRecord': TruckMaintenanceRecord.objects.filter(truck_id=truck_id).count(),
            'FuelLog': FuelLog.objects.filter(truck_id=truck_id).count(),
        }

        try:
            existing_tables = set(connection.introspection.table_names())
        except Exception as exc:
            raise OperationalError(
                f"CRITICAL: Schema introspection failed in TruckHistoricalAuditService: {exc}"
            ) from exc

        for spec in cls.STAGE_AWARE_TABLES:
            migrated = cls.is_migration_applied(spec['app'], spec['migration'])
            table_exists = spec['table'] in existing_tables

            if migrated and not table_exists:
                raise OperationalError(
                    f"CRITICAL INTEGRITY FAILURE: Migration '{spec['app']}.{spec['migration']}' is recorded "
                    f"as applied, but physical table '{spec['table']}' is missing from schema. "
                    "Failing closed to prevent unauthorized physical deletion."
                )

            if table_exists:
                try:
                    with connection.cursor() as cursor:
                        cursor.execute(spec['sql'], spec['params_fn'](truck_id))
                        row = cursor.fetchone()
                        counts[spec['key']] = int(row[0]) if row else 0
                except Exception as exc:
                    raise OperationalError(
                        f"CRITICAL: Failed querying stage-aware table '{spec['table']}': {exc}"
                    ) from exc
            else:
                counts[spec['key']] = 0

        return counts

    @classmethod
    def has_historical_records(cls, truck) -> bool:
        counts = cls.get_category_a_counts(truck)
        return any(count > 0 for count in counts.values())

    @classmethod
    def get_category_b_counts(cls, truck) -> dict:
        """
        Return exact counts for all Category B live operational references to `truck`.
        """
        from watcher.models import GarbageHotspot

        truck_obj = truck if isinstance(truck, Truck) else Truck.objects.get(pk=truck)
        return {
            'CollectionSchedule': CollectionSchedule.objects.filter(truck=truck_obj).count(),
            'GarbageHotspot': GarbageHotspot.objects.filter(assigned_truck=truck_obj).count(),
            'drivers': truck_obj.drivers.count(),
            'crew': truck_obj.crew.count(),
        }

    @classmethod
    def has_operational_references(cls, truck) -> bool:
        counts = cls.get_category_b_counts(truck)
        return any(count > 0 for count in counts.values())

    @classmethod
    def is_eligible_for_physical_delete(cls, truck) -> bool:
        if truck is None or not getattr(truck, 'pk', None):
            return False
        if (
            truck.retirement_state != TruckRetirementState.UNCOMMISSIONED
            or truck.commissioning_provenance != CommissioningProvenance.UNCOMMISSIONED
            or truck.commissioned_at is not None
            or truck.is_retired
        ):
            return False
        if cls.has_historical_records(truck):
            return False
        if cls.has_operational_references(truck):
            return False
        return True


class TruckAssignmentService:
    """
    Canonical service for standing driver and crew vehicle assignments under Level T1 lock.
    """

    @staticmethod
    def assign_driver(truck, driver):
        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            if not is_truck_dispatchable(locked_truck):
                raise ValidationError(
                    f"Cannot assign driver: Truck {locked_truck.plate_number} is not dispatchable "
                    f"(state='{locked_truck.retirement_state}', provenance='{locked_truck.commissioning_provenance}')."
                )
            locked_truck.drivers.add(driver)
            return locked_truck

    @staticmethod
    def remove_driver(truck, driver):
        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            locked_truck.drivers.remove(driver)
            return locked_truck

    @staticmethod
    def assign_crew_member(truck, user):
        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            if not is_truck_dispatchable(locked_truck):
                raise ValidationError(
                    f"Cannot assign crew: Truck {locked_truck.plate_number} is not dispatchable "
                    f"(state='{locked_truck.retirement_state}', provenance='{locked_truck.commissioning_provenance}')."
                )
            locked_truck.crew.add(user)
            return locked_truck

    @staticmethod
    def remove_crew_member(truck, user):
        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            locked_truck.crew.remove(user)
            return locked_truck

    @staticmethod
    def clear_all_assignments(truck):
        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            locked_truck.drivers.clear()
            locked_truck.crew.clear()
            return locked_truck


class TruckService:
    """
    Canonical service governing Truck commissioning, legacy reconciliation,
    4-phase resumable permanent retirement (Item 13 Option A), and atomic physical
    deletion of eligible uncommissioned trucks.
    """

    @staticmethod
    def _require_admin(user):
        if user is not None and not is_admin_user(user):
            raise PermissionDenied("Administrator authorization is required for fleet lifecycle operations.")

    @staticmethod
    def _parse_and_validate_timestamp(val, field_name='commissioned_at'):
        if val is None or val == '':
            return None
        if isinstance(val, str):
            parsed = parse_datetime(val)
            if parsed is None:
                raise ValidationError({field_name: f"Invalid ISO-8601 datetime format for {field_name}."})
            if timezone.is_naive(parsed):
                parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
        else:
            parsed = val
            if timezone.is_naive(parsed):
                parsed = timezone.make_aware(parsed, timezone.get_current_timezone())

        if parsed > timezone.now() + timedelta(minutes=5):
            raise ValidationError({field_name: f"{field_name} cannot be in the future."})
        return parsed

    @classmethod
    def commission_truck(cls, truck, *, user=None, commissioned_at=None, notes=''):
        """
        Controlled initial commissioning pathway for newly created uncommissioned trucks.
        Transitions:
          (uncommissioned, uncommissioned, NULL, False) -> (commissioned_verified, operational, timestamp, False)
        """
        cls._require_admin(user)
        effective_ts = (
            cls._parse_and_validate_timestamp(commissioned_at, 'commissioned_at')
            if commissioned_at is not None
            else timezone.now()
        )

        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)

            if (
                locked_truck.commissioning_provenance != CommissioningProvenance.UNCOMMISSIONED
                or locked_truck.retirement_state != TruckRetirementState.UNCOMMISSIONED
                or locked_truck.is_retired
            ):
                raise TruckLifecycleConflictError(
                    f"Truck {locked_truck.plate_number} cannot be initially commissioned from state "
                    f"'{locked_truck.retirement_state}' (provenance '{locked_truck.commissioning_provenance}'). "
                    "Only newly created uncommissioned trucks can use initial commissioning.",
                    code='invalid_state_for_initial_commissioning',
                )

            locked_truck.commissioning_provenance = CommissioningProvenance.COMMISSIONED_VERIFIED
            locked_truck.retirement_state = TruckRetirementState.OPERATIONAL
            locked_truck.commissioned_at = effective_ts
            locked_truck.is_retired = False
            locked_truck.save(update_fields=[
                'commissioning_provenance',
                'retirement_state',
                'commissioned_at',
                'is_retired',
            ])

            _record_truck_audit_log(
                actor=user,
                action_code='TRUCK_COMMISSIONED',
                target_object_id=str(locked_truck.id),
                details={
                    'plate_number': locked_truck.plate_number,
                    'commissioning_provenance': locked_truck.commissioning_provenance,
                    'retirement_state': locked_truck.retirement_state,
                    'commissioned_at': locked_truck.commissioned_at.isoformat(),
                    'notes': notes or '',
                },
            )
            return locked_truck

    @classmethod
    def reconcile_legacy_truck(
        cls,
        truck,
        *,
        user=None,
        action: str,
        verified_commissioned_at=None,
        verification_notes: str = '',
    ):
        """
        Administrative reconciliation workflow for legacy_reconciliation trucks.
        Supported actions:
          - confirm_commissioned_date_known
          - confirm_commissioned_date_unknown
          - declare_uncommissioned (requires 0 Category A and 0 Category B references; zero silent detachment)
        """
        cls._require_admin(user)

        valid_actions = {
            'confirm_commissioned_date_known',
            'confirm_commissioned_date_unknown',
            'declare_uncommissioned',
        }
        if action not in valid_actions:
            raise ValidationError({'action': f"Invalid action '{action}'. Must be one of {sorted(valid_actions)}."})

        notes_clean = (verification_notes or '').strip()
        if not notes_clean:
            raise ValidationError({'verification_notes': 'verification_notes is required for legacy reconciliation.'})

        parsed_ts = None
        if action == 'confirm_commissioned_date_known':
            if not verified_commissioned_at:
                raise ValidationError({
                    'verified_commissioned_at': 'verified_commissioned_at is required for confirm_commissioned_date_known.'
                })
            parsed_ts = cls._parse_and_validate_timestamp(verified_commissioned_at, 'verified_commissioned_at')
        elif verified_commissioned_at not in (None, ''):
            raise ValidationError({
                'verified_commissioned_at': f"verified_commissioned_at must be omitted or null for action '{action}'."
            })

        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)

            if (
                locked_truck.retirement_state != TruckRetirementState.LEGACY_RECONCILIATION
                or locked_truck.commissioning_provenance != CommissioningProvenance.LEGACY_UNRECONCILED
            ):
                raise TruckLifecycleConflictError(
                    f"Truck {locked_truck.plate_number} is not in legacy_reconciliation state "
                    f"(current state='{locked_truck.retirement_state}', provenance='{locked_truck.commissioning_provenance}').",
                    code='target_not_reconciliation',
                )

            prior_state = locked_truck.retirement_state
            prior_provenance = locked_truck.commissioning_provenance

            if action == 'confirm_commissioned_date_known':
                locked_truck.commissioning_provenance = CommissioningProvenance.COMMISSIONED_VERIFIED
                locked_truck.retirement_state = TruckRetirementState.OPERATIONAL
                locked_truck.commissioned_at = parsed_ts
                locked_truck.is_retired = False

            elif action == 'confirm_commissioned_date_unknown':
                locked_truck.commissioning_provenance = CommissioningProvenance.COMMISSIONED_DATE_UNKNOWN
                locked_truck.retirement_state = TruckRetirementState.OPERATIONAL
                locked_truck.commissioned_at = None
                locked_truck.is_retired = False

            elif action == 'declare_uncommissioned':
                cat_a = TruckHistoricalAuditService.get_category_a_counts(locked_truck)
                non_zero_a = {k: v for k, v in cat_a.items() if v > 0}
                if non_zero_a:
                    raise TruckLifecycleConflictError(
                        f"Cannot declare Truck {locked_truck.plate_number} uncommissioned: "
                        f"Category A historical records exist ({non_zero_a}). Permanent retirement is required.",
                        code='historical_records_exist',
                        details={'historical_counts': non_zero_a},
                    )

                cat_b = TruckHistoricalAuditService.get_category_b_counts(locked_truck)
                non_zero_b = {k: v for k, v in cat_b.items() if v > 0}
                if non_zero_b:
                    raise TruckLifecycleConflictError(
                        f"Cannot declare Truck {locked_truck.plate_number} uncommissioned: "
                        f"live operational references exist ({non_zero_b}). Detach references explicitly first.",
                        code='operational_references_exist',
                        details={'operational_counts': non_zero_b},
                    )

                locked_truck.commissioning_provenance = CommissioningProvenance.UNCOMMISSIONED
                locked_truck.retirement_state = TruckRetirementState.UNCOMMISSIONED
                locked_truck.commissioned_at = None
                locked_truck.is_retired = False

            locked_truck.save(update_fields=[
                'commissioning_provenance',
                'retirement_state',
                'commissioned_at',
                'is_retired',
            ])

            _record_truck_audit_log(
                actor=user,
                action_code='TRUCK_COMMISSIONING_RECONCILED',
                target_object_id=str(locked_truck.id),
                details={
                    'plate_number': locked_truck.plate_number,
                    'reconciliation_action': action,
                    'prior_retirement_state': prior_state,
                    'prior_commissioning_provenance': prior_provenance,
                    'new_retirement_state': locked_truck.retirement_state,
                    'new_commissioning_provenance': locked_truck.commissioning_provenance,
                    'commissioned_at': locked_truck.commissioned_at.isoformat() if locked_truck.commissioned_at else None,
                    'verification_notes': notes_clean,
                },
            )
            return locked_truck

    @classmethod
    def retire_truck(cls, truck, *, user=None, reason: str = ''):
        """
        Owner-Approved Item 13 (Option A): 4-phase resumable permanent retirement workflow
        for commissioned vehicles. Preserves all Category A historical attribution indefinitely.
        """
        cls._require_admin(user)
        from driver.shift_service import ShiftService
        from watcher.models import GarbageHotspot

        # Phase 0: Persisted Retirement Gate under Level T1 lock
        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            if locked_truck.retirement_state == TruckRetirementState.PERMANENTLY_RETIRED:
                return locked_truck

            if locked_truck.retirement_state not in (
                TruckRetirementState.OPERATIONAL,
                TruckRetirementState.RETIREMENT_IN_PROGRESS,
            ):
                raise TruckLifecycleConflictError(
                    f"Cannot retire Truck {locked_truck.plate_number}: vehicle is in state "
                    f"'{locked_truck.retirement_state}' (provenance '{locked_truck.commissioning_provenance}'). "
                    "Only commissioned operational vehicles can be retired.",
                    code='invalid_state_for_retirement',
                )

            if locked_truck.retirement_state == TruckRetirementState.OPERATIONAL:
                # Capture past crew names before detachment if crew exist
                past_names = [f"{c.first_name} {c.last_name}".strip() for c in locked_truck.crew.all()]
                past_names = [n for n in past_names if n]
                if not past_names:
                    past_names = [c.username for c in locked_truck.crew.all()]
                update_fields = ['is_retired', 'status', 'retirement_state']
                if past_names:
                    locked_truck.past_crew_names = ", ".join(past_names)
                    update_fields.append('past_crew_names')

                locked_truck.is_retired = True
                locked_truck.status = TruckStatus.INACTIVE
                locked_truck.retirement_state = TruckRetirementState.RETIREMENT_IN_PROGRESS
                locked_truck.save(update_fields=update_fields)

        # Phase 1: Active Shift Coordinated Draining (ascending PK order, discrete transaction per shift)
        active_shift_ids = list(
            DriverShift.objects.filter(
                Q(truck_id=truck.pk) | Q(allocation__truck_id=truck.pk),
                is_active=True,
            )
            .order_by('id')
            .values_list('id', flat=True)
        )
        for shift_id in active_shift_ids:
            ShiftService.conclude_shift_atomic(
                driver_shift_id=shift_id,
                concluded_by=user,
                end_reason='truck_retired',
            )

        # Detachment Phase Step 2A: Detach standing CollectionSchedule and GarbageHotspot references
        with transaction.atomic():
            standing_schedules = list(
                CollectionSchedule.objects.filter(truck_id=truck.pk).select_for_update().order_by('id')
            )
            if standing_schedules:
                CollectionSchedule.objects.filter(truck_id=truck.pk).update(truck=None, driver=None)

        with transaction.atomic():
            assigned_hotspots = list(
                GarbageHotspot.objects.filter(assigned_truck_id=truck.pk).select_for_update().order_by('id')
            )
            if assigned_hotspots:
                GarbageHotspot.objects.filter(assigned_truck_id=truck.pk).update(assigned_truck=None)

        # Detachment Phase Step 2B: Clear standing driver and crew M2M assignments under Level T1
        TruckAssignmentService.clear_all_assignments(truck)

        # Phase 2: Terminal Permanent Retirement under Level T1 lock
        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            if DriverShift.objects.filter(
                Q(truck=locked_truck) | Q(allocation__truck=locked_truck),
                is_active=True,
            ).exists():
                raise TruckLifecycleConflictError(
                    "Cannot finalize retirement: active DriverShift detected during final phase.",
                    code='active_shift_conflict',
                )
            if (
                CollectionSchedule.objects.filter(truck=locked_truck).exists()
                or GarbageHotspot.objects.filter(assigned_truck=locked_truck).exists()
                or locked_truck.drivers.exists()
                or locked_truck.crew.exists()
            ):
                raise TruckLifecycleConflictError(
                    "Cannot finalize retirement: standing operational references remain.",
                    code='operational_references_remain',
                )

            locked_truck.is_retired = True
            locked_truck.status = TruckStatus.INACTIVE
            locked_truck.retirement_state = TruckRetirementState.PERMANENTLY_RETIRED
            locked_truck.save(update_fields=['is_retired', 'status', 'retirement_state'])

            _record_truck_audit_log(
                actor=user,
                action_code='TRUCK_RETIRED',
                target_object_id=str(locked_truck.id),
                details={
                    'plate_number': locked_truck.plate_number,
                    'commissioning_provenance': locked_truck.commissioning_provenance,
                    'retirement_state': locked_truck.retirement_state,
                    'reason': (reason or '').strip(),
                },
            )
            return locked_truck

    @classmethod
    def delete_uncommissioned_truck(cls, truck, *, user=None):
        """
        Atomic physical deletion for eligible uncommissioned trucks ONLY.
        Acquires Level T1 lock first, re-verifies uncommissioned state, 0 Category A
        historical records, and 0 Category B operational references under lock, and
        invokes the PostgreSQL SECURITY DEFINER function `public.truck_delete_uncommissioned(BIGINT)`
        (or guarded ORM delete on SQLite local dev/test).
        """
        cls._require_admin(user)

        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            truck_id = locked_truck.id
            plate_number = locked_truck.plate_number

            # 1. Re-verify objective uncommissioned state under T1 lock
            if (
                locked_truck.retirement_state != TruckRetirementState.UNCOMMISSIONED
                or locked_truck.commissioning_provenance != CommissioningProvenance.UNCOMMISSIONED
                or locked_truck.commissioned_at is not None
                or locked_truck.is_retired
            ):
                raise ProtectedError(
                    f"Cannot physically delete Truck {truck_id} ({plate_number}): vehicle is not uncommissioned "
                    f"(provenance='{locked_truck.commissioning_provenance}', state='{locked_truck.retirement_state}', "
                    f"commissioned_at={locked_truck.commissioned_at}). Commissioned vehicles must be permanently retired.",
                    [locked_truck],
                )

            # 2. Re-verify 0 Category A historical records under T1 lock
            cat_a = TruckHistoricalAuditService.get_category_a_counts(locked_truck)
            non_zero_a = {k: v for k, v in cat_a.items() if v > 0}
            if non_zero_a:
                raise ProtectedError(
                    f"Cannot physically delete Truck {truck_id} ({plate_number}): "
                    f"Category A historical records exist ({non_zero_a}).",
                    [locked_truck],
                )

            # 3. Re-verify 0 Category B operational references under T1 lock
            cat_b = TruckHistoricalAuditService.get_category_b_counts(locked_truck)
            non_zero_b = {k: v for k, v in cat_b.items() if v > 0}
            if non_zero_b:
                raise ProtectedError(
                    f"Cannot physically delete Truck {truck_id} ({plate_number}): "
                    f"standing operational references exist ({non_zero_b}). Detach references before deletion.",
                    [locked_truck],
                )

            _record_truck_audit_log(
                actor=user,
                action_code='TRUCK_UNCOMMISSIONED_DELETED',
                target_object_id=str(truck_id),
                details={
                    'plate_number': plate_number,
                    'commissioning_provenance': locked_truck.commissioning_provenance,
                    'retirement_state': locked_truck.retirement_state,
                },
            )

            # 4. Execute physical deletion via PostgreSQL SECURITY DEFINER function (or guarded ORM delete on SQLite)
            if connection.vendor == 'postgresql':
                with connection.cursor() as cursor:
                    cursor.execute("SELECT public.truck_delete_uncommissioned(%s)", [truck_id])
            else:
                super(Truck, locked_truck).delete()

    @staticmethod
    def get_operator_dumpsite_id(user):
        if not user or not getattr(user, 'is_authenticated', False):
            return None
        if getattr(user, 'role', None) != 'dumpsite':
            return None
        facility_id = getattr(user, 'dumpsite_id', None)
        if not facility_id and hasattr(user, 'operated_dumpsite') and user.operated_dumpsite:
            facility_id = user.operated_dumpsite.id
        return facility_id

    @classmethod
    def _current_other_facility_q(cls, facility_id: int, today=None) -> Q:
        if today is None:
            today = timezone.localdate()
        other_active_shift = DriverShift.objects.filter(
            truck_id=OuterRef('pk'),
            is_active=True,
        ).filter(
            (Q(schedule__dumpsite_id__isnull=False) & ~Q(schedule__dumpsite_id=facility_id))
            | (Q(allocation__schedule__dumpsite_id__isnull=False) & ~Q(allocation__schedule__dumpsite_id=facility_id))
        )
        other_current_alloc = ScheduleTruckAllocation.objects.filter(
            truck_id=OuterRef('pk'),
            allocation_date__gte=today,
            schedule__dumpsite_id__isnull=False,
        ).exclude(schedule__dumpsite_id=facility_id)
        other_current_schedule = CollectionSchedule.objects.filter(
            truck_id=OuterRef('pk'),
            dumpsite_id__isnull=False,
        ).exclude(dumpsite_id=facility_id).exclude(status='CANCELLED').filter(
            Q(date__isnull=True) | Q(date__gte=today)
        )
        return (
            (Q(hold_dumpsite_id__isnull=False) & ~Q(hold_dumpsite_id=facility_id))
            | Q(Exists(other_active_shift))
            | Q(Exists(other_current_alloc))
            | Q(Exists(other_current_schedule))
        )

    @classmethod
    def facility_trucks_q(cls, facility_id: int, today=None) -> Q:
        """
        Canonical facility-scoping Q predicate for Trucks currently associated with `facility_id`.
        Historical past-date schedules/allocations/shifts at Facility A do NOT grant access
        once a truck is actively scheduled, allocated, or held at Facility B.
        """
        if not facility_id:
            return Q(pk__in=[])
        if today is None:
            today = timezone.localdate()

        this_active_shift = DriverShift.objects.filter(
            truck_id=OuterRef('pk'),
            is_active=True,
        ).filter(
            Q(schedule__dumpsite_id=facility_id) | Q(allocation__schedule__dumpsite_id=facility_id)
        )
        this_current_alloc = ScheduleTruckAllocation.objects.filter(
            truck_id=OuterRef('pk'),
            allocation_date__gte=today,
            schedule__dumpsite_id=facility_id,
        )
        this_current_schedule = CollectionSchedule.objects.filter(
            truck_id=OuterRef('pk'),
            dumpsite_id=facility_id,
        ).exclude(status='CANCELLED').filter(
            Q(date__isnull=True) | Q(date__gte=today)
        )
        other_active_shift = DriverShift.objects.filter(
            truck_id=OuterRef('pk'),
            is_active=True,
        ).filter(
            (Q(schedule__dumpsite_id__isnull=False) & ~Q(schedule__dumpsite_id=facility_id))
            | (Q(allocation__schedule__dumpsite_id__isnull=False) & ~Q(allocation__schedule__dumpsite_id=facility_id))
        )
        other_hold_q = Q(hold_dumpsite_id__isnull=False) & ~Q(hold_dumpsite_id=facility_id)

        active_at_facility_q = (
            Q(hold_dumpsite_id=facility_id)
            | Q(Exists(this_active_shift))
            | Q(Exists(this_current_alloc))
            | Q(Exists(this_current_schedule))
        )
        fallback_inspected_q = Q(last_inspected_dumpsite_id=facility_id) & ~cls._current_other_facility_q(
            facility_id, today=today
        )
        return ~other_hold_q & ~Q(Exists(other_active_shift)) & (active_at_facility_q | fallback_inspected_q)

    @classmethod
    def require_admin_or_facility_operator(cls, user, *, truck=None, schedule=None):
        """
        Enforces citywide Admin authority or Dumpsite Operator facility-scoped authority.
        """
        if not user or not getattr(user, 'is_authenticated', False):
            raise PermissionDenied("Authentication required.")
        if is_admin_user(user):
            return None

        facility_id = cls.get_operator_dumpsite_id(user)
        if not facility_id:
            raise PermissionDenied("Administrator or assigned Dumpsite Operator role required.")

        if schedule is not None and schedule.dumpsite_id != facility_id:
            raise PermissionDenied("Cross-Dumpsite access denied: schedule belongs to a different facility.")

        if truck is not None:
            if truck.hold_dumpsite_id and truck.hold_dumpsite_id != facility_id:
                raise PermissionDenied("Cross-Dumpsite access denied: operational hold belongs to another facility.")
            if not Truck.objects.filter(pk=truck.pk).filter(cls.facility_trucks_q(facility_id)).exists():
                raise PermissionDenied("Cross-Dumpsite access denied: truck is not assigned to your facility.")

        return facility_id

    @classmethod
    def _resolve_truck_dumpsite_id(cls, truck, *, explicit_dumpsite_id=None, facility_id=None, today=None):
        if facility_id:
            return facility_id
        if explicit_dumpsite_id:
            return int(explicit_dumpsite_id)
        if truck is None:
            return None
        if truck.hold_dumpsite_id:
            return truck.hold_dumpsite_id
        if today is None:
            today = timezone.localdate()
        active_shift = (
            DriverShift.objects.filter(truck=truck, is_active=True)
            .select_related('schedule', 'allocation__schedule')
            .first()
        )
        if active_shift and active_shift.effective_dumpsite:
            return active_shift.effective_dumpsite.id
        alloc = (
            ScheduleTruckAllocation.objects.filter(truck=truck, allocation_date__gte=today, schedule__dumpsite_id__isnull=False)
            .select_related('schedule')
            .order_by('allocation_date', 'id')
            .first()
        )
        if alloc and alloc.schedule.dumpsite_id:
            return alloc.schedule.dumpsite_id
        sched = (
            CollectionSchedule.objects.filter(truck=truck, dumpsite_id__isnull=False)
            .exclude(status='CANCELLED')
            .filter(Q(date__isnull=True) | Q(date__gte=today))
            .order_by('-id')
            .first()
        )
        if sched and sched.dumpsite_id:
            return sched.dumpsite_id
        return truck.last_inspected_dumpsite_id

    @classmethod
    def clear_operational_hold(cls, truck, *, user=None, resolution_notes: str = ''):
        cls.require_admin_or_facility_operator(user, truck=truck)
        notes = (resolution_notes or '').strip()
        if not notes:
            raise ValidationError({'resolution_notes': 'Resolution notes are required to clear an operational hold.'})

        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            cls.require_admin_or_facility_operator(user, truck=locked_truck)

            if locked_truck.is_retired:
                raise TruckLifecycleConflictError(
                    f"Truck {locked_truck.plate_number} is retired and cannot be cleared from hold.",
                    code='truck_retired',
                )
            if not locked_truck.is_operational_hold:
                raise ValidationError({'is_operational_hold': f"Truck {locked_truck.plate_number} is not on operational hold."})

            prev_hold_dumpsite_id = locked_truck.hold_dumpsite_id
            prev_hold_reason = locked_truck.hold_reason
            prev_hold_placed_by_id = locked_truck.hold_placed_by_id
            prev_hold_placed_at = locked_truck.hold_placed_at
            now_ts = timezone.now()

            locked_truck.is_operational_hold = False
            locked_truck.hold_dumpsite = None
            locked_truck.hold_placed_by = None
            locked_truck.hold_placed_at = None
            locked_truck.hold_reason = ''
            if locked_truck.mechanical_status == 'needs_inspection':
                locked_truck.mechanical_status = 'serviceable'
            if locked_truck.inspection_state == 'FAILED':
                locked_truck.inspection_state = 'PASSED'
            if locked_truck.mechanical_condition != 'OPERATIONAL':
                locked_truck.mechanical_condition = 'OPERATIONAL'
            if locked_truck.status == TruckStatus.MAINTENANCE and locked_truck.maintenance_status == 'available':
                locked_truck.status = TruckStatus.ACTIVE
                if locked_truck.op_status == 'MAINTENANCE':
                    locked_truck.op_status = 'AVAILABLE'
            locked_truck.save(update_fields=[
                'is_operational_hold', 'hold_dumpsite', 'hold_placed_by', 'hold_placed_at',
                'hold_reason', 'mechanical_status', 'inspection_state', 'mechanical_condition',
                'status', 'op_status',
            ])

            actor = user if (user and getattr(user, 'is_authenticated', False)) else None
            updated_logs = TruckOperationalHoldLog.objects.filter(
                truck=locked_truck,
                is_active=True,
            ).update(
                is_active=False,
                cleared_by=actor,
                cleared_at=now_ts,
                resolution_notes=notes,
            )
            if updated_logs == 0:
                log = TruckOperationalHoldLog.objects.create(
                    truck=locked_truck,
                    dumpsite_id=prev_hold_dumpsite_id,
                    is_active=False,
                    reason=prev_hold_reason or 'Operational hold',
                    placed_by_id=prev_hold_placed_by_id,
                    cleared_by=actor,
                    cleared_at=now_ts,
                    resolution_notes=notes,
                )
                if prev_hold_placed_at:
                    TruckOperationalHoldLog.objects.filter(pk=log.pk).update(placed_at=prev_hold_placed_at)

            _record_truck_audit_log(
                actor=user,
                action_code='TRUCK_OPERATIONAL_HOLD_CLEARED',
                target_object_id=str(locked_truck.id),
                details={
                    'plate_number': locked_truck.plate_number,
                    'previous_hold_dumpsite_id': prev_hold_dumpsite_id,
                    'previous_hold_reason': prev_hold_reason,
                    'resolution_notes': notes,
                },
            )
            return locked_truck

    @classmethod
    def create_maintenance_record(
        cls,
        truck,
        *,
        user=None,
        maintenance_type: str = MaintenanceType.CORRECTIVE,
        title: str = '',
        notes: str = '',
        scheduled_for=None,
        cost=None,
        odometer_km=None,
        start_immediately: bool = False,
        dumpsite_id: int = None,
        maintenance_status: str = 'under_repair',
    ) -> TruckMaintenanceRecord:
        title_clean = (title or '').strip()
        notes_clean = (notes or '').strip()
        if not title_clean and notes_clean:
            title_clean = notes_clean[:200]
        if not title_clean:
            raise ValidationError({'title': 'Maintenance title or description is required.'})

        mtype = (maintenance_type or MaintenanceType.CORRECTIVE).strip().upper()
        if mtype not in set(MaintenanceType.values):
            raise ValidationError({'maintenance_type': f"Invalid maintenance_type '{maintenance_type}'."})

        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            facility_id = cls.require_admin_or_facility_operator(user, truck=locked_truck)

            if locked_truck.is_retired:
                raise TruckLifecycleConflictError(
                    f"Truck {locked_truck.plate_number} is retired and cannot undergo maintenance transitions.",
                    code='truck_retired',
                )

            resolved_dumpsite_id = cls._resolve_truck_dumpsite_id(
                locked_truck, explicit_dumpsite_id=dumpsite_id, facility_id=facility_id
            )
            if facility_id and resolved_dumpsite_id and resolved_dumpsite_id != facility_id:
                raise PermissionDenied("Cross-Dumpsite access denied: maintenance record facility mismatch.")

            actor = user if (user and getattr(user, 'is_authenticated', False)) else None
            now_ts = timezone.now()

            if start_immediately:
                if DriverShift.objects.filter(truck=locked_truck, is_active=True).exists():
                    raise TruckLifecycleConflictError(
                        f"Truck {locked_truck.plate_number} has an active shift; conclude the shift before starting maintenance.",
                        code='active_shift_conflict',
                    )
                rec = TruckMaintenanceRecord.objects.create(
                    truck=locked_truck,
                    dumpsite_id=resolved_dumpsite_id,
                    maintenance_type=mtype,
                    status=MaintenanceRecordStatus.IN_PROGRESS,
                    title=title_clean[:200],
                    notes=notes_clean,
                    scheduled_for=scheduled_for,
                    started_at=now_ts,
                    cost=cost,
                    odometer_km=odometer_km,
                    created_by=actor,
                    started_by=actor,
                )
                locked_truck.status = TruckStatus.MAINTENANCE
                locked_truck.maintenance_status = (
                    maintenance_status
                    if maintenance_status in {'scheduled_maintenance', 'under_repair'}
                    else 'under_repair'
                )
                locked_truck.maintenance_start = now_ts
                locked_truck.op_status = 'MAINTENANCE'
                locked_truck.save(update_fields=[
                    'status', 'maintenance_status', 'maintenance_start', 'op_status',
                ])
                action_code = 'TRUCK_MAINTENANCE_START'
            else:
                rec = TruckMaintenanceRecord.objects.create(
                    truck=locked_truck,
                    dumpsite_id=resolved_dumpsite_id,
                    maintenance_type=mtype,
                    status=MaintenanceRecordStatus.SCHEDULED,
                    title=title_clean[:200],
                    notes=notes_clean,
                    scheduled_for=scheduled_for,
                    cost=cost,
                    odometer_km=odometer_km,
                    created_by=actor,
                )
                if locked_truck.maintenance_status == 'available':
                    locked_truck.maintenance_status = 'scheduled_maintenance'
                    locked_truck.save(update_fields=['maintenance_status'])
                action_code = 'TRUCK_MAINTENANCE_SCHEDULE'

            _record_truck_audit_log(
                actor=user,
                action_code=action_code,
                target_object_id=str(locked_truck.id),
                details={
                    'plate_number': locked_truck.plate_number,
                    'maintenance_record_id': rec.id,
                    'maintenance_status': locked_truck.maintenance_status,
                    'status': locked_truck.status,
                    'title': rec.title,
                    'reason': notes_clean or rec.title,
                },
            )
            return rec

    @classmethod
    def update_maintenance_record(cls, record, *, user=None, data: dict = None) -> TruckMaintenanceRecord:
        payload = data or {}
        with transaction.atomic():
            rec = TruckMaintenanceRecord.objects.select_for_update().select_related('truck').get(pk=record.pk)
            locked_truck = Truck.objects.select_for_update().get(pk=rec.truck_id)
            facility_id = cls.require_admin_or_facility_operator(user, truck=locked_truck)
            if facility_id and rec.dumpsite_id and rec.dumpsite_id != facility_id:
                raise PermissionDenied("Cross-Dumpsite access denied: maintenance record belongs to another facility.")
            if locked_truck.is_retired:
                raise TruckLifecycleConflictError(
                    f"Truck {locked_truck.plate_number} is retired.",
                    code='truck_retired',
                )
            if rec.status in (MaintenanceRecordStatus.COMPLETED, MaintenanceRecordStatus.CANCELLED):
                raise TruckLifecycleConflictError(
                    f"Maintenance record #{rec.id} is already {rec.status} and cannot be modified.",
                    code='maintenance_closed',
                )

            update_fields = []
            if 'title' in payload:
                t = (payload.get('title') or '').strip()
                if not t:
                    raise ValidationError({'title': 'Title cannot be blank.'})
                rec.title = t[:200]
                update_fields.append('title')
            if 'notes' in payload:
                rec.notes = (payload.get('notes') or '').strip()
                update_fields.append('notes')
            if 'maintenance_type' in payload and payload.get('maintenance_type') is not None:
                mtype = str(payload.get('maintenance_type')).strip().upper()
                if mtype not in set(MaintenanceType.values):
                    raise ValidationError({'maintenance_type': f"Invalid maintenance_type '{mtype}'."})
                rec.maintenance_type = mtype
                update_fields.append('maintenance_type')
            if 'scheduled_for' in payload:
                rec.scheduled_for = payload.get('scheduled_for')
                update_fields.append('scheduled_for')
            if 'cost' in payload:
                rec.cost = payload.get('cost')
                update_fields.append('cost')
            if 'odometer_km' in payload:
                rec.odometer_km = payload.get('odometer_km')
                update_fields.append('odometer_km')

            if update_fields:
                update_fields.append('updated_at')
                rec.save(update_fields=update_fields)

            _record_truck_audit_log(
                actor=user,
                action_code='TRUCK_MAINTENANCE_UPDATE',
                target_object_id=str(locked_truck.id),
                details={
                    'plate_number': locked_truck.plate_number,
                    'maintenance_record_id': rec.id,
                    'title': rec.title,
                    'notes': rec.notes,
                },
            )
            return rec

    @classmethod
    def start_maintenance_record(cls, record, *, user=None, maintenance_status: str = 'under_repair') -> TruckMaintenanceRecord:
        with transaction.atomic():
            rec = TruckMaintenanceRecord.objects.select_for_update().get(pk=record.pk)
            locked_truck = Truck.objects.select_for_update().get(pk=rec.truck_id)
            facility_id = cls.require_admin_or_facility_operator(user, truck=locked_truck)
            if facility_id and rec.dumpsite_id and rec.dumpsite_id != facility_id:
                raise PermissionDenied("Cross-Dumpsite access denied: maintenance record belongs to another facility.")
            if locked_truck.is_retired:
                raise TruckLifecycleConflictError(
                    f"Truck {locked_truck.plate_number} is retired and cannot undergo maintenance transitions.",
                    code='truck_retired',
                )
            if rec.status != MaintenanceRecordStatus.SCHEDULED:
                raise TruckLifecycleConflictError(
                    f"Maintenance record #{rec.id} is in status '{rec.status}' and cannot be started.",
                    code='invalid_maintenance_state',
                )
            if DriverShift.objects.filter(truck=locked_truck, is_active=True).exists():
                raise TruckLifecycleConflictError(
                    f"Truck {locked_truck.plate_number} has an active shift; conclude the shift before starting maintenance.",
                    code='active_shift_conflict',
                )

            now_ts = timezone.now()
            actor = user if (user and getattr(user, 'is_authenticated', False)) else None
            rec.status = MaintenanceRecordStatus.IN_PROGRESS
            rec.started_at = now_ts
            rec.started_by = actor
            rec.save(update_fields=['status', 'started_at', 'started_by', 'updated_at'])

            locked_truck.status = TruckStatus.MAINTENANCE
            locked_truck.maintenance_status = (
                maintenance_status
                if maintenance_status in {'scheduled_maintenance', 'under_repair'}
                else 'under_repair'
            )
            locked_truck.maintenance_start = now_ts
            locked_truck.op_status = 'MAINTENANCE'
            locked_truck.save(update_fields=[
                'status', 'maintenance_status', 'maintenance_start', 'op_status',
            ])

            _record_truck_audit_log(
                actor=user,
                action_code='TRUCK_MAINTENANCE_START',
                target_object_id=str(locked_truck.id),
                details={
                    'plate_number': locked_truck.plate_number,
                    'maintenance_record_id': rec.id,
                    'maintenance_status': locked_truck.maintenance_status,
                    'status': locked_truck.status,
                    'title': rec.title,
                },
            )
            return rec

    @classmethod
    def complete_maintenance_record(
        cls,
        record,
        *,
        user=None,
        completion_notes: str = '',
        cost=None,
        odometer_km=None,
    ) -> TruckMaintenanceRecord:
        with transaction.atomic():
            rec = TruckMaintenanceRecord.objects.select_for_update().get(pk=record.pk)
            locked_truck = Truck.objects.select_for_update().get(pk=rec.truck_id)
            facility_id = cls.require_admin_or_facility_operator(user, truck=locked_truck)
            if facility_id and rec.dumpsite_id and rec.dumpsite_id != facility_id:
                raise PermissionDenied("Cross-Dumpsite access denied: maintenance record belongs to another facility.")
            if locked_truck.is_retired:
                raise TruckLifecycleConflictError(
                    f"Truck {locked_truck.plate_number} is retired and cannot undergo maintenance transitions.",
                    code='truck_retired',
                )
            if rec.status not in (MaintenanceRecordStatus.SCHEDULED, MaintenanceRecordStatus.IN_PROGRESS):
                raise TruckLifecycleConflictError(
                    f"Maintenance record #{rec.id} is already '{rec.status}'.",
                    code='invalid_maintenance_state',
                )

            now_ts = timezone.now()
            actor = user if (user and getattr(user, 'is_authenticated', False)) else None
            rec.status = MaintenanceRecordStatus.COMPLETED
            rec.completed_at = now_ts
            rec.completed_by = actor
            if completion_notes is not None and str(completion_notes).strip():
                rec.completion_notes = str(completion_notes).strip()
            if cost is not None:
                rec.cost = cost
            if odometer_km is not None:
                rec.odometer_km = odometer_km
            rec.save(update_fields=[
                'status', 'completed_at', 'completed_by', 'completion_notes',
                'cost', 'odometer_km', 'updated_at',
            ])

            has_other_active = TruckMaintenanceRecord.objects.filter(
                truck=locked_truck, status=MaintenanceRecordStatus.IN_PROGRESS
            ).exclude(pk=rec.pk).exists()
            if not has_other_active:
                locked_truck.maintenance_status = 'available'
                locked_truck.last_service = timezone.localdate()
                locked_truck.status = TruckStatus.ACTIVE
                locked_truck.op_status = 'AVAILABLE'
                update_fields = ['status', 'maintenance_status', 'last_service', 'op_status']
                if not locked_truck.is_operational_hold:
                    locked_truck.mechanical_status = 'serviceable'
                    locked_truck.mechanical_condition = 'OPERATIONAL'
                    update_fields.extend(['mechanical_status', 'mechanical_condition'])
                locked_truck.save(update_fields=update_fields)

            _record_truck_audit_log(
                actor=user,
                action_code='TRUCK_MAINTENANCE_COMPLETE',
                target_object_id=str(locked_truck.id),
                details={
                    'plate_number': locked_truck.plate_number,
                    'maintenance_record_id': rec.id,
                    'maintenance_status': locked_truck.maintenance_status,
                    'status': locked_truck.status,
                    'is_operational_hold': locked_truck.is_operational_hold,
                    'completion_notes': rec.completion_notes,
                },
            )
            return rec

    @classmethod
    def record_maintenance(
        cls,
        truck,
        *,
        user=None,
        action_type: str = 'start',
        reason: str = '',
        maintenance_status: str = 'under_repair',
        maintenance_type: str = MaintenanceType.CORRECTIVE,
        title: str = '',
        scheduled_for=None,
        cost=None,
        odometer_km=None,
        record_id: int = None,
    ):
        cls.require_admin_or_facility_operator(user, truck=truck)
        action_type = (action_type or 'start').strip().lower()
        if action_type not in {'schedule', 'start', 'update', 'complete'}:
            raise ValidationError({'action_type': "action_type must be 'schedule', 'start', 'update', or 'complete'."})

        reason_text = (reason or '').strip()
        title_text = (title or '').strip() or reason_text[:200]
        if action_type in {'schedule', 'start'} and not title_text:
            raise ValidationError({'reason': 'Maintenance reason/description is required.'})

        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)
            facility_id = cls.require_admin_or_facility_operator(user, truck=locked_truck)

            if locked_truck.is_retired:
                raise TruckLifecycleConflictError(
                    f"Truck {locked_truck.plate_number} is retired and cannot undergo maintenance transitions.",
                    code='truck_retired',
                )

            if action_type == 'schedule':
                cls.create_maintenance_record(
                    locked_truck,
                    user=user,
                    maintenance_type=maintenance_type,
                    title=title_text,
                    notes=reason_text,
                    scheduled_for=scheduled_for,
                    cost=cost,
                    odometer_km=odometer_km,
                    start_immediately=False,
                    dumpsite_id=facility_id,
                    maintenance_status=maintenance_status,
                )
            elif action_type == 'start':
                target_rec = None
                if record_id:
                    target_rec = TruckMaintenanceRecord.objects.filter(pk=record_id, truck=locked_truck).first()
                if not target_rec:
                    target_rec = TruckMaintenanceRecord.objects.filter(
                        truck=locked_truck, status=MaintenanceRecordStatus.SCHEDULED
                    ).order_by('-id').first()
                if target_rec and not record_id and title_text and target_rec.title != title_text:
                    target_rec = None
                if target_rec:
                    cls.start_maintenance_record(target_rec, user=user, maintenance_status=maintenance_status)
                else:
                    cls.create_maintenance_record(
                        locked_truck,
                        user=user,
                        maintenance_type=maintenance_type,
                        title=title_text,
                        notes=reason_text,
                        scheduled_for=scheduled_for,
                        cost=cost,
                        odometer_km=odometer_km,
                        start_immediately=True,
                        dumpsite_id=facility_id,
                        maintenance_status=maintenance_status,
                    )
            elif action_type == 'update':
                target_rec = None
                if record_id:
                    target_rec = TruckMaintenanceRecord.objects.filter(pk=record_id, truck=locked_truck).first()
                else:
                    target_rec = TruckMaintenanceRecord.objects.filter(
                        truck=locked_truck,
                        status__in=[MaintenanceRecordStatus.IN_PROGRESS, MaintenanceRecordStatus.SCHEDULED],
                    ).order_by('-id').first()
                if not target_rec:
                    raise ValidationError({'record_id': 'No active or scheduled maintenance record found to update.'})
                update_payload = {}
                if title:
                    update_payload['title'] = title
                if reason_text:
                    update_payload['notes'] = reason_text
                if scheduled_for is not None:
                    update_payload['scheduled_for'] = scheduled_for
                if cost is not None:
                    update_payload['cost'] = cost
                if odometer_km is not None:
                    update_payload['odometer_km'] = odometer_km
                cls.update_maintenance_record(target_rec, user=user, data=update_payload)
            elif action_type == 'complete':
                target_rec = None
                if record_id:
                    target_rec = TruckMaintenanceRecord.objects.filter(pk=record_id, truck=locked_truck).first()
                else:
                    target_rec = TruckMaintenanceRecord.objects.filter(
                        truck=locked_truck,
                        status__in=[MaintenanceRecordStatus.IN_PROGRESS, MaintenanceRecordStatus.SCHEDULED],
                    ).order_by('-id').first()
                if target_rec:
                    cls.complete_maintenance_record(
                        target_rec,
                        user=user,
                        completion_notes=reason_text,
                        cost=cost,
                        odometer_km=odometer_km,
                    )
                else:
                    # Direct truck completion fallback (preserving Truck.status_reason and active hold)
                    locked_truck.maintenance_status = 'available'
                    locked_truck.last_service = timezone.localdate()
                    locked_truck.status = TruckStatus.ACTIVE
                    locked_truck.op_status = 'AVAILABLE'
                    update_fields = ['status', 'maintenance_status', 'last_service', 'op_status']
                    if not locked_truck.is_operational_hold:
                        locked_truck.mechanical_status = 'serviceable'
                        locked_truck.mechanical_condition = 'OPERATIONAL'
                        update_fields.extend(['mechanical_status', 'mechanical_condition'])
                    locked_truck.save(update_fields=update_fields)
                    _record_truck_audit_log(
                        actor=user,
                        action_code='TRUCK_MAINTENANCE_COMPLETE',
                        target_object_id=str(locked_truck.id),
                        details={
                            'plate_number': locked_truck.plate_number,
                            'maintenance_status': locked_truck.maintenance_status,
                            'status': locked_truck.status,
                            'is_operational_hold': locked_truck.is_operational_hold,
                            'reason': reason_text,
                        },
                    )

            locked_truck.refresh_from_db()
            return locked_truck

    @classmethod
    def update_inspection_state(
        cls,
        truck,
        *,
        user=None,
        inspection_state: str = 'PASSED',
        mechanical_condition: str = None,
        reason: str = '',
        dumpsite_id: int = None,
        driver_shift=None,
        inspection=None,
    ):
        if driver_shift is not None and getattr(user, 'role', None) == 'driver' and not is_admin_user(user):
            if driver_shift.driver_id != user.id:
                raise PermissionDenied("Drivers may only submit inspections for their own DriverShift.")
        else:
            cls.require_admin_or_facility_operator(user, truck=truck)
        state = (inspection_state or '').strip().upper()
        if state not in {'PASSED', 'PENDING_INSPECTION', 'FAILED'}:
            raise ValidationError({
                'inspection_state': "inspection_state must be 'PASSED', 'PENDING_INSPECTION', or 'FAILED'."
            })

        normalized_condition = None
        if mechanical_condition is not None and str(mechanical_condition).strip() != '':
            normalized_condition = str(mechanical_condition).strip().upper()
            if normalized_condition not in {'OPERATIONAL', 'NEEDS_REPAIR', 'CRITICAL'}:
                raise ValidationError({
                    'mechanical_condition': "mechanical_condition must be 'OPERATIONAL', 'NEEDS_REPAIR', or 'CRITICAL'."
                })

        with transaction.atomic():
            locked_truck = Truck.objects.select_for_update().get(pk=truck.pk)

            if driver_shift is not None and getattr(user, 'role', None) == 'driver' and not is_admin_user(user):
                if driver_shift.driver_id != user.id:
                    raise PermissionDenied("Drivers may only submit inspections for their own DriverShift.")
                shift_truck = driver_shift.effective_truck
                if not shift_truck or shift_truck.id != locked_truck.id:
                    raise ValidationError({'driver_shift_id': 'Shift truck mismatch during inspection submission.'})
                shift_dumpsite = driver_shift.effective_dumpsite
                effective_dumpsite_id = dumpsite_id or (shift_dumpsite.id if shift_dumpsite else None)
            else:
                facility_id = cls.require_admin_or_facility_operator(user, truck=locked_truck)
                effective_dumpsite_id = cls._resolve_truck_dumpsite_id(
                    locked_truck, explicit_dumpsite_id=dumpsite_id, facility_id=facility_id
                )

            if locked_truck.is_retired:
                raise TruckLifecycleConflictError(
                    f"Truck {locked_truck.plate_number} is retired.",
                    code='truck_retired',
                )

            locked_truck.inspection_state = state
            if normalized_condition:
                locked_truck.mechanical_condition = normalized_condition
            if effective_dumpsite_id:
                locked_truck.last_inspected_dumpsite_id = effective_dumpsite_id

            # Failed inspection places operational hold ONLY; never auto-creates maintenance
            # and never alters Truck.status_reason, Truck.status, or Truck.is_retired/retirement_state.
            if state == 'FAILED':
                hold_note = (reason or '').strip() or 'Failed inspection check'
                now_ts = timezone.now()
                actor = user if (user and getattr(user, 'is_authenticated', False)) else None
                locked_truck.is_operational_hold = True
                locked_truck.mechanical_status = 'needs_inspection'
                locked_truck.hold_placed_by = actor
                locked_truck.hold_placed_at = now_ts
                locked_truck.hold_reason = hold_note[:255]
                if effective_dumpsite_id:
                    locked_truck.hold_dumpsite_id = effective_dumpsite_id
                locked_truck.save(update_fields=[
                    'inspection_state', 'mechanical_condition', 'last_inspected_dumpsite',
                    'is_operational_hold', 'mechanical_status', 'hold_placed_by',
                    'hold_placed_at', 'hold_reason', 'hold_dumpsite',
                ])
                TruckOperationalHoldLog.objects.create(
                    truck=locked_truck,
                    dumpsite_id=effective_dumpsite_id,
                    inspection=inspection,
                    is_active=True,
                    reason=hold_note,
                    placed_by=actor,
                )
            else:
                if state == 'PASSED' and locked_truck.mechanical_status == 'needs_inspection' and not locked_truck.is_operational_hold:
                    locked_truck.mechanical_status = 'serviceable'
                locked_truck.save(update_fields=[
                    'inspection_state', 'mechanical_condition', 'last_inspected_dumpsite', 'mechanical_status',
                ])

            _record_truck_audit_log(
                actor=user,
                action_code=f'TRUCK_INSPECTION_{state}',
                target_object_id=str(locked_truck.id),
                details={
                    'plate_number': locked_truck.plate_number,
                    'inspection_state': state,
                    'mechanical_condition': locked_truck.mechanical_condition,
                    'is_operational_hold': locked_truck.is_operational_hold,
                    'dumpsite_id': effective_dumpsite_id,
                    'inspection_id': inspection.id if inspection else None,
                    'reason': (reason or '').strip(),
                },
            )
            return locked_truck

    @classmethod
    def replace_truck_assignment(
        cls,
        truck,
        *,
        replacement_truck_id: int,
        schedule_id: int,
        user=None,
        effective_date=None,
        reason: str = '',
        transfer_drivers: bool = False,
        replacement_request_id: int = None,
    ):
        """
        Authorized truck replacement/switch for a schedule deployment.
        Preserves all historical DriverShift.truck attribution and prior allocations.
        """
        from .models import CrewShift

        if not schedule_id:
            raise ValidationError({'schedule_id': 'schedule_id is required when replacing a truck assignment.'})
        reason_text = (reason or '').strip()
        if not reason_text:
            raise ValidationError({'reason': 'A replacement reason is required for auditability.'})

        target_date = effective_date or timezone.localdate()

        with transaction.atomic():
            # 1. Lock CollectionSchedule first (Canonical order: CollectionSchedule -> SanitationTeam -> ScheduleTruckAllocation -> Truck -> TruckReplacementRequest)
            schedule = CollectionSchedule.objects.select_for_update().filter(pk=schedule_id).first()
            if not schedule:
                raise ValidationError({'schedule_id': f"Schedule #{schedule_id} not found."})

            operator_facility_id = cls.require_admin_or_facility_operator(user, schedule=schedule)
            if schedule.status in ('CANCELLED', 'COMPLETED'):
                raise TruckLifecycleConflictError(
                    f"Cannot replace truck assignment for a {schedule.status.lower()} schedule.",
                    code='schedule_not_active',
                )

            if int(replacement_truck_id) == truck.pk:
                raise ValidationError({'replacement_truck_id': 'Replacement truck must be different from the current truck.'})

            # 2. Resolve and lock effective SanitationTeam BEFORE ScheduleTruckAllocation & Truck
            from .allocation_service import AllocationService
            resolved_team = AllocationService.resolve_schedule_team(schedule.id, target_date=target_date)
            team = SanitationTeam.objects.filter(id=resolved_team.id, is_active=True).select_for_update().first()
            if not team:
                raise ValidationError({'team': f"Resolved team for Schedule #{schedule.id} is inactive."})

            # 3. Lock existing ScheduleTruckAllocation for (schedule, old_truck, target_date) BEFORE Truck
            existing_alloc = ScheduleTruckAllocation.objects.select_for_update().filter(
                schedule=schedule, truck_id=truck.pk, allocation_date=target_date
            ).first()
            if existing_alloc and (
                DriverShift.objects.filter(allocation=existing_alloc).exists()
                or CrewShift.objects.filter(allocation=existing_alloc).exists()
            ):
                raise TruckLifecycleConflictError(
                    f"Allocation #{existing_alloc.id} has already been used by a DriverShift or CrewShift and cannot be overwritten.",
                    code='allocation_already_used',
                )

            # 4. Lock old and replacement Truck rows in ascending PK order
            lock_ids = sorted([truck.pk, int(replacement_truck_id)])
            locked_trucks = {
                t.pk: t for t in Truck.objects.filter(pk__in=lock_ids).order_by('pk').select_for_update()
            }
            old_truck = locked_trucks.get(truck.pk)
            new_truck = locked_trucks.get(int(replacement_truck_id))
            if not old_truck or not new_truck:
                raise ValidationError({'replacement_truck_id': 'Replacement truck not found.'})

            if existing_alloc is None and schedule.truck_id != old_truck.id:
                raise TruckLifecycleConflictError(
                    f"Truck {old_truck.plate_number} is not assigned to Schedule #{schedule.id} on {target_date}.",
                    code='truck_not_assigned_to_schedule',
                )

            if DriverShift.objects.filter(truck=old_truck, is_active=True).exists():
                raise TruckLifecycleConflictError(
                    f"Truck {old_truck.plate_number} is currently in an active DriverShift and cannot be replaced.",
                    code='old_truck_active_shift_conflict',
                )

            # Enforce facility isolation on both old_truck and new_truck for facility operators
            if operator_facility_id:
                if Truck.objects.filter(pk=old_truck.pk).filter(cls._current_other_facility_q(operator_facility_id, today=target_date)).exists():
                    raise PermissionDenied(
                        f"Cross-Dumpsite access denied: current truck {old_truck.plate_number} is currently assigned or held at another facility."
                    )
                if Truck.objects.filter(pk=new_truck.pk).filter(cls._current_other_facility_q(operator_facility_id, today=target_date)).exists():
                    raise PermissionDenied(
                        f"Cross-Dumpsite access denied: replacement truck {new_truck.plate_number} is currently assigned or held at another facility."
                    )

            if not is_truck_dispatchable(new_truck):
                if new_truck.is_retired or new_truck.status != TruckStatus.ACTIVE:
                    err_code = 'replacement_unavailable'
                elif new_truck.is_operational_hold:
                    err_code = 'replacement_on_hold'
                elif new_truck.maintenance_status != 'available' or new_truck.mechanical_status != 'serviceable':
                    err_code = 'replacement_maintenance_conflict'
                else:
                    err_code = 'replacement_not_dispatchable'
                raise TruckLifecycleConflictError(
                    f"Replacement truck {new_truck.plate_number} is not dispatchable "
                    f"(status={new_truck.status}, retired={new_truck.is_retired}, state={new_truck.retirement_state}, "
                    f"hold={new_truck.is_operational_hold}, mechanical_status={new_truck.mechanical_status}, "
                    f"maintenance_status={new_truck.maintenance_status}, mechanical_condition={new_truck.mechanical_condition}).",
                    code=err_code,
                )

            # 5. Revalidate identifiers and check overlapping schedule allocation or active shift on replacement truck
            if ScheduleTruckAllocation.objects.filter(
                truck=new_truck, allocation_date=target_date
            ).exclude(pk=existing_alloc.pk if existing_alloc else None).exists():
                raise TruckLifecycleConflictError(
                    f"Replacement truck {new_truck.plate_number} is already allocated on {target_date}.",
                    code='replacement_allocation_conflict',
                )
            if DriverShift.objects.filter(truck=new_truck, is_active=True).exclude(schedule=schedule).exists():
                raise TruckLifecycleConflictError(
                    f"Replacement truck {new_truck.plate_number} is currently in an active shift on another schedule.",
                    code='replacement_active_shift_conflict',
                )

            if existing_alloc:
                existing_alloc.refresh_from_db()
                if (
                    existing_alloc.schedule_id != schedule.id
                    or existing_alloc.truck_id != old_truck.id
                    or existing_alloc.allocation_date != target_date
                ):
                    raise TruckLifecycleConflictError(
                        f"Allocation #{existing_alloc.id} changed concurrently during truck replacement.",
                        code='allocation_concurrent_change',
                    )
                if (
                    DriverShift.objects.filter(allocation=existing_alloc).exists()
                    or CrewShift.objects.filter(allocation=existing_alloc).exists()
                ):
                    raise TruckLifecycleConflictError(
                        f"Allocation #{existing_alloc.id} has already been used by a DriverShift or CrewShift and cannot be overwritten.",
                        code='allocation_already_used',
                    )
                existing_alloc.truck = new_truck
                existing_alloc.team = team
                existing_alloc.allocated_by = user
                existing_alloc.save(update_fields=['truck', 'team', 'allocated_by'])
                allocation = existing_alloc
            else:
                allocation = ScheduleTruckAllocation.objects.create(
                    schedule=schedule,
                    allocation_date=target_date,
                    truck=new_truck,
                    team=team,
                    allocated_by=user,
                )

            if new_truck.op_status == 'AVAILABLE':
                new_truck.op_status = 'ASSIGNED'
                new_truck.save(update_fields=['op_status'])

            if schedule.truck_id == old_truck.id:
                schedule.truck = new_truck
                schedule.save(update_fields=['truck'])

            today = timezone.localdate()
            if old_truck.op_status == 'ASSIGNED':
                still_assigned = (
                    DriverShift.objects.filter(truck=old_truck, is_active=True).exists()
                    or ScheduleTruckAllocation.objects.filter(truck=old_truck, allocation_date__gte=today).exists()
                )
                if not still_assigned:
                    old_truck.op_status = 'AVAILABLE'
                    old_truck.save(update_fields=['op_status'])

            transferred_driver_ids = []
            if transfer_drivers:
                current_drivers = list(old_truck.drivers.all())
                existing_new_drivers = list(new_truck.drivers.all())
                existing_new_driver_ids = {d.id for d in existing_new_drivers}
                drivers_to_add = [d for d in current_drivers if d.id not in existing_new_driver_ids]
                if len(existing_new_drivers) + len(drivers_to_add) > 2:
                    raise TruckLifecycleConflictError(
                        f"Replacement truck {new_truck.plate_number} cannot accept {len(drivers_to_add)} transferred driver(s) (max 2 drivers).",
                        code='replacement_driver_capacity_exceeded',
                    )
                for drv in current_drivers:
                    old_truck.drivers.remove(drv)
                    if drv.id not in existing_new_driver_ids:
                        new_truck.drivers.add(drv)
                        transferred_driver_ids.append(drv.id)

            actor = user if (user and getattr(user, 'is_authenticated', False)) else None
            req_qs = TruckReplacementRequest.objects.select_for_update(of=('self',)).filter(status='PENDING')
            if replacement_request_id is not None:
                req_qs = req_qs.filter(pk=replacement_request_id)
            else:
                req_qs = req_qs.filter(schedule=schedule, truck=old_truck)
            locked_reqs = list(req_qs.order_by('id'))
            if replacement_request_id is not None and not locked_reqs:
                raise TruckLifecycleConflictError(
                    f"Replacement request #{replacement_request_id} is no longer PENDING.",
                    code='already_resolved',
                )
            resolved_at = timezone.now()
            for req_obj in locked_reqs:
                req_obj.status = 'APPROVED'
                req_obj.resolved_by = actor
                req_obj.resolved_at = resolved_at
                if reason_text:
                    req_obj.resolution_notes = reason_text
                req_obj.save(update_fields=['status', 'resolved_by', 'resolved_at', 'resolution_notes'])

            _record_truck_audit_log(
                actor=user,
                action_code='TRUCK_REPLACED',
                target_object_id=str(old_truck.id),
                details={
                    'old_truck_id': old_truck.id,
                    'old_plate_number': old_truck.plate_number,
                    'replacement_truck_id': new_truck.id,
                    'replacement_plate_number': new_truck.plate_number,
                    'schedule_id': schedule.id,
                    'schedule_area': schedule.area,
                    'effective_date': str(target_date),
                    'allocation_id': allocation.id,
                    'transferred_driver_ids': transferred_driver_ids,
                    'reason': reason_text,
                },
            )
            return {
                'old_truck': old_truck,
                'replacement_truck': new_truck,
                'allocation': allocation,
                'transferred_driver_ids': transferred_driver_ids,
            }

    @classmethod
    def request_truck_replacement(cls, truck, *, user=None, schedule_id=None, driver_shift=None, reason: str = ''):
        if not user or not getattr(user, 'is_authenticated', False):
            raise PermissionDenied("Authentication required.")
        role = getattr(user, 'role', None)
        if role not in ('driver', 'admin', 'dumpsite') and not is_admin_user(user):
            raise PermissionDenied("Only assigned Drivers, Operators, or Admins may request a truck replacement.")

        if (
            truck.is_retired
            or getattr(truck, 'retirement_state', TruckRetirementState.OPERATIONAL) != TruckRetirementState.OPERATIONAL
            or getattr(truck, 'commissioning_provenance', CommissioningProvenance.COMMISSIONED_VERIFIED) in (
                CommissioningProvenance.UNCOMMISSIONED,
                CommissioningProvenance.LEGACY_UNRECONCILED,
            )
        ):
            raise TruckLifecycleConflictError(
                f"Truck {truck.plate_number} is retired or uncommissioned and cannot be replaced via request.",
                code='truck_not_replaceable',
            )

        resolved_schedule_id = schedule_id
        if resolved_schedule_id is None and driver_shift is not None:
            resolved_schedule_id = driver_shift.schedule_id

        resolved_schedule = None
        if resolved_schedule_id is not None:
            try:
                resolved_schedule_id = int(resolved_schedule_id)
            except (TypeError, ValueError):
                raise ValidationError({'schedule_id': 'schedule_id must be a valid positive integer.'})
            if resolved_schedule_id <= 0:
                raise ValidationError({'schedule_id': 'schedule_id must be a positive integer.'})
            resolved_schedule = CollectionSchedule.objects.filter(pk=resolved_schedule_id).first()
            if not resolved_schedule:
                raise ValidationError({'schedule_id': f"Schedule #{resolved_schedule_id} not found."})

        if role == 'dumpsite' and not is_admin_user(user):
            cls.require_admin_or_facility_operator(user, truck=truck, schedule=resolved_schedule)

        if role == 'driver' and not is_admin_user(user):
            today = timezone.localdate()
            is_assigned = (
                truck.drivers.filter(pk=user.pk).exists()
                or DriverShift.objects.filter(truck=truck, driver=user, is_active=True).exists()
                or ScheduleTruckAllocation.objects.filter(
                    truck=truck,
                    allocation_date=today,
                    team__memberships__worker__user=user,
                    team__memberships__is_active=True,
                    team__memberships__role_in_team__in=('driver', 'leader'),
                ).exists()
            )
            if not is_assigned:
                raise PermissionDenied("You may only request replacement for a truck assigned to you.")
            if resolved_schedule is not None:
                has_schedule_auth = (
                    DriverShift.objects.filter(
                        driver=user, is_active=True, schedule=resolved_schedule
                    ).filter(Q(truck=truck) | Q(allocation__truck=truck)).exists()
                    or ScheduleTruckAllocation.objects.filter(
                        schedule=resolved_schedule,
                        truck=truck,
                        allocation_date=today,
                        team__memberships__worker__user=user,
                        team__memberships__is_active=True,
                        team__memberships__role_in_team__in=('driver', 'leader'),
                    ).exists()
                    or (resolved_schedule.driver_id == user.id and resolved_schedule.truck_id == truck.id)
                )
                if not has_schedule_auth:
                    raise PermissionDenied("You may only request replacement for a schedule assigned to you with this truck.")

        reason_text = (reason or '').strip()
        if not reason_text:
            raise ValidationError({'reason': 'Replacement request reason is required.'})

        req = TruckReplacementRequest.objects.create(
            driver_shift=driver_shift,
            schedule_id=resolved_schedule_id,
            truck=truck,
            requested_by=user,
            reason=reason_text,
            status='PENDING',
        )

        _record_truck_audit_log(
            actor=user,
            action_code='TRUCK_REPLACEMENT_REQUESTED',
            target_object_id=str(truck.id),
            details={
                'request_id': req.id,
                'plate_number': truck.plate_number,
                'schedule_id': resolved_schedule_id,
                'driver_shift_id': driver_shift.id if driver_shift else None,
                'requested_by': getattr(user, 'username', None),
                'reason': reason_text,
            },
        )
        return {
            'id': req.id,
            'status': req.status,
            'truck_id': truck.id,
            'plate_number': truck.plate_number,
            'schedule_id': resolved_schedule_id,
            'driver_shift_id': req.driver_shift_id,
            'reason': req.reason,
            'created_at': req.created_at.isoformat() if req.created_at else None,
        }
