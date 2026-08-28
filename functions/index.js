const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");

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
} = require("./src/services/avisoService");

const {
  autenticarUsuario,
  autenticarConRol,
} = require("./src/services/authService");

setGlobalOptions({
  maxInstances: 10,
});

exports.api = onRequest(async (req, res) => {
  try {
    const ruta = req.path;

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

      const {
        titulo,
        contenido,
        tipoSegmentacion,
        carreraId,
        semestre,
        grupoId,
      } = req.body;

      const resultado = await crearYEnviarAviso({
        titulo,
        contenido,
        tipoSegmentacion,
        carreraId,
        semestre:
          semestre === undefined || semestre === null ?
            null :
            Number(semestre),
        grupoId,
        autorId: autenticacion.uid,
      });

      return res.status(201).json({
        ok: true,
        ...resultado,
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
exports.telegramWebhook = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        mensaje: "Método no permitido",
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
});
