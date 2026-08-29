const API_URL = window.APP_CONFIG?.apiUrl || '/api';

const SEGMENTO_LABELS = { todos: 'Todos', carrera: 'Carrera', semestre: 'Semestre', grupo: 'Grupo' };

async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (firebase.auth().currentUser) {
    headers.Authorization = `Bearer ${await firebase.auth().currentUser.getIdToken()}`;
  }
  const response = await fetch(`${API_URL}${path}`, { headers, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.mensaje || payload.error || 'No fue posible completar la solicitud.');
  return payload;
}

function showMessage(message, type = 'error') {
  const element = document.getElementById('status');
  if (!element) return;
  element.className = `message ${type}`;
  element.textContent = message;
  element.hidden = false;
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
