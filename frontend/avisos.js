requireCoordinador('login.html');
bindLogout('logoutButton', 'login.html');
authReady.then(async user => {
  if (!user) return;
  mostrarRolUsuario('coordinator', user.email);
  loadAvisos();
  await loadCarreras();
  if (reemplazaAvisoId) {
    await precargarEdicion(reemplazaAvisoId);
  }
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

const formTitle = document.getElementById('formTitle');
const editWarning = document.getElementById('editWarning');
const submitAvisoButton = document.getElementById('submitAvisoButton');
const cancelEditButton = document.getElementById('cancelEditButton');
const tituloInput = document.getElementById('titulo');
const contenidoInput = document.getElementById('contenido');
const contenidoContador = document.getElementById('contenidoContador');

// Límite real de Telegram para sendMessage: 4096 caracteres. Se
// cuenta el mensaje completo tal como se arma en avisoWorkerService.js
// (emoji + título + doble salto de línea + contenido), no solo el
// textarea, para que el contador sea honesto sobre lo que de verdad
// se manda.
const TELEGRAM_MENSAJE_MAX = 4096;

function calcularLargoMensaje() {
  return `📢 ${tituloInput.value}\n\n${contenidoInput.value}`.length;
}

function actualizarContadorCaracteres() {
  const largo = calcularLargoMensaje();
  contenidoContador.textContent = `${largo} / ${TELEGRAM_MENSAJE_MAX} caracteres`;
  contenidoContador.classList.toggle('char-counter-warning', largo > TELEGRAM_MENSAJE_MAX * 0.9 && largo <= TELEGRAM_MENSAJE_MAX);
  contenidoContador.classList.toggle('char-counter-over', largo > TELEGRAM_MENSAJE_MAX);
}

tituloInput.addEventListener('input', actualizarContadorCaracteres);
contenidoInput.addEventListener('input', actualizarContadorCaracteres);

let reemplazaAvisoId = new URLSearchParams(window.location.search).get('editar');

function activarModoCreacion() {
  reemplazaAvisoId = null;
  window.history.replaceState(null, '', 'avisos.html');
  formTitle.textContent = 'Redactar aviso';
  editWarning.hidden = true;
  submitAvisoButton.textContent = 'Enviar aviso';
  cancelEditButton.hidden = true;
}

function activarModoEdicion() {
  formTitle.textContent = 'Editar y reenviar aviso';
  editWarning.hidden = false;
  submitAvisoButton.textContent = 'Guardar cambios y reenviar';
  cancelEditButton.hidden = false;
}

cancelEditButton.addEventListener('click', () => {
  window.location.href = 'administrar_avisos.html';
});

async function precargarEdicion(avisoId) {
  try {
    const { aviso } = await apiRequest(`/avisos/${encodeURIComponent(avisoId)}`);
    activarModoEdicion();
    tituloInput.value = aviso.titulo;
    contenidoInput.value = aviso.contenido;
    tipoSegmentacionSelect.value = aviso.tipoSegmentacion;
    updateVisibleFields();
    if (aviso.tipoSegmentacion !== 'todos' && aviso.carreraId) {
      carreraSelect.value = aviso.carreraId;
    }
    if ((aviso.tipoSegmentacion === 'semestre' || aviso.tipoSegmentacion === 'grupo') && aviso.semestreId !== null) {
      await loadSemestres(aviso.carreraId);
      semestreSelect.value = String(aviso.semestreId);
    }
    if (aviso.tipoSegmentacion === 'grupo' && aviso.grupoId) {
      await loadGrupos(aviso.carreraId, String(aviso.semestreId));
      grupoSelect.value = aviso.grupoId;
    }
    actualizarContadorCaracteres();
  } catch (error) {
    showMessage(error.message);
    activarModoCreacion();
  }
}

function formatFecha(value) {
  if (!value) return '—';
  const seconds = value._seconds ?? value.seconds;
  const date = seconds !== undefined ? new Date(seconds * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-MX');
}

function formatSegmento(aviso) {
  if (aviso.tipoSegmentacion === 'todos') return 'Todos los estudiantes';
  if (aviso.tipoSegmentacion === 'carrera') {
    return aviso.carreraNombre || SEGMENTO_LABELS.carrera;
  }
  if (aviso.tipoSegmentacion === 'semestre') {
    return aviso.carreraNombre
      ? `${aviso.carreraNombre} · ${aviso.semestreNumero}° semestre`
      : SEGMENTO_LABELS.semestre;
  }
  if (aviso.tipoSegmentacion === 'grupo') {
    return aviso.carreraNombre
      ? `${aviso.carreraNombre} · ${aviso.semestreNumero}° · Grupo ${aviso.grupoNombre || aviso.grupoId}`
      : SEGMENTO_LABELS.grupo;
  }
  return aviso.tipoSegmentacion;
}

function renderAvisos(avisos) {
  const tbody = document.getElementById('avisosTable');
  if (!avisos.length) {
    tbody.innerHTML = '<tr><td colspan="6">Aún no hay avisos registrados.</td></tr>';
    return;
  }
  tbody.innerHTML = avisos.map(aviso => `<tr>
    <td>${escapeHtml(aviso.titulo)}</td>
    <td><span class="notice-badge">${escapeHtml(formatSegmento(aviso))}</span></td>
    <td>${Number(aviso.destinatarios || 0)}</td>
    <td>${Number(aviso.enviados || 0)}</td>
    <td>${Number(aviso.errores || 0)}</td>
    <td>${formatFecha(aviso.fechaCreacion)}</td>
  </tr>`).join('');
}

const POLL_INTERVAL_MS = 5000;
const ESTADOS_NO_TERMINALES = ['pendiente', 'procesando'];
let pollTimeoutId = null;

function tieneAvisosEnProceso(avisos) {
  return avisos.some(aviso => ESTADOS_NO_TERMINALES.includes(aviso.estadoEnvio));
}

async function loadAvisos() {
  if (pollTimeoutId) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
  try {
    const { avisos } = await apiRequest('/avisos');
    renderAvisos(avisos);
    if (tieneAvisosEnProceso(avisos)) {
      pollTimeoutId = setTimeout(loadAvisos, POLL_INTERVAL_MS);
    }
  } catch (error) {
    document.getElementById('avisosTable').innerHTML = '<tr><td colspan="6">No fue posible cargar los avisos.</td></tr>';
    showMessage(error.message);
  }
}

document.getElementById('avisoForm').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const submitButton = formElement.querySelector('button[type="submit"]');

  if (calcularLargoMensaje() > TELEGRAM_MENSAJE_MAX) {
    showMessage(`El mensaje supera el límite de ${TELEGRAM_MENSAJE_MAX} caracteres que permite Telegram.`);
    return;
  }

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
  if (reemplazaAvisoId) {
    body.reemplazaAvisoId = reemplazaAvisoId;
  }
  submitButton.disabled = true;
  try {
    const payload = await apiRequest('/avisos', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
    const mensajeExito = reemplazaAvisoId
      ? `Aviso corregido y puesto en procesamiento para ${payload.destinatarios} destinatario(s). El original quedó oculto de la lista.`
      : `Aviso creado y puesto en procesamiento para ${payload.destinatarios} destinatario(s). El envío continúa en segundo plano.`;
    showMessage(mensajeExito, 'success');
    formElement.reset();
    activarModoCreacion();
    updateVisibleFields();
    actualizarContadorCaracteres();
    loadAvisos();
  } catch (error) {
    showMessage(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

updateVisibleFields();
