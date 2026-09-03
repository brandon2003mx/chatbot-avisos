const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {onTaskDispatched} = require("firebase-functions/v2/tasks");
const {defineSecret} = require("firebase-functions/params");

const {getFunctions} = require("firebase-admin/functions");

const {
  obtenerCarreras,
  obtenerCarrera,
  obtenerSemestres,
  obtenerGrupos,
  crearCarrera,
  crearSemestre,
  crearGrupo,
  actualizarCarrera,
  actualizarSemestre,
  actualizarGrupo,
} = require("./src/services/carreraService");

const {
  procesarActualizacion,
} = require("./src/services/registro/telegramRegistroService");

const {
  crearYEnviarAviso,
  obtenerAvisos,
  MARCADOR_ESTRUCTURA_LISTA,
} = require("./src/services/avisoService");

const {
  procesarLote,
} = require("./src/services/avisoWorkerService");

const {
  autenticarUsuario,
  autenticarConRol,
} = require("./src/services/authService");

setGlobalOptions({
  maxInstances: 10,
});

const telegramBotToken = defineSecret("TELEGRAM_BOT_TOKEN");
const telegramWebhookSecret = defineSecret("TELEGRAM_WEBHOOK_SECRET");

// Configuración conservadora de la cola de envío de avisos. No
// busca throughput máximo todavía: el objetivo de esta fase es
// recuperación y ausencia de duplicados, no rendimiento.
//
// DISPATCH_DEADLINE_SECONDS se usa tanto como dispatchDeadlineSeconds
// (cuánto espera Cloud Tasks la respuesta) como timeoutSeconds del
// propio worker (cuánto lo deja correr Cloud Functions antes de
// matarlo). Deben coincidir: si timeoutSeconds fuera menor, el
// contenedor podría recibir SIGKILL antes de que Cloud Tasks
// considere agotado el dispatch deadline, dejando este último sin
// efecto real. 300s (5 min) es holgado para un lote de TAMANO_LOTE
// incluso en el escenario "lento" medido en el Prompt 7C, sin
// acercarse al máximo permitido para funciones de cola de tareas
// (1800s, verificado contra los tipos instalados de firebase-functions).
const DISPATCH_DEADLINE_SECONDS = 300;
const MAX_INTENTOS_TAREA = 5;
const BACKOFF_MINIMO_SEGUNDOS = 30;
const MAX_DISPATCHES_CONCURRENTES = 5;
const MAX_DISPATCHES_POR_SEGUNDO = 5;

