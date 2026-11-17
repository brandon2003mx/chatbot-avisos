/**
 * Prueba de carga y de tolerancia a fallas del envío de avisos.
 *
 * Ejecuta el código real del sistema (creación del aviso, lotes y
 * worker de envío) contra el Firestore Emulator, con dos dobles:
 *
 * - Telegram simulado: sustituye a fetch(), que es lo que usa la
 *   librería node-telegram-bot-api, de modo que también se ejercitan
 *   sus reintentos internos. Responde con latencia de red y aplica
 *   el límite de 30 mensajes por segundo de Telegram (429 al
 *   excederlo). Nunca se contacta a Telegram real.
 * - Cola simulada: reproduce la configuración de Cloud Tasks de
 *   procesarLoteAviso (index.js): 5 lotes simultáneos, 5 despachos
 *   por segundo, 5 intentos por tarea y espera mínima de 30 s que se
 *   duplica en cada reintento.
 *
 * Escenarios: capacidad, fallas, bloqueados, recuperacion (por
 * omisión, todos). Uso, desde functions/:
 *
 *   firebase emulators:exec --only firestore \
 *     "node scripts/prueba-carga.js [escenario...]"
 */

// El token debe existir para construir el cliente, pero ninguna
// petición sale a Telegram: fetch queda reemplazado antes del envío.
process.env.TELEGRAM_BOT_TOKEN = "000000:PRUEBA-DE-CARGA-SIN-TELEGRAM";

const crypto = require("crypto");
const {db} = require("../src/config/firebase");
const {crearYEnviarAviso} = require("../src/services/avisoService");
const {procesarLote} = require("../src/services/avisoWorkerService");

const PROYECTO = "chatbot-de-difusion";

// Copia de la configuración de procesarLoteAviso en index.js.
const COLA = {
  maxConcurrentes: 5,
  maxPorSegundo: 5,
  maxIntentos: 5,
  backoffMinimoMs: 30 * 1000,
};

// Límite de difusión documentado por Telegram para un bot.
const LIMITE_TELEGRAM_POR_SEGUNDO = 30;

const fetchOriginal = global.fetch;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Extrae el chat_id del cuerpo de una petición de la librería.
 *
 * @param {*} cuerpo Cuerpo tal como lo arma la librería.
 * @return {string} chat_id de la petición.
 */
function leerChatId(cuerpo) {
  if (typeof cuerpo === "string") {
    return new URLSearchParams(cuerpo).get("chat_id");
  }

  if (cuerpo && typeof cuerpo.get === "function") {
    return String(cuerpo.get("chat_id"));
  }

  throw new Error("Cuerpo de petición no reconocido por el simulador.");
}

/**
 * Crea un Telegram simulado y lo instala como fetch global.
 *
 * Las fallas se configuran por chat: "servidor" responde 502,
 * "red" rechaza la conexión y "limite" responde 429; cada una
 * durante los primeros N intentos de ese chat. "bloqueados" responde
 * siempre 403, como Telegram con un usuario que bloqueó al bot.
 *
 * @param {Object} opciones Configuración del simulador.
 * @return {Object} Registro de entregas y respuestas.
 */
function instalarTelegramSimulado(opciones) {
  const fallas = opciones.fallas || {};
  const bloqueados = opciones.bloqueados || new Set();
  const registro = {
    entregas: new Map(),
    intentos: new Map(),
    respuestas: {
      ok: 0,
      limite: 0,
      servidor: 0,
      red: 0,
      bloqueado: 0,
    },
  };
  const ventana = [];

  const responder = (estado, cuerpo) => new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {"content-type": "application/json"},
  });

  global.fetch = async (url, init) => {
    if (!String(url).startsWith("https://api.telegram.org/")) {
      return fetchOriginal(url, init);
    }

    if (!String(url).endsWith("/sendMessage")) {
      throw new Error(`Método no simulado: ${url}`);
    }

    const chatId = leerChatId(init.body);
    const intento = (registro.intentos.get(chatId) || 0) + 1;
    registro.intentos.set(chatId, intento);

    // Latencia de una llamada a la API desde la nube: 40 a 100 ms.
    await esperar(40 + Math.random() * 60);

    for (const tipo of ["red", "servidor", "limite"]) {
      const falla = fallas[tipo];

      if (falla && falla.chats.has(chatId) && intento <= falla.intentos) {
        registro.respuestas[tipo]++;

        if (tipo === "red") {
          throw new TypeError("fetch failed (falla de red simulada)");
        }

        if (tipo === "servidor") {
          return new Response("Bad Gateway", {status: 502});
        }

        return responder(429, {
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 1",
          parameters: {retry_after: 1},
        });
      }
    }

    if (bloqueados.has(chatId)) {
      registro.respuestas.bloqueado++;

      return responder(403, {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      });
    }

    const ahora = Date.now();

    while (ventana.length > 0 && ahora - ventana[0] >= 1000) {
      ventana.shift();
    }

    if (ventana.length >= LIMITE_TELEGRAM_POR_SEGUNDO) {
      registro.respuestas.limite++;

      return responder(429, {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 1",
        parameters: {retry_after: 1},
      });
    }

    ventana.push(ahora);
    registro.respuestas.ok++;
    registro.entregas.set(chatId, (registro.entregas.get(chatId) || 0) + 1);

    return responder(200, {
      ok: true,
      result: {message_id: registro.respuestas.ok, chat: {id: chatId}},
    });
  };

  return registro;
}

