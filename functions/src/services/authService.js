const {getAuth} = require("firebase-admin/auth");

const {db} = require("../config/firebase");

/**
 * Verifica el token de Firebase Authentication.
 *
 * @param {string} token ID token.
 * @return {Promise<Object>}
 */
async function verificarToken(token) {
  if (!token) {
    throw new Error("TOKEN_REQUERIDO");
  }

  try {
    return await getAuth().verifyIdToken(token);
  } catch (error) {
    console.error("Error verificando token:", error.message);

    throw new Error("TOKEN_INVALIDO");
  }
}

/**
 * Obtiene el usuario de la aplicación a partir del UID.
 *
 * @param {string} uid UID de Firebase Authentication.
 * @return {Promise<Object|null>}
 */
async function obtenerUsuario(uid) {
  const documento = await db
      .collection("usuarios")
      .doc(uid)
      .get();

  if (!documento.exists) {
    return null;
  }

  return {
    id: documento.id,
    ...documento.data(),
  };
}

/**
 * Verifica que el usuario tenga permisos administrativos.
 *
 * @param {string} token ID token.
 * @return {Promise<Object>}
 */
async function autenticarUsuario(token) {
  const decodedToken = await verificarToken(token);

  const usuario = await obtenerUsuario(
      decodedToken.uid,
  );

  if (!usuario) {
    throw new Error("USUARIO_NO_REGISTRADO");
  }

  if (usuario.activo !== true) {
    throw new Error("USUARIO_INACTIVO");
  }

  if (
    usuario.rol !== "administrador" &&
    usuario.rol !== "coordinador"
  ) {
    throw new Error("ROL_NO_AUTORIZADO");
  }

  return {
    uid: decodedToken.uid,
    usuario,
  };
}

/**
 * Verifica que el usuario tenga un rol específico.
 *
 * @param {string} token ID token.
 * @param {Array<string>} roles Roles permitidos.
 * @return {Promise<Object>}
 */
async function autenticarConRol(
    token,
    roles,
) {
  const autenticacion = await autenticarUsuario(token);

  if (!roles.includes(autenticacion.usuario.rol)) {
    throw new Error("ROL_NO_AUTORIZADO");
  }

  return autenticacion;
}

module.exports = {
  verificarToken,
  obtenerUsuario,
  autenticarUsuario,
  autenticarConRol,
};
