const {
  obtenerEstudiantePorTelegramId,
  guardarEstudiante,
} = require("../estudianteService");

const {
  obtenerCarreras,
  obtenerCarrera,
  obtenerSemestres,
  obtenerGrupos,
} = require("../carreraService");

const {
  enviarMensaje,
  responderCallback,
} = require("../telegramService");

/**
 * Obtiene el nombre del usuario desde Telegram.
 *
 * @param {Object} mensaje Mensaje de Telegram.
 * @return {string}
 */
function obtenerNombre(mensaje) {
  if (mensaje.from && mensaje.from.first_name) {
    return mensaje.from.first_name;
  }

  return "Estudiante";
}

/**
 * Muestra la información actual del estudiante.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function mostrarInfo(telegramId) {
  const estudiante = await obtenerEstudiantePorTelegramId(
      telegramId,
  );

  if (!estudiante) {
    await enviarMensaje(
        telegramId,
        "Aún no estás registrado.\n\n" +
        "Utiliza /start para comenzar tu registro.",
    );

    return;
  }

  if (estudiante.estadoRegistro !== "completo") {
    await enviarMensaje(
        telegramId,
        "Aún no has terminado tu registro.\n\n" +
        "Utiliza /start para comenzar.",
    );

    return;
  }

  const carrera = await obtenerCarrera(
      estudiante.carreraId,
  );

  let nombreCarrera = estudiante.carreraId;

  if (carrera) {
    nombreCarrera = carrera.nombre;
  }

  await enviarMensaje(
      telegramId,
      "👤 Mi información\n\n" +
      `🎓 Carrera: ${nombreCarrera}\n` +
      `📚 Semestre: ${estudiante.semestre}\n` +
      `👥 Grupo: ${estudiante.grupoId}`,
  );
}

/**
 * Muestra las carreras disponibles.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {boolean} modificacion Indica si se está modificando.
 * @return {Promise<void>}
 */
async function mostrarCarreras(
    telegramId,
    modificacion,
) {
  const carreras = await obtenerCarreras();

  if (carreras.length === 0) {
    await enviarMensaje(
        telegramId,
        "Actualmente no hay carreras disponibles.",
    );

    return;
  }

  const botones = carreras.map((carrera) => [
    {
      text: carrera.nombre,
      callback_data:
        modificacion ?
          `editar:carrera:${carrera.id}` :
          `nuevo:carrera:${carrera.id}`,
    },
  ]);

  if (modificacion) {
    botones.push([
      {
        text: "↩️ Cancelar",
        callback_data: "editar:cancelar",
      },
    ]);
  }

  await enviarMensaje(
      telegramId,
      "🎓 Selecciona tu carrera:",
      {
        reply_markup: {
          inline_keyboard: botones,
        },
      },
  );
}

/**
 * Muestra los semestres disponibles.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} carreraId ID de la carrera.
 * @param {boolean} modificacion Indica si se está modificando.
 * @return {Promise<void>}
 */
async function mostrarSemestres(
    telegramId,
    carreraId,
    modificacion,
) {
  const semestres = await obtenerSemestres(
      carreraId,
  );

  if (semestres.length === 0) {
    await enviarMensaje(
        telegramId,
        "Esta carrera no tiene semestres disponibles.",
    );

    return;
  }

  const botones = semestres.map((semestre) => ({
    text: `${semestre.numero}º`,
    callback_data:
      modificacion ?
        `editar:semestre:${carreraId}:${semestre.id}` :
        `nuevo:semestre:${carreraId}:${semestre.id}`,
  }));

  const filas = [];

  for (let i = 0; i < botones.length; i += 3) {
    filas.push(botones.slice(i, i + 3));
  }

  const navegacion = [
    {
      text: "⬅️ Atrás",
      callback_data: modificacion ?
        "editar:carreras" :
        "nuevo:carreras",
    },
  ];

  if (modificacion) {
    navegacion.push({
      text: "↩️ Cancelar",
      callback_data: "editar:cancelar",
    });
  }

  filas.push(navegacion);

  await enviarMensaje(
      telegramId,
      "📚 Selecciona tu semestre:",
      {
        reply_markup: {
          inline_keyboard: filas,
        },
      },
  );
}

