@echo off
cd /d "%~dp0"
node scripts/serve.js
if errorlevel 1 pause
