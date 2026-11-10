const crypto = require("crypto");

const {db} = require("../../config/firebase");
const {FieldValue} = require("firebase-admin/firestore");

const {enviarCorreo} = require("../correoService");

const {
  obtenerEstudiantePorTelegramId,
  obtenerEstudiantePorNumControl,
  guardarEstudiante,
  cambiarNumeroControl,
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
  editarTeclado,
  editarMensaje,
} = require("../telegramService");

const {
  ZONA_HORARIA,
  formatearDia,
  formatearHora,
} = require("../../utils/fechas");

const {
  obtenerEventosDeEstudiante,
  obtenerEventoDeEstudiante,
  construirMensajeAviso,
  tecladoConfirmarLectura,
  tecladoLecturaConfirmada,
  obtenerAvisosSinLeer,
  obtenerAvisoDeDestinatario,
} = require("../avisoService");

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
 * Número de control del ITTG: 8 dígitos (estándar TecNM: 2 de año
 * + 3 de carrera + 3 secuenciales), precedidos por una «C» cuando
 * el estudiante cambió de carrera.
 *
 * El formato no es lo que protege el registro: de eso se encarga el
 * código que llega al correo institucional. Aquí solo se descartan
 * capturas que claramente no son un número de control.
 *
 * @type {RegExp}
 */
const NUM_CONTROL_REGEX = /^C?\d{8}$/i;

/**
 * Valida un número de control escrito por el estudiante.
 *
 * La «C» se pasa a mayúscula porque el número de control es el ID
 * del documento en Firestore: sin normalizarla, escribirla en
 * minúscula abriría un segundo registro para el mismo estudiante.
 *
 * @param {string} texto Texto recibido de Telegram.
 * @return {string|null} Número de control normalizado, o null si
 *   no es válido.
 */
