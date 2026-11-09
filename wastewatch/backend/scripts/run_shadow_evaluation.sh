#!/bin/bash
# ==============================================================================
# WasteWatch - CENRO Lucena City
# Daily Shadow Evaluation Pipeline Scheduled Task (Linux / Cron)
# Schedule: Run nightly at 23:30 (after dumpsite operations complete)
# Example crontab entry:
# 30 23 * * * /path/to/wastewatch/backend/scripts/run_shadow_evaluation.sh >> /var/log/wastewatch_shadow.log 2>&1
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${BACKEND_DIR}"

# Activate virtual environment if present
if [ -f "${BACKEND_DIR}/venv/bin/activate" ]; then
    # shellcheck disable=SC1091
    source "${BACKEND_DIR}/venv/bin/activate"
fi

echo "================================================================================"
echo "WasteWatch Shadow Evaluation Run: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================================"

# 1. Backfill actuals for prior shadow predictions that have cleared the 2-day grace period
echo "[Step 1/2] Backfilling genuine dumpsite actuals for past predictions..."
python manage.py record_shadow_forecast --backfill-actuals

# 2. Record forward predictions for today's origin date (Ridge candidate + Heuristic baseline)
echo "[Step 2/2] Recording forward shadow predictions for today..."
python manage.py record_shadow_forecast

echo "Shadow evaluation pipeline completed successfully."
