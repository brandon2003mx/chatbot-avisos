const {db} = require("../src/config/firebase");

/**
 * Crea o actualiza una carrera.
 *
 * @param {string} carreraId Identificador de la carrera.
 * @param {Object} datos Datos de la carrera.
 * @return {Promise<FirebaseFirestore.DocumentReference>}
 */
async function crearCarrera(carreraId, datos) {
  const carreraRef = db.collection("carreras").doc(carreraId);

  await carreraRef.set(datos);

  return carreraRef;
}

/**
 * Crea o actualiza un semestre.
 *
 * @param {string} carreraId Identificador de la carrera.
 * @param {string} semestreId Identificador del semestre.
 * @param {Object} datos Datos del semestre.
 * @return {Promise<FirebaseFirestore.DocumentReference>}
 */
async function crearSemestre(carreraId, semestreId, datos) {
  const semestreRef = db
      .collection("carreras")
      .doc(carreraId)
      .collection("semestres")
      .doc(semestreId);

  await semestreRef.set(datos);

  return semestreRef;
}

/**
 * Crea o actualiza un grupo.
 *
 * @param {string} carreraId Identificador de la carrera.
 * @param {string} semestreId Identificador del semestre.
 * @param {string} grupoId Identificador del grupo.
 * @param {Object} datos Datos del grupo.
 * @return {Promise<FirebaseFirestore.DocumentReference>}
 */
async function crearGrupo(carreraId, semestreId, grupoId, datos) {
  const grupoRef = db
      .collection("carreras")
      .doc(carreraId)
      .collection("semestres")
      .doc(semestreId)
      .collection("grupos")
      .doc(grupoId);

  await grupoRef.set(datos);

  return grupoRef;
}

/**
 * Carga datos académicos de prueba.
 *
 * @return {Promise<void>}
 */
async function seed() {
  const carreraId = "sistemas";

  await crearCarrera(carreraId, {
    nombre: "Ingeniería en Sistemas Computacionales",
    clave: "ISC",
    activo: true,
    fechaCreacion: new Date(),
    fechaActualizacion: new Date(),
  });

  const grupos = ["A", "B", "C"];

  for (let numero = 1; numero <= 9; numero++) {
    const semestreId = String(numero);

    await crearSemestre(carreraId, semestreId, {
      numero,
      activo: true,
      fechaCreacion: new Date(),
      fechaActualizacion: new Date(),
    });

    for (const grupo of grupos) {
      await crearGrupo(carreraId, semestreId, grupo, {
        nombre: grupo,
        activo: true,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
      });
    }
  }

  console.log("Datos académicos creados correctamente.");
}

seed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Error creando datos académicos:", error);
      process.exit(1);
    });
