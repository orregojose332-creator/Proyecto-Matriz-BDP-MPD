-- ============================================================================
--  Migracion 02 — Informacion ampliada de riesgos
--
--  Agrega el contenido que alimenta el boton "+ info": que significa cada tipo
--  de riesgo y que casos tipicos abarca. La orientacion y los ejemplos viven en
--  el SUBFACTOR, no en el riesgo, porque describen la categoria y sirven para
--  todos los riesgos que caen en ella. Lo propio de cada riesgo va en sus
--  campos de contexto.
--
--      mysql -u root matriz_mdp < db/migracion-02-riesgos-ampliados.sql
-- ============================================================================

SET NAMES utf8mb4;

-- ─── Orientacion y ejemplos por tipo de riesgo ──────────────────────────────
ALTER TABLE `subfactores`
  ADD COLUMN IF NOT EXISTS `orientacion` TEXT DEFAULT NULL
    COMMENT 'Que significa este tipo de riesgo y por que importa',
  ADD COLUMN IF NOT EXISTS `ejemplos` TEXT DEFAULT NULL
    COMMENT 'Casos tipicos, uno por linea';

-- ─── Datos propios de cada riesgo ───────────────────────────────────────────
ALTER TABLE `riesgos`
  ADD COLUMN IF NOT EXISTS `contexto` TEXT DEFAULT NULL
    COMMENT 'Situacion concreta en la entidad: donde se observo, a que afecta',
  ADD COLUMN IF NOT EXISTS `referencia` VARCHAR(200) DEFAULT NULL
    COMMENT 'Norma, resolucion o procedimiento interno que lo respalda';

-- ─── Contenido de la orientacion ────────────────────────────────────────────
-- Punto de partida para que el boton "+ info" diga algo util desde el primer
-- dia. Se edita desde la pantalla de catalogos a medida que el area lo afine.

UPDATE `subfactores` SET
  `orientacion` = 'Las personas expuestas politicamente y su entorno cercano concentran un riesgo mayor porque su posicion les da acceso a decisiones y a fondos publicos. No implica sospecha: implica diligencia reforzada, aprobacion de alta gerencia y seguimiento continuo de la relacion.',
  `ejemplos` = 'Funcionario publico de nivel jerarquico y su conyuge\nDirectivo de una empresa del Estado\nFamiliar directo o socio comercial conocido de un PEP\nPEP extranjero con operaciones locales'
WHERE `nombre` LIKE 'Persona expuesta politicamente%';

UPDATE `subfactores` SET
  `orientacion` = 'Cuando la cadena de titularidad se extiende por varios niveles o jurisdicciones, identificar a quien controla realmente la operacion se vuelve dificil. Esa opacidad es justamente lo que busca quien quiere interponer distancia entre el dinero y su origen.',
  `ejemplos` = 'Sociedad cuyo accionista es otra sociedad del exterior\nFideicomiso sin beneficiario final declarado\nCadena de titularidad de tres o mas niveles\nSociedad constituida pocas semanas antes de operar'
WHERE `nombre` LIKE 'Persona juridica con estructura compleja%';

UPDATE `subfactores` SET
  `orientacion` = 'La distancia dificulta verificar la identidad, el domicilio y el origen de los fondos, y limita la capacidad de seguimiento. El riesgo depende fuertemente de la jurisdiccion de residencia.',
  `ejemplos` = 'Cliente domiciliado en el exterior sin presencia local\nNo residente que opera por medio de un apoderado\nCliente con documentacion emitida en otro pais'
WHERE `nombre` LIKE 'Cliente no residente%';

UPDATE `subfactores` SET
  `orientacion` = 'El efectivo no deja rastro documental propio. Un volumen desproporcionado al perfil declarado es una de las senales mas repetidas en los casos de lavado, sobre todo si es recurrente y en montos apenas por debajo del umbral de reporte.',
  `ejemplos` = 'Depositos frecuentes apenas por debajo del umbral\nVolumen que no guarda relacion con la actividad declarada\nIngresos en efectivo de un rubro que normalmente opera bancarizado'
WHERE `nombre` LIKE 'Alto volumen de operaciones en efectivo%';

UPDATE `subfactores` SET
  `orientacion` = 'Sin historial no hay patron contra el cual comparar, de modo que las senales de alerta habituales no funcionan. El riesgo baja a medida que se acumula comportamiento observable.',
  `ejemplos` = 'Alta reciente que opera de inmediato por montos altos\nCliente sin referencias comerciales verificables\nRelacion que arranca con una operacion atipica para su perfil'
WHERE `nombre` LIKE 'Cliente nuevo sin historial%';

UPDATE `subfactores` SET
  `orientacion` = 'Algunos rubros manejan mucho efectivo, tienen baja trazabilidad o aparecen senalados en la evaluacion nacional de riesgos. Pertenecer a uno no es un impedimento, pero exige mayor sustento del origen de los fondos.',
  `ejemplos` = 'Casas de cambio y remesadoras\nComercio de bienes de alto valor\nInmobiliarias y constructoras\nJuegos de azar'
WHERE `nombre` LIKE 'Actividad economica de alto riesgo%';

UPDATE `subfactores` SET
  `orientacion` = 'Las operaciones liquidadas en efectivo rompen la cadena de trazabilidad que si dejan los medios bancarizados. El riesgo crece con el monto y con la frecuencia.',
  `ejemplos` = 'Venta cobrada integramente en efectivo\nPagos fraccionados para no superar el umbral\nDevoluciones pagadas en efectivo sobre compras bancarizadas'
