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
                require_promotion_eligible=True,
                target_label=target_label
            )
        except ValueError as val_err:
            raise CommandError(f"Rollback aborted: {val_err}")

        actual_sha256 = hashlib.sha256(model_bytes).hexdigest()
        self.stdout.write(self.style.SUCCESS(f"Integrity and governance verified (SHA-256: {actual_sha256[:12]}...)."))

        # 2. Safety backups of ALL mutable active state on the same filesystem:
        #    active_manifest.json AND the 'latest' model/metadata files. The latest
        #    files are overwritten before the manifest commit point, so restoring the
        #    manifest alone would leave a manifest that points at replaced bytes.
        manifest_path = os.path.join(artifacts_dir, 'active_manifest.json')
        manifest_bak_path = os.path.join(artifacts_dir, '.active_manifest.json.bak')
        latest_model = os.path.join(artifacts_dir, 'waste_forecast_model_latest.joblib')
        latest_meta = os.path.join(artifacts_dir, 'waste_forecast_metadata_latest.json')
        latest_model_bak = os.path.join(artifacts_dir, '.waste_forecast_model_latest.joblib.bak')
        latest_meta_bak = os.path.join(artifacts_dir, '.waste_forecast_metadata_latest.json.bak')

        # (live_path, backup_path) pairs that existed before the transaction began
        backups = []
        try:
            for live, bak in (
                (manifest_path, manifest_bak_path),
                (latest_model, latest_model_bak),
                (latest_meta, latest_meta_bak),
            ):
                if os.path.exists(live):
                    shutil.copy2(live, bak)
                    backups.append((live, bak))
        except Exception as e:
            for _, bak in backups:
                if os.path.exists(bak):
                    os.remove(bak)
            raise CommandError(f"Failed to create safety backups of active state: {e}")
        backed_up_live = {live for live, _ in backups}

        # 3. Stage required files on the same filesystem before modifying active state
        pid = os.getpid()
        tmp_stage_model = os.path.join(artifacts_dir, f".staging_{pid}_latest.joblib")
        tmp_stage_meta = os.path.join(artifacts_dir, f".staging_{pid}_latest.json")
        tmp_stage_manifest = os.path.join(artifacts_dir, f".staging_{pid}_manifest.json")

        model_basename = os.path.basename(source_model)
        meta_basename = os.path.basename(source_meta)

        try:
            # Stage model and metadata
            shutil.copy2(source_model, tmp_stage_model)
            shutil.copy2(source_meta, tmp_stage_meta)

            # Verify staged files and re-check hash
            with open(tmp_stage_model, 'rb') as f:
                staged_sha = hashlib.sha256(f.read()).hexdigest()
            if staged_sha != actual_sha256:
                raise CommandError("Staged model hash mismatch with verified target.")

            # Prepare new manifest data with consistent canonical keys
            manifest_data = {
                'active_model_file': model_basename,
                'active_metadata_file': meta_basename,
                'model_version': meta.get('model_version', target_label),
                'rolled_back_at': timezone.now().isoformat(),
                'sha256': actual_sha256,
                'distinct_genuine_days': meta.get('distinct_genuine_days'),
                'synthetic_records': 0,
            }
            with open(tmp_stage_manifest, 'w', encoding='utf-8') as f:
                json.dump(manifest_data, f, indent=2)

            # 4. Synchronize latest files atomically
            os.replace(tmp_stage_model, latest_model)
            os.replace(tmp_stage_meta, latest_meta)

            # 5. Commit point - atomically replace active_manifest.json
            os.replace(tmp_stage_manifest, manifest_path)

            # 6. Post-write verification of active manifest
            self._verify_committed_state(manifest_path, model_basename, actual_sha256)

        except Exception as exc:
            # Automatic recovery: restore every piece of pre-transaction active state.
            self.stderr.write(self.style.ERROR(f"Rollback error encountered: {exc}. Initiating recovery..."))
            recovery_errors = []
            for live, bak in backups:
                try:
                    os.replace(bak, live)
                except Exception as rec_err:
                    recovery_errors.append(f"{os.path.basename(live)}: {rec_err}")
            # Files that did not exist before the transaction must not exist after it.
            for live in (manifest_path, latest_model, latest_meta):
                if live not in backed_up_live and os.path.exists(live):
                    try:
                        os.remove(live)
                    except Exception as rec_err:
                        recovery_errors.append(f"{os.path.basename(live)}: {rec_err}")
            for tmp_f in (tmp_stage_model, tmp_stage_meta, tmp_stage_manifest):
                if os.path.exists(tmp_f):
                    try:
                        os.remove(tmp_f)
                    except Exception:
                        pass
            if recovery_errors:
                raise CommandError(
                    f"Rollback aborted; RECOVERY INCOMPLETE ({'; '.join(recovery_errors)}). "
                    f"Backups retained in {artifacts_dir}. Original error: {exc}"
                )
            self.stderr.write("Active manifest and latest artifacts restored to previous working state.")
            raise CommandError(f"Rollback aborted and recovered: {exc}")

        # Success: discard safety backups
        for _, bak in backups:
            if os.path.exists(bak):
                try:
                    os.remove(bak)
                except Exception:
                    pass

        self.stdout.write(self.style.SUCCESS(
            f"Rollback completed successfully. Manifest and latest files atomically updated to {meta.get('model_version')}."
        ))

    @staticmethod
    def _verify_committed_state(manifest_path, model_basename, expected_sha):
        """Post-commit verification. Raises on any mismatch, triggering recovery."""
        with open(manifest_path, 'r', encoding='utf-8') as mf:
            verified_manifest = json.load(mf)
        if (
            verified_manifest.get('active_model_file') != model_basename
            or verified_manifest.get('sha256') != expected_sha
        ):
            raise ValueError("Post-rollback manifest verification failed: manifest does not match target.")
