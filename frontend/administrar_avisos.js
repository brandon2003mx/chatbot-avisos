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

function tieneAvisosEnProceso(avisos) {
  return avisos.some(aviso => ESTADOS_EN_PROCESO.includes(aviso.estadoEnvio));
}

function formatFecha(value) {
  if (!value) return '—';
  const seconds = value._seconds ?? value.seconds;
  const date = seconds !== undefined ? new Date(seconds * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-MX');
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

function renderAvisos(avisos) {
  const tbody = document.getElementById('managedNotices');
  if (!avisos.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Aún no hay avisos registrados.</td></tr>';
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
    renderAvisos(avisos);
    if (tieneAvisosEnProceso(avisos)) {
      pollTimeoutId = setTimeout(loadAvisos, POLL_INTERVAL_MS);
    }
  } catch (error) {
    document.getElementById('managedNotices').innerHTML = '<tr><td colspan="7" class="table-empty">No fue posible cargar los avisos.</td></tr>';
    showMessage(error.message);
  }
}

document.getElementById('manageRefreshButton').addEventListener('click', loadAvisos);

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