/**
 * Muestra los grupos disponibles.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @param {boolean} modificacion Indica si se está modificando.
 * @return {Promise<void>}
 */
async function mostrarGrupos(
    telegramId,
    carreraId,
    semestreId,
    modificacion,
) {
  const grupos = await obtenerGrupos(
      carreraId,
      semestreId,
  );

  if (grupos.length === 0) {
    await enviarMensaje(
        telegramId,
        "Este semestre no tiene grupos disponibles.",
    );

    return;
  }

  const botones = grupos.map((grupo) => ({
    text: grupo.nombre,
    callback_data:
      modificacion ?
        `editar:grupo:${carreraId}:${semestreId}:${grupo.id}` :
        `nuevo:grupo:${carreraId}:${semestreId}:${grupo.id}`,
  }));

  const navegacion = [
    {
      text: "⬅️ Atrás",
      callback_data: modificacion ?
        `editar:semestres:${carreraId}` :
        `nuevo:semestres:${carreraId}`,
    },
  ];

  if (modificacion) {
    navegacion.push({
      text: "↩️ Cancelar",
      callback_data: "editar:cancelar",
    });
  }

  await enviarMensaje(
      telegramId,
      "👥 Selecciona tu grupo:",
      {
        reply_markup: {
          inline_keyboard: [
            botones,
            navegacion,
          ],
        },
      },
  );
}

/**
 * Guarda un registro nuevo.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @param {string} grupoId ID del grupo.
 * @param {string} nombre Nombre del estudiante.
 * @return {Promise<void>}
 */
async function guardarRegistroNuevo(
    telegramId,
    carreraId,
    semestreId,
    grupoId,
    nombre,
) {
  const estudianteExistente =
    await obtenerEstudiantePorTelegramId(
        telegramId,
    );

  if (estudianteExistente) {
    await enviarMensaje(
        telegramId,
        "Ya existe un registro asociado a tu cuenta.",
    );

    return;
  }

  await guardarEstudiante(
      telegramId,
      {
        nombre,
        matricula: "",
        correoInstitucional: "",
        correoVerificado: false,
        carreraId,
        semestre: Number(semestreId),
        grupoId,
        fcmToken: "",
        estadoRegistro: "completo",
        fechaRegistro: new Date(),
      },
  );

  const carrera = await obtenerCarrera(carreraId);

  let nombreCarrera = carreraId;

  if (carrera) {
    nombreCarrera = carrera.nombre;
  }

  await enviarMensaje(
      telegramId,
      "🎉 ¡Registro completado!\n\n" +
      `🎓 Carrera: ${nombreCarrera}\n` +
      `📚 Semestre: ${semestreId}\n` +
      `👥 Grupo: ${grupoId}\n\n` +
      "Ya puedes recibir los avisos académicos del ITTG.",
  );
}

/**
 * Guarda una modificación del estudiante.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @param {string} grupoId ID del grupo.
 * @return {Promise<void>}
 */
async function guardarModificacion(
    telegramId,
    carreraId,
    semestreId,
    grupoId,
) {
  const estudiante =
    await obtenerEstudiantePorTelegramId(
        telegramId,
    );

  if (!estudiante) {
    await enviarMensaje(
        telegramId,
        "No encontramos tu registro.",
    );

    return;
  }

  await guardarEstudiante(
      telegramId,
      {
        nombre: estudiante.nombre,
        matricula: estudiante.matricula,
        correoInstitucional:
          estudiante.correoInstitucional,
        correoVerificado:
          estudiante.correoVerificado,
        carreraId,
        semestre: Number(semestreId),
        grupoId,
        fcmToken: estudiante.fcmToken,
        estadoRegistro: "completo",
        fechaRegistro: estudiante.fechaRegistro,
      },
  );

  const carrera = await obtenerCarrera(carreraId);

  let nombreCarrera = carreraId;

  if (carrera) {
    nombreCarrera = carrera.nombre;
  }

  await enviarMensaje(
      telegramId,
      "✅ Información actualizada.\n\n" +
      `🎓 Carrera: ${nombreCarrera}\n` +
      `📚 Semestre: ${semestreId}\n` +
      `👥 Grupo: ${grupoId}`,
  );
}

