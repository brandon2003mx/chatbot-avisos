const {db} = require("../config/firebase");

/**
 * Busca un estudiante por su Telegram ID.
 *
 * El Telegram ID se utiliza como identificador del documento
 * para evitar registros duplicados durante el proceso de registro.
 *
 * @param {string} telegramId Identificador del chat de Telegram.
 * @return {Promise<Object|null>} Estudiante encontrado o null.
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
 * Crea el registro inicial de un estudiante.
 *
 * @param {string} telegramId Identificador del chat de Telegram.
 * @param {string} nombre Nombre mostrado en Telegram.
 * @return {Promise<Object>} Registro creado.
 */
async function crearRegistroInicial(telegramId, nombre) {
  const estudianteId = String(telegramId);

  const estudiante = {
    nombre,
    telegramId: estudianteId,
    correoInstitucional: "",
    correoVerificado: false,
    matricula: "",
    carreraId: "",
    semestre: null,
    grupoId: "",
    fcmToken: "",
    activo: true,
    estadoRegistro: "esperando_correo",
    fechaRegistro: new Date(),
    fechaActualizacion: new Date(),
  };

  await db
      .collection("estudiantes")
      .doc(estudianteId)
      .set(estudiante);

  return {
    id: estudianteId,
    ...estudiante,
  };
}

/**
 * Actualiza el estado de registro de un estudiante.
 *
 * @param {string} telegramId Identificador del chat de Telegram.
 * @param {Object} datos Datos que se actualizarán.
 * @return {Promise<void>}
 */
async function actualizarRegistro(telegramId, datos) {
  await db
      .collection("estudiantes")
      .doc(String(telegramId))
      .update({
        ...datos,
        fechaActualizacion: new Date(),
      });
}

/**
 * Busca estudiantes activos por carrera, semestre y grupo.
 *
 * @param {string} carreraId Identificador de la carrera.
 * @param {number} semestre Número del semestre.
 * @param {string} grupoId Identificador del grupo.
 * @return {Promise<Array>}
 */
async function buscarEstudiantes(carreraId, semestre, grupoId) {
  const snapshot = await db
      .collection("estudiantes")
      .where("carreraId", "==", carreraId)
      .where("semestre", "==", semestre)
      .where("grupoId", "==", grupoId)
      .where("activo", "==", true)
      .where("correoVerificado", "==", true)
      .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

module.exports = {
  obtenerEstudiantePorTelegramId,
  crearRegistroInicial,
  actualizarRegistro,
  buscarEstudiantes,
};

