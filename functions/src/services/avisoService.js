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

const {
  enviarMensaje,
} = require("./telegramService");

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
 * Valida que la segmentación corresponda
 * con datos académicos activos.
 *
 * @param {Object} aviso Datos del aviso.
 * @return {Promise<void>}
 */
async function validarSegmentacion(aviso) {
  if (aviso.tipoSegmentacion === "todos") {
    return;
  }

  if (aviso.tipoSegmentacion === "carrera") {
    await validarCarreraActiva(
        aviso.carreraId,
    );

    return;
  }

  if (aviso.tipoSegmentacion === "semestre") {
    await validarSemestreActivo(
        aviso.carreraId,
        String(aviso.semestreId),
    );

    return;
  }

  if (aviso.tipoSegmentacion === "grupo") {
    await validarGrupoActivo(
        aviso.carreraId,
        String(aviso.semestreId),
        aviso.grupoId,
    );
  }
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
 * @return {Promise<string>} ID del aviso reclamado/creado.
 */
async function reclamarIdempotencyKeyYCrearAviso(
    idempotencyKey,
    avisoNormalizado,
    requestHash,
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
      autorId: avisoNormalizado.autorId,
      activo: true,
      estadoEnvio: "procesando",
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
 * Envía un aviso por Telegram.
 *
 * Registra el resultado individual de cada destinatario en
 * avisos/{avisoId}/destinatarios/{telegramId}. Un error al
 * enviar a un destinatario no detiene el envío al resto.
 *
 * @param {string} avisoId ID del aviso.
 * @param {Object} aviso Datos del aviso.
 * @param {Array} estudiantes Destinatarios.
 * @return {Promise<Object>}
 */
async function enviarAvisoTelegram(
    avisoId,
    aviso,
    estudiantes,
) {
  let enviados = 0;
  let errores = 0;

  const mensaje =
      `📢 ${aviso.titulo}\n\n${aviso.contenido}`;

  const coleccion = db
      .collection("avisos")
      .doc(avisoId)
      .collection("destinatarios");

  for (const estudiante of estudiantes) {
    if (!estudiante.telegramId) {
      errores++;
      continue;
    }

    const telegramId = String(estudiante.telegramId);

    try {
      await enviarMensaje(
          telegramId,
          mensaje,
      );

      enviados++;

      await coleccion.doc(telegramId).update({
        enviado: true,
        fechaEnvio: new Date(),
      });
    } catch (error) {
      errores++;

      console.error(
          `Error enviando aviso a ${telegramId}:`,
          error.message,
      );

      await coleccion.doc(telegramId).update({
        enviado: false,
        error: error.message || String(error),
      });
    }
  }

  return {
    total: estudiantes.length,
    enviados,
    errores,
  };
}

/**
 * Crea y envía un aviso, protegido por una Idempotency-Key.
 *
 * Si la clave no había sido usada, reclama la clave y crea el
 * aviso de forma atómica (transacción), y solo después continúa
 * con la creación de destinatarios y el envío por Telegram. El
 * aviso queda desde su creación con estadoEnvio: "procesando"; al
 * terminar el envío se actualiza a "completado" o
 * "completado_con_errores" según el resultado. Si ocurre un fallo
 * general (no un fallo individual de Telegram, que ya se maneja
 * dentro de enviarAvisoTelegram), se intenta marcar el aviso como
 * "fallido" antes de propagar el error.
 *
 * Si la clave ya había sido usada para la misma operación
 * (mismo autorId y mismo contenido), se devuelve el estado actual
 * del aviso existente sin volver a crear destinatarios ni a
 * enviar Telegram, sin importar en qué estadoEnvio se encuentre.
 * Si la clave ya había sido usada para una operación distinta, se
 * lanza un error de conflicto sin revelar datos del aviso
 * existente.
 *
 * @param {Object} aviso Datos del aviso.
 * @param {string} idempotencyKey Clave de idempotencia (UUIDv4).
 * @return {Promise<Object>}
 */
async function crearYEnviarAviso(aviso, idempotencyKey) {
  validarIdempotencyKey(idempotencyKey);
  validarDatosAviso(aviso);
  await validarSegmentacion(aviso);

  const destinatarios = await obtenerDestinatarios(
      aviso,
  );

  if (destinatarios.length === 0) {
    throw new Error(
        "No existen estudiantes destinatarios para esta segmentación.",
    );
  }

  const avisoNormalizado = normalizarAviso(aviso);
  const requestHash = calcularRequestHash(avisoNormalizado);

  let avisoId;

  try {
    avisoId = await reclamarIdempotencyKeyYCrearAviso(
        idempotencyKey,
        avisoNormalizado,
        requestHash,
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

    const resultado = await enviarAvisoTelegram(
        avisoId,
        aviso,
        destinatarios,
    );

    const estadoEnvio =
      resultado.errores === 0 ?
        "completado" :
        "completado_con_errores";

    await db
        .collection("avisos")
        .doc(avisoId)
        .update({
          destinatarios: resultado.total,
          enviados: resultado.enviados,
          errores: resultado.errores,
          estadoEnvio,
          fechaActualizacion: new Date(),
        });

    return {
      nuevo: true,
      avisoId,
      destinatarios: resultado.total,
      enviados: resultado.enviados,
      errores: resultado.errores,
      estadoEnvio,
    };
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
}

/**
 * Obtiene los avisos más recientes.
 *
 * @param {number} limite Número máximo de avisos.
 * @return {Promise<Array>}
 */
async function obtenerAvisos(limite = 50) {
  const snapshot = await db
      .collection("avisos")
      .orderBy("fechaCreacion", "desc")
      .limit(limite)
      .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

module.exports = {
  obtenerDestinatarios,
  crearDestinatarios,
  enviarAvisoTelegram,
  crearYEnviarAviso,
  obtenerAvisos,
};
