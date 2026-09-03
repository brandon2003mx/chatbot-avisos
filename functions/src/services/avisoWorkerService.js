const {
  TelegramApiError,
  NetworkError,
  TimeoutError,
} = require("node-telegram-bot-api");

const {FieldValue} = require("firebase-admin/firestore");

const {db} = require("../config/firebase");

const {
  enviarMensaje,
} = require("./telegramService");

/**
 * Duración del lease de un destinatario "procesando", en
 * milisegundos.
 *
 * Representa cuánto tiempo es razonable que un intento de envío
 * siga en curso antes de tratarlo como abandonado. Deliberadamente
 * NO se deriva del timeout de la librería de Telegram (que puede
 * llegar a varios minutos por sus propios reintentos internos) ni
 * del deadline de la tarea de Cloud Tasks: representa "este
 * destinatario está siendo procesado ahora mismo", no "cuánto
 * puede tardar la llamada HTTP".
 *
 * @type {number}
 */
const DURACION_LEASE_MS = 2 * 60 * 1000; // 2 minutos

/**
 * Clasifica el resultado de un error de envío a Telegram.
 *
 * - "fallido": Telegram respondió explícitamente que no procesó
 *   el mensaje (TelegramApiError, salvo 429).
 * - "retryable": condición transitoria (429 no absorbido por la
 *   librería); debe reintentarse la tarea completa, no marcarse
 *   como resultado de este destinatario.
 * - "ambiguo": no hay certeza de si Telegram procesó el mensaje
 *   antes de perderse la respuesta (error de transporte, timeout,
 *   o cualquier error no reconocido).
 *
 * @param {Error} error Error lanzado por enviarMensaje().
 * @return {"fallido"|"retryable"|"ambiguo"}
 */
function clasificarErrorTelegram(error) {
  if (error instanceof TelegramApiError) {
    if (error.errorCode === 429) {
      return "retryable";
    }

    return "fallido";
  }

  if (error instanceof NetworkError || error instanceof TimeoutError) {
    return "ambiguo";
  }

  return "ambiguo";
}

/**
 * Referencia al documento de un destinatario.
 *
 * @param {string} avisoId ID del aviso.
 * @param {string} telegramId ID de Telegram del destinatario.
 * @return {FirebaseFirestore.DocumentReference}
 */
function destinatarioRef(avisoId, telegramId) {
  return db
      .collection("avisos")
      .doc(avisoId)
      .collection("destinatarios")
      .doc(telegramId);
}

/**
 * Intenta reclamar un destinatario para procesarlo.
 *
 * Solo puede reclamarse si está "pendiente", o si estaba
 * "procesando" pero su lease venció (en cuyo caso se marca
 * "ambiguo" en lugar de reclamarse: no hay certeza de si el
 * intento anterior llegó a enviar el mensaje antes de perderse, así
 * que no se reenvía). Es transaccional para evitar que dos
 * ejecuciones concurrentes reclamen al mismo destinatario.
 *
 * @param {string} avisoId ID del aviso.
 * @param {string} telegramId ID de Telegram del destinatario.
 * @param {string} loteId ID del lote actual.
 * @return {Promise<{reclamado: boolean}>}
 */
async function reclamarDestinatario(avisoId, telegramId, loteId) {
  const ref = destinatarioRef(avisoId, telegramId);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);

    if (!snap.exists) {
      return {reclamado: false};
    }

    const datos = snap.data();

    if (
      datos.estado === "enviado" ||
      datos.estado === "fallido" ||
      datos.estado === "ambiguo"
    ) {
      return {reclamado: false};
    }

    if (datos.estado === "procesando") {
      const inicioMs = datos.fechaUltimoIntento ?
        datos.fechaUltimoIntento.toDate().getTime() :
        0;

      const leaseVencido =
        Date.now() - inicioMs > DURACION_LEASE_MS;

      if (!leaseVencido) {
        return {reclamado: false};
      }

      transaction.update(ref, {
        estado: "ambiguo",
        error:
          "El intento anterior no terminó de registrar su " +
          "resultado antes de vencer el lease; no se puede " +
          "confirmar si Telegram procesó el mensaje, así que no " +
          "se reenvía.",
        fechaUltimoIntento: new Date(),
      });

      return {reclamado: false};
    }

    // datos.estado === "pendiente"
    transaction.update(ref, {
      estado: "procesando",
      intentos: FieldValue.increment(1),
      fechaUltimoIntento: new Date(),
      loteId,
    });

    return {reclamado: true};
  });
}

