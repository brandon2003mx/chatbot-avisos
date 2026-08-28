const {db} = require("../src/config/firebase");

/**
 * Crea el usuario administrador de prueba.
 *
 * @return {Promise<void>}
 */
async function crearAdministrador() {
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
        nombre: "Administrador de Prueba",
        correo: "admin@ittg.test",
        rol: "administrador",
        activo: true,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
      });

  console.log(
      `Usuario administrador creado: ${uid}`,
  );
}

crearAdministrador()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(
          "Error creando administrador:",
          error,
      );
      process.exit(1);
    });
