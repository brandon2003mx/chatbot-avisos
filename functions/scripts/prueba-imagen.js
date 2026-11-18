/**
 * Prueba de los avisos con imagen.
 *
 * Ejecuta el código real del sistema (creación del aviso, Cloud
 * Storage, worker de envío y reenvío desde el bot) contra los
 * emuladores de Firestore y Storage, con un Telegram simulado que
 * sustituye a fetch(): registra cada llamada, distingue las fotos que
 * se suben de las que se mandan por file_id, y nunca contacta a
 * Telegram real. Uso, desde functions/:
 *
 *   firebase emulators:exec --only firestore,storage \
 *     "node scripts/prueba-imagen.js"
 */

// El token debe existir para construir el cliente, pero ninguna
// petición sale a Telegram: fetch queda reemplazado.
process.env.TELEGRAM_BOT_TOKEN = "000000:PRUEBA-IMAGEN-SIN-TELEGRAM";

const crypto = require("crypto");
const {getStorage} = require("firebase-admin/storage");
const {db} = require("../src/config/firebase");
const {
  crearYEnviarAviso,
  construirMensajeAviso,
  eliminarAviso,
} = require("../src/services/avisoService");
const {procesarLote} = require("../src/services/avisoWorkerService");
const {
  procesarActualizacion,
} = require("../src/services/registro/telegramRegistroService");

const PROYECTO = "chatbot-de-difusion";
const fetchOriginal = global.fetch;

const telegram = {llamadas: [], subidas: 0};
const resultados = [];

/**
 * Registra una verificación.
 *
 * @param {string} descripcion Qué se verifica.
 * @param {boolean} cumple Si se cumplió.
 */
function verificar(descripcion, cumple) {
  resultados.push([descripcion, Boolean(cumple)]);
  console.log(`${cumple ? "  OK   " : "  FALLA"} ${descripcion}`);
}

/**
 * Lee un encabezado de una petición, venga como objeto o como Headers.
 *
 * @param {*} encabezados Encabezados de la petición.
 * @param {string} nombre Nombre en minúsculas.
 * @return {string}
 */
function leerEncabezado(encabezados, nombre) {
  if (!encabezados) return "";

  if (typeof encabezados.get === "function") {
    return encabezados.get(nombre) || "";
  }

  const clave = Object.keys(encabezados)
      .find((candidata) => candidata.toLowerCase() === nombre);

  return clave ? encabezados[clave] : "";
}

/**
 * Separa un cuerpo multipart/form-data en campos de texto y archivo.
 *
 * @param {Buffer} bytes Cuerpo completo.
 * @param {string} tipo Encabezado content-type.
 * @return {{campos: Object, archivo: ?Object}}
 */
function leerMultipart(bytes, tipo) {
  const frontera = /boundary=([^;]+)/.exec(tipo)[1];
  const partes = bytes.toString("latin1").split(`--${frontera}`);
  const campos = {};
  let archivo = null;

  for (const parte of partes) {
    const finCabecera = parte.indexOf("\r\n\r\n");
    if (finCabecera === -1) continue;

    const cabecera = parte.slice(0, finCabecera);
    const nombre = /name="([^"]+)"/.exec(cabecera);
    if (!nombre) continue;

    let valor = parte.slice(finCabecera + 4);
    if (valor.endsWith("\r\n")) valor = valor.slice(0, -2);

    if (/filename="/.test(cabecera)) {
      archivo = {
        campo: nombre[1],
        bytes: Buffer.from(valor, "latin1"),
        tipo: (/Content-Type: (.+)/i.exec(cabecera) || [])[1],
      };
    } else {
      campos[nombre[1]] = Buffer.from(valor, "latin1").toString("utf8");
    }
  }

  return {campos, archivo};
}

/**
 * Lee los campos de una petición de la librería de Telegram.
 *
 * @param {Object} init Opciones de fetch.
 * @return {Promise<{campos: Object, archivo: ?Object}>}
 */
async function leerPeticion(init) {
  const cuerpo = init.body;

  if (cuerpo instanceof URLSearchParams || typeof cuerpo === "string") {
    return {
      campos: Object.fromEntries(new URLSearchParams(cuerpo)),
      archivo: null,
    };
  }

  const bytes = Buffer.from(await new Response(cuerpo).arrayBuffer());

  return leerMultipart(bytes, leerEncabezado(init.headers, "content-type"));
}

