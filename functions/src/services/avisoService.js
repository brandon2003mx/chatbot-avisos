const {db} = require("../config/firebase");

/**
 * Crea un aviso en Firestore.
 *
 * @param {Object} aviso
 * @return {Promise<string>}
 */
async function crearAviso(aviso) {
  const referencia = await db.collection("avisos").add({
    ...aviso,
    activo: true,
    fechaCreacion: new Date(),
  });

  return referencia.id;
}

module.exports = {
  crearAviso,
};
