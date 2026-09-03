const crypto = require("crypto");

const {db} = require("../config/firebase");

const {
  validarCarreraActiva,
  validarSemestreActivo,
  validarGrupoActivo,
} = require("./carreraService");

const {
  buscarEstudiantesPorSegmentacion,
} = require("./estudianteService");

/**
 * Cantidad de destinatarios por lote de envío. Centralizada aquí
 * para poder ajustarla más adelante sin buscar el valor disperso
 * por el código.
 *
 * @type {number}
 */
const TAMANO_LOTE = 50;

/**
 * ID del documento "marcador" dentro de avisos/{avisoId}/lotes que
 * señala que TODOS los lotes del aviso ya fueron creados con
 * éxito. Empieza con "_" para no colisionar nunca con los IDs
 * deterministas de lote (`lote-0`, `lote-1`, ...).
 *
 * El trigger de Firestore que encola las Cloud Tasks (definido en
 * functions/index.js) solo reacciona a la creación de ESTE
 * documento, nunca a la creación de un lote individual. Así, si la
 * creación de la estructura completa del aviso falla a mitad de
 * camino (algunos lotes creados, otros no), este marcador nunca
 * llega a existir y ningún lote puede empezar a encolarse ni
 * procesarse — sin necesidad de una transacción gigante que
 * incluya todos los destinatarios y lotes de una vez.
 *
 * @type {string}
 */
const MARCADOR_ESTRUCTURA_LISTA = "_estructura_lista";

/**
 * Valida los datos básicos de un aviso.
 *
 * @param {Object} aviso Datos del aviso.
 */
function validarDatosAviso(aviso) {
  const tiposValidos = [
    "todos",
    "carrera",
    "semestre",
    "grupo",
  ];

  if (!aviso.titulo || !aviso.titulo.trim()) {
    throw new Error("El título es obligatorio.");
  }

  if (!aviso.contenido || !aviso.contenido.trim()) {
    throw new Error("El contenido es obligatorio.");
  }

  if (!tiposValidos.includes(aviso.tipoSegmentacion)) {
    throw new Error(
        "El tipo de segmentación no es válido.",
    );
  }

  if (
    aviso.tipoSegmentacion !== "todos" &&
    !aviso.carreraId
  ) {
    throw new Error(
        "La carrera es obligatoria para esta segmentación.",
    );
  }

  if (
    (aviso.tipoSegmentacion === "semestre" ||
      aviso.tipoSegmentacion === "grupo") &&
    (aviso.semestreId === null ||
      aviso.semestreId === undefined)
  ) {
    throw new Error(
        "El semestre es obligatorio para esta segmentación.",
    );
  }

  if (
    aviso.tipoSegmentacion === "grupo" &&
    !aviso.grupoId
  ) {
    throw new Error(
        "El grupo es obligatorio para esta segmentación.",
    );
  }
}

/**
 * Valida que la segmentación corresponda con datos académicos
 * activos, y devuelve una foto de los nombres/números legibles en
 * ese momento (para poder mostrar más adelante a qué segmento
 * específico se envió un aviso, aunque la carrera/semestre/grupo
 * cambie de nombre o se desactive después).
 *
 * @param {Object} aviso Datos del aviso.
 * @return {Promise<Object>} {carreraNombre, semestreNumero, grupoNombre}
 */
async function validarSegmentacion(aviso) {
  const descripcion = {
    carreraNombre: null,
    semestreNumero: null,
    grupoNombre: null,
  };

  if (aviso.tipoSegmentacion === "todos") {
    return descripcion;
  }

  const carrera = await validarCarreraActiva(
      aviso.carreraId,
  );

  descripcion.carreraNombre = carrera.nombre;

  if (aviso.tipoSegmentacion === "carrera") {
    return descripcion;
  }

  const semestre = await validarSemestreActivo(
      aviso.carreraId,
      String(aviso.semestreId),
  );

  descripcion.semestreNumero = semestre.numero;

  if (aviso.tipoSegmentacion === "semestre") {
    return descripcion;
  }

  const grupo = await validarGrupoActivo(
      aviso.carreraId,
      String(aviso.semestreId),
      aviso.grupoId,
  );

  descripcion.grupoNombre = grupo.nombre;

  return descripcion;
}

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Valida el formato de una Idempotency-Key.
 *
 * @param {*} idempotencyKey Valor recibido en el encabezado.
 */