/**
 * Instala el Telegram simulado como fetch global.
 */
function instalarTelegramSimulado() {
  const responder = (resultado) => new Response(
      JSON.stringify({ok: true, result: resultado}),
      {status: 200, headers: {"content-type": "application/json"}},
  );

  global.fetch = async (url, init) => {
    if (!String(url).startsWith("https://api.telegram.org/")) {
      return fetchOriginal(url, init);
    }

    const metodo = String(url).split("/").pop();
    const {campos, archivo} = await leerPeticion(init);
    const llamada = {metodo, chatId: campos.chat_id, campos, archivo};
    telegram.llamadas.push(llamada);

    if (metodo === "sendPhoto") {
      let fileId = campos.photo;

      if (archivo) {
        telegram.subidas++;
        fileId = `subida-${telegram.subidas}`;
      }

      return responder({
        message_id: telegram.llamadas.length,
        chat: {id: Number(campos.chat_id)},
        caption: campos.caption,
        photo: [
          {file_id: `${fileId}-miniatura`, width: 90, height: 60},
          {file_id: fileId, width: 1280, height: 853},
        ],
      });
    }

    if (metodo === "sendMessage") {
      return responder({
        message_id: telegram.llamadas.length,
        chat: {id: Number(campos.chat_id)},
        text: campos.text,
      });
    }

    if (["answerCallbackQuery", "editMessageReplyMarkup"].includes(metodo)) {
      return responder(true);
    }

    throw new Error(`Método no simulado: ${metodo}`);
  };
}

/**
 * Llamadas registradas desde un punto, filtradas por método.
 *
 * @param {number} desde Índice inicial en telegram.llamadas.
 * @param {string} metodo Método de la Bot API.
 * @return {Array<Object>}
 */
function llamadasDesde(desde, metodo) {
  return telegram.llamadas.slice(desde).filter((l) => l.metodo === metodo);
}

/**
 * Bytes de prueba con la firma de un JPEG (o de un PNG).
 *
 * @param {number} tamano Bytes de relleno.
 * @param {string} [formato] "jpeg" o "png".
 * @return {Buffer}
 */
function imagenDePrueba(tamano, formato = "jpeg") {
  const firma = formato === "png" ?
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) :
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);

  return Buffer.concat([firma, crypto.randomBytes(tamano)]);
}

/**
 * Borra todo de los emuladores de Firestore y Storage.
 *
 * @return {Promise<void>}
 */
async function limpiarEmuladores() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const url = `http://${host}/emulator/v1/projects/${PROYECTO}` +
    "/databases/(default)/documents";
  const respuesta = await fetchOriginal(url, {method: "DELETE"});

  if (!respuesta.ok) {
    throw new Error(`No se pudo limpiar Firestore: ${respuesta.status}`);
  }

  await getStorage().bucket().deleteFiles({prefix: "avisos/"});
}

/**
 * Registra estudiantes activos de prueba.
 *
 * @param {number} cantidad Número de estudiantes.
 * @return {Promise<Array<string>>} telegramId de cada uno.
 */
async function sembrarEstudiantes(cantidad) {
  const telegramIds = [];
  const batch = db.batch();

  for (let i = 0; i < cantidad; i++) {
    const telegramId = String(8000000000 + i);
    telegramIds.push(telegramId);

    batch.set(db.collection("estudiantes").doc(String(40000000 + i)), {
      numControl: String(40000000 + i),
      nombre: `Estudiante ${i + 1}`,
      telegramId,
      carreraId: "isc",
      semestreId: "1",
      grupoId: "A",
      activo: true,
    });
  }

  await batch.commit();

  return telegramIds;
}

/**
 * Crea un aviso dirigido a todos los estudiantes.
 *
 * @param {Object} extra Campos adicionales (imagen, contenido, ...).
 * @param {string} [clave] Idempotency-Key.
 * @return {Promise<Object>}
 */
function crearAviso(extra, clave = crypto.randomUUID()) {
  return crearYEnviarAviso({
    titulo: "Aviso con imagen",
    contenido: "Cartel de la semana académica.",
    evento: null,
    tipoSegmentacion: "todos",
    carreraId: null,
    semestreId: null,
    grupoId: null,
    autorId: "prueba-imagen",
    ...extra,
  }, clave);
}

