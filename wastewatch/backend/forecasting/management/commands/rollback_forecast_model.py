"""
forecasting/management/commands/rollback_forecast_model.py
----------------------------------------------------------
Atomically restores previous production model artifact and metadata pair.
Validates SHA-256 integrity before switching manifest and files (Audit N-09).
Ensures multi-worker atomic rollback via active_manifest.json pointer.
"""

import os
import json
import shutil
import hashlib
from typing import Optional

from django.core.management.base import BaseCommand, CommandError
from django.conf import settings
from django.utils import timezone


class Command(BaseCommand):
    help = "Safely rolls back production forecasting model artifact with pre-deserialization integrity validation."

    def add_arguments(self, parser):
        parser.add_argument(
            '--artifacts-dir',
            type=str,
            default=None,
            help="Path to artifacts directory (defaults to forecasting/artifacts)"
        )
        parser.add_argument(
            '--target-version',
            type=str,
            default=None,
            help="Specific model version string to restore (default: previous backup)"
        )

    def handle(self, *args, **options):
        artifacts_dir = options.get('artifacts_dir') or getattr(
            settings,
            'FORECASTING_ARTIFACTS_DIR',
            os.path.join(settings.BASE_DIR, 'forecasting', 'artifacts')
        )
        target_version = options.get('target_version')

        if target_version:
            source_model = os.path.join(artifacts_dir, f"waste_forecast_model_{target_version}.joblib")
            source_meta = os.path.join(artifacts_dir, f"waste_forecast_metadata_{target_version}.json")
            target_label = target_version
        else:
            source_model = os.path.join(artifacts_dir, 'waste_forecast_model_prev.joblib')
            source_meta = os.path.join(artifacts_dir, 'waste_forecast_metadata_prev.json')
            target_label = 'previous backup'

        if not os.path.exists(source_model):
            raise CommandError(f"Target model artifact not found at {source_model}")
        if not os.path.exists(source_meta):
            raise CommandError(f"Target metadata file not found at {source_meta}")

        self.stdout.write(f"Verifying integrity of rollback target ({target_label})...")

        # 1. Pre-deserialization integrity & comprehensive governance verification via shared validator
        with open(source_meta, 'r', encoding='utf-8') as f:
            try:
                meta = json.load(f)
            except Exception as e:
                raise CommandError(f"Malformed metadata JSON in {source_meta}: {e}")

        with open(source_model, 'rb') as f:
            model_bytes = f.read()

        from forecasting.service import validate_forecaster_artifact
        try:
            forecaster, meta = validate_forecaster_artifact(
                model_bytes=model_bytes,
                metadata=meta,
                require_validation_passed=True,
                target_label=target_label
            )
        except ValueError as val_err:
            raise CommandError(f"Rollback aborted: {val_err}")

        actual_sha256 = hashlib.sha256(model_bytes).hexdigest()
        self.stdout.write(self.style.SUCCESS(f"Integrity and governance verified (SHA-256: {actual_sha256[:12]}...)."))

        # 2. Atomic manifest update (N-09)
        model_basename = os.path.basename(source_model)
        meta_basename = os.path.basename(source_meta)
        manifest_data = {
            'active_model_file': model_basename,
            'active_metadata_file': meta_basename,
            'model_version': meta.get('model_version', target_label),
            'rolled_back_at': timezone.now().isoformat(),
            'sha256': actual_sha256,
        }

        manifest_tmp = os.path.join(artifacts_dir, '.tmp_active_manifest.json')
        manifest_path = os.path.join(artifacts_dir, 'active_manifest.json')
        with open(manifest_tmp, 'w', encoding='utf-8') as f:
            json.dump(manifest_data, f, indent=2)
        os.replace(manifest_tmp, manifest_path)

        # 3. Synchronize latest files for backwards compatibility
        latest_model = os.path.join(artifacts_dir, 'waste_forecast_model_latest.joblib')
        latest_meta = os.path.join(artifacts_dir, 'waste_forecast_metadata_latest.json')
        temp_model = os.path.join(artifacts_dir, '.tmp_latest_rollback.joblib')
        temp_meta = os.path.join(artifacts_dir, '.tmp_latest_rollback.json')

        shutil.copy2(source_model, temp_model)
        shutil.copy2(source_meta, temp_meta)
        os.replace(temp_model, latest_model)
        os.replace(temp_meta, latest_meta)

        self.stdout.write(self.style.SUCCESS(
            f"Rollback completed successfully. Manifest and latest files atomically updated to {meta.get('model_version')}."
        ))