/**
 * Borra todos los documentos del Firestore Emulator.
 *
 * @return {Promise<void>}
 */
async function limpiarEmulador() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const url = `http://${host}/emulator/v1/projects/${PROYECTO}` +
    "/databases/(default)/documents";
  const respuesta = await fetchOriginal(url, {method: "DELETE"});

  if (!respuesta.ok) {
    throw new Error(`No se pudo limpiar el emulador: ${respuesta.status}`);
  }
}

/**
 * Registra estudiantes activos de prueba.
 *
 * @param {number} cantidad Número de estudiantes.
 * @return {Promise<Array<string>>} telegramId de cada estudiante.
 */
async function sembrarEstudiantes(cantidad) {
  const telegramIds = [];

  for (let inicio = 0; inicio < cantidad; inicio += 500) {
    const batch = db.batch();

    for (let i = inicio; i < Math.min(inicio + 500, cantidad); i++) {
      const numControl = String(30000000 + i);
      const telegramId = String(7000000000 + i);
      telegramIds.push(telegramId);

      batch.set(db.collection("estudiantes").doc(numControl), {
        numControl,
        nombre: `Estudiante de prueba ${i + 1}`,
        telegramId,
        carreraId: "isc",
        semestreId: "1",
        grupoId: "A",
        activo: true,
      });
    }

    await batch.commit();
  }

  return telegramIds;
}

/**
 * Procesa los lotes de un aviso como lo haría Cloud Tasks con la
 * configuración de COLA: despachos limitados, reintentos con espera
 * exponencial y abandono de la tarea al agotar los intentos.
 *
 * @param {string} avisoId ID del aviso.
 * @param {number} totalLotes Número de lotes del aviso.
 * @return {Promise<Object>} Reintentos y tareas abandonadas.
 */
async function ejecutarCola(avisoId, totalLotes) {
  const pendientes = [];

  for (let i = 0; i < totalLotes; i++) {
    pendientes.push({loteId: `lote-${i}`, intento: 1, disponibleEn: 0});
  }

  const despachos = [];
  const resultado = {reintentos: 0, abandonadas: [], errores: []};
  let enCurso = 0;

  while (pendientes.length > 0 || enCurso > 0) {
    const ahora = Date.now();

    while (despachos.length > 0 && ahora - despachos[0] >= 1000) {
      despachos.shift();
    }

    const indice = pendientes.findIndex(
        (tarea) => tarea.disponibleEn <= ahora,
    );

    if (
      indice === -1 ||
      enCurso >= COLA.maxConcurrentes ||
      despachos.length >= COLA.maxPorSegundo
    ) {
      await esperar(20);
      continue;
    }

    const [tarea] = pendientes.splice(indice, 1);
    despachos.push(ahora);
    enCurso++;

    procesarLote(avisoId, tarea.loteId)
        .catch((error) => {
          resultado.errores.push(`${tarea.loteId}: ${error.message}`);

          if (tarea.intento >= COLA.maxIntentos) {
            resultado.abandonadas.push(tarea.loteId);
            return;
          }

          resultado.reintentos++;
          pendientes.push({
            loteId: tarea.loteId,
            intento: tarea.intento + 1,
            disponibleEn: Date.now() +
              COLA.backoffMinimoMs * Math.pow(2, tarea.intento - 1),
          });
        })
        .finally(() => {
          enCurso--;
        });
  }

  return resultado;
}

