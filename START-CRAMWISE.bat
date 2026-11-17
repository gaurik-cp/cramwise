@echo off
title Cramwise
cd /d "%~dp0"
echo.
echo  ===== Cramwise =====
echo.

rem ---------- 0. Apply an update Claude sent (cramwise-update.zip in this folder or Downloads) ----------
if not exist "cramwise-update.zip" if exist "%USERPROFILE%\Downloads\cramwise-update.zip" move /y "%USERPROFILE%\Downloads\cramwise-update.zip" . >nul
if exist "cramwise-update.zip" (
  echo  Applying the new update...
  powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath 'cramwise-update.zip' -DestinationPath '.'"
  if errorlevel 1 ( echo  Could not unpack the update. Unzip cramwise-update.zip into this folder by hand. ) else ( del "cramwise-update.zip" & echo  Update applied. )
  echo.
)

rem ---------- 1. Node.js (runs the React app) ----------
set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"
where node >nul 2>nul
if %errorlevel%==0 goto havenode
echo  Node.js is not installed. Installing it now...
echo  (If Windows asks "Do you want to allow this app to make changes?", click YES)
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;C:\Program Files\nodejs"
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js install did not finish. Install it from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
:havenode

rem ---------- 2. Python (runs the Flask server: accounts, database, AI) ----------
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY python --version >nul 2>nul && set "PY=python"
if not defined PY (
  echo  Python is not installed. Installing it now...
  winget install -e --id Python.Python.3.12 --scope user --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts"
)
if not defined PY py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY python --version >nul 2>nul && set "PY=python"

if not defined PY (
  echo.
  echo  Python could not be installed, so the server will not start.
  echo  The app still works without an account. Install Python from https://python.org to get accounts and AI.
  echo.
  goto frontend
)

if not exist "server\.venv\Scripts\python.exe" (
  echo  Setting up the server for the first time...
  %PY% -m venv server\.venv
)
echo  Checking server packages...
"server\.venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r server\requirements.txt
if not exist "server\.env" copy "server\.env.example" "server\.env" >nul

echo  Starting the server in its own window (keep it open too)...
start "Cramwise server" /D "%~dp0server" cmd /k ".venv\Scripts\python.exe app.py"

:frontend
rem ---------- 3. The app itself ----------
echo  Checking app packages (quick if nothing changed)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo  npm install failed - copy the error above and send it to Claude.
  pause
  exit /b 1
)
echo.
echo  Starting Cramwise... your browser will open. Keep this window open while you use the app.
echo  (Close this window and the server window to stop everything.)
echo.
call npm run dev -- --open
echo.
echo  If it says "Port 5173 is already in use": an old Cramwise window is still open.
echo  Close ALL black Cramwise windows, then double-click START-CRAMWISE.bat again.
pause
