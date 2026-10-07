/**
 * respaldar.js — guarda TODOS los datos de la base en un archivo .sql.
 *
 *   npm run respaldar              -> respaldos/matriz-mdp-AAAA-MM-DD-HHMM.sql
 *   npm run respaldar -- ruta.sql  -> a la ruta indicada
 *
 * El volcado se arma en Node, sin mysqldump: ese binario rara vez esta en el
 * PATH de una instalacion de XAMPP en Windows, y el respaldo no deberia
 * depender de eso. Los volumenes de este sistema son chicos, asi que recorrer
 * las tablas desde la aplicacion es suficiente y mas portable.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

require('./env')();

// Orden con las tablas referenciadas antes que las que las referencian. Aun
// asi el archivo desactiva la verificacion de claves foraneas al restaurar,
// porque una fila puede apuntar a otra de su misma tabla.
const ORDEN = [
  'cargos', 'permisos', 'cargo_permisos', 'usuarios',
  'factores', 'subfactores', 'niveles', 'evaluaciones',
  'riesgos', 'controles',
  'tareas', 'tarea_traspasos',
  'auditoria',
];

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`;
  if (v instanceof Date) return mysql.escape(v.toISOString().slice(0, 19).replace('T', ' '));
  if (typeof v === 'object') return mysql.escape(JSON.stringify(v));
  return mysql.escape(String(v));
}

(async () => {
  const base = process.env.DB_NAME || 'matriz_mdp';
  const cx = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: base,
    dateStrings: true,          // las fechas salen tal cual estan guardadas
  });

  const ahora = new Date();
  const sello = ahora.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const destino = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'respaldos', `matriz-mdp-${sello}.sql`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });

  const partes = [
    `-- Respaldo de datos de Matriz MDP`,
    `-- Base: ${base}`,
    `-- Fecha: ${ahora.toISOString()}`,
    `--`,
    `-- Restaurar con:  npm run restaurar -- "${path.basename(destino)}"`,
    `-- Contiene solo datos: las tablas se crean antes con npm run init-db.`,
    ``,
    `SET NAMES utf8mb4;`,
    `SET FOREIGN_KEY_CHECKS = 0;`,
    ``,
  ];

  const [tablas] = await cx.query('SHOW TABLES');
  const existentes = tablas.map(t => Object.values(t)[0]);
  // Primero las del orden conocido, despues cualquier tabla nueva que aparezca.
  const lista = [...ORDEN.filter(t => existentes.includes(t)),
                 ...existentes.filter(t => !ORDEN.includes(t))];

  const resumen = [];
  for (const tabla of lista) {
    const [filas] = await cx.query(`SELECT * FROM \`${tabla}\``);
    resumen.push([tabla, filas.length]);
    partes.push(`-- ${tabla}: ${filas.length} fila(s)`);
    partes.push(`DELETE FROM \`${tabla}\`;`);
    if (!filas.length) { partes.push(''); continue; }

    const columnas = Object.keys(filas[0]);
    const cab = `INSERT INTO \`${tabla}\` (${columnas.map(c => `\`${c}\``).join(', ')}) VALUES`;
    // Lotes de 200 filas: evita una sola sentencia gigante que el servidor
    // rechace por max_allowed_packet.
    for (let i = 0; i < filas.length; i += 200) {
      const lote = filas.slice(i, i + 200)
        .map(f => `  (${columnas.map(c => literal(f[c])).join(', ')})`);
      partes.push(cab, lote.join(',\n') + ';');
    }
    partes.push('');
  }

  partes.push(`SET FOREIGN_KEY_CHECKS = 1;`, '');
  fs.writeFileSync(destino, partes.join('\n'), 'utf8');
  await cx.end();

  const kb = (fs.statSync(destino).size / 1024).toFixed(1);
  console.log(`\n  Respaldo guardado en:\n    ${destino}  (${kb} KB)\n`);
  for (const [t, n] of resumen) if (n) console.log(`    ${t.padEnd(18)} ${String(n).padStart(6)} fila(s)`);
  console.log('');
})().catch(e => { console.error('\n  Error:', e.message, '\n'); process.exit(1); });
