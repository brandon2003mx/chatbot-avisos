const {Api} = require("node-telegram-bot-api");

/**
 * Obtiene la API de Telegram.
 *
 * El token se obtiene en tiempo de ejecución, después de que
 * Firebase haya inyectado el secreto TELEGRAM_BOT_TOKEN.
 *
 * @return {Api}
 */
function obtenerTelegramApi() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("Falta TELEGRAM_BOT_TOKEN en las variables de entorno.");
  }

  return new Api(token);
}

/**
 * Envía un mensaje de texto.
 *
 * @param {string|number} chatId Identificador del chat.
 * @param {string} mensaje Mensaje que se enviará.
 * @param {Object} opciones Opciones adicionales de Telegram.
 * @return {Promise<Object>}
 */
async function enviarMensaje(chatId, mensaje, opciones = {}) {
  const telegramApi = obtenerTelegramApi();

  return telegramApi.sendMessage({
    chat_id: chatId,
    text: mensaje,
    ...opciones,
  });
}

/**
 * Responde a una pulsación de botón inline.
 *
 * @param {string} callbackQueryId ID de la consulta.
 * @param {string} [texto] Aviso emergente breve que Telegram muestra
 *   sobre el chat. Sin texto, solo se quita el indicador de carga
 *   del botón.
 * @return {Promise<Object>}
 */
async function responderCallback(callbackQueryId, texto) {
  const telegramApi = obtenerTelegramApi();

  const parametros = {
    callback_query_id: callbackQueryId,
  };

  if (texto) {
    parametros.text = texto;
  }

  return telegramApi.answerCallbackQuery(parametros);
}

/**
 * Reemplaza los botones de un mensaje ya enviado, sin tocar su
 * texto.
 *
 * @param {string|number} chatId Identificador del chat.
 * @param {number} messageId ID del mensaje a editar.
 * @param {Object} replyMarkup Nuevo teclado inline.
 * @return {Promise<Object|boolean>}
 */
async function editarTeclado(chatId, messageId, replyMarkup) {
  const telegramApi = obtenerTelegramApi();

  return telegramApi.editMessageReplyMarkup({
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

/**
 * Reemplaza el texto (y opcionalmente los botones) de un mensaje ya
 * enviado.
 *
 * @param {string|number} chatId Identificador del chat.
 * @param {number} messageId ID del mensaje a editar.
 * @param {string} texto Texto nuevo.
 * @param {Object} opciones Opciones adicionales (reply_markup, ...).
 * @return {Promise<Object|boolean>}
 */
async function editarMensaje(chatId, messageId, texto, opciones = {}) {
  const telegramApi = obtenerTelegramApi();

  return telegramApi.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    text: texto,
    ...opciones,
  });
}

/**
 * Obtiene las actualizaciones pendientes de Telegram.
 *
 * @return {Promise<Object>}
 */
async function getUpdates() {
  const telegramApi = obtenerTelegramApi();

  return telegramApi.getUpdates({});
}

module.exports = {
  enviarMensaje,
  responderCallback,
  editarTeclado,
  editarMensaje,
  getUpdates,
};