function validarIdempotencyKey(idempotencyKey) {
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim() === ""
  ) {
    throw new Error(
        "El encabezado Idempotency-Key es obligatorio.",
    );
  }

  if (idempotencyKey.length > 100) {
    throw new Error(
        "El encabezado Idempotency-Key no es válido.",
    );
  }

  if (!UUID_V4_REGEX.test(idempotencyKey)) {
    throw new Error(
        "El encabezado Idempotency-Key no es válido.",
    );
  }
}

/**
 * Normaliza los campos del aviso a los valores que el backend
 * realmente persiste (los mismos que antes se calculaban dentro
 * de la escritura a Firestore).
 *
 * @param {Object} aviso Datos crudos del aviso.
 * @return {Object} Aviso normalizado.
 */
function normalizarAviso(aviso) {
  return {
    titulo: aviso.titulo.trim(),
    contenido: aviso.contenido.trim(),
    tipoSegmentacion: aviso.tipoSegmentacion,
    carreraId: aviso.carreraId || null,
    semestreId:
      aviso.semestreId === undefined ||
      aviso.semestreId === null ?
        null :
        String(aviso.semestreId),
    grupoId: aviso.grupoId || null,
    autorId: aviso.autorId || null,
  };
}

/**
 * Calcula un hash SHA-256 estable del contenido lógico de un
 * aviso normalizado, para detectar si una Idempotency-Key se
 * reutiliza con datos distintos.
 *
 * @param {Object} avisoNormalizado Aviso ya normalizado.
 * @return {string} Hash en hexadecimal.
 */
function calcularRequestHash(avisoNormalizado) {
  const datos = {
    autorId: avisoNormalizado.autorId,
    titulo: avisoNormalizado.titulo,
    contenido: avisoNormalizado.contenido,
    tipoSegmentacion: avisoNormalizado.tipoSegmentacion,
    carreraId: avisoNormalizado.carreraId,
    semestreId: avisoNormalizado.semestreId,
    grupoId: avisoNormalizado.grupoId,
  };

  const cadenaEstable = JSON.stringify(
      datos,
      Object.keys(datos).sort(),
  );

  return crypto
      .createHash("sha256")
      .update(cadenaEstable)
      .digest("hex");
}

/**
 * Señala que una Idempotency-Key ya fue reclamada previamente.
 * Se usa internamente para abortar la transacción de creación
 * sin tratarlo como un fallo general.
 */
class IdempotencyKeyExistsError extends Error {
  /**
   * @param {string} idempotencyKey Clave ya reclamada.
   */
  constructor(idempotencyKey) {
    super(`Idempotency-Key ya reclamada: ${idempotencyKey}`);
    this.name = "IdempotencyKeyExistsError";
  }
}

/**
 * Reclama una Idempotency-Key y crea el aviso inicial de forma
 * atómica dentro de una única transacción de Firestore.
 *
 * Si la clave ya existe, no escribe nada y lanza
 * IdempotencyKeyExistsError para que el llamador la maneje fuera
 * de la transacción. No realiza llamadas a Telegram.
 *
 * @param {string} idempotencyKey Clave de idempotencia.
 * @param {Object} avisoNormalizado Aviso ya validado y normalizado.
 * @param {string} requestHash Hash del contenido lógico del aviso.
 * @param {number} totalDestinatarios Cantidad de destinatarios válidos.
 * @param {number} totalLotes Cantidad de lotes en los que se dividirá
 *   el envío.
 * @param {Object} descripcionSegmento {carreraNombre, semestreNumero,
 *   grupoNombre} en el momento de la creación.
 * @return {Promise<string>} ID del aviso reclamado/creado.
 */
async function reclamarIdempotencyKeyYCrearAviso(
    idempotencyKey,
    avisoNormalizado,
    requestHash,
    totalDestinatarios,
    totalLotes,
    descripcionSegmento,
) {
  const avisoRef = db.collection("avisos").doc();

  const idempotenciaRef = db
      .collection("avisosPorIdempotencia")
      .doc(idempotencyKey);

  await db.runTransaction(async (transaction) => {
    const idempotenciaSnap = await transaction.get(
        idempotenciaRef,
    );

    if (idempotenciaSnap.exists) {
      throw new IdempotencyKeyExistsError(idempotencyKey);
    }

    const ahora = new Date();

    transaction.set(idempotenciaRef, {
      avisoId: avisoRef.id,
      autorId: avisoNormalizado.autorId,
      requestHash,
      fechaCreacion: ahora,
    });

    transaction.set(avisoRef, {
      titulo: avisoNormalizado.titulo,
      contenido: avisoNormalizado.contenido,
      tipoSegmentacion: avisoNormalizado.tipoSegmentacion,
      carreraId: avisoNormalizado.carreraId,
      semestreId: avisoNormalizado.semestreId,
      grupoId: avisoNormalizado.grupoId,
      carreraNombre: descripcionSegmento.carreraNombre,
      semestreNumero: descripcionSegmento.semestreNumero,
      grupoNombre: descripcionSegmento.grupoNombre,
      autorId: avisoNormalizado.autorId,
      activo: true,
      estadoEnvio: "pendiente",
      destinatarios: totalDestinatarios,
      enviados: 0,
      errores: 0,
      ambiguos: 0,
      totalLotes,
      lotesTerminales: 0,
      idempotencyKey,
      requestHash,
      fechaCreacion: ahora,
      fechaActualizacion: ahora,
    });
  });

  return avisoRef.id;
}

