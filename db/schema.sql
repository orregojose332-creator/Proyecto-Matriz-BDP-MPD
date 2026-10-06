-- ============================================================================
--  Matriz MDP — esquema de base de datos
--  Matriz de riesgos LD/FT segun el enfoque basado en riesgos de SEPRELAD.
--
--  Los cuatro factores de riesgo (clientes, productos/servicios, canales de
--  distribucion y zona geografica) son los minimos que la reglamentacion
--  exige ponderar. Se modelan como catalogo editable, no como enum, para que
--  cada sujeto obligado agregue los subfactores de su propia actividad.
--
--  Crear la base antes de ejecutar:
--      CREATE DATABASE matriz_mdp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─── Cargos y permisos ──────────────────────────────────────────────────────
-- Los permisos viven en tabla, no en el codigo: agregar un cargo o cambiar lo
-- que puede hacer es una operacion de pantalla, no un despliegue.

DROP TABLE IF EXISTS `cargo_permisos`;
DROP TABLE IF EXISTS `permisos`;
DROP TABLE IF EXISTS `cargos`;

CREATE TABLE `cargos` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `nombre`      VARCHAR(60)  NOT NULL,
  `descripcion` VARCHAR(255) DEFAULT NULL,
  -- Un cargo de sistema no se puede borrar; evita quedarse sin administradores.
  `es_sistema`  TINYINT(1)   NOT NULL DEFAULT 0,
  `activo`      TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_cargo_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `permisos` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `clave`       VARCHAR(60)  NOT NULL,   -- p.ej. 'riesgos.aprobar'
  `modulo`      VARCHAR(40)  NOT NULL,   -- agrupador para la pantalla de cargos
  `descripcion` VARCHAR(255) NOT NULL,
  UNIQUE KEY `uq_permiso_clave` (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cargo_permisos` (
  `cargo_id`   INT NOT NULL,
  `permiso_id` INT NOT NULL,
  PRIMARY KEY (`cargo_id`, `permiso_id`),
  CONSTRAINT `fk_cp_cargo`   FOREIGN KEY (`cargo_id`)   REFERENCES `cargos`(`id`)   ON DELETE CASCADE,
  CONSTRAINT `fk_cp_permiso` FOREIGN KEY (`permiso_id`) REFERENCES `permisos`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Usuarios ───────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS `usuarios`;
CREATE TABLE `usuarios` (
  `id`             INT AUTO_INCREMENT PRIMARY KEY,
  `nombre`         VARCHAR(120) NOT NULL,
  `username`       VARCHAR(60)  NOT NULL,
  -- Siempre hash bcrypt. La contrasena en claro no se guarda ni se registra.
  `password_hash`  VARCHAR(255) NOT NULL,
  `email`          VARCHAR(120) NOT NULL,
  `cargo_id`       INT          NOT NULL,
  `activo`         TINYINT(1)   NOT NULL DEFAULT 1,
  -- Bloqueo por intentos fallidos: frena el adivinado de contrasenas.
  `intentos_fallidos` INT       NOT NULL DEFAULT 0,
  `bloqueado_hasta`   DATETIME  DEFAULT NULL,
  `ultimo_acceso`  DATETIME     DEFAULT NULL,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_usuario_username` (`username`),
  UNIQUE KEY `uq_usuario_email`    (`email`),
  KEY `ix_usuario_cargo` (`cargo_id`),
  CONSTRAINT `fk_usuario_cargo` FOREIGN KEY (`cargo_id`) REFERENCES `cargos`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Catalogo de factores y subfactores ─────────────────────────────────────

DROP TABLE IF EXISTS `subfactores`;
DROP TABLE IF EXISTS `factores`;

CREATE TABLE `factores` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `clave`       VARCHAR(30)  NOT NULL,
  `nombre`      VARCHAR(80)  NOT NULL,
  `descripcion` VARCHAR(500) DEFAULT NULL,
  -- Peso relativo del factor en el riesgo global; los cuatro suman 100.
  `ponderacion` DECIMAL(5,2) NOT NULL DEFAULT 25.00,
  `orden`       INT          NOT NULL DEFAULT 0,
  UNIQUE KEY `uq_factor_clave` (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `subfactores` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `factor_id`   INT          NOT NULL,
  `nombre`      VARCHAR(160) NOT NULL,
  `descripcion` VARCHAR(500) DEFAULT NULL,
  `activo`      TINYINT(1)   NOT NULL DEFAULT 1,
  KEY `ix_subfactor_factor` (`factor_id`),
  CONSTRAINT `fk_subfactor_factor` FOREIGN KEY (`factor_id`) REFERENCES `factores`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Escalas de probabilidad e impacto ──────────────────────────────────────
-- Escala 1..5 en ambos ejes: el producto da el riesgo inherente sobre 25.

DROP TABLE IF EXISTS `niveles`;
CREATE TABLE `niveles` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `tipo`        ENUM('probabilidad','impacto') NOT NULL,
  `valor`       TINYINT      NOT NULL,          -- 1..5
  `etiqueta`    VARCHAR(40)  NOT NULL,
  `descripcion` VARCHAR(255) DEFAULT NULL,
  UNIQUE KEY `uq_nivel` (`tipo`, `valor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Evaluaciones ───────────────────────────────────────────────────────────
-- SEPRELAD exige rehacer la evaluacion de riesgos al menos cada 2 anios y
-- revisar la metodologia al menos cada 4. Cada ciclo es una fila aqui, de modo
-- que el historico queda disponible para la supervision.

DROP TABLE IF EXISTS `evaluaciones`;
CREATE TABLE `evaluaciones` (
  `id`                  INT AUTO_INCREMENT PRIMARY KEY,
  `nombre`              VARCHAR(120) NOT NULL,
  `periodo_desde`       DATE         NOT NULL,
  `periodo_hasta`       DATE         NOT NULL,
  `metodologia_version` VARCHAR(40)  NOT NULL DEFAULT '1.0',
  `estado`              ENUM('Abierta','Cerrada') NOT NULL DEFAULT 'Abierta',
  `creado_por`          INT          DEFAULT NULL,
  `created_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `ix_eval_estado` (`estado`),
  CONSTRAINT `fk_eval_usuario` FOREIGN KEY (`creado_por`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Riesgos ────────────────────────────────────────────────────────────────
-- inherente_valor y residual_valor se calculan en el servidor y se guardan
-- para que los reportes agreguen sin recalcular en cada consulta.

DROP TABLE IF EXISTS `controles`;
DROP TABLE IF EXISTS `riesgos`;

CREATE TABLE `riesgos` (
  `id`                  INT AUTO_INCREMENT PRIMARY KEY,
  `evaluacion_id`       INT          NOT NULL,
  `codigo`              VARCHAR(30)  NOT NULL,
  `factor_id`           INT          NOT NULL,
  `subfactor_id`        INT          DEFAULT NULL,
  `descripcion`         VARCHAR(500) NOT NULL,
  `probabilidad`        TINYINT      NOT NULL,   -- 1..5
  `impacto`             TINYINT      NOT NULL,   -- 1..5
  `inherente_valor`     DECIMAL(6,2) NOT NULL DEFAULT 0,
  `inherente_nivel`     VARCHAR(20)  NOT NULL DEFAULT 'Bajo',
  `residual_valor`      DECIMAL(6,2) NOT NULL DEFAULT 0,
  `residual_nivel`      VARCHAR(20)  NOT NULL DEFAULT 'Bajo',
  `estado`              ENUM('Borrador','En revision','Aprobado','Cerrado') NOT NULL DEFAULT 'Borrador',
  `responsable_id`      INT          DEFAULT NULL,
  `fecha_identificacion` DATE        NOT NULL,
  `fecha_aprobacion`    DATETIME     DEFAULT NULL,
  `aprobado_por`        INT          DEFAULT NULL,
  `creado_por`          INT          DEFAULT NULL,
  `created_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_riesgo_codigo` (`evaluacion_id`, `codigo`),
  KEY `ix_riesgo_factor` (`factor_id`),
  KEY `ix_riesgo_estado` (`estado`),
  KEY `ix_riesgo_residual` (`residual_nivel`),
  CONSTRAINT `fk_riesgo_eval`      FOREIGN KEY (`evaluacion_id`) REFERENCES `evaluaciones`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_riesgo_factor`    FOREIGN KEY (`factor_id`)     REFERENCES `factores`(`id`),
  CONSTRAINT `fk_riesgo_subfactor` FOREIGN KEY (`subfactor_id`)  REFERENCES `subfactores`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_riesgo_resp`      FOREIGN KEY (`responsable_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_riesgo_aprob`     FOREIGN KEY (`aprobado_por`)   REFERENCES `usuarios`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_riesgo_creador`   FOREIGN KEY (`creado_por`)     REFERENCES `usuarios`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Controles / mitigantes ─────────────────────────────────────────────────

CREATE TABLE `controles` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `riesgo_id`   INT          NOT NULL,
  `descripcion` VARCHAR(500) NOT NULL,
  `tipo`        ENUM('Preventivo','Detectivo','Correctivo') NOT NULL DEFAULT 'Preventivo',
  `efectividad` TINYINT      NOT NULL DEFAULT 3,   -- 1..5
  `documentado` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `ix_control_riesgo` (`riesgo_id`),
  CONSTRAINT `fk_control_riesgo` FOREIGN KEY (`riesgo_id`) REFERENCES `riesgos`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Auditoria ──────────────────────────────────────────────────────────────
-- Toda la documentacion de respaldo debe quedar a disposicion de SEPRELAD;
-- esta tabla registra quien cambio que y cuando.

DROP TABLE IF EXISTS `auditoria`;
CREATE TABLE `auditoria` (
  `id`             BIGINT AUTO_INCREMENT PRIMARY KEY,
  `evento`         VARCHAR(60)  NOT NULL,
  `entidad`        VARCHAR(40)  DEFAULT NULL,
  `entidad_id`     INT          DEFAULT NULL,
  `usuario_id`     INT          DEFAULT NULL,
  `usuario_nombre` VARCHAR(120) DEFAULT NULL,
  `cargo`          VARCHAR(60)  DEFAULT NULL,
  `ip`             VARCHAR(45)  DEFAULT NULL,
  `detalle_json`   JSON         DEFAULT NULL,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `ix_aud_fecha`   (`created_at`),
  KEY `ix_aud_entidad` (`entidad`, `entidad_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
