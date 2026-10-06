-- ============================================================================
--  Matriz MDP — datos iniciales
--  Carga catalogos, permisos y cargos. NO crea usuarios: el primer
--  administrador se crea con `npm run crear-admin`, para no dejar una
--  contrasena por defecto escrita en el repositorio.
-- ============================================================================

SET NAMES utf8mb4;

-- ─── Permisos ───────────────────────────────────────────────────────────────
INSERT INTO `permisos` (`clave`, `modulo`, `descripcion`) VALUES
  ('riesgos.ver',           'Riesgos',        'Ver la matriz y el detalle de cada riesgo'),
  ('riesgos.crear',         'Riesgos',        'Dar de alta riesgos nuevos'),
  ('riesgos.editar',        'Riesgos',        'Modificar riesgos existentes'),
  ('riesgos.eliminar',      'Riesgos',        'Eliminar riesgos'),
  ('riesgos.aprobar',       'Riesgos',        'Aprobar o cerrar riesgos revisados'),
  ('controles.gestionar',   'Controles',      'Cargar y editar controles mitigantes'),
  ('evaluaciones.gestionar','Evaluaciones',   'Crear, abrir y cerrar ciclos de evaluacion'),
  ('reportes.ver',          'Reportes',       'Ver el tablero y los graficos'),
  ('reportes.exportar',     'Reportes',       'Exportar reportes a Excel o CSV'),
  ('usuarios.gestionar',    'Administracion', 'Alta, baja y modificacion de usuarios'),
  ('cargos.gestionar',      'Administracion', 'Definir cargos y asignarles permisos'),
  ('catalogos.gestionar',   'Administracion', 'Editar factores, subfactores y escalas'),
  ('auditoria.ver',         'Administracion', 'Consultar la bitacora de auditoria');

-- ─── Cargos ─────────────────────────────────────────────────────────────────
INSERT INTO `cargos` (`nombre`, `descripcion`, `es_sistema`) VALUES
  ('Administrador', 'Control total del sistema, usuarios y configuracion.', 1),
  ('Supervisor',    'Revisa, aprueba y cierra riesgos. Gestiona ciclos de evaluacion.', 0),
  ('Analista',      'Carga y edita riesgos y controles. No aprueba.', 0),
  ('Consulta',      'Solo lectura de la matriz y los reportes.', 0);

-- Administrador: todos los permisos existentes, presentes y futuros los agrega
-- la pantalla de cargos.
INSERT INTO `cargo_permisos` (`cargo_id`, `permiso_id`)
  SELECT c.id, p.id FROM `cargos` c CROSS JOIN `permisos` p WHERE c.nombre = 'Administrador';

INSERT INTO `cargo_permisos` (`cargo_id`, `permiso_id`)
  SELECT c.id, p.id FROM `cargos` c JOIN `permisos` p
  WHERE c.nombre = 'Supervisor' AND p.clave IN (
    'riesgos.ver','riesgos.crear','riesgos.editar','riesgos.aprobar',
    'controles.gestionar','evaluaciones.gestionar',
    'reportes.ver','reportes.exportar','auditoria.ver');

INSERT INTO `cargo_permisos` (`cargo_id`, `permiso_id`)
  SELECT c.id, p.id FROM `cargos` c JOIN `permisos` p
  WHERE c.nombre = 'Analista' AND p.clave IN (
    'riesgos.ver','riesgos.crear','riesgos.editar',
    'controles.gestionar','reportes.ver');

INSERT INTO `cargo_permisos` (`cargo_id`, `permiso_id`)
  SELECT c.id, p.id FROM `cargos` c JOIN `permisos` p
  WHERE c.nombre = 'Consulta' AND p.clave IN (
    'riesgos.ver','reportes.ver','reportes.exportar');

-- ─── Factores de riesgo ─────────────────────────────────────────────────────
-- Los cuatro que la reglamentacion fija como minimo. La ponderacion arranca
-- repartida en partes iguales; se ajusta desde la pantalla de catalogos segun
-- la metodologia que apruebe el oficial de cumplimiento.
INSERT INTO `factores` (`clave`, `nombre`, `descripcion`, `ponderacion`, `orden`) VALUES
  ('clientes',  'Clientes',
   'Riesgos asociados a los clientes, personas fisicas o juridicas: antecedentes, actividad y comportamiento al inicio y durante la relacion comercial.', 25.00, 1),
  ('productos', 'Productos y servicios',
   'Riesgos asociados a los productos y servicios ofrecidos por cuenta propia, en la etapa de diseno o desarrollo y durante su vigencia.', 25.00, 2),
  ('canales',   'Canales de distribucion',
   'Riesgos asociados a los modelos y medios de distribucion, incluidas las relaciones comerciales concertadas por web u otros medios interactivos.', 25.00, 3),
  ('zona',      'Zona geografica',
   'Riesgos asociados a las zonas donde se ofrecen los productos y servicios, local e internacionalmente, segun seguridad, indices de criminalidad y caracteristicas economico-financieras y socio-demograficas.', 25.00, 4);