WHERE `nombre` LIKE 'Operaciones en efectivo%';

UPDATE `subfactores` SET
  `orientacion` = 'El envio y la recepcion de fondos desde el exterior involucran jurisdicciones con controles dispares. El riesgo depende del pais, del corresponsal y de la coherencia entre la operacion y el perfil del cliente.',
  `ejemplos` = 'Transferencia hacia una jurisdiccion observada por el GAFI\nFondos recibidos de un tercero sin relacion comercial aparente\nOperaciones divididas entre varios corresponsales'
WHERE `nombre` LIKE 'Transferencias internacionales%';

UPDATE `subfactores` SET
  `orientacion` = 'Los bienes de monto elevado y reventa facil permiten mover valor concentrado en pocas operaciones. Conservan el valor fuera del sistema financiero.',
  `ejemplos` = 'Vehiculos, maquinaria o equipos de alto valor\nMetales preciosos y joyeria\nCompras pagadas por un tercero distinto del titular'
WHERE `nombre` LIKE 'Productos de alto valor%';

UPDATE `subfactores` SET
  `orientacion` = 'Cuando quien ordena la operacion no es quien figura como beneficiario, la relacion entre el dinero y su titular real se interrumpe. Es el mecanismo basico de la interposicion de personas.',
  `ejemplos` = 'Pago realizado por alguien ajeno al contrato\nCobro a nombre de un tercero sin mandato acreditado\nApoderado que opera sin vinculo comercial claro con el titular'
WHERE `nombre` LIKE 'Operaciones por cuenta de terceros%';

UPDATE `subfactores` SET
  `orientacion` = 'El contacto cara a cara permite cotejar el documento con la persona y observar su comportamiento. Es el canal de menor riesgo, siempre que la verificacion se haga efectivamente y quede registrada.',
  `ejemplos` = 'Alta en sucursal con cotejo de cedula\nFirma presencial ante funcionario\nEntrega en mano con constancia'
WHERE `nombre` LIKE 'Atencion presencial%';

UPDATE `subfactores` SET
  `orientacion` = 'Sin presencia fisica, la identidad se verifica por medios indirectos que pueden suplantarse. El riesgo baja con prueba de vida, verificacion biometrica y un primer movimiento desde una cuenta a nombre del titular.',
  `ejemplos` = 'Alta integramente por formulario web\nContratacion por aplicacion movil sin prueba de vida\nDocumentacion recibida solo por correo electronico'
WHERE `nombre` LIKE 'Venta a distancia%';

UPDATE `subfactores` SET
  `orientacion` = 'Cuando un tercero origina la relacion, la calidad de la debida diligencia depende de el. La responsabilidad frente al supervisor, en cambio, sigue siendo del sujeto obligado.',
  `ejemplos` = 'Distribuidor que capta clientes por cuenta propia\nAgente comercial que recibe documentacion\nIntermediario sin contrato con clausula de cumplimiento'
WHERE `nombre` LIKE 'Intermediarios o distribuidores%';

UPDATE `subfactores` SET
  `orientacion` = 'Son puntos de atencion operados por personal ajeno, con menor control directo y rotacion alta. El riesgo se concentra en la capacitacion y en la supervision efectiva de esos puntos.',
  `ejemplos` = 'Comercio que recibe pagos por cuenta de la entidad\nPunto de atencion sin supervision presencial periodica\nPersonal del corresponsal sin capacitacion registrada'
WHERE `nombre` LIKE 'Corresponsales no bancarios%';

UPDATE `subfactores` SET
  `orientacion` = 'Las zonas de frontera concentran movimiento de efectivo, comercio informal y contrabando. La cercania con otras jurisdicciones facilita el traslado fisico de valores.',
  `ejemplos` = 'Sucursal en ciudad fronteriza\nOperaciones con contraparte del pais vecino\nMovimiento de efectivo entre sucursales de frontera'
WHERE `nombre` LIKE 'Zona de frontera%';

UPDATE `subfactores` SET
  `orientacion` = 'Un entorno con criminalidad alta aumenta tanto la exposicion a fondos de origen ilicito como el riesgo operativo del personal y de los valores en transito.',
  `ejemplos` = 'Localidad con indices por encima de la media nacional\nZona con antecedentes de economia informal intensa\nArea con hechos reiterados sobre transporte de valores'
WHERE `nombre` LIKE 'Zona con alto indice de criminalidad%';

UPDATE `subfactores` SET
  `orientacion` = 'Las jurisdicciones con deficiencias estrategicas en materia ALA/CFT, o sujetas a monitoreo intensificado, exigen medidas reforzadas sobre toda operacion vinculada a ellas.',
  `ejemplos` = 'Contraparte domiciliada en pais bajo monitoreo del GAFI\nFondos con origen o destino en jurisdiccion no cooperante\nEstructura societaria registrada en centro offshore'
WHERE `nombre` LIKE 'Jurisdiccion extranjera no cooperante%';

UPDATE `subfactores` SET
  `orientacion` = 'Zonas urbanas con controles consolidados, presencia institucional y operatoria mayormente bancarizada. Sirven como referencia baja de la escala: no son riesgo cero, pero no agregan exposicion.',
  `ejemplos` = 'Sucursal en zona centrica con controles estandar\nClientes con operatoria bancarizada habitual\nArea con supervision presencial periodica'
WHERE `nombre` LIKE 'Area urbana de bajo riesgo%';
