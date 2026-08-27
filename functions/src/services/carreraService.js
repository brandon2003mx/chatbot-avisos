const {db} = require("../config/firebase");

/**
 * Obtiene las carreras activas.
 *
 * @return {Promise<Array>}
 */
async function obtenerCarreras() {
  const snapshot = await db
      .collection("carreras")
      .where("activo", "==", true)
      .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

/**
 * Obtiene los semestres activos de una carrera.
 *
 * @param {string} carreraId
 * @return {Promise<Array>}
 */
async function obtenerSemestres(carreraId) {
  const snapshot = await db
      .collection("carreras")
      .doc(carreraId)
      .collection("semestres")
      .where("activo", "==", true)
      .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

/**
 * Obtiene los grupos activos de un semestre.
 *
 * @param {string} carreraId
 * @param {string} semestreId
 * @return {Promise<Array>}
 */
async function obtenerGrupos(carreraId, semestreId) {
  const snapshot = await db
      .collection("carreras")
      .doc(carreraId)
      .collection("semestres")
      .doc(semestreId)
      .collection("grupos")
      .where("activo", "==", true)
      .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

/**
 * Obtiene una carrera por su ID.
 *
 * @param {string} carreraId ID de la carrera.
 * @return {Promise<Object|null>}
 */
async function obtenerCarrera(carreraId) {
  const documento = await db
      .collection("carreras")
      .doc(carreraId)
      .get();

  if (!documento.exists) {
    return null;
  }

  return {
    id: documento.id,
    ...documento.data(),
  };
}

module.exports = {
  obtenerCarreras,
  obtenerCarrera,
  obtenerSemestres,
  obtenerGrupos,
};

