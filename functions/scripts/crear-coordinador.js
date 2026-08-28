const {db} = require("../src/config/firebase");

/**
 * Crea el usuario coordinador de prueba.
 *
 * @return {Promise<void>}
 */
async function crearCoordinador() {
  const uid = process.argv[2];

  if (!uid) {
    throw new Error(
        "Debes proporcionar el UID como argumento.",
    );
  }

  await db
      .collection("usuarios")
      .doc(uid)
      .set({
        nombre: "Coordinador de Prueba",
        correo: "coordinador@ittg.test",
        rol: "coordinador",
        activo: true,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
      });

  console.log(
      `Usuario coordinador creado: ${uid}`,
  );
}

crearCoordinador()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(
          "Error creando coordinador:",
          error,
      );
      process.exit(1);
    });
