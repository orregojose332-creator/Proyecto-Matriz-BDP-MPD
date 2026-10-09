-- ============================================================================
--  Migracion 06 — Preferencias de cada usuario
--
--  Cada persona puede elegir su foto de perfil, el tema de fondo (automatico,
--  claro, gris u oscuro), el tamano del texto y el tipo de letra. Son datos
--  del usuario (no del navegador), asi que lo acompanan de un equipo a otro.
--
--  La foto se guarda como un data URL ya reducido en el navegador (160 px,
--  JPEG): pesa unos pocos KB, por eso entra en una columna de texto sin
--  necesidad de servir archivos ni rutas en disco.
--
--      mysql -u root matriz_mdp < db/migracion-06-preferencias.sql
-- ============================================================================

SET NAMES utf8mb4;

ALTER TABLE `usuarios`
  ADD COLUMN IF NOT EXISTS `foto` MEDIUMTEXT DEFAULT NULL
    COMMENT 'Avatar como data URL reducido (opcional)',
  ADD COLUMN IF NOT EXISTS `pref_tema` VARCHAR(10) NOT NULL DEFAULT 'auto'
    COMMENT 'auto | claro | gris | oscuro',
  ADD COLUMN IF NOT EXISTS `pref_tam` VARCHAR(10) NOT NULL DEFAULT 'md'
    COMMENT 'sm | md | lg  (tamano del texto)',
  ADD COLUMN IF NOT EXISTS `pref_fuente` VARCHAR(12) NOT NULL DEFAULT 'sistema'
    COMMENT 'sistema | serif | mono';
