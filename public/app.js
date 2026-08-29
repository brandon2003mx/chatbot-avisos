const API_URL = window.APP_CONFIG?.apiUrl || '/api';
let charts = {};

const emptyDashboard = {
  metrics: { total_notices: 0, total_students: 0, total_recipients: 0, total_reads: 0 },
  segments: [],
  careers: [],
  topNotices: [],
};

function valueFrom(object, ...keys) {
  return keys.reduce((value, key) => value ?? object?.[key], undefined);
}

function normalizeDashboard(payload) {
  const source = payload.dashboard || payload.data || payload;
  return {
    metrics: { ...emptyDashboard.metrics, ...(source.metrics || {}) },
    segments: source.segments || source.segmentTypes || [],
    careers: source.careers || source.careerCounts || [],
    topNotices: source.topNotices || source.top_notices || [],
  };
}

async function requestDashboard() {
  const response = await fetch(`${API_URL}/dashboard`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`La API respondió con estado ${response.status}`);
  return normalizeDashboard(await response.json());
}

async function requestNotices() {
  const response = await fetch(`${API_URL}/notices`, { headers: { Accept: 'application/json' } });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'No fue posible obtener los avisos.');
  return payload.notices || [];
}

function renderChart(id, config) {
  if (charts[id]) charts[id].destroy();
  const canvas = document.getElementById(id);
  if (window.Chart && canvas) charts[id] = new Chart(canvas, config);
}

function renderDashboard(dashboard) {
  const metrics = dashboard.metrics;
  const reads = Number(valueFrom(metrics, 'total_reads', 'totalReads') || 0);
  const recipients = Number(valueFrom(metrics, 'total_recipients', 'totalRecipients') || 0);
  const pending = Math.max(0, recipients - reads);
  const rate = recipients ? `${((reads / recipients) * 100).toFixed(1)}%` : '0%';

  document.getElementById('totalNotices').textContent = valueFrom(metrics, 'total_notices', 'totalNotices') ?? 0;
  document.getElementById('totalStudents').textContent = valueFrom(metrics, 'total_students', 'totalStudents') ?? 0;
  document.getElementById('readRate').textContent = rate;
  document.getElementById('readCount').textContent = `${reads} / ${recipients}`;

  renderChart('readRateChart', { type: 'doughnut', data: { labels: ['Leídos', 'Pendientes'], datasets: [{ data: [reads, pending], backgroundColor: ['#0f766e', '#d8d5cc'], borderWidth: 0 }] }, options: { cutout: '70%', plugins: { legend: { position: 'bottom' } } } });
  renderList('topNotices', dashboard.topNotices);
  renderCategoryChart('segmentChart', 'segmentEmpty', dashboard.segments, 'Avisos', '#075985');
  renderCategoryChart('careerChart', 'careerEmpty', dashboard.careers, 'Estudiantes', '#0f766e', 'carrera');
}

