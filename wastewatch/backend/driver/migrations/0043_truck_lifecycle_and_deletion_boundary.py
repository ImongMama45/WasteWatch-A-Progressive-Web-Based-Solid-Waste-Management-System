from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
from django.db.models import Q


def backfill_legacy_truck_commissioning_state(apps, schema_editor):
    """
    Conservative legacy commissioning backfill (Zero Date Fabrication Policy):
    - Legacy trucks with any Category A historical record ->
        commissioning_provenance = 'commissioned_date_unknown'
        retirement_state = 'operational'
        commissioned_at = None
        is_retired = False
    - Legacy trucks with zero Category A historical records ->
        commissioning_provenance = 'legacy_unreconciled'
        retirement_state = 'legacy_reconciliation'
        commissioned_at = None
        is_retired = False
    Under NO circumstances is `commissioned_at` fabricated from `created_at`.
    """
    Truck = apps.get_model('driver', 'Truck')
    DriverShift = apps.get_model('driver', 'DriverShift')
    TruckLocation = apps.get_model('driver', 'TruckLocation')
    TruckCrewAssignment = apps.get_model('driver', 'TruckCrewAssignment')
    ScheduleTruckAllocation = apps.get_model('driver', 'ScheduleTruckAllocation')
    WasteDelivery = apps.get_model('dumpsite', 'WasteDelivery')
    TruckFillEstimate = apps.get_model('dumpsite', 'TruckFillEstimate')
    Escalation = apps.get_model('watcher', 'Escalation')
    HotspotIntervention = apps.get_model('watcher', 'HotspotIntervention')

    db_alias = schema_editor.connection.alias

    for truck in Truck.objects.using(db_alias).all().iterator():
        has_history = (
            DriverShift.objects.using(db_alias).filter(truck_id=truck.id).exists()
            or WasteDelivery.objects.using(db_alias).filter(truck_id=truck.id).exists()
            or TruckLocation.objects.using(db_alias).filter(truck_id=truck.id).exists()
            or TruckCrewAssignment.objects.using(db_alias).filter(truck_id=truck.id).exists()
            or TruckFillEstimate.objects.using(db_alias).filter(truck_id=truck.id, is_custom=True).exists()
            or Escalation.objects.using(db_alias).filter(truck_id=truck.id).exists()
            or HotspotIntervention.objects.using(db_alias).filter(truck_id=truck.id).exists()
            or ScheduleTruckAllocation.objects.using(db_alias).filter(truck_id=truck.id).exists()
        )
        if has_history:
            truck.commissioning_provenance = 'commissioned_date_unknown'
            truck.retirement_state = 'operational'
            truck.commissioned_at = None
            truck.is_retired = False
        else:
            # Remove auto-seeded non-custom fill estimates on unreconciled legacy trucks
            # so they only receive fill estimates if confirmed commissioned during reconciliation.
            TruckFillEstimate.objects.using(db_alias).filter(
                truck_id=truck.id,
                is_custom=False,
            ).delete()
            truck.commissioning_provenance = 'legacy_unreconciled'
            truck.retirement_state = 'legacy_reconciliation'
            truck.commissioned_at = None
            truck.is_retired = False

        truck.save(
            using=db_alias,
            update_fields=[
                'commissioning_provenance',
                'retirement_state',
                'commissioned_at',
                'is_retired',
            ],
        )


