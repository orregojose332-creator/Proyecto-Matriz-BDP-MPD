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

  console.log('\n--- "+ TAREA" ABRE UN MODAL CON EL INFORME ---');
  const idRiesgo = Number(await ficha.getAttribute('data-id'));
  await ficha.locator('button[data-tarea]').click();
  await p.waitForSelector('.modal-velo.visible', { timeout: 10000 });
  const fr = p.frameLocator('.modal-frame');
  await fr.locator('#f-titulo').waitFor({ timeout: 10000 });
  ok(await p.locator('.modal-velo').count() === 1, '+ Tarea abre un modal superpuesto');
  ok((await fr.locator('#f-titulo').inputValue()).length > 0, 'el titulo viene precargado desde el riesgo');

  const tipos = await fr.locator('#f-tipo option').allTextContents();
  ok(tipos.join('/') === 'Tarea programada/Control extraordinario',
     `los dos tipos nuevos estan en el selector: ${tipos.join(' / ')}`);

  ok(await fr.locator('.hallazgo').count() === 1, 'arranca con un hallazgo en blanco');
  const titulo = 'Informe de prueba UI ' + Date.now().toString().slice(-6);
  await fr.locator('#f-titulo').fill(titulo);
  await fr.locator('#f-tipo').selectOption('Control extraordinario');
  await fr.locator('#f-area').fill('Caja - Sucursal Centro');
  await fr.locator('#f-antec').fill('Observacion previa de faltantes');
  await fr.locator('.hallazgo [data-h="hallazgo"]').fill('Arqueos sin doble firma');
  await fr.locator('.hallazgo [data-h="riesgo"]').fill('Faltantes no detectados a tiempo');
  await fr.locator('.hallazgo [data-h="recomendacion"]').fill('Implementar doble firma diaria');
  await fr.locator('.hallazgo [data-h="plan_accion"]').fill('Se instruye doble firma desde noviembre');
  await fr.locator('.hallazgo [data-h="area_responsable"]').fill('Tesoreria');

  await fr.locator('#btn-hallazgo').click();
  ok(await fr.locator('.hallazgo').count() === 2, '"+ Agregar hallazgo" suma otra ficha');
  await fr.locator('.hallazgo:nth-child(2) [data-h="hallazgo"]').fill('Camaras sin retencion de 90 dias');

  console.log('\n--- GUARDAR CIERRA EL MODAL Y NOTIFICA ---');
  await fr.locator('#btn-guardar').click();
  await p.waitForSelector('.modal-velo', { state: 'detached', timeout: 10000 });
  ok(true, 'al guardar, el modal se cierra solo');
  await p.waitForSelector('.toast.ok', { timeout: 6000 });
  ok(/creada correctamente/i.test(await p.locator('.toast.ok .txt').first().textContent()),
     'aparece el toast "Tarea creada correctamente" arriba a la derecha');

  const frR = p.locator(`.ficha[data-id="${idRiesgo}"]`);
  await p.waitForSelector(`.ficha[data-id="${idRiesgo}"] .hist-item`, { timeout: 8000 });
  const item = frR.locator('.hist-item', { hasText: titulo });
  ok(await item.count() === 1, 'la tarea aparece en el historial del riesgo');
  // El conteo de hallazgos se muestra (text-transform lo pone en mayuscula).
  ok(/2 HALLAZGO/i.test(await item.innerText()), 'muestra "2 hallazgo(s)"');
  ok(/CONTROL EXTRAORDINARIO/i.test(await item.innerText()), 'y el tipo elegido');

  console.log('\n--- ABRIR EL INFORME EN EL MODAL ---');
  await item.locator('a.hist-titulo').click();
  await p.waitForSelector('.modal-velo.visible', { timeout: 10000 });
  const fr2 = p.frameLocator('.modal-frame');
  await fr2.locator('.hallazgo').first().waitFor();
  ok(await fr2.locator('.hallazgo').count() === 2, 'el modal abre la tarea con sus 2 hallazgos');
  ok(await fr2.locator('#f-area').inputValue() === 'Caja - Sucursal Centro', 'el area auditada se guardo');
  ok(await fr2.locator('.hallazgo').first().locator('[data-h="area_responsable"]').inputValue() === 'Tesoreria',
     'el area responsable del hallazgo se guardo');
  await p.locator('.modal-x').click();
  await p.waitForSelector('.modal-velo', { state: 'detached', timeout: 6000 });
  const idTarea = await p.evaluate(async t => {
    const cab = { Authorization: 'Bearer ' + localStorage.getItem('mdp_token') };
    const todas = await (await fetch('/api/tareas', { headers: cab })).json();
    return (todas.find(x => x.titulo === t) || {}).id;
  }, titulo);

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