/**
 * Maneja una Idempotency-Key que ya había sido reclamada.
 *
 * Si autorId y requestHash coinciden con el registro existente,
 * se trata de un reintento de la misma operación: se devuelve el
 * estado actual del aviso ya creado, sin volver a crear
 * destinatarios ni a enviar Telegram. Si no coinciden, se lanza
 * un error de conflicto sin revelar datos del aviso existente.
 *
 * @param {string} idempotencyKey Clave de idempotencia.
 * @param {string|null} autorIdActual autorId de la solicitud actual.
 * @param {string} requestHashActual Hash de la solicitud actual.
 * @return {Promise<Object>} Estado actual del aviso existente.
 */
async function manejarIdempotencyKeyExistente(
    idempotencyKey,
    autorIdActual,
    requestHashActual,
) {
  const indiceSnap = await db
      .collection("avisosPorIdempotencia")
      .doc(idempotencyKey)
      .get();

  if (!indiceSnap.exists) {
    throw new Error(
        "No fue posible verificar la Idempotency-Key.",
    );
  }

  const indice = indiceSnap.data();

  if (
    indice.autorId !== autorIdActual ||
    indice.requestHash !== requestHashActual
  ) {
    const conflicto = new Error(
        "La Idempotency-Key ya fue utilizada para otra solicitud.",
    );

    conflicto.idempotencyConflict = true;

    throw conflicto;
  }

  const avisoSnap = await db
      .collection("avisos")
      .doc(indice.avisoId)
      .get();

  if (!avisoSnap.exists) {
    console.error(
        `Idempotency-Key ${idempotencyKey} apunta a un aviso ` +
        `inexistente (${indice.avisoId}).`,
    );

    throw new Error(
        "No fue posible recuperar el aviso asociado a esta " +
        "Idempotency-Key.",
    );
  }

  const aviso = avisoSnap.data();

  return {
    nuevo: false,
    avisoId: indice.avisoId,
    destinatarios: aviso.destinatarios,
    enviados: aviso.enviados,
    errores: aviso.errores,
    ambiguos: aviso.ambiguos,
    estadoEnvio: aviso.estadoEnvio,
  };
}

/**
 * Obtiene los estudiantes destinatarios.
 *
 * @param {Object} aviso Datos del aviso.
 * @return {Promise<Array>}
 */
async function obtenerDestinatarios(aviso) {
  return buscarEstudiantesPorSegmentacion(
      aviso.tipoSegmentacion,
      aviso.carreraId || null,
      aviso.semestreId === undefined ?
        null :
        aviso.semestreId,
      aviso.grupoId || null,
  );
}

/**
 * Crea los documentos iniciales de destinatarios de un aviso.
 *
 * Cada documento usa el telegramId como ID para evitar
 * duplicados, y solo conserva el estado de envío: no copia
 * el estado académico actual del estudiante.
 *
 * @param {string} avisoId ID del aviso.
 * @param {Array} estudiantes Destinatarios.
 * @return {Promise<void>}
 */
async function crearDestinatarios(avisoId, estudiantes) {
  const coleccion = db
      .collection("avisos")
      .doc(avisoId)
      .collection("destinatarios");

  const validos = estudiantes.filter(
      (estudiante) => estudiante.telegramId,
  );

  const tamanoLote = 500;

  for (
    let inicio = 0;
    inicio < validos.length;
    inicio += tamanoLote
  ) {
    const lote = validos.slice(
        inicio,
        inicio + tamanoLote,
    );

    const batch = db.batch();

    for (const estudiante of lote) {
      const telegramId = String(estudiante.telegramId);

      batch.set(
          coleccion.doc(telegramId),
          {
            telegramId,
            enviado: false,
          },
      );
    }

    await batch.commit();
  }
}