/**
 * Inicia el registro nuevo.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} nombre Nombre del usuario.
 * @return {Promise<void>}
 */
async function iniciarRegistroNuevo(
    telegramId,
    nombre,
) {
  const estudiante =
    await obtenerEstudiantePorTelegramId(
        telegramId,
    );

  if (estudiante) {
    await enviarMensaje(
        telegramId,
        "Tu cuenta ya está registrada.\n\n" +
        "Para modificar tu información utiliza /registro.",
    );

    return;
  }

  await mostrarCarreras(
      telegramId,
      false,
  );
}

/**
 * Inicia la modificación.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function iniciarModificacion(telegramId) {
  const estudiante =
    await obtenerEstudiantePorTelegramId(
        telegramId,
    );

  if (!estudiante) {
    await enviarMensaje(
        telegramId,
        "Aún no estás registrado.\n\n" +
        "Utiliza /start para comenzar.",
    );

    return;
  }

  if (estudiante.estadoRegistro !== "completo") {
    await enviarMensaje(
        telegramId,
        "Tu registro todavía no está completo.",
    );

    return;
  }

  await enviarMensaje(
      telegramId,
      "✏️ Modificar información\n\n" +
      "Selecciona tu nueva carrera.\n\n" +
      "Tus datos actuales no cambiarán hasta " +
      "que termines la modificación.",
  );

  await mostrarCarreras(
      telegramId,
      true,
  );
}

/**
 * Cancela una modificación.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function cancelarModificacion(telegramId) {
  await enviarMensaje(
      telegramId,
      "↩️ Modificación cancelada.\n\n" +
      "Tus datos anteriores permanecen sin cambios.",
  );
}

/**
 * Procesa una pulsación de botón.
 *
 * @param {Object} callbackQuery Callback de Telegram.
 * @return {Promise<void>}
 */
async function procesarCallbackQuery(
    callbackQuery,
) {
  try {
    await responderCallback(
        callbackQuery.id,
    );
  } catch (error) {
    console.error(
        "No se pudo responder el callback:",
        error.message,
    );
  }

  const telegramId = String(
      callbackQuery.from.id,
  );

  const datos = callbackQuery.data || "";
  const partes = datos.split(":");

  if (datos === "registro:iniciar") {
    const nombre = obtenerNombre(
        callbackQuery.message,
    );

    await iniciarRegistroNuevo(
        telegramId,
        nombre,
    );

    return;
  }

  if (datos === "registro:modificar") {
    await iniciarModificacion(telegramId);
    return;
  }

  if (datos === "editar:cancelar") {
    await cancelarModificacion(telegramId);
    return;
  }

  if (datos === "nuevo:carreras") {
    await mostrarCarreras(
        telegramId,
        false,
    );

    return;
  }

  if (datos === "editar:carreras") {
    await mostrarCarreras(
        telegramId,
        true,
    );

    return;
  }

  if (
    partes[0] === "nuevo" &&
    partes[1] === "carrera" &&
    partes.length === 3
  ) {
    await mostrarSemestres(
        telegramId,
        partes[2],
        false,
    );

    return;
  }

  if (
    partes[0] === "editar" &&
    partes[1] === "carrera" &&
    partes.length === 3
  ) {
    await mostrarSemestres(
        telegramId,
        partes[2],
        true,
    );

    return;
  }

  if (
    partes[0] === "nuevo" &&
    partes[1] === "semestre" &&
    partes.length === 4
  ) {
    await mostrarGrupos(
        telegramId,
        partes[2],
        partes[3],
        false,
    );

    return;
  }

  if (
    partes[0] === "editar" &&
    partes[1] === "semestre" &&
    partes.length === 4
  ) {
    await mostrarGrupos(
        telegramId,
        partes[2],
        partes[3],
        true,
    );

    return;
  }

  if (
    partes[0] === "nuevo" &&
    partes[1] === "grupo" &&
    partes.length === 5
  ) {
    const mensaje =
      callbackQuery.message;

    const nombre =
      obtenerNombre(mensaje);

    await guardarRegistroNuevo(
        telegramId,
        partes[2],
        partes[3],
        partes[4],
        nombre,
    );

    return;
  }

  if (
    partes[0] === "editar" &&
    partes[1] === "grupo" &&
    partes.length === 5
  ) {
    await guardarModificacion(
        telegramId,
        partes[2],
        partes[3],
        partes[4],
    );

    return;
  }

  if (
    partes[0] === "editar" &&
    partes[1] === "semestres" &&
    partes.length === 3
  ) {
    await mostrarSemestres(
        telegramId,
        partes[2],
        true,
    );

    return;
  }

  if (
    partes[0] === "nuevo" &&
    partes[1] === "semestres" &&
    partes.length === 3
  ) {
    await mostrarSemestres(
        telegramId,
        partes[2],
        false,
    );

    return;
  }

  await enviarMensaje(
      telegramId,
      "La opción seleccionada no es válida.",
  );
}

