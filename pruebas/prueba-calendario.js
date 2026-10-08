/* Prueba del módulo Calendario: agenda, traspasos y métricas de fase. */
const BASE = 'http://localhost:3100/api';
let fallas = 0, pasos = 0;
const ok = (c, t, extra = '') => { pasos++;
  console.log(c ? `  OK   ${t}` : `  FALLA ${t} ${extra}`); if (!c) fallas++; };
const esperar = ms => new Promise(r => setTimeout(r, ms));

async function llamar(ruta, { metodo = 'GET', cuerpo, token } = {}) {
  const r = await fetch(BASE + ruta, { method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { estado: r.status, datos: await r.json().catch(() => null) };
}
const entrar = async (u, p) => (await llamar('/auth/login', { metodo: 'POST',
  cuerpo: { username: u, password: p } })).datos.token;

(async () => {
  const admin = await entrar('admin', 'ClaveDePrueba123');
  const analista = await entrar('analista', 'ClaveAnalista123');
  const cat = (await llamar('/catalogos', { token: admin })).datos;
  const usuarios = cat.usuarios;
  const hoy = new Date().toISOString().slice(0, 10);

  console.log('\n--- AGENDAR ---');
  let r = await llamar('/tareas', { metodo: 'POST', token: admin, cuerpo: {
    titulo: 'Verificar debida diligencia reforzada de clientes PEP',
    descripcion: 'Revisar los 12 expedientes PEP del trimestre',
    tipo: 'Control programado', fecha_programada: hoy, fecha_limite: hoy,
    prioridad: 'Alta', responsable_id: usuarios[0].id } });
  ok(r.estado === 201, 'tarea agendada');
  const tarea = r.datos.id;

  r = await llamar(`/tareas/${tarea}`, { token: admin });
  ok(r.datos.estado === 'Pendiente', 'arranca en Pendiente');
  ok(r.datos.traspasos.length === 1, `el alta deja el primer marcador (${r.datos.traspasos.length})`);
  ok(r.datos.traspasos[0].estado_desde === null, 'el primer marcador no tiene estado previo');

  r = await llamar('/tareas', { metodo: 'POST', token: admin, cuerpo: {
    titulo: 'Sin fecha', fecha_programada: null } });
  ok(r.estado === 400, 'sin fecha programada -> 400');
  r = await llamar('/tareas', { metodo: 'POST', token: admin, cuerpo: {
    titulo: 'Fechas al revés', fecha_programada: '2026-10-10', fecha_limite: '2026-10-01' } });
  ok(r.estado === 400, 'fecha límite anterior a la programada -> 400');

  console.log('\n--- FASES Y TRASPASOS ---');
  await esperar(2100);
  r = await llamar(`/tareas/${tarea}/avanzar`, { metodo: 'POST', token: admin,
    cuerpo: { estado: 'En proceso', nota: 'Arranca la revisión' } });
  ok(r.estado === 200, 'pasa a En proceso');
  ok(r.datos.duracion_segundos >= 2, `midió la fase Pendiente: ${r.datos.duracion_segundos} s`);

  await esperar(1600);
  r = await llamar(`/tareas/${tarea}/avanzar`, { metodo: 'POST', token: admin,
    cuerpo: { responsable_id: usuarios[1].id, nota: 'Pasa a otro analista' } });
  ok(r.estado === 200, 'cambia de responsable sin cambiar de estado');

  await esperar(1300);
  r = await llamar(`/tareas/${tarea}/avanzar`, { metodo: 'POST', token: admin,
    cuerpo: { estado: 'En revision', responsable_id: usuarios[2].id } });
  ok(r.estado === 200, 'pasa a En revision y cambia de responsable a la vez');

  await esperar(1200);
  r = await llamar(`/tareas/${tarea}/avanzar`, { metodo: 'POST', token: admin,
    cuerpo: { estado: 'Completada' } });
  ok(r.estado === 200, 'se completa');

  r = await llamar(`/tareas/${tarea}`, { token: admin });
  const tt = r.datos.traspasos;
  ok(tt.length === 5, `quedan 5 marcadores, uno por cada fase (${tt.length})`);
  ok(tt.filter(x => x.cambio_responsable).length === 3,
     `3 traspasos de responsable (${tt.filter(x => x.cambio_responsable).length})`);
  ok(r.datos.traspasos === undefined || r.datos.completada_en, 'queda sellada la fecha de cierre');
  const fases = tt.filter(x => x.estado_desde).map(x => `${x.estado_desde}:${x.duracion_segundos}s`);
  console.log(`       fases medidas -> ${fases.join(' | ')}`);
  ok(tt.every(x => x.estado_desde === null || x.duracion_segundos >= 0),
     'toda fase cerrada tiene duración');

  r = await llamar(`/tareas/${tarea}/avanzar`, { metodo: 'POST', token: admin,
    cuerpo: { estado: 'Completada' } });
  ok(r.estado === 400, 'un cambio que no cambia nada -> 400');
  r = await llamar(`/tareas/${tarea}/avanzar`, { metodo: 'POST', token: admin,
    cuerpo: { estado: 'Inventado' } });
  ok(r.estado === 400, 'estado inexistente -> 400');

  console.log('\n--- MÉTRICAS ---');
  r = await llamar('/tareas/metricas', { token: admin });
  ok(r.estado === 200, 'métricas responden');
  const m = r.datos;
  ok(m.resolucion.completadas >= 1, `${m.resolucion.completadas} tarea(s) completada(s)`);
  ok(m.resolucion.promedio_seg >= 6,
     `tiempo promedio de resolución: ${Math.round(m.resolucion.promedio_seg)} s (suma de las 4 fases)`);
  ok(m.porFase.length >= 3, `duración medida en ${m.porFase.length} fases distintas`);
  console.log('       ' + m.porFase.map(f =>
    `${f.fase} ${Math.round(f.promedio_seg)}s (x${f.veces})`).join(' · '));
  // Promedio sobre TODAS las tareas de la base, no solo la de esta prueba:
  // basta con que sea positivo y que el maximo alcance los 3 traspasos que
  // acaba de registrar el escenario de arriba.
  ok(Number(m.traspasos.promedio_por_tarea) > 0 && Number(m.traspasos.maximo) >= 3,
     `traspasos: promedio ${Number(m.traspasos.promedio_por_tarea).toFixed(1)}, máximo ${m.traspasos.maximo}`);
  ok(m.porResponsable.length >= 2,
     `tiempo retenido por ${m.porResponsable.length} responsables`);
  console.log('       ' + m.porResponsable.map(x =>
    `${x.nombre}: ${Math.round(x.total_seg)}s`).join(' · '));

  console.log('\n--- PERMISOS ---');
  r = await llamar('/tareas', { token: analista });
  ok(r.estado === 200, 'Analista SÍ ve el calendario');
  r = await llamar('/tareas/metricas', { token: analista });
  ok(r.estado === 403, 'Analista NO ve las métricas de tiempos -> 403');
  r = await llamar(`/tareas/${tarea}`, { metodo: 'DELETE', token: analista });
  ok(r.estado === 403, 'Analista NO puede eliminar -> 403');
  r = await llamar('/tareas', { metodo: 'POST', token: analista, cuerpo: {
    titulo: 'Agendada por el analista', fecha_programada: hoy } });
  ok(r.estado === 201, 'Analista SÍ puede agendar');

  console.log('\n--- VISTA DE CALENDARIO ---');
  r = await llamar(`/tareas?desde=${hoy}&hasta=${hoy}`, { token: admin });
  ok(r.estado === 200 && r.datos.length >= 2, `${r.datos.length} tareas en el rango del día`);
  ok(r.datos[0].traspasos !== undefined, 'cada fila trae su contador de traspasos');

  console.log(`\n========================================`);
  console.log(`  ${pasos - fallas} de ${pasos} comprobaciones pasaron`);
  console.log(`========================================\n`);
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