function validarNumControl(texto) {
  const limpio = (texto || "").trim().toUpperCase();

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
 * La cuenta sigue al número de control completo: a quien cambia de
 * carrera se le reasigna el buzón con la «C» incluida. Va en
 * minúsculas porque el número se guarda con la «C» en mayúscula y
 * las cuentas institucionales se escriben en minúsculas.
 *
 * @param {string} numControl Número de control.
 * @return {string}
 */
function correoInstitucionalDe(numControl) {
  return (
    `${PREFIJO_CORREO_INSTITUCIONAL}${numControl.toLowerCase()}` +
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
        "Código de verificación - Chatbot Avisos",
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

  await enviarMensaje(
      telegramId,
      "✅ Correo verificado.",
  );

  // El mismo código verifica dos flujos distintos: el alta de un
  // estudiante nuevo y el cambio de número de control de uno que ya
  // estaba registrado.
  if (pendiente.cambio === true) {
    await finalizarCambioNumControl(telegramId, pendiente);

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
        "✍️ Escribe tu número de control " +
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
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✏️ Modificar mis datos",
                callback_data: "registro:modificar",
              },
            ],
          ],
        },
      },
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
        "🆔 Ahora escribe tu número de control:",
    );

    return;
  }

  if (pendiente.etapa === "numControl") {
    const numControl = validarNumControl(texto);

    if (!numControl) {
      await enviarMensaje(
          telegramId,
          "Ese número de control no es válido. " +
          "Debe ser solo números, sin espacios ni letras.",
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

  if (pendiente.etapa === "cambioNumControl") {
    await procesarNuevoNumControl(telegramId, texto);

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
 * Procesa el número de control nuevo que escribió un estudiante
 * que ya estaba registrado y quiere cambiarlo.
 *
 * Nada se modifica todavía: el cambio solo se aplica cuando llegue
 * el código al correo institucional nuevo. Así, quien se equivoque
 * de número no pierde su registro actual.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} texto Texto recibido de Telegram.
 * @return {Promise<void>}
 */
async function procesarNuevoNumControl(telegramId, texto) {
  const estudiante = await obtenerEstudiantePorTelegramId(
      telegramId,
  );

  if (!estudiante) {
    await eliminarRegistroPendiente(telegramId);

    await enviarMensaje(
        telegramId,
        "No encontramos tu registro. " +
        "Utiliza /start para comenzar.",
    );

    return;
  }

  const numControl = validarNumControl(texto);

  if (!numControl) {
    await enviarMensaje(
        telegramId,
        "Ese número de control no es válido. " +
        "Debe ser solo números, sin espacios ni letras, " +
        "o una «C» al inicio si cambiaste de carrera.",
    );

    return;
  }

  if (numControl === estudiante.numControl) {
    await enviarMensaje(
        telegramId,
        "Ese ya es tu número de control actual. " +
        "Escribe el nuevo, o pulsa «Cancelar» si te " +
        "equivocaste.",
    );

    return;
  }

  const ocupado = await obtenerEstudiantePorNumControl(
      numControl,
  );

  if (ocupado) {
    await enviarMensaje(
        telegramId,
        "Ese número de control ya está registrado por otra " +
        "persona. Si crees que es un error, contacta a tu " +
        "coordinador.",
    );

    return;
  }

  await enviarCodigoVerificacion(
      telegramId,
      {
        etapa: "codigo",
        cambio: true,
        numControlAnterior: estudiante.numControl,
        numControl,
        codigoEnvios: 0,
      },
  );
}

/**
 * Aplica el cambio de número de control una vez verificado el
 * correo institucional nuevo.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {Object} pendiente Registro pendiente ya verificado.
 * @return {Promise<void>}
 */
async function finalizarCambioNumControl(telegramId, pendiente) {
  const estudiante = await obtenerEstudiantePorTelegramId(
      telegramId,
  );

  if (!estudiante) {
    await eliminarRegistroPendiente(telegramId);

    await enviarMensaje(
        telegramId,
        "No encontramos tu registro. " +
        "Utiliza /start para comenzar.",
    );

    return;
  }

  const cambiado = await cambiarNumeroControl(
      estudiante.numControl,
      pendiente.numControl,
      {
        nombre: estudiante.nombre,
        telegramId: estudiante.telegramId,
        correoInstitucional: pendiente.correoInstitucional,
        correoVerificado: true,
        carreraId: estudiante.carreraId,
        semestreId: estudiante.semestreId,
        grupoId: estudiante.grupoId,
        fechaRegistro: estudiante.fechaRegistro,
      },
  );

  await eliminarRegistroPendiente(telegramId);

  if (!cambiado) {
    await enviarMensaje(
        telegramId,
        "Alguien registró ese número de control mientras " +
        "verificabas tu correo. Tus datos quedaron sin cambios; " +
        "contacta a tu coordinador.",
    );

    return;
  }

  // Cambiar de número de control casi siempre significa que el
  // estudiante cambió de carrera, así que conviene ofrecerle
  // actualizarla en vez de que lo descubra cuando deje de recibir
  // los avisos que le tocan.
  await enviarMensaje(
      telegramId,
      "✅ Número de control actualizado.\n\n" +
      `🆔 Nuevo número: ${pendiente.numControl}\n` +
      `📧 Correo: ${pendiente.correoInstitucional}\n\n` +
      "Si también cambiaste de carrera, actualiza tus datos " +
      "académicos para seguir recibiendo los avisos correctos.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🎓 Actualizar carrera, semestre y grupo",
                callback_data: "editar:academico",
              },
            ],
          ],
        },
      },
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
 * Muestra qué puede modificar un estudiante ya registrado.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function mostrarMenuModificacion(telegramId) {
  const estudiante = await obtenerEstudiantePorTelegramId(
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
      `🆔 Número de control: ${estudiante.numControl}\n\n` +
      "¿Qué quieres cambiar?",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🎓 Carrera, semestre y grupo",
                callback_data: "editar:academico",
              },
            ],
            [
              {
                text: "🆔 Número de control",
                callback_data: "editar:numcontrol",
              },
            ],
            [
              {
                text: "↩️ Cancelar",
                callback_data: "editar:cancelar",
              },
            ],
          ],
        },
      },
  );
}

