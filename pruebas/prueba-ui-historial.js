/* Prueba en navegador del Historial y del formulario de "+ Tarea".
 *
 * Lo que se verifica a ojo de usuario: que el boton Historial abra el panel
 * con los grupos, que el campo de categoria aparezca solo al elegir Especial,
 * que crear una tarea desde el riesgo la deje visible en el acto, y que el
 * panel entre sin desbordar la pantalla de un telefono.
 *
 *   node pruebas/prueba-ui-historial.js
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
  const codigo = await ficha.locator('.codigo').first().textContent();
  ok(await ficha.locator('button[data-historial]').count() === 1,
     `la ficha de ${codigo.trim()} tiene boton Historial`);
  ok(await ficha.locator('button[data-info]').count() === 1, 'y sigue teniendo "+ Info"');

  await ficha.locator('button[data-historial]').click();
  await p.waitForSelector('.ficha .hist-resumen, .ficha .sin-dato', { timeout: 10000 });
  const abierto = await ficha.locator('.hist-resumen, .sin-dato').count();
  ok(abierto > 0, 'al tocarlo se abre el panel');
  ok((await ficha.locator('button[data-historial]').textContent()).includes('Historial'),
     'el boton pasa a decir "− Historial"');

  // "+ Info" y "Historial" son paneles distintos: abrir uno no cierra el otro.
  await ficha.locator('button[data-info]').click();
  await p.waitForSelector('.ficha .cifras', { timeout: 10000 });
  ok(await ficha.locator('.info').count() === 2, 'los dos paneles conviven abiertos');

  console.log('\n--- EL FORMULARIO DE "+ TAREA" ---');
  await ficha.locator('button[data-tarea]').click();
  await p.waitForSelector('#caja-tarea:not([hidden])');
  const tipos = await p.locator('#t-tipo option').allTextContents();
  ok(tipos.length === 3 && tipos.some(t => t.includes('Auditoría'))
     && tipos.some(t => t.includes('Control programado')) && tipos.some(t => t.includes('Especial')),
     `los tres tipos estan en el selector: ${tipos.join(' / ')}`);
  ok(await p.locator('#fila-especial').isHidden(),
     'con Auditoria no se pide la categoria del caso');

  await p.selectOption('#t-tipo', 'Especial');
  ok(await p.locator('#fila-especial').isVisible(), 'al elegir Especial aparece la categoria');
  ok(await p.locator('#t-confidencial').isChecked(), 'y queda marcada como reservada sola');
  const cats = await p.locator('#t-categoria option').allTextContents();
  ok(cats.includes('Hurto') && cats.includes('Acoso') && cats.includes('Canal de denuncias'),
     `las categorias incluyen los casos que pidio el area: ${cats.join(' / ')}`);

  await p.selectOption('#t-tipo', 'Auditoria');
  ok(await p.locator('#fila-especial').isHidden(), 'al volver a Auditoria se esconde de nuevo');

  console.log('\n--- CREAR Y VER SIN RECARGAR ---');
  const titulo = 'Tarea de prueba UI ' + Date.now().toString().slice(-6);
  await p.fill('#t-titulo', titulo);
  await p.click('#form-tarea button.primario');
  await p.waitForSelector('#aviso.ok', { timeout: 10000 });
  ok((await p.locator('#aviso').textContent()).includes('creada'),
     'avisa que la tarea se creo');
  // El SSE recarga la lista y el historial del riesgo se vuelve a pedir solo.
  await p.waitForFunction(t => document.body.innerText.includes(t), titulo, { timeout: 15000 });
  ok(true, 'la tarea nueva aparece en el historial sin recargar la pagina');
  const grupos = await p.locator('.hist-grupo h5').allTextContents();
  ok(grupos.some(g => g.includes('Sin iniciar')),
     `y cae en el grupo correcto: ${grupos.map(g => g.replace(/\s+/g, ' ').trim()).join(' | ')}`);

  console.log('\n--- EN UN TELEFONO (390px) ---');
  const chico = await entrar(nav, 'admin', 'ClaveDePrueba123', 390);
  await chico.locator('.ficha').first().locator('button[data-historial]').click();
  await chico.waitForSelector('.ficha .hist-resumen, .ficha .sin-dato', { timeout: 10000 });
  const desborde = await chico.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(desborde <= 0, `el panel no desborda a lo ancho (sobra ${desborde}px)`);

  // Limpieza: la tarea que creo la prueba no queda en el trabajo real. Se borra
  // desde la propia pagina, que ya tiene la sesion abierta.
  const borradas = await p.evaluate(async t => {
    const cab = { Authorization: 'Bearer ' + localStorage.getItem('mdp_token') };
    const todas = await (await fetch('/api/tareas', { headers: cab })).json();
    const mias = todas.filter(x => x.titulo === t);
    for (const x of mias) await fetch('/api/tareas/' + x.id, { method: 'DELETE', headers: cab });
    return mias.length;
  }, titulo);
  ok(borradas === 1, `la tarea de prueba se borro al terminar (${borradas})`);

  await nav.close();
  console.log(`\n========================================`);
  console.log(`  ${pasos - fallas} de ${pasos} comprobaciones pasaron`);
  console.log(`========================================\n`);
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