/**
 * Procesa /start.
 *
 * @param {Object} mensaje Mensaje de Telegram.
 * @return {Promise<void>}
 */
async function procesarStart(mensaje) {
  const telegramId = String(mensaje.chat.id);
  const nombre = obtenerNombre(mensaje);

  const estudiante =
    await obtenerEstudiantePorTelegramId(
        telegramId,
    );

  if (!estudiante) {
    await mostrarBienvenida(
        telegramId,
        nombre,
    );

    return;
  }

  await mostrarInfo(
      telegramId,
  );
}

/**
 * Procesa /info.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function procesarInfo(telegramId) {
  await mostrarInfo(telegramId);
}

/**
 * Procesa /registro.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function procesarRegistro(telegramId) {
  await iniciarModificacion(telegramId);
}

/**
 * Muestra bienvenida a un usuario nuevo.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} nombre Nombre.
 * @return {Promise<void>}
 */
async function mostrarBienvenida(
    telegramId,
    nombre,
) {
  await enviarMensaje(
      telegramId,
      `👋 ¡Bienvenido, ${nombre}!\n\n` +
      "Este es el Chatbot de Difusión ITTG.\n\n" +
      "Aquí recibirás avisos académicos " +
      "de tu carrera, semestre y grupo.\n\n" +
      "Para comenzar, pulsa el botón:",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📝 Registrarme",
                callback_data: "registro:iniciar",
              },
            ],
          ],
        },
      },
  );
}

/**
 * Procesa actualizaciones de Telegram.
 *
 * @param {Object} update Actualización.
 * @return {Promise<void>}
 */
async function procesarActualizacion(update) {
  if (update.callback_query) {
    await procesarCallbackQuery(
        update.callback_query,
    );

    return;
  }

  const mensaje = update.message;

  if (!mensaje || !mensaje.chat) {
    return;
  }

  let texto = "";

  if (mensaje.text) {
    texto = mensaje.text.trim();
  }

  const telegramId = String(mensaje.chat.id);

  if (texto === "/start") {
    await procesarStart(mensaje);
    return;
  }

  if (texto === "/info") {
    await procesarInfo(telegramId);
    return;
  }

  if (texto === "/registro") {
    await procesarRegistro(telegramId);
    return;
  }

  await enviarMensaje(
      telegramId,
      "Utiliza /info o /registro desde el menú.",
  );
}

module.exports = {
  procesarActualizacion,
};
