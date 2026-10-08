-- ============================================================================
--  Migracion 03 — Tipos de tarea y casos especiales
--
--  Las tareas dejan de ser 'Tarea' o 'Control' y pasan a tres tipos con
--  significado propio:
--
--    Auditoria           revision planificada sobre un proceso o area
--    Control programado  verificacion periodica de un control de la matriz
--    Especial            caso puntual: hurto, acoso, canal de denuncias
--
--  Las Especiales no son trabajo de rutina: nacen de un hecho concreto, suelen
--  involucrar a personas identificadas y en varios casos llegan por un canal de
--  denuncias. Por eso traen su propia categoria y un indicador de
--  confidencialidad que restringe quien puede verlas.
--
--      mysql -u root matriz_mdp < db/migracion-03-tipos-de-tarea.sql
-- ============================================================================

SET NAMES utf8mb4;

-- ─── Paso 1: liberar la columna del ENUM viejo ──────────────────────────────
ALTER TABLE `tareas` MODIFY COLUMN `tipo` VARCHAR(30) NOT NULL DEFAULT 'Auditoria';

-- ─── Paso 2: trasladar los valores existentes ───────────────────────────────
-- 'Control' describia la verificacion de un control de la matriz; 'Tarea' era
-- el cajon generico, y lo mas cercano en la clasificacion nueva es Auditoria.
UPDATE `tareas` SET `tipo` = 'Control programado' WHERE `tipo` = 'Control';
UPDATE `tareas` SET `tipo` = 'Auditoria'          WHERE `tipo` = 'Tarea';

-- ─── Paso 3: fijar el ENUM nuevo ────────────────────────────────────────────
ALTER TABLE `tareas`
  MODIFY COLUMN `tipo` ENUM('Auditoria','Control programado','Especial')
    NOT NULL DEFAULT 'Auditoria';

-- ─── Paso 4: datos propios de los casos especiales ──────────────────────────
ALTER TABLE `tareas`
  ADD COLUMN IF NOT EXISTS `categoria_especial`
    ENUM('Hurto','Acoso','Canal de denuncias','Conflicto de interes','Fraude interno','Otro')
    DEFAULT NULL COMMENT 'Solo para tipo Especial: de que caso se trata',
  ADD COLUMN IF NOT EXISTS `confidencial` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Restringe la visibilidad a los cargos con tareas.confidencial y al responsable';

-- Toda Especial que ya existiera queda confidencial: es el lado seguro del
-- error si alguna se hubiera cargado antes de esta migracion.
UPDATE `tareas` SET `confidencial` = 1 WHERE `tipo` = 'Especial';

CREATE INDEX IF NOT EXISTS `ix_tarea_tipo` ON `tareas` (`tipo`);

-- ─── Paso 5: permiso para ver los casos confidenciales ──────────────────────
INSERT IGNORE INTO `permisos` (`clave`, `modulo`, `descripcion`) VALUES
  ('tareas.confidencial', 'Calendario',
   'Ver las tareas marcadas como confidenciales (hurto, acoso, denuncias)');

-- Administrador y Supervisor. Sin el permiso igual ven el caso su responsable
-- asignado (sin eso no podria trabajarlo) y quien lo registro.
INSERT IGNORE INTO `cargo_permisos` (`cargo_id`, `permiso_id`)
  SELECT c.id, p.id FROM `cargos` c JOIN `permisos` p
   WHERE c.nombre IN ('Administrador','Supervisor') AND p.clave = 'tareas.confidencial';
