@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Rekindle.ps1"
if errorlevel 1 goto failed
exit /b 0
:missing
echo Please install Node.js 24 or later, then run this file again.
pause
exit /b 1
:failed
echo Setup did not finish. The error above describes what failed.
pause
exit /b 1
