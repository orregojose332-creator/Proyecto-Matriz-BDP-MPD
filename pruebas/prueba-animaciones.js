/* Prueba en navegador de las animaciones de apertura y cierre.
 *
 * Verifica que todo lo que se expande nazca y muera con el mismo gesto:
 *   - los paneles "+ Info" / "Historial" de un riesgo entran con .mdp-abrir y
 *     al cerrarse pasan por .mdp-cerrar antes de desaparecer;
 *   - el cuadro de edición de la Matriz se despliega y se contrae;
 *   - la ventana de la tarea se abre desde el cuadro del riesgo y, al cerrar,
 *     se contrae hacia ese mismo cuadro (transform con translate + scale).
 * También comprueba que ninguna página tire errores de JavaScript.
 *
 *   node pruebas/prueba-animaciones.js       (con el servidor en el 3100)
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
let fallas = 0, pasos = 0;
const ok = (c, t, x = '') => { pasos++; console.log(c ? `  OK   ${t}` : `  FALLA ${t} ${x}`); if (!c) fallas++; };
const esperar = ms => new Promise(r => setTimeout(r, ms));

const entrar = async (nav, usuario, clave) => {
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => { fallas++; console.log('  ERROR DE PAGINA:', e.message); });
  await p.goto(BASE + '/Login.html');
  await p.fill('#usuario', usuario); await p.fill('#clave', clave);
  await Promise.all([p.waitForURL('**/Reportes.html'), p.click('#btn')]);
  return p;
};

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await entrar(nav, 'admin', 'ClaveDePrueba123');

  // ─── Paneles de un riesgo ──────────────────────────────────────────────
  console.log('\n--- PANELES DE RIESGO (+ Info) ---');
  await p.goto(BASE + '/Riesgos.html');
  await p.waitForSelector('.ficha', { timeout: 15000 });
  const ficha = p.locator('.ficha').first();

  await ficha.locator('button[data-info]').click();
  await p.waitForSelector('.ficha .info[data-panel="info"]', { timeout: 10000 });
  ok(await ficha.locator('.info[data-panel="info"].mdp-abrir').count() === 1,
     'el panel "+ Info" entra con la animación de apertura (.mdp-abrir)');

  // Al cerrar debe pasar por .mdp-cerrar antes de irse del DOM.
  await ficha.locator('button[data-info]').click();
  // Capturar el estado intermedio: la clase de cierre aparece enseguida.
  await esperar(40);
  const enCierre = await ficha.locator('.info[data-panel="info"].mdp-cerrar').count();
  ok(enCierre === 1, 'al cerrarlo reproduce el gesto en reversa (.mdp-cerrar)');
  await esperar(260);
  ok(await ficha.locator('.info[data-panel="info"]').count() === 0,
     'y recién después el panel desaparece');

  // ─── Cuadro de edición de la Matriz ────────────────────────────────────
  console.log('\n--- CUADRO DE EDICIÓN (Matriz) ---');
  await p.goto(BASE + '/Matriz.html');
  await p.waitForSelector('#btn-nuevo', { timeout: 15000 });
  await p.click('#btn-nuevo');
  await esperar(60);
  ok(await p.locator('#caja-form:not([hidden])').count() === 1 &&
     await p.locator('#caja-form.mdp-abrir').count() === 1,
     'el cuadro "Nuevo riesgo" se despliega animado');
  await p.click('#btn-cancelar');
  await esperar(40);
  ok(await p.locator('#caja-form.mdp-cerrar').count() === 1, 'al cancelar se contrae animado');
  await esperar(260);
  ok(await p.locator('#caja-form[hidden]').count() === 1, 'y queda oculto al terminar');

  // ─── Ventana de tarea: nace y muere en el cuadro del riesgo ────────────
  console.log('\n--- VENTANA DE TAREA (modal) ---');
  await p.goto(BASE + '/Riesgos.html');
  await p.waitForSelector('.ficha', { timeout: 15000 });
  const f2 = p.locator('.ficha').first();
  await f2.locator('button[data-tarea]').click();
  await p.waitForSelector('.modal-velo.visible', { timeout: 10000 });
  await p.frameLocator('.modal-frame').locator('#f-titulo').waitFor({ timeout: 10000 });
  ok(true, 'la ventana se abre sobre la pantalla');

  // Cerrar con Escape y mirar el transform de contracción hacia el origen.
  await p.keyboard.press('Escape');
  await esperar(30);
  const tr = await p.locator('.modal-caja').evaluate(el => el.style.transform).catch(() => '');
  ok(/translate\(/.test(tr) && /scale\(/.test(tr),
     `al cerrar se contrae hacia el cuadro del riesgo (${tr || 'sin transform'})`);
  await esperar(360);
  ok(await p.locator('.modal-velo').count() === 0, 'y la ventana se quita al terminar la animación');

  console.log('\n========================================');
  console.log(`  ${pasos - fallas} de ${pasos} comprobaciones pasaron`);
  console.log('========================================');
  await nav.close();
  process.exit(fallas ? 1 : 0);
})();
