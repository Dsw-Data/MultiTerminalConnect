@echo off
title Multi Terminal Connect
cd /d "%~dp0"
call npm start >> launch.log 2>&1
