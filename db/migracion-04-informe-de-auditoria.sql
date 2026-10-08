-- ============================================================================
--  Migracion 04 — La tarea como informe de auditoria / control
--
--  Una tarea deja de ser solo "titulo + fecha" y pasa a cargar lo que lleva
--  un informe de auditoria o control: antecedentes, el area auditada, y una
--  lista de hallazgos. Cada hallazgo arrastra su propia cadena completa:
--
--    hallazgo -> riesgo encontrado -> recomendacion (equipo de auditoria)
--             -> plan de accion (lo que el area auditada se compromete a hacer)
--             -> responsable y area a la que se le adjudica
--
--  El tipo de trabajo pasa a ser texto libre validado por el servidor, porque
--  la clasificacion todavia se esta puliendo con el area: hoy son "Tarea
--  programada" y "Control extraordinario", y cambiar esa lista no deberia
--  obligar a migrar la base cada vez.
--
--      mysql -u root matriz_mdp < db/migracion-04-informe-de-auditoria.sql
-- ============================================================================

SET NAMES utf8mb4;

-- ─── Paso 1: el tipo pasa a texto libre validado por el servidor ────────────
ALTER TABLE `tareas`
  MODIFY COLUMN `tipo` VARCHAR(40) NOT NULL DEFAULT 'Tarea programada';

-- Lo que habia se traslada al vocabulario nuevo. 'Auditoria' y 'Control
-- programado' eran trabajo planificado: quedan como 'Tarea programada'. Las
-- 'Especial' se conservan tal cual, porque siguen siendo los casos reservados
-- (hurto, acoso, canal de denuncias) con su propia regla de visibilidad.
UPDATE `tareas` SET `tipo` = 'Tarea programada'
  WHERE `tipo` IN ('Auditoria', 'Control programado');

-- ─── Paso 2: datos de cabecera del informe ──────────────────────────────────
ALTER TABLE `tareas`
  ADD COLUMN IF NOT EXISTS `antecedentes` TEXT DEFAULT NULL
    COMMENT 'Contexto previo del trabajo' AFTER `descripcion`,
  ADD COLUMN IF NOT EXISTS `area_auditada` VARCHAR(200) DEFAULT NULL
    COMMENT 'Area o proceso auditado o controlado' AFTER `antecedentes`;

-- ─── Paso 3: los hallazgos, con su cadena completa ──────────────────────────
-- Un hallazgo no vive solo: lleva el riesgo que implica, la recomendacion del
-- equipo de auditoria, el plan de accion que el area auditada se compromete a
-- cumplir, y a quien se le adjudica (persona y area). Por eso es una fila por
-- hallazgo y no columnas sueltas en la tarea.
CREATE TABLE IF NOT EXISTS `tarea_hallazgos` (
  `id`               INT AUTO_INCREMENT PRIMARY KEY,
  `tarea_id`         INT NOT NULL,
  `orden`            INT NOT NULL DEFAULT 0,
  `hallazgo`         TEXT NOT NULL,
  `riesgo`           TEXT DEFAULT NULL           COMMENT 'Riesgo encontrado',
  `recomendacion`    TEXT DEFAULT NULL           COMMENT 'Del equipo de auditoria',
  `plan_accion`      TEXT DEFAULT NULL           COMMENT 'Compromiso del area auditada',
  `responsable_id`   INT DEFAULT NULL            COMMENT 'Quien ejecuta el plan de accion',
  `area_responsable` VARCHAR(200) DEFAULT NULL   COMMENT 'Area a la que se adjudica',
  `fecha_compromiso` DATE DEFAULT NULL           COMMENT 'Fecha limite del plan de accion',
  `estado`           VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
                     COMMENT 'Pendiente / En proceso / Cumplido',
  CONSTRAINT `fk_hallazgo_tarea` FOREIGN KEY (`tarea_id`)
    REFERENCES `tareas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_hallazgo_resp` FOREIGN KEY (`responsable_id`)
    REFERENCES `usuarios` (`id`) ON DELETE SET NULL,
  KEY `ix_hallazgo_tarea` (`tarea_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
