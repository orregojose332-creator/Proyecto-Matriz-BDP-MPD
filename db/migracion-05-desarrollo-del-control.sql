-- ============================================================================
--  Migracion 05 — Situacion y desarrollo del control
--
--  El informe suma un campo mas: la descripcion de la situacion y de como se
--  llevo a cabo el control o la auditoria. Los 'antecedentes' dicen que motivo
--  el trabajo (el antes); el 'desarrollo' cuenta que se hizo y como (el durante).
--
--      mysql -u root matriz_mdp < db/migracion-05-desarrollo-del-control.sql
-- ============================================================================

SET NAMES utf8mb4;

ALTER TABLE `tareas`
  ADD COLUMN IF NOT EXISTS `desarrollo` TEXT DEFAULT NULL
    COMMENT 'Situacion y como se llevo a cabo el control / la auditoria'
    AFTER `antecedentes`;
