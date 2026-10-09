/**
 * server.js — Matriz MDP
 * Servidor HTTP + API REST sobre MySQL, con eventos en vivo por SSE.
 * Uso:  npm start        (lee la configuracion de .env)
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

// ── Configuracion ───────────────────────────────────────────────────────────
cargarEnv(path.join(__dirname, '.env'));

const PORT       = Number(process.env.PORT || 3100);
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '12h';
const MAX_INTENTOS    = Number(process.env.MAX_INTENTOS || 5);
const BLOQUEO_MINUTOS = Number(process.env.BLOQUEO_MINUTOS || 15);
const BCRYPT_ROUNDS   = 12;
const ROOT = path.join(__dirname, 'public');

// Sin clave de firma cualquiera podria fabricarse un token de administrador,
// asi que se corta el arranque en vez de improvisar una por defecto.
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('\nFALTA JWT_SECRET en .env (minimo 32 caracteres).');
  console.error('Generar una con:\n  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
  process.exit(1);
}

function cargarEnv(archivo) {
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const DB = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'matriz_mdp',
  charset: 'utf8mb4',
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
});

// ── Metodologia de calculo ──────────────────────────────────────────────────
// Riesgo inherente = probabilidad x impacto, en escala 1..25.
// Los controles lo reducen hasta un 80%: nunca a cero, porque ningun control
// elimina el riesgo por completo y mostrar 0 daria una falsa seguridad.
const MITIGACION_MAXIMA = 0.80;
const UMBRALES = [
  { hasta: 4,  nivel: 'Bajo'     },
  { hasta: 9,  nivel: 'Moderado' },
  { hasta: 14, nivel: 'Alto'     },
  { hasta: 25, nivel: 'Critico'  },
];

function nivelDe(valor) {
  return (UMBRALES.find(u => valor <= u.hasta) || UMBRALES[UMBRALES.length - 1]).nivel;
}

function calcularRiesgo(probabilidad, impacto, controles = []) {
  const inherente = Number(probabilidad) * Number(impacto);
  const efectivos = controles.filter(c => Number(c.efectividad) > 0);
  const promedio  = efectivos.length
    ? efectivos.reduce((a, c) => a + Number(c.efectividad), 0) / efectivos.length
    : 0;
  const mitigacion = (promedio / 5) * MITIGACION_MAXIMA;
  const residual   = inherente * (1 - mitigacion);
  return {
    inherente_valor: Number(inherente.toFixed(2)),
    inherente_nivel: nivelDe(inherente),
    residual_valor:  Number(residual.toFixed(2)),
    residual_nivel:  nivelDe(residual),
  };
}

// ── Helpers HTTP ────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(data));
}
const err = (res, msg, status = 500) => json(res, { error: msg }, status);

function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 1e6) { req.destroy(); reject(new Error('Cuerpo demasiado grande')); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('JSON invalido')); }
    });
  });
}

const ipDe = req =>
  String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

// ── Autenticacion y permisos ────────────────────────────────────────────────
function tokenDe(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)mdp_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function sesion(req) {
  const t = tokenDe(req);
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}

/** Permisos frescos de la base: si un administrador revoca un permiso, deja de
 *  valer de inmediato en vez de esperar a que expire el token. */
async function permisosDe(usuarioId) {
  const [filas] = await DB.query(
    `SELECT p.clave FROM usuarios u
       JOIN cargo_permisos cp ON cp.cargo_id = u.cargo_id
       JOIN permisos p        ON p.id = cp.permiso_id
      WHERE u.id = ? AND u.activo = 1`, [usuarioId]);
  return filas.map(f => f.clave);
}

/** Devuelve la sesion si tiene el permiso; si no, responde y devuelve null. */
async function exigir(req, res, permiso) {
  const s = sesion(req);
  if (!s) { err(res, 'No autenticado', 401); return null; }
  const permisos = await permisosDe(s.id);
  if (!permisos.includes(permiso)) {
    err(res, `Su cargo no tiene el permiso "${permiso}"`, 403);
    return null;
  }
  return { ...s, permisos };
}

async function auditar(evento, { entidad, entidadId, s, req, detalle } = {}) {
  try {
    await DB.query(
      `INSERT INTO auditoria (evento, entidad, entidad_id, usuario_id, usuario_nombre, cargo, ip, detalle_json)
       VALUES (?,?,?,?,?,?,?,?)`,
      [evento, entidad || null, entidadId || null, s?.id || null, s?.nombre || null,
       s?.cargo || null, req ? ipDe(req) : null, detalle ? JSON.stringify(detalle) : null]);
  } catch (e) { console.error('auditoria:', e.message); }
}

// ── SSE: eventos en vivo ────────────────────────────────────────────────────
// Un cambio en cualquier pantalla se empuja a todas las demas, para que los
// reportes se actualicen solos y nadie tenga que refrescar.
const sseClients = new Set();

