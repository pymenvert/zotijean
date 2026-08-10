@echo off
chcp 65001 >nul
title Zotijean
cd /d "%~dp0"

echo.
echo   Zotijean
echo   ----------------------------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js est introuvable.
  echo.
  echo   Zotijean en a besoin pour fonctionner. Telechargez la version LTS
  echo   sur nodejs.org, installez-la, puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -p "process.versions.node.split('.')[0]"') do set MAJEURE=%%v
if %MAJEURE% LSS 20 (
  echo   Votre version de Node.js est trop ancienne : il faut au moins la 20.
  echo   Mettez-la a jour depuis nodejs.org, puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do echo   Node.js %%v
echo   Demarrage...
echo.
echo   Laissez cette fenetre ouverte tant que vous utilisez Zotijean.
echo   Pour arreter : fermez la fenetre, ou appuyez sur Ctrl+C.
echo.

node server.js

echo.
echo   Zotijean est arrete.
pause
