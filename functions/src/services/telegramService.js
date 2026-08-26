const {Api} = require("node-telegram-bot-api");

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("Falta TELEGRAM_BOT_TOKEN en las variables de entorno.");
}

const telegramApi = new Api(token);

/**
 * Obtiene las actualizaciones pendientes de Telegram.
 *
 * @return {Promise<Object>}
 */
async function getUpdates() {
  return telegramApi.getUpdates({});
}

/**
 * Envía un mensaje a un chat de Telegram.
 *
 * @param {string|number} chatId
 * @param {string} mensaje
 * @return {Promise<Object>}
 */
async function enviarMensaje(chatId, mensaje) {
  return telegramApi.sendMessage({
    chat_id: chatId,
    text: mensaje,
  });
}

module.exports = {
  getUpdates,
  enviarMensaje,
};