function renderCategoryChart(id, emptyId, items, label, color, preferredName) {
  const labels = items.map(item => valueFrom(item, preferredName, 'segment_type', 'segmentType', 'nombre', 'name') || 'Sin nombre');
  const values = items.map(item => Number(valueFrom(item, 'total', 'count', 'value') || 0));
  document.getElementById(emptyId).style.display = items.length ? 'none' : 'block';
  renderChart(id, { type: id === 'careerChart' ? 'line' : 'bar', data: { labels, datasets: [{ label, data: values, backgroundColor: color, borderColor: color, tension: .35, fill: id === 'careerChart' }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
}

function renderList(id, notices) {
  const list = document.getElementById(id);
  if (!notices.length) return;
  list.innerHTML = notices.slice(0, 5).map(item => `<li><strong>${escapeHtml(valueFrom(item, 'titulo', 'title') || 'Aviso sin título')}</strong><span>${Number(valueFrom(item, 'recipients', 'destinatarios') || 0)} destinatarios · ${Number(valueFrom(item, 'confirmed_reads', 'confirmedReads', 'reads') || 0)} leídos</span></li>`).join('');
}

function noticeValue(notice, singular, plural) {
  return notice[singular] || notice[plural]?.join(', ') || 'General';
}

function normalizePriority(priority) {
  const priorities = {high: 'Alta', normal: 'Media', medium: 'Media', low: 'Baja'};
  return priorities[String(priority || '').toLowerCase()] || priority || 'Media';
}

function renderManagedNotices(notices) {
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
    return `<tr><td><strong>${escapeHtml(title)}</strong><span class="notice-preview">${escapeHtml(content)}</span></td><td>${escapeHtml(segment)}</td><td><span class="priority priority-${escapeHtml(priority.toLowerCase())}">${escapeHtml(priority)}</span></td><td class="notice-actions"><button class="table-button" type="button" data-action="edit" data-id="${escapeHtml(notice.id)}">Editar</button><button class="table-button danger" type="button" data-action="delete" data-id="${escapeHtml(notice.id)}">Eliminar</button></td></tr>`;
  }).join('');
}

async function loadManagedNotices() {
  try {
    renderManagedNotices(await requestNotices());
  } catch (error) {
    document.getElementById('managedNotices').innerHTML = '<tr><td colspan="4" class="table-empty">No fue posible cargar los avisos.</td></tr>';
    showStatus(error.message);
  }
}

function showStatus(message) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.hidden = false;
}

async function saveNotice(event) {
  event.preventDefault();
  const noticeId = document.getElementById('editNoticeId').value;
  const body = {
    titulo: document.getElementById('editTitle').value.trim(),
    contenido: document.getElementById('editContent').value.trim(),
    prioridad: document.getElementById('editPriority').value,
    carrera: document.getElementById('editCareer').value.trim(),
    semestre: document.getElementById('editSemester').value.trim(),
    grupo: document.getElementById('editGroup').value.trim(),
  };
  const response = await fetch(`${API_URL}/notices/${noticeId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'No fue posible actualizar el aviso.');
  document.getElementById('noticeDialog').close();
  await Promise.all([loadManagedNotices(), loadDashboard()]);
  showStatus('Aviso actualizado correctamente.');
}

async function deleteNotice(noticeId) {
  if (!window.confirm('¿Eliminar este aviso? Esta acción no se puede deshacer.')) return;
  const response = await fetch(`${API_URL}/notices/${noticeId}`, { method: 'DELETE' });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'No fue posible eliminar el aviso.');
  await Promise.all([loadManagedNotices(), loadDashboard()]);
  showStatus('Aviso eliminado correctamente.');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

async function loadDashboard() {
  const status = document.getElementById('status');
  status.hidden = true;
  try {
    renderDashboard(await requestDashboard());
  } catch (error) {
    renderDashboard(emptyDashboard);
    status.textContent = 'La API de avisos aún no está disponible. Se muestran valores iniciales.';
    status.hidden = false;
    console.info('Dashboard pendiente de backend:', error.message);
  }
}

const refreshButton = document.getElementById('refreshButton');
if (refreshButton) refreshButton.addEventListener('click', loadDashboard);

const composeButton = document.getElementById('composeNoticeButton');
if (composeButton) composeButton.addEventListener('click', () => { window.location.href = 'notice_form.html'; });

const studentsButton = document.getElementById('studentsButton');
if (studentsButton) studentsButton.addEventListener('click', () => { window.location.href = 'students.html'; });

document.getElementById('manageRefreshButton').addEventListener('click', loadManagedNotices);
document.getElementById('managedNotices').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  try {
    if (button.dataset.action === 'delete') return await deleteNotice(button.dataset.id);
    const notice = (await requestNotices()).find((item) => item.id === button.dataset.id);
    if (!notice) throw new Error('El aviso ya no existe.');
    document.getElementById('editNoticeId').value = notice.id;
    document.getElementById('editTitle').value = valueFrom(notice, 'titulo', 'title') || '';
    document.getElementById('editContent').value = valueFrom(notice, 'contenido', 'message') || '';
    document.getElementById('editPriority').value = normalizePriority(valueFrom(notice, 'prioridad', 'priority'));
    document.getElementById('editCareer').value = noticeValue(notice, 'carrera', 'carreras') === 'General' ? '' : noticeValue(notice, 'carrera', 'carreras');
    document.getElementById('editSemester').value = noticeValue(notice, 'semestre', 'semestres') === 'General' ? '' : noticeValue(notice, 'semestre', 'semestres');
    document.getElementById('editGroup').value = noticeValue(notice, 'grupo', 'grupos') === 'General' ? '' : noticeValue(notice, 'grupo', 'grupos');
    document.getElementById('noticeDialog').showModal();
  } catch (error) { showStatus(error.message); }
});
document.getElementById('editNoticeForm').addEventListener('submit', (event) => saveNotice(event).catch((error) => showStatus(error.message)));
document.getElementById('closeNoticeDialog').addEventListener('click', () => document.getElementById('noticeDialog').close());
document.getElementById('cancelNoticeEdit').addEventListener('click', () => document.getElementById('noticeDialog').close());

document.getElementById('logoutButton').addEventListener('click', () => { window.location.href = 'login.html'; });
loadDashboard();
loadManagedNotices();
