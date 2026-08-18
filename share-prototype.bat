@echo off
title CareDesk — Public Share Link
cd /d "%~dp0"

echo.
echo ================================================
echo   CareDesk Prototype — Public Sharing
echo ================================================

REM Check / start dev server
curl -s -o nul http://localhost:5174/caredesk_prototype.html >nul 2>&1
if errorlevel 1 (
  echo [!] Starting dev server...
  start "CareDesk Dev Server" cmd /c "pnpm dev"
  timeout /t 7 /nobreak >nul
)

echo.
echo Opening public tunnel... (takes ~10 seconds)
echo.

REM Use PowerShell to run localtunnel, extract URL, append path, and copy to clipboard
powershell -NoProfile -Command ^
  "npx --yes localtunnel --port 5174 2>&1 | ForEach-Object { $_ | Out-Host; if ($_ -match 'url is:\s*(.+)') { $url = $Matches[1].Trim() + '/caredesk_prototype.html'; Write-Host ''; Write-Host '================================================' -ForegroundColor Cyan; Write-Host '  SHARE THIS LINK WITH TESTERS:' -ForegroundColor Cyan; Write-Host "  $url" -ForegroundColor Yellow; Write-Host '  (copied to clipboard)' -ForegroundColor Cyan; Write-Host '================================================'; Set-Clipboard $url } }"

pause
