#!/usr/bin/env bash
# ============================================================================
#  Matriz MDP - Arranque portatil (Linux / macOS)
#
#  Levanta MariaDB en una carpeta propia (puerto 3307) y el servidor Node en
#  el 3100, sin instalar nada a nivel de sistema. La primera vez crea la base,
#  las tablas y el usuario administrador.
#
#  Requisitos: tener 'node' y los binarios de MariaDB (mariadbd,
#  mariadb-install-db, mariadb, mariadb-admin) disponibles en el PATH, o
#  apuntarlos con las variables NODE_BIN y MARIADB_BIN de abajo.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

NODE_BIN="${NODE_BIN:-node}"
MBIN="${MARIADB_BIN:-}"            # carpeta con mariadbd, etc. Vacio = usar PATH
DATADIR="$PWD/datos"
DBPORT=3307
APPDIR="$PWD/.."

mdb() { if [ -n "$MBIN" ]; then "$MBIN/$1" "${@:2}"; else "$1" "${@:2}"; fi; }

# --- Primera vez: inicializar el directorio de datos ---
if [ ! -d "$DATADIR" ]; then
  echo "Inicializando la base por primera vez..."
  mdb mariadb-install-db --datadir="$DATADIR" --auth-root-authentication-method=normal >/dev/null
fi

# --- Arrancar MariaDB ---
echo "Arrancando la base (puerto $DBPORT)..."
EXTRA=""; [ "$(id -u)" = "0" ] && EXTRA="--user=root"
mdb mariadbd --datadir="$DATADIR" --port=$DBPORT --socket="$PWD/mdp.sock" --pid-file="$PWD/mdp.pid" $EXTRA >"$PWD/mariadb.log" 2>&1 &
for i in $(seq 1 30); do
  mdb mariadb -u root --port=$DBPORT --protocol=tcp -e "SELECT 1" >/dev/null 2>&1 && break
  sleep 1
done
echo "Base lista."

# --- Config .env la primera vez ---
if [ ! -f "$APPDIR/.env" ]; then
  echo "Generando configuracion (.env)..."
  JWT="$("$NODE_BIN" -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  cat > "$APPDIR/.env" <<ENV
PORT=3100
DB_HOST=127.0.0.1
DB_PORT=$DBPORT
DB_USER=root
DB_PASSWORD=
DB_NAME=matriz_mdp
JWT_SECRET=$JWT
JWT_EXPIRY=12h
MAX_INTENTOS=5
BLOQUEO_MINUTOS=15
ENV
fi

# --- Dependencias ---
[ -d "$APPDIR/node_modules" ] || ( cd "$APPDIR" && npm install --omit=dev )

# --- Primera vez: tablas, catalogos y admin ---
if [ ! -d "$DATADIR/matriz_mdp" ]; then
  echo "Creando tablas y catalogos..."
  ( cd "$APPDIR" && echo BORRAR | "$NODE_BIN" scripts/init-db.js )
  echo; echo "=== Crear el primer administrador ==="
  ( cd "$APPDIR" && "$NODE_BIN" scripts/crear-admin.js )
fi

echo
echo "============================================================"
echo "  Matriz MDP corriendo en:  http://localhost:3100"
echo "  Deja esta terminal abierta. Ctrl+C para detener."
echo "============================================================"
( cd "$APPDIR" && exec "$NODE_BIN" server.js )
