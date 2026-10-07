-- ============================================================================
--  Migracion 01 — Calendario de tareas y controles
--
--  Agrega la agenda de trabajo y, sobre todo, el registro de traspasos: cada
--  cambio de estado o de responsable queda como una fila con la duracion de la
--  fase que termina. Esa tabla es la que permite medir cuanto tardo cada etapa
--  y cuantas manos paso un trabajo, en vez de solo cuanto tardo en total.
--
--  Aplicar sobre una instalacion existente:
--      mysql -u root matriz_mdp < db/migracion-01-calendario.sql
--  En una instalacion nueva ya viene incluida en schema.sql.
-- ============================================================================

SET NAMES utf8mb4;

-- ─── Tareas y controles agendados ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `tareas` (
  `id`            INT AUTO_INCREMENT PRIMARY KEY,
  `codigo`        VARCHAR(30)  NOT NULL,
  `titulo`        VARCHAR(200) NOT NULL,
  `descripcion`   VARCHAR(1000) DEFAULT NULL,
  `tipo`          ENUM('Tarea','Control') NOT NULL DEFAULT 'Tarea',

  -- Un control agendado verifica un control concreto de un riesgo concreto.
  `riesgo_id`     INT DEFAULT NULL,
  `control_id`    INT DEFAULT NULL,

  `fecha_programada` DATE NOT NULL,   -- cuando toca hacerlo
  `fecha_limite`     DATE DEFAULT NULL,
  `prioridad`     ENUM('Baja','Media','Alta') NOT NULL DEFAULT 'Media',

  `estado`        ENUM('Pendiente','En proceso','En revision','Completada','Cancelada')
                  NOT NULL DEFAULT 'Pendiente',
  `responsable_id` INT DEFAULT NULL,

  -- Marcas de tiempo del ciclo de vida. completada_en se fija al pasar a
  -- Completada; es el extremo con el que se mide el tiempo total de resolucion.
  `iniciada_en`   DATETIME DEFAULT NULL,
  `completada_en` DATETIME DEFAULT NULL,

  `creado_por`    INT DEFAULT NULL,
  `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY `uq_tarea_codigo` (`codigo`),
  KEY `ix_tarea_fecha`  (`fecha_programada`),
  KEY `ix_tarea_estado` (`estado`),
  KEY `ix_tarea_resp`   (`responsable_id`),
  CONSTRAINT `fk_tarea_riesgo`  FOREIGN KEY (`riesgo_id`)      REFERENCES `riesgos`(`id`)   ON DELETE SET NULL,
  CONSTRAINT `fk_tarea_control` FOREIGN KEY (`control_id`)     REFERENCES `controles`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tarea_resp`    FOREIGN KEY (`responsable_id`) REFERENCES `usuarios`(`id`)  ON DELETE SET NULL,
  CONSTRAINT `fk_tarea_creador` FOREIGN KEY (`creado_por`)     REFERENCES `usuarios`(`id`)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Traspasos: una fila por cada cambio de estado o de responsable ─────────
-- duracion_segundos es cuanto duro la fase que TERMINA con este traspaso, de
-- modo que el promedio por etapa sale de un simple AVG, sin recorrer el
-- historial en la aplicacion.
CREATE TABLE IF NOT EXISTS `tarea_traspasos` (
  `id`                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  `tarea_id`           INT NOT NULL,
  `estado_desde`       VARCHAR(20) DEFAULT NULL,   -- NULL en el alta
  `estado_hasta`       VARCHAR(20) NOT NULL,
  `responsable_desde_id` INT DEFAULT NULL,
  `responsable_hasta_id` INT DEFAULT NULL,
  `cambio_estado`      TINYINT(1) NOT NULL DEFAULT 0,
  `cambio_responsable` TINYINT(1) NOT NULL DEFAULT 0,
  `duracion_segundos`  INT DEFAULT NULL,           -- lo que duro la fase anterior
  `nota`               VARCHAR(500) DEFAULT NULL,
  `usuario_id`         INT DEFAULT NULL,           -- quien hizo el cambio
  `created_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY `ix_traspaso_tarea`  (`tarea_id`, `created_at`),
  KEY `ix_traspaso_estado` (`estado_desde`),
  CONSTRAINT `fk_traspaso_tarea`   FOREIGN KEY (`tarea_id`)   REFERENCES `tareas`(`id`)   ON DELETE CASCADE,
  CONSTRAINT `fk_traspaso_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_traspaso_rd`      FOREIGN KEY (`responsable_desde_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_traspaso_rh`      FOREIGN KEY (`responsable_hasta_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Permisos del modulo ────────────────────────────────────────────────────
INSERT IGNORE INTO `permisos` (`clave`, `modulo`, `descripcion`) VALUES
  ('tareas.ver',      'Calendario', 'Ver el calendario y el detalle de cada tarea'),
  ('tareas.crear',    'Calendario', 'Agendar tareas y controles'),
  ('tareas.editar',   'Calendario', 'Modificar tareas agendadas'),
  ('tareas.eliminar', 'Calendario', 'Eliminar tareas'),
  ('tareas.avanzar',  'Calendario', 'Cambiar el estado o el responsable de una tarea'),
  ('tareas.metricas', 'Calendario', 'Ver los tiempos por fase y por responsable');

-- Administrador: todo. Los demas cargos, segun lo que ya podian hacer.
INSERT IGNORE INTO `cargo_permisos` (`cargo_id`, `permiso_id`)
  SELECT c.id, p.id FROM `cargos` c CROSS JOIN `permisos` p
   WHERE c.nombre = 'Administrador' AND p.modulo = 'Calendario';

INSERT IGNORE INTO `cargo_permisos` (`cargo_id`, `permiso_id`)
  SELECT c.id, p.id FROM `cargos` c JOIN `permisos` p
   WHERE c.nombre = 'Supervisor' AND p.clave IN
     ('tareas.ver','tareas.crear','tareas.editar','tareas.avanzar','tareas.metricas');

INSERT IGNORE INTO `cargo_permisos` (`cargo_id`, `permiso_id`)
  SELECT c.id, p.id FROM `cargos` c JOIN `permisos` p
   WHERE c.nombre = 'Analista' AND p.clave IN
     ('tareas.ver','tareas.crear','tareas.avanzar');

INSERT IGNORE INTO `cargo_permisos` (`cargo_id`, `permiso_id`)
  SELECT c.id, p.id FROM `cargos` c JOIN `permisos` p
   WHERE c.nombre = 'Consulta' AND p.clave IN ('tareas.ver');
