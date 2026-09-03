const API_URL = window.APP_CONFIG?.apiUrl || '/api';

const SEGMENTO_LABELS = { todos: 'Todos', carrera: 'Carrera', semestre: 'Semestre', grupo: 'Grupo' };

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