/**
 * Inicia el cambio de número de control.
 *
 * Solo pide el número nuevo y deja el cambio en espera: nada se
 * modifica hasta que llegue el código al correo institucional que
 * le corresponde a ese número. De esa forma nadie puede apropiarse
 * del número de control de otro estudiante.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function iniciarCambioNumControl(telegramId) {
  const estudiante = await obtenerEstudiantePorTelegramId(
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

  await guardarRegistroPendiente(
      telegramId,
      {etapa: "cambioNumControl"},
  );

  await enviarMensaje(
      telegramId,
      "🆔 Cambiar número de control\n\n" +
      `Actual: ${estudiante.numControl}\n\n` +
      "Escribe tu número de control nuevo. Te enviaremos un " +
      "código al correo institucional que le corresponde, y el " +
      "cambio se aplicará hasta que lo confirmes.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "↩️ Cancelar",
                callback_data: "editar:cancelar",
              },
            ],
          ],
        },
      },
  );
}

/**
 * Cancela una modificación.
 *
 * Borra también el cambio a medias que pudiera haber quedado
 * esperando un número de control o un código: si no se limpia, el
 * bot seguiría interpretando como parte del cambio cualquier cosa
 * que el estudiante escriba después.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function cancelarModificacion(telegramId) {
  await eliminarRegistroPendiente(telegramId);

  await enviarMensaje(
      telegramId,
      "↩️ Modificación cancelada.\n\n" +
      "Tus datos anteriores permanecen sin cambios.",
  );
}

/**
 * Cuántos avisos sin leer se listan como máximo en un mensaje. Un
 * botón por aviso: más de 10 vuelve el teclado difícil de recorrer
 * en el celular.
 *
 * @type {number}
 */
const MAX_PENDIENTES_LISTADOS = 10;

/**
 * Largo máximo del título dentro de un botón. Telegram corta el
 * texto de los botones a lo que cabe en pantalla, así que se recorta
 * aquí para que se lea el número y el inicio del título.
 *
 * @type {number}
 */
const MAX_TITULO_BOTON = 40;

/**
 * Los IDs de aviso son IDs automáticos de Firestore (solo letras y
 * números). Se validan antes de armar una ruta con ellos porque
 * llegan en el callback_data, que un cliente modificado puede
 * alterar: una «/» convertiría el ID en otra ruta de Firestore.
 *
 * @type {RegExp}
 */
const AVISO_ID_REGEX = /^[A-Za-z0-9]+$/;

/**
 * Fechas cortas ("10 nov") en la hora de Tuxtla. Las funciones
 * corren en UTC: sin fijar la zona, un aviso enviado de noche
 * aparecería con la fecha del día siguiente.
 *
 * @type {Intl.DateTimeFormat}
 */
const FORMATO_FECHA_CORTA = new Intl.DateTimeFormat("es-MX", {
  timeZone: ZONA_HORARIA,
  day: "numeric",
  month: "short",
});

/**
 * Recorta un texto a un largo máximo, terminando en «…».
 *
 * @param {string} texto Texto original.
 * @param {number} maximo Largo máximo.
 * @return {string}
 */
function recortarTexto(texto, maximo) {
  if (texto.length <= maximo) {
    return texto;
  }

  return `${texto.slice(0, maximo - 1).trimEnd()}…`;
}

/**
 * Responde un callback sin dejar que un fallo de Telegram detenga
 * el resto del proceso: si la respuesta no llega, el botón solo se
 * queda cargando un momento.
 *
 * @param {string} callbackQueryId ID de la consulta.
 * @param {string} [texto] Aviso emergente opcional.
 * @return {Promise<void>}
 */
async function responderCallbackSinFallar(callbackQueryId, texto) {
  try {
    await responderCallback(callbackQueryId, texto);
  } catch (error) {
    console.error(
        "No se pudo responder el callback:",
        error.message,
    );
  }
}

/**
 * Deshabilita el botón "Confirmar lectura" del mensaje que se
 * pulsó, para que el estudiante vea que su confirmación quedó
 * registrada.
 *
 * Es solo visual: si Telegram rechaza la edición, la lectura ya
 * quedó guardada y el estudiante ya vio el aviso emergente, así que
 * el error solo se registra.
 *
 * @param {Object} mensaje Mensaje del callback (puede faltar si
 *   Telegram ya no tiene acceso a él).
 * @return {Promise<void>}
 */
async function deshabilitarBotonLectura(mensaje) {
  if (!mensaje || !mensaje.chat || !mensaje.message_id) {
    return;
  }

  try {
    await editarTeclado(
        mensaje.chat.id,
        mensaje.message_id,
        tecladoLecturaConfirmada(),
    );
  } catch (error) {
    console.error(
        "No se pudo deshabilitar el botón de lectura:",
        error.message,
    );
  }
}

