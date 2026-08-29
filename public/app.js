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

document.getElementById('logoutButton').addEventListener('click', () => { window.location.href = '/login.html'; });
loadDashboard();