/**
 * Procesa todos los lotes de un aviso, uno tras otro o a la vez.
 *
 * @param {string} avisoId ID del aviso.
 * @param {boolean} [simultaneos] Procesar los lotes en paralelo.
 * @return {Promise<Object>} Aviso al terminar.
 */
async function procesarAviso(avisoId, simultaneos = false) {
  const aviso = (await db.collection("avisos").doc(avisoId).get()).data();
  const lotes = [];

  for (let i = 0; i < aviso.totalLotes; i++) lotes.push(`lote-${i}`);

  if (simultaneos) {
    await Promise.all(lotes.map((loteId) => procesarLote(avisoId, loteId)));
  } else {
    for (const loteId of lotes) await procesarLote(avisoId, loteId);
  }

  return (await db.collection("avisos").doc(avisoId).get()).data();
}

/**
 * Ejecuta la función y devuelve el mensaje del error que lanzó.
 *
 * @param {Function} funcion Función asíncrona.
 * @return {Promise<?string>}
 */
async function errorDe(funcion) {
  try {
    await funcion();
    return null;
  } catch (error) {
    return error.message;
  }
}

/**
 * Indica si existe un archivo en el bucket.
 *
 * @param {string} ruta Ruta del archivo.
 * @return {Promise<boolean>}
 */
async function existeArchivo(ruta) {
  const [existe] = await getStorage().bucket().file(ruta).exists();
  return existe;
}

/**
 * Punto de entrada.
 *
 * @return {Promise<void>}
 */
