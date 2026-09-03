requireCoordinador('login.html');
bindLogout('logoutButton', 'login.html');
authReady.then(user => {
  if (!user) return;
  document.getElementById('coordinator').textContent = `Coordinador: ${user.email}`;
  loadAvisos();
});

const tipoSegmentacionSelect = document.getElementById('tipoSegmentacion');
const carreraSelect = document.getElementById('carrera');
const semestreSelect = document.getElementById('semestre');
const grupoSelect = document.getElementById('grupo');
const carreraField = document.getElementById('carreraField');
const semestreField = document.getElementById('semestreField');
const grupoField = document.getElementById('grupoField');

function resetSelect(select, placeholder) {
  select.innerHTML = '';
  select.add(new Option(placeholder, ''));
}

function fillSelect(select, items, placeholder) {
  resetSelect(select, placeholder);
  items.forEach(item => select.add(new Option(item.nombre ?? String(item.numero), item.id)));
}

function updateVisibleFields() {
  const tipo = tipoSegmentacionSelect.value;
  carreraField.hidden = tipo === 'todos';
  semestreField.hidden = tipo === 'todos' || tipo === 'carrera';
  grupoField.hidden = tipo !== 'grupo';
  carreraSelect.required = tipo !== 'todos';
  semestreSelect.required = tipo === 'semestre' || tipo === 'grupo';
  grupoSelect.required = tipo === 'grupo';
}

async function loadCarreras() {
  try {
    const { carreras } = await apiRequest('/carreras');
    fillSelect(carreraSelect, carreras, 'Selecciona una carrera');
  } catch (error) {
    showMessage(error.message);
  }
}

async function loadSemestres(carreraId) {
  resetSelect(semestreSelect, 'Selecciona un semestre');
  resetSelect(grupoSelect, 'Selecciona un grupo');
  if (!carreraId) return;
  try {
    const { semestres } = await apiRequest(`/carreras/${encodeURIComponent(carreraId)}/semestres`);
    fillSelect(semestreSelect, semestres, 'Selecciona un semestre');
  } catch (error) {
    showMessage(error.message);
  }
}

async function loadGrupos(carreraId, semestreId) {
  resetSelect(grupoSelect, 'Selecciona un grupo');
  if (!carreraId || !semestreId) return;
  try {
    const { grupos } = await apiRequest(`/carreras/${encodeURIComponent(carreraId)}/semestres/${encodeURIComponent(semestreId)}/grupos`);
    fillSelect(grupoSelect, grupos, 'Selecciona un grupo');
  } catch (error) {
    showMessage(error.message);
  }
}

tipoSegmentacionSelect.addEventListener('change', updateVisibleFields);
carreraSelect.addEventListener('change', () => loadSemestres(carreraSelect.value));
semestreSelect.addEventListener('change', () => loadGrupos(carreraSelect.value, semestreSelect.value));

function formatFecha(value) {
  if (!value) return '—';
  const seconds = value._seconds ?? value.seconds;
  const date = seconds !== undefined ? new Date(seconds * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-MX');
}

function renderAvisos(avisos) {
  const tbody = document.getElementById('avisosTable');
  if (!avisos.length) {
    tbody.innerHTML = '<tr><td colspan="6">Aún no hay avisos registrados.</td></tr>';
    return;
  }
  tbody.innerHTML = avisos.map(aviso => `<tr>
    <td>${escapeHtml(aviso.titulo)}</td>
    <td><span class="notice-badge">${escapeHtml(SEGMENTO_LABELS[aviso.tipoSegmentacion] || aviso.tipoSegmentacion)}</span></td>
    <td>${Number(aviso.destinatarios || 0)}</td>
    <td>${Number(aviso.enviados || 0)}</td>
    <td>${Number(aviso.errores || 0)}</td>
    <td>${formatFecha(aviso.fechaCreacion)}</td>
  </tr>`).join('');
}

async function loadAvisos() {
  try {
    const { avisos } = await apiRequest('/avisos');
    renderAvisos(avisos);
  } catch (error) {
    document.getElementById('avisosTable').innerHTML = '<tr><td colspan="6">No fue posible cargar los avisos.</td></tr>';
    showMessage(error.message);
  }
}

document.getElementById('avisoForm').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const submitButton = formElement.querySelector('button[type="submit"]');
  // Se genera una sola vez por intento de envío lógico: si en el
  // futuro se agrega un reintento HTTP para esta misma operación,
  // debe reutilizar esta misma clave, no generar una nueva.
  const idempotencyKey = crypto.randomUUID();
  const form = new FormData(formElement);
  const tipoSegmentacion = form.get('tipoSegmentacion');
  const body = {
    titulo: form.get('titulo'),
    contenido: form.get('contenido'),
    tipoSegmentacion,
    carreraId: tipoSegmentacion === 'todos' ? null : carreraSelect.value,
    semestreId: (tipoSegmentacion === 'semestre' || tipoSegmentacion === 'grupo') ? semestreSelect.value : null,
    grupoId: tipoSegmentacion === 'grupo' ? grupoSelect.value : null,
  };
  submitButton.disabled = true;
  try {
    const payload = await apiRequest('/avisos', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
    showMessage(`Aviso creado y puesto en procesamiento para ${payload.destinatarios} destinatario(s). El envío continúa en segundo plano.`, 'success');
    formElement.reset();
    updateVisibleFields();
    loadAvisos();
  } catch (error) {
    showMessage(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

updateVisibleFields();
loadCarreras();
