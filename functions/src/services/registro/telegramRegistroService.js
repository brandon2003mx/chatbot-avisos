const {
  iniciarRegistro,
  actualizarRegistro,
} = require("./registroService");

const {
  obtenerEstudiantePorTelegramId,
} = require("../estudianteService");

const {
  obtenerCarreras,
  obtenerSemestres,
  obtenerGrupos,
} = require("../carreraService");

const {
  enviarMensaje,
  responderCallback,
} = require("../telegramService");

/**
 * Crea un teclado inline con las carreras disponibles.
 *
 * @param {Array} carreras Lista de carreras.
 * @return {Object} Reply markup.
 */
function crearTecladoCarreras(carreras) {
  return {
    inline_keyboard: carreras.map((carrera) => [
      {
        text: carrera.nombre,
        callback_data: `carrera:${carrera.id}`,
      },
    ]),
  };
}

/**
 * Crea un teclado inline con los semestres disponibles.
 *
 * @param {Array} semestres Lista de semestres.
 * @param {string} carreraId Identificador de la carrera.
 * @return {Object} Reply markup.
 */
function crearTecladoSemestres(semestres, carreraId) {
  const botones = semestres.map((semestre) => ({
    text: `${semestre.numero}º`,
    callback_data: `semestre:${carreraId}:${semestre.id}`,
  }));

  const filas = [];

  for (let i = 0; i < botones.length; i += 3) {
    filas.push(botones.slice(i, i + 3));
  }

  return {
    inline_keyboard: filas,
  };
}

/**
 * Crea un teclado inline con los grupos disponibles.
 *
 * @param {Array} grupos Lista de grupos.
 * @param {string} carreraId Identificador de la carrera.
 * @param {string} semestreId Identificador del semestre.
 * @return {Object} Reply markup.
 */
function crearTecladoGrupos(grupos, carreraId, semestreId) {
  return {
    inline_keyboard: [
      grupos.map((grupo) => ({
        text: grupo.nombre,
        callback_data:
          `grupo:${carreraId}:${semestreId}:${grupo.id}`,
      })),
    ],
  };
}

/**
 * Procesa el comando /start.
 *
 * @param {Object} mensaje Mensaje de Telegram.
 * @return {Promise<void>}
 */
async function procesarStart(mensaje) {
  const telegramId = String(mensaje.chat.id);

  let nombre = "Estudiante";

  if (mensaje.from && mensaje.from.first_name) {
    nombre = mensaje.from.first_name;
  }

  const resultado = await iniciarRegistro(
      telegramId,
      nombre,
  );

  if (!resultado.nuevo && resultado.estudiante.estadoRegistro === "completo") {
    await enviarMensaje(
        telegramId,
        "✅ Ya estás registrado.\n\n" +
        "Tu cuenta está activa para recibir avisos.",
    );

    return;
  }

  const carreras = await obtenerCarreras();

  if (carreras.length === 0) {
    await enviarMensaje(
        telegramId,
        "Actualmente no hay carreras disponibles para registrarse.",
    );

    return;
  }

  await actualizarRegistro(telegramId, {
    estadoRegistro: "esperando_carrera",
  });

  await enviarMensaje(
      telegramId,
      "Hola " + nombre + " 👋\n\n" +
      "Selecciona tu carrera:",
      {
        reply_markup: crearTecladoCarreras(carreras),
      },
  );
}

/**
 * Procesa la selección de una carrera.
 *
 * @param {string} telegramId Identificador de Telegram.
 * @param {string} carreraId Identificador de la carrera.
 * @return {Promise<void>}
 */
async function procesarCarrera(telegramId, carreraId) {
  const estudiante = await obtenerEstudiantePorTelegramId(telegramId);

  if (!estudiante) {
    await enviarMensaje(
        telegramId,
        "Primero debes iniciar el registro con /start.",
    );

    return;
  }

  const semestres = await obtenerSemestres(carreraId);

  if (semestres.length === 0) {
    await enviarMensaje(
        telegramId,
        "Esta carrera no tiene semestres disponibles.",
    );

    return;
  }

  await actualizarRegistro(telegramId, {
    carreraId,
    estadoRegistro: "esperando_semestre",
  });

  await enviarMensaje(
      telegramId,
      "Selecciona tu semestre:",
      {
        reply_markup: crearTecladoSemestres(
            semestres,
            carreraId,
        ),
      },
  );
}

