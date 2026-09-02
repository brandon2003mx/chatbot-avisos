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
 * @return {Promise<Object>}
 */
async function responderCallback(callbackQueryId) {
  const telegramApi = obtenerTelegramApi();

  return telegramApi.answerCallbackQuery({
    callback_query_id: callbackQueryId,
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
  getUpdates,
};


