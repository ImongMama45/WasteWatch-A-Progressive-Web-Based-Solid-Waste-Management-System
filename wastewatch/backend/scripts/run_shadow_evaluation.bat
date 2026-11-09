@echo off
REM ==============================================================================
REM WasteWatch - CENRO Lucena City
REM Daily Shadow Evaluation Pipeline Scheduled Task (Windows Task Scheduler)
REM Schedule: Run nightly at 23:30 (after dumpsite operations complete)
REM Example Task Scheduler action:
REM Program: D:\Coding\Waste Watch\wastewatch\backend\scripts\run_shadow_evaluation.bat
REM ==============================================================================

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%.."
cd /d "%BACKEND_DIR%"

if exist "%BACKEND_DIR%\venv\Scripts\activate.bat" (
    call "%BACKEND_DIR%\venv\Scripts\activate.bat"
)

echo ================================================================================
echo WasteWatch Shadow Evaluation Run: %DATE% %TIME%
echo ================================================================================

echo [Step 1/2] Backfilling genuine dumpsite actuals for past predictions...
python manage.py record_shadow_forecast --backfill-actuals
if %ERRORLEVEL% NEQ 0 (
    echo Error during actuals backfill.
    exit /b %ERRORLEVEL%
)

echo [Step 2/2] Recording forward shadow predictions for today...
python manage.py record_shadow_forecast
if %ERRORLEVEL% NEQ 0 (
    echo Error during forward prediction recording.
    exit /b %ERRORLEVEL%
)

echo Shadow evaluation pipeline completed successfully.
exit /b 0
