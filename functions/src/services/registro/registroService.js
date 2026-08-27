const {
  obtenerEstudiantePorTelegramId,
  crearRegistroInicial,
  actualizarRegistro,
} = require("../estudianteService");

/**
 * Inicia o recupera el registro de un estudiante.
 *
 * @param {string} telegramId Identificador de Telegram.
 * @param {string} nombre Nombre del usuario.
 * @return {Promise<Object>}
 */
async function iniciarRegistro(telegramId, nombre) {
  const estudiante = await obtenerEstudiantePorTelegramId(telegramId);

  if (estudiante) {
    return {
      nuevo: false,
      estudiante,
    };
  }

  const nuevoEstudiante = await crearRegistroInicial(
      telegramId,
      nombre,
  );

  return {
    nuevo: true,
    estudiante: nuevoEstudiante,
  };
}

/**
 * Guarda el correo institucional del estudiante
 * y cambia su estado de registro.
 *
 * @param {string} telegramId Identificador de Telegram.
 * @param {string} correo Correo institucional.
 * @return {Promise<void>}
 */
async function guardarCorreo(telegramId, correo) {
  await actualizarRegistro(telegramId, {
    correoInstitucional: correo,
    estadoRegistro: "esperando_verificacion",
  });
}

module.exports = {
  iniciarRegistro,
  guardarCorreo,
  actualizarRegistro,
};

