const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const {getUpdates} = require("./src/services/telegramService");

setGlobalOptions({
  maxInstances: 10,
});

exports.api = onRequest(async (req, res) => {
  res.status(200).json({
    ok: true,
    mensaje: "Backend del Chatbot de Difusión ITTG funcionando",
  });
});

exports.telegramUpdates = onRequest(async (req, res) => {
  try {
    const updates = await getUpdates();

    res.status(200).json({
      ok: true,
      updates,
    });
  } catch (error) {
    console.error("Error obteniendo actualizaciones de Telegram:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});
