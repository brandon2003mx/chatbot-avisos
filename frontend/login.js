// Firebase devuelve mensajes técnicos en inglés ("Firebase: Error
// (auth/invalid-credential)."). Se traducen a un mensaje claro y, para
// las credenciales, a uno solo: así no se revela si lo que falló fue
// el correo o la contraseña.
const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos.';

const MENSAJES_ERROR_LOGIN = {
  'auth/invalid-credential': MENSAJE_CREDENCIALES,
  'auth/invalid-login-credentials': MENSAJE_CREDENCIALES,
  'auth/user-not-found': MENSAJE_CREDENCIALES,
  'auth/wrong-password': MENSAJE_CREDENCIALES,
  'auth/invalid-email': 'Escribe un correo electrónico válido.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada. Contacta al administrador.',
  'auth/too-many-requests': 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.',
  'auth/network-request-failed': 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.',
};

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await firebase.auth().signInWithEmailAndPassword(form.get('email'), form.get('password'));
    window.location.href = 'index.html';
  } catch (error) {
    showMessage(MENSAJES_ERROR_LOGIN[error.code] || 'No fue posible iniciar sesión. Inténtalo de nuevo.');
  }
});
