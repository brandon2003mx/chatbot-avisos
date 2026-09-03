requireCoordinador('login.html');
bindLogout('logoutButton', 'login.html');
authReady.then(user => {
  if (!user) return;
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
  const tbody = document.getElementById('managedNotices');
  if (!avisos.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Aún no hay avisos registrados.</td></tr>';
    return;
  }
  tbody.innerHTML = avisos.map(aviso => {
    const enProceso = ESTADOS_EN_PROCESO.includes(aviso.estadoEnvio);
    const disabledAttr = enProceso ? 'disabled title="El aviso todavía está en proceso de envío."' : '';
    return `<tr>
    <td>
      <strong>${escapeHtml(aviso.titulo)}</strong>
      <div class="table-subtext">${escapeHtml(ESTADO_LABELS[aviso.estadoEnvio] || aviso.estadoEnvio)} · ${Number(aviso.enviados || 0)}/${Number(aviso.destinatarios || 0)} enviados · ${formatFecha(aviso.fechaCreacion)}</div>
    </td>
    <td><span class="notice-badge">${escapeHtml(formatSegmento(aviso))}</span></td>
    <td>${Number(aviso.errores || 0)}</td>
    <td class="notice-actions">
      <button class="button-outline dark" type="button" data-edit-id="${escapeHtml(aviso.id)}" ${disabledAttr}>Editar</button>
      <button class="button-outline dark" type="button" data-delete-id="${escapeHtml(aviso.id)}" ${disabledAttr}>Eliminar</button>
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
    document.getElementById('managedNotices').innerHTML = '<tr><td colspan="4" class="table-empty">No fue posible cargar los avisos.</td></tr>';
    showMessage(error.message);
  }
}

document.getElementById('manageRefreshButton').addEventListener('click', loadAvisos);

document.getElementById('managedNotices').addEventListener('click', async event => {
  const editButton = event.target.closest('[data-edit-id]');
  if (editButton) {
    window.location.href = `avisos.html?editar=${encodeURIComponent(editButton.dataset.editId)}`;
    return;
  }

  const deleteButton = event.target.closest('[data-delete-id]');
  if (!deleteButton) return;
  const avisoId = deleteButton.dataset.deleteId;
  if (!window.confirm('¿Eliminar este aviso de forma PERMANENTE? Se borrará el aviso y todos sus destinatarios/lotes de la base de datos. Esta acción no se puede deshacer y no afecta los mensajes ya entregados en Telegram.')) return;
  deleteButton.disabled = true;
  try {
    await apiRequest(`/avisos/${encodeURIComponent(avisoId)}`, { method: 'DELETE' });
    showMessage('Aviso eliminado permanentemente.', 'success');
    loadAvisos();
  } catch (error) {
    showMessage(error.message);
    deleteButton.disabled = false;
  }
});