/**
 * Escribe el resultado final de un destinatario SOLO si su estado
 * sigue siendo "procesando", de forma atómica (transacción: sin
 * ventana de carrera entre leer y escribir).
 *
 * Existe exactamente un "dueño" del claim de un destinatario en un
 * momento dado (reclamarDestinatario solo transiciona
 * pendiente→procesando una vez; nunca regresa un destinatario a
 * "procesando" después). Por eso, si al momento de escribir el
 * resultado el estado ya no es "procesando" (porque su lease
 * venció y otro worker ya lo marcó "ambiguo"), significa que este
 * worker perdió su claim: la escritura se descarta en vez de
 * sobrescribir la decisión ya tomada, incluso si el resultado que
 * trae es un éxito real y tardío de Telegram. Esto es lo que
 * impide el race "ambiguo → enviado"/"ambiguo → fallido" sin
 * introducir una ventana get→update.
 *
 * @param {string} avisoId ID del aviso.
 * @param {string} telegramId ID de Telegram del destinatario.
 * @param {Object} datos Campos a escribir si el estado sigue
 *   siendo "procesando".
 * @return {Promise<boolean>} true si se escribió; false si se
 *   descartó porque el estado ya no era "procesando".
 */
async function finalizarSiSigueEnProceso(avisoId, telegramId, datos) {
  const ref = destinatarioRef(avisoId, telegramId);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);

    if (!snap.exists || snap.data().estado !== "procesando") {
      return false;
    }

    transaction.update(ref, datos);

    return true;
  });
}

/**
 * Procesa un destinatario dentro de un lote: lo reclama, intenta
 * enviarle el mensaje por Telegram, y registra el resultado.
 *
 * El resultado de Telegram (éxito o fallo confirmado) nunca se ve
 * alterado por un fallo posterior al registrar el resultado en
 * Firestore: "Telegram tuvo éxito" y "Firestore tuvo éxito" son
 * cosas distintas. Un 429 no absorbido por la librería se relanza
 * para que se reintente la tarea completa, sin marcar nada de este
 * destinatario.
 *
 * @param {string} avisoId ID del aviso.
 * @param {string} loteId ID del lote.
 * @param {string} telegramId ID de Telegram del destinatario.
 * @param {string} mensaje Texto del mensaje a enviar.
 * @return {Promise<void>}
 */