async function main() {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_STORAGE_EMULATOR_HOST
  ) {
    throw new Error("Esta prueba solo corre con los emuladores.");
  }

  await limpiarEmuladores();
  instalarTelegramSimulado();
  const ids = await sembrarEstudiantes(120);
  const bucket = getStorage().bucket();
  const imagen = imagenDePrueba(40000);

  console.log("\n=== Envío de un aviso con imagen a 120 estudiantes");
  let desde = telegram.llamadas.length;
  const creado = await crearAviso({imagen: imagen.toString("base64")});
  let aviso = (await db.collection("avisos").doc(creado.avisoId).get()).data();
  const [guardada] = await bucket.file(aviso.imagen.ruta).download();

  verificar("la imagen se guardó en Storage antes de enviar",
      guardada.equals(imagen));
  verificar("ruta avisos/{id}/imagen.jpg",
      aviso.imagen.ruta === `avisos/${creado.avisoId}/imagen.jpg`);
  verificar("tipo image/jpeg y tamaño correcto",
      aviso.imagen.tipo === "image/jpeg" &&
      aviso.imagen.tamano === imagen.length);

  aviso = await procesarAviso(creado.avisoId);
  const fotos = llamadasDesde(desde, "sendPhoto");
  const subidas = fotos.filter((l) => l.archivo);
  const texto = construirMensajeAviso(aviso);

  verificar("120 fotos enviadas y ningún mensaje de solo texto",
      fotos.length === 120 && llamadasDesde(desde, "sendMessage").length === 0);
  verificar("el archivo se subió una sola vez",
      subidas.length === 1 && subidas[0].archivo.bytes.equals(imagen));
  verificar("la subida va como image/jpeg",
      subidas[0].archivo.tipo === "image/jpeg");
  verificar("los otros 119 envíos usan el file_id",
      fotos.slice(1).every((l) => !l.archivo && l.campos.photo === "subida-1"));
  verificar("el texto del aviso va al pie de cada foto",
      fotos.every((l) => l.campos.caption === texto));
  verificar("cada foto lleva el botón «Confirmar lectura»",
      fotos.every((l) => l.campos.reply_markup.includes(
          `lectura:${creado.avisoId}`)));
  verificar("cada estudiante recibió el aviso una vez",
      new Set(fotos.map((l) => l.chatId)).size === 120);
  verificar("se guardó el file_id de la foto más grande",
      aviso.imagen.fileId === "subida-1");
  verificar("estado completado con 120 enviados",
      aviso.estadoEnvio === "completado" && aviso.enviados === 120);

  console.log("\n=== Lotes simultáneos (como en Cloud Tasks)");
  desde = telegram.llamadas.length;
  const subidasAntes = telegram.subidas;
  const simultaneo = await crearAviso({
    imagen: imagenDePrueba(30000).toString("base64"),
  });
  const avisoSimultaneo = await procesarAviso(simultaneo.avisoId, true);
  const fotosSimultaneas = llamadasDesde(desde, "sendPhoto");

  verificar("120 fotos y cada estudiante una vez",
      fotosSimultaneas.length === 120 &&
      new Set(fotosSimultaneas.map((l) => l.chatId)).size === 120);
  verificar("a lo más una subida por lote (3 lotes)",
      telegram.subidas - subidasAntes >= 1 &&
      telegram.subidas - subidasAntes <= 3);
  verificar("estado completado",
      avisoSimultaneo.estadoEnvio === "completado");

  console.log("\n=== Validaciones");
  const largoBase = construirMensajeAviso({
    titulo: "Aviso con imagen",
    contenido: "",
  }).length;
  const contenidoJusto = "x".repeat(1024 - largoBase);

  verificar("con imagen se acepta un texto de 1024 caracteres",
      await errorDe(() => crearAviso({
        imagen: imagen.toString("base64"),
        contenido: contenidoJusto,
      })) === null);
  verificar("con imagen se rechaza un texto de 1025 caracteres",
      (await errorDe(() => crearAviso({
        imagen: imagen.toString("base64"),
        contenido: `${contenidoJusto}x`,
      })) || "").startsWith("Con imagen, el mensaje no puede pasar de 1024"));
  verificar("sin imagen el mismo texto sí se acepta",
      await errorDe(() => crearAviso({contenido: `${contenidoJusto}x`})) ===
      null);
  verificar("se rechazan bytes que no son JPG ni PNG",
      await errorDe(() => crearAviso({
        imagen: crypto.randomBytes(500).toString("base64"),
      })) === "La imagen no es válida. Usa una imagen JPG o PNG.");
  verificar("se rechaza un texto que no es base64",
      await errorDe(() => crearAviso({imagen: "no es una imagen"})) ===
      "La imagen no es válida. Usa una imagen JPG o PNG.");
  verificar("se rechaza una imagen de más de 5 MB",
      await errorDe(() => crearAviso({
        imagen: imagenDePrueba(5 * 1024 * 1024).toString("base64"),
      })) === "La imagen no puede pesar más de 5 MB.");

  const png = await crearAviso({
    imagen: `data:image/png;base64,${imagenDePrueba(800, "png")
        .toString("base64")}`,
  });
  const avisoPng = (await db.collection("avisos").doc(png.avisoId).get())
      .data();
  verificar("se acepta PNG (con prefijo data:) y se guarda como .png",
      avisoPng.imagen.tipo === "image/png" &&
      await existeArchivo(`avisos/${png.avisoId}/imagen.png`));

  console.log("\n=== Idempotencia");
  const clave = crypto.randomUUID();
  const primero = await crearAviso({imagen: imagen.toString("base64")}, clave);
  const reintento = await crearAviso({imagen: imagen.toString("base64")},
      clave);
  const conflicto = await errorDe(() => crearAviso({
    imagen: imagenDePrueba(1000).toString("base64"),
  }, clave));

  verificar("reintentar con la misma imagen devuelve el mismo aviso",
      reintento.nuevo === false && reintento.avisoId === primero.avisoId);
  verificar("la misma clave con otra imagen es un conflicto",
      conflicto === "La Idempotency-Key ya fue utilizada para otra solicitud.");

  console.log("\n=== Corrección que conserva la imagen");
  desde = telegram.llamadas.length;
  const subidasAntesCorreccion = telegram.subidas;
  const corregido = await crearAviso({
    titulo: "Aviso con imagen (corregido)",
    imagenDeAvisoId: creado.avisoId,
  });
  let avisoCorregido = (await db.collection("avisos")
      .doc(corregido.avisoId).get()).data();
  const [copia] = await bucket.file(avisoCorregido.imagen.ruta).download();

  verificar("la imagen se copió a la ruta del aviso nuevo",
      avisoCorregido.imagen.ruta !== aviso.imagen.ruta && copia.equals(imagen));
  verificar("el aviso nuevo conserva el file_id del original",
      avisoCorregido.imagen.fileId === "subida-1");

  avisoCorregido = await procesarAviso(corregido.avisoId);
  verificar("el reenvío no vuelve a subir la imagen",
      telegram.subidas === subidasAntesCorreccion &&
      llamadasDesde(desde, "sendPhoto").length === 120);
  verificar("conservar la imagen de un aviso sin imagen es un error",
      await errorDe(() => crearAviso({
        imagenDeAvisoId: png.avisoId.replace(/./, "Z"),
      })) === "El aviso original ya no tiene imagen.");

  console.log("\n=== Reenvío y confirmación desde el bot");
  desde = telegram.llamadas.length;
  const callback = (data) => procesarActualizacion({
    update_id: Date.now(),
    callback_query: {
      id: `cb-${Date.now()}`,
      from: {id: Number(ids[0]), first_name: "Prueba"},
      data,
      message: {message_id: 1, chat: {id: Number(ids[0])}},
    },
  });

  await callback(`ver:${creado.avisoId}`);
  const reenvio = llamadasDesde(desde, "sendPhoto");
  verificar("«ver aviso» lo reenvía como foto con file_id y su texto",
      reenvio.length === 1 && reenvio[0].campos.photo === "subida-1" &&
      reenvio[0].campos.caption === texto);

  desde = telegram.llamadas.length;
  await callback(`lectura:${creado.avisoId}`);
  const lectura = (await db.collection("avisos").doc(creado.avisoId)
      .collection("destinatarios").doc(ids[0]).get()).data();
  verificar("confirmar la lectura de un aviso con foto la registra",
      lectura.leido === true &&
      llamadasDesde(desde, "editMessageReplyMarkup").length === 1);

  // Si la imagen ya no existe y Telegram no tiene file_id, el bot
  // manda al menos el texto.
  await db.collection("avisos").doc(corregido.avisoId)
      .update({"imagen.fileId": null});
  await bucket.file(avisoCorregido.imagen.ruta).delete();
  desde = telegram.llamadas.length;
  await callback(`ver:${corregido.avisoId}`);
  verificar("sin imagen disponible, el bot reenvía solo el texto",
      llamadasDesde(desde, "sendPhoto").length === 0 &&
      llamadasDesde(desde, "sendMessage").length === 1);

  console.log("\n=== Falla de Storage en el worker");
  const pendiente = await crearAviso({
    imagen: imagenDePrueba(2000).toString("base64"),
  });
  const avisoPendiente = (await db.collection("avisos")
      .doc(pendiente.avisoId).get()).data();
  const [bytesPendiente] = await bucket.file(avisoPendiente.imagen.ruta)
      .download();
  await bucket.file(avisoPendiente.imagen.ruta).delete();
  desde = telegram.llamadas.length;
  const errorLote = await errorDe(
      () => procesarLote(pendiente.avisoId, "lote-0"));
  const estados = (await db.collection("avisos").doc(pendiente.avisoId)
      .collection("destinatarios").get()).docs.map((d) => d.data().estado);

  verificar("si Storage falla, el lote se reintenta sin enviar a nadie",
      errorLote !== null && telegram.llamadas.length === desde &&
      estados.every((estado) => estado === "pendiente"));

  await bucket.file(avisoPendiente.imagen.ruta).save(bytesPendiente);
  const recuperado = await procesarAviso(pendiente.avisoId);
  verificar("al reintentar con la imagen disponible, se completa",
      recuperado.estadoEnvio === "completado" && recuperado.enviados === 120);

  console.log("\n=== Eliminación");
  await eliminarAviso(creado.avisoId);
  verificar("eliminar el aviso borra su imagen de Storage",
      !(await existeArchivo(aviso.imagen.ruta)) &&
      !(await db.collection("avisos").doc(creado.avisoId).get()).exists);

  console.log("\n=== Aviso sin imagen");
  desde = telegram.llamadas.length;
  const sinImagen = await crearAviso({titulo: "Aviso sin imagen"});
  const avisoSinImagen = await procesarAviso(sinImagen.avisoId);
  verificar("se envía como texto, igual que antes",
      avisoSinImagen.imagen === null &&
      llamadasDesde(desde, "sendMessage").length === 120 &&
      llamadasDesde(desde, "sendPhoto").length === 0);

  global.fetch = fetchOriginal;
  const fallidas = resultados.filter(([, cumple]) => !cumple).length;
  console.log(fallidas === 0 ?
    `\nTodas las verificaciones se cumplieron (${resultados.length}).` :
    `\n${fallidas} de ${resultados.length} verificaciones fallaron.`);
  process.exitCode = fallidas === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
