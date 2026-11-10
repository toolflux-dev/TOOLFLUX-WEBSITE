@echo off
rem Drawing to STEP desk: started hidden at login by "Drawing to STEP desk.vbs" (Startup folder).
rem Keeps the desk alive: each start refreshes _app to the code live on toolflux.co.in (origin/main),
rem and the desk is restarted 30 s after it stops. Exit code 3 = a desk is already running: stop here.
title Drawing to STEP desk
cd /d "%~dp0_app"
set DTS_NO_BROWSER=1
:loop
git fetch -q origin 2>nul && git checkout -q --detach origin/main 2>nul
echo %date% %time% starting desk >> "%~dp0desk-autostart.log"
node dts-desk.js >> "%~dp0desk-autostart.log" 2>&1
if %errorlevel%==3 (
  echo %date% %time% another desk is already running, this copy stops >> "%~dp0desk-autostart.log"
  goto :eof
)
echo %date% %time% desk stopped, restarting in 30 s >> "%~dp0desk-autostart.log"
timeout /t 30 /nobreak >nul
goto loop
