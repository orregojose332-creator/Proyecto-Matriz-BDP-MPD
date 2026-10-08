/* Prueba del apartado Riesgos: info ampliada, edición y "+ Tarea". */
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
  const analista = await entrar('analista', 'ClaveAnalista123');
  const cat = (await llamar('/catalogos', { token: admin })).datos;

  console.log('\n--- CONTENIDO DEL "+ INFO" ---');
  ok(cat.subfactores.every(s => s.orientacion), 'los 18 subfactores tienen orientación');
  ok(cat.subfactores.every(s => s.ejemplos), 'los 18 subfactores tienen ejemplos');
  const pep = cat.subfactores.find(s => s.nombre.includes('PEP'));
  ok(pep.ejemplos.split('\n').length >= 3, `PEP trae ${pep.ejemplos.split('\n').length} ejemplos`);

  console.log('\n--- ALTA CON CONTEXTO ---');
  const sub = cat.subfactores.find(s => s.factor_id === cat.factores[0].id);
  let r = await llamar('/riesgos', { metodo: 'POST', token: admin, cuerpo: {
    evaluacion_id: cat.evaluaciones[0].id, codigo: 'INFO-' + Date.now().toString().slice(-6),
    factor_id: cat.factores[0].id, subfactor_id: sub.id,
    descripcion: 'Cliente PEP con operaciones que superan su perfil declarado',
    contexto: 'Detectado en la sucursal de Ciudad del Este durante la revisión trimestral. Afecta a tres cuentas del mismo grupo familiar.',
    referencia: 'Manual de prevención, punto 4.2',
    probabilidad: 4, impacto: 5, fecha_identificacion: '2026-10-07' } });
  ok(r.estado === 201, 'riesgo creado con contexto y referencia');
  const riesgo = r.datos.id;

  r = await llamar(`/riesgos/${riesgo}`, { token: admin });
  ok(r.datos.contexto?.includes('Ciudad del Este'), 'el contexto se guardó');
  ok(r.datos.referencia === 'Manual de prevención, punto 4.2', 'la referencia se guardó');
  ok(!!r.datos.subfactor_orientacion, 'el detalle trae la orientación del subfactor');
  ok(!!r.datos.subfactor_ejemplos, 'el detalle trae los ejemplos');
  ok(r.datos.tareas_count === 0, 'arranca sin tareas');

  console.log('\n--- "+ TAREA" SOBRE EL RIESGO ---');
  r = await llamar('/tareas', { metodo: 'POST', token: admin, cuerpo: {
    titulo: 'Verificar controles del riesgo PEP', tipo: 'Control programado', prioridad: 'Alta',
    riesgo_id: riesgo, fecha_programada: '2026-10-07', fecha_limite: '2026-10-14' } });
  ok(r.estado === 201, 'tarea creada desde el riesgo');
  const tarea = r.datos.id;

  r = await llamar(`/riesgos/${riesgo}`, { token: admin });
  ok(Number(r.datos.tareas_count) === 1, `el riesgo cuenta 1 tarea (${r.datos.tareas_count})`);
  ok(Number(r.datos.tareas_abiertas) === 1, 'y 1 abierta');

  r = await llamar(`/tareas/${tarea}`, { token: admin });
  ok(r.datos.riesgo_codigo, `la tarea queda vinculada al riesgo ${r.datos.riesgo_codigo}`);

  // Al cerrar la tarea, el contador de abiertas del riesgo baja
  await llamar(`/tareas/${tarea}/avanzar`, { metodo: 'POST', token: admin, cuerpo: { estado: 'Completada' } });
  r = await llamar(`/riesgos/${riesgo}`, { token: admin });
  ok(Number(r.datos.tareas_abiertas) === 0 && Number(r.datos.tareas_count) === 1,
     'al completarla queda 1 tarea, 0 abiertas');

  console.log('\n--- EDICIÓN SEGÚN EL CARGO ---');
  const codigoEdit = 'EDIT-' + Date.now().toString().slice(-6);
  const cuerpoEdicion = { codigo: codigoEdit, factor_id: cat.factores[0].id, subfactor_id: sub.id,
    descripcion: 'Descripción corregida', contexto: 'Contexto actualizado por el analista',
    referencia: null, probabilidad: 3, impacto: 4, fecha_identificacion: '2026-10-07' };
  r = await llamar(`/riesgos/${riesgo}`, { metodo: 'PUT', token: analista, cuerpo: cuerpoEdicion });
  ok(r.estado === 200, 'el Analista SÍ puede editar (tiene riesgos.editar)');
  r = await llamar(`/riesgos/${riesgo}`, { token: admin });
  ok(r.datos.contexto === 'Contexto actualizado por el analista', 'la edición del contexto se guardó');
  ok(Number(r.datos.inherente_valor) === 12, `recalculó el inherente a 3x4=12 (${r.datos.inherente_valor})`);

  // Editar hacia un codigo que ya usa otro riesgo tiene que decirlo claro
  const otro = (await llamar('/riesgos', { token: admin })).datos.find(x => x.id !== riesgo);
  r = await llamar(`/riesgos/${riesgo}`, { metodo: 'PUT', token: admin,
    cuerpo: { ...cuerpoEdicion, codigo: otro.codigo } });
  ok(r.estado === 409, `código duplicado al editar -> 409 (dio ${r.estado})`);
  ok(/codigo/i.test(r.datos?.error || ''), `y el mensaje lo explica: "${r.datos?.error}"`);

  r = await llamar(`/riesgos/${riesgo}`, { metodo: 'DELETE', token: analista });
  ok(r.estado === 403, 'el Analista NO puede eliminar -> 403');
  r = await llamar(`/riesgos/${riesgo}/estado`, { metodo: 'POST', token: analista, cuerpo: { estado: 'Aprobado' } });
  ok(r.estado === 403, 'el Analista NO puede aprobar -> 403');

  console.log('\n--- EDITAR LA ORIENTACIÓN DEL CATÁLOGO ---');
  r = await llamar(`/subfactores/${sub.id}`, { metodo: 'PUT', token: analista, cuerpo: {
    nombre: sub.nombre, orientacion: 'intento no autorizado' } });
  ok(r.estado === 403, 'el Analista NO puede editar el catálogo -> 403');
  r = await llamar(`/subfactores/${sub.id}`, { metodo: 'PUT', token: admin, cuerpo: {
    nombre: sub.nombre, descripcion: sub.descripcion,
    orientacion: sub.orientacion + ' Ajustado por el oficial de cumplimiento.',
    ejemplos: sub.ejemplos } });
  ok(r.estado === 200, 'el Administrador SÍ puede editar la orientación');
  const cat2 = (await llamar('/catalogos', { token: admin })).datos;
  ok(cat2.subfactores.find(s => s.id === sub.id).orientacion.includes('oficial de cumplimiento'),
     'el cambio del catálogo se refleja');

  console.log(`\n========================================`);
  console.log(`  ${pasos - fallas} de ${pasos} comprobaciones pasaron`);
  console.log(`========================================\n`);
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
