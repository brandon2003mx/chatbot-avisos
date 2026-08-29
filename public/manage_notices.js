const API_URL = window.APP_CONFIG?.apiUrl || '/api';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character]));
}

function valueFrom(object, ...keys) {
  return keys.reduce((value, key) => value ?? object?.[key], undefined);
}

function noticeValue(notice, singular, plural) {
  return notice[singular] || notice[plural]?.join(', ') || 'General';
}

function normalizePriority(priority) {
  const priorities = {high: 'Alta', normal: 'Media', medium: 'Media', low: 'Baja'};
  return priorities[String(priority || '').toLowerCase()] || priority || 'Media';
}

function showStatus(message, type = 'error') {
  const status = document.getElementById('status');
  status.className = `message ${type}`;
  status.textContent = message;
  status.hidden = false;
}

async function requestNotices() {
  const response = await fetch(`${API_URL}/notices`, {headers: {Accept: 'application/json'}});
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'No fue posible obtener los avisos.');
  return payload.notices || [];
}

function renderNotices(notices) {
  const table = document.getElementById('managedNotices');
  if (!notices.length) {
    table.innerHTML = '<tr><td colspan="4" class="table-empty">Todavía no hay avisos redactados.</td></tr>';
    return;
  }
  table.innerHTML = notices.map((notice) => {
    const title = valueFrom(notice, 'titulo', 'title') || 'Aviso sin título';
    const content = valueFrom(notice, 'contenido', 'message') || '';
    const priority = normalizePriority(valueFrom(notice, 'prioridad', 'priority'));
    const segment = `${noticeValue(notice, 'carrera', 'carreras')} · ${noticeValue(notice, 'semestre', 'semestres')} · ${noticeValue(notice, 'grupo', 'grupos')}`;
    return `<tr><td><strong>${escapeHtml(title)}</strong><span class="notice-preview">${escapeHtml(content)}</span></td><td>${escapeHtml(segment)}</td><td><span class="priority priority-${priority.toLowerCase()}">${escapeHtml(priority)}</span></td><td class="notice-actions"><button class="table-button" type="button" data-action="edit" data-id="${escapeHtml(notice.id)}">Editar</button><button class="table-button danger" type="button" data-action="delete" data-id="${escapeHtml(notice.id)}">Eliminar</button></td></tr>`;
  }).join('');
}

async function loadNotices() {
  try { renderNotices(await requestNotices()); } catch (error) { showStatus(error.message); }
}

async function saveNotice(event) {
  event.preventDefault();
  const noticeId = document.getElementById('editNoticeId').value;
  const body = {titulo: editTitle.value.trim(), contenido: editContent.value.trim(), prioridad: editPriority.value, carrera: editCareer.value.trim(), semestre: editSemester.value.trim(), grupo: editGroup.value.trim()};
  const response = await fetch(`${API_URL}/notices/${noticeId}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'No fue posible actualizar el aviso.');
  noticeDialog.close();
  await loadNotices();
  showStatus('Aviso actualizado correctamente.', 'success');
}

async function deleteNotice(noticeId) {
  if (!window.confirm('¿Eliminar este aviso? Esta acción no se puede deshacer.')) return;
  const response = await fetch(`${API_URL}/notices/${noticeId}`, {method: 'DELETE'});
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'No fue posible eliminar el aviso.');
  await loadNotices();
  showStatus('Aviso eliminado correctamente.', 'success');
}

document.getElementById('manageRefreshButton').addEventListener('click', loadNotices);
document.getElementById('managedNotices').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  try {
    if (button.dataset.action === 'delete') return await deleteNotice(button.dataset.id);
    const notice = (await requestNotices()).find((item) => item.id === button.dataset.id);
    if (!notice) throw new Error('El aviso ya no existe.');
    editNoticeId.value = notice.id;
    editTitle.value = valueFrom(notice, 'titulo', 'title') || '';
    editContent.value = valueFrom(notice, 'contenido', 'message') || '';
    editPriority.value = normalizePriority(valueFrom(notice, 'prioridad', 'priority'));
    editCareer.value = noticeValue(notice, 'carrera', 'carreras') === 'General' ? '' : noticeValue(notice, 'carrera', 'carreras');
    editSemester.value = noticeValue(notice, 'semestre', 'semestres') === 'General' ? '' : noticeValue(notice, 'semestre', 'semestres');
    editGroup.value = noticeValue(notice, 'grupo', 'grupos') === 'General' ? '' : noticeValue(notice, 'grupo', 'grupos');
    noticeDialog.showModal();
  } catch (error) { showStatus(error.message); }
});
document.getElementById('editNoticeForm').addEventListener('submit', (event) => saveNotice(event).catch((error) => showStatus(error.message)));
document.getElementById('closeNoticeDialog').addEventListener('click', () => noticeDialog.close());
document.getElementById('cancelNoticeEdit').addEventListener('click', () => noticeDialog.close());
document.getElementById('logoutButton').addEventListener('click', () => { window.location.href = 'login.html'; });
loadNotices();
