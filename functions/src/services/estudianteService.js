const {db} = require("../config/firebase");

/**
 * Busca estudiantes activos por carrera, semestre y grupo.
 *
 * @param {string} carrera
 * @param {number} semestre
 * @param {string} grupo
 * @return {Promise<Array>}
 */
async function buscarEstudiantes(carrera, semestre, grupo) {
  const snapshot = await db
      .collection("estudiantes")
      .where("carrera", "==", carrera)
      .where("semestre", "==", semestre)
      .where("grupo", "==", grupo)
      .where("activo", "==", true)
      .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

module.exports = {
  buscarEstudiantes,
};
