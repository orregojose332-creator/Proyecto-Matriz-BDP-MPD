/* Aplica las preferencias del usuario (tema, tamaño y tipo de letra) ANTES de
 * que la página pinte, para que no haya un parpadeo de tema. Se guarda una copia
 * en localStorage; la base es la autoridad y app.js la reconcilia al entrar.
 * Va en el <head> de cada pantalla, antes del contenido. */
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('mdp_prefs') || '{}');
    var el = document.documentElement;

    // Tema: 'auto' sigue al sistema (sin atributo); el resto fuerza uno.
    var attr = { claro: 'light', oscuro: 'dark', gris: 'gris' };
    if (p.tema && attr[p.tema]) el.setAttribute('data-theme', attr[p.tema]);
    else el.removeAttribute('data-theme');

    // Tamaño del texto: escala toda la vista (como el zoom del navegador).
    var zoom = { sm: 0.92, md: 1, lg: 1.12 }[p.tam] || 1;
    el.style.zoom = zoom;

    // Tipo de letra: redefine el token --sans que usa toda la interfaz.
    var fam = {
      serif: 'Georgia, "Times New Roman", serif',
      mono:  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    }[p.fuente];
    if (fam) el.style.setProperty('--sans', fam);
    else el.style.removeProperty('--sans');
  } catch (e) { /* sin preferencias guardadas: quedan las de por defecto */ }
})();
