const {Api} = require("node-telegram-bot-api");

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("Falta TELEGRAM_BOT_TOKEN en las variables de entorno.");
}

const telegramApi = new Api(token);

/**
 * Envía un mensaje de texto.
 *
 * @param {string|number} chatId Identificador del chat.
 * @param {string} mensaje Mensaje que se enviará.
 * @param {Object} opciones Opciones adicionales de Telegram.
 * @return {Promise<Object>}
 */
async function enviarMensaje(chatId, mensaje, opciones = {}) {
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
  return telegramApi.getUpdates({});
}

module.exports = {
  enviarMensaje,
  responderCallback,
  getUpdates,
};