/**
 * Cuenta los destinatarios de un aviso por estado.
 *
 * @param {string} avisoId ID del aviso.
 * @return {Promise<Object>} Conteo por estado.
 */
async function contarDestinatarios(avisoId) {
  const snapshot = await db
      .collection("avisos")
      .doc(avisoId)
      .collection("destinatarios")
      .get();
  const conteo = {};

  snapshot.forEach((doc) => {
    const estado = doc.data().estado;
    conteo[estado] = (conteo[estado] || 0) + 1;
  });

  return conteo;
}

/**
 * Hace que N llamadas consecutivas a un método de Firestore, a
 * partir de la llamada número "desde", fallen como una caída
 * transitoria del servicio.
 *
 * Con "filtro", solo cuentan las transacciones cuya función
 * contiene ese texto. Así la falla cae siempre en el reclamo del
 * destinatario (antes de enviarle nada) y no en el registro del
 * resultado, donde el sistema marca "ambiguo" a propósito para no
 * reenviar un mensaje que Telegram quizá ya entregó.
 *
 * @param {Object} falla {metodo, desde, veces, filtro}.
 * @return {Function} Restaura el método original.
 */
function inyectarFallaFirestore(falla) {
  const original = db[falla.metodo];
  let llamadas = 0;

  db[falla.metodo] = function(...args) {
    const cuenta = !falla.filtro || String(args[0]).includes(falla.filtro);

    if (cuenta) {
      llamadas++;

      if (llamadas >= falla.desde && llamadas < falla.desde + falla.veces) {
        const error = new Error("14 UNAVAILABLE: falla simulada de Firestore");
        error.code = 14;
        return Promise.reject(error);
      }
    }

    return original.apply(this, args);
  };

  return () => {
    db[falla.metodo] = original;
  };
}

/**
 * Ejecuta un escenario completo y verifica el resultado.
 *
 * @param {Object} escenario Definición del escenario.
 * @return {Promise<Object>} Mediciones y verificaciones.
 */
async function ejecutarEscenario(escenario) {
  await limpiarEmulador();
  const telegramIds = await sembrarEstudiantes(escenario.estudiantes);
  const opciones = escenario.preparar ? escenario.preparar(telegramIds) : {};
  const registro = instalarTelegramSimulado(opciones);

  const inicio = Date.now();
  const creado = await crearYEnviarAviso({
    titulo: `Prueba: ${escenario.nombre}`,
    contenido: "Aviso generado por la prueba de carga del sistema.",
    evento: null,
    tipoSegmentacion: "todos",
    carreraId: null,
    semestreId: null,
    grupoId: null,
    autorId: "prueba-carga",
  }, crypto.randomUUID());
  const creadoEn = Date.now();

  const avisoSnap = await db.collection("avisos").doc(creado.avisoId).get();
  const totalLotes = avisoSnap.data().totalLotes;

  const restauraciones = (opciones.fallasFirestore || [])
      .map(inyectarFallaFirestore);

  let cola;

  try {
    cola = await ejecutarCola(creado.avisoId, totalLotes);
  } finally {
    restauraciones.forEach((restaurar) => restaurar());
  }

  const fin = Date.now();
  const aviso = (await db.collection("avisos").doc(creado.avisoId).get())
      .data();
  const estados = await contarDestinatarios(creado.avisoId);

  let duplicados = 0;
  registro.entregas.forEach((veces) => {
    if (veces > 1) duplicados++;
  });

  const esperadosEnviados = escenario.estudiantes -
    (opciones.bloqueados ? opciones.bloqueados.size : 0);
  const verificaciones = [
    [`lotes creados = ${escenario.lotesEsperados}`,
      totalLotes === escenario.lotesEsperados],
    [`estado final = ${escenario.estadoEsperado}`,
      aviso.estadoEnvio === escenario.estadoEsperado],
    [`enviados = ${esperadosEnviados}`,
      aviso.enviados === esperadosEnviados &&
      estados.enviado === esperadosEnviados],
    [`errores registrados = ${escenario.erroresEsperados}`,
      aviso.errores === escenario.erroresEsperados],
    ["sin destinatarios ambiguos", !aviso.ambiguos && !estados.ambiguo],
    ["sin entregas duplicadas", duplicados === 0],
    [`entregados = ${esperadosEnviados}`,
      registro.entregas.size === esperadosEnviados],
    ["ninguna tarea abandonada", cola.abandonadas.length === 0],
  ];

  return {
    nombre: escenario.nombre,
    estudiantes: escenario.estudiantes,
    lotes: totalLotes,
    estadoEnvio: aviso.estadoEnvio,
    enviados: aviso.enviados,
    errores: aviso.errores,
    ambiguos: aviso.ambiguos || 0,
    estados,
    duplicados,
    respuestasTelegram: registro.respuestas,
    reintentosDeTarea: cola.reintentos,
    tareasAbandonadas: cola.abandonadas.length,
    segundosCreacion: (creadoEn - inicio) / 1000,
    segundosEnvio: (fin - creadoEn) / 1000,
    mensajesPorSegundo: Number(
        (registro.respuestas.ok / ((fin - creadoEn) / 1000)).toFixed(1),
    ),
    verificaciones,
  };
}

