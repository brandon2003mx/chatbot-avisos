requireCoordinador('login.html');
bindLogout('logoutButton', 'login.html');

let carreraEnEdicion = null;

authReady.then(user => {
  if (!user) return;
  mostrarRolUsuario('coordinator', user.email);
  loadCarreras();
});

function renderCarreras(carreras) {
  const tbody = document.getElementById('carrerasTable');

  if (!carreras.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Aún no hay carreras registradas.</td></tr>';
    return;
  }

  tbody.innerHTML = carreras.map(carrera => `<tr>
    <td><span class="notice-badge carrera-badge">${escapeHtml(carrera.nombre)}</span></td>
    <td>${escapeHtml(carrera.clave || 'Sin clave')}</td>
    <td>${carrera.activo === false ? 'Inactiva' : 'Activa'}</td>
    <td><div class="notice-actions">
      <button class="button-outline dark" type="button" data-edit-id="${escapeHtml(carrera.id)}">Editar</button>
      <button class="button-outline dark" type="button" data-delete-id="${escapeHtml(carrera.id)}">Eliminar</button>
    </div></td>
  </tr>`).join('');
}

async function loadCarreras() {
  try {
    const { carreras } = await apiRequest('/carreras');
    renderCarreras(carreras);
  } catch (error) {
    document.getElementById('carrerasTable').innerHTML = '<tr><td colspan="4" class="table-empty">No fue posible cargar las carreras.</td></tr>';
    showMessage(error.message);
  }
}

document.getElementById('refreshCarrerasButton').addEventListener('click', loadCarreras);

// La estructura (semestres y grupos) solo se define al crear la carrera:
// editarla implicaría borrar o agregar semestres existentes. Al ocultar
// los campos también se deshabilitan, para que el navegador no intente
// validar controles que el usuario no puede ver.
function mostrarEstructura(visible) {
  document.getElementById('estructuraField').hidden = !visible;
  document.getElementById('numeroSemestres').disabled = !visible;
  document.getElementById('grupos').disabled = !visible;
}

function cancelarEdicion() {
  carreraEnEdicion = null;
  mostrarEstructura(true);
  document.getElementById('carreraForm').reset();
  document.getElementById('formTitle').textContent = 'Registrar carrera';
  document.getElementById('formDescription').textContent = 'Agrega las carreras disponibles para segmentar los avisos institucionales.';
  document.getElementById('submitCarreraButton').textContent = 'Crear carrera';
  document.getElementById('cancelEditButton').hidden = true;
}

document.getElementById('cancelEditButton').addEventListener('click', cancelarEdicion);

document.getElementById('carreraForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submitButton = document.getElementById('submitCarreraButton');
  const formData = new FormData(event.currentTarget);
  const carrera = {
    nombre: formData.get('nombre').trim(),
    clave: formData.get('clave').trim(),
  };

  if (!carreraEnEdicion) {
    carrera.numeroSemestres = Number(formData.get('numeroSemestres'));
    carrera.grupos = formData.get('grupos');
  }

  submitButton.disabled = true;

  try {
    await apiRequest(carreraEnEdicion ? `/carreras/${encodeURIComponent(carreraEnEdicion)}` : '/carreras', {
      method: carreraEnEdicion ? 'PATCH' : 'POST',
      body: JSON.stringify(carrera),
    });
    const mensaje = carreraEnEdicion ? 'Carrera actualizada correctamente.' : 'Carrera creada correctamente.';
    cancelarEdicion();
    showMessage(mensaje, 'success');
    loadCarreras();
  } catch (error) {
    showMessage(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

const deleteDialog = document.getElementById('deleteCarreraDialog');
let carreraPendienteEliminar = null;

document.getElementById('carrerasTable').addEventListener('click', event => {
  const editButton = event.target.closest('[data-edit-id]');
  if (editButton) {
    const row = editButton.closest('tr');
    carreraEnEdicion = editButton.dataset.editId;
    mostrarEstructura(false);
    document.getElementById('nombre').value = row.cells[0].textContent.trim();
    document.getElementById('clave').value = row.cells[1].textContent.trim() === 'Sin clave' ? '' : row.cells[1].textContent.trim();
    document.getElementById('formTitle').textContent = 'Editar carrera';
    document.getElementById('formDescription').textContent = 'Actualiza los datos de la carrera seleccionada.';
    document.getElementById('submitCarreraButton').textContent = 'Guardar cambios';
    document.getElementById('cancelEditButton').hidden = false;
    document.getElementById('nombre').focus();
    return;
  }

  const deleteButton = event.target.closest('[data-delete-id]');
  if (!deleteButton) return;
  carreraPendienteEliminar = deleteButton.dataset.deleteId;
  deleteDialog.showModal();
});

function cerrarEliminar() {
  deleteDialog.close();
  carreraPendienteEliminar = null;
}

document.getElementById('cancelDeleteCarreraButton').addEventListener('click', cerrarEliminar);
deleteDialog.addEventListener('cancel', cerrarEliminar);

document.getElementById('confirmDeleteCarreraButton').addEventListener('click', async () => {
  if (!carreraPendienteEliminar) return;
  const confirmButton = document.getElementById('confirmDeleteCarreraButton');
  confirmButton.disabled = true;
  try {
    await apiRequest(`/carreras/${encodeURIComponent(carreraPendienteEliminar)}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false }),
    });
    cerrarEliminar();
    showMessage('Carrera eliminada del catálogo.', 'success');
    loadCarreras();
  } catch (error) {
    showMessage(error.message);
  } finally {
    confirmButton.disabled = false;
  }
});
