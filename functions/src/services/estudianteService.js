const {db} = require("../config/firebase");

/**
 * Obtiene un estudiante por su Telegram ID. Como el documento
 * ahora se identifica por `numControl` (no por `telegramId`),
 * esto requiere una consulta en vez de una lectura directa.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<Object|null>}
 */
async function obtenerEstudiantePorTelegramId(telegramId) {
  const snapshot = await db
      .collection("estudiantes")
      .where("telegramId", "==", String(telegramId))
      .limit(1)
      .get();

  if (snapshot.empty) {
    return null;
  }

  const documento = snapshot.docs[0];

  return {
    id: documento.id,
    ...documento.data(),
  };
}

/**
 * Obtiene un estudiante por su número de control, que es el ID
 * del documento.
 *
 * @param {string} numControl Número de control.
 * @return {Promise<Object|null>}
 */
async function obtenerEstudiantePorNumControl(numControl) {
  const documento = await db
      .collection("estudiantes")
      .doc(String(numControl))
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
 * Guarda un estudiante completo, usando su número de control
 * como ID del documento.
 *
 * Esta función debe utilizarse únicamente cuando
 * el registro haya terminado.
 *
 * @param {string} numControl Número de control del estudiante.
 * @param {Object} datos Datos completos del estudiante.
 * @return {Promise<void>}
 */
async function guardarEstudiante(
    numControl,
    datos,
) {
  await db
      .collection("estudiantes")
      .doc(String(numControl))
      .set({
        ...datos,
        numControl: String(numControl),
        activo: true,
        fechaActualizacion: new Date(),
      });
}

/**
 * Cambia el número de control de un estudiante.
 *
 * El número de control es el ID del documento y Firestore no
 * permite renombrarlo: hay que crear el documento nuevo y borrar el
 * anterior. Va en una transacción por dos razones: para que el
 * estudiante no quede duplicado ni desaparecido si algo falla a la
 * mitad, y para que nadie alcance a ocupar el número nuevo entre la
 * comprobación y la escritura.
 *
 * El historial de avisos no se toca: los destinatarios se guardan
 * por telegramId, así que los envíos y las lecturas confirmadas
 * siguen apuntando al mismo estudiante.
 *
 * @param {string} numControlAnterior Número de control actual.
 * @param {string} numControlNuevo Número de control nuevo.
 * @param {Object} datos Datos del estudiante a conservar.
 * @return {Promise<boolean>} false si el número nuevo ya estaba
 *   ocupado por otro estudiante.
 */
async function cambiarNumeroControl(
    numControlAnterior,
    numControlNuevo,
    datos,
) {
  const anteriorRef = db
      .collection("estudiantes")
      .doc(String(numControlAnterior));

  const nuevoRef = db
      .collection("estudiantes")
      .doc(String(numControlNuevo));

  return db.runTransaction(async (transaction) => {
    const ocupado = await transaction.get(nuevoRef);

    if (ocupado.exists) {
      return false;
    }

    transaction.set(nuevoRef, {
      ...datos,
      numControl: String(numControlNuevo),
      activo: true,
      fechaActualizacion: new Date(),
    });

    transaction.delete(anteriorRef);

    return true;
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
  obtenerEstudiantePorNumControl,
  guardarEstudiante,
  cambiarNumeroControl,
  buscarEstudiantesPorSegmentacion,
};
