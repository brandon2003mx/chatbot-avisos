const crypto = require("crypto");

const {getStorage} = require("firebase-admin/storage");
const {InputFile} = require("node-telegram-bot-api");

const {db, esEntornoDesplegado} = require("../config/firebase");

/**
 * Peso máximo de la imagen de un aviso. El panel la reduce a 1280 px
 * antes de subirla, así que en la práctica pesa mucho menos; el
 * límite protege a la API de un archivo enviado por otro medio.
 *
 * @type {number}
 */
const MAX_BYTES_IMAGEN = 5 * 1024 * 1024;

/**
 * Largo máximo del texto que acompaña a una foto en Telegram
 * (parámetro `caption` de sendPhoto). Un mensaje sin foto admite
 * 4096 caracteres; con foto, solo 1024.
 *
 * @type {number}
 */
const TELEGRAM_PIE_FOTO_MAX = 1024;

const ERROR_IMAGEN_INVALIDA =
  "La imagen no es válida. Usa una imagen JPG o PNG.";
const ERROR_IMAGEN_PESADA = "La imagen no puede pesar más de 5 MB.";
const ERROR_PIE_FOTO =
  "Con imagen, el mensaje no puede pasar de 1024 caracteres, el " +
  "límite de Telegram para el texto de una foto.";
const ERROR_SIN_IMAGEN_ORIGINAL = "El aviso original ya no tiene imagen.";

/**
 * Mensajes de error de este servicio que son culpa de la solicitud
 * (la API los responde con 400).
 *
 * @type {Array<string>}
 */
const ERRORES_IMAGEN = [
  ERROR_IMAGEN_INVALIDA,
  ERROR_IMAGEN_PESADA,
  ERROR_PIE_FOTO,
  ERROR_SIN_IMAGEN_ORIGINAL,
];

/**
 * Formatos aceptados, reconocidos por sus primeros bytes y no por la
 * extensión o el tipo que declare el cliente.
 *
 * @type {Array<{tipo: string, extension: string, firma: Array<number>}>}
 */
const FORMATOS_IMAGEN = [
  {tipo: "image/jpeg", extension: "jpg", firma: [0xFF, 0xD8, 0xFF]},
  {
    tipo: "image/png",
    extension: "png",
    firma: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  },
];

const PREFIJO_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,/i;
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;
const AVISO_ID_REGEX = /^[A-Za-z0-9]+$/;

/**
 * Convierte la imagen que manda el panel (base64, con o sin el
 * prefijo `data:image/...;base64,`) en bytes, y verifica su formato
 * y su peso.
 *
 * @param {*} valor Imagen en base64.
 * @return {{bytes: Buffer, tipo: string, extension: string,
 *   tamano: number, hash: string}}
 */
