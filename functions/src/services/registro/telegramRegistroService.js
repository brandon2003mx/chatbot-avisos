const crypto = require("crypto");

const {db} = require("../../config/firebase");
const {FieldValue} = require("firebase-admin/firestore");

const {enviarCorreo} = require("../correoService");

const {
  obtenerEstudiantePorTelegramId,
  obtenerEstudiantePorNumControl,
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
 * Obtiene el nombre del usuario desde Telegram, solo para el
 * saludo de bienvenida (nunca se guarda como el nombre del
 * registro: eso el estudiante debe escribirlo él mismo).
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
 * Acepta letras (incluye acentos y ñ), espacios, apóstrofes y
 * guiones, para cubrir nombres compuestos y apellidos con guión.
 *
 * @type {RegExp}
 */
const NOMBRE_COMPLETO_REGEX =
  /^[a-zA-ZÀ-ÖØ-öø-ÿ]+(?:[ '-][a-zA-ZÀ-ÖØ-öø-ÿ]+)*$/;

/**
 * Valida y normaliza un nombre completo escrito por el estudiante.
 * Exige al menos nombre y un apellido (dos palabras), solo letras.
 *
 * @param {string} texto Texto recibido de Telegram.
 * @return {string|null} Nombre normalizado, o null si no es válido.
 */
function validarNombreCompleto(texto) {
  const limpio = (texto || "")
      .trim()
      .replace(/\s+/g, " ");

  if (limpio.length < 3 || limpio.length > 80) {
    return null;
  }

  if (!NOMBRE_COMPLETO_REGEX.test(limpio)) {
    return null;
  }

  if (limpio.split(" ").length < 2) {
    return null;
  }

  return limpio;
}

/**
 * Número de control del ITTG: exactamente 8 dígitos (estándar
 * TecNM: 2 de año + 3 de carrera + 3 secuenciales).
 *
 * @type {RegExp}
 */
const NUM_CONTROL_REGEX = /^\d{8}$/;

/**
 * Valida un número de control escrito por el estudiante.
 *
 * @param {string} texto Texto recibido de Telegram.
 * @return {string|null} Número de control normalizado, o null si
 *   no es válido.
 */
function validarNumControl(texto) {
  const limpio = (texto || "").trim();

  return NUM_CONTROL_REGEX.test(limpio) ? limpio : null;
}

const DOMINIO_INSTITUCIONAL = "tuxtla.tecnm.mx";
const PREFIJO_CORREO_INSTITUCIONAL = "l";
const CODIGO_VIGENCIA_MS = 10 * 60 * 1000;
const MAX_INTENTOS_CODIGO = 5;
const MAX_ENVIOS_CODIGO = 3;

/**
 * Deduce el correo institucional a partir del número de control.
 *
 * Que el correo se deduzca (en vez de que el estudiante lo escriba)
 * es lo que vuelve útil la verificación: si alguien teclea el número
 * de control de un compañero, el código llega al buzón del dueño
 * real y el impostor no puede continuar.
 *
 * @param {string} numControl Número de control.
 * @return {string}
 */
function correoInstitucionalDe(numControl) {
  return (
    `${PREFIJO_CORREO_INSTITUCIONAL}${numControl}` +
    `@${DOMINIO_INSTITUCIONAL}`
  );
}

/**
 * Genera un código de verificación de 6 dígitos.
 *
 * @return {string}
 */
function generarCodigo() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

/**
 * Calcula el hash del código para no guardarlo en claro.
 *
 * Con solo 6 dígitos el hash no resiste fuerza bruta por sí mismo:
 * lo que realmente protege es el límite de intentos y la vigencia
 * corta. El hash solo evita que el código quede legible para quien
 * mire la colección de registros pendientes.
 *
 * @param {string} codigo Código en claro.
 * @return {string}
 */
function hashCodigo(codigo) {
  return crypto.createHash("sha256").update(codigo).digest("hex");
}

/**
 * Guarda el avance de un registro que todavía no está completo:
 * primero solo la etapa ("nombre"), y luego el nombre completo ya
 * validado mientras el estudiante elige carrera/semestre/grupo.
 * Vive en una colección aparte de `estudiantes`: así ese registro
 * solo se crea hasta que el flujo completo termine, y nunca
 * aparece como destinatario de avisos a medio registrar.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {Object} datos {etapa, nombre?, numControl?}.
 * @return {Promise<void>}
 */
async function guardarRegistroPendiente(telegramId, datos) {
  await db
      .collection("registrosPendientes")
      .doc(String(telegramId))
      .set({
        ...datos,
        fechaInicio: new Date(),
      });
}

/**
 * Obtiene la selección pendiente de carrera/semestre/grupo de un
 * registro que solo le falta el nombre completo.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<Object|null>}
 */
async function obtenerRegistroPendiente(telegramId) {
  const documento = await db
      .collection("registrosPendientes")
      .doc(String(telegramId))
      .get();

  if (!documento.exists) {
    return null;
  }

  return documento.data();
}

/**
 * Elimina la selección pendiente, una vez que el registro ya
 * quedó completo (o para permitir reiniciarlo desde cero).
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function eliminarRegistroPendiente(telegramId) {
  await db
      .collection("registrosPendientes")
      .doc(String(telegramId))
      .delete();
}

/**
 * Genera y envía un código de verificación al correo institucional
 * deducido del número de control, y deja el registro pendiente
 * esperando ese código.
 *
 * Limita cuántas veces se puede reenviar por registro para que
 * nadie use el bot como forma de llenarle el buzón a un compañero.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {Object} pendiente Registro pendiente actual.
 * @return {Promise<boolean>} true si el código quedó enviado.
 */
async function enviarCodigoVerificacion(telegramId, pendiente) {
  const enviosPrevios = pendiente.codigoEnvios || 0;

  if (enviosPrevios >= MAX_ENVIOS_CODIGO) {
    await enviarMensaje(
        telegramId,
        "Ya se enviaron demasiados códigos para este registro. " +
        "Usa /start para comenzar de nuevo.",
    );

    return false;
  }

  const codigo = generarCodigo();
  const correo = correoInstitucionalDe(pendiente.numControl);

  try {
    await enviarCorreo(
        correo,
        "Código de verificación - Avisos ITTG",
        `Tu código de verificación es: ${codigo}\n\n` +
        "Escríbelo en el chat del bot para terminar tu registro.\n" +
        "El código vence en 10 minutos.\n\n" +
        "Si no solicitaste este registro, ignora este correo.",
    );
  } catch (error) {
    console.error(
        "No se pudo enviar el código de verificación:",
        error.message,
    );

    await enviarMensaje(
        telegramId,
        "No pudimos enviar el correo de verificación en este " +
        "momento. Intenta de nuevo en unos minutos.",
    );

    return false;
  }

  await guardarRegistroPendiente(
      telegramId,
      {
        ...pendiente,
        etapa: "codigo",
        correoInstitucional: correo,
        codigoHash: hashCodigo(codigo),
        codigoExpira: new Date(Date.now() + CODIGO_VIGENCIA_MS),
        codigoIntentos: 0,
        codigoEnvios: enviosPrevios + 1,
      },
  );

  await enviarMensaje(
      telegramId,
      `📧 Enviamos un código de 6 dígitos a ${correo}.\n\n` +
      "Escríbelo aquí para confirmar que eres tú. " +
      "Vence en 10 minutos.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🔄 Reenviar código",
                callback_data: "registro:reenviar",
              },
            ],
          ],
        },
      },
  );

  return true;
}

