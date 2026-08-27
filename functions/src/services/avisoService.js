const {db} = require("../config/firebase");

const {
  buscarEstudiantesPorSegmentacion,
} = require("./estudianteService");

const {
  enviarMensaje,
} = require("./telegramService");

/**
 * Valida los datos de un aviso.
 *
 * @param {Object} aviso Datos del aviso.
 */
function validarAviso(aviso) {
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
        "Tipo de segmentación no válido.",
    );
  }

  if (
    aviso.tipoSegmentacion !== "todos" &&
    !aviso.carreraId
  ) {
    throw new Error(
        "carreraId es obligatorio para esta segmentación.",
    );
  }

  if (
    (aviso.tipoSegmentacion === "semestre" ||
      aviso.tipoSegmentacion === "grupo") &&
    (aviso.semestre === undefined ||
      aviso.semestre === null)
  ) {
    throw new Error(
        "semestre es obligatorio para esta segmentación.",
    );
  }

  if (
    aviso.tipoSegmentacion === "grupo" &&
    !aviso.grupoId
  ) {
    throw new Error(
        "grupoId es obligatorio para la segmentación por grupo.",
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
  validarAviso(aviso);

  const referencia = await db
      .collection("avisos")
      .add({
        titulo: aviso.titulo.trim(),
        contenido: aviso.contenido.trim(),
        tipoSegmentacion: aviso.tipoSegmentacion,
        carreraId: aviso.carreraId || null,
        semestre: aviso.semestre === undefined ?
          null :
          aviso.semestre,
        grupoId: aviso.grupoId || null,
        autorId: aviso.autorId || null,
        activo: true,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
      });

  return referencia.id;
}

/**
 * Obtiene los estudiantes destinatarios de un aviso.
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
    enviados,
    errores,
    total: estudiantes.length,
  };
}

/**
 * Crea un aviso y lo envía por Telegram.
 *
 * @param {Object} aviso Datos del aviso.
 * @return {Promise<Object>}
 */
async function crearYEnviarAviso(aviso) {
  const avisoId = await crearAviso(aviso);

  const destinatarios = await obtenerDestinatarios(
      aviso,
  );

  const resultado = await enviarAvisoTelegram(
      aviso,
      destinatarios,
  );

  await db
      .collection("avisos")
      .doc(avisoId)
      .update({
        fechaActualizacion: new Date(),
      });

  return {
    avisoId,
    destinatarios: resultado.total,
    enviados: resultado.enviados,
    errores: resultado.errores,
  };
}

module.exports = {
  crearAviso,
  obtenerDestinatarios,
  enviarAvisoTelegram,
  crearYEnviarAviso,
};

