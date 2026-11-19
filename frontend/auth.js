const API_URL = window.APP_CONFIG?.apiUrl || '/api';

const SEGMENTO_LABELS = { todos: 'Todos', carrera: 'Carrera', semestre: 'Semestre', grupo: 'Grupo' };
const ROL_LABELS = { administrador: 'Administrador', coordinador: 'Coordinador' };

function leerRolCacheado(email) {
  try { return sessionStorage.getItem(`rol:${email}`); } catch (error) { return null; }
}

// panel:rol y panel:correo los lee menu.js para pintar el encabezado y
// el menú antes de que Firebase confirme la sesión.
function guardarRolCacheado(email, rol) {
  try {
    sessionStorage.setItem(`rol:${email}`, rol);
    sessionStorage.setItem('panel:rol', rol);
    sessionStorage.setItem('panel:correo', email);
  } catch (error) { /* sin caché disponible */ }
}

function olvidarRolCacheado(email) {
  try {
    if (email) sessionStorage.removeItem(`rol:${email}`);
    sessionStorage.removeItem('panel:rol');
    sessionStorage.removeItem('panel:correo');
  } catch (error) { /* sin caché disponible */ }
}

const MENSAJE_SIN_ACCESO = 'Tu cuenta no tiene acceso al panel. Contacta al administrador.';
const MENSAJE_SOLO_ADMINISTRADOR = 'Esa sección solo está disponible para el administrador.';

// Un mensaje que una página deja para que lo muestre la siguiente: al
// sacar a alguien del panel, el aviso tiene que verse en el login, no
// en la página que se está abandonando.
const CLAVE_MENSAJE_PENDIENTE = 'mensajePendiente';

function dejarMensajePendiente(mensaje) {
  try { sessionStorage.setItem(CLAVE_MENSAJE_PENDIENTE, mensaje); } catch (error) { /* sin caché disponible */ }
}

function mostrarMensajePendiente() {
  let mensaje = null;
  try {
    mensaje = sessionStorage.getItem(CLAVE_MENSAJE_PENDIENTE);
    sessionStorage.removeItem(CLAVE_MENSAJE_PENDIENTE);
  } catch (error) { /* sin caché disponible */ }
  if (mensaje) showMessage(mensaje);
}

// Una sesión de Firebase no basta para usar el panel: la cuenta
// también debe tener un rol activo en Firestore. Si no lo tiene, se
// cierra la sesión en lugar de dejarla ver páginas vacías.
async function sacarDelPanel(email, mensaje) {
  olvidarRolCacheado(email);
  dejarMensajePendiente(mensaje);
  try { await firebase.auth().signOut(); } catch (error) { console.info('Error al cerrar sesión:', error.message); }
  window.location.href = 'login.html';
}

// Los enlaces marcados con data-solo-admin (Carreras y Estudiantes)
// vienen ocultos en el HTML y solo se muestran al administrador.
function aplicarPermisosDeRol(rol) {
  document.querySelectorAll('[data-solo-admin]').forEach(enlace => {
    enlace.hidden = rol !== 'administrador';
  });
}

/**
 * Muestra el rol del usuario en el encabezado, ajusta el menú a ese
 * rol y saca del panel a quien no tenga acceso.
 *
 * Con soloAdministrador, además regresa al inicio a quien no sea
 * administrador. Resuelve con el rol confirmado por el backend, o con
 * null si el usuario fue redirigido o el rol no se pudo consultar.
 */
async function mostrarRolUsuario(elementId, email, { soloAdministrador = false } = {}) {
  const element = document.getElementById(elementId);

  // El rol vive en Firestore, no en el token, así que hay que
  // preguntarlo al backend. Para no mostrar un rol equivocado
  // mientras llega esa respuesta: si ya se consultó antes en esta
  // sesión se usa ese valor, y si no, se muestra solo el correo.
  const rolCacheado = leerRolCacheado(email);
  if (element) element.textContent = rolCacheado ? `${ROL_LABELS[rolCacheado] || 'Usuario'}: ${email}` : email;
  if (rolCacheado) aplicarPermisosDeRol(rolCacheado);

  let rol;
  try {
    ({ rol } = await apiRequest('/me'));
  } catch (error) {
    // 401: la cuenta no está registrada en el panel o está inactiva.
    // Cualquier otro error (sin conexión, falla del servidor) no
    // demuestra que falte el acceso, así que no se cierra la sesión.
    if (error.status === 401) {
      await sacarDelPanel(email, MENSAJE_SIN_ACCESO);
      return null;
    }
    if (element && !rolCacheado) element.textContent = `Usuario: ${email}`;
    return null;
  }

  if (!ROL_LABELS[rol]) {
    await sacarDelPanel(email, MENSAJE_SIN_ACCESO);
    return null;
  }

  if (element) element.textContent = `${ROL_LABELS[rol]}: ${email}`;
  guardarRolCacheado(email, rol);
  aplicarPermisosDeRol(rol);

  if (soloAdministrador && rol !== 'administrador') {
    dejarMensajePendiente(MENSAJE_SOLO_ADMINISTRADOR);
    window.location.href = 'index.html';
    return null;
  }

  return rol;
}

async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...options.headers };
  if (firebase.auth().currentUser) {
    headers.Authorization = `Bearer ${await firebase.auth().currentUser.getIdToken()}`;
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.mensaje || payload.error || 'No fue posible completar la solicitud.');
    error.status = response.status;
    throw error;
  }
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
    olvidarRolCacheado(firebase.auth().currentUser?.email);
    try { await firebase.auth().signOut(); } catch (error) { console.info('Error al cerrar sesión:', error.message); }
    window.location.href = redirect;
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

// Los scripts cargan con defer, así que el DOM ya existe aquí.
mostrarMensajePendiente();
