@echo off
REM ============================================================================
REM  Matriz MDP - Detener la base de datos portatil
REM  (El servidor se detiene cerrando su ventana o con Ctrl+C.)
REM ============================================================================
chcp 65001 >nul
cd /d "%~dp0"
set "MBIN=%~dp0mariadb\bin"
set "MADMIN=%MBIN%\mariadb-admin.exe"
if not exist "%MADMIN%" set "MADMIN=%MBIN%\mysqladmin.exe"

echo Apagando la base de datos...
"%MADMIN%" -u root --port=3307 --protocol=tcp shutdown >nul 2>&1
if errorlevel 1 (
  echo No respondio por red; forzando cierre del proceso...
  taskkill /FI "WINDOWTITLE eq MariaDB-MDP*" /T /F >nul 2>&1
  taskkill /IM mariadbd.exe /F >nul 2>&1
  taskkill /IM mysqld.exe /F >nul 2>&1
)
echo Listo. La base esta detenida.
timeout /t 2 >nul
