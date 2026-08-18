@echo off
title CareDesk — Deploy to GitHub Pages
cd /d "%~dp0"

echo.
echo ================================================
echo   CareDesk — Deploy to GitHub Pages
echo ================================================
echo.

REM Check git is available
where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git not found. Make sure Git is installed.
  pause
  exit /b 1
)

REM Create a clean temp dir for the gh-pages branch
set TMPDIR=%TEMP%\caredesk-ghpages-%RANDOM%
if exist "%TMPDIR%" rmdir /s /q "%TMPDIR%"
mkdir "%TMPDIR%"

echo [1/4] Copying prototype...
copy "apps\web\public\caredesk_prototype.html" "%TMPDIR%\index.html" >nul
copy "apps\web\public\caredesk_prototype.html" "%TMPDIR%\caredesk_prototype.html" >nul

echo [2/4] Preparing git...
cd /d "%TMPDIR%"
git init -q
git checkout -q -b gh-pages
git add .
git commit -q -m "Deploy CareDesk prototype"

echo [3/4] Pushing to GitHub...
git remote add origin https://github.com/boaznachshony-jpg/care-platform.git
git push -f origin gh-pages

if errorlevel 1 (
  echo.
  echo ERROR: Push failed. You may need to log in to GitHub.
  echo Try running: git push -f origin gh-pages   from this folder: %TMPDIR%
  pause
  exit /b 1
)

echo [4/4] Done!
echo.
echo ================================================
echo   YOUR PROTOTYPE IS LIVE AT:
echo.
echo   https://boaznachshony-jpg.github.io/care-platform/
echo.
echo   (GitHub Pages takes 1-2 min to go live)
echo   Share this link with anyone — no server needed!
echo ================================================
echo.

REM Copy URL to clipboard
echo https://boaznachshony-jpg.github.io/care-platform/ | clip

echo URL copied to clipboard.
echo.

REM Cleanup
cd /d "%~dp0"
rmdir /s /q "%TMPDIR%" 2>nul

pause
