/**
 * init-db.js — crea la base y ejecuta schema.sql y seed.sql.
 * Uso:  npm run init-db
 * Es destructivo: schema.sql hace DROP TABLE de todo. Pide confirmacion.
 */
'use strict';
const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');
const readline = require('readline');

require('./env')();

const NOMBRE = process.env.DB_NAME || 'matriz_mdp';

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(texto, v => { rl.close(); r(v.trim()); }));
}

(async () => {
  const conexion = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  };

  const cx = await mysql.createConnection(conexion);
  const [bases] = await cx.query('SHOW DATABASES LIKE ?', [NOMBRE]);

  if (bases.length) {
    console.log(`\n  La base "${NOMBRE}" ya existe.`);
    console.log('  Continuar BORRA todas las tablas y los datos que contengan.');
    const r = await preguntar('  Escriba BORRAR para continuar: ');
    if (r !== 'BORRAR') { console.log('  Cancelado. No se toco nada.\n'); await cx.end(); process.exit(0); }
  } else {
    await cx.query(`CREATE DATABASE \`${NOMBRE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`  Base "${NOMBRE}" creada.`);
  }

  await cx.changeUser({ database: NOMBRE });
  const dirDb = path.join(__dirname, '..', 'db');
  // Las migraciones se aplican en orden alfabetico despues del seed, de modo
  // que agregar una funcionalidad es dejar un archivo nuevo en db/.
  const migraciones = fs.readdirSync(dirDb)
    .filter(n => /^migracion-.*\.sql$/.test(n)).sort();
  for (const archivo of ['schema.sql', 'seed.sql', ...migraciones]) {
    await cx.query(fs.readFileSync(path.join(dirDb, archivo), 'utf8'));
    console.log(`  ${archivo} aplicado.`);
  }
  await cx.end();
  console.log('\n  Listo. Siguiente paso:  npm run crear-admin\n');
})().catch(e => { console.error('\n  Error:', e.message, '\n'); process.exit(1); });
