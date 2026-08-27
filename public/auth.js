const API_URL = window.APP_CONFIG?.apiUrl || '/api';

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'No fue posible completar la solicitud.');
  return payload;
}

function showMessage(message, type = 'error') {
  const element = document.getElementById('status');
  if (!element) return;
  element.className = `message ${type}`;
  element.textContent = message;
  element.hidden = false;
}

function bindLogout(buttonId, endpoint, redirect) {
  document.getElementById(buttonId)?.addEventListener('click', async () => {
    try { await apiRequest(endpoint, { method: 'POST' }); } catch (error) { console.info('Sesión local cerrada:', error.message); }
    window.location.href = redirect;
  });
}

function populateSelect(id, values) {
  const select = document.getElementById(id);
  if (!select) return;
  values.forEach(value => select.add(new Option(value, value)));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
