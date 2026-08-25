@echo off
setlocal
cd /d "%~dp0"
set "CUBELY_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "CUBELY_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%CUBELY_NODE%" if "%CUBELY_NODE%" neq "node" (
  echo Node.js 22 ou plus recent est requis pour demarrer Cubely.
  echo Installez Node.js depuis https://nodejs.org puis relancez ce fichier.
  pause
  exit /b 1
)
start "Cubely Server" /min "%CUBELY_NODE%" "%~dp0server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
endlocal