-- ─── Subfactores de ejemplo ─────────────────────────────────────────────────
-- Punto de partida habitual. Se editan desde la pantalla de catalogos para
-- reflejar la actividad real del sujeto obligado.
INSERT INTO `subfactores` (`factor_id`, `nombre`, `descripcion`)
  SELECT f.id, s.nombre, s.descripcion FROM `factores` f JOIN (
    SELECT 'clientes' AS cl, 'Persona expuesta politicamente (PEP)' AS nombre, 'Cliente PEP, su entorno familiar o allegados cercanos.' AS descripcion
    UNION ALL SELECT 'clientes', 'Persona juridica con estructura compleja', 'Cadena de titularidad que dificulta identificar al beneficiario final.'
    UNION ALL SELECT 'clientes', 'Cliente no residente', 'Domicilio o nacionalidad fuera del pais.'
    UNION ALL SELECT 'clientes', 'Alto volumen de operaciones en efectivo', 'Movimientos en efectivo desproporcionados al perfil declarado.'
    UNION ALL SELECT 'clientes', 'Cliente nuevo sin historial', 'Relacion comercial reciente, sin comportamiento observable.'
    UNION ALL SELECT 'clientes', 'Actividad economica de alto riesgo', 'Rubro senalado como vulnerable en la evaluacion nacional de riesgos.'
    UNION ALL SELECT 'productos', 'Operaciones en efectivo', 'Productos liquidados total o parcialmente en efectivo.'
    UNION ALL SELECT 'productos', 'Transferencias internacionales', 'Envio o recepcion de fondos desde o hacia el exterior.'
    UNION ALL SELECT 'productos', 'Productos de alto valor unitario', 'Bienes o servicios de monto elevado y facil reventa.'
    UNION ALL SELECT 'productos', 'Operaciones por cuenta de terceros', 'El ordenante no coincide con el beneficiario declarado.'
    UNION ALL SELECT 'canales',   'Atencion presencial en sucursal', 'Contacto cara a cara, con verificacion directa de identidad.'
    UNION ALL SELECT 'canales',   'Venta a distancia o por web', 'Relacion concertada sin presencia fisica del cliente.'
    UNION ALL SELECT 'canales',   'Intermediarios o distribuidores', 'Terceros que originan la relacion comercial.'
    UNION ALL SELECT 'canales',   'Corresponsales no bancarios', 'Puntos de atencion operados por terceros.'
    UNION ALL SELECT 'zona',      'Zona de frontera', 'Area fronteriza con mayor exposicion al contrabando y al trasiego de efectivo.'
    UNION ALL SELECT 'zona',      'Zona con alto indice de criminalidad', 'Localidad con indicadores de criminalidad por encima de la media.'
    UNION ALL SELECT 'zona',      'Jurisdiccion extranjera no cooperante', 'Pais senalado por deficiencias en materia ALA/CFT.'
    UNION ALL SELECT 'zona',      'Area urbana de bajo riesgo', 'Zona con controles consolidados y baja exposicion.'
  ) s ON s.cl = f.clave;

-- ─── Escalas ────────────────────────────────────────────────────────────────
INSERT INTO `niveles` (`tipo`, `valor`, `etiqueta`, `descripcion`) VALUES
  ('probabilidad', 1, 'Muy baja', 'Ocurrencia excepcional; sin antecedentes conocidos.'),
  ('probabilidad', 2, 'Baja',     'Podria ocurrir, pero no se registraron casos recientes.'),
  ('probabilidad', 3, 'Media',    'Puede ocurrir en algun momento del periodo evaluado.'),
  ('probabilidad', 4, 'Alta',     'Probable; hay antecedentes en el ultimo periodo.'),
  ('probabilidad', 5, 'Muy alta', 'Casi seguro; ocurre de forma recurrente.'),
  ('impacto', 1, 'Insignificante', 'Sin efecto regulatorio ni reputacional relevante.'),
  ('impacto', 2, 'Menor',          'Observacion interna, subsanable en el corto plazo.'),
  ('impacto', 3, 'Moderado',       'Observacion del supervisor; requiere plan de accion.'),
  ('impacto', 4, 'Mayor',          'Sancion probable y dano reputacional considerable.'),
  ('impacto', 5, 'Catastrofico',   'Sancion grave, riesgo sobre la licencia y dano severo.');

-- ─── Primer ciclo de evaluacion ─────────────────────────────────────────────
INSERT INTO `evaluaciones` (`nombre`, `periodo_desde`, `periodo_hasta`, `metodologia_version`, `estado`)
  VALUES (CONCAT('Evaluacion ', YEAR(CURDATE())), MAKEDATE(YEAR(CURDATE()), 1),
          MAKEDATE(YEAR(CURDATE()), 1) + INTERVAL 1 YEAR - INTERVAL 1 DAY, '1.0', 'Abierta');
