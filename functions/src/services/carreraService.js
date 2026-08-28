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

/**
 * Crea una carrera.
 *
 * @param {string} carreraId Identificador de la carrera.
 * @param {Object} datos Datos de la carrera.
 * @return {Promise<void>}
 */
async function crearCarrera(
    carreraId,
    datos,
) {
  await db
      .collection("carreras")
      .doc(carreraId)
      .set({
        nombre: datos.nombre,
        clave: datos.clave,
        activo: true,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
      });
}

/**
 * Crea un semestre dentro de una carrera.
 *
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @param {Object} datos Datos del semestre.
 * @return {Promise<void>}
 */
async function crearSemestre(
    carreraId,
    semestreId,
    datos,
) {
  await db
      .collection("carreras")
      .doc(carreraId)
      .collection("semestres")
      .doc(semestreId)
      .set({
        numero: Number(datos.numero),
        activo: true,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
      });
}

/**
 * Crea un grupo dentro de un semestre.
 *
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @param {string} grupoId ID del grupo.
 * @param {Object} datos Datos del grupo.
 * @return {Promise<void>}
 */
async function crearGrupo(
    carreraId,
    semestreId,
    grupoId,
    datos,
) {
  await db
      .collection("carreras")
      .doc(carreraId)
      .collection("semestres")
      .doc(semestreId)
      .collection("grupos")
      .doc(grupoId)
      .set({
        nombre: datos.nombre,
        activo: true,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
      });
}

/**
 * Actualiza una carrera.
 *
 * @param {string} carreraId ID de la carrera.
 * @param {Object} datos Datos a actualizar.
 * @return {Promise<void>}
 */
async function actualizarCarrera(
    carreraId,
    datos,
) {
  await db
      .collection("carreras")
      .doc(carreraId)
      .update({
        ...datos,
        fechaActualizacion: new Date(),
      });
}

/**
 * Actualiza un semestre.
 *
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @param {Object} datos Datos a actualizar.
 * @return {Promise<void>}
 */
async function actualizarSemestre(
    carreraId,
    semestreId,
    datos,
) {
  await db
      .collection("carreras")
      .doc(carreraId)
      .collection("semestres")
      .doc(semestreId)
      .update({
        ...datos,
        fechaActualizacion: new Date(),
      });
}

/**
 * Actualiza un grupo.
 *
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @param {string} grupoId ID del grupo.
 * @param {Object} datos Datos a actualizar.
 * @return {Promise<void>}
 */
async function actualizarGrupo(
    carreraId,
    semestreId,
    grupoId,
    datos,
) {
  await db
      .collection("carreras")
      .doc(carreraId)
      .collection("semestres")
      .doc(semestreId)
      .collection("grupos")
      .doc(grupoId)
      .update({
        ...datos,
        fechaActualizacion: new Date(),
      });
}

/**
 * Valida que una carrera exista y esté activa.
 *
 * @param {string} carreraId ID de la carrera.
 * @return {Promise<Object>} Carrera activa.
 */
async function validarCarreraActiva(carreraId) {
  const carrera = await obtenerCarrera(carreraId);

  if (!carrera) {
    throw new Error(
        "La carrera no existe.",
    );
  }

  if (carrera.activo !== true) {
    throw new Error(
        "La carrera está inactiva.",
    );
  }

  return carrera;
}

/**
 * Valida que un semestre exista y esté activo.
 *
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @return {Promise<Object>} Semestre activo.
 */
async function validarSemestreActivo(
    carreraId,
    semestreId,
) {
  await validarCarreraActiva(carreraId);

  const semestres = await obtenerSemestres(
      carreraId,
  );

  const semestre = semestres.find(
      (item) =>
        String(item.id) === String(semestreId),
  );

  if (!semestre) {
    throw new Error(
        "El semestre no existe o está inactivo.",
    );
  }

  if (semestre.activo !== true) {
    throw new Error(
        "El semestre está inactivo.",
    );
  }

  return semestre;
}

/**
 * Valida que un grupo exista y esté activo.
 *
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @param {string} grupoId ID del grupo.
 * @return {Promise<Object>} Grupo activo.
 */
async function validarGrupoActivo(
    carreraId,
    semestreId,
    grupoId,
) {
  await validarSemestreActivo(
      carreraId,
      semestreId,
  );

  const grupos = await obtenerGrupos(
      carreraId,
      semestreId,
  );

  const grupo = grupos.find(
      (item) =>
        String(item.id) === String(grupoId),
  );

  if (!grupo) {
    throw new Error(
        "El grupo no existe o está inactivo.",
    );
  }

  if (grupo.activo !== true) {
    throw new Error(
        "El grupo está inactivo.",
    );
  }

  return grupo;
}

module.exports = {
  obtenerCarreras,
  obtenerCarrera,
  obtenerSemestres,
  obtenerGrupos,
  crearCarrera,
  crearSemestre,
  crearGrupo,
  actualizarCarrera,
  actualizarSemestre,
  actualizarGrupo,
  validarCarreraActiva,
  validarSemestreActivo,
  validarGrupoActivo,
};
