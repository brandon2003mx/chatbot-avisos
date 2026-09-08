const API_URL = window.APP_CONFIG?.apiUrl || '/api';

const SEGMENTO_LABELS = { todos: 'Todos', carrera: 'Carrera', semestre: 'Semestre', grupo: 'Grupo' };
const ROL_LABELS = { administrador: 'Administrador', coordinador: 'Coordinador' };

function leerRolCacheado(email) {
  try { return sessionStorage.getItem(`rol:${email}`); } catch (error) { return null; }
}

function guardarRolCacheado(email, rol) {
  try { sessionStorage.setItem(`rol:${email}`, rol); } catch (error) { /* sin caché disponible */ }
}

async function mostrarRolUsuario(elementId, email) {
  const element = document.getElementById(elementId);
  if (!element) return;

  // El rol vive en Firestore, no en el token, así que hay que
  // preguntarlo al backend. Para no mostrar un rol equivocado
  // mientras llega esa respuesta: si ya se consultó antes en esta
  // sesión se usa ese valor, y si no, se muestra solo el correo.
  const rolCacheado = leerRolCacheado(email);
  element.textContent = rolCacheado ? `${ROL_LABELS[rolCacheado] || 'Usuario'}: ${email}` : email;

  try {
    const { rol } = await apiRequest('/me');
    element.textContent = `${ROL_LABELS[rol] || 'Usuario'}: ${email}`;
    guardarRolCacheado(email, rol);
  } catch (error) {
    if (!rolCacheado) element.textContent = `Usuario: ${email}`;
  }
}

async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...options.headers };
  if (firebase.auth().currentUser) {
    headers.Authorization = `Bearer ${await firebase.auth().currentUser.getIdToken()}`;
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.mensaje || payload.error || 'No fue posible completar la solicitud.');
  return payload;
}

const MESSAGE_DURATION_MS = 6000;
let messageTimeoutId = null;

function showMessage(message, type = 'error') {
  const element = document.getElementById('status');
  if (!element) return;
  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
    messageTimeoutId = null;
  }
  element.className = `message ${type}`;
  element.textContent = message;
  element.hidden = false;
  messageTimeoutId = setTimeout(() => {
    element.hidden = true;
    messageTimeoutId = null;
  }, MESSAGE_DURATION_MS);
}

function bindLogout(buttonId, redirect) {
  document.getElementById(buttonId)?.addEventListener('click', async () => {
    try { await firebase.auth().signOut(); } catch (error) { console.info('Error al cerrar sesión:', error.message); }
    window.location.href = redirect;
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