exports.api = onRequest({secrets: [telegramBotToken]}, async (req, res) => {
  try {
    const ruta = req.path.replace(/^\/api(?=\/|$)/, "") || "/";

    if (req.method === "GET" && ruta === "/carreras") {
      const carreras = await obtenerCarreras();

      return res.status(200).json({
        ok: true,
        carreras,
      });
    }

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

    const gruposMatch = ruta.match(
        /^\/carreras\/([^/]+)\/semestres\/([^/]+)\/grupos$/,
    );

    if (req.method === "GET" && gruposMatch) {
      const carreraId = gruposMatch[1];
      const semestreId = gruposMatch[2];

      const grupos = await obtenerGrupos(
          carreraId,
          semestreId,
      );

      return res.status(200).json({
        ok: true,
        carreraId,
        semestreId,
        grupos,
      });
    }

    if (req.method === "POST" && ruta === "/avisos") {
      const encabezado =
        req.headers.authorization || "";

      if (!encabezado.startsWith("Bearer ")) {
        return res.status(401).json({
          ok: false,
          mensaje: "Se requiere autenticación.",
        });
      }

      const token = encabezado.substring(7);

      let autenticacion;

      try {
        autenticacion = await autenticarUsuario(token);
      } catch (error) {
        const erroresAutenticacion = {
          TOKEN_REQUERIDO: "Se requiere autenticación.",
          TOKEN_INVALIDO: "Token de autenticación inválido.",
          USUARIO_NO_REGISTRADO:
            "El usuario no está registrado en el sistema.",
          USUARIO_INACTIVO:
            "El usuario está inactivo.",
          ROL_NO_AUTORIZADO:
            "El usuario no tiene permisos para crear avisos.",
        };

        const mensaje =
          erroresAutenticacion[error.message];

        if (mensaje) {
          return res.status(401).json({
            ok: false,
            mensaje,
          });
        }

        throw error;
      }

      const idempotencyKey = req.headers["idempotency-key"];

      const {
        titulo,
        contenido,
        tipoSegmentacion,
        carreraId,
        semestreId,
        grupoId,
      } = req.body;

      let resultado;

      try {
        resultado = await crearYEnviarAviso({
          titulo,
          contenido,
          tipoSegmentacion,
          carreraId,
          semestreId:
            semestreId === undefined || semestreId === null ?
              null :
              String(semestreId),
          grupoId,
          autorId: autenticacion.uid,
        }, idempotencyKey);
      } catch (error) {
        if (error.idempotencyConflict) {
          return res.status(409).json({
            ok: false,
            mensaje:
              "La Idempotency-Key ya fue utilizada para otra solicitud.",
          });
        }

        throw error;
      }

      const {nuevo, ...datosResultado} = resultado;

      return res.status(nuevo ? 201 : 200).json({
        ok: true,
        ...datosResultado,
      });
    }

    if (req.method === "POST" && ruta === "/carreras") {
      const encabezado =
        req.headers.authorization || "";

      if (!encabezado.startsWith("Bearer ")) {
        return res.status(401).json({
          ok: false,
          mensaje: "Se requiere autenticación.",
        });
      }

      const token = encabezado.substring(7);

      let autenticacion;

      try {
        autenticacion = await autenticarConRol(
            token,
            ["administrador"],
        );
      } catch (error) {
        const erroresAutenticacion = {
          TOKEN_REQUERIDO: "Se requiere autenticación.",
          TOKEN_INVALIDO:
            "Token de autenticación inválido.",
          USUARIO_NO_REGISTRADO:
            "El usuario no está registrado en el sistema.",
          USUARIO_INACTIVO:
            "El usuario está inactivo.",
          ROL_NO_AUTORIZADO:
            "No tienes permisos para administrar carreras.",
        };

        const mensaje =
          erroresAutenticacion[error.message];

        if (mensaje) {
          const estado =
            error.message === "ROL_NO_AUTORIZADO" ?
              403 :
              401;

          return res.status(estado).json({
            ok: false,
            mensaje,
          });
        }

        throw error;
      }

      const {
        id,
        nombre,
        clave,
      } = req.body;

      if (!id || !id.trim()) {
        throw new Error(
            "El identificador de la carrera es obligatorio.",
        );
      }

      if (!nombre || !nombre.trim()) {
        throw new Error(
            "El nombre de la carrera es obligatorio.",
        );
      }

      if (!clave || !clave.trim()) {
        throw new Error(
            "La clave de la carrera es obligatoria.",
        );
      }

      const carreraExistente = await obtenerCarrera(
          id.trim(),
      );

      if (carreraExistente) {
        throw new Error(
            "Ya existe una carrera con ese identificador.",
        );
      }

      await crearCarrera(
          id.trim(),
          {
            nombre: nombre.trim(),
            clave: clave.trim(),
          },
      );

      return res.status(201).json({
        ok: true,
        carrera: {
          id: id.trim(),
          nombre: nombre.trim(),
          clave: clave.trim(),
          activo: true,
        },
        creadoPor: autenticacion.uid,
      });
    }

    const crearSemestreMatch = ruta.match(
        /^\/carreras\/([^/]+)\/semestres$/,
    );

    if (
      req.method === "POST" &&
      crearSemestreMatch
    ) {
      const carreraId = crearSemestreMatch[1];

      const encabezado =
        req.headers.authorization || "";

      if (!encabezado.startsWith("Bearer ")) {
        return res.status(401).json({
          ok: false,
          mensaje: "Se requiere autenticación.",
        });
      }

      const token = encabezado.substring(7);

      let autenticacion;

      try {
        autenticacion = await autenticarConRol(
            token,
            ["administrador"],
        );
      } catch (error) {
        const erroresAutenticacion = {
          TOKEN_REQUERIDO: "Se requiere autenticación.",
          TOKEN_INVALIDO:
            "Token de autenticación inválido.",
          USUARIO_NO_REGISTRADO:
            "El usuario no está registrado en el sistema.",
          USUARIO_INACTIVO:
            "El usuario está inactivo.",
          ROL_NO_AUTORIZADO:
            "No tienes permisos para administrar semestres.",
        };

        const mensaje =
          erroresAutenticacion[error.message];

        if (mensaje) {
          const estado =
            error.message === "ROL_NO_AUTORIZADO" ?
              403 :
              401;

          return res.status(estado).json({
            ok: false,
            mensaje,
          });
        }

        throw error;
      }

      const carrera = await obtenerCarrera(
          carreraId,
      );

      if (!carrera || carrera.activo !== true) {
        throw new Error(
            "La carrera no existe o está inactiva.",
        );
      }

      const {
        id,
        numero,
      } = req.body;

      if (!id || !id.trim()) {
        throw new Error(
            "El identificador del semestre es obligatorio.",
        );
      }

      if (
        numero === undefined ||
        numero === null ||
        Number.isNaN(Number(numero))
      ) {
        throw new Error(
            "El número del semestre es obligatorio.",
        );
      }

      const semestres =
        await obtenerSemestres(carreraId);

      const semestreExistente = semestres.some(
          (semestre) =>
            String(semestre.id) === String(id) ||
            Number(semestre.numero) === Number(numero),
      );

      if (semestreExistente) {
        throw new Error(
            "Ya existe ese semestre en la carrera.",
        );
      }

      await crearSemestre(
          carreraId,
          id.trim(),
          {
            numero: Number(numero),
          },
      );

      return res.status(201).json({
        ok: true,
        semestre: {
          id: id.trim(),
          numero: Number(numero),
          activo: true,
        },
        creadoPor: autenticacion.uid,
      });
    }

    const crearGrupoMatch = ruta.match(
        /^\/carreras\/([^/]+)\/semestres\/([^/]+)\/grupos$/,
    );

    if (
      req.method === "POST" &&
      crearGrupoMatch
    ) {
      const carreraId = crearGrupoMatch[1];
      const semestreId = crearGrupoMatch[2];

      const encabezado =
        req.headers.authorization || "";

      if (!encabezado.startsWith("Bearer ")) {
        return res.status(401).json({
          ok: false,
          mensaje: "Se requiere autenticación.",
        });
      }

      const token = encabezado.substring(7);

      let autenticacion;

      try {
        autenticacion = await autenticarConRol(
            token,
            ["administrador"],
        );
      } catch (error) {
        const erroresAutenticacion = {
          TOKEN_REQUERIDO: "Se requiere autenticación.",
          TOKEN_INVALIDO:
            "Token de autenticación inválido.",
          USUARIO_NO_REGISTRADO:
            "El usuario no está registrado en el sistema.",
          USUARIO_INACTIVO:
            "El usuario está inactivo.",
          ROL_NO_AUTORIZADO:
            "No tienes permisos para administrar grupos.",
        };

        const mensaje =
          erroresAutenticacion[error.message];

        if (mensaje) {
          const estado =
            error.message === "ROL_NO_AUTORIZADO" ?
              403 :
              401;

          return res.status(estado).json({
            ok: false,
            mensaje,
          });
        }

        throw error;
      }

      const carrera = await obtenerCarrera(
          carreraId,
      );

      if (!carrera || carrera.activo !== true) {
        throw new Error(
            "La carrera no existe o está inactiva.",
        );
      }

      const semestres =
        await obtenerSemestres(carreraId);

      const semestre = semestres.find(
          (item) =>
            String(item.id) === String(semestreId),
      );

      if (!semestre) {
        throw new Error(
            "El semestre no existe o está inactivo.",
        );
      }

      const {
        id,
        nombre,
      } = req.body;

      if (!id || !id.trim()) {
        throw new Error(
            "El identificador del grupo es obligatorio.",
        );
      }

      if (!nombre || !nombre.trim()) {
        throw new Error(
            "El nombre del grupo es obligatorio.",
        );
      }

      const grupos = await obtenerGrupos(
          carreraId,
          semestreId,
      );

      const grupoExistente = grupos.some(
          (grupo) =>
            String(grupo.id) === String(id),
      );

      if (grupoExistente) {
        throw new Error(
            "Ya existe ese grupo en el semestre.",
        );
      }

      await crearGrupo(
          carreraId,
          semestreId,
          id.trim(),
          {
            nombre: nombre.trim(),
          },
      );

      return res.status(201).json({
        ok: true,
        grupo: {
          id: id.trim(),
          nombre: nombre.trim(),
          activo: true,
        },
        creadoPor: autenticacion.uid,
      });
    }

    const actualizarCarreraMatch = ruta.match(
        /^\/carreras\/([^/]+)$/,
    );

    if (
      req.method === "PATCH" &&
      actualizarCarreraMatch
    ) {
      const carreraId = actualizarCarreraMatch[1];

      const encabezado =
        req.headers.authorization || "";

      if (!encabezado.startsWith("Bearer ")) {
        return res.status(401).json({
          ok: false,
          mensaje: "Se requiere autenticación.",
        });
      }

      const token = encabezado.substring(7);

      let autenticacion;

      try {
        autenticacion = await autenticarConRol(
            token,
            ["administrador"],
        );
      } catch (error) {
        const erroresAutenticacion = {
          TOKEN_INVALIDO:
            "Token de autenticación inválido.",
          USUARIO_NO_REGISTRADO:
            "El usuario no está registrado en el sistema.",
          USUARIO_INACTIVO:
            "El usuario está inactivo.",
          ROL_NO_AUTORIZADO:
            "No tienes permisos para administrar carreras.",
        };

        const mensaje =
          erroresAutenticacion[error.message];

        if (mensaje) {
          const estado =
            error.message === "ROL_NO_AUTORIZADO" ?
              403 :
              401;

          return res.status(estado).json({
            ok: false,
            mensaje,
          });
        }

        throw error;
      }

      const carrera = await obtenerCarrera(
          carreraId,
      );

      if (!carrera) {
        throw new Error(
            "La carrera no existe.",
        );
      }

      const {
        nombre,
        clave,
        activo,
      } = req.body;

      const datos = {};

      if (nombre !== undefined) {
        if (!nombre.trim()) {
          throw new Error(
              "El nombre de la carrera no puede estar vacío.",
          );
        }

        datos.nombre = nombre.trim();
      }

      if (clave !== undefined) {
        if (!clave.trim()) {
          throw new Error(
              "La clave de la carrera no puede estar vacía.",
          );
        }

        datos.clave = clave.trim();
      }

      if (activo !== undefined) {
        if (typeof activo !== "boolean") {
          throw new Error(
              "El campo activo debe ser booleano.",
          );
        }

        datos.activo = activo;
      }

      if (Object.keys(datos).length === 0) {
        throw new Error(
            "No se proporcionaron cambios.",
        );
      }

      await actualizarCarrera(
          carreraId,
          datos,
      );

      return res.status(200).json({
        ok: true,
        carrera: {
          id: carreraId,
          ...carrera,
          ...datos,
        },
        actualizadoPor: autenticacion.uid,
      });
    }

    const actualizarSemestreMatch = ruta.match(
        /^\/carreras\/([^/]+)\/semestres\/([^/]+)$/,
    );

    if (
      req.method === "PATCH" &&
      actualizarSemestreMatch
    ) {
      const carreraId = actualizarSemestreMatch[1];
      const semestreId = actualizarSemestreMatch[2];

      const encabezado =
        req.headers.authorization || "";

      if (!encabezado.startsWith("Bearer ")) {
        return res.status(401).json({
          ok: false,
          mensaje: "Se requiere autenticación.",
        });
      }

      const token = encabezado.substring(7);

      let autenticacion;

      try {
        autenticacion = await autenticarConRol(
            token,
            ["administrador"],
        );
      } catch (error) {
        const erroresAutenticacion = {
          TOKEN_INVALIDO:
            "Token de autenticación inválido.",
          USUARIO_NO_REGISTRADO:
            "El usuario no está registrado en el sistema.",
          USUARIO_INACTIVO:
            "El usuario está inactivo.",
          ROL_NO_AUTORIZADO:
            "No tienes permisos para administrar semestres.",
        };

        const mensaje =
          erroresAutenticacion[error.message];

        if (mensaje) {
          const estado =
            error.message === "ROL_NO_AUTORIZADO" ?
              403 :
              401;

          return res.status(estado).json({
            ok: false,
            mensaje,
          });
        }

        throw error;
      }

      const carrera = await obtenerCarrera(
          carreraId,
      );

      if (!carrera || carrera.activo !== true) {
        throw new Error(
            "La carrera no existe o está inactiva.",
        );
      }

      const semestres =
        await obtenerSemestres(carreraId);

      const semestre = semestres.find(
          (item) =>
            String(item.id) === String(semestreId),
      );

      if (!semestre) {
        throw new Error(
            "El semestre no existe o está inactivo.",
        );
      }

      const {
        numero,
        activo,
      } = req.body;

      const datos = {};

      if (numero !== undefined) {
        const numeroSemestre = Number(numero);

        if (
          Number.isNaN(numeroSemestre) ||
          numeroSemestre <= 0
        ) {
          throw new Error(
              "El número del semestre no es válido.",
          );
        }

        datos.numero = numeroSemestre;

        const semestreDuplicado = semestres.some(
            (item) =>
              String(item.id) !== String(semestreId) &&
            Number(item.numero) === numeroSemestre,
        );

        if (semestreDuplicado) {
          throw new Error(
              "Ya existe ese semestre en la carrera.",
          );
        }
      }

      if (activo !== undefined) {
        if (typeof activo !== "boolean") {
          throw new Error(
              "El campo activo debe ser booleano.",
          );
        }

        datos.activo = activo;
      }

      if (Object.keys(datos).length === 0) {
        throw new Error(
            "No se proporcionaron cambios.",
        );
      }

      await actualizarSemestre(
          carreraId,
          semestreId,
          datos,
      );

      return res.status(200).json({
        ok: true,
        semestre: {
          id: semestreId,
          ...semestre,
          ...datos,
        },
        actualizadoPor: autenticacion.uid,
      });
    }

    const actualizarGrupoMatch = ruta.match(
        /^\/carreras\/([^/]+)\/semestres\/([^/]+)\/grupos\/([^/]+)$/,
    );

    if (
      req.method === "PATCH" &&
      actualizarGrupoMatch
    ) {
      const carreraId = actualizarGrupoMatch[1];
      const semestreId = actualizarGrupoMatch[2];
      const grupoId = actualizarGrupoMatch[3];

      const encabezado =
        req.headers.authorization || "";

      if (!encabezado.startsWith("Bearer ")) {
        return res.status(401).json({
          ok: false,
          mensaje: "Se requiere autenticación.",
        });
      }

      const token = encabezado.substring(7);

      let autenticacion;

      try {
        autenticacion = await autenticarConRol(
            token,
            ["administrador"],
        );
      } catch (error) {
        const erroresAutenticacion = {
          TOKEN_INVALIDO:
            "Token de autenticación inválido.",
          USUARIO_NO_REGISTRADO:
            "El usuario no está registrado en el sistema.",
          USUARIO_INACTIVO:
            "El usuario está inactivo.",
          ROL_NO_AUTORIZADO:
            "No tienes permisos para administrar grupos.",
        };

        const mensaje =
          erroresAutenticacion[error.message];

        if (mensaje) {
          const estado =
            error.message === "ROL_NO_AUTORIZADO" ?
              403 :
              401;

          return res.status(estado).json({
            ok: false,
            mensaje,
          });
        }

        throw error;
      }

      const carrera = await obtenerCarrera(
          carreraId,
      );

      if (!carrera || carrera.activo !== true) {
        throw new Error(
            "La carrera no existe o está inactiva.",
        );
      }

      const semestres =
        await obtenerSemestres(carreraId);

      const semestre = semestres.find(
          (item) =>
            String(item.id) === String(semestreId),
      );

      if (!semestre) {
        throw new Error(
            "El semestre no existe o está inactivo.",
        );
      }

      const grupos = await obtenerGrupos(
          carreraId,
          semestreId,
      );

      const grupo = grupos.find(
          (item) =>
            String(item.id) === String(grupoId),
      );

      if (!grupo) {
        throw new Error(
            "El grupo no existe o está inactivo.",
        );
      }

      const {
        nombre,
        activo,
      } = req.body;

      const datos = {};

      if (nombre !== undefined) {
        if (!nombre.trim()) {
          throw new Error(
              "El nombre del grupo no puede estar vacío.",
          );
        }

        datos.nombre = nombre.trim();
      }

      if (activo !== undefined) {
        if (typeof activo !== "boolean") {
          throw new Error(
              "El campo activo debe ser booleano.",
          );
        }

        datos.activo = activo;
      }

      if (Object.keys(datos).length === 0) {
        throw new Error(
            "No se proporcionaron cambios.",
        );
      }

      await actualizarGrupo(
          carreraId,
          semestreId,
          grupoId,
          datos,
      );

      return res.status(200).json({
        ok: true,
        grupo: {
          id: grupoId,
          ...grupo,
          ...datos,
        },
        actualizadoPor: autenticacion.uid,
      });
    }

    if (req.method === "GET" && ruta === "/avisos") {
      const encabezado =
        req.headers.authorization || "";

      if (!encabezado.startsWith("Bearer ")) {
        return res.status(401).json({
          ok: false,
          mensaje: "Se requiere autenticación.",
        });
      }

      const token = encabezado.substring(7);

      let autenticacion;

      try {
        autenticacion = await autenticarConRol(
            token,
            ["administrador", "coordinador"],
        );
      } catch (error) {
        const erroresAutenticacion = {
          TOKEN_REQUERIDO:
            "Se requiere autenticación.",
          TOKEN_INVALIDO:
            "Token de autenticación inválido.",
          USUARIO_NO_REGISTRADO:
            "El usuario no está registrado en el sistema.",
          USUARIO_INACTIVO:
            "El usuario está inactivo.",
          ROL_NO_AUTORIZADO:
            "No tienes permisos para consultar avisos.",
        };

        const mensaje =
          erroresAutenticacion[error.message];

        if (mensaje) {
          const estado =
            error.message === "ROL_NO_AUTORIZADO" ?
              403 :
              401;

          return res.status(estado).json({
            ok: false,
            mensaje,
          });
        }

        throw error;
      }

      const avisos = await obtenerAvisos();

      return res.status(200).json({
        ok: true,
        avisos,
        usuario: {
          uid: autenticacion.uid,
          rol: autenticacion.usuario.rol,
        },
      });
    }

    return res.status(404).json({
      ok: false,
      mensaje: "Ruta no encontrada",
    });
  } catch (error) {
    console.error("Error en la API:", error);

    const erroresCliente = [
      "El encabezado Idempotency-Key es obligatorio.",
      "El encabezado Idempotency-Key no es válido.",
      "El título es obligatorio.",
      "El contenido es obligatorio.",
      "El tipo de segmentación no es válido.",
      "La carrera es obligatoria para esta segmentación.",
      "El semestre es obligatorio para esta segmentación.",
      "El grupo es obligatorio para la segmentación por grupo.",
      "La carrera seleccionada no existe o está inactiva.",
      "El semestre seleccionado no existe o está inactivo.",
      "El grupo seleccionado no existe o está inactivo.",
      "No existen estudiantes destinatarios para esta segmentación.",
      "El identificador de la carrera es obligatorio.",
      "El nombre de la carrera es obligatorio.",
      "La clave de la carrera es obligatoria.",
      "Ya existe una carrera con ese identificador.",
      "El semestre no existe o está inactivo.",
      "El identificador del semestre es obligatorio.",
      "El número del semestre es obligatorio.",
      "Ya existe ese semestre en la carrera.",
      "El grupo no existe o está inactivo.",
      "El identificador del grupo es obligatorio.",
      "El nombre del grupo es obligatorio.",
      "Ya existe ese grupo en el semestre.",
      "La carrera no existe o está inactiva.",
      "El nombre de la carrera no puede estar vacío.",
      "La clave de la carrera no puede estar vacía.",
      "El campo activo debe ser booleano.",
      "No se proporcionaron cambios.",
      "La carrera no existe.",
      "El semestre no existe o está inactivo.",
      "El número del semestre no es válido.",
      "El grupo no existe o está inactivo.",
      "El nombre del grupo no puede estar vacío.",
      "La carrera está inactiva.",
      "El semestre está inactivo.",
      "El grupo está inactivo.",
    ];

    if (erroresCliente.includes(error.message)) {
      return res.status(400).json({
        ok: false,
        mensaje: error.message,
      });
    }

    return res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
    });
  }
});

