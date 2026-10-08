/* Prueba en navegador del Historial y de la pantalla de carga de tareas.
 *
 * Lo que se verifica a ojo de usuario: que el boton Historial abra el panel
 * con los grupos, que "+ Tarea" lleve a la pantalla del informe, que ahi se
 * pueda cargar una tarea con sus hallazgos, que al guardar vuelva al riesgo y
 * la tarea aparezca en el historial, y que el panel entre sin desbordar un
 * telefono.
 *
 *   node pruebas/prueba-ui-historial.js      (con el servidor en el 3100)
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
let fallas = 0, pasos = 0;
const ok = (c, t, x = '') => { pasos++; console.log(c ? `  OK   ${t}` : `  FALLA ${t} ${x}`); if (!c) fallas++; };

const entrar = async (nav, usuario, clave, ancho = 1280) => {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => { fallas++; console.log('  ERROR DE PAGINA:', e.message); });
  await p.goto(BASE + '/Login.html');
  await p.fill('#usuario', usuario); await p.fill('#clave', clave);
  await Promise.all([p.waitForURL('**/Reportes.html'), p.click('#btn')]);
  await p.goto(BASE + '/Riesgos.html');
  await p.waitForSelector('.ficha', { timeout: 15000 });
  return p;
};

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await entrar(nav, 'admin', 'ClaveDePrueba123');

  console.log('\n--- EL BOTON HISTORIAL ---');
  const ficha = p.locator('.ficha').first();
  const codigo = (await ficha.locator('.codigo').first().textContent()).trim();
  ok(await ficha.locator('button[data-historial]').count() === 1,
     `la ficha de ${codigo} tiene boton Historial`);
  ok(await ficha.locator('button[data-info]').count() === 1, 'y sigue teniendo "+ Info"');

  await ficha.locator('button[data-historial]').click();
  await p.waitForSelector('.ficha .hist-resumen, .ficha .sin-dato', { timeout: 10000 });
  ok(await ficha.locator('.hist-resumen, .sin-dato').count() > 0, 'al tocarlo se abre el panel');

  // "+ Info" y "Historial" son paneles distintos: abrir uno no cierra el otro.
  await ficha.locator('button[data-info]').click();
  await p.waitForSelector('.ficha .cifras', { timeout: 10000 });
  ok(await ficha.locator('.info').count() === 2, 'los dos paneles conviven abiertos');

  console.log('\n--- "+ TAREA" ABRE LA PANTALLA DEL INFORME ---');
  await ficha.locator('button[data-tarea]').click();
  await p.waitForURL('**/Tarea.html?riesgo=*', { timeout: 10000 });
  await p.waitForSelector('#f-titulo');
  const idRiesgo = Number(new URL(p.url()).searchParams.get('riesgo'));
  ok(p.url().includes('Tarea.html?riesgo='), '+ Tarea navega a la pantalla nueva');
  ok((await p.inputValue('#f-titulo')).length > 0, 'el titulo viene precargado desde el riesgo');

  const tipos = await p.locator('#f-tipo option').allTextContents();
  ok(tipos.join('/') === 'Tarea programada/Control extraordinario',
     `los dos tipos nuevos estan en el selector: ${tipos.join(' / ')}`);

  // El informe: cabecera + un hallazgo con su cadena completa.
  ok(await p.locator('.hallazgo').count() === 1, 'arranca con un hallazgo en blanco');
  const titulo = 'Informe de prueba UI ' + Date.now().toString().slice(-6);
  await p.fill('#f-titulo', titulo);
  await p.selectOption('#f-tipo', 'Control extraordinario');
  await p.fill('#f-area', 'Caja - Sucursal Centro');
  await p.fill('#f-antec', 'Observacion previa de faltantes');
  await p.fill('.hallazgo [data-h="hallazgo"]', 'Arqueos sin doble firma');
  await p.fill('.hallazgo [data-h="riesgo"]', 'Faltantes no detectados a tiempo');
  await p.fill('.hallazgo [data-h="recomendacion"]', 'Implementar doble firma diaria');
  await p.fill('.hallazgo [data-h="plan_accion"]', 'Se instruye doble firma desde noviembre');
  await p.fill('.hallazgo [data-h="area_responsable"]', 'Tesoreria');

  await p.click('#btn-hallazgo');
  ok(await p.locator('.hallazgo').count() === 2, '"+ Agregar hallazgo" suma otra ficha');
  await p.fill('.hallazgo:nth-child(2) [data-h="hallazgo"]', 'Camaras sin retencion de 90 dias');

  console.log('\n--- GUARDAR Y VER EN EL HISTORIAL ---');
  await p.click('#btn-guardar');
  await p.waitForURL('**/Riesgos.html', { timeout: 10000 });
  ok(true, 'al guardar vuelve a Riesgos');

  const fr = p.locator(`.ficha[data-id="${idRiesgo}"]`);
  await fr.locator('button[data-historial]').click();
  await p.waitForSelector('.hist-item', { timeout: 10000 });
  const item = fr.locator('.hist-item', { hasText: titulo });
  ok(await item.count() === 1, 'la tarea aparece en el historial del riesgo');
  // El conteo de hallazgos se muestra (text-transform lo pone en mayuscula).
  ok(/2 HALLAZGO/i.test(await item.innerText()), 'muestra "2 hallazgo(s)"');
  ok(/CONTROL EXTRAORDINARIO/i.test(await item.innerText()), 'y el tipo elegido');

  console.log('\n--- ABRIR EL INFORME GUARDADO ---');
  await item.locator('a.hist-titulo').click();
  await p.waitForURL('**/Tarea.html?id=*', { timeout: 10000 });
  await p.waitForSelector('.hallazgo');
  ok(await p.locator('.hallazgo').count() === 2, 'la tarea abre con sus 2 hallazgos');
  ok(await p.inputValue('#f-area') === 'Caja - Sucursal Centro', 'el area auditada se guardo');
  ok(await p.locator('.hallazgo').first().locator('[data-h="area_responsable"]').inputValue() === 'Tesoreria',
     'el area responsable del hallazgo se guardo');
  const idTarea = Number(new URL(p.url()).searchParams.get('id'));

  console.log('\n--- EN UN TELEFONO (390px) ---');
  const chico = await entrar(nav, 'admin', 'ClaveDePrueba123', 390);
  const fc = chico.locator('.ficha').first();
  await fc.locator('button[data-historial]').click();
  await chico.waitForSelector('.ficha .hist-resumen, .ficha .sin-dato', { timeout: 10000 });
  const desborde = await chico.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(desborde <= 0, `el historial no desborda a lo ancho (sobra ${desborde}px)`);

  // Limpieza: la tarea de prueba no queda en el trabajo real.
  const borrada = await p.evaluate(async id => {
    const cab = { Authorization: 'Bearer ' + localStorage.getItem('mdp_token') };
    const r = await fetch('/api/tareas/' + id, { method: 'DELETE', headers: cab });
    return r.ok;
  }, idTarea);
  ok(borrada, 'la tarea de prueba se borro al terminar');

  await nav.close();
  console.log(`\n========================================`);
  console.log(`  ${pasos - fallas} de ${pasos} comprobaciones pasaron`);
  console.log(`========================================\n`);
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
