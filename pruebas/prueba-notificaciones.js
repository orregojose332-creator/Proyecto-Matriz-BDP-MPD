/* Prueba en navegador de las notificaciones (toasts) arriba a la derecha.
 *
 * Verifica que el aviso ya no sea un cartel fijo sino un toast en la esquina
 * superior derecha, y que aparezca al cambiar una tarea de estado y al borrar
 * un riesgo. (El alta y la edicion por modal se prueban en prueba-ui-historial.)
 *
 *   node pruebas/prueba-notificaciones.js       (con el servidor en el 3100)
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
let fallas = 0, pasos = 0;
const ok = (c, t, x = '') => { pasos++; console.log(c ? `  OK   ${t}` : `  FALLA ${t} ${x}`); if (!c) fallas++; };

async function api(p, ruta, opt = {}) {
  return p.evaluate(async ([ruta, opt]) => {
    const cab = { 'Content-Type': 'application/json',
      Authorization: 'Bearer ' + localStorage.getItem('mdp_token') };
    const r = await fetch('/api' + ruta, { method: opt.metodo || 'GET', headers: cab,
      body: opt.cuerpo ? JSON.stringify(opt.cuerpo) : undefined });
    return { estado: r.status, datos: await r.json().catch(() => null) };
  }, [ruta, opt]);
}

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await (await nav.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', e => { fallas++; console.log('  ERROR DE PAGINA:', e.message); });
  await p.goto(BASE + '/Login.html');
  await p.fill('#usuario', 'admin'); await p.fill('#clave', 'ClaveDePrueba123');
  await Promise.all([p.waitForURL('**/Reportes.html'), p.click('#btn')]);

  console.log('\n--- CAMBIO DE ESTADO -> TOAST ---');
  // Crear una tarea de prueba para moverla de estado.
  const cat = (await api(p, '/catalogos')).datos;
  const r0 = (await api(p, '/riesgos')).datos[0];
  const nueva = await api(p, '/tareas', { metodo: 'POST', cuerpo: {
    titulo: 'Toast estado ' + Date.now().toString().slice(-6),
    tipo: 'Tarea programada', fecha_programada: new Date().toISOString().slice(0,10),
    riesgo_id: r0.id, responsable_id: cat.usuarios[0].id } });
  const idTarea = nueva.datos.id;

  await p.goto(BASE + '/Tareas.html');
  await p.waitForSelector('.item');
  const item = p.locator('.item', { hasText: 'Toast estado' }).first();
  await item.locator('button[data-avanzar]').click();
  await p.waitForSelector('form[data-avance]');
  await item.locator('select[name="estado"]').selectOption('En proceso');
  await item.locator('form[data-avance] button').first().click();

  await p.waitForSelector('.toast.ok', { timeout: 6000 });
  ok(/Cambio registrado/i.test(await p.locator('.toast.ok .txt').last().textContent()),
     'cambiar de estado muestra un toast');
  // Esta arriba a la derecha.
  const caja = await p.locator('.avisos').boundingBox();
  const vw = p.viewportSize().width;
  ok(caja && (caja.x + caja.width) > vw - 40 && caja.y < 140,
     `el toast esta arriba a la derecha (x≈${Math.round(caja.x)}, y≈${Math.round(caja.y)})`);
  // Ya no existe el cartel fijo #aviso visible.
  ok(!(await p.locator('#aviso:not([hidden])').count()), 'no queda el cartel fijo de antes');

  console.log('\n--- BORRAR UN RIESGO -> TOAST ---');
  // Riesgo desechable creado por API, borrado desde la Matriz.
  const sub = cat.subfactores.find(x => x.factor_id === cat.factores[0].id);
  const rd = await api(p, '/riesgos', { metodo: 'POST', cuerpo: {
    evaluacion_id: cat.evaluaciones[0].id, codigo: 'DEL-' + Date.now().toString().slice(-6),
    factor_id: cat.factores[0].id, subfactor_id: sub.id,
    descripcion: 'Riesgo desechable para probar el toast de borrado',
    probabilidad: 1, impacto: 1, fecha_identificacion: new Date().toISOString().slice(0,10) } });
  const idRiesgo = rd.datos.id;

  await p.goto(BASE + '/Matriz.html');
  await p.waitForSelector('tr[data-id]');
  p.once('dialog', d => d.accept());   // el confirm() de borrado
  await p.locator(`tr[data-id="${idRiesgo}"] button[data-accion="borrar"]`).click();
  await p.waitForSelector('.toast.ok', { timeout: 6000 });
  ok(/eliminado/i.test(await p.locator('.toast.ok .txt').last().textContent()),
     'borrar un riesgo muestra un toast');

  // Limpieza de la tarea (el riesgo ya se borro).
  await api(p, '/tareas/' + idTarea, { metodo: 'DELETE' });

  await nav.close();
  console.log(`\n========================================`);
  console.log(`  ${pasos - fallas} de ${pasos} comprobaciones pasaron`);
  console.log(`========================================\n`);
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
