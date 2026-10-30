@echo off
cd /d "%~dp0"
py -3 servidor.py
if errorlevel 1 python servidor.py
pause
