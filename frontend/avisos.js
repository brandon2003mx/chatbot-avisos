requireCoordinador('login.html');
bindLogout('logoutButton', 'login.html');
authReady.then(async user => {
  if (!user) return;
  mostrarRolUsuario('coordinator', user.email);
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
  const segmentacionPorCarrera = tipo !== 'todos';
  carreraField.hidden = tipo === 'todos';
  semestreField.hidden = !segmentacionPorCarrera;
  grupoField.hidden = !segmentacionPorCarrera;
  carreraSelect.required = segmentacionPorCarrera;
  semestreSelect.required = false;
  grupoSelect.required = false;
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

const esEventoCheckbox = document.getElementById('esEvento');
const fechaEventoField = document.getElementById('fechaEventoField');
const horaEventoField = document.getElementById('horaEventoField');
const fechaEventoInput = document.getElementById('fechaEvento');
const horaEventoInput = document.getElementById('horaEvento');

// Fechas y horas de evento se capturan y se muestran en la hora de
// Tuxtla, sin importar la zona horaria de la computadora del
// coordinador; el backend las interpreta igual.
const ZONA_HORARIA = 'America/Mexico_City';

function hoyEnTuxtla() {
  // en-CA formatea como AAAA-MM-DD, el formato de <input type="date">.
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date());
}

function updateEventoFields() {
  const esEvento = esEventoCheckbox.checked;
  fechaEventoField.hidden = !esEvento;
  horaEventoField.hidden = !esEvento;
  fechaEventoInput.required = esEvento;
  fechaEventoInput.min = hoyEnTuxtla();
  actualizarContadorCaracteres();
}

// Reproduce la línea "📅 ..." que el backend agrega a los eventos
// (describirFechaEvento en functions/src/services/avisoService.js),
// para que el contador incluya también esos caracteres.
function lineaEvento() {
  if (!esEventoCheckbox.checked || !fechaEventoInput.value) return '';
  const [anio, mes, dia] = fechaEventoInput.value.split('-').map(Number);
  // Mediodía UTC y formato en UTC: así el día de la semana no se
  // recorre por la zona horaria del navegador.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 12));
  const texto = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
  }).format(fecha);
  const diaTexto = texto.charAt(0).toUpperCase() + texto.slice(1);
  const cuando = horaEventoInput.value ? `${diaTexto}, ${horaEventoInput.value} h` : `${diaTexto} (todo el día)`;
  return `\n📅 ${cuando}`;
}

// Límite real de Telegram para sendMessage: 4096 caracteres. Se
// cuenta el mensaje completo tal como lo arma construirMensajeAviso
// en el backend (emoji + título + fecha del evento si la hay + doble
// salto de línea + contenido), no solo el textarea, para que el
// contador sea honesto sobre lo que de verdad se manda.
const TELEGRAM_MENSAJE_MAX = 4096;

function calcularLargoMensaje() {
  return `📢 ${tituloInput.value}${lineaEvento()}\n\n${contenidoInput.value}`.length;
}

function actualizarContadorCaracteres() {
  const largo = calcularLargoMensaje();
  contenidoContador.textContent = `${largo} / ${TELEGRAM_MENSAJE_MAX} caracteres`;
  contenidoContador.classList.toggle('char-counter-warning', largo > TELEGRAM_MENSAJE_MAX * 0.9 && largo <= TELEGRAM_MENSAJE_MAX);
  contenidoContador.classList.toggle('char-counter-over', largo > TELEGRAM_MENSAJE_MAX);
}

tituloInput.addEventListener('input', actualizarContadorCaracteres);
contenidoInput.addEventListener('input', actualizarContadorCaracteres);
esEventoCheckbox.addEventListener('change', updateEventoFields);
fechaEventoInput.addEventListener('input', actualizarContadorCaracteres);
horaEventoInput.addEventListener('input', actualizarContadorCaracteres);

// Convierte el Timestamp que devuelve la API ({_seconds}) en la fecha
// y hora que muestran los campos, en la hora de Tuxtla.
function partesFechaEvento(valor) {
  const segundos = valor._seconds ?? valor.seconds;
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA_HORARIA, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(segundos * 1000)).map(parte => [parte.type, parte.value]),
  );
  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    hora: `${partes.hour}:${partes.minute}`,
  };
}

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
    esEventoCheckbox.checked = Boolean(aviso.fechaEvento);
    if (aviso.fechaEvento) {
      const { fecha, hora } = partesFechaEvento(aviso.fechaEvento);
      fechaEventoInput.value = fecha;
      horaEventoInput.value = aviso.eventoTodoElDia ? '' : hora;
    }
    updateEventoFields();
    // El desplegable solo ofrece "todos" y "carrera": los tipos
    // "semestre" y "grupo" se deducen al enviar, según se llenen esos
    // campos. Asignar aquí el tipo guardado tal cual dejaría el
    // desplegable vacío y el envío fallaría.
    tipoSegmentacionSelect.value =
      aviso.tipoSegmentacion === 'todos' ? 'todos' : 'carrera';
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
  const tipoSeleccionado = form.get('tipoSegmentacion');
  const tipoSegmentacion = tipoSeleccionado === 'carrera' && grupoSelect.value ?
    'grupo' :
    tipoSeleccionado === 'carrera' && semestreSelect.value ?
      'semestre' :
      tipoSeleccionado;
  const body = {
    titulo: form.get('titulo'),
    contenido: form.get('contenido'),
    tipoSegmentacion,
    carreraId: tipoSegmentacion === 'todos' ? null : carreraSelect.value,
    semestreId: (tipoSegmentacion === 'semestre' || tipoSegmentacion === 'grupo') ? semestreSelect.value : null,
    grupoId: tipoSegmentacion === 'grupo' ? grupoSelect.value : null,
    // Sin evento se manda null: el aviso se guarda como aviso normal.
    evento: esEventoCheckbox.checked ?
      { fecha: fechaEventoInput.value, hora: horaEventoInput.value || null } :
      null,
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
      ? `Aviso corregido y puesto en procesamiento para ${payload.destinatarios} destinatario(s). Revisa su avance en Gestión de Avisos.`
      : `Aviso creado y puesto en procesamiento para ${payload.destinatarios} destinatario(s). Revisa su avance en Gestión de Avisos.`;
    showMessage(mensajeExito, 'success');
    formElement.reset();
    activarModoCreacion();
    updateVisibleFields();
    updateEventoFields();
  } catch (error) {
    showMessage(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

updateVisibleFields();
updateEventoFields();
