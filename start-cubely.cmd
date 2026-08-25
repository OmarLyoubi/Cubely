@echo off
setlocal
cd /d "%~dp0"
set "CUBELY_URL=http://127.0.0.1:3000"
set "CUBELY_NODE="
set "CUBELY_NO_BROWSER="
if /I "%~1"=="--no-browser" set "CUBELY_NO_BROWSER=1"

for /f "delims=" %%I in ('where node 2^>nul') do if not defined CUBELY_NODE set "CUBELY_NODE=%%I"
if not defined CUBELY_NODE set "CUBELY_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%CUBELY_NODE%" (
  echo Node.js 22 ou plus recent est requis pour demarrer Cubely.
  echo Installez Node.js depuis https://nodejs.org puis relancez ce fichier.
  pause
  exit /b 1
)

call :is_ready
if not errorlevel 1 goto :open_site

echo Demarrage de Cubely...
start "Cubely Server" /min "%CUBELY_NODE%" "%~dp0server.js"

for /L %%I in (1,1,20) do (
  powershell -NoProfile -Command "Start-Sleep -Seconds 1"
  call :is_ready
  if not errorlevel 1 goto :open_site
)

echo.
echo Cubely n'a pas pu demarrer sur %CUBELY_URL%.
echo Fermez tout ancien serveur utilisant le port 3000 puis reessayez.
pause
exit /b 1

:is_ready
powershell -NoProfile -Command "try {$r=Invoke-RestMethod -TimeoutSec 1 '%CUBELY_URL%/api/health'; if($r.ok -eq $true -and $r.app -eq 'cubely'){exit 0}} catch {}; exit 1" >nul 2>nul
exit /b %errorlevel%

:open_site
if not defined CUBELY_NO_BROWSER start "" "%CUBELY_URL%"
echo Cubely est disponible sur %CUBELY_URL%
endlocal
exit /b 0
