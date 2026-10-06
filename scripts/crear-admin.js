/**
 * crear-admin.js — crea el primer usuario con cargo Administrador.
 * Uso:  npm run crear-admin
 *
 * La contrasena se guarda unicamente como hash bcrypt: no se escribe en el
 * repositorio, ni en la base en claro, ni en los logs.
 *
 * Para instalaciones desatendidas se pueden pasar por entorno:
 *   ADMIN_NOMBRE, ADMIN_USUARIO, ADMIN_EMAIL, ADMIN_PASSWORD
 */
'use strict';
const mysql    = require('mysql2/promise');
const bcrypt   = require('bcryptjs');
const readline = require('readline');

require('./env')();
const BCRYPT_ROUNDS = 12;
const INTERACTIVO = Boolean(process.stdin.isTTY);

/** Pide un dato por consola.
 *  Si stdin no es una terminal (tuberia, instalador, CI) lee la linea tal cual:
 *  el truco de ocultar el eco reimprimiendo el prompt solo funciona sobre una
 *  terminal real, y en una tuberia dejaba el proceso colgado. */
function preguntar(texto, oculto = false) {
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, terminal: INTERACTIVO,
  });
  return new Promise(resolve => {
    if (!oculto || !INTERACTIVO) {
      return rl.question(INTERACTIVO ? texto : '', v => { rl.close(); resolve(String(v).trim()); });
    }
    process.stdout.write(texto);
    const onData = ch => {
      const s = ch.toString();
      if (s === '\n' || s === '\r' || s === '\u0004') return;
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(texto);
    };
    process.stdin.on('data', onData);
    rl.question('', v => {
      process.stdin.off('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(String(v).trim());
    });
  });
}

(async () => {
  const cx = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'matriz_mdp',
  });

  const [[cargo]] = await cx.query("SELECT id FROM cargos WHERE nombre='Administrador'");
  if (!cargo) throw new Error('No existe el cargo Administrador. Ejecute primero: npm run init-db');

  if (INTERACTIVO) console.log('\n  Alta del primer administrador de Matriz MDP\n');
  const e = process.env;
  const nombre   = e.ADMIN_NOMBRE   || await preguntar('  Nombre completo : ');
  const username = e.ADMIN_USUARIO  || await preguntar('  Usuario         : ');
  const email    = e.ADMIN_EMAIL    || await preguntar('  Correo          : ');
  const pass     = e.ADMIN_PASSWORD || await preguntar('  Contrasena      : ', true);
  const pass2    = e.ADMIN_PASSWORD || await preguntar('  Repetir         : ', true);

  if (!nombre || !username || !email) throw new Error('Nombre, usuario y correo son obligatorios.');
  if (pass !== pass2)  throw new Error('Las contrasenas no coinciden.');
  if (pass.length < 8) throw new Error('La contrasena debe tener al menos 8 caracteres.');

  await cx.query(
    `INSERT INTO usuarios (nombre, username, password_hash, email, cargo_id, activo)
     VALUES (?,?,?,?,?,1)`,
    [nombre, username, await bcrypt.hash(pass, BCRYPT_ROUNDS), email, cargo.id]);

  await cx.end();
  console.log(`\n  Administrador "${username}" creado. Ya puede iniciar sesion.\n`);
})().catch(err => { console.error('\n  Error:', err.message, '\n'); process.exit(1); });
