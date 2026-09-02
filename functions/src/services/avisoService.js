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

/**
 * Crea un aviso en Firestore.
 *
 * @param {Object} aviso Datos del aviso.
 * @return {Promise<string>} ID del aviso.
 */
async function crearAviso(aviso) {
  validarDatosAviso(aviso);
  await validarSegmentacion(aviso);

  const referencia = await db
      .collection("avisos")
      .add({
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
        activo: true,
        estadoEnvio: "procesando",
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
      });

  return referencia.id;
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
 * Crea y envía un aviso.
 *
 * El aviso solo se crea si existe al menos un estudiante
 * destinatario. Desde su creación queda con
 * estadoEnvio: "procesando"; al terminar el envío se actualiza
 * a "completado" o "completado_con_errores" según el resultado.
 * Si ocurre un fallo general (no un fallo individual de Telegram,
 * que ya se maneja dentro de enviarAvisoTelegram), se intenta
 * marcar el aviso como "fallido" antes de propagar el error.
 *
 * @param {Object} aviso Datos del aviso.
 * @return {Promise<Object>}
 */
async function crearYEnviarAviso(aviso) {
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

  const avisoId = await crearAviso(aviso);

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
  crearAviso,
  obtenerDestinatarios,
  crearDestinatarios,
  enviarAvisoTelegram,
  crearYEnviarAviso,
  obtenerAvisos,
};
