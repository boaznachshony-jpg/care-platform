@echo off
title CareDesk Israel — Dev Server
cd /d "%~dp0"

echo.
echo ========================================
echo   CareDesk Israel — Starting dev server
echo ========================================
echo.

echo [1/3] Checking pnpm...
where pnpm >nul 2>&1
if errorlevel 1 (
  echo ERROR: pnpm not found. Install via: npm install -g pnpm
  pause
  exit /b 1
)

echo [2/3] Getting your network IP...
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "169.254"') do (
  set IP=%%a
)
set IP=%IP: =%

echo.
echo ========================================
echo   App URLs:
echo   Local:   http://localhost:5173
echo   Network: http://%IP%:5173
echo   Mobile:  http://%IP%:5173/caredesk_prototype.html
echo ========================================
echo.
echo Press Ctrl+C to stop the server.
echo.

echo [3/3] Starting Vite...
pnpm dev

pause