async function procesarDestinatario(
    avisoId,
    loteId,
    telegramId,
    mensaje,
) {
  const claim = await reclamarDestinatario(
      avisoId,
      telegramId,
      loteId,
  );

  if (!claim.reclamado) {
    return;
  }

  let errorEnvio = null;

  try {
    await enviarMensaje(telegramId, mensaje);
  } catch (error) {
    errorEnvio = error;
  }

  if (errorEnvio === null) {
    try {
      const escrito = await finalizarSiSigueEnProceso(
          avisoId,
          telegramId,
          {
            estado: "enviado",
            fechaEnvio: new Date(),
            fechaUltimoIntento: new Date(),
          },
      );

      if (!escrito) {
        console.error(
            `avisoId=${avisoId} loteId=${loteId} ` +
            `telegramId=${telegramId} Telegram aceptó el mensaje, ` +
            "pero el destinatario ya no estaba \"procesando\" " +
            "(probablemente su lease venció y otro worker ya lo " +
            "marcó \"ambiguo\"); se descarta este resultado tardío " +
            "sin modificar el estado ni los agregados.",
        );
      }
    } catch (errorBookkeeping) {
      console.error(
          `avisoId=${avisoId} loteId=${loteId} ` +
          `telegramId=${telegramId} Telegram aceptó el mensaje ` +
          "pero falló el registro del resultado en Firestore. " +
          "Queda \"procesando\"; un lease vencido lo marcará " +
          "\"ambiguo\", nunca se reenvía:",
          errorBookkeeping.message,
      );
    }

    return;
  }

  const clasificacion = clasificarErrorTelegram(errorEnvio);

  if (clasificacion === "retryable") {
    console.error(
        `avisoId=${avisoId} loteId=${loteId} ` +
        `telegramId=${telegramId} límite de tasa de Telegram no ` +
        "absorbido internamente; se reintentará la tarea completa:",
        errorEnvio.message,
    );

    throw errorEnvio;
  }

  console.error(
      `avisoId=${avisoId} loteId=${loteId} telegramId=${telegramId} ` +
      `resultado=${clasificacion}:`,
      errorEnvio.message,
  );

  try {
    const escrito = await finalizarSiSigueEnProceso(
        avisoId,
        telegramId,
        {
          estado: clasificacion,
          error: String(errorEnvio.message || errorEnvio).slice(0, 500),
          fechaUltimoIntento: new Date(),
        },
    );

    if (!escrito) {
      console.error(
          `avisoId=${avisoId} loteId=${loteId} ` +
          `telegramId=${telegramId} Telegram respondió ` +
          `(${clasificacion}), pero el destinatario ya no estaba ` +
          "\"procesando\" (probablemente su lease venció y otro " +
          "worker ya lo marcó \"ambiguo\"); se descarta este " +
          "resultado tardío sin modificar el estado ni los agregados.",
      );
    }
  } catch (errorBookkeeping) {
    console.error(
        `avisoId=${avisoId} loteId=${loteId} ` +
        `telegramId=${telegramId} Telegram ya determinó el ` +
        "resultado pero falló el registro en Firestore:",
        errorBookkeeping.message,
    );
  }
}

/**
 * Cierra un lote y actualiza los agregados del aviso de forma
 * atómica, solo si el lote no había sido cerrado ya por una
 * ejecución previa de la misma tarea (evita doble conteo ante
 * reintentos de Cloud Tasks).
 *
 * @param {string} avisoId ID del aviso.
 * @param {string} loteId ID del lote.
 * @param {{enviados:number, errores:number, ambiguos:number}} conteos
 *   Resultado final de todos los destinatarios del lote.
 * @return {Promise<void>}
 */
async function cerrarLoteYActualizarAviso(avisoId, loteId, conteos) {
  const loteRef = db
      .collection("avisos")
      .doc(avisoId)
      .collection("lotes")
      .doc(loteId);

  const avisoRef = db.collection("avisos").doc(avisoId);

  await db.runTransaction(async (transaction) => {
    const [loteSnap, avisoSnap] = await Promise.all([
      transaction.get(loteRef),
      transaction.get(avisoRef),
    ]);

    if (!loteSnap.exists || !avisoSnap.exists) {
      throw new Error(
          `No se encontró el lote ${loteId} o el aviso ${avisoId} ` +
          "al intentar cerrarlo.",
      );
    }

    if (loteSnap.data().estado === "completado") {
      // Ya fue cerrado por una ejecución anterior de esta misma
      // tarea (retry de Cloud Tasks): no volver a incrementar nada.
      return;
    }

    const aviso = avisoSnap.data();
    const ahora = new Date();

    const lotesTerminales = (aviso.lotesTerminales || 0) + 1;
    const errores = (aviso.errores || 0) + conteos.errores;
    const ambiguos = (aviso.ambiguos || 0) + conteos.ambiguos;

    const actualizacionAviso = {
      enviados: FieldValue.increment(conteos.enviados),
      errores: FieldValue.increment(conteos.errores),
      ambiguos: FieldValue.increment(conteos.ambiguos),
      lotesTerminales: FieldValue.increment(1),
      fechaActualizacion: ahora,
    };

    if (lotesTerminales >= aviso.totalLotes) {
      actualizacionAviso.estadoEnvio =
        errores === 0 && ambiguos === 0 ?
          "completado" :
          "completado_con_errores";
    } else if (aviso.estadoEnvio === "pendiente") {
      actualizacionAviso.estadoEnvio = "procesando";
    }

    transaction.update(loteRef, {
      estado: "completado",
      fechaActualizacion: ahora,
    });

    transaction.update(avisoRef, actualizacionAviso);
  });
}