function decodificarImagen(valor) {
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new Error(ERROR_IMAGEN_INVALIDA);
  }

  const base64 = valor.trim()
      .replace(PREFIJO_DATA_URL, "")
      .replace(/\s/g, "");

  // Se revisa antes de decodificar: el base64 ocupa 4/3 del archivo.
  if (Math.floor(base64.length * 3 / 4) > MAX_BYTES_IMAGEN + 2) {
    throw new Error(ERROR_IMAGEN_PESADA);
  }

  if (base64.length % 4 !== 0 || !BASE64_REGEX.test(base64)) {
    throw new Error(ERROR_IMAGEN_INVALIDA);
  }

  const bytes = Buffer.from(base64, "base64");

  if (bytes.length > MAX_BYTES_IMAGEN) {
    throw new Error(ERROR_IMAGEN_PESADA);
  }

  const formato = FORMATOS_IMAGEN.find(
      (candidato) => candidato.firma.every(
          (byte, indice) => bytes[indice] === byte,
      ),
  );

  if (!formato) {
    throw new Error(ERROR_IMAGEN_INVALIDA);
  }

  return {
    bytes,
    tipo: formato.tipo,
    extension: formato.extension,
    tamano: bytes.length,
    hash: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Ruta de la imagen de un aviso dentro del bucket.
 *
 * @param {string} avisoId ID del aviso.
 * @param {string} extension "jpg" o "png".
 * @return {string}
 */
function rutaImagen(avisoId, extension) {
  return `avisos/${avisoId}/imagen.${extension}`;
}

/**
 * Extensión que corresponde al tipo guardado de una imagen.
 *
 * @param {string} tipo Tipo MIME.
 * @return {string}
 */
function extensionDeTipo(tipo) {
  const formato = FORMATOS_IMAGEN.find((candidato) => candidato.tipo === tipo);

  return formato ? formato.extension : "jpg";
}

/**
 * Bucket de Cloud Storage del proyecto.
 *
 * Igual que con Firestore (config/firebase.js), una ejecución local
 * solo puede usar el emulador: si no está configurado, se detiene
 * antes de tocar el bucket de producción.
 *
 * @return {Object} Bucket de @google-cloud/storage.
 */
function obtenerBucket() {
  if (
    !esEntornoDesplegado() &&
    !process.env.FIREBASE_STORAGE_EMULATOR_HOST
  ) {
    throw new Error(
        "ERROR: Storage Emulator no está configurado. Inicia los " +
        "emuladores con Storage (`firebase emulators:start`) antes " +
        "de usar imágenes localmente.",
    );
  }

  return getStorage().bucket();
}

/**
 * Guarda la imagen de un aviso.
 *
 * @param {string} ruta Ruta en el bucket.
 * @param {{bytes: Buffer, tipo: string}} imagen Imagen decodificada.
 * @return {Promise<void>}
 */
async function guardarImagen(ruta, imagen) {
  await obtenerBucket().file(ruta).save(imagen.bytes, {
    resumable: false,
    contentType: imagen.tipo,
    metadata: {cacheControl: "private, max-age=0"},
  });
}

/**
 * Copia la imagen de un aviso a otra ruta. Se usa al corregir un
 * aviso conservando su imagen: cada aviso tiene su propia copia, así
 * que eliminar uno nunca deja sin imagen al otro.
 *
 * @param {string} origen Ruta de la imagen original.
 * @param {string} destino Ruta de la copia.
 * @return {Promise<void>}
 */
async function copiarImagen(origen, destino) {
  const bucket = obtenerBucket();

  await bucket.file(origen).copy(bucket.file(destino));
}

/**
 * Lee los bytes de una imagen guardada.
 *
 * @param {string} ruta Ruta en el bucket.
 * @return {Promise<Buffer>}
 */
async function leerImagen(ruta) {
  const [bytes] = await obtenerBucket().file(ruta).download();

  return bytes;
}

/**
 * Elimina una imagen guardada. No falla si ya no existía.
 *
 * @param {string} ruta Ruta en el bucket.
 * @return {Promise<void>}
 */
async function eliminarImagen(ruta) {
  await obtenerBucket().file(ruta).delete({ignoreNotFound: true});
}

/**
 * Obtiene la imagen de un aviso existente, para que su corrección
 * la conserve.
 *
 * @param {string} avisoId ID del aviso original.
 * @return {Promise<Object>} Campo `imagen` del aviso.
 */
async function obtenerImagenDeAviso(avisoId) {
  if (typeof avisoId !== "string" || !AVISO_ID_REGEX.test(avisoId)) {
    throw new Error(ERROR_SIN_IMAGEN_ORIGINAL);
  }

  const snap = await db.collection("avisos").doc(avisoId).get();
  const imagen = snap.exists ? snap.data().imagen : null;

  if (!imagen || !imagen.ruta) {
    throw new Error(ERROR_SIN_IMAGEN_ORIGINAL);
  }

  return imagen;
}

/**
 * file_id de la versión más grande de la foto que Telegram devolvió
 * al enviarla.
 *
 * @param {Object} mensaje Mensaje enviado (resultado de sendPhoto).
 * @return {?string}
 */
function fileIdDeFoto(mensaje) {
  if (!mensaje || !Array.isArray(mensaje.photo) || !mensaje.photo.length) {
    return null;
  }

  return mensaje.photo[mensaje.photo.length - 1].file_id || null;
}

/**
 * Imagen de un aviso lista para enviarse por Telegram.
 *
 * La primera vez se sube el archivo; Telegram responde con un
 * `file_id` que se guarda en el aviso, y los envíos siguientes solo
 * mandan ese identificador. Así la imagen no viaja una vez por cada
 * estudiante.
 */
class FotoAviso {
  /**
   * @param {string} avisoId ID del aviso.
   * @param {Object} imagen Campo `imagen` del aviso.
   */
  constructor(avisoId, imagen) {
    this.avisoId = avisoId;
    this.imagen = imagen;
    this.fileId = imagen.fileId || null;
    this.bytes = null;
  }

  /**
   * Descarga el archivo si Telegram todavía no lo tiene. Debe
   * llamarse antes de enviar: si falla, todavía no se reclamó a
   * ningún destinatario y la tarea puede reintentarse completa.
   *
   * @return {Promise<void>}
   */
  async preparar() {
    if (!this.fileId && !this.bytes) {
      this.bytes = await leerImagen(this.imagen.ruta);
    }
  }

  /**
   * Valor del parámetro `photo` de sendPhoto: el file_id si ya
   * existe, o el archivo para subirlo.
   *
   * @return {string|InputFile}
   */
  paraTelegram() {
    if (this.fileId) {
      return this.fileId;
    }

    if (!this.bytes) {
      throw new Error("La imagen del aviso no se preparó antes de enviarse.");
    }

    return new InputFile(this.bytes, {
      filename: `aviso.${extensionDeTipo(this.imagen.tipo)}`,
      contentType: this.imagen.tipo,
    });
  }

  /**
   * Guarda el file_id que devolvió Telegram tras subir la imagen.
   * Nunca lanza: si no se puede guardar, el siguiente lote vuelve a
   * subir el archivo, que es más lento pero igual de correcto.
   *
   * @param {Object} mensaje Resultado de sendPhoto.
   * @return {Promise<void>}
   */
  async recordar(mensaje) {
    const fileId = fileIdDeFoto(mensaje);

    if (this.fileId || !fileId) {
      return;
    }

    this.fileId = fileId;
    this.bytes = null;

    try {
      await db.collection("avisos").doc(this.avisoId).update({
        "imagen.fileId": fileId,
      });
    } catch (error) {
      console.error(
          `No se pudo guardar el file_id de la imagen del aviso ` +
          `${this.avisoId}:`,
          error.message,
      );
    }
  }
}

module.exports = {
  MAX_BYTES_IMAGEN,
  TELEGRAM_PIE_FOTO_MAX,
  ERROR_PIE_FOTO,
  ERRORES_IMAGEN,
  decodificarImagen,
  rutaImagen,
  guardarImagen,
  copiarImagen,
  leerImagen,
  eliminarImagen,
  obtenerImagenDeAviso,
  FotoAviso,
};
