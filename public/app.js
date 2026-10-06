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
    let fuente = null, indicador = null;

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

      fuente.onopen  = () => estado('conectado');
      fuente.onerror = () => {
        estado('cortado');
        // EventSource reintenta solo (retry: 3000 lo fija el servidor).
      };

      for (const evento of ['riesgos', 'usuarios', 'cargos', 'evaluaciones']) {
        fuente.addEventListener(evento, e => {
          let datos = {};
          try { datos = JSON.parse(e.data); } catch {}
          (oyentes.get(evento) || []).forEach(fn => { try { fn(datos); } catch (err) { console.error(err); } });
        });
      }
    }

    return {
      conectar,
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

    aviso(texto, tipo = 'error') {
      const caja = document.getElementById('aviso');
      if (!caja) return alert(texto);
      caja.className = `aviso ${tipo}`;
      caja.textContent = texto;
      caja.hidden = false;
      if (tipo === 'ok') setTimeout(() => { caja.hidden = true; }, 3500);
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

  // ─── Barra superior ──────────────────────────────────────────────────────
  const PAGINAS = [
    { href: 'Reportes.html', texto: 'Tablero',   permiso: 'reportes.ver' },
    { href: 'Matriz.html',   texto: 'Matriz',    permiso: 'riesgos.ver' },
    { href: 'Usuarios.html', texto: 'Usuarios',  permiso: 'usuarios.gestionar' },
    { href: 'Cargos.html',   texto: 'Cargos',    permiso: 'cargos.gestionar' },
    { href: 'Auditoria.html',texto: 'Auditoria', permiso: 'auditoria.ver' },
  ];

  function barra() {
    const actual = location.pathname.split('/').pop();
    const enlaces = PAGINAS.filter(p => puede(p.permiso)).map(p =>
      `<a href="${p.href}"${p.href === actual ? ' aria-current="page"' : ''}>${p.texto}</a>`).join('');
    document.body.insertAdjacentHTML('afterbegin', `
      <header class="barra">
        <span class="marca">Matriz MDP</span>
        <nav class="menu">${enlaces}</nav>
        <span class="vivo" data-estado="cortado" title="Las pantallas se actualizan solas">
          <span class="punto"></span><span class="txt">Conectando</span>
        </span>
        <span class="sesion">
          <span>${ui.esc(usuario.nombre)} · ${ui.esc(usuario.cargo)}</span>
          <button id="btn-salir">Salir</button>
        </span>
      </header>`);
    document.getElementById('btn-salir').onclick = () => salir();
  }

  /** Arranca la pagina: valida sesion, dibuja la barra y abre el flujo en vivo.
   *  Devuelve el usuario ya verificado contra el servidor. */
  async function iniciar({ permiso } = {}) {
    if (!token()) return salir(), new Promise(() => {});
    try { usuario = await api('/auth/me'); }
    catch { return salir('expirada'), new Promise(() => {}); }

    localStorage.setItem('mdp_usuario', JSON.stringify(usuario));
    barra();

    if (permiso && !puede(permiso)) {
      document.querySelector('main').innerHTML =
        `<div class="tarjeta vacio">Su cargo (<strong>${ui.esc(usuario.cargo)}</strong>)
         no tiene acceso a esta pantalla.</div>`;
      return null;
    }
    vivo.conectar();
    return usuario;
  }

  return { api, iniciar, puede, vivo, ui, salir, get usuario() { return usuario; } };
})();