/**
 * Crea los lotes en los que se dividirá el envío de un aviso.
 *
 * Cada lote es un documento con ID determinista (lote-0, lote-1,
 * ...) que solo contiene los telegramId de sus destinatarios (sin
 * datos personales) y un nombre determinista de Cloud Task, para
 * que el encolado posterior (fuera de este servicio) sea
 * idempotente. El orden de los destinatarios dentro de los lotes
 * es estable: es el mismo orden en el que llegaron en
 * `estudiantes`.
 *
 * Una vez que TODOS los lotes se crearon con éxito (todos los
 * commits de lotes por debajo resolvieron), se crea el documento
 * marcador `MARCADOR_ESTRUCTURA_LISTA`. Si cualquier commit
 * anterior falla, esta función lanza y el marcador nunca se
 * escribe — por diseño, para que el trigger de encolado (que solo
 * reacciona a la creación del marcador) nunca tenga nada que
 * procesar sobre una estructura de lotes incompleta.
 *
 * @param {string} avisoId ID del aviso.
 * @param {Array} estudiantes Destinatarios (mismo arreglo usado por
 *   crearDestinatarios).
 * @return {Promise<void>}
 */
async function crearLotes(avisoId, estudiantes) {
  const validos = estudiantes
      .filter((estudiante) => estudiante.telegramId)
      .map((estudiante) => String(estudiante.telegramId));

  const coleccion = db
      .collection("avisos")
      .doc(avisoId)
      .collection("lotes");

  const totalLotes = Math.ceil(validos.length / TAMANO_LOTE);
  const tamanoLoteEscritura = 500;

  for (
    let inicio = 0;
    inicio < totalLotes;
    inicio += tamanoLoteEscritura
  ) {
    const fin = Math.min(inicio + tamanoLoteEscritura, totalLotes);
    const batch = db.batch();

    for (let indice = inicio; indice < fin; indice++) {
      const telegramIds = validos.slice(
          indice * TAMANO_LOTE,
          (indice + 1) * TAMANO_LOTE,
      );

      batch.set(coleccion.doc(`lote-${indice}`), {
        indice,
        estado: "pendiente",
        taskName: `avisos-${avisoId}-lote-${indice}`,
        telegramIds,
        fechaCreacion: new Date(),
      });
    }

    await batch.commit();
  }

  await coleccion.doc(MARCADOR_ESTRUCTURA_LISTA).set({
    totalLotes,
    fechaCreacion: new Date(),
  });
}

/**
 * Crea un aviso y lo deja listo para ser enviado de forma
 * asíncrona, protegido por una Idempotency-Key.
 *
 * Si la clave no había sido usada, reclama la clave y crea el
 * aviso de forma atómica (transacción) con estadoEnvio:"pendiente",
 * y solo después crea sus destinatarios y sus lotes. Esta función
 * NO espera ni realiza ningún envío a Telegram: eso lo hace el
 * worker asíncrono (avisoWorkerService.js), disparado por un
 * trigger de Firestore que encola una Cloud Task por lote. Si la
 * creación de destinatarios o lotes falla después de haber
 * reclamado la clave (un fallo general, no un fallo individual de
 * envío), se intenta marcar el aviso como "fallido" antes de
 * propagar el error.
 *
 * Si la clave ya había sido usada para la misma operación
 * (mismo autorId y mismo contenido), se devuelve el estado actual
 * del aviso existente sin volver a crear destinatarios ni lotes,
 * sin importar en qué estadoEnvio se encuentre. Si la clave ya
 * había sido usada para una operación distinta, se lanza un error
 * de conflicto sin revelar datos del aviso existente.
 *
 * @param {Object} aviso Datos del aviso.
 * @param {string} idempotencyKey Clave de idempotencia (UUIDv4).
 * @return {Promise<Object>}
 */