/**
 * Verifica el código que escribió el estudiante. Si es correcto,
 * avanza a la selección de carrera; si no, descuenta un intento.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} texto Texto recibido de Telegram.
 * @param {Object} pendiente Registro pendiente actual.
 * @return {Promise<void>}
 */
async function procesarCodigoVerificacion(
    telegramId,
    texto,
    pendiente,
) {
  const codigo = (texto || "").trim();

  if (!/^\d{6}$/.test(codigo)) {
    await enviarMensaje(
        telegramId,
        "El código debe ser de 6 dígitos. Revisa tu correo " +
        "institucional y escríbelo aquí.",
    );

    return;
  }

  const expira = pendiente.codigoExpira ?
    pendiente.codigoExpira.toDate().getTime() :
    0;

  if (Date.now() > expira) {
    await enviarMensaje(
        telegramId,
        "Ese código ya venció. Pulsa \"Reenviar código\" para " +
        "recibir uno nuevo.",
    );

    return;
  }

  const intentos = (pendiente.codigoIntentos || 0) + 1;

  if (hashCodigo(codigo) !== pendiente.codigoHash) {
    if (intentos >= MAX_INTENTOS_CODIGO) {
      await eliminarRegistroPendiente(telegramId);

      await enviarMensaje(
          telegramId,
          "Demasiados intentos fallidos. Tu registro se canceló; " +
          "usa /start para comenzar de nuevo.",
      );

      return;
    }

    await guardarRegistroPendiente(
        telegramId,
        {...pendiente, codigoIntentos: intentos},
    );

    await enviarMensaje(
        telegramId,
        "Código incorrecto. Te quedan " +
        `${MAX_INTENTOS_CODIGO - intentos} intento(s).`,
    );

    return;
  }

  // El código ya no se necesita: se guarda solo lo que hace falta
  // para terminar el registro.
  await guardarRegistroPendiente(
      telegramId,
      {
        etapa: "carrera",
        nombre: pendiente.nombre,
        numControl: pendiente.numControl,
        correoInstitucional: pendiente.correoInstitucional,
      },
  );

  await enviarMensaje(
      telegramId,
      "✅ Correo verificado.",
  );

  await mostrarCarreras(
      telegramId,
      false,
  );
}