/**
 * Procesa un lote completo de un aviso: recorre sus destinatarios
 * de forma secuencial (uno a la vez, sin paralelismo), y solo
 * cierra el lote (actualizando los agregados del aviso) si todos
 * alcanzaron un estado terminal.
 *
 * Idempotente frente a reintentos de Cloud Tasks (ejecución
 * at-least-once): los destinatarios ya terminales se saltan (no se
 * les vuelve a llamar a Telegram), y el cierre del lote solo
 * incrementa los agregados del aviso una vez.
 *
 * Un fallo estructural (aviso o lote inexistente) no es
 * recuperable reintentando la tarea, así que se marca el aviso
 * como "fallido" directamente en vez de relanzar. Cualquier otro
 * fallo (Firestore transitorio, o un lote que no terminó de
 * resolverse) se relanza para que Cloud Tasks reintente la tarea.
 *
 * @param {string} avisoId ID del aviso.
 * @param {string} loteId ID del lote.
 * @return {Promise<void>}
 */
async function procesarLote(avisoId, loteId) {
  const avisoRef = db.collection("avisos").doc(avisoId);
  const loteRef = avisoRef.collection("lotes").doc(loteId);

  const [avisoSnap, loteSnap] = await Promise.all([
    avisoRef.get(),
    loteRef.get(),
  ]);

  if (!avisoSnap.exists || !loteSnap.exists) {
    console.error(
        `avisoId=${avisoId} loteId=${loteId} no existe; se marca ` +
        "el aviso como fallido porque no es recuperable " +
        "reintentando la tarea.",
    );

    if (avisoSnap.exists) {
      try {
        await avisoRef.update({
          estadoEnvio: "fallido",
          fechaActualizacion: new Date(),
        });
      } catch (error) {
        console.error(
            `No se pudo marcar como fallido el aviso ${avisoId}:`,
            error.message,
        );
      }
    }

    return;
  }

  const aviso = avisoSnap.data();
  const lote = loteSnap.data();

  const mensaje = `📢 ${aviso.titulo}\n\n${aviso.contenido}`;

  for (const telegramId of lote.telegramIds) {
    await procesarDestinatario(avisoId, loteId, telegramId, mensaje);
  }

  const refs = lote.telegramIds.map(
      (telegramId) => destinatarioRef(avisoId, telegramId),
  );

  const snaps = refs.length > 0 ? await db.getAll(...refs) : [];

  const conteos = {enviados: 0, errores: 0, ambiguos: 0};
  let todosTerminales = true;

  for (const snap of snaps) {
    const estado = snap.exists ? snap.data().estado : undefined;

    if (estado === "enviado") {
      conteos.enviados++;
    } else if (estado === "fallido") {
      conteos.errores++;
    } else if (estado === "ambiguo") {
      conteos.ambiguos++;
    } else {
      todosTerminales = false;
    }
  }

  if (!todosTerminales) {
    throw new Error(
        `El lote ${loteId} del aviso ${avisoId} no quedó ` +
        "completamente terminal; se reintentará la tarea.",
    );
  }

  await cerrarLoteYActualizarAviso(avisoId, loteId, conteos);
}

module.exports = {
  DURACION_LEASE_MS,
  clasificarErrorTelegram,
  reclamarDestinatario,
  finalizarSiSigueEnProceso,
  procesarDestinatario,
  cerrarLoteYActualizarAviso,
  procesarLote,
};
