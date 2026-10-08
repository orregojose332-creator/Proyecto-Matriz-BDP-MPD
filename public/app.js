/* ===========================================================================
   app.js — nucleo compartido por todas las pantallas.
   Incluir ANTES del script propio de cada pagina.
   Expone: MDP.api, MDP.usuario, MDP.puede, MDP.vivo, MDP.ui
   =========================================================================== */
'use strict';

const MDP = (() => {
  const CLAVE_TOKEN = 'mdp_token';
  let usuario = null;

  // ─── Sesion ──────────────────────────────────────────────────────────────
  const token = () => localStorage.getItem(CLAVE_TOKEN);

  function salir(motivo) {
    localStorage.removeItem(CLAVE_TOKEN);
    localStorage.removeItem('mdp_usuario');
    const vuelve = encodeURIComponent(location.pathname.split('/').pop() || '');
    location.replace(`/Login.html?volver=${vuelve}${motivo ? '&motivo=' + motivo : ''}`);
  }

  // ─── Llamadas a la API ───────────────────────────────────────────────────
  async function api(ruta, opciones = {}) {
    const r = await fetch(`/api${ruta}`, {
      ...opciones,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: 'Bearer ' + token() } : {}),
        ...(opciones.headers || {}),
      },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : opciones.body,
    });
    if (r.status === 401) { salir('expirada'); throw new Error('Sesion expirada'); }
    const datos = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) throw new Error(datos?.error || `Error ${r.status}`);
    return datos;
  }

  /** ¿El cargo del usuario tiene este permiso? El servidor vuelve a
   *  comprobarlo en cada peticion; esto solo decide que se muestra. */
  const puede = clave => !!usuario?.permisos?.includes(clave);

  // ─── Conexion en vivo (SSE) ──────────────────────────────────────────────
  // Un solo flujo por pestana. Cada pantalla se suscribe a los eventos que le
  // importan y vuelve a pedir sus datos, de modo que nadie refresca a mano.
  const vivo = (() => {
    const oyentes = new Map();        // evento -> Set(callback)
    let fuente = null, indicador = null, abierta = false;

    function estado(valor) {
      if (!indicador) indicador = document.querySelector('.vivo');
      if (indicador) {
        indicador.dataset.estado = valor;
        const txt = indicador.querySelector('.txt');
        if (txt) txt.textContent = valor === 'conectado' ? 'En vivo' : 'Reconectando';
      }
    }

    function conectar() {
      if (fuente) fuente.close();
      // EventSource no acepta encabezados propios: el token viaja en cookie de
      // sesion, que el servidor tambien acepta.
      document.cookie = `mdp_token=${encodeURIComponent(token() || '')}; path=/; SameSite=Lax`;
      fuente = new EventSource('/api/eventos');

      fuente.onopen = () => {
        const reconexion = abierta === false && fuente.__yaEstuvoAbierta;
        abierta = true;
        fuente.__yaEstuvoAbierta = true;
        estado('conectado');
        // Los eventos emitidos mientras no habia conexion no se recuperan: el
        // flujo no guarda historial. Asi que al reconectar cada pantalla vuelve
        // a pedir sus datos, en lugar de quedarse con lo que mostraba antes del
        // corte hasta que llegue el proximo evento.
        if (reconexion) resincronizar('reconexion');
      };

      fuente.onerror = () => {
        abierta = false;
        estado('cortado');
        // EventSource reintenta solo (retry: 3000 lo fija el servidor).
      };

      for (const evento of ['riesgos', 'tareas', 'usuarios', 'cargos', 'evaluaciones']) {
        fuente.addEventListener(evento, e => {
          let datos = {};
          try { datos = JSON.parse(e.data); } catch {}
          (oyentes.get(evento) || []).forEach(fn => { try { fn(datos); } catch (err) { console.error(err); } });
        });
      }
    }

    /** Ejecuta todas las recargas registradas, sin esperar un evento. */
    function resincronizar(motivo) {
      for (const fns of oyentes.values()) {
        for (const fn of fns) {
          try { fn({ motivo }); } catch (e) { console.error(e); }
        }
      }
    }

    // El navegador suspende las pestanas en segundo plano y puede cerrar el
    // flujo sin avisar. Al volver a primer plano se comprueba el estado y, si
    // hace falta, se reconecta; en cualquier caso se resincroniza.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !fuente) return;
      if (fuente.readyState === EventSource.CLOSED) conectar();
      else resincronizar('volvio-al-frente');
    });

    return {
      conectar,
      resincronizar,
      /** al('riesgos', recargar) — ejecuta recargar() cuando algo cambie. */
      al(evento, fn) {
        if (!oyentes.has(evento)) oyentes.set(evento, new Set());
        oyentes.get(evento).add(fn);
      },
    };
  })();

  // ─── Utilidades de pantalla ──────────────────────────────────────────────
  const ui = {
    num: (v, dec = 0) => Number(v || 0).toLocaleString('es-PY',
      { minimumFractionDigits: dec, maximumFractionDigits: dec }),

    fecha(v) {
      if (!v) return '—';
      const d = new Date(String(v).replace(' ', 'T'));
      return isNaN(d) ? String(v) : d.toLocaleDateString('es-PY');
    },

    /** Escapa antes de interpolar en HTML: la descripcion de un riesgo la
     *  escribe un usuario y no debe poder inyectar marcado. */
    esc(v) {
      return String(v ?? '').replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    nivel(n) { return `<span class="nivel" data-n="${ui.esc(n)}">${ui.esc(n)}</span>`; },

    /** Notificacion flotante arriba a la derecha. Reemplaza al cartel fijo:
     *  los 'ok' se van solos en unos segundos, los errores quedan hasta que
     *  se toquen o pase mas tiempo, y varios avisos se apilan sin pisarse. */
    aviso(texto, tipo = 'error') {
      // Si la pantalla esta dentro de un modal (iframe), el aviso se muestra
      // en la ventana de arriba, no encerrado en el modal.
      try {
        if (window.parent && window.parent !== window && window.parent.MDP) {
          return window.parent.MDP.ui.aviso(texto, tipo);
        }
      } catch { /* origen distinto: cae al aviso local */ }

      let caja = document.querySelector('.avisos');
      if (!caja) {
        caja = Object.assign(document.createElement('div'), { className: 'avisos' });
        caja.setAttribute('role', 'status');
        caja.setAttribute('aria-live', 'polite');
        document.body.appendChild(caja);
      }
      const t = Object.assign(document.createElement('div'), { className: `toast ${tipo}` });
      t.innerHTML = `<span class="icono" aria-hidden="true">${tipo === 'ok' ? '✓' : '!'}</span>
        <span class="txt"></span>`;
      t.querySelector('.txt').textContent = texto;
      caja.appendChild(t);
      // Fuerza un reflow para que la transicion de entrada se vea.
      requestAnimationFrame(() => t.classList.add('visible'));
      const quitar = () => {
        t.classList.remove('visible');
        t.addEventListener('transitionend', () => t.remove(), { once: true });
        setTimeout(() => t.remove(), 400);   // red de seguridad
      };
      t.onclick = quitar;                      // se puede descartar al tocar
      setTimeout(quitar, tipo === 'ok' ? 3500 : 6000);
    },

    /** Tooltip unico y compartido por todos los graficos. */
    tip: (() => {
      let el = null;
      const asegurar = () => el || (el = Object.assign(document.body.appendChild(
        document.createElement('div')), { className: 'tip' }));
      return {
        ver(html, ev) {
          const t = asegurar();
          t.innerHTML = html;
          t.dataset.ver = '1';
          const r = t.getBoundingClientRect();
          t.style.left = Math.min(ev.clientX + 14, innerWidth - r.width - 10) + 'px';
          t.style.top  = Math.max(ev.clientY - r.height - 12, 8) + 'px';
        },
        ocultar() { if (el) el.dataset.ver = '0'; },
      };
    })(),
  };

  // ─── Barra superior y barra lateral ──────────────────────────────────────
  // Un icono por modulo, al trazo, para que tome el color del tema:
  // barras = tablero, cuadricula = matriz, personas = usuarios,
  // escudo = permisos, documento = bitacora.
  const ICONOS = {
    tablero:   '<path d="M4 19V11"/><path d="M10 19V5"/><path d="M16 19v-6"/><path d="M2 21h20"/>',
    matriz:    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    calendario:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/>'
             + '<path d="M8 3v4M16 3v4"/><path d="M7.5 14h3v3h-3z"/>',
    riesgos:   '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'
             + '<path d="M12 9v4.5"/><path d="M12 17.2h.01"/>',
    tareas:    '<path d="M8 5h11M8 12h11M8 19h11"/><path d="m3 5 1.4 1.4L7 3.8"/>'
             + '<path d="m3 12 1.4 1.4L7 10.8"/><circle cx="4.5" cy="19" r="1.4"/>',
    usuarios:  '<path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="9" cy="7" r="3.2"/>'
             + '<path d="M17.5 14.2A4 4 0 0 1 21 18.1V20"/><path d="M15.8 4.3a3.2 3.2 0 0 1 0 5.9"/>',
    cargos:    '<path d="M12 2.8 20 6v5.6c0 4.5-3.2 8.2-8 9.6-4.8-1.4-8-5.1-8-9.6V6l8-3.2Z"/>'
             + '<path d="m8.8 12.2 2.3 2.3 4.3-4.6"/>',
    auditoria: '<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/>'
             + '<path d="M14 3v5h5"/><path d="M9.5 13h6M9.5 17h4"/>',
  };
  const icono = id => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${ICONOS[id] || ''}</svg>`;

  const PAGINAS = [
    { id: 'tablero',   href: 'Reportes.html',  texto: 'Tablero',   permiso: 'reportes.ver' },
    { id: 'riesgos',   href: 'Riesgos.html',   texto: 'Riesgos',   permiso: 'riesgos.ver' },
    { id: 'tareas',    href: 'Tareas.html',    texto: 'Tareas',    permiso: 'tareas.ver' },
    { id: 'matriz',    href: 'Matriz.html',    texto: 'Matriz',    permiso: 'riesgos.ver' },
    { id: 'calendario',href: 'Calendario.html',texto: 'Calendario',permiso: 'tareas.ver' },
    { id: 'usuarios',  href: 'Usuarios.html',  texto: 'Usuarios',  permiso: 'usuarios.gestionar' },
    { id: 'cargos',    href: 'Cargos.html',    texto: 'Cargos',    permiso: 'cargos.gestionar' },
    { id: 'auditoria', href: 'Auditoria.html', texto: 'Auditoria', permiso: 'auditoria.ver' },
  ];

  function barra() {
    const actual = location.pathname.split('/').pop();

    document.body.insertAdjacentHTML('afterbegin', `
      <header class="barra">
        <button class="hamburguesa" id="hamburguesa" aria-controls="lateral"
                aria-expanded="true" aria-label="Contraer o expandir los modulos">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
        <span class="marca">Matriz MDP</span>
        <span class="vivo" data-estado="cortado" title="Las pantallas se actualizan solas">
          <span class="punto"></span><span class="txt">Conectando</span>
        </span>
        <span class="sesion">
          <span>${ui.esc(usuario.nombre)} · ${ui.esc(usuario.cargo)}</span>
          <button id="btn-salir">Salir</button>
        </span>
      </header>`);

    // El title es lo unico que queda al contraer la lateral, cuando solo hay icono.
    const enlaces = PAGINAS.filter(p => puede(p.permiso)).map(p => `
      <a href="${p.href}" title="${p.texto}"${p.href === actual ? ' aria-current="page"' : ''}>
        ${icono(p.id)}<span class="texto">${p.texto}</span>
      </a>`).join('');

    // Envuelve el <main> que ya trae la pagina, sin que cada pantalla cambie.
    const principal = document.querySelector('main');
    const cuerpo = document.createElement('div');
    cuerpo.className = 'cuerpo';
    cuerpo.innerHTML = `
      <aside class="lateral" id="lateral">
        <p class="titulo">Modulos</p>
        <nav>${enlaces}</nav>
      </aside>
      <div class="velo" id="velo"></div>`;
    principal.parentNode.insertBefore(cuerpo, principal);
    cuerpo.appendChild(principal);

    document.getElementById('btn-salir').onclick = () => salir();
    medirBarra();
    conectarHamburguesa();
  }

  /** La barra superior cambia de alto cuando sus elementos se envuelven en
   *  pantalla angosta. La lateral se ancla debajo, asi que su desplazamiento
   *  se mide en vivo en lugar de fijarlo a un valor que solo vale a un ancho. */
  function medirBarra() {
    const cabecera = document.querySelector('header.barra');
    if (!cabecera) return;
    const aplicar = () => document.documentElement.style.setProperty(
      '--alto-barra', Math.round(cabecera.getBoundingClientRect().height) + 'px');
    aplicar();
    if (window.ResizeObserver) new ResizeObserver(aplicar).observe(cabecera);
    else window.addEventListener('resize', aplicar);
  }

  /** La preferencia de ancho se recuerda por navegador y sobrevive al cambio
   *  de pagina; es una comodidad de cada usuario, no estado del sistema. */
  function conectarHamburguesa() {
    const raiz = document.documentElement;
    const boton = document.getElementById('hamburguesa');
    const angosta = () => window.matchMedia('(max-width: 860px)').matches;
    const cerrarCajon = () => raiz.removeAttribute('data-cajon');

    try {
      if (localStorage.getItem('mdp_lateral') === 'contraida') raiz.dataset.lateral = 'contraida';
    } catch { /* almacenamiento bloqueado: queda expandida */ }
    boton.setAttribute('aria-expanded', String(raiz.dataset.lateral !== 'contraida'));

    boton.addEventListener('click', () => {
      if (angosta()) {
        const abierto = raiz.dataset.cajon === 'abierto';
        if (abierto) cerrarCajon(); else raiz.dataset.cajon = 'abierto';
        boton.setAttribute('aria-expanded', String(!abierto));
        return;
      }
      const contraida = raiz.dataset.lateral === 'contraida';
      if (contraida) raiz.removeAttribute('data-lateral');
      else raiz.dataset.lateral = 'contraida';
      boton.setAttribute('aria-expanded', String(contraida));
      try { localStorage.setItem('mdp_lateral', contraida ? 'expandida' : 'contraida'); } catch {}
    });

    document.getElementById('velo').addEventListener('click', cerrarCajon);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarCajon(); });
    window.addEventListener('resize', () => { if (!angosta()) cerrarCajon(); });
  }

  /** Arranca la pagina: valida sesion, dibuja la barra y abre el flujo en vivo.
   *  Devuelve el usuario ya verificado contra el servidor. */
  async function iniciar({ permiso, modal = false } = {}) {
    if (!token()) return salir(), new Promise(() => {});
    try { usuario = await api('/auth/me'); }
    catch { return salir('expirada'), new Promise(() => {}); }

    localStorage.setItem('mdp_usuario', JSON.stringify(usuario));
    // En modo modal la pantalla se muestra dentro de otra (iframe): no lleva
    // barra ni barra lateral propias, ni abre su propio flujo en vivo.
    if (modal) document.documentElement.classList.add('en-modal');
    else barra();

    if (permiso && !puede(permiso)) {
      document.querySelector('main').innerHTML =
        `<div class="tarjeta vacio">Su cargo (<strong>${ui.esc(usuario.cargo)}</strong>)
         no tiene acceso a esta pantalla.</div>`;
      return null;
    }
    if (!modal) vivo.conectar();
    return usuario;
  }

  /** Abre una pantalla (Tarea.html) como ventana superpuesta sobre la actual.
   *  `params` es la query (p. ej. 'riesgo=3' o 'id=12'); `alCerrar` recibe el
   *  resultado que la pantalla de adentro informa al guardar o cancelar. */
  function modalTarea(params, alCerrar) {
    const velo = Object.assign(document.createElement('div'), { className: 'modal-velo' });
    velo.innerHTML = `
      <div class="modal-caja" role="dialog" aria-modal="true">
        <button class="modal-x" aria-label="Cerrar">&times;</button>
        <iframe class="modal-frame" title="Tarea" src="Tarea.html?${params}&modal=1"></iframe>
      </div>`;
    document.body.appendChild(velo);
    document.documentElement.style.overflow = 'hidden';
    let cerrado = false;
    const cerrar = resultado => {
      if (cerrado) return; cerrado = true;
      window.removeEventListener('message', onMsg);
      document.removeEventListener('keydown', onEsc);
      document.documentElement.style.overflow = '';
      velo.remove();
      if (alCerrar) alCerrar(resultado || { accion: 'cancelada' });
    };
    const onMsg = e => { if (e.data && e.data.mdpTarea) cerrar(e.data.mdpTarea); };
    const onEsc = e => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('message', onMsg);
    document.addEventListener('keydown', onEsc);
    velo.addEventListener('click', e => { if (e.target === velo) cerrar(); });
    velo.querySelector('.modal-x').onclick = () => cerrar();
    requestAnimationFrame(() => velo.classList.add('visible'));
    return cerrar;
  }

  return { api, iniciar, modalTarea, puede, vivo, ui, salir, get usuario() { return usuario; } };
})();