/**
 * Retoma un registro pendiente donde se quedó: si todavía falta
 * el nombre o el número de control, lo vuelve a pedir; si ambos ya
 * se capturaron, vuelve a mostrar la selección de carrera (los
 * pasos con botones nunca se persisten, así que siempre se retoma
 * desde ahí).
 *
 * @param {string} telegramId ID de Telegram.
 * @param {Object} pendiente {etapa, nombre?, numControl?}.
 * @return {Promise<void>}
 */
async function continuarRegistroPendiente(
    telegramId,
    pendiente,
) {
  if (pendiente.etapa === "nombre") {
    await enviarMensaje(
        telegramId,
        "✍️ Escribe tu nombre completo (nombre y apellidos) " +
        "para continuar tu registro.",
    );

    return;
  }

  if (pendiente.etapa === "numControl") {
    await enviarMensaje(
        telegramId,
        "✍️ Escribe tu número de control (8 dígitos) " +
        "para continuar tu registro.",
    );

    return;
  }

  if (pendiente.etapa === "codigo") {
    await enviarMensaje(
        telegramId,
        "📧 Escribe el código de 6 dígitos que enviamos a " +
        `${pendiente.correoInstitucional} para continuar.`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🔄 Reenviar código",
                  callback_data: "registro:reenviar",
                },
              ],
            ],
          },
        },
    );

    return;
  }

  await mostrarCarreras(
      telegramId,
      false,
  );
}

/**
 * Obtiene el número visible de un semestre a partir de su ID.
 *
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @return {Promise<number|string>}
 */
