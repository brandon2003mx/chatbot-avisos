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

// Los grupos son letras consecutivas (3 = A, B, C); el texto de apoyo
// muestra cuáles van a quedar conforme se cambia la cantidad.
function actualizarVistaGrupos() {
  const cantidad = Number(document.getElementById('numeroGrupos').value);
  const preview = document.getElementById('gruposPreview');
  const verbo = carreraEnEdicion ? 'quedarán' : 'se crearán';

  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) {
    preview.textContent = 'Indica entre 1 y 10 grupos.';
    return;
  }

  const letras = Array.from({ length: cantidad }, (_, indice) => String.fromCharCode(65 + indice));
  const frase = cantidad === 1
    ? `${verbo === 'quedarán' ? 'Quedará' : 'Se creará'} el grupo A.`
    : `${verbo === 'quedarán' ? 'Quedarán' : 'Se crearán'} los grupos ${letras.slice(0, -1).join(', ')} y ${letras.at(-1)}.`;

  preview.textContent = carreraEnEdicion
    ? `${frase} Los que sobren dejarán de estar disponibles.`
    : frase;
}

// Al editar, los campos arrancan con lo que la carrera tiene hoy, para
// que guardar sin tocarlos no cambie nada. Si la lectura falla, la
// bandera queda en false y el formulario no manda la estructura: con
// los valores por defecto en pantalla, guardar la reescribiría sin que
// el usuario lo haya pedido.
let estructuraCargada = false;

async function cargarEstructuraActual(carreraId) {
  const semestresInput = document.getElementById('numeroSemestres');
  const gruposInput = document.getElementById('numeroGrupos');

  estructuraCargada = false;

  try {
    const { semestres } = await apiRequest(`/carreras/${encodeURIComponent(carreraId)}/semestres`);
    semestresInput.value = semestres.length;

    if (!semestres.length) {
      actualizarVistaGrupos();
      return;
    }

    const primero = semestres
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id))[0];
    const { grupos } = await apiRequest(
      `/carreras/${encodeURIComponent(carreraId)}/semestres/${encodeURIComponent(primero.id)}/grupos`
    );
    gruposInput.value = grupos.length;
    estructuraCargada = true;
  } catch (error) {
    showMessage(`No fue posible leer la estructura actual: ${error.message}`);
  } finally {
    actualizarVistaGrupos();
  }
}

document.getElementById('numeroGrupos').addEventListener('input', actualizarVistaGrupos);

function cancelarEdicion() {
  carreraEnEdicion = null;
  document.getElementById('carreraForm').reset();
  actualizarVistaGrupos();
  document.getElementById('formTitle').textContent = 'Registrar carrera';
  document.getElementById('formDescription').textContent = 'Agrega las carreras disponibles para segmentar los avisos institucionales.';
  document.getElementById('submitCarreraButton').textContent = 'Crear carrera';
  document.getElementById('cancelEditButton').hidden = true;
}

document.getElementById('cancelEditButton').addEventListener('click', cancelarEdicion);

// Lo que se quita no se borra, solo se desactiva; conviene decirlo
// para que no parezca que se perdieron los datos.
function resumenEstructura(estructura) {
  if (!estructura) return '';

  const partes = [];

  if (estructura.semestresDesactivados) {
    partes.push(`${estructura.semestresDesactivados} semestre(s)`);
  }

  if (estructura.gruposDesactivados) {
    partes.push(`${estructura.gruposDesactivados} grupo(s)`);
  }

  return partes.length
    ? ` Se desactivaron ${partes.join(' y ')}: dejan de aparecer en el bot, pero no se borraron.`
    : '';
}

document.getElementById('carreraForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submitButton = document.getElementById('submitCarreraButton');
  const formData = new FormData(event.currentTarget);
  const carrera = {
    nombre: formData.get('nombre').trim(),
    clave: formData.get('clave').trim(),
  };

  if (!carreraEnEdicion || estructuraCargada) {
    carrera.numeroSemestres = Number(formData.get('numeroSemestres'));
    carrera.numeroGrupos = Number(formData.get('numeroGrupos'));
  }

  submitButton.disabled = true;

  try {
    const respuesta = await apiRequest(carreraEnEdicion ? `/carreras/${encodeURIComponent(carreraEnEdicion)}` : '/carreras', {
      method: carreraEnEdicion ? 'PATCH' : 'POST',
      body: JSON.stringify(carrera),
    });
    const mensaje = carreraEnEdicion
      ? `Carrera actualizada correctamente.${resumenEstructura(respuesta.estructura)}`
      : 'Carrera creada correctamente.';
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
    document.getElementById('nombre').value = row.cells[0].textContent.trim();
    document.getElementById('clave').value = row.cells[1].textContent.trim() === 'Sin clave' ? '' : row.cells[1].textContent.trim();
    cargarEstructuraActual(carreraEnEdicion);
    document.getElementById('formTitle').textContent = 'Editar carrera';
    document.getElementById('formDescription').textContent = 'Actualiza los datos de la carrera seleccionada. Si reduces semestres o grupos, los estudiantes que ya estén ahí dejan de recibir avisos segmentados.';
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
