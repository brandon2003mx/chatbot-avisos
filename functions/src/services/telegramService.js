const {Api} = require("node-telegram-bot-api");
const {db} = require("../config/firebase");
const {FieldValue} = require("firebase-admin/firestore");

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

function coincideConSegmento(estudiante, aviso) {
  const carreras = aviso.carreras || (aviso.carrera ? [aviso.carrera] : []);
  const semestres = aviso.semestres || (aviso.semestre ? [aviso.semestre] : []);
  const grupos = aviso.grupos || (aviso.grupo ? [aviso.grupo] : []);
  return (!carreras.length || carreras.includes(estudiante.carrera)) &&
    (!semestres.length || semestres.includes(estudiante.semestre)) &&
    (!grupos.length || grupos.includes(estudiante.grupo));
}

async function enviarAvisoAEstudiantes(aviso, avisoId) {
  const snapshot = await db.collection("estudiantes").where("activo", "==", true).get();
  const destinatarios = snapshot.docs.map((doc) => doc.data())
      .filter((estudiante) => estudiante.chatId && coincideConSegmento(estudiante, aviso));
  const mensaje = `*${aviso.title}*\n\n${aviso.message}`;
  const resultados = await Promise.allSettled(destinatarios.map(async (estudiante) => {
    await telegramApi.sendMessage({
      chat_id: estudiante.chatId,
      text: mensaje,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{
          text: "Confirmar lectura",
          callback_data: `read:${avisoId}`,
        }]],
      },
    });
    await db.collection("avisos").doc(avisoId).collection("lecturas")
        .doc(String(estudiante.chatId)).set({
          chatId: estudiante.chatId,
          studentName: estudiante.nombre || "",
          status: "delivered",
          deliveredAt: FieldValue.serverTimestamp(),
        });
  }));
  return resultados.filter((resultado) => resultado.status === "fulfilled").length;
}

module.exports = {
  getUpdates,
  enviarMensaje,
  enviarAvisoAEstudiantes,
};
