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
 * Busca estudiantes activos por carrera, semestre y grupo.
 *
 * @param {string} carreraId ID de la carrera.
 * @param {number} semestre Número del semestre.
 * @param {string} grupoId ID del grupo.
 * @return {Promise<Array>}
 */
async function buscarEstudiantes(
    carreraId,
    semestre,
    grupoId,
) {
  const snapshot = await db
      .collection("estudiantes")
      .where("carreraId", "==", carreraId)
      .where("semestre", "==", semestre)
      .where("grupoId", "==", grupoId)
      .where("activo", "==", true)
      .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

module.exports = {
  obtenerEstudiantePorTelegramId,
  guardarEstudiante,
  buscarEstudiantes,
};
