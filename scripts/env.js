/** Carga .env en process.env sin pisar lo que ya venga del entorno. */
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = function () {
  const archivo = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
};
