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
    (aviso.semestre === null ||
      aviso.semestre === undefined)
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
        String(aviso.semestre),
    );

    return;
  }

  if (aviso.tipoSegmentacion === "grupo") {
    await validarGrupoActivo(
        aviso.carreraId,
        String(aviso.semestre),
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
        semestre:
          aviso.semestre === undefined ||
          aviso.semestre === null ?
            null :
            Number(aviso.semestre),
        grupoId: aviso.grupoId || null,
        autorId: aviso.autorId || null,
        activo: true,
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
      aviso.semestre === undefined ?
        null :
        aviso.semestre,
      aviso.grupoId || null,
  );
}

/**
 * Envía un aviso por Telegram.
 *
 * @param {Object} aviso Datos del aviso.
 * @param {Array} estudiantes Destinatarios.
 * @return {Promise<Object>}
 */
async function enviarAvisoTelegram(
    aviso,
    estudiantes,
) {
  let enviados = 0;
  let errores = 0;

  const mensaje =
      `📢 ${aviso.titulo}\n\n${aviso.contenido}`;

  for (const estudiante of estudiantes) {
    if (!estudiante.telegramId) {
      errores++;
      continue;
    }

    try {
      await enviarMensaje(
          estudiante.telegramId,
          mensaje,
      );

      enviados++;
    } catch (error) {
      errores++;

      console.error(
          `Error enviando aviso a ${estudiante.telegramId}:`,
          error.message,
      );
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
 * El aviso solo se crea si existe al menos
 * un estudiante destinatario.
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

  const resultado = await enviarAvisoTelegram(
      aviso,
      destinatarios,
  );

  await db
      .collection("avisos")
      .doc(avisoId)
      .update({
        destinatarios: resultado.total,
        enviados: resultado.enviados,
        errores: resultado.errores,
        fechaActualizacion: new Date(),
      });

  return {
    avisoId,
    destinatarios: resultado.total,
    enviados: resultado.enviados,
    errores: resultado.errores,
  };
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
  enviarAvisoTelegram,
  crearYEnviarAviso,
  obtenerAvisos,
};