/**
 * Procesa la selección de un semestre.
 *
 * @param {string} telegramId Identificador de Telegram.
 * @param {string} carreraId Identificador de la carrera.
 * @param {string} semestreId Identificador del semestre.
 * @return {Promise<void>}
 */
async function procesarSemestre(
    telegramId,
    carreraId,
    semestreId,
) {
  const estudiante = await obtenerEstudiantePorTelegramId(telegramId);

  if (!estudiante) {
    await enviarMensaje(
        telegramId,
        "Primero debes iniciar el registro con /start.",
    );

    return;
  }

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

  await actualizarRegistro(telegramId, {
    carreraId,
    semestre: Number(semestreId),
    estadoRegistro: "esperando_grupo",
  });

  await enviarMensaje(
      telegramId,
      "Selecciona tu grupo:",
      {
        reply_markup: crearTecladoGrupos(
            grupos,
            carreraId,
            semestreId,
        ),
      },
  );
}

/**
 * Procesa la selección de un grupo y completa el registro.
 *
 * @param {string} telegramId Identificador de Telegram.
 * @param {string} carreraId Identificador de la carrera.
 * @param {string} semestreId Identificador del semestre.
 * @param {string} grupoId Identificador del grupo.
 * @return {Promise<void>}
 */
async function procesarGrupo(
    telegramId,
    carreraId,
    semestreId,
    grupoId,
) {
  const estudiante = await obtenerEstudiantePorTelegramId(telegramId);

  if (!estudiante) {
    await enviarMensaje(
        telegramId,
        "Primero debes iniciar el registro con /start.",
    );

    return;
  }

  await actualizarRegistro(telegramId, {
    carreraId,
    semestre: Number(semestreId),
    grupoId,
    correoVerificado: false,
    estadoRegistro: "completo",
    activo: true,
  });

  await enviarMensaje(
      telegramId,
      "✅ Registro completado.\n\n" +
      `Carrera: ${carreraId}\n` +
      `Semestre: ${semestreId}\n` +
      `Grupo: ${grupoId}\n\n` +
      "Ya puedes recibir los avisos académicos.",
  );
}

/**
 * Procesa un botón inline.
 *
 * @param {Object} callbackQuery Consulta de Telegram.
 * @return {Promise<void>}
 */
async function procesarCallbackQuery(callbackQuery) {
  const callbackQueryId = callbackQuery.id;
  const telegramId = String(callbackQuery.from.id);
  const datos = callbackQuery.data || "";

  try {
    await responderCallback(callbackQueryId);
  } catch (error) {
    console.error(
        "No se pudo responder el callback de Telegram:",
        error.message,
    );
  }

  const partes = datos.split(":");
  const tipo = partes[0];

  if (tipo === "carrera" && partes.length === 2) {
    await procesarCarrera(
        telegramId,
        partes[1],
    );

    return;
  }

  if (tipo === "semestre" && partes.length === 3) {
    await procesarSemestre(
        telegramId,
        partes[1],
        partes[2],
    );

    return;
  }

  if (tipo === "grupo" && partes.length === 4) {
    await procesarGrupo(
        telegramId,
        partes[1],
        partes[2],
        partes[3],
    );

    return;
  }

  await enviarMensaje(
      telegramId,
      "La opción seleccionada no es válida.",
  );
}

/**
 * Procesa una actualización recibida desde Telegram.
 *
 * @param {Object} update Actualización de Telegram.
 * @return {Promise<void>}
 */
async function procesarActualizacion(update) {
  if (update.callback_query) {
    await procesarCallbackQuery(update.callback_query);
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

  if (texto === "/start") {
    await procesarStart(mensaje);
    return;
  }

  const telegramId = String(mensaje.chat.id);

  const estudiante = await obtenerEstudiantePorTelegramId(
      telegramId,
  );

  if (!estudiante) {
    await enviarMensaje(
        telegramId,
        "Primero debes iniciar tu registro con /start.",
    );

    return;
  }

  await enviarMensaje(
      telegramId,
      "Utiliza /start para iniciar o reiniciar tu registro.",
  );
}

module.exports = {
  procesarActualizacion,
};