POSTGRES_TRUCK_DELETE_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION public.truck_delete_uncommissioned(target_truck_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_truck public.driver_truck%ROWTYPE;
    v_stage3_migrated BOOLEAN;
    v_stage4_migrated BOOLEAN;
    v_stage5_migrated BOOLEAN;
    v_table_exists BOOLEAN;
    v_records_exist BOOLEAN;
BEGIN
    -- 1. Acquire exclusive Fleet Tier row lock FOR UPDATE on target Truck
    SELECT * INTO v_truck FROM public.driver_truck WHERE id = target_truck_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Truck % not found', target_truck_id;
    END IF;

    -- 2. Validate objective uncommissioned state and provenance
    IF v_truck.retirement_state <> 'uncommissioned' OR
       v_truck.commissioning_provenance <> 'uncommissioned' OR
       v_truck.commissioned_at IS NOT NULL OR
       v_truck.is_retired IS TRUE THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: vehicle is not uncommissioned (provenance: %, state: %, commissioned_at: %, is_retired: %)',
            target_truck_id, v_truck.commissioning_provenance, v_truck.retirement_state, v_truck.commissioned_at, v_truck.is_retired;
    END IF;

    -- 3. Verify absence of Category A Historical Records (8 Existing Baseline Models)
    IF EXISTS (SELECT 1 FROM public.driver_drivershift WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: DriverShift historical records exist', target_truck_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.dumpsite_wastedelivery WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: WasteDelivery weighbridge records exist', target_truck_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.driver_trucklocation WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: TruckLocation GPS breadcrumbs exist', target_truck_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.driver_truckcrewassignment WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: TruckCrewAssignment historical records exist', target_truck_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.dumpsite_truckfillestimate WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: TruckFillEstimate calibration records exist', target_truck_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.watcher_escalation WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: Escalation civic records exist', target_truck_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.watcher_hotspotintervention WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: HotspotIntervention records exist', target_truck_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.schedule_truck_allocation WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: ScheduleTruckAllocation records exist', target_truck_id;
    END IF;

    -- 4. Stage-Aware Fail-Closed Checks for Planned Stage 3-5 Category A Tables
    BEGIN
        SELECT EXISTS (
            SELECT 1 FROM public.django_migrations
            WHERE app = 'driver' AND name = '0037_crew_shift_and_attendance'
        ) INTO v_stage3_migrated;
        SELECT EXISTS (
            SELECT 1 FROM public.django_migrations
            WHERE app = 'dumpsite' AND name = '0006_dumpsite_truck_inspection'
        ) INTO v_stage4_migrated;
        SELECT EXISTS (
            SELECT 1 FROM public.django_migrations
            WHERE app = 'driver' AND name = '0038_truck_hold_history'
        ) INTO v_stage5_migrated;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'CRITICAL: Failed to inspect public.django_migrations in truck_delete_uncommissioned. Failing closed: %', SQLERRM;
    END;

    -- 4A. Stage 3: driver_truckswaplog & driver_fuellog
    SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'driver_truckswaplog'
    ) INTO v_table_exists;
    IF v_stage3_migrated AND NOT v_table_exists THEN
        RAISE EXCEPTION 'CRITICAL INTEGRITY FAILURE: Migration 0037_crew_shift_and_attendance is applied but public.driver_truckswaplog is missing. Failing closed.';
    END IF;
    IF v_table_exists THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.driver_truckswaplog WHERE previous_truck_id = $1 OR replacement_truck_id = $1)'
        INTO v_records_exist USING target_truck_id;
        IF v_records_exist THEN
            RAISE EXCEPTION 'Cannot physically delete Truck %: TruckSwapLog records exist', target_truck_id;
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'driver_fuellog'
    ) INTO v_table_exists;
    IF v_stage3_migrated AND NOT v_table_exists THEN
        RAISE EXCEPTION 'CRITICAL INTEGRITY FAILURE: Migration 0037_crew_shift_and_attendance is applied but public.driver_fuellog is missing. Failing closed.';
    END IF;
    IF v_table_exists THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.driver_fuellog WHERE truck_id = $1)'
        INTO v_records_exist USING target_truck_id;
        IF v_records_exist THEN
            RAISE EXCEPTION 'Cannot physically delete Truck %: FuelLog records exist', target_truck_id;
        END IF;
    END IF;

    -- 4B. Stage 4: dumpsite_dumpsitetruckinspection
    SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'dumpsite_dumpsitetruckinspection'
    ) INTO v_table_exists;
    IF v_stage4_migrated AND NOT v_table_exists THEN
        RAISE EXCEPTION 'CRITICAL INTEGRITY FAILURE: Migration 0006_dumpsite_truck_inspection is applied but public.dumpsite_dumpsitetruckinspection is missing. Failing closed.';
    END IF;
    IF v_table_exists THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.dumpsite_dumpsitetruckinspection WHERE truck_id = $1)'
        INTO v_records_exist USING target_truck_id;
        IF v_records_exist THEN
            RAISE EXCEPTION 'Cannot physically delete Truck %: DumpsiteTruckInspection records exist', target_truck_id;
        END IF;
    END IF;

    -- 4C. Stage 5: driver_truckoperationalholdlog
    SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'driver_truckoperationalholdlog'
    ) INTO v_table_exists;
    IF v_stage5_migrated AND NOT v_table_exists THEN
        RAISE EXCEPTION 'CRITICAL INTEGRITY FAILURE: Migration 0038_truck_hold_history is applied but public.driver_truckoperationalholdlog is missing. Failing closed.';
    END IF;
    IF v_table_exists THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.driver_truckoperationalholdlog WHERE truck_id = $1)'
        INTO v_records_exist USING target_truck_id;
        IF v_records_exist THEN
            RAISE EXCEPTION 'Cannot physically delete Truck %: TruckOperationalHoldLog defect records exist', target_truck_id;
        END IF;
    END IF;

    -- 5. Verify absence of Category B Live Operational References
    IF EXISTS (SELECT 1 FROM public.driver_collectionschedule WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: CollectionSchedule operational references exist. Detach first.', target_truck_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.watcher_garbagehotspot WHERE assigned_truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: GarbageHotspot assignments exist. Detach first.', target_truck_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.driver_truck_drivers WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: driver assignments exist in driver_truck_drivers. Detach first.', target_truck_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.driver_truck_crew WHERE truck_id = target_truck_id) THEN
        RAISE EXCEPTION 'Cannot physically delete Truck %: crew assignments exist in driver_truck_crew. Detach first.', target_truck_id;
    END IF;

    -- 6. Authoritative Database Deletion
    DELETE FROM public.driver_truck WHERE id = target_truck_id;
END;
$$;

REVOKE ALL ON FUNCTION public.truck_delete_uncommissioned(BIGINT) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'wastewatch_migrator') THEN
        ALTER FUNCTION public.truck_delete_uncommissioned(BIGINT) OWNER TO wastewatch_migrator;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'wastewatch_app') THEN
        REVOKE DELETE ON TABLE public.driver_truck FROM wastewatch_app;
        GRANT EXECUTE ON FUNCTION public.truck_delete_uncommissioned(BIGINT) TO wastewatch_app;
    END IF;
