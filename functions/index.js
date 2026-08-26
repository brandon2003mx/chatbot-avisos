const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");

setGlobalOptions({
  maxInstances: 10,
});

exports.api = onRequest(async (req, res) => {
  res.status(200).json({
    ok: true,
    mensaje: "Backend del Chatbot de Difusión ITTG funcionando",
  });
});
