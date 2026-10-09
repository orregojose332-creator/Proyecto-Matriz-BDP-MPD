/* Prueba en navegador de la Configuración por usuario: avatar, temas, tamaño
 * y tipo de letra; que la vista previa se aplique al instante, se guarde en la
 * base y persista al cambiar de pantalla.
 *   node pruebas/prueba-config.js       (con el servidor en el 3100)
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';
let fallas=0; const ok=(c,t)=>{console.log(c?`  OK   ${t}`:`  FALLA ${t}`); if(!c)fallas++;};
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await (await nav.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', e => { fallas++; console.log('  PAGEERROR:', e.message); });
  p.on('console', m => { if (m.type()==='error') { fallas++; console.log('  CONSOLE:', m.text()); } });
  await p.goto(BASE+'/Login.html'); await p.fill('#usuario','admin'); await p.fill('#clave','ClaveDePrueba123');
  await Promise.all([p.waitForURL('**/Reportes.html'), p.click('#btn')]);

  console.log('\n--- NAVEGACIÓN Y AVATAR ---');
  ok(await p.locator('.lateral a[href="Configuracion.html"]').count() === 1, 'Configuración aparece en la barra lateral');
  ok((await p.locator('.sesion .avatar').textContent()).trim() === 'JO', 'avatar con iniciales JO');

  console.log('\n--- PÁGINA DE CONFIGURACIÓN ---');
  await p.goto(BASE+'/Configuracion.html'); await p.waitForSelector('#temas .tema-op');
  ok(await p.locator('.tema-op').count() === 4, 'cuatro temas (auto, claro, gris, oscuro)');
  ok(await p.locator('input[name="tema"][value="auto"]').isChecked(), 'arranca en Automático');

  console.log('\n--- VISTA PREVIA INMEDIATA ---');
  // check() con force evita el problema de coordenadas de Playwright bajo zoom
  await p.evaluate(() => { const r=document.querySelector('input[name=tema][value=oscuro]'); r.checked=true; document.getElementById('temas').dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForTimeout(100);
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'Oscuro aplica data-theme=dark al instante');
  await p.selectOption('#s-fuente','serif'); await p.waitForTimeout(80);
  ok(/Georgia/.test(await p.evaluate(() => document.documentElement.style.getPropertyValue('--sans'))), 'Serif cambia la fuente');
  await p.selectOption('#s-tam','lg'); await p.waitForTimeout(80);
  ok(await p.evaluate(() => document.documentElement.style.zoom) === '1.12', 'Grande aplica zoom 1.12');

  console.log('\n--- FOTO DE PERFIL ---');
  // inyectar un archivo en el input y disparar el redimensionado real
  await p.setInputFiles('#in-foto', { name:'a.png', mimeType:'image/png',
    buffer: Buffer.from(PNG.split(',')[1],'base64') });
  await p.waitForFunction(() => document.querySelector('#avatar-preview img'), { timeout: 4000 });
  ok(await p.locator('#avatar-preview img.avatar').count() === 1, 'la foto se previsualiza como avatar');

  console.log('\n--- GUARDAR Y PERSISTIR ---');
  await p.evaluate(() => { const r=document.querySelector('input[name=tema][value=gris]'); r.checked=true; document.getElementById('temas').dispatchEvent(new Event('change',{bubbles:true})); });
  await p.locator('#btn-guardar').dispatchEvent('click');
  await p.waitForSelector('.toast.ok', { timeout: 6000 });
  ok(/guardadas/i.test(await p.locator('.toast.ok .txt').textContent()), 'avisa "Preferencias guardadas"');

  await p.goto(BASE+'/Riesgos.html'); await p.waitForSelector('main');
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'gris', 'al cambiar de página sigue en tema Gris');
  ok(await p.evaluate(() => document.documentElement.style.zoom) === '1.12', 'mantiene el tamaño Grande');
  ok((await p.locator('.sesion .avatar').evaluate(el => el.tagName)) === 'IMG', 'la barra ahora muestra la foto (img)');

  const r = await p.evaluate(async () => {
    const t = localStorage.getItem('mdp_token');
    const me = await (await fetch('/api/auth/me', { headers:{ Authorization:'Bearer '+t } })).json();
    return { tema: me.pref_tema, tam: me.pref_tam, fuente: me.pref_fuente, foto: !!me.foto };
  });
  ok(r.tema==='gris'&&r.tam==='lg'&&r.fuente==='serif'&&r.foto, `la base guardó todo (${JSON.stringify(r)})`);

  // restaurar
  await p.evaluate(async () => { const t=localStorage.getItem('mdp_token');
    await fetch('/api/perfil',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},
      body: JSON.stringify({pref_tema:'auto',pref_tam:'md',pref_fuente:'sistema',foto:null})}); });

  console.log(fallas?`\n  ${fallas} FALLA(S)\n`:'\n  todo bien\n');
  await nav.close(); process.exit(fallas?1:0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