/**
 * Elige al azar k elementos distintos de una lista.
 *
 * @param {Array<string>} lista Lista de origen.
 * @param {number} k Cantidad de elementos.
 * @return {Set<string>} Elementos elegidos.
 */
function elegir(lista, k) {
  const copia = lista.slice();

  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }

  return new Set(copia.slice(0, k));
}

const ESCENARIOS = {
  capacidad: {
    nombre: "capacidad (RNF-15, RNF-17, PA-07.1)",
    estudiantes: 5000,
    lotesEsperados: 100,
    estadoEsperado: "completado",
    erroresEsperados: 0,
  },
  fallas: {
    nombre: "fallas temporales de Telegram (RNF-02, PA-07.2)",
    estudiantes: 500,
    lotesEsperados: 10,
    estadoEsperado: "completado",
    erroresEsperados: 0,
    // 10 % con un 502, 5 % con una falla de red y 2 % con tres 429
    // seguidos: más de los que la librería absorbe por su cuenta.
    preparar: (ids) => {
      const servidor = elegir(ids, 50);
      const restantes = ids.filter((id) => !servidor.has(id));
      const red = elegir(restantes, 25);
      const limite = elegir(restantes.filter((id) => !red.has(id)), 10);

      return {
        fallas: {
          servidor: {chats: servidor, intentos: 1},
          red: {chats: red, intentos: 1},
          limite: {chats: limite, intentos: 3},
        },
      };
    },
  },
  bloqueados: {
    nombre: "estudiantes que bloquearon el bot (PA-07.4)",
    estudiantes: 200,
    lotesEsperados: 4,
    estadoEsperado: "completado_con_errores",
    erroresEsperados: 5,
    preparar: (ids) => ({bloqueados: elegir(ids, 5)}),
  },
  recuperacion: {
    nombre: "interrupción de lotes por falla de Firestore (RNF-03)",
    estudiantes: 300,
    lotesEsperados: 6,
    estadoEsperado: "completado",
    erroresEsperados: 0,
    // Dos interrupciones: el reclamo número 20 falla tres veces
    // seguidas (un lote se corta a la mitad del envío), y las dos
    // primeras lecturas de cierre fallan (dos lotes se cortan
    // después de enviar todo, antes de registrar su cierre). La
    // cola reintenta los lotes afectados.
    preparar: () => ({
      fallasFirestore: [
        {metodo: "runTransaction", filtro: "reclamado", desde: 20, veces: 3},
        {metodo: "getAll", desde: 1, veces: 2},
      ],
    }),
  },
};

/**
 * Punto de entrada.
 *
 * @return {Promise<void>}
 */
async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Esta prueba solo corre contra el Firestore Emulator.");
  }

  const nombres = process.argv.slice(2);
  const elegidos = nombres.length > 0 ? nombres : Object.keys(ESCENARIOS);
  let fallidas = 0;

  for (const nombre of elegidos) {
    const escenario = ESCENARIOS[nombre];

    if (!escenario) {
      throw new Error(`Escenario desconocido: ${nombre}`);
    }

    console.log(`\n=== Escenario: ${escenario.nombre}`);
    const resultado = await ejecutarEscenario(escenario);

    for (const [descripcion, cumple] of resultado.verificaciones) {
      console.log(`${cumple ? "  OK   " : "  FALLA"} ${descripcion}`);
      if (!cumple) fallidas++;
    }

    delete resultado.verificaciones;
    console.log(JSON.stringify(resultado, null, 2));
  }

  global.fetch = fetchOriginal;
  console.log(fallidas === 0 ?
    "\nTodas las verificaciones se cumplieron." :
    `\n${fallidas} verificación(es) no se cumplieron.`);
  process.exitCode = fallidas === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
