@echo off
rem Scheduled-task variant: sync + push, no interaction, log to sync.log
cd /d "%~dp0"
set LOG=%~dp0sync.log
echo ===== %date% %time% ===== >> "%LOG%"

node sync.js >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] sync failed, token may be expired, run autosign\refresh_token.bat >> "%LOG%"
  exit /b 1
)

git add docs\data >> "%LOG%" 2>&1
git diff --cached --quiet docs\data
if errorlevel 1 (
  git commit -m "data: auto sync %date%" >> "%LOG%" 2>&1
  git push >> "%LOG%" 2>&1
  echo [OK] pushed new data >> "%LOG%"
) else (
  echo [OK] no data change >> "%LOG%"
)
exit /b 0