/**
 * Registra que el estudiante leyó un aviso, le avisa del resultado
 * con un mensaje emergente y deshabilita el botón.
 *
 * La transacción evita contar dos veces la misma lectura si el
 * estudiante pulsa el botón repetidamente (o lo pulsa en el aviso
 * original y en el reenviado desde /pendientes_lectura).
 *
 * @param {Object} callbackQuery Callback de Telegram.
 * @param {string} telegramId ID de Telegram.
 * @param {string} avisoId ID del aviso.
 * @return {Promise<void>}
 */
async function confirmarLectura(callbackQuery, telegramId, avisoId) {
  const callbackQueryId = callbackQuery.id;

  if (!AVISO_ID_REGEX.test(avisoId)) {
    await responderCallbackSinFallar(
        callbackQueryId,
        "No se encontró este aviso.",
    );

    return;
  }

  const avisoRef = db.collection("avisos").doc(avisoId);
  const destinatarioRef = avisoRef
      .collection("destinatarios").doc(telegramId);

  let resultado;

  try {
    resultado = await db.runTransaction(async (transaction) => {
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
  } catch (error) {
    await responderCallbackSinFallar(
        callbackQueryId,
        "No se pudo confirmar la lectura. Intenta de nuevo.",
    );

    throw error;
  }

  const mensajes = {
    "confirmado": "✅ Lectura confirmada.",
    "ya-confirmado": "Ya habías confirmado este aviso.",
    "no-encontrado": "No se encontró este aviso.",
  };

  await responderCallbackSinFallar(
      callbackQueryId,
      mensajes[resultado],
  );

  // "ya-confirmado" también deshabilita el botón: pasa cuando
  // confirmó en otra copia del aviso (la original o la reenviada
  // desde /pendientes_lectura) y en esta seguía activo.
  if (resultado === "confirmado" || resultado === "ya-confirmado") {
    await deshabilitarBotonLectura(callbackQuery.message);
  }
}

/**
 * Muestra al estudiante los avisos que recibió y todavía no confirma
 * como leídos, con un botón para volver a ver cada uno.
 *
 * Se listan solo los más recientes: los más antiguos van apareciendo
 * conforme se confirman los de arriba.
 *
 * @param {string} telegramId ID de Telegram.
 * @return {Promise<void>}
 */
async function mostrarPendientesLectura(telegramId) {
  const estudiante = await obtenerEstudiantePorTelegramId(
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

  const avisos = await obtenerAvisosSinLeer(telegramId);

  if (avisos.length === 0) {
    await enviarMensaje(
        telegramId,
        "✅ No tienes avisos pendientes: ya confirmaste la " +
        "lectura de todos.",
    );

    return;
  }

  const listados = avisos.slice(0, MAX_PENDIENTES_LISTADOS);
  const restantes = avisos.length - listados.length;

  const lineas = listados.map((aviso, indice) => {
    const fecha = FORMATO_FECHA_CORTA.format(
        aviso.fechaCreacion.toDate(),
    );

    return `${indice + 1}. ${aviso.titulo} (${fecha})`;
  });

  let texto =
    (avisos.length === 1 ?
      "📬 Tienes 1 aviso sin confirmar:\n\n" :
      `📬 Tienes ${avisos.length} avisos sin confirmar:\n\n`) +
    lineas.join("\n");

  if (restantes > 0) {
    texto +=
      `\n\n…y ${restantes} más antiguo(s), que aparecerán ` +
      "aquí conforme confirmes estos.";
  }

  texto += "\n\nPulsa un aviso para volver a verlo y confirmar " +
    "su lectura.";

  const botones = listados.map((aviso, indice) => [{
    text: `📖 ${indice + 1}. ${recortarTexto(
        aviso.titulo,
        MAX_TITULO_BOTON,
    )}`,
    callback_data: `ver:${aviso.id}`,
  }]);

  await enviarMensaje(
      telegramId,
      texto,
      {
        reply_markup: {
          inline_keyboard: botones,
        },
      },
  );
}

/**
 * Vuelve a enviar un aviso completo, con su botón de confirmar
 * lectura, tal como llegó la primera vez.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} avisoId ID del aviso.
 * @return {Promise<void>}
 */
async function reenviarAviso(telegramId, avisoId) {
  const aviso = AVISO_ID_REGEX.test(avisoId) ?
    await obtenerAvisoDeDestinatario(avisoId, telegramId) :
    null;

  if (!aviso) {
    await enviarMensaje(
        telegramId,
        "Este aviso ya no está disponible.",
    );

    return;
  }

  await enviarMensaje(
      telegramId,
      construirMensajeAviso(aviso),
      {
        reply_markup: aviso.leido ?
          tecladoLecturaConfirmada() :
          tecladoConfirmarLectura(aviso.id),
      },
  );
}

/**
 * Rangos que ofrece /eventos, en el orden en que aparecen sus
 * botones. La clave viaja en el callback_data (`eventos:{clave}`).
 *
 * Es un Map y no un objeto literal para que una clave alterada en el
 * callback_data (por ejemplo "constructor") no encuentre nada.
 *
 * @type {Map<string, {dias: number, boton: string, titulo: string,
 *   vacio: string}>}
 */
const RANGOS_EVENTOS = new Map([
  ["hoy", {
    dias: 1,
    boton: "Hoy",
    titulo: "📅 Eventos de hoy",
    vacio: "No hay eventos pendientes para hoy. Usa los botones " +
      "para ver los próximos días.",
  }],
  ["semana", {
    dias: 7,
    boton: "7 días",
    titulo: "📅 Eventos de los próximos 7 días",
    vacio: "No hay eventos en los próximos 7 días.",
  }],
  ["mes", {
    dias: 30,
    boton: "30 días",
    titulo: "📅 Eventos de los próximos 30 días",
    vacio: "No hay eventos en los próximos 30 días.",
  }],
]);

/**
 * Cuántos eventos se listan como máximo, por la misma razón que en
 * /pendientes_lectura: un botón por evento.
 *
 * @type {number}
 */
const MAX_EVENTOS_LISTADOS = 10;

/**
 * Arma el texto y los botones de la lista de eventos de un rango:
 * un botón por evento para verlo completo y, al final, la fila para
 * cambiar de rango con el actual marcado.
 *
 * En los rangos de varios días los eventos se agrupan por día; en
 * "hoy" no hace falta.
 *
 * @param {Object} estudiante Estudiante registrado.
 * @param {string} clave Clave del rango (ver RANGOS_EVENTOS).
 * @return {Promise<{texto: string, replyMarkup: Object}>}
 */
async function construirListaEventos(estudiante, clave) {
  const rango = RANGOS_EVENTOS.get(clave);

  const eventos = await obtenerEventosDeEstudiante(
      estudiante,
      new Date(),
      rango.dias,
  );

  const listados = eventos.slice(0, MAX_EVENTOS_LISTADOS);
  const restantes = eventos.length - listados.length;

  let texto = `${rango.titulo}\n\n`;

  if (eventos.length === 0) {
    texto += rango.vacio;
  } else {
    const lineas = [];
    let diaAnterior = null;

    listados.forEach((evento, indice) => {
      const dia = formatearDia(evento.fechaEvento);

      if (clave !== "hoy" && dia !== diaAnterior) {
        lineas.push(`${lineas.length > 0 ? "\n" : ""}🗓️ ${dia}`);
        diaAnterior = dia;
      }

      const cuando = evento.eventoTodoElDia === true ?
        "Todo el día" :
        `${formatearHora(evento.fechaEvento)} h`;

      lineas.push(`${indice + 1}. ${cuando} — ${evento.titulo}`);
    });

    texto += lineas.join("\n");

    if (restantes > 0) {
      texto += `\n\n…y ${restantes} evento(s) más adelante.`;
    }

    texto += "\n\nPulsa un evento para ver el aviso completo.";
  }

  const botones = listados.map((evento, indice) => [{
    text: `📖 ${indice + 1}. ${recortarTexto(
        evento.titulo,
        MAX_TITULO_BOTON,
    )}`,
    callback_data: `evento:${evento.id}`,
  }]);

  botones.push(Array.from(RANGOS_EVENTOS, ([claveRango, datos]) => ({
    text: claveRango === clave ? `✓ ${datos.boton}` : datos.boton,
    callback_data: `eventos:${claveRango}`,
  })));

  return {
    texto,
    replyMarkup: {inline_keyboard: botones},
  };
}

/**
 * Muestra los eventos de un rango. Con `mensaje` (cuando se pulsó un
 * botón de rango) edita esa misma lista en vez de mandar otra, para
 * no llenar el chat de listas.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} clave Clave del rango (ver RANGOS_EVENTOS).
 * @param {Object} [mensaje] Mensaje con la lista a reemplazar.
 * @return {Promise<void>}
 */
async function mostrarEventos(telegramId, clave, mensaje) {
  const estudiante = await obtenerEstudiantePorTelegramId(
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

  const {texto, replyMarkup} = await construirListaEventos(
      estudiante,
      clave,
  );

  if (mensaje && mensaje.chat && mensaje.message_id) {
    try {
      await editarMensaje(
          mensaje.chat.id,
          mensaje.message_id,
          texto,
          {reply_markup: replyMarkup},
      );

      return;
    } catch (error) {
      const descripcion = String(error.description || error.message);

      // Pulsar el rango que ya está a la vista deja el mensaje igual,
      // y Telegram responde con este error: no hay nada que hacer.
      if (/message is not modified/i.test(descripcion)) {
        return;
      }

      console.error(
          "No se pudo editar la lista de eventos; se envía una nueva:",
          descripcion,
      );
    }
  }

  await enviarMensaje(
      telegramId,
      texto,
      {reply_markup: replyMarkup},
  );
}

/**
 * Envía completo el aviso de un evento. Si al estudiante le llegó,
 * lleva el botón de lectura en su estado actual (activo o ya
 * deshabilitado); si se registró después del envío, va sin botón,
 * porque no hay lectura que confirmar.
 *
 * @param {string} telegramId ID de Telegram.
 * @param {string} avisoId ID del aviso.
 * @return {Promise<void>}
 */
async function mostrarEvento(telegramId, avisoId) {
  const estudiante = await obtenerEstudiantePorTelegramId(
      telegramId,
  );

  const evento = estudiante && AVISO_ID_REGEX.test(avisoId) ?
    await obtenerEventoDeEstudiante(avisoId, estudiante) :
    null;

  if (!evento) {
    await enviarMensaje(
        telegramId,
        "Este evento ya no está disponible.",
    );

    return;
  }

  const opciones = {};

  if (evento.destinatario) {
    opciones.reply_markup = evento.destinatario.leido ?
      tecladoLecturaConfirmada() :
      tecladoConfirmarLectura(evento.id);
  }

  await enviarMensaje(
      telegramId,
      construirMensajeAviso(evento),
      opciones,
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
  const telegramId = String(
      callbackQuery.from.id,
  );

  const datos = callbackQuery.data || "";
  const partes = datos.split(":");

  // Telegram acepta una sola respuesta por pulsación. La
  // confirmación de lectura la usa para mostrar el resultado, así
  // que se atiende antes de la respuesta genérica de los demás
  // botones.
  if (partes[0] === "lectura" && partes.length === 2) {
    await confirmarLectura(callbackQuery, telegramId, partes[1]);
    return;
  }

  await responderCallbackSinFallar(callbackQuery.id);

  if (partes[0] === "ver" && partes.length === 2) {
    await reenviarAviso(telegramId, partes[1]);
    return;
  }

  if (
    partes[0] === "eventos" &&
    partes.length === 2 &&
    RANGOS_EVENTOS.has(partes[1])
  ) {
    await mostrarEventos(telegramId, partes[1], callbackQuery.message);
    return;
  }

  if (partes[0] === "evento" && partes.length === 2) {
    await mostrarEvento(telegramId, partes[1]);
    return;
  }

  if (datos === "registro:iniciar") {
    await iniciarRegistroNuevo(telegramId);
    return;
  }

  if (datos === "registro:modificar") {
    await mostrarMenuModificacion(telegramId);
    return;
  }

  if (datos === "editar:academico") {
    await iniciarModificacion(telegramId);
    return;
  }

  if (datos === "editar:numcontrol") {
    await iniciarCambioNumControl(telegramId);
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
  await mostrarMenuModificacion(telegramId);
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

  if (texto === "/pendientes_lectura") {
    await mostrarPendientesLectura(telegramId);
    return;
  }

  if (texto === "/eventos") {
    await mostrarEventos(telegramId, "hoy");
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
      "Utiliza /info, /registro, /pendientes_lectura o " +
      "/eventos desde el menú.",
  );
}

module.exports = {
  procesarActualizacion,
};
