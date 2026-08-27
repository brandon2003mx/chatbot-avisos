const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");

const {
  obtenerCarreras,
  obtenerSemestres,
  obtenerGrupos,
} = require("./src/services/carreraService");

setGlobalOptions({
  maxInstances: 10,
});

exports.api = onRequest(async (req, res) => {
  try {
    const ruta = req.path;

    // GET /api/carreras
    if (req.method === "GET" && ruta === "/carreras") {
      const carreras = await obtenerCarreras();

      return res.status(200).json({
        ok: true,
        carreras,
      });
    }

    // GET /api/carreras/:carreraId/semestres
    const semestresMatch = ruta.match(
        /^\/carreras\/([^/]+)\/semestres$/,
    );

    if (req.method === "GET" && semestresMatch) {
      const carreraId = semestresMatch[1];

      const semestres = await obtenerSemestres(carreraId);

      return res.status(200).json({
        ok: true,
        carreraId,
        semestres,
      });
    }

    // GET /api/carreras/:carreraId/semestres/:semestreId/grupos
    const gruposMatch = ruta.match(
        /^\/carreras\/([^/]+)\/semestres\/([^/]+)\/grupos$/,
    );

    if (req.method === "GET" && gruposMatch) {
      const carreraId = gruposMatch[1];
      const semestreId = gruposMatch[2];

      const grupos = await obtenerGrupos(carreraId, semestreId);

      return res.status(200).json({
        ok: true,
        carreraId,
        semestreId,
        grupos,
      });
    }

    return res.status(404).json({
      ok: false,
      mensaje: "Ruta no encontrada",
    });
  } catch (error) {
    console.error("Error en la API:", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
    });
  }
});