async function crearYEnviarAviso(aviso, idempotencyKey) {
  validarIdempotencyKey(idempotencyKey);
  validarDatosAviso(aviso);
  const descripcionSegmento = await validarSegmentacion(aviso);

  const destinatarios = await obtenerDestinatarios(
      aviso,
  );

  if (destinatarios.length === 0) {
    throw new Error(
        "No existen estudiantes destinatarios para esta segmentación.",
    );
  }

  const totalValidos = destinatarios.filter(
      (estudiante) => estudiante.telegramId,
  ).length;

  const totalLotes = Math.ceil(totalValidos / TAMANO_LOTE);

  const avisoNormalizado = normalizarAviso(aviso);
  const requestHash = calcularRequestHash(avisoNormalizado);

  let avisoId;

  try {
    avisoId = await reclamarIdempotencyKeyYCrearAviso(
        idempotencyKey,
        avisoNormalizado,
        requestHash,
        totalValidos,
        totalLotes,
        descripcionSegmento,
    );
  } catch (error) {
    if (error instanceof IdempotencyKeyExistsError) {
      return await manejarIdempotencyKeyExistente(
          idempotencyKey,
          avisoNormalizado.autorId,
          requestHash,
      );
    }

    throw error;
  }

  try {
    await crearDestinatarios(
        avisoId,
        destinatarios,
    );

    await crearLotes(
        avisoId,
        destinatarios,
    );
  } catch (error) {
    try {
      await db
          .collection("avisos")
          .doc(avisoId)
          .update({
            estadoEnvio: "fallido",
            fechaActualizacion: new Date(),
          });
    } catch (errorActualizacion) {
      console.error(
          `No se pudo marcar como fallido el aviso ${avisoId}:`,
          errorActualizacion.message,
      );
    }

    throw error;
  }

  return {
    nuevo: true,
    avisoId,
    destinatarios: totalValidos,
    enviados: 0,
    errores: 0,
    ambiguos: 0,
    estadoEnvio: "pendiente",
  };
}

/**
 * Obtiene los avisos activos más recientes.
 *
 * @param {number} limite Número máximo de avisos.
 * @return {Promise<Array>}
 */
async function obtenerAvisos(limite = 50) {
  const snapshot = await db
      .collection("avisos")
      .where("activo", "==", true)
      .orderBy("fechaCreacion", "desc")
      .limit(limite)
      .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

/**
 * Estados de envío en los que un aviso todavía puede tener
 * Cloud Tasks en vuelo, por lo que no es seguro editarlo ni
 * eliminarlo: un worker podría intentar actualizar un documento
 * ya borrado, o sobrescribir una edición a medio envío.
 *
 * @type {Array<string>}
 */
const ESTADOS_EN_PROCESO = ["pendiente", "procesando"];

/**
 * Obtiene un aviso existente y valida que ya haya terminado de
 * enviarse, para permitir editarlo o eliminarlo con seguridad.
 *
 * @param {string} avisoId ID del aviso.
 * @return {Promise<FirebaseFirestore.DocumentReference>} Referencia
 *   al documento del aviso, ya validado.
 */
async function obtenerAvisoRefTerminal(avisoId) {
  const avisoRef = db.collection("avisos").doc(avisoId);

  const avisoSnap = await avisoRef.get();

  if (!avisoSnap.exists) {
    throw new Error("El aviso no existe.");
  }

  if (ESTADOS_EN_PROCESO.includes(avisoSnap.data().estadoEnvio)) {
    throw new Error(
        "El aviso todavía está en proceso de envío.",
    );
  }

  return avisoRef;
}

/**
 * Oculta un aviso (borrado lógico). Se usa internamente cuando un
 * aviso corregido reemplaza a uno anterior: el original deja de
 * aparecer en el listado, pero permanece en Firestore.
 *
 * @param {string} avisoId ID del aviso.
 * @return {Promise<void>}
 */
async function ocultarAviso(avisoId) {
  const avisoRef = await obtenerAvisoRefTerminal(avisoId);

  await avisoRef.update({
    activo: false,
    fechaActualizacion: new Date(),
  });
}

/**
 * Elimina un aviso junto con sus subcolecciones (destinatarios y
 * lotes), de forma permanente e irreversible. No afecta los
 * mensajes ya entregados por Telegram: solo borra el registro en
 * Firestore.
 *
 * @param {string} avisoId ID del aviso.
 * @return {Promise<void>}
 */
async function eliminarAviso(avisoId) {
  const avisoRef = await obtenerAvisoRefTerminal(avisoId);

  await db.recursiveDelete(avisoRef);
}

/**
 * Obtiene un aviso por su ID, sin filtrar por estado ni por
 * "activo". Se usa para precargar el formulario de edición.
 *
 * @param {string} avisoId ID del aviso.
 * @return {Promise<Object|null>}
 */
async function obtenerAviso(avisoId) {
  const snap = await db.collection("avisos").doc(avisoId).get();

  if (!snap.exists) {
    return null;
  }

  return {
    id: snap.id,
    ...snap.data(),
  };
}

module.exports = {
  TAMANO_LOTE,
  MARCADOR_ESTRUCTURA_LISTA,
  obtenerDestinatarios,
  crearDestinatarios,
  crearLotes,
  crearYEnviarAviso,
  obtenerAvisos,
  obtenerAviso,
  ocultarAviso,
  eliminarAviso,
};
