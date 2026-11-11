@echo off
rem Yijian xiangqi: starts the game server for this PC and for the iPad on the home network.
rem Keep this window open while playing. Close it (or press Ctrl+C) to stop.
cd /d "%~dp0"
call npm start -- --host 0.0.0.0
if errorlevel 1 pause