END
$$;
"""

POSTGRES_DROP_TRUCK_DELETE_FUNCTION_SQL = """
DROP FUNCTION IF EXISTS public.truck_delete_uncommissioned(BIGINT);
"""


def deploy_postgres_truck_deletion_boundary(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute(POSTGRES_TRUCK_DELETE_FUNCTION_SQL, params=None)


def remove_postgres_truck_deletion_boundary(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute(POSTGRES_DROP_TRUCK_DELETE_FUNCTION_SQL, params=None)


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('dumpsite', '0005_wastedelivery_is_synthetic'),
        ('watcher', '0029_alter_collectionconfirmation_confirmed_by'),
        ('driver', '0042_alter_crewattendancecorrection_options_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='truck',
            name='commissioned_at',
            field=models.DateTimeField(
                blank=True,
                db_index=True,
                help_text='Timestamp when vehicle was formally commissioned into active municipal fleet service. NULL if uncommissioned or date unknown.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='truck',
            name='commissioning_provenance',
            field=models.CharField(
                choices=[
                    ('uncommissioned', 'Uncommissioned'),
                    ('commissioned_verified', 'Commissioned (Date Verified)'),
                    ('commissioned_date_unknown', 'Commissioned (Date Unknown)'),
                    ('legacy_unreconciled', 'Legacy (Status Unreconciled)'),
                ],
                db_index=True,
                default='uncommissioned',
                help_text='Authoritative provenance and evidence classification of vehicle commissioning.',
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name='truck',
            name='hold_dumpsite',
            field=models.ForeignKey(
                blank=True,
                help_text='Authoritative Dumpsite facility that placed the operational hold',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='held_trucks',
                to='dumpsite.dumpsite',
            ),
        ),
        migrations.AddField(
            model_name='truck',
            name='hold_placed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='truck',
            name='hold_placed_by',
            field=models.ForeignKey(
                blank=True,
                help_text='Actor who placed the truck on hold',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='truck',
            name='hold_reason',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='truck',
            name='is_operational_hold',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='truck',
            name='is_retired',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='truck',
            name='last_inspected_dumpsite',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='inspected_trucks',
                to='dumpsite.dumpsite',
            ),
        ),
        migrations.AddField(
            model_name='truck',
            name='maintenance_status',
            field=models.CharField(
                choices=[
                    ('available', 'Available'),
                    ('scheduled_maintenance', 'Scheduled Maintenance'),
                    ('under_repair', 'Under Repair'),
                ],
                default='available',
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name='truck',
            name='mechanical_status',
            field=models.CharField(
                choices=[
                    ('serviceable', 'Serviceable'),
                    ('needs_inspection', 'Needs Inspection'),
                    ('disabled', 'Disabled'),
                ],
                default='serviceable',
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name='truck',
            name='retirement_state',
            field=models.CharField(
                choices=[
                    ('uncommissioned', 'Uncommissioned'),
                    ('operational', 'Operational'),
                    ('legacy_reconciliation', 'Legacy Reconciliation'),
                    ('retirement_in_progress', 'Retirement In Progress'),
                    ('permanently_retired', 'Permanently Retired'),
                ],
                db_index=True,
                default='uncommissioned',
                help_text='Explicit workflow lifecycle state for vehicle commissioning and retirement.',
                max_length=30,
            ),
        ),
        migrations.AlterField(
            model_name='drivershift',
            name='end_reason',
            field=models.CharField(
                blank=True,
                default='',
                help_text='completed | driver_ended | admin_override | admin_force_ended | truck_retired | heartbeat_timeout | truck_deleted (legacy)',
                max_length=20,
            ),
        ),
        migrations.RunPython(
            backfill_legacy_truck_commissioning_state,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name='truck',
            constraint=models.CheckConstraint(
                check=Q(
                    commissioning_provenance__in=[
                        'uncommissioned',
                        'commissioned_verified',
                        'commissioned_date_unknown',
                        'legacy_unreconciled',
                    ]
                ),
                name='chk_truck_provenance_valid_values',
            ),
        ),
        migrations.AddConstraint(
            model_name='truck',
            constraint=models.CheckConstraint(
                check=Q(
                    retirement_state__in=[
                        'uncommissioned',
                        'operational',
                        'legacy_reconciliation',
                        'retirement_in_progress',
                        'permanently_retired',
                    ]
                ),
                name='chk_truck_retirement_state_valid_values',
            ),
        ),
        migrations.AddConstraint(
            model_name='truck',
            constraint=models.CheckConstraint(
                check=(
                    ~Q(retirement_state='uncommissioned')
                    | (
                        Q(commissioning_provenance='uncommissioned')
                        & Q(commissioned_at__isnull=True)
                        & Q(is_retired=False)
                    )
                ),
                name='chk_truck_uncommissioned_state_integrity',
            ),
        ),
        migrations.AddConstraint(
            model_name='truck',
            constraint=models.CheckConstraint(
                check=(
                    ~Q(commissioning_provenance='uncommissioned')
                    | (
                        Q(retirement_state='uncommissioned')
                        & Q(commissioned_at__isnull=True)
                        & Q(is_retired=False)
                    )
                ),
                name='chk_truck_uncommissioned_provenance_integrity',
            ),
        ),
        migrations.AddConstraint(
            model_name='truck',
            constraint=models.CheckConstraint(
                check=(
                    ~Q(commissioning_provenance='commissioned_verified')
                    | (
                        Q(commissioned_at__isnull=False)
                        & Q(
                            retirement_state__in=[
                                'operational',
                                'retirement_in_progress',
                                'permanently_retired',
                            ]
                        )
                    )
                ),
                name='chk_truck_verified_requires_timestamp',
            ),
        ),
        migrations.AddConstraint(
            model_name='truck',
            constraint=models.CheckConstraint(
                check=(
                    ~Q(commissioning_provenance='commissioned_date_unknown')
                    | (
                        Q(commissioned_at__isnull=True)
                        & Q(
                            retirement_state__in=[
                                'operational',
                                'retirement_in_progress',
                                'permanently_retired',
                            ]
                        )
                    )
                ),
                name='chk_truck_date_unknown_requires_null_timestamp',
            ),
        ),
        migrations.AddConstraint(
            model_name='truck',
            constraint=models.CheckConstraint(
                check=(
                    ~Q(commissioning_provenance='legacy_unreconciled')
                    | (
                        Q(commissioned_at__isnull=True)
                        & Q(retirement_state='legacy_reconciliation')
                        & Q(is_retired=False)
                    )
                ),
                name='chk_truck_legacy_unreconciled_state',
            ),
        ),
        migrations.AddConstraint(
            model_name='truck',
            constraint=models.CheckConstraint(
                check=(
                    ~Q(retirement_state='legacy_reconciliation')
                    | (
                        Q(commissioning_provenance='legacy_unreconciled')
                        & Q(commissioned_at__isnull=True)
                        & Q(is_retired=False)
                    )
                ),
                name='chk_truck_legacy_reconciliation_provenance',
            ),
        ),
        migrations.AddConstraint(
            model_name='truck',
            constraint=models.CheckConstraint(
                check=~Q(retirement_state='operational') | Q(is_retired=False),
                name='chk_truck_operational_not_retired',
            ),
        ),
        migrations.AddConstraint(
            model_name='truck',
            constraint=models.CheckConstraint(
                check=(
                    (
                        Q(is_retired=False)
                        & ~Q(retirement_state__in=['retirement_in_progress', 'permanently_retired'])
                    )
                    | (
                        Q(is_retired=True)
                        & Q(retirement_state__in=['retirement_in_progress', 'permanently_retired'])
                    )
                ),
                name='chk_truck_retirement_flag_consistency',
            ),
        ),
        migrations.RunPython(
            deploy_postgres_truck_deletion_boundary,
            reverse_code=remove_postgres_truck_deletion_boundary,
        ),
    ]
