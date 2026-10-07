# Matriz MDP

Sistema de **matriz de riesgos LD/FT** con usuarios, cargos, permisos, gráficos y
actualización en vivo. Construido sobre el enfoque basado en riesgos que exige
SEPRELAD en Paraguay.

## Qué hace

- **Matriz de riesgos** sobre los cuatro factores obligatorios: clientes,
  productos y servicios, canales de distribución y zona geográfica.
- **Cálculo automático**: riesgo inherente = probabilidad × impacto (escala 1–25);
  los controles cargados reducen el residual hasta un 80%.
- **Usuarios con contraseña** (hash bcrypt, coste 12) y **cargos con permisos**
  configurables desde pantalla, sin tocar código.
- **Tablero con gráficos**: KPIs, riesgo por factor, distribución por nivel y
  mapa de calor 5×5.
- **Actualización instantánea**: lo que carga un usuario aparece en las pantallas
  de los demás sin refrescar.
- **Bitácora de auditoría** de quién hizo qué y cuándo.

## Instalación

Requiere **Node 18 o superior** y **MySQL/MariaDB** (sirve el de XAMPP).

```bash
npm install
cp .env.example .env        # completar, sobre todo JWT_SECRET
npm run init-db             # crea la base, las tablas y los catálogos
npm run crear-admin         # crea el primer administrador
npm start                   # http://localhost:3100
```

Para generar el `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

El servidor **no arranca sin esa clave**: sin ella cualquiera podría fabricarse
un token de administrador.

## Cargos que vienen cargados

| Cargo | Puede |
|---|---|
| **Administrador** | Todo, incluidos usuarios, cargos, catálogos y auditoría |
| **Supervisor** | Ver, crear y editar riesgos, **aprobar**, gestionar controles y ciclos, ver auditoría |
| **Analista** | Ver, crear y editar riesgos y controles. No aprueba |
| **Consulta** | Solo lectura de la matriz y los reportes, con exportación |

Los permisos viven en tablas (`permisos`, `cargo_permisos`), así que agregar un
cargo o cambiar lo que puede hacer se hace desde la pantalla **Cargos** y aplica
de inmediato, sin volver a iniciar sesión y sin desplegar código.

## Cómo funciona la actualización en vivo

El servidor mantiene un flujo **SSE** (`/api/eventos`) con cada pestaña abierta.
Toda operación que cambia datos emite un evento (`riesgos`, `usuarios`, `cargos`,
`evaluaciones`) y cada pantalla vuelve a pedir lo suyo. El indicador de la barra
superior muestra **En vivo** cuando el flujo está conectado y **Reconectando**
cuando se cortó; el navegador reintenta solo cada 3 segundos.

No se usa *polling*: no hay consultas repetidas contra la base cuando no pasa nada.

## Metodología de cálculo

```
inherente = probabilidad × impacto                    (1 a 25)
mitigación = (promedio de efectividad / 5) × 0,80     (0 a 0,80)
residual  = inherente × (1 − mitigación)
```

| Valor | Nivel |
|---|---|
| 1 – 4 | Bajo |
| 5 – 9 | Moderado |
| 10 – 14 | Alto |
| 15 – 25 | Crítico |

El tope de mitigación en 80% es deliberado: ningún control elimina el riesgo por
completo, y mostrar un residual de cero daría una falsa seguridad.

Los umbrales y el tope están en `server.js` (`UMBRALES`, `MITIGACION_MAXIMA`), en
un solo lugar, y el servidor los expone en `/api/catalogos` para que el frontend
no los duplique.

## Navegación

Los módulos viven en una barra lateral izquierda, cada uno con su icono. El
botón de hamburguesa la contrae a solo iconos para ganar ancho de contenido, y
la preferencia se recuerda en el navegador de cada usuario, así que sobrevive
al cambio de pantalla.

Por debajo de 860px de ancho la lateral pasa a ser un cajón que se desliza
sobre el contenido; se cierra al tocar fuera, con Escape o al elegir un módulo.

La lateral solo lista los módulos que el cargo del usuario puede abrir, pero eso
es comodidad visual: el permiso se verifica igual en el servidor.

## Seguridad

- Contraseñas en **bcrypt** coste 12. Nunca en claro, ni en la base, ni en la
  bitácora, ni en las respuestas de la API.
- **Los permisos se verifican en el servidor en cada petición.** Ocultar un botón
  es comodidad visual, no un control de acceso.
- Consultas **parametrizadas** en todas las rutas.
- **Bloqueo temporal** tras 5 intentos fallidos (configurable).
- El error de ingreso es siempre el mismo, no revela si el usuario existe.
- `JWT_SECRET` fuera del código, en `.env`, que no se versiona.
- Un administrador no puede degradarse a sí mismo ni quitarle a su propio cargo
  el permiso de gestionar cargos: evita dejar el sistema sin quien lo administre.

## Estructura

```
server.js            API REST + SSE + archivos estáticos
db/schema.sql        tablas
db/seed.sql          permisos, cargos, factores, subfactores y escalas
scripts/init-db.js   crea la base y aplica schema + seed
scripts/crear-admin.js   alta del primer administrador
public/              pantallas (HTML + JS sin framework)
  app.css            tokens de color, claro y oscuro
  app.js             sesión, permisos, cliente SSE, barra lateral y utilidades
  Login · Reportes · Matriz · Usuarios · Cargos · Auditoria
```

## Pendiente de definir con el oficial de cumplimiento

- **La ponderación de los cuatro factores** arranca en 25% cada uno. SEPRELAD fija
  los factores mínimos pero no los pesos: los define la metodología aprobada
  internamente. Se cambian en la tabla `factores`.
- **Los subfactores sembrados son un punto de partida habitual**, no una lista
  oficial. Hay que ajustarlos a la actividad real del sujeto obligado.
- **La resolución aplicable depende del sector** (bancos, casas de cambio,
  cooperativas, inmobiliarias y otros sujetos obligados tienen reglamentos
  distintos). Puede exigir campos adicionales a los de este esquema.
