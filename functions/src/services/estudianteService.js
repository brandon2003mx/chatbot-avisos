const {db} = require("../config/firebase");

/**
 * Obtiene un estudiante por su Telegram ID.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<Object|null>}
 */
async function obtenerEstudiantePorTelegramId(telegramId) {
  const documento = await db
      .collection("estudiantes")
      .doc(String(telegramId))
      .get();

  if (!documento.exists) {
    return null;
  }

  return {
    id: documento.id,
    ...documento.data(),
  };
}

/**
 * Guarda un estudiante completo.
 *
 * Esta función debe utilizarse únicamente cuando
 * el registro haya terminado.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {Object} datos Datos completos del estudiante.
 * @return {Promise<void>}
 */
async function guardarEstudiante(
    telegramId,
    datos,
) {
  await db
      .collection("estudiantes")
      .doc(String(telegramId))
      .set({
        ...datos,
        telegramId: String(telegramId),
        activo: true,
        fechaActualizacion: new Date(),
      });
}

/**
 * Busca estudiantes activos según una segmentación.
 *
 * @param {string} tipoSegmentacion Tipo de segmentación.
 * @param {string} carreraId ID de la carrera.
 * @param {string|null} semestreId ID del semestre.
 * @param {string|null} grupoId ID del grupo.
 * @return {Promise<Array>}
 */
async function buscarEstudiantesPorSegmentacion(
    tipoSegmentacion,
    carreraId = null,
    semestreId = null,
    grupoId = null,
) {
  let consulta = db
      .collection("estudiantes")
      .where("activo", "==", true);

  if (tipoSegmentacion === "carrera") {
    consulta = consulta.where(
        "carreraId",
        "==",
        carreraId,
    );
  }

  if (tipoSegmentacion === "semestre") {
    consulta = consulta
        .where("carreraId", "==", carreraId)
        .where("semestreId", "==", semestreId);
  }

  if (tipoSegmentacion === "grupo") {
    consulta = consulta
        .where("carreraId", "==", carreraId)
        .where("semestreId", "==", semestreId)
        .where("grupoId", "==", grupoId);
  }

  const snapshot = await consulta.get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

module.exports = {
  obtenerEstudiantePorTelegramId,
  guardarEstudiante,
  buscarEstudiantesPorSegmentacion,
};
