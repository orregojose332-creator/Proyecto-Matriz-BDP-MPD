/**
 * restaurar.js — carga un respaldo sobre la base actual.
 *
 *   npm run restaurar -- respaldos/matriz-mdp-2026-10-07-1430.sql
 *
 * REEMPLAZA los datos existentes: el archivo vacia cada tabla antes de
 * insertar. Las tablas tienen que existir, asi que en una PC nueva el orden es
 * npm run init-db  ->  npm run restaurar.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mysql = require('mysql2/promise');

require('./env')();

const preguntar = texto => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(texto, v => { rl.close(); res(String(v).trim()); });
});

(async () => {
  const archivo = process.argv[2];
  if (!archivo) throw new Error('Indique el archivo: npm run restaurar -- respaldos/archivo.sql');
  const ruta = path.resolve(archivo);
  if (!fs.existsSync(ruta)) throw new Error(`No existe el archivo: ${ruta}`);

  const base = process.env.DB_NAME || 'matriz_mdp';
  const cx = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: base,
    multipleStatements: true,
  });

  const [[previo]] = await cx.query(
    `SELECT (SELECT COUNT(*) FROM usuarios) usuarios, (SELECT COUNT(*) FROM riesgos) riesgos,
            (SELECT COUNT(*) FROM tareas) tareas`).catch(() => [[{}]]);

  console.log(`\n  Restaurar  ${path.basename(ruta)}`);
  console.log(`  sobre la base "${base}", que ahora tiene ` +
    `${previo.usuarios ?? '?'} usuario(s), ${previo.riesgos ?? '?'} riesgo(s), ${previo.tareas ?? '?'} tarea(s).`);
  console.log('  Esos datos se REEMPLAZAN por los del respaldo.');

  if (process.env.RESTAURAR_SIN_CONFIRMAR !== '1') {
    const r = await preguntar('  Escriba RESTAURAR para continuar: ');
    if (r !== 'RESTAURAR') { console.log('  Cancelado. No se toco nada.\n'); await cx.end(); process.exit(0); }
  }

  await cx.query(fs.readFileSync(ruta, 'utf8'));

  const [[ahora]] = await cx.query(
    `SELECT (SELECT COUNT(*) FROM usuarios) usuarios, (SELECT COUNT(*) FROM riesgos) riesgos,
            (SELECT COUNT(*) FROM controles) controles, (SELECT COUNT(*) FROM tareas) tareas,
            (SELECT COUNT(*) FROM tarea_traspasos) traspasos`);
  await cx.end();
  console.log(`\n  Restaurado: ${ahora.usuarios} usuario(s), ${ahora.riesgos} riesgo(s), ` +
    `${ahora.controles} control(es), ${ahora.tareas} tarea(s), ${ahora.traspasos} traspaso(s).`);
  console.log('  Las contrasenas siguen siendo las mismas de la PC de origen.\n');
})().catch(e => { console.error('\n  Error:', e.message, '\n'); process.exit(1); });
