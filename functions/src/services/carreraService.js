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

const SEMESTRES_POR_DEFECTO = 9;
const GRUPOS_POR_DEFECTO = ["A", "B", "C"];

// Límites que mantienen el lote de creación muy por debajo del máximo
// de 500 escrituras de Firestore: 1 + 12 + 12 * 10 = 133.
const MAX_SEMESTRES = 12;
const MAX_GRUPOS = 10;

const NOMBRE_GRUPO_REGEX = /^[A-Z0-9]{1,5}$/;

/**
 * Valida y normaliza la estructura académica con la que nace una
 * carrera. Acepta los grupos como arreglo o como texto separado por
 * comas ("A, B, C"); los pasa a mayúsculas y quita repetidos.
 *
 * @param {*} numeroSemestres Cantidad de semestres (vacío = default).
 * @param {*} grupos Grupos por semestre (vacío = default).
 * @return {{numeroSemestres: number, grupos: Array<string>}}
 */
function normalizarEstructura(numeroSemestres, grupos) {
  let semestres = SEMESTRES_POR_DEFECTO;

  if (
    numeroSemestres !== undefined &&
    numeroSemestres !== null &&
    numeroSemestres !== ""
  ) {
    semestres = Number(numeroSemestres);

    if (
      !Number.isInteger(semestres) ||
      semestres < 1 ||
      semestres > MAX_SEMESTRES
    ) {
      throw new Error(
          "El número de semestres debe ser un entero entre 1 y 12.",
      );
    }
  }

  let listaGrupos = GRUPOS_POR_DEFECTO;

  if (grupos !== undefined && grupos !== null && grupos !== "") {
    const crudos = Array.isArray(grupos) ?
      grupos :
      String(grupos).split(",");

    listaGrupos = [...new Set(
        crudos
            .map((grupo) => String(grupo).trim().toUpperCase())
            .filter((grupo) => grupo !== ""),
    )];

    if (listaGrupos.length === 0) {
      throw new Error("Debes indicar al menos un grupo.");
    }

    if (listaGrupos.length > MAX_GRUPOS) {
      throw new Error("No puede haber más de 10 grupos.");
    }

    if (!listaGrupos.every((grupo) => NOMBRE_GRUPO_REGEX.test(grupo))) {
      throw new Error(
          "Los grupos solo pueden tener letras o números " +
          "(máximo 5 caracteres).",
      );
    }
  }

  return {numeroSemestres: semestres, grupos: listaGrupos};
}

/**
 * Crea una carrera junto con su estructura académica completa
 * (semestres y grupos), en un solo lote atómico: o se crea todo o
 * nada, para que nunca quede una carrera sin semestres — un estudiante
 * que la eligiera en el bot no podría terminar su registro.
 *
 * @param {string} carreraId Identificador de la carrera.
 * @param {Object} datos Datos de la carrera. `clave` es opcional.
 *   `numeroSemestres` y `grupos` son opcionales y, si no vienen, se
 *   usan 9 semestres con grupos A, B y C.
 * @return {Promise<void>}
 */
async function crearCarrera(
    carreraId,
    datos,
) {
  const {numeroSemestres, grupos} = normalizarEstructura(
      datos.numeroSemestres,
      datos.grupos,
  );

  const carreraRef = db.collection("carreras").doc(carreraId);
  const lote = db.batch();

  lote.set(
      carreraRef,
      {
        nombre: datos.nombre,
        clave: datos.clave || "",
        activo: true,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
      },
  );

  for (let numero = 1; numero <= numeroSemestres; numero++) {
    const semestreRef = carreraRef.collection("semestres").doc(String(numero));

    lote.set(semestreRef, {
      numero,
      activo: true,
      fechaCreacion: new Date(),
      fechaActualizacion: new Date(),
    });

    for (const nombre of grupos) {
      lote.set(semestreRef.collection("grupos").doc(nombre), {
        nombre,
        activo: true,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
      });
    }
  }

  await lote.commit();
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
  normalizarEstructura,
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