async function obtenerNumeroSemestre(carreraId, semestreId) {
  const semestres = await obtenerSemestres(carreraId);

  const semestre = semestres.find(
      (item) => String(item.id) === String(semestreId),
  );

  return semestre ? semestre.numero : semestreId;
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
    const pendiente = await obtenerRegistroPendiente(
        telegramId,
    );

    if (pendiente) {
      await continuarRegistroPendiente(
          telegramId,
          pendiente,
      );

      return;
    }

    await enviarMensaje(
        telegramId,
        "Aún no estás registrado.\n\n" +
        "Utiliza /start para comenzar tu registro.",
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

  const numeroSemestre = await obtenerNumeroSemestre(
      estudiante.carreraId,
      estudiante.semestreId,
  );

  await enviarMensaje(
      telegramId,
      "👤 Mi información\n\n" +
      `📛 Nombre: ${estudiante.nombre}\n` +
      `🆔 Número de control: ${estudiante.numControl}\n` +
      `🎓 Carrera: ${nombreCarrera}\n` +
      `📚 Semestre: ${numeroSemestre}\n` +
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
 * Termina un registro nuevo: usa el nombre y número de control ya
 * capturados en el registro pendiente junto con la carrera/
 * semestre/grupo recién elegidos. Si el pendiente no existe o le
 * falta algo (por ejemplo, el estudiante llegó aquí con un botón
 * viejo de un intento anterior), le pide reiniciar con /start en
 * vez de fallar.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @param {string} grupoId ID del grupo.
 * @return {Promise<void>}
 */
async function finalizarRegistroNuevo(
    telegramId,
    carreraId,
    semestreId,
    grupoId,
) {
  const pendiente = await obtenerRegistroPendiente(
      telegramId,
  );

  if (
    !pendiente ||
    !pendiente.nombre ||
    !pendiente.numControl ||
    !pendiente.correoInstitucional
  ) {
    await enviarMensaje(
        telegramId,
        "Tu registro ya no es válido. " +
        "Usa /start para comenzar de nuevo.",
    );

    return;
  }

  await guardarRegistroNuevo(
      telegramId,
      pendiente.numControl,
      carreraId,
      semestreId,
      grupoId,
      pendiente.nombre,
      pendiente.correoInstitucional,
  );

  await eliminarRegistroPendiente(telegramId);
}

/**
 * Procesa el texto que el estudiante escribió mientras tenía un
 * registro pendiente: primero el nombre completo, luego el número
 * de control. En cualquier otra etapa (ya eligiendo carrera/
 * semestre/grupo con botones) se le recuerda usar los botones en
 * vez de escribir.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} texto Texto recibido de Telegram.
 * @param {Object} pendiente {etapa, nombre?, numControl?}.
 * @return {Promise<void>}
 */
async function procesarTextoRegistro(
    telegramId,
    texto,
    pendiente,
) {
  if (pendiente.etapa === "nombre") {
    const nombre = validarNombreCompleto(texto);

    if (!nombre) {
      await enviarMensaje(
          telegramId,
          "Ese nombre no parece válido. Escribe tu nombre " +
          "completo (nombre y al menos un apellido), usando " +
          "solo letras.",
      );

      return;
    }

    await guardarRegistroPendiente(
        telegramId,
        {
          etapa: "numControl",
          nombre,
        },
    );

    await enviarMensaje(
        telegramId,
        "🆔 Ahora escribe tu número de control (8 dígitos):",
    );

    return;
  }

  if (pendiente.etapa === "numControl") {
    const numControl = validarNumControl(texto);

    if (!numControl) {
      await enviarMensaje(
          telegramId,
          "Ese número de control no es válido. " +
          "Debe tener exactamente 8 dígitos.",
      );

      return;
    }

    const estudianteConEseNumControl =
      await obtenerEstudiantePorNumControl(
          numControl,
      );

    if (estudianteConEseNumControl) {
      await enviarMensaje(
          telegramId,
          "Ese número de control ya está registrado. " +
          "Si crees que es un error, contacta a tu " +
          "coordinador.",
      );

      return;
    }

    await enviarCodigoVerificacion(
        telegramId,
        {
          etapa: "codigo",
          nombre: pendiente.nombre,
          numControl,
          codigoEnvios: 0,
        },
    );

    return;
  }

  if (pendiente.etapa === "codigo") {
    await procesarCodigoVerificacion(
        telegramId,
        texto,
        pendiente,
    );

    return;
  }

  await enviarMensaje(
      telegramId,
      "Usa los botones para continuar tu registro.",
  );
}

/**
 * Guarda un registro nuevo.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} numControl Número de control del estudiante.
 * @param {string} carreraId ID de la carrera.
 * @param {string} semestreId ID del semestre.
 * @param {string} grupoId ID del grupo.
 * @param {string} nombre Nombre del estudiante.
 * @param {string} correoInstitucional Correo ya verificado.
 * @return {Promise<void>}
 */
async function guardarRegistroNuevo(
    telegramId,
    numControl,
    carreraId,
    semestreId,
    grupoId,
    nombre,
    correoInstitucional,
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
      numControl,
      {
        nombre,
        telegramId: String(telegramId),
        correoInstitucional,
        correoVerificado: true,
        carreraId,
        semestreId: String(semestreId),
        grupoId,
        fechaRegistro: new Date(),
      },
  );

  const carrera = await obtenerCarrera(carreraId);

  let nombreCarrera = carreraId;

  if (carrera) {
    nombreCarrera = carrera.nombre;
  }

  const numeroSemestre = await obtenerNumeroSemestre(
      carreraId,
      semestreId,
  );

  await enviarMensaje(
      telegramId,
      "🎉 ¡Registro completado!\n\n" +
      `🎓 Carrera: ${nombreCarrera}\n` +
      `📚 Semestre: ${numeroSemestre}\n` +
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
      estudiante.numControl,
      {
        nombre: estudiante.nombre,
        telegramId: estudiante.telegramId,
        correoInstitucional:
          estudiante.correoInstitucional,
        correoVerificado:
          estudiante.correoVerificado,
        carreraId,
        semestreId: String(semestreId),
        grupoId,
        fechaRegistro: estudiante.fechaRegistro,
      },
  );

  const carrera = await obtenerCarrera(carreraId);

  let nombreCarrera = carreraId;

  if (carrera) {
    nombreCarrera = carrera.nombre;
  }

  const numeroSemestre = await obtenerNumeroSemestre(
      carreraId,
      semestreId,
  );

  await enviarMensaje(
      telegramId,
      "✅ Información actualizada.\n\n" +
      `🎓 Carrera: ${nombreCarrera}\n` +
      `📚 Semestre: ${numeroSemestre}\n` +
      `👥 Grupo: ${grupoId}`,
  );
}

/**
 * Inicia el registro nuevo: pide el nombre completo primero,
 * antes de mostrar la selección de carrera/semestre/grupo.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function iniciarRegistroNuevo(telegramId) {
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

  await guardarRegistroPendiente(
      telegramId,
      {etapa: "nombre"},
  );

  await enviarMensaje(
      telegramId,
      "✍️ Primero, escribe tu nombre completo " +
      "(nombre y apellidos):",
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

  if (partes[0] === "lectura" && partes.length === 2) {
    const avisoId = partes[1];
    const avisoRef = db.collection("avisos").doc(avisoId);
    const destinatarioRef = avisoRef
        .collection("destinatarios").doc(telegramId);

    const resultado = await db.runTransaction(async (transaction) => {
      const destinatarioSnapshot = await transaction.get(
          destinatarioRef,
      );

      if (!destinatarioSnapshot.exists) {
        return "no-encontrado";
      }

      if (destinatarioSnapshot.data().leido === true) {
        return "ya-confirmado";
      }

      transaction.set(destinatarioRef, {
        leido: true,
        fechaLectura: new Date(),
      }, {merge: true});

      transaction.update(avisoRef, {
        leidos: FieldValue.increment(1),
      });

      return "confirmado";
    });

    if (resultado === "no-encontrado") {
      await enviarMensaje(telegramId, "No se encontró este aviso.");
    }

    return;
  }

  if (datos === "registro:iniciar") {
    await iniciarRegistroNuevo(telegramId);
    return;
  }

  if (datos === "registro:modificar") {
    await iniciarModificacion(telegramId);
    return;
  }

  if (datos === "registro:reenviar") {
    const pendiente = await obtenerRegistroPendiente(telegramId);

    if (!pendiente || pendiente.etapa !== "codigo") {
      await enviarMensaje(
          telegramId,
          "No hay ningún código pendiente por verificar. " +
          "Usa /start para comenzar tu registro.",
      );

      return;
    }

    await enviarCodigoVerificacion(telegramId, pendiente);
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
    await finalizarRegistroNuevo(
        telegramId,
        partes[2],
        partes[3],
        partes[4],
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

  if (estudiante) {
    await mostrarInfo(
        telegramId,
    );

    return;
  }

  const pendiente =
    await obtenerRegistroPendiente(
        telegramId,
    );

  if (pendiente) {
    await continuarRegistroPendiente(
        telegramId,
        pendiente,
    );

    return;
  }

  await mostrarBienvenida(
      telegramId,
      nombre,
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

  const pendiente = await obtenerRegistroPendiente(
      telegramId,
  );

  if (pendiente) {
    await procesarTextoRegistro(
        telegramId,
        texto,
        pendiente,
    );

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
