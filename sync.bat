@echo off
rem SurCam dashboard: sync data and optionally push to GitHub
rem usage:  sync.bat         sync only
rem         sync.bat push    sync then git commit+push docs/data
cd /d "%~dp0"

echo [1/3] syncing SurCam data (read-only GET)...
node sync.js
if errorlevel 1 (
  echo.
  echo sync failed. if token expired, run ..\autosign\refresh_token.bat first.
  pause
  exit /b 1
)

if /i "%1"=="push" (
  echo [2/3] committing data...
  git add docs\data
  git diff --cached --quiet docs\data
  if errorlevel 1 (
    git commit -m "data: sync %date% %time%"
    echo [3/3] pushing...
    git push
  ) else (
    echo [2/3] no data change, skip commit
  )
) else (
  echo [2/3] push not requested, skip git
)
echo done.
