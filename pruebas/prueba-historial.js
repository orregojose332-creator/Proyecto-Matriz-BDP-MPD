/* Prueba del Historial de un riesgo y de los tres tipos de tarea.
 *
 * Lo que se verifica: que "+ Tarea" solo crea tareas, que el Historial las
 * devuelve agrupables por estado, que los casos Especiales exigen decir de
 * que se trata, y que un caso reservado no se filtra a quien no debe verlo
 * ni por la lista, ni por id, ni al intentar moverlo.
 *
 *   node pruebas/prueba-historial.js      (con el servidor en el 3100)
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

const HOY = new Date().toISOString().slice(0, 10);
const GRUPOS = {
  'sin iniciar': ['Pendiente'],
  'en proceso':  ['En proceso', 'En revision'],
  'completadas': ['Completada'],
  'canceladas':  ['Cancelada'],
};

(async () => {
  const admin    = await entrar('admin', 'ClaveDePrueba123');
  const analista = await entrar('analista', 'ClaveAnalista123');
  const cat = (await llamar('/catalogos', { token: admin })).datos;
  const sub = cat.subfactores.find(x => x.factor_id === cat.factores[0].id);
  const sello = Date.now().toString().slice(-6);

  // Un riesgo nuevo y vacio: asi el historial arranca en cero y lo que cuenta
  // es lo que crea esta prueba, no lo que quedo de una corrida anterior.
  let r = await llamar('/riesgos', { metodo: 'POST', token: admin, cuerpo: {
    evaluacion_id: cat.evaluaciones[0].id, codigo: 'HIST-' + sello,
    factor_id: cat.factores[0].id, subfactor_id: sub.id,
    descripcion: 'Riesgo de prueba para el historial de tareas',
    probabilidad: 3, impacto: 4, fecha_identificacion: HOY } });
  ok(r.estado === 201, 'riesgo de prueba creado');
  const riesgo = r.datos.id;

  console.log('\n--- EL HISTORIAL ARRANCA VACIO ---');
  r = await llamar(`/tareas?riesgo=${riesgo}`, { token: admin });
  ok(r.estado === 200 && r.datos.length === 0, `sin tareas todavia (${r.datos.length})`);

  console.log('\n--- LOS TRES TIPOS DE TAREA ---');
  const crear = (cuerpo, token = admin) => llamar('/tareas', { metodo: 'POST', token, cuerpo: {
    fecha_programada: HOY, prioridad: 'Media', riesgo_id: riesgo, ...cuerpo } });

  const ids = {};
  for (const [clave, tipo] of [['aud', 'Auditoria'], ['ctl', 'Control programado']]) {
    r = await crear({ titulo: `${tipo} sobre HIST-${sello}`, tipo });
    ok(r.estado === 201, `se crea una tarea de tipo "${tipo}"`);
    ids[clave] = r.datos.id;
  }

  r = await crear({ titulo: 'Tipo inventado', tipo: 'Cualquier cosa' });
  const inventada = (await llamar(`/tareas/${r.datos.id}`, { token: admin })).datos;
  ok(inventada.tipo === 'Auditoria', `un tipo desconocido cae en Auditoria (${inventada.tipo})`);

  console.log('\n--- CASOS ESPECIALES ---');
  r = await crear({ titulo: 'Caso sin clasificar', tipo: 'Especial' });
  ok(r.estado === 400, `una Especial sin categoria se rechaza -> 400 (dio ${r.estado})`);
  r = await crear({ titulo: 'Caso con categoria falsa', tipo: 'Especial', categoria_especial: 'Otra cosa' });
  ok(r.estado === 400, 'una categoria fuera del catalogo se rechaza -> 400');

  r = await crear({ titulo: 'Denuncia recibida por el canal interno', tipo: 'Especial',
                    categoria_especial: 'Canal de denuncias', responsable_id: 1 });
  ok(r.estado === 201, 'se crea el caso Especial con su categoria');
  ids.esp = r.datos.id;
  const esp = (await llamar(`/tareas/${ids.esp}`, { token: admin })).datos;
  ok(esp.categoria_especial === 'Canal de denuncias', 'la categoria se guardo');
  ok(Number(esp.confidencial) === 1, 'y nace reservada sin que haya que marcarlo');

  const abierta = await crear({ titulo: 'Hurto en caja, caso abierto a todos', tipo: 'Especial',
                                categoria_especial: 'Hurto', confidencial: false });
  ok(Number((await llamar(`/tareas/${abierta.datos.id}`, { token: admin })).datos.confidencial) === 0,
     'se puede desmarcar a proposito');

  console.log('\n--- LO RESERVADO NO SE FILTRA ---');
  const lista = (await llamar(`/tareas?riesgo=${riesgo}`, { token: analista })).datos;
  ok(!lista.some(t => t.id === ids.esp), 'el Analista no ve la denuncia en la lista');
  ok(lista.some(t => t.id === abierta.datos.id), 'pero si ve el caso que se desmarco');
  r = await llamar(`/tareas/${ids.esp}`, { token: analista });
  ok(r.estado === 403, `tampoco entrando por el id -> 403 (dio ${r.estado})`);
  r = await llamar(`/tareas/${ids.esp}/avanzar`, { metodo: 'POST', token: analista,
                                                   cuerpo: { estado: 'En proceso' } });
  ok(r.estado === 403, 'ni puede moverla de estado -> 403');
  r = await llamar(`/tareas/${ids.esp}`, { token: admin });
  ok(r.estado === 200, 'el Administrador si la ve (tiene tareas.confidencial)');

  // Quien registra el caso lo conoce: esconderselo despues no protege a nadie.
  const propia = await crear({ titulo: 'Acoso reportado por el area', tipo: 'Especial',
                               categoria_especial: 'Acoso' }, analista);
  ok(propia.estado === 201, 'el Analista puede registrar un caso Especial');
  r = await llamar(`/tareas/${propia.datos.id}`, { token: analista });
  ok(r.estado === 200, 'y sigue viendo el que registro el mismo');

  console.log('\n--- EL HISTORIAL AGRUPA POR ESTADO ---');
  await llamar(`/tareas/${ids.aud}/avanzar`, { metodo: 'POST', token: admin, cuerpo: { estado: 'En proceso' } });
  await llamar(`/tareas/${ids.ctl}/avanzar`, { metodo: 'POST', token: admin, cuerpo: { estado: 'Completada' } });
  await llamar(`/tareas/${abierta.datos.id}/avanzar`, { metodo: 'POST', token: admin, cuerpo: { estado: 'Cancelada' } });

  const todas = (await llamar(`/tareas?riesgo=${riesgo}`, { token: admin })).datos;
  const cuenta = est => todas.filter(t => est.includes(t.estado)).length;
  ok(todas.length === 6, `el historial trae las 6 tareas del riesgo (${todas.length})`);
  for (const [nombre, est] of Object.entries(GRUPOS))
    ok(cuenta(est) >= 1, `el grupo "${nombre}" tiene ${cuenta(est)} tarea(s)`);
  ok(Object.values(GRUPOS).reduce((a, e) => a + cuenta(e), 0) === todas.length,
     'los cuatro grupos suman el total: ninguna tarea queda sin grupo');
  ok(todas.every(t => t.riesgo_id === riesgo), 'ninguna tarea de otro riesgo se cuela');

  // Las completadas y canceladas siguen en el historial: es su razon de ser.
  r = await llamar(`/tareas?riesgo=${riesgo}&estado=Completada`, { token: admin });
  ok(r.datos.length === 1, 'y se puede pedir un solo estado');

  console.log('\n--- EL FILTRO POR TIPO ---');
  r = await llamar(`/tareas?riesgo=${riesgo}&tipo=Control programado`, { token: admin });
  ok(r.datos.length === 1 && r.datos[0].tipo === 'Control programado',
     'filtrar por "Control programado" devuelve solo ese');
  r = await llamar(`/tareas?riesgo=${riesgo}&tipo=Especial`, { token: analista });
  ok(!r.datos.some(t => t.id === ids.esp),
     'filtrar por Especial tampoco destapa la denuncia al Analista');

  console.log('\n--- EDITAR MANTIENE EL TIPO ---');
  r = await llamar(`/tareas/${ids.ctl}`, { metodo: 'PUT', token: admin, cuerpo: {
    titulo: 'Control programado, titulo corregido', fecha_programada: HOY, prioridad: 'Alta' } });
  ok(r.estado === 200, 'edicion sin mandar el tipo -> 200');
  const tras = (await llamar(`/tareas/${ids.ctl}`, { token: admin })).datos;
  ok(tras.tipo === 'Control programado', `el tipo no se pierde al editar (${tras.tipo})`);
  r = await llamar(`/tareas/${ids.esp}`, { metodo: 'PUT', token: admin, cuerpo: {
    titulo: 'Denuncia, titulo corregido', tipo: 'Especial', fecha_programada: HOY } });
  ok(r.estado === 200 &&
     Number((await llamar(`/tareas/${ids.esp}`, { token: admin })).datos.confidencial) === 1,
     'editar una Especial sin tocar el marcador la deja reservada');

  // Limpieza: el riesgo de prueba y sus tareas no quedan en la matriz real.
  for (const id of [...Object.values(ids), abierta.datos.id, propia.datos.id, inventada.id])
    await llamar(`/tareas/${id}`, { metodo: 'DELETE', token: admin });
  await llamar(`/riesgos/${riesgo}`, { metodo: 'DELETE', token: admin });

  console.log(`\n========================================`);
  console.log(`  ${pasos - fallas} de ${pasos} comprobaciones pasaron`);
  console.log(`========================================\n`);
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