function sseSend(res, evento, data) {
  try {
    res.write(`event: ${evento}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch { sseClients.delete(res); }
}

function emitir(evento, data = {}) {
  const payload = { ...data, ts: Date.now() };
  for (const res of sseClients) sseSend(res, evento, payload);
}

function sseHandler(req, res) {
  if (!sesion(req)) { res.writeHead(401, CORS); return res.end(); }
  res.writeHead(200, {
    'Content-Type':      'text/event-stream; charset=utf-8',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',   // evita que un proxy intermedio acumule el flujo
    ...CORS,
  });
  res.write('retry: 3000\n\n');           // si se corta, el navegador reconecta solo
  res.write(': conectado\n\n');
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
}

// ── Consultas reutilizadas ──────────────────────────────────────────────────
const SELECT_RIESGO = `
  SELECT r.*, f.nombre AS factor_nombre, f.clave AS factor_clave,
         f.descripcion AS factor_descripcion,
         sf.nombre AS subfactor_nombre,
         sf.orientacion AS subfactor_orientacion,
         sf.ejemplos   AS subfactor_ejemplos,
         ur.nombre AS responsable_nombre,
         (SELECT COUNT(*) FROM controles c WHERE c.riesgo_id = r.id) AS controles_count,
         (SELECT COUNT(*) FROM tareas t WHERE t.riesgo_id = r.id) AS tareas_count,
         (SELECT COUNT(*) FROM tareas t WHERE t.riesgo_id = r.id
            AND t.estado NOT IN ('Completada','Cancelada')) AS tareas_abiertas
    FROM riesgos r
    JOIN factores f      ON f.id = r.factor_id
    LEFT JOIN subfactores sf ON sf.id = r.subfactor_id
    LEFT JOIN usuarios ur    ON ur.id = r.responsable_id`;

async function recalcular(riesgoId) {
  const [[r]] = await DB.query('SELECT probabilidad, impacto FROM riesgos WHERE id = ?', [riesgoId]);
  if (!r) return null;
  const [controles] = await DB.query('SELECT efectividad FROM controles WHERE riesgo_id = ?', [riesgoId]);
  const calc = calcularRiesgo(r.probabilidad, r.impacto, controles);
  await DB.query(
    `UPDATE riesgos SET inherente_valor=?, inherente_nivel=?, residual_valor=?, residual_nivel=? WHERE id=?`,
    [calc.inherente_valor, calc.inherente_nivel, calc.residual_valor, calc.residual_nivel, riesgoId]);
  return calc;
}

// ── Ruteo de la API ─────────────────────────────────────────────────────────
async function api(req, res, url) {
  const partes = url.pathname.split('/').filter(Boolean);   // ['api', ...]
  const rec    = partes.slice(1);
  const q      = url.searchParams;
  const metodo = req.method;

  // ---- Autenticacion -------------------------------------------------------
  if (rec[0] === 'auth' && rec[1] === 'login' && metodo === 'POST') {
    const b = await body(req);
    const usuario = String(b.username || '').trim();
    const [[u]] = await DB.query(
      `SELECT u.*, c.nombre AS cargo FROM usuarios u JOIN cargos c ON c.id = u.cargo_id
        WHERE u.username = ?`, [usuario]);

    // Respuesta uniforme: no revela si el usuario existe.
    const generico = 'Usuario o contrasena incorrectos';

    if (u?.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
      await auditar('login_bloqueado', { entidad: 'usuario', entidadId: u.id, req });
      return err(res, `Cuenta bloqueada temporalmente. Reintente despues de ${new Date(u.bloqueado_hasta).toLocaleTimeString('es-PY')}.`, 423);
    }

    const ok = u && u.activo && await bcrypt.compare(String(b.password || ''), u.password_hash);
    if (!ok) {
      if (u) {
        const intentos = u.intentos_fallidos + 1;
        const bloquear = intentos >= MAX_INTENTOS;
        await DB.query(
          `UPDATE usuarios SET intentos_fallidos=?, bloqueado_hasta=? WHERE id=?`,
          [bloquear ? 0 : intentos,
           bloquear ? new Date(Date.now() + BLOQUEO_MINUTOS * 60000) : null, u.id]);
        await auditar('login_fallido', { entidad: 'usuario', entidadId: u.id, req,
                                         detalle: { intentos } });
      }
      return err(res, generico, 401);
    }

    await DB.query(
      'UPDATE usuarios SET ultimo_acceso=NOW(), intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=?',
      [u.id]);
    const permisos = await permisosDe(u.id);
    const token = jwt.sign(
      { id: u.id, nombre: u.nombre, username: u.username, cargo: u.cargo, cargo_id: u.cargo_id },
      JWT_SECRET, { expiresIn: JWT_EXPIRY });
    await auditar('login', { entidad: 'usuario', entidadId: u.id, s: { ...u, cargo: u.cargo }, req });
    return json(res, {
      token,
      usuario: { id: u.id, nombre: u.nombre, username: u.username, email: u.email,
                 cargo: u.cargo, cargo_id: u.cargo_id, permisos,
                 foto: u.foto || null, pref_tema: u.pref_tema, pref_tam: u.pref_tam,
                 pref_fuente: u.pref_fuente },
    });
  }

  if (rec[0] === 'auth' && rec[1] === 'me' && metodo === 'GET') {
    const s = sesion(req);
    if (!s) return err(res, 'No autenticado', 401);
    const [[u]] = await DB.query(
      `SELECT u.id, u.nombre, u.username, u.email, u.cargo_id, c.nombre AS cargo,
              u.foto, u.pref_tema, u.pref_tam, u.pref_fuente
         FROM usuarios u JOIN cargos c ON c.id = u.cargo_id
        WHERE u.id = ? AND u.activo = 1`, [s.id]);
    if (!u) return err(res, 'Sesion invalida', 401);
    return json(res, { ...u, permisos: await permisosDe(u.id) });
  }

  // ---- Perfil propio: foto y preferencias de quien esta logueado -----------
  // No necesita permiso especial: cada usuario edita solo lo suyo (su s.id).
  if (rec[0] === 'perfil' && rec.length === 1 && metodo === 'PUT') {
    const s = sesion(req);
    if (!s) return err(res, 'No autenticado', 401);
    const b = await body(req);

    const TEMAS = ['auto', 'claro', 'gris', 'oscuro'];
    const TAMS = ['sm', 'md', 'lg'];
    const FUENTES = ['sistema', 'serif', 'mono'];
    const tema   = TEMAS.includes(b.pref_tema) ? b.pref_tema : 'auto';
    const tam    = TAMS.includes(b.pref_tam) ? b.pref_tam : 'md';
    const fuente = FUENTES.includes(b.pref_fuente) ? b.pref_fuente : 'sistema';

    // La foto es opcional. Debe ser un data URL de imagen y no exagerar el peso
    // (el navegador ya la reduce; el tope evita que alguien mande un archivo
    //  enorme a la base). null la quita.
    let foto;
    if (b.foto === null || b.foto === '') foto = null;
    else if (typeof b.foto === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(b.foto)) {
      if (b.foto.length > 400000) return err(res, 'La imagen es demasiado grande (máx. ~300 KB)', 413);
      foto = b.foto;
    } else if (b.foto === undefined) foto = undefined;   // no tocar la foto
    else return err(res, 'Formato de imagen no válido', 400);

    const campos = ['pref_tema=?', 'pref_tam=?', 'pref_fuente=?'];
    const args = [tema, tam, fuente];
    if (foto !== undefined) { campos.push('foto=?'); args.push(foto); }
    args.push(s.id);
    await DB.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id=?`, args);
    return json(res, { ok: true, pref_tema: tema, pref_tam: tam, pref_fuente: fuente,
                       ...(foto !== undefined ? { foto } : {}) });
  }

  // ---- Catalogos -----------------------------------------------------------
  if (rec[0] === 'catalogos' && metodo === 'GET') {
    if (!sesion(req)) return err(res, 'No autenticado', 401);
    const [factores]    = await DB.query('SELECT * FROM factores ORDER BY orden');
    const [subfactores] = await DB.query(
      'SELECT * FROM subfactores WHERE activo=1 ORDER BY factor_id, nombre');
    const [niveles]     = await DB.query('SELECT * FROM niveles ORDER BY tipo, valor');
    const [evaluaciones]= await DB.query('SELECT * FROM evaluaciones ORDER BY periodo_desde DESC');
    const [usuarios]    = await DB.query('SELECT id, nombre FROM usuarios WHERE activo=1 ORDER BY nombre');
    return json(res, { factores, subfactores, niveles, evaluaciones, usuarios,
                       umbrales: UMBRALES, mitigacionMaxima: MITIGACION_MAXIMA });
  }

  if (rec[0] === 'subfactores' && rec.length === 2 && metodo === 'PUT') {
    const s = await exigir(req, res, 'catalogos.gestionar'); if (!s) return;
    const b = await body(req);
    const [r] = await DB.query(
      'UPDATE subfactores SET nombre=?, descripcion=?, orientacion=?, ejemplos=? WHERE id=?',
      [b.nombre, b.descripcion || null, b.orientacion || null, b.ejemplos || null, rec[1]]);
    if (!r.affectedRows) return err(res, 'Subfactor no encontrado', 404);
    await auditar('subfactor_editado', { entidad: 'subfactor', entidadId: Number(rec[1]), s, req });
    emitir('riesgos', { accion: 'catalogo' });
    return json(res, { ok: true });
  }

  // ---- Riesgos -------------------------------------------------------------
  if (rec[0] === 'riesgos' && rec.length === 1 && metodo === 'GET') {
    const s = await exigir(req, res, 'riesgos.ver'); if (!s) return;
    const cond = [], args = [];
    if (q.get('evaluacion')) { cond.push('r.evaluacion_id = ?'); args.push(q.get('evaluacion')); }
    if (q.get('factor'))     { cond.push('r.factor_id = ?');     args.push(q.get('factor')); }
    if (q.get('estado'))     { cond.push('r.estado = ?');        args.push(q.get('estado')); }
    if (q.get('nivel'))      { cond.push('r.residual_nivel = ?');args.push(q.get('nivel')); }
    const where = cond.length ? ` WHERE ${cond.join(' AND ')}` : '';
    const [filas] = await DB.query(`${SELECT_RIESGO}${where} ORDER BY r.residual_valor DESC, r.codigo`, args);
    return json(res, filas);
  }

  if (rec[0] === 'riesgos' && rec.length === 2 && metodo === 'GET') {
    const s = await exigir(req, res, 'riesgos.ver'); if (!s) return;
    const [[r]] = await DB.query(`${SELECT_RIESGO} WHERE r.id = ?`, [rec[1]]);
    if (!r) return err(res, 'Riesgo no encontrado', 404);
    const [controles] = await DB.query('SELECT * FROM controles WHERE riesgo_id=? ORDER BY id', [rec[1]]);
    return json(res, { ...r, controles });
  }

  if (rec[0] === 'riesgos' && rec.length === 1 && metodo === 'POST') {
    const s = await exigir(req, res, 'riesgos.crear'); if (!s) return;
    const b = await body(req);
    const prob = Number(b.probabilidad), imp = Number(b.impacto);
    if (!(prob >= 1 && prob <= 5) || !(imp >= 1 && imp <= 5))
      return err(res, 'Probabilidad e impacto deben estar entre 1 y 5', 400);
    if (!String(b.descripcion || '').trim()) return err(res, 'La descripcion es obligatoria', 400);

    const calc = calcularRiesgo(prob, imp, []);
    try {
      const [r] = await DB.query(
        `INSERT INTO riesgos (evaluacion_id, codigo, factor_id, subfactor_id, descripcion,
            contexto, referencia, probabilidad, impacto, inherente_valor, inherente_nivel,
            residual_valor, residual_nivel, estado, responsable_id, fecha_identificacion, creado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [b.evaluacion_id, b.codigo, b.factor_id, b.subfactor_id || null, b.descripcion,
         b.contexto || null, b.referencia || null,
         prob, imp, calc.inherente_valor, calc.inherente_nivel, calc.residual_valor,
         calc.residual_nivel, 'Borrador', b.responsable_id || null,
         b.fecha_identificacion || new Date().toISOString().slice(0, 10), s.id]);
      await auditar('riesgo_creado', { entidad: 'riesgo', entidadId: r.insertId, s, req, detalle: { codigo: b.codigo } });
      emitir('riesgos', { accion: 'alta', id: r.insertId });
      return json(res, { id: r.insertId, ...calc }, 201);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return err(res, 'Ya existe un riesgo con ese codigo en el ciclo', 409);
      throw e;
    }
  }

  if (rec[0] === 'riesgos' && rec.length === 2 && metodo === 'PUT') {
    const s = await exigir(req, res, 'riesgos.editar'); if (!s) return;
    const b = await body(req);
    const [[actual]] = await DB.query('SELECT estado FROM riesgos WHERE id=?', [rec[1]]);
    if (!actual) return err(res, 'Riesgo no encontrado', 404);
    if (actual.estado === 'Cerrado' && !s.permisos.includes('riesgos.aprobar'))
      return err(res, 'El riesgo esta cerrado; solo un supervisor puede reabrirlo', 409);

    try {
      await DB.query(
        `UPDATE riesgos SET codigo=?, factor_id=?, subfactor_id=?, descripcion=?,
                contexto=?, referencia=?, probabilidad=?, impacto=?,
                responsable_id=?, fecha_identificacion=?
           WHERE id=?`,
        [b.codigo, b.factor_id, b.subfactor_id || null, b.descripcion,
         b.contexto || null, b.referencia || null,
         Number(b.probabilidad), Number(b.impacto), b.responsable_id || null,
         b.fecha_identificacion, rec[1]]);
    } catch (e) {
      // El alta ya devolvia 409 ante un codigo repetido; la edicion caia en el
      // manejador generico y respondia 500, sin decirle al usuario que arreglar.
      if (e.code === 'ER_DUP_ENTRY')
        return err(res, 'Ya existe otro riesgo con ese codigo en el ciclo', 409);
      throw e;
    }
    const calc = await recalcular(rec[1]);
    await auditar('riesgo_editado', { entidad: 'riesgo', entidadId: Number(rec[1]), s, req });
    emitir('riesgos', { accion: 'edicion', id: Number(rec[1]) });
    return json(res, { ok: true, ...calc });
  }

  if (rec[0] === 'riesgos' && rec.length === 3 && rec[2] === 'estado' && metodo === 'POST') {
    const s = await exigir(req, res, 'riesgos.aprobar'); if (!s) return;
    const b = await body(req);
    const permitidos = ['Borrador', 'En revision', 'Aprobado', 'Cerrado'];
    if (!permitidos.includes(b.estado)) return err(res, 'Estado invalido', 400);
    const aprobando = b.estado === 'Aprobado';
    await DB.query(
      `UPDATE riesgos SET estado=?, fecha_aprobacion=?, aprobado_por=? WHERE id=?`,
      [b.estado, aprobando ? new Date() : null, aprobando ? s.id : null, rec[1]]);
    await auditar('riesgo_estado', { entidad: 'riesgo', entidadId: Number(rec[1]), s, req, detalle: { estado: b.estado } });
    emitir('riesgos', { accion: 'estado', id: Number(rec[1]), estado: b.estado });
    return json(res, { ok: true });
  }

  if (rec[0] === 'riesgos' && rec.length === 2 && metodo === 'DELETE') {
    const s = await exigir(req, res, 'riesgos.eliminar'); if (!s) return;
    await DB.query('DELETE FROM riesgos WHERE id=?', [rec[1]]);
    await auditar('riesgo_eliminado', { entidad: 'riesgo', entidadId: Number(rec[1]), s, req });
    emitir('riesgos', { accion: 'baja', id: Number(rec[1]) });
    return json(res, { ok: true });
  }

  // ---- Controles -----------------------------------------------------------
  if (rec[0] === 'riesgos' && rec[2] === 'controles' && metodo === 'POST') {
    const s = await exigir(req, res, 'controles.gestionar'); if (!s) return;
    const b = await body(req);
    const ef = Number(b.efectividad);
    if (!(ef >= 1 && ef <= 5)) return err(res, 'La efectividad debe estar entre 1 y 5', 400);
    const [r] = await DB.query(
      `INSERT INTO controles (riesgo_id, descripcion, tipo, efectividad, documentado)
       VALUES (?,?,?,?,?)`,
      [rec[1], b.descripcion, b.tipo || 'Preventivo', ef, b.documentado ? 1 : 0]);
    const calc = await recalcular(rec[1]);
    await auditar('control_creado', { entidad: 'control', entidadId: r.insertId, s, req });
    emitir('riesgos', { accion: 'control', id: Number(rec[1]) });
    return json(res, { id: r.insertId, ...calc }, 201);
  }

  if (rec[0] === 'controles' && rec.length === 2 && metodo === 'DELETE') {
    const s = await exigir(req, res, 'controles.gestionar'); if (!s) return;
    const [[c]] = await DB.query('SELECT riesgo_id FROM controles WHERE id=?', [rec[1]]);
    if (!c) return err(res, 'Control no encontrado', 404);
    await DB.query('DELETE FROM controles WHERE id=?', [rec[1]]);
    const calc = await recalcular(c.riesgo_id);
    await auditar('control_eliminado', { entidad: 'control', entidadId: Number(rec[1]), s, req });
    emitir('riesgos', { accion: 'control', id: c.riesgo_id });
    return json(res, { ok: true, ...calc });
  }

  // ---- Reportes ------------------------------------------------------------
  if (rec[0] === 'reportes' && rec[1] === 'resumen' && metodo === 'GET') {
    const s = await exigir(req, res, 'reportes.ver'); if (!s) return;
    const ev = q.get('evaluacion') || null;
    const filtro = ev ? 'WHERE r.evaluacion_id = ?' : '';
    const args   = ev ? [ev] : [];

    const [[kpi]] = await DB.query(
      `SELECT COUNT(*) AS total,
              COALESCE(AVG(r.inherente_valor),0) AS inherente_prom,
              COALESCE(AVG(r.residual_valor),0)  AS residual_prom,
              SUM(r.residual_nivel IN ('Alto','Critico')) AS criticos,
              SUM(r.estado = 'Aprobado') AS aprobados,
              SUM(r.estado = 'Borrador') AS borradores
         FROM riesgos r ${filtro}`, args);

    const [porFactor] = await DB.query(
      `SELECT f.id, f.nombre, f.ponderacion, COUNT(r.id) AS cantidad,
              COALESCE(AVG(r.inherente_valor),0) AS inherente_prom,
              COALESCE(AVG(r.residual_valor),0)  AS residual_prom
         FROM factores f
         LEFT JOIN riesgos r ON r.factor_id = f.id ${ev ? 'AND r.evaluacion_id = ?' : ''}
        GROUP BY f.id ORDER BY f.orden`, args);

    const [porNivel] = await DB.query(
      `SELECT r.residual_nivel AS nivel, COUNT(*) AS cantidad
         FROM riesgos r ${filtro} GROUP BY r.residual_nivel`, args);

    const [porEstado] = await DB.query(
      `SELECT r.estado, COUNT(*) AS cantidad
         FROM riesgos r ${filtro} GROUP BY r.estado`, args);

    // Mapa de calor 5x5: cuantos riesgos caen en cada celda probabilidad/impacto.
    const [mapa] = await DB.query(
      `SELECT r.probabilidad, r.impacto, COUNT(*) AS cantidad
         FROM riesgos r ${filtro} GROUP BY r.probabilidad, r.impacto`, args);

    const [top] = await DB.query(
      `${SELECT_RIESGO} ${filtro} ORDER BY r.residual_valor DESC LIMIT 10`, args);

    return json(res, { kpi, porFactor, porNivel, porEstado, mapa, top, umbrales: UMBRALES });
  }

  // ---- Usuarios ------------------------------------------------------------
  if (rec[0] === 'usuarios' && rec.length === 1 && metodo === 'GET') {
    const s = await exigir(req, res, 'usuarios.gestionar'); if (!s) return;
    const [filas] = await DB.query(
      `SELECT u.id, u.nombre, u.username, u.email, u.cargo_id, c.nombre AS cargo,
              u.activo, u.ultimo_acceso, u.bloqueado_hasta, u.created_at
         FROM usuarios u JOIN cargos c ON c.id = u.cargo_id ORDER BY u.nombre`);
    return json(res, filas);   // nunca se devuelve password_hash
  }

  if (rec[0] === 'usuarios' && rec.length === 1 && metodo === 'POST') {
    const s = await exigir(req, res, 'usuarios.gestionar'); if (!s) return;
    const b = await body(req);
    const pass = String(b.password || '');
    if (pass.length < 8) return err(res, 'La contrasena debe tener al menos 8 caracteres', 400);
    try {
      const [r] = await DB.query(
        `INSERT INTO usuarios (nombre, username, password_hash, email, cargo_id, activo)
         VALUES (?,?,?,?,?,?)`,
        [b.nombre, b.username, await bcrypt.hash(pass, BCRYPT_ROUNDS), b.email,
         b.cargo_id, b.activo === false ? 0 : 1]);
      await auditar('usuario_creado', { entidad: 'usuario', entidadId: r.insertId, s, req,
                                        detalle: { username: b.username, cargo_id: b.cargo_id } });
      emitir('usuarios', { accion: 'alta', id: r.insertId });
      return json(res, { id: r.insertId }, 201);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return err(res, 'Ya existe un usuario con ese nombre de usuario o correo', 409);
      throw e;
    }
  }

  if (rec[0] === 'usuarios' && rec.length === 2 && metodo === 'PUT') {
    const s = await exigir(req, res, 'usuarios.gestionar'); if (!s) return;
    const b = await body(req);
    const id = Number(rec[1]);

    // Un administrador no puede quitarse a si mismo el cargo ni desactivarse:
    // dejaria el sistema sin quien administre.
    if (id === s.id && (b.activo === false || Number(b.cargo_id) !== Number(s.cargo_id)))
      return err(res, 'No puede cambiar su propio cargo ni desactivar su cuenta', 409);

    if (b.password) {
      if (String(b.password).length < 8) return err(res, 'La contrasena debe tener al menos 8 caracteres', 400);
      await DB.query('UPDATE usuarios SET password_hash=? WHERE id=?',
                     [await bcrypt.hash(String(b.password), BCRYPT_ROUNDS), id]);
      await auditar('password_cambiada', { entidad: 'usuario', entidadId: id, s, req });
    }
    await DB.query(
      `UPDATE usuarios SET nombre=?, username=?, email=?, cargo_id=?, activo=?,
              intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=?`,
      [b.nombre, b.username, b.email, b.cargo_id, b.activo === false ? 0 : 1, id]);
    await auditar('usuario_editado', { entidad: 'usuario', entidadId: id, s, req });
    emitir('usuarios', { accion: 'edicion', id });
    return json(res, { ok: true });
  }

  // ---- Cargos y permisos ---------------------------------------------------
  if (rec[0] === 'cargos' && rec.length === 1 && metodo === 'GET') {
    if (!sesion(req)) return err(res, 'No autenticado', 401);
    const [cargos] = await DB.query(
      `SELECT c.*, (SELECT COUNT(*) FROM usuarios u WHERE u.cargo_id = c.id) AS usuarios_count
         FROM cargos c ORDER BY c.id`);
    const [cp] = await DB.query(
      `SELECT cp.cargo_id, p.clave FROM cargo_permisos cp JOIN permisos p ON p.id = cp.permiso_id`);
    for (const c of cargos) c.permisos = cp.filter(x => x.cargo_id === c.id).map(x => x.clave);
    return json(res, cargos);
  }

  if (rec[0] === 'permisos' && metodo === 'GET') {
    if (!sesion(req)) return err(res, 'No autenticado', 401);
    const [filas] = await DB.query('SELECT * FROM permisos ORDER BY modulo, clave');
    return json(res, filas);
  }

  if (rec[0] === 'cargos' && rec.length === 1 && metodo === 'POST') {
    const s = await exigir(req, res, 'cargos.gestionar'); if (!s) return;
    const b = await body(req);
    try {
      const [r] = await DB.query('INSERT INTO cargos (nombre, descripcion) VALUES (?,?)',
                                 [b.nombre, b.descripcion || null]);
      await auditar('cargo_creado', { entidad: 'cargo', entidadId: r.insertId, s, req });
      emitir('cargos', { accion: 'alta', id: r.insertId });
      return json(res, { id: r.insertId }, 201);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return err(res, 'Ya existe un cargo con ese nombre', 409);
      throw e;
    }
  }

  if (rec[0] === 'cargos' && rec.length === 3 && rec[2] === 'permisos' && metodo === 'PUT') {
    const s = await exigir(req, res, 'cargos.gestionar'); if (!s) return;
    const b = await body(req);
    const cargoId = Number(rec[1]);
    const claves  = Array.isArray(b.permisos) ? b.permisos : [];

    // Quitarle 'cargos.gestionar' al propio cargo dejaria a nadie pudiendo
    // volver a entrar a esta pantalla.
    if (cargoId === Number(s.cargo_id) && !claves.includes('cargos.gestionar'))
      return err(res, 'No puede quitarle a su propio cargo el permiso de gestionar cargos', 409);

    const cx = await DB.getConnection();
    try {
      await cx.beginTransaction();
      await cx.query('DELETE FROM cargo_permisos WHERE cargo_id=?', [cargoId]);
      if (claves.length) {
        await cx.query(
          `INSERT INTO cargo_permisos (cargo_id, permiso_id)
             SELECT ?, id FROM permisos WHERE clave IN (?)`, [cargoId, claves]);
      }
      await cx.commit();
    } catch (e) { await cx.rollback(); throw e; }
    finally { cx.release(); }

    await auditar('cargo_permisos', { entidad: 'cargo', entidadId: cargoId, s, req, detalle: { permisos: claves } });
    emitir('cargos', { accion: 'permisos', id: cargoId });
    return json(res, { ok: true });
  }

  // ---- Evaluaciones --------------------------------------------------------
  if (rec[0] === 'evaluaciones' && metodo === 'POST') {
    const s = await exigir(req, res, 'evaluaciones.gestionar'); if (!s) return;
    const b = await body(req);
    const [r] = await DB.query(
      `INSERT INTO evaluaciones (nombre, periodo_desde, periodo_hasta, metodologia_version, creado_por)
       VALUES (?,?,?,?,?)`,
      [b.nombre, b.periodo_desde, b.periodo_hasta, b.metodologia_version || '1.0', s.id]);
    await auditar('evaluacion_creada', { entidad: 'evaluacion', entidadId: r.insertId, s, req });
    emitir('evaluaciones', { accion: 'alta', id: r.insertId });
    return json(res, { id: r.insertId }, 201);
  }

  // ---- Auditoria -----------------------------------------------------------
  if (rec[0] === 'auditoria' && metodo === 'GET') {
    const s = await exigir(req, res, 'auditoria.ver'); if (!s) return;
    const limite = Math.min(Number(q.get('limite') || 200), 1000);
    const [filas] = await DB.query(
      'SELECT * FROM auditoria ORDER BY id DESC LIMIT ?', [limite]);
    return json(res, filas);
  }

  // ---- Calendario: tareas y controles agendados ----------------------------
  const ESTADOS_TAREA = ['Pendiente','En proceso','En revision','Completada','Cancelada'];

  /** Los tres tipos de trabajo del area. 'Auditoria' y 'Control programado' son
   *  trabajo de rutina que se agenda; 'Especial' es un caso que aparece solo. */
  // El vocabulario de tipos todavia se pule con el area; es texto validado,
  // no un ENUM, para cambiarlo sin migrar. Los dos primeros son los que ofrece
  // el formulario de informe; 'Especial' se conserva para los casos reservados
  // (hurto, acoso, denuncias) que ya existian, con su regla de confidencialidad.
  const TIPOS_TAREA = ['Tarea programada', 'Control extraordinario', 'Especial'];
  const CATEGORIAS_ESPECIAL = ['Hurto', 'Acoso', 'Canal de denuncias',
                               'Conflicto de interes', 'Fraude interno', 'Otro'];
  const ESTADOS_HALLAZGO = ['Pendiente', 'En proceso', 'Cumplido'];

  /** Normaliza la lista de hallazgos que llega del formulario de informe.
   *  Descarta los vacios (un hallazgo sin texto no es un hallazgo) y recorta
   *  cada campo. Devuelve filas listas para insertar. */
  function normalizarHallazgos(lista) {
    if (!Array.isArray(lista)) return [];
    return lista
      .map(h => ({
        hallazgo:         String(h.hallazgo || '').trim(),
        riesgo:           String(h.riesgo || '').trim() || null,
        recomendacion:    String(h.recomendacion || '').trim() || null,
        plan_accion:      String(h.plan_accion || '').trim() || null,
        responsable_id:   h.responsable_id ? Number(h.responsable_id) : null,
        area_responsable: String(h.area_responsable || '').trim().slice(0, 200) || null,
        fecha_compromiso: h.fecha_compromiso || null,
        estado:           ESTADOS_HALLAZGO.includes(h.estado) ? h.estado : 'Pendiente',
      }))
      .filter(h => h.hallazgo);
  }

  /** Inserta los hallazgos de una tarea dentro de una transaccion ya abierta. */
  async function guardarHallazgos(cx, tareaId, hallazgos) {
    for (let i = 0; i < hallazgos.length; i++) {
      const h = hallazgos[i];
      await cx.query(
        `INSERT INTO tarea_hallazgos (tarea_id, orden, hallazgo, riesgo, recomendacion,
            plan_accion, responsable_id, area_responsable, fecha_compromiso, estado)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [tareaId, i, h.hallazgo, h.riesgo, h.recomendacion, h.plan_accion,
         h.responsable_id, h.area_responsable, h.fecha_compromiso, h.estado]);
    }
  }

  const SELECT_TAREA = `
    SELECT t.*, u.nombre AS responsable_nombre, r.codigo AS riesgo_codigo,
           c.descripcion AS control_descripcion,
           (SELECT COUNT(*) FROM tarea_traspasos x
             WHERE x.tarea_id = t.id AND x.cambio_responsable = 1) AS traspasos,
           (SELECT COUNT(*) FROM tarea_hallazgos h WHERE h.tarea_id = t.id) AS hallazgos_count
      FROM tareas t
      LEFT JOIN usuarios  u ON u.id = t.responsable_id
      LEFT JOIN riesgos   r ON r.id = t.riesgo_id
      LEFT JOIN controles c ON c.id = t.control_id`;

  if (rec[0] === 'tareas' && rec[1] === 'metricas' && metodo === 'GET') {
    const s = await exigir(req, res, 'tareas.metricas'); if (!s) return;

    const [[resolucion]] = await DB.query(
      `SELECT COUNT(*) AS completadas,
              AVG(TIMESTAMPDIFF(SECOND, created_at, completada_en)) AS promedio_seg,
              MIN(TIMESTAMPDIFF(SECOND, created_at, completada_en)) AS minimo_seg,
              MAX(TIMESTAMPDIFF(SECOND, created_at, completada_en)) AS maximo_seg
         FROM tareas WHERE completada_en IS NOT NULL`);

    // Cuanto dura cada etapa: el promedio de las fases que terminaron en ella.
    const [porFase] = await DB.query(
      `SELECT estado_desde AS fase, COUNT(*) AS veces,
              AVG(duracion_segundos) AS promedio_seg,
              MAX(duracion_segundos) AS maximo_seg
         FROM tarea_traspasos
        WHERE estado_desde IS NOT NULL AND duracion_segundos IS NOT NULL
        GROUP BY estado_desde`);

    // Cuanto tiempo retuvo cada persona el trabajo antes de soltarlo.
    const [porResponsable] = await DB.query(
      `SELECT u.id, u.nombre, COUNT(*) AS tramos,
              AVG(tt.duracion_segundos) AS promedio_seg,
              SUM(tt.duracion_segundos) AS total_seg
         FROM tarea_traspasos tt JOIN usuarios u ON u.id = tt.responsable_desde_id
        WHERE tt.duracion_segundos IS NOT NULL
        GROUP BY u.id ORDER BY total_seg DESC`);

    const [[traspasos]] = await DB.query(
      `SELECT COALESCE(AVG(n),0) AS promedio_por_tarea, COALESCE(MAX(n),0) AS maximo
         FROM (SELECT COUNT(*) AS n FROM tarea_traspasos
                WHERE cambio_responsable = 1 GROUP BY tarea_id) x`);

    const [[agenda]] = await DB.query(
      `SELECT COUNT(*) AS total,
              SUM(estado IN ('Pendiente','En proceso','En revision')) AS abiertas,
              SUM(estado NOT IN ('Completada','Cancelada')
                  AND COALESCE(fecha_limite, fecha_programada) < CURDATE()) AS vencidas,
              SUM(estado = 'Completada') AS completadas
         FROM tareas`);

    return json(res, { resolucion, porFase, porResponsable, traspasos, agenda,
                       estados: ESTADOS_TAREA });
  }

  /** Condicion que oculta los casos confidenciales a quien no debe verlos.
   *  Un caso de hurto o acoso no es trabajo de rutina: sale de la lista salvo
   *  para el cargo con el permiso, la persona responsable (sin verlo no podria
   *  trabajarlo) y quien lo registro, que ya conoce lo que escribio. */
  const VE_CASO = '(t.confidencial = 0 OR t.responsable_id = ? OR t.creado_por = ?)';

  function filtroConfidencial(s, args) {
    if (s.permisos.includes('tareas.confidencial')) return null;
    args.push(s.id, s.id);
    return VE_CASO;
  }

  /** La misma regla, aplicada a una tarea ya leida de la base. */
  const veCaso = (s, t) =>
    !t.confidencial || s.permisos.includes('tareas.confidencial')
    || Number(t.responsable_id) === Number(s.id)
    || Number(t.creado_por) === Number(s.id);

  if (rec[0] === 'tareas' && rec.length === 1 && metodo === 'GET') {
    const s = await exigir(req, res, 'tareas.ver'); if (!s) return;
    const cond = [], args = [];
    const velo = filtroConfidencial(s, args);
    if (velo) cond.push(velo);
    if (q.get('desde')) { cond.push('t.fecha_programada >= ?'); args.push(q.get('desde')); }
    if (q.get('hasta')) { cond.push('t.fecha_programada <= ?'); args.push(q.get('hasta')); }
    if (q.get('estado')) { cond.push('t.estado = ?'); args.push(q.get('estado')); }
    if (q.get('responsable')) { cond.push('t.responsable_id = ?'); args.push(q.get('responsable')); }
    if (q.get('tipo')) { cond.push('t.tipo = ?'); args.push(q.get('tipo')); }
    // Historial de un riesgo: todas sus tareas, en cualquier estado.
    if (q.get('riesgo')) { cond.push('t.riesgo_id = ?'); args.push(q.get('riesgo')); }
    const where = cond.length ? ` WHERE ${cond.join(' AND ')}` : '';
    const [filas] = await DB.query(
      `${SELECT_TAREA}${where} ORDER BY t.fecha_programada, t.prioridad DESC, t.id`, args);
    return json(res, filas);
  }

  if (rec[0] === 'tareas' && rec.length === 2 && metodo === 'GET') {
    const s = await exigir(req, res, 'tareas.ver'); if (!s) return;
    const [[t]] = await DB.query(`${SELECT_TAREA} WHERE t.id = ?`, [rec[1]]);
    if (!t) return err(res, 'Tarea no encontrada', 404);
    // Ocultarla de la lista no alcanza: tambien hay que negar el acceso directo
    // por id, o bastaria con adivinar el numero para leer el caso.
    if (!veCaso(s, t)) return err(res, 'Este caso es confidencial', 403);
    const [traspasos] = await DB.query(
      `SELECT tt.*, ud.nombre AS responsable_desde, uh.nombre AS responsable_hasta,
              uq.nombre AS usuario_nombre
         FROM tarea_traspasos tt
         LEFT JOIN usuarios ud ON ud.id = tt.responsable_desde_id
         LEFT JOIN usuarios uh ON uh.id = tt.responsable_hasta_id
         LEFT JOIN usuarios uq ON uq.id = tt.usuario_id
        WHERE tt.tarea_id = ? ORDER BY tt.id`, [rec[1]]);
    const [hallazgos] = await DB.query(
      `SELECT h.*, u.nombre AS responsable_nombre
         FROM tarea_hallazgos h LEFT JOIN usuarios u ON u.id = h.responsable_id
        WHERE h.tarea_id = ? ORDER BY h.orden, h.id`, [rec[1]]);
    return json(res, { ...t, traspasos, hallazgos });
  }

  if (rec[0] === 'tareas' && rec.length === 1 && metodo === 'POST') {
    const s = await exigir(req, res, 'tareas.crear'); if (!s) return;
    const b = await body(req);
    if (!String(b.titulo || '').trim()) return err(res, 'El titulo es obligatorio', 400);
    if (!b.fecha_programada) return err(res, 'La fecha programada es obligatoria', 400);
    if (b.fecha_limite && b.fecha_limite < b.fecha_programada)
      return err(res, 'La fecha limite no puede ser anterior a la programada', 400);

    const tipo = TIPOS_TAREA.includes(b.tipo) ? b.tipo : 'Tarea programada';
    const esEspecial = tipo === 'Especial';
    if (esEspecial && !CATEGORIAS_ESPECIAL.includes(b.categoria_especial))
      return err(res, 'Un caso Especial necesita indicar de que se trata', 400);
    // Las Especiales nacen confidenciales. Se puede desmarcar a proposito, pero
    // el que se olvida de marcarla no expone un caso de acoso o de denuncia.
    const confidencial = b.confidencial === undefined ? esEspecial : Boolean(b.confidencial);

    const cx = await DB.getConnection();
    try {
      await cx.beginTransaction();
      const hallazgos = normalizarHallazgos(b.hallazgos);
      const [r] = await cx.query(
        `INSERT INTO tareas (codigo, titulo, descripcion, antecedentes, desarrollo, area_auditada,
            tipo, categoria_especial, confidencial, riesgo_id, control_id,
            fecha_programada, fecha_limite, prioridad, estado, responsable_id, creado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Pendiente',?,?)`,
        [b.codigo || `T-${Date.now().toString().slice(-8)}`, b.titulo, b.descripcion || null,
         b.antecedentes || null, b.desarrollo || null, b.area_auditada || null,
         tipo, esEspecial ? b.categoria_especial : null, confidencial ? 1 : 0,
         b.riesgo_id || null, b.control_id || null,
         b.fecha_programada, b.fecha_limite || null, b.prioridad || 'Media',
         b.responsable_id || null, s.id]);
      await guardarHallazgos(cx, r.insertId, hallazgos);
      // Primer traspaso: deja el punto de partida del que se miden las fases.
      await cx.query(
        `INSERT INTO tarea_traspasos (tarea_id, estado_desde, estado_hasta,
            responsable_hasta_id, cambio_estado, cambio_responsable, usuario_id, nota)
         VALUES (?, NULL, 'Pendiente', ?, 1, ?, ?, 'Alta de la tarea')`,
        [r.insertId, b.responsable_id || null, b.responsable_id ? 1 : 0, s.id]);
      await cx.commit();
      await auditar('tarea_creada', { entidad: 'tarea', entidadId: r.insertId, s, req,
                                      detalle: { titulo: b.titulo } });
      emitir('tareas', { accion: 'alta', id: r.insertId });
      return json(res, { id: r.insertId }, 201);
    } catch (e) {
      await cx.rollback();
      if (e.code === 'ER_DUP_ENTRY') return err(res, 'Ya existe una tarea con ese codigo', 409);
      throw e;
    } finally { cx.release(); }
  }

  if (rec[0] === 'tareas' && rec.length === 2 && metodo === 'PUT') {
    const s = await exigir(req, res, 'tareas.editar'); if (!s) return;
    const b = await body(req);
    if (b.fecha_limite && b.fecha_limite < b.fecha_programada)
      return err(res, 'La fecha limite no puede ser anterior a la programada', 400);

    const [[previa]] = await DB.query(
      `SELECT tipo, categoria_especial, confidencial, responsable_id, creado_por
         FROM tareas WHERE id=?`, [rec[1]]);
    if (!previa) return err(res, 'Tarea no encontrada', 404);
    // Editar un caso confidencial es leerlo primero: la misma regla que para verlo.
    if (!veCaso(s, previa)) return err(res, 'Este caso es confidencial', 403);

    const tipo = TIPOS_TAREA.includes(b.tipo) ? b.tipo : previa.tipo;
    const esEspecial = tipo === 'Especial';
    // Una edicion que no manda la categoria no la esta cambiando: se conserva
    // la que tenia, y solo se exige elegir una cuando todavia no hay ninguna.
    const categoria = b.categoria_especial === undefined
      ? previa.categoria_especial : b.categoria_especial;
    if (esEspecial && !CATEGORIAS_ESPECIAL.includes(categoria))
      return err(res, 'Un caso Especial necesita indicar de que se trata', 400);
    // Quitar la confidencialidad es una decision explicita, no un descuido del formulario.
    const confidencial = b.confidencial === undefined
      ? Boolean(previa.confidencial) : Boolean(b.confidencial);

    const hallazgos = normalizarHallazgos(b.hallazgos);
    const cx = await DB.getConnection();
    try {
      await cx.beginTransaction();
      await cx.query(
        `UPDATE tareas SET titulo=?, descripcion=?, antecedentes=?, desarrollo=?, area_auditada=?,
                tipo=?, categoria_especial=?, confidencial=?, riesgo_id=?, control_id=?,
                fecha_programada=?, fecha_limite=?, prioridad=? WHERE id=?`,
        [b.titulo, b.descripcion || null, b.antecedentes || null, b.desarrollo || null, b.area_auditada || null,
         tipo, esEspecial ? categoria : null, confidencial ? 1 : 0,
         b.riesgo_id || null, b.control_id || null, b.fecha_programada,
         b.fecha_limite || null, b.prioridad || 'Media', rec[1]]);
      // Los hallazgos se reemplazan en bloque: el formulario siempre manda la
      // lista completa, asi que borrar y volver a insertar es lo mas simple y
      // no deja huerfanos ni duplicados.
      if (b.hallazgos !== undefined) {
        await cx.query('DELETE FROM tarea_hallazgos WHERE tarea_id=?', [rec[1]]);
        await guardarHallazgos(cx, Number(rec[1]), hallazgos);
      }
      await cx.commit();
    } catch (e) {
      await cx.rollback();
      if (e.code === 'ER_DUP_ENTRY') return err(res, 'Ya existe una tarea con ese codigo', 409);
      throw e;
    } finally { cx.release(); }
    await auditar('tarea_editada', { entidad: 'tarea', entidadId: Number(rec[1]), s, req });
    emitir('tareas', { accion: 'edicion', id: Number(rec[1]) });
    return json(res, { ok: true });
  }

  // El cambio de estado o de responsable es lo que cierra una fase y abre otra.
  if (rec[0] === 'tareas' && rec.length === 3 && rec[2] === 'avanzar' && metodo === 'POST') {
    const s = await exigir(req, res, 'tareas.avanzar'); if (!s) return;
    const b = await body(req);
    const [[t]] = await DB.query(
      `SELECT estado, responsable_id, created_at, iniciada_en, confidencial, creado_por
         FROM tareas WHERE id=?`, [rec[1]]);
    if (!t) return err(res, 'Tarea no encontrada', 404);
    // No se puede mover un caso que no se puede leer.
    if (!veCaso(s, t)) return err(res, 'Este caso es confidencial', 403);

    const estadoNuevo = b.estado || t.estado;
    const respNuevo = b.responsable_id === undefined
      ? t.responsable_id : (b.responsable_id || null);
    if (!ESTADOS_TAREA.includes(estadoNuevo)) return err(res, 'Estado invalido', 400);

    const cambioEstado = estadoNuevo !== t.estado;
    const cambioResp = Number(respNuevo || 0) !== Number(t.responsable_id || 0);
    if (!cambioEstado && !cambioResp)
      return err(res, 'No hay ningun cambio que registrar', 400);

    // La fase que termina arranco en el ultimo traspaso, o en el alta.
    const [[ultimo]] = await DB.query(
      'SELECT created_at FROM tarea_traspasos WHERE tarea_id=? ORDER BY id DESC LIMIT 1', [rec[1]]);
    const desde = new Date(String(ultimo?.created_at || t.created_at).replace(' ', 'T'));
    const duracion = Math.max(0, Math.round((Date.now() - desde.getTime()) / 1000));

    const cx = await DB.getConnection();
    try {
      await cx.beginTransaction();
      await cx.query(
        `INSERT INTO tarea_traspasos (tarea_id, estado_desde, estado_hasta,
            responsable_desde_id, responsable_hasta_id, cambio_estado, cambio_responsable,
            duracion_segundos, nota, usuario_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [rec[1], t.estado, estadoNuevo, t.responsable_id, respNuevo,
         cambioEstado ? 1 : 0, cambioResp ? 1 : 0, duracion, b.nota || null, s.id]);

      await cx.query(
        `UPDATE tareas SET estado=?, responsable_id=?,
                iniciada_en = COALESCE(iniciada_en, CASE WHEN ? = 'En proceso' THEN NOW() END),
                completada_en = CASE WHEN ? = 'Completada' THEN NOW() ELSE NULL END
           WHERE id=?`,
        [estadoNuevo, respNuevo, estadoNuevo, estadoNuevo, rec[1]]);
      await cx.commit();
    } catch (e) { await cx.rollback(); throw e; }
    finally { cx.release(); }

    await auditar('tarea_avanzada', { entidad: 'tarea', entidadId: Number(rec[1]), s, req,
      detalle: { de: t.estado, a: estadoNuevo, cambioResp, duracion } });
    emitir('tareas', { accion: 'avance', id: Number(rec[1]), estado: estadoNuevo });
    return json(res, { ok: true, duracion_segundos: duracion });
  }

  if (rec[0] === 'tareas' && rec.length === 2 && metodo === 'DELETE') {
    const s = await exigir(req, res, 'tareas.eliminar'); if (!s) return;
    const [[previa]] = await DB.query(
      'SELECT confidencial, responsable_id, creado_por FROM tareas WHERE id=?', [rec[1]]);
    if (previa && !veCaso(s, previa)) return err(res, 'Este caso es confidencial', 403);
    await DB.query('DELETE FROM tareas WHERE id=?', [rec[1]]);
    await auditar('tarea_eliminada', { entidad: 'tarea', entidadId: Number(rec[1]), s, req });
    emitir('tareas', { accion: 'baja', id: Number(rec[1]) });
    return json(res, { ok: true });
  }

  return err(res, 'Ruta no encontrada', 404);
}

// ── Archivos estaticos ──────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function estatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/Login.html';
  const destino = path.join(ROOT, rel);
  // Impide salir de public/ con '..' en la ruta.
  if (!destino.startsWith(ROOT)) { res.writeHead(403); return res.end('Prohibido'); }
  fs.readFile(destino, (e, data) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(destino).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Servidor ────────────────────────────────────────────────────────────────
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (url.pathname === '/api/eventos') return sseHandler(req, res);

  if (url.pathname.startsWith('/api/')) {
    try { return await api(req, res, url); }
    catch (e) {
      console.error(`${req.method} ${url.pathname}:`, e);
      // El detalle queda en el log del servidor, no viaja al navegador.
      return err(res, 'Error interno del servidor', 500);
    }
  }
  return estatico(req, res, url);
});

servidor.listen(PORT, async () => {
  try {
    const [[r]] = await DB.query('SELECT COUNT(*) AS n FROM usuarios');
    console.log(`\n  Matriz MDP  ->  http://localhost:${PORT}`);
    if (!r.n) console.log('  Todavia no hay usuarios. Cree el primero con:  npm run crear-admin\n');
    else console.log(`  ${r.n} usuario(s) registrados.\n`);
  } catch (e) {
    console.error(`\n  Servidor arriba en ${PORT}, pero la base no responde: ${e.message}`);
    console.error('  Revise .env y que la base exista (npm run init-db).\n');
  }
});
