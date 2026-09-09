requireCoordinador('login.html');
bindLogout('logoutButton', 'login.html');

authReady.then(user => {
  if (!user) return;
  mostrarRolUsuario('coordinator', user.email);
  loadEstudiantes();
});

function renderEstudiantes(estudiantes) {
  const tbody = document.getElementById('estudiantesTable');

  if (!estudiantes.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Aún no hay estudiantes registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = estudiantes.map(estudiante => `<tr>
    <td>${escapeHtml(estudiante.numControl)}</td>
    <td><strong>${escapeHtml(estudiante.nombre)}</strong></td>
    <td>${escapeHtml(estudiante.carrera)}</td>
    <td>${escapeHtml(estudiante.correo)}</td>
    <td>${escapeHtml(estudiante.semestre)}</td>
    <td>${escapeHtml(estudiante.grupo)}</td>
  </tr>`).join('');
}

async function loadEstudiantes() {
  try {
    const { estudiantes } = await apiRequest('/estudiantes');
    renderEstudiantes(estudiantes);
  } catch (error) {
    document.getElementById('estudiantesTable').innerHTML = '<tr><td colspan="6" class="table-empty">No fue posible cargar los estudiantes.</td></tr>';
    showMessage(error.message);
  }
}

document.getElementById('refreshEstudiantesButton').addEventListener('click', loadEstudiantes);
