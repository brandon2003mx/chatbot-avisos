requireCoordinador('login.html');
bindLogout('logoutButton', 'login.html');
authReady.then(user => {
  if (!user) return;
  mostrarRolUsuario('coordinator', user.email);
  loadAvisos();
});

const ESTADO_LABELS = {
  pendiente: 'Pendiente',
  procesando: 'Procesando',
  completado: 'Completado',
  completado_con_errores: 'Completado con errores',
  fallido: 'Fallido',
};

const ESTADOS_EN_PROCESO = ['pendiente', 'procesando'];
const POLL_INTERVAL_MS = 5000;
let pollTimeoutId = null;

// Última lista recibida del backend. Los filtros trabajan sobre ella en
// el navegador: cambiar un filtro no vuelve a consultar Firestore, y el
// refresco automático conserva los filtros elegidos.
let avisosCargados = [];

const filtros = {
  texto: document.getElementById('filtroTexto'),
  estado: document.getElementById('filtroEstado'),
  segmento: document.getElementById('filtroSegmento'),
  tipo: document.getElementById('filtroTipo'),
};

// Se compara sin acentos ni mayúsculas, para que "suspension"
// encuentre "Suspensión".
function normalizarTexto(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function hayFiltrosActivos() {
  return Object.values(filtros).some(control => control.value.trim() !== '');
}

function filtrarAvisos(avisos) {
  const texto = normalizarTexto(filtros.texto.value);
  const { value: estado } = filtros.estado;
  const { value: segmento } = filtros.segmento;
  const { value: tipo } = filtros.tipo;

  return avisos.filter(aviso => {
    if (texto && !normalizarTexto(`${aviso.titulo} ${aviso.contenido}`).includes(texto)) return false;
    if (estado && aviso.estadoEnvio !== estado) return false;
    if (segmento && aviso.tipoSegmentacion !== segmento) return false;
    if (tipo === 'evento' && !aviso.fechaEvento) return false;
    if (tipo === 'aviso' && aviso.fechaEvento) return false;
    return true;
  });
}

function contarAvisos(cantidad) {
  return `${cantidad} ${cantidad === 1 ? 'aviso' : 'avisos'}`;
}

function mostrarAvisos() {
  const filtrando = hayFiltrosActivos();
  const visibles = filtrarAvisos(avisosCargados);
  renderAvisos(visibles, filtrando);
  document.getElementById('filtrosResumen').textContent = filtrando ?
    `Mostrando ${visibles.length} de ${contarAvisos(avisosCargados.length)}.` :
    '';
}

function limpiarFiltros() {
  Object.values(filtros).forEach(control => { control.value = ''; });
  mostrarAvisos();
}

function tieneAvisosEnProceso(avisos) {
  return avisos.some(aviso => ESTADOS_EN_PROCESO.includes(aviso.estadoEnvio));
}

function formatFecha(value) {
  if (!value) return '—';
  const seconds = value._seconds ?? value.seconds;
  const date = seconds !== undefined ? new Date(seconds * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-MX');
}

// "sáb, 14 nov, 10:00 h" o "sáb, 14 nov · todo el día", en la hora de
// Tuxtla, para distinguir en la tabla los avisos que son eventos.
function formatFechaEvento(aviso) {
  const segundos = aviso.fechaEvento._seconds ?? aviso.fechaEvento.seconds;
  const fecha = new Date(segundos * 1000);
  const opciones = { timeZone: 'America/Mexico_City' };
  const dia = fecha.toLocaleDateString('es-MX', { ...opciones, weekday: 'short', day: 'numeric', month: 'short' });
  if (aviso.eventoTodoElDia) return `${dia} · todo el día`;
  const hora = fecha.toLocaleTimeString('es-MX', { ...opciones, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${dia}, ${hora} h`;
}

// La segmentación se parte en la carrera (que va en la etiqueta) y los
// detalles que la acotan, cada uno en su propio renglón: en una sola
// línea, "Carrera · 9° · Grupo A" se come el ancho de la tabla.
function formatSegmento(aviso) {
  if (aviso.tipoSegmentacion === 'todos') {
    return { carrera: 'Todos los estudiantes', detalles: [] };
  }

  // Los avisos viejos pueden no traer copiado el nombre de la carrera.
  const carrera = aviso.carreraNombre || SEGMENTO_LABELS.carrera;
  const detalles = [];

  if (aviso.tipoSegmentacion === 'semestre' || aviso.tipoSegmentacion === 'grupo') {
    detalles.push(`${aviso.semestreNumero}° semestre`);
  }

  if (aviso.tipoSegmentacion === 'grupo') {
    detalles.push(`Grupo ${aviso.grupoNombre || aviso.grupoId}`);
  }

  return { carrera: carrera || aviso.tipoSegmentacion, detalles };
}

function renderSegmento(aviso) {
  const { carrera, detalles } = formatSegmento(aviso);
  const lineas = detalles
    .map(detalle => `<div class="table-subtext">${escapeHtml(detalle)}</div>`)
    .join('');

  return `<div class="segmento-carrera">${escapeHtml(carrera)}</div>${lineas}`;
}

// Íconos de línea (trazo con el color del texto), en lugar de emojis,
// para que se vean iguales en cualquier sistema operativo.
const ICONO_SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const ICONO_EVENTO = `<svg ${ICONO_SVG}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
const ICONO_IMAGEN = `<svg ${ICONO_SVG}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>`;

function renderEtiquetas(aviso) {
  const etiquetas = [];
  if (aviso.fechaEvento) {
    etiquetas.push(`<span class="aviso-etiqueta">${ICONO_EVENTO}Evento: ${escapeHtml(formatFechaEvento(aviso))}</span>`);
  }
  if (aviso.imagen) {
    etiquetas.push(`<span class="aviso-etiqueta">${ICONO_IMAGEN}Con imagen</span>`);
  }
  return etiquetas.length ? `<div class="aviso-etiquetas">${etiquetas.join('')}</div>` : '';
}

function renderAvisos(avisos, filtrando = false) {
  const tbody = document.getElementById('managedNotices');
  if (!avisos.length) {
    const mensaje = filtrando ?
      'Ningún aviso coincide con los filtros.' :
      'Aún no hay avisos registrados.';
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${mensaje}</td></tr>`;
    return;
  }
  tbody.innerHTML = avisos.map(aviso => {
    const enProceso = ESTADOS_EN_PROCESO.includes(aviso.estadoEnvio);
    const disabledAttr = enProceso ? 'disabled title="El aviso todavía está en proceso de envío."' : '';
    const destinatarios = Number(aviso.destinatarios || 0);
    const enviados = Number(aviso.enviados || 0);
    const leidos = Number(aviso.leidos || 0);
    // El porcentaje solo tiene sentido contra un total conocido: un
    // aviso sin destinatarios no se reporta como 0% de lectura.
    const porcentajeLeido = enviados > 0 ? ` (${Math.round((leidos / enviados) * 100)}%)` : '';
    return `<tr>
    <td>
      <strong>${escapeHtml(aviso.titulo)}</strong>
      <div class="table-subtext">${escapeHtml(ESTADO_LABELS[aviso.estadoEnvio] || aviso.estadoEnvio)} · ${formatFecha(aviso.fechaCreacion)}</div>
      ${renderEtiquetas(aviso)}
    </td>
    <td class="segmento-celda">${renderSegmento(aviso)}</td>
    <td>${destinatarios}</td>
    <td>${enviados}</td>
    <td>${leidos}<span class="table-subtext">${porcentajeLeido}</span></td>
    <td>${Number(aviso.errores || 0)}</td>
    <td>
      <div class="notice-actions">
        <button class="button-outline dark" type="button" data-edit-id="${escapeHtml(aviso.id)}" ${disabledAttr}>Editar</button>
        <button class="button-outline dark" type="button" data-delete-id="${escapeHtml(aviso.id)}" ${disabledAttr}>Eliminar</button>
      </div>
    </td>
  </tr>`;
  }).join('');
}

async function loadAvisos() {
  if (pollTimeoutId) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
  try {
    const { avisos } = await apiRequest('/avisos');
    avisosCargados = avisos;
    mostrarAvisos();
    // El refresco depende de toda la lista, no solo de lo filtrado: un
    // aviso oculto por los filtros sigue avanzando en su envío.
    if (tieneAvisosEnProceso(avisos)) {
      pollTimeoutId = setTimeout(loadAvisos, POLL_INTERVAL_MS);
    }
  } catch (error) {
    document.getElementById('managedNotices').innerHTML = '<tr><td colspan="7" class="table-empty">No fue posible cargar los avisos.</td></tr>';
    showMessage(error.message);
  }
}

document.getElementById('manageRefreshButton').addEventListener('click', loadAvisos);

filtros.texto.addEventListener('input', mostrarAvisos);
[filtros.estado, filtros.segmento, filtros.tipo].forEach(control => {
  control.addEventListener('change', mostrarAvisos);
});
document.getElementById('limpiarFiltrosButton').addEventListener('click', limpiarFiltros);
// Enter en el buscador no debe recargar la página.
document.getElementById('noticeFilters').addEventListener('submit', event => event.preventDefault());

const deleteDialog = document.getElementById('deleteDialog');
const confirmDeleteButton = document.getElementById('confirmDeleteButton');
const cancelDeleteButton = document.getElementById('cancelDeleteButton');
let botonEliminarPendiente = null;

function confirmarEliminar(boton) {
  botonEliminarPendiente = boton;
  deleteDialog.showModal();
}

function cerrarConfirmacionEliminar() {
  deleteDialog.close();
  botonEliminarPendiente = null;
}

cancelDeleteButton.addEventListener('click', cerrarConfirmacionEliminar);
deleteDialog.addEventListener('cancel', cerrarConfirmacionEliminar);

confirmDeleteButton.addEventListener('click', async () => {
  const deleteButton = botonEliminarPendiente;
  if (!deleteButton) return;
  const avisoId = deleteButton.dataset.deleteId;
  deleteButton.disabled = true;
  confirmDeleteButton.disabled = true;
  try {
    await apiRequest(`/avisos/${encodeURIComponent(avisoId)}`, { method: 'DELETE' });
    cerrarConfirmacionEliminar();
    showMessage('Aviso eliminado permanentemente.', 'success');
    loadAvisos();
  } catch (error) {
    cerrarConfirmacionEliminar();
    showMessage(error.message);
    deleteButton.disabled = false;
  } finally {
    confirmDeleteButton.disabled = false;
  }
});

document.getElementById('managedNotices').addEventListener('click', event => {
  const editButton = event.target.closest('[data-edit-id]');
  if (editButton) {
    window.location.href = `avisos.html?editar=${encodeURIComponent(editButton.dataset.editId)}`;
    return;
  }

  const deleteButton = event.target.closest('[data-delete-id]');
  if (!deleteButton) return;
  confirmarEliminar(deleteButton);
});