/**
 * Recibe las actualizaciones de Telegram.
 */
exports.telegramWebhook = onRequest(
    {secrets: [telegramBotToken, telegramWebhookSecret]},
    async (req, res) => {
      try {
        if (req.method !== "POST") {
          return res.status(405).json({
            ok: false,
            mensaje: "Método no permitido",
          });
        }

        if (
          req.get("X-Telegram-Bot-Api-Secret-Token") !==
          telegramWebhookSecret.value()
        ) {
          return res.status(401).json({
            ok: false,
            mensaje: "No autorizado",
          });
        }

        await procesarActualizacion(req.body);

        return res.status(200).json({
          ok: true,
        });
      } catch (error) {
        console.error(
            "Error procesando actualización de Telegram:",
            error,
        );

        return res.status(500).json({
          ok: false,
          mensaje: "Error procesando actualización",
        });
      }
    },
);

/**
 * Encola las Cloud Tasks de TODOS los lotes de un aviso, en cuanto
 * la estructura completa de lotes queda confirmada en Firestore.
 *
 * Se dispara sobre la creación del documento marcador
 * `MARCADOR_ESTRUCTURA_LISTA` (no sobre la creación de cada lote
 * individual) a propósito: `crearLotes()` solo escribe ese marcador
 * después de que TODOS los commits de lotes hayan resuelto con
 * éxito. Si la creación de la estructura falla a mitad de camino
 * (algunos lotes creados, otros no), el marcador nunca se crea, así
 * que este trigger nunca se dispara para ese aviso y ningún lote
 * — ni siquiera los que sí llegaron a crearse — puede empezar a
 * encolarse ni procesarse. Esto evita la ventana en la que un
 * aviso podía terminar marcado "fallido" mientras algunos de sus
 * lotes ya estaban siendo enviados.
 *
 * Cualquier otro documento creado bajo lotes/ (los lotes en sí,
 * con ID `lote-{n}`) se ignora aquí: nunca dispara el encolado por
 * sí solo.
 *
 * Los nombres de tarea (`avisos-{avisoId}-lote-{indice}`) son
 * deterministas y se calculan sin necesidad de leer cada documento
 * de lote, así que un reintento de este trigger (`retry: true`)
 * simplemente vuelve a intentar encolar las mismas N tareas: las ya
 * creadas responden `ALREADY_EXISTS` (tratado como éxito lógico) y
 * las que faltaban se crean. Cualquier otro error se relanza para
 * que la plataforma reintente el trigger completo.
 */
