const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';

const entrar = async (nav, usuario, clave, pagina) => {
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/Login.html');
  await p.fill('#usuario', usuario); await p.fill('#clave', clave);
  await Promise.all([p.waitForURL('**/Reportes.html'), p.click('#btn')]);
  if (pagina && pagina !== 'Reportes.html') {
    await p.goto(BASE + '/' + pagina);
  }
  await p.waitForSelector('.lateral a', { timeout: 15000 });
  await p.waitForFunction(() => document.querySelector('.vivo')?.dataset.estado === 'conectado',
    { timeout: 15000 });
  return { ctx, p };
};

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  console.log('\n=== ESCENARIO 1: dos usuarios en el TABLERO ===');

  const A = await entrar(nav, 'admin', 'ClaveDePrueba123', 'Reportes.html');
  const B = await entrar(nav, 'analista', 'ClaveAnalista123', 'Reportes.html');
  console.log('  A = admin (Administrador), B = analista (Analista). Ambos en vivo.');

  await A.p.waitForSelector('.kpi .valor');
  await B.p.waitForSelector('.kpi .valor');
  const leerTotal = p => p.evaluate(() => document.querySelector('.kpi .valor')?.textContent.trim());
  const antes = await leerTotal(B.p);
  console.log(`  B ve "Riesgos registrados" = ${antes}`);

  // B empieza a cronometrar ANTES de que A haga nada
  const esperaB = B.p.evaluate(valorPrevio => {
    const t0 = performance.now();
    return new Promise(res => {
      const obs = new MutationObserver(() => {
        const v = document.querySelector('.kpi .valor')?.textContent.trim();
        if (v && v !== valorPrevio) { obs.disconnect(); res({ ms: Math.round(performance.now() - t0), v }); }
      });
      obs.observe(document.querySelector('main'), { childList: true, subtree: true, characterData: true });
      setTimeout(() => { obs.disconnect(); res({ ms: -1, v: null }); }, 10000);
    });
  }, antes);

  await new Promise(r => setTimeout(r, 300));

  // A carga un riesgo usando la propia API del sistema, con su sesión real
  await A.p.evaluate(async () => {
    const cat = await MDP.api('/catalogos');
    await MDP.api('/riesgos', { method: 'POST', cuerpo: {
      evaluacion_id: cat.evaluaciones[0].id,
      codigo: 'LIVE-' + Date.now().toString().slice(-6),
      factor_id: cat.factores[0].id,
      descripcion: 'Riesgo cargado por el administrador durante la prueba en vivo',
      probabilidad: 5, impacto: 4,
      fecha_identificacion: new Date().toISOString().slice(0, 10) } });
  });
  console.log('  A carga un riesgo nuevo (sin tocar la pantalla de B)');

  const r1 = await esperaB;
  console.log(r1.ms >= 0
    ? `  B pasa de ${antes} a ${r1.v} en ${r1.ms} ms, SIN refrescar`
    : '  FALLA: B no se actualizó en 10 s');

  console.log('\n=== ESCENARIO 2: B mirando la MATRIZ mientras A aprueba ===');
  await B.p.goto(BASE + '/Matriz.html');
  await B.p.waitForSelector('tbody tr[data-id]');
  await B.p.waitForFunction(() => document.querySelector('.vivo')?.dataset.estado === 'conectado');
  const filasAntes = await B.p.evaluate(() => document.querySelectorAll('tbody tr[data-id]').length);
  console.log(`  B ve ${filasAntes} riesgos en la matriz`);

  const esperaB2 = B.p.evaluate(n => {
    const t0 = performance.now();
    return new Promise(res => {
      const obs = new MutationObserver(() => {
        const c = document.querySelectorAll('tbody tr[data-id]').length;
        if (c !== n) { obs.disconnect(); res({ ms: Math.round(performance.now() - t0), c }); }
      });
      obs.observe(document.querySelector('#tabla'), { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); res({ ms: -1 }); }, 10000);
    });
  }, filasAntes);

  await new Promise(r => setTimeout(r, 300));
  await A.p.evaluate(async () => {
    const cat = await MDP.api('/catalogos');
    await MDP.api('/riesgos', { method: 'POST', cuerpo: {
      evaluacion_id: cat.evaluaciones[0].id,
      codigo: 'LIVE2-' + Date.now().toString().slice(-6),
      factor_id: cat.factores[2].id,
      descripcion: 'Segundo riesgo de prueba, mientras B mira la matriz',
      probabilidad: 3, impacto: 3,
      fecha_identificacion: new Date().toISOString().slice(0, 10) } });
  });
  const r2 = await esperaB2;
  console.log(r2.ms >= 0
    ? `  La tabla de B pasa de ${filasAntes} a ${r2.c} filas en ${r2.ms} ms, SIN refrescar`
    : '  FALLA: la matriz de B no se actualizó');

  await nav.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
