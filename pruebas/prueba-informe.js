/* Prueba de API del informe de auditoria/control dentro de una tarea.
 *
 * Verifica que una tarea guarde su cabecera (antecedentes, area auditada) y su
 * lista de hallazgos con la cadena completa (riesgo, recomendacion, plan de
 * accion, responsable y area), que los hallazgos vacios se descarten, que la
 * edicion reemplace la lista, y que el tipo sea texto validado.
 *
 *   node pruebas/prueba-informe.js        (con el servidor en el 3100)
 */
const BASE = 'http://localhost:3100/api';
let fallas = 0, pasos = 0;
const ok = (c, t, x = '') => { pasos++; console.log(c ? `  OK   ${t}` : `  FALLA ${t} ${x}`); if (!c) fallas++; };

async function llamar(ruta, { metodo = 'GET', cuerpo, token } = {}) {
  const r = await fetch(BASE + ruta, { method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { estado: r.status, datos: await r.json().catch(() => null) };
}
const entrar = async (u, p) => (await llamar('/auth/login', { metodo: 'POST', cuerpo: { username: u, password: p } })).datos.token;

(async () => {
  const admin = await entrar('admin', 'ClaveDePrueba123');
  const cat = (await llamar('/catalogos', { token: admin })).datos;
  const sub = cat.subfactores.find(x => x.factor_id === cat.factores[0].id);
  const yo = cat.usuarios[0].id;
  const sello = Date.now().toString().slice(-6);

  // Riesgo nuevo y vacio, para que el informe arranque limpio.
  let r = await llamar('/riesgos', { metodo: 'POST', token: admin, cuerpo: {
    evaluacion_id: cat.evaluaciones[0].id, codigo: 'INF-' + sello,
    factor_id: cat.factores[0].id, subfactor_id: sub.id,
    descripcion: 'Riesgo de prueba para el informe',
    probabilidad: 3, impacto: 4, fecha_identificacion: '2026-10-08' } });
  ok(r.estado === 201, 'riesgo de prueba creado');
  const riesgo = r.datos.id;

  console.log('\n--- CREAR TAREA CON INFORME ---');
  r = await llamar('/tareas', { metodo: 'POST', token: admin, cuerpo: {
    titulo: 'Auditoria de caja ' + sello, tipo: 'Tarea programada',
    responsable_id: yo, fecha_programada: '2026-10-08', fecha_limite: '2026-10-20',
    prioridad: 'Alta', descripcion: 'Revision de arqueo', riesgo_id: riesgo,
    antecedentes: 'Observacion de la auditoria anterior', area_auditada: 'Caja - Centro',
    hallazgos: [
      { hallazgo: 'Arqueos sin doble firma', riesgo: 'Faltantes no detectados',
        recomendacion: 'Doble firma diaria', plan_accion: 'Se instruye doble firma',
        responsable_id: yo, area_responsable: 'Tesoreria',
        fecha_compromiso: '2026-11-01', estado: 'Pendiente' },
      { hallazgo: '', riesgo: 'este hallazgo vacio debe descartarse' },
      { hallazgo: 'Camaras sin retencion', recomendacion: 'Ampliar retencion',
        area_responsable: 'Seguridad' },
    ] } });
  ok(r.estado === 201, 'tarea con informe creada');
  const tarea = r.datos.id;

  let t = (await llamar(`/tareas/${tarea}`, { token: admin })).datos;
  ok(t.area_auditada === 'Caja - Centro', 'se guardo el area auditada');
  ok(t.antecedentes.includes('auditoria anterior'), 'se guardaron los antecedentes');
  ok(t.hallazgos.length === 2, `los hallazgos vacios se descartan (quedaron ${t.hallazgos.length} de 3)`);
  const h0 = t.hallazgos[0];
  ok(h0.riesgo === 'Faltantes no detectados' && h0.recomendacion === 'Doble firma diaria'
     && h0.plan_accion === 'Se instruye doble firma',
     'el primer hallazgo guarda riesgo, recomendacion y plan de accion');
  ok(h0.responsable_nombre && h0.area_responsable === 'Tesoreria',
     `y su responsable (${h0.responsable_nombre}) y area`);
  ok(t.hallazgos[0].orden < t.hallazgos[1].orden, 'los hallazgos conservan el orden de carga');
  ok(Number((await llamar(`/tareas?riesgo=${riesgo}`, { token: admin })).datos[0].hallazgos_count) === 2,
     'la lista del riesgo trae el conteo de hallazgos');

  console.log('\n--- EDITAR REEMPLAZA LA LISTA DE HALLAZGOS ---');
  r = await llamar(`/tareas/${tarea}`, { metodo: 'PUT', token: admin, cuerpo: {
    titulo: 'Auditoria de caja ' + sello, tipo: 'Control extraordinario',
    fecha_programada: '2026-10-08', area_auditada: 'Caja - Centro (rev.)',
    hallazgos: [{ hallazgo: 'Unico hallazgo tras la revision', estado: 'Cumplido' }] } });
  ok(r.estado === 200, 'edicion aceptada');
  t = (await llamar(`/tareas/${tarea}`, { token: admin })).datos;
  ok(t.tipo === 'Control extraordinario', 'el tipo nuevo se guardo');
  ok(t.hallazgos.length === 1 && t.hallazgos[0].estado === 'Cumplido',
     'la lista de hallazgos se reemplazo por completo');

  console.log('\n--- LOS HALLAZGOS SE VAN CON LA TAREA ---');
  await llamar(`/tareas/${tarea}`, { metodo: 'DELETE', token: admin });
  ok((await llamar(`/tareas/${tarea}`, { token: admin })).estado === 404, 'la tarea se elimino');
  // Si quedaran hallazgos huerfanos, la proxima tarea con el mismo id los veria;
  // el ON DELETE CASCADE lo evita. No hay endpoint directo, se infiere del 404.

  // Limpieza del riesgo de prueba.
  await llamar(`/riesgos/${riesgo}`, { metodo: 'DELETE', token: admin });

  console.log(`\n========================================`);
  console.log(`  ${pasos - fallas} de ${pasos} comprobaciones pasaron`);
  console.log(`========================================\n`);
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
