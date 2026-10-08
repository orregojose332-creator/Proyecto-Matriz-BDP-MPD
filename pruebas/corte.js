const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const BASE = 'http://localhost:3100';
const esperar = ms => new Promise(r => setTimeout(r, ms));

const vivo = async () => {
  try { const r = await fetch(BASE + '/Login.html'); return r.ok; } catch { return false; }
};
async function esperarServidor(arriba, limite = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < limite) {
    if (await vivo() === arriba) return true;
    await esperar(250);
  }
  return false;
}

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();

  await p.goto(BASE + '/Login.html');
  await p.fill('#usuario', 'analista'); await p.fill('#clave', 'ClaveAnalista123');
  await Promise.all([p.waitForURL('**/Reportes.html'), p.click('#btn')]);
  await p.goto(BASE + '/Matriz.html');
  await p.waitForSelector('tbody tr[data-id]');
  await p.waitForFunction(() => document.querySelector('.vivo')?.dataset.estado === 'conectado');

  const filas = () => p.evaluate(() => document.querySelectorAll('tbody tr[data-id]').length);
  const antes = await filas();
  console.log(`  B (analista) mira la matriz: ${antes} riesgos · "${await p.textContent('.vivo .txt')}"`);

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'ClaveDePrueba123' }) })).json();
  const t = login.token;

  console.log('\n  Se reinicia el servidor: corta todas las conexiones en vivo.');
  execSync("pkill -f 'node [s]erver.js' || true", { shell: '/bin/bash' });
  await esperarServidor(false);
  await esperar(600);
  console.log(`  B detecta el corte: "${await p.textContent('.vivo .txt')}"`);

  const hijo = spawn('node', ['server.js'], {
    cwd: '/home/user/matriz-mdp', detached: true, stdio: 'ignore' });
  hijo.unref();
  if (!await esperarServidor(true)) throw new Error('el servidor no volvió a levantar');
  console.log('  Servidor arriba de nuevo.');

  // Cargar ANTES de que B reconecte (EventSource reintenta a los 3 s)
  const cat = await (await fetch(BASE + '/api/catalogos',
    { headers: { Authorization: 'Bearer ' + t } })).json();
  const alta = await fetch(BASE + '/api/riesgos', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: JSON.stringify({ evaluacion_id: cat.evaluaciones[0].id,
      codigo: 'GAP-' + Date.now().toString().slice(-6), factor_id: cat.factores[1].id,
      descripcion: 'Cargado mientras B estaba desconectado',
      probabilidad: 5, impacto: 5, fecha_identificacion: '2026-10-07' }) });
  console.log(`  A carga un riesgo mientras B sigue caído (HTTP ${alta.status}).`);
  console.log('  Ese evento B NO lo recibe: el flujo no guarda historial.');

  const ok = await p.waitForFunction(n => document.querySelectorAll('tbody tr[data-id]').length !== n,
    antes, { timeout: 25000 }).then(() => true).catch(() => false);
  await esperar(400);
  console.log(`\n  Resultado: ${antes} -> ${await filas()} filas · "${await p.textContent('.vivo .txt')}"`);
  console.log(ok
    ? '  CORRECTO: al reconectar, B se resincroniza solo y recupera lo perdido.'
    : '  FALLA: B quedó desactualizado después de reconectar.');
  await p.screenshot({ path: 'corte-recuperado.png' });
  await nav.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
