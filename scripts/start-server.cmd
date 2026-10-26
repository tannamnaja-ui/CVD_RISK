@echo off
rem CV Risk Calculator - production server on http://localhost:4009 (started at Windows login by install-autostart.ps1)
rem Rebuilds the web app first so the latest code is always served. Output goes to logs\server.log.
cd /d "%~dp0.."
if not exist logs mkdir logs
echo ==== %date% %time% start ==== >> logs\server.log
call node_modules\.bin\vite.cmd build >> logs\server.log 2>&1
node_modules\.bin\tsx.cmd server\index.ts --serve-static --port 4009 >> logs\server.log 2>&1