exports.encolarLoteAviso = onDocumentCreated(
    {
      document: "avisos/{avisoId}/lotes/{loteId}",
      retry: true,
    },
    async (event) => {
      const {avisoId, loteId} = event.params;

      if (loteId !== MARCADOR_ESTRUCTURA_LISTA) {
        return;
      }

      if (!event.data) {
        return;
      }

      const marcador = event.data.data();
      const totalLotes = marcador.totalLotes || 0;

      const cola = getFunctions().taskQueue("procesarLoteAviso");

      for (let indice = 0; indice < totalLotes; indice++) {
        const loteIdActual = `lote-${indice}`;
        const taskName = `avisos-${avisoId}-lote-${indice}`;

        try {
          await cola.enqueue(
              {avisoId, loteId: loteIdActual},
              {
                id: taskName,
                dispatchDeadlineSeconds: DISPATCH_DEADLINE_SECONDS,
              },
          );
        } catch (error) {
          if (error.code === "functions/task-already-exists") {
            continue;
          }

          throw error;
        }
      }
    },
);

/**
 * Worker que procesa un lote de destinatarios de un aviso.
 *
 * Se invoca exclusivamente vía Cloud Tasks (nunca como un endpoint
 * HTTP público): la autenticación OIDC de la tarea la valida el
 * propio runtime de onTaskDispatched antes de ejecutar el handler.
 * Asume ejecución at-least-once: toda la lógica de idempotencia
 * (claim por destinatario, cierre de lote una sola vez) vive en
 * avisoWorkerService.js.
 *
 * timeoutSeconds se fija igual a DISPATCH_DEADLINE_SECONDS a
 * propósito: sin esto, el worker heredaría el timeout por defecto
 * de Cloud Functions 2nd gen (60s), muy por debajo de lo que
 * dispatchDeadlineSeconds le permite a Cloud Tasks esperar, y el
 * contenedor podría recibir SIGKILL antes de que ese deadline
 * tenga oportunidad de cumplir su función.
 */
exports.procesarLoteAviso = onTaskDispatched(
    {
      secrets: [telegramBotToken],
      timeoutSeconds: DISPATCH_DEADLINE_SECONDS,
      retryConfig: {
        maxAttempts: MAX_INTENTOS_TAREA,
        minBackoffSeconds: BACKOFF_MINIMO_SEGUNDOS,
      },
      rateLimits: {
        maxConcurrentDispatches: MAX_DISPATCHES_CONCURRENTES,
        maxDispatchesPerSecond: MAX_DISPATCHES_POR_SEGUNDO,
      },
    },
    async (request) => {
      const {avisoId, loteId} = request.data || {};

      if (!avisoId || !loteId) {
        console.error(
            "Payload inválido para procesarLoteAviso:",
            request.data,
        );

        return;
      }

      await procesarLote(avisoId, loteId);
    },
);
