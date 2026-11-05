@echo off
rem Drawing to STEP desk: runs at Windows login (Startup folder), keeps the desk alive.
rem Each start refreshes _app to the code that is live on toolflux.co.in (origin/main).
title Drawing to STEP desk
cd /d "%~dp0_app"
set DTS_NO_BROWSER=1
:loop
git fetch -q origin 2>nul && git checkout -q --detach origin/main 2>nul
echo %date% %time% starting desk >> "%~dp0desk-autostart.log"
node dts-desk.js >> "%~dp0desk-autostart.log" 2>&1
echo %date% %time% desk stopped, restarting in 30 s >> "%~dp0desk-autostart.log"
timeout /t 30 /nobreak >nul
goto loop
