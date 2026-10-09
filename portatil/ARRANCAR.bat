@echo off
REM ============================================================================
REM  Matriz MDP - Arranque portatil (Windows)
REM
REM  Levanta la base de datos (MariaDB portatil) y el servidor (Node portatil)
REM  SIN instalar nada en la PC. La primera vez crea la base, las tablas y te
REM  pide los datos del primer usuario administrador.
REM
REM  Antes de usarlo, dentro de esta carpeta "portatil" tienen que estar:
REM     node\node.exe                  (Node portatil descomprimido)
REM     mariadb\bin\mariadbd.exe       (MariaDB portatil descomprimido)
REM  Ver LEEME-PRIMERO.txt para los enlaces de descarga.
REM ============================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

set "NODE=%~dp0node\node.exe"
set "MBIN=%~dp0mariadb\bin"
set "DATADIR=%~dp0datos"
set "DBPORT=3307"
set "APPDIR=%~dp0.."

REM --- Comprobaciones basicas --------------------------------------------------
if not exist "%NODE%" (
  echo [X] No encuentro Node en:  portatil\node\node.exe
  echo     Descargalo y descomprimilo. Ver LEEME-PRIMERO.txt
  pause & exit /b 1
)
set "MYSQLD=%MBIN%\mariadbd.exe"
if not exist "%MYSQLD%" set "MYSQLD=%MBIN%\mysqld.exe"
set "MCLI=%MBIN%\mariadb.exe"
if not exist "%MCLI%" set "MCLI=%MBIN%\mysql.exe"
set "MADMIN=%MBIN%\mariadb-admin.exe"
if not exist "%MADMIN%" set "MADMIN=%MBIN%\mysqladmin.exe"
set "MINSTALL=%MBIN%\mariadb-install-db.exe"
if not exist "%MINSTALL%" set "MINSTALL=%MBIN%\mysql_install_db.exe"
if not exist "%MYSQLD%" (
  echo [X] No encuentro MariaDB en:  portatil\mariadb\bin\mariadbd.exe
  echo     Descargalo y descomprimilo. Ver LEEME-PRIMERO.txt
  pause & exit /b 1
)

REM --- Primera vez: inicializar el directorio de datos -------------------------
if not exist "%DATADIR%" (
  echo Inicializando la base de datos por primera vez...
  "%MINSTALL%" --datadir="%DATADIR%" --auth-root-authentication-method=normal
  if errorlevel 1 (
    echo [X] No se pudo inicializar la base. Ver LEEME-PRIMERO.txt
    pause & exit /b 1
  )
)

REM --- Arrancar MariaDB en una ventana minimizada ------------------------------
echo Arrancando la base de datos (puerto %DBPORT%)...
start "MariaDB-MDP" /min "%MYSQLD%" --datadir="%DATADIR%" --port=%DBPORT%

REM Esperar a que responda (hasta ~30 s)
set /a intentos=0
:esperar_db
"%MCLI%" -u root --port=%DBPORT% --protocol=tcp -e "SELECT 1" >nul 2>&1
if not errorlevel 1 goto db_lista
set /a intentos+=1
if !intentos! GEQ 30 (
  echo [X] La base no respondio a tiempo. Revisa portatil\mariadb y volve a intentar.
  pause & exit /b 1
)
timeout /t 1 >nul
goto esperar_db
:db_lista
echo Base lista.

REM --- Crear el .env del proyecto la primera vez ------------------------------
if not exist "%APPDIR%\.env" (
  echo Generando la configuracion (.env)...
  > "%APPDIR%\.env" echo PORT=3100
  >> "%APPDIR%\.env" echo DB_HOST=127.0.0.1
  >> "%APPDIR%\.env" echo DB_PORT=%DBPORT%
  >> "%APPDIR%\.env" echo DB_USER=root
  >> "%APPDIR%\.env" echo DB_PASSWORD=
  >> "%APPDIR%\.env" echo DB_NAME=matriz_mdp
  for /f "delims=" %%K in ('""%NODE%" -e "console.log(require('crypto').randomBytes(48).toString('hex'))""') do set "JWT=%%K"
  >> "%APPDIR%\.env" echo JWT_SECRET=!JWT!
  >> "%APPDIR%\.env" echo JWT_EXPIRY=12h
  >> "%APPDIR%\.env" echo MAX_INTENTOS=5
  >> "%APPDIR%\.env" echo BLOQUEO_MINUTOS=15
)

REM --- Instalar dependencias si faltan (necesita internet una sola vez) --------
if not exist "%APPDIR%\node_modules" (
  echo Instalando dependencias (una sola vez, necesita internet)...
  pushd "%APPDIR%"
  "%NODE%" "%~dp0node\node_modules\npm\bin\npm-cli.js" install --omit=dev 2>nul
  if errorlevel 1 call npm install --omit=dev
  popd
)

REM --- Primera vez: crear tablas, catalogos y el admin ------------------------
if not exist "%DATADIR%\matriz_mdp" (
  echo Creando las tablas y los catalogos...
  pushd "%APPDIR%"
  echo BORRAR | "%NODE%" scripts\init-db.js
  echo.
  echo === Ahora creamos el primer usuario administrador ===
  echo     (te va a pedir nombre, usuario, correo y contrasena)
  echo.
  "%NODE%" scripts\crear-admin.js
  popd
)

REM --- Arrancar el servidor ----------------------------------------------------
echo.
echo ================================================================
echo   Matriz MDP esta corriendo.   Abri en el navegador:
echo.
echo        http://localhost:3100
echo.
echo   Deja ESTA ventana abierta mientras uses el sistema.
echo   Para apagarlo: cerra esta ventana y luego ejecuta DETENER.bat
echo ================================================================
echo.
start "" "http://localhost:3100"
pushd "%APPDIR%"
"%NODE%" server.js
popd

echo.
echo El servidor se detuvo. Ejecuta DETENER.bat para apagar la base de datos.
pause
