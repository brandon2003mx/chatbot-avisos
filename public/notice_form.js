bindLogout('logoutButton', '/auth/logout', 'login.html');

function showMessage(message, type = 'error') {
  const element = document.getElementById('status');
  if (!element) return;
  element.className = `message ${type}`;
  element.textContent = message;
  element.hidden = false;
}

function saveDraft(form) {
  const payload = {
    title: form.title.value.trim(),
    prioridad: form.prioridad.value,
    carrera: form.carrera.value,
    semestre: form.semestre.value,
    grupo: form.grupo.value,
    content: form.content.value.trim(),
    savedAt: new Date().toISOString(),
  };

  const drafts = JSON.parse(localStorage.getItem('noticeDrafts') || '[]');
  drafts.push(payload);
  localStorage.setItem('noticeDrafts', JSON.stringify(drafts));
  showMessage('Borrador guardado correctamente.', 'success');
}

async function submitNotice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = {
    titulo: form.title.value.trim(),
    prioridad: form.prioridad.value,
    carrera: form.carrera.value || 'General',
    semestre: form.semestre.value || 'General',
    grupo: form.grupo.value || 'General',
    contenido: form.content.value.trim(),
  };

  if (!data.titulo || !data.contenido) {
    showMessage('Completa el título y el mensaje del aviso.');
    return;
  }

  try {
    await apiRequest('/notices', { method: 'POST', body: JSON.stringify(data) });
    showMessage('Aviso enviado correctamente.', 'success');
    form.reset();
  } catch (error) {
    const drafts = JSON.parse(localStorage.getItem('noticeDrafts') || '[]');
    drafts.push({ ...data, savedAt: new Date().toISOString(), fallback: true });
    localStorage.setItem('noticeDrafts', JSON.stringify(drafts));
    showMessage('La API de avisos aún no está disponible; el aviso se guardó como borrador.', 'success');
    form.reset();
  }
}

document.getElementById('noticeForm').addEventListener('submit', submitNotice);
document.getElementById('saveDraftButton').addEventListener('click', () => saveDraft(document.getElementById('noticeForm')));
