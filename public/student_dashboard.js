const student = JSON.parse(localStorage.getItem('student') || '{}');
document.getElementById('studentInfo').innerHTML = `Estudiante: ${escapeHtml(student.nombre || 'Sesión activa')}<br>${escapeHtml(student.correo || '')}`;
document.getElementById('audienceText').textContent = `Avisos para ${student.carrera || 'tu carrera'}, semestre ${student.semestre || '-'}, grupo ${student.grupo || '-'}.`;
bindLogout('logoutButton', '/auth/student/logout', 'student_login.html');

function renderNotices(notices) {
  const list = document.getElementById('noticesList');
  const read = notices.filter(notice => notice.status === 'read').length;
  document.getElementById('totalCount').textContent = notices.length;
  document.getElementById('readCount').textContent = read;
  document.getElementById('pendingCount').textContent = notices.length - read;
  if (!notices.length) { list.innerHTML = '<div class="empty-state visible"><strong>No hay avisos para ti en este momento.</strong><span>Te notificaremos cuando haya nuevos avisos.</span></div>'; return; }
  list.innerHTML = notices.map(notice => { const isRead = notice.status === 'read'; return `<article class="notice-card ${isRead ? 'read' : 'unread'}"><div class="notice-header"><div><h3>${escapeHtml(notice.titulo || notice.title || 'Aviso institucional')}</h3><span class="notice-date">${formatDate(notice.created_at || notice.createdAt)}</span></div><span class="notice-badge ${isRead ? 'read' : 'unread'}">${isRead ? 'Leído' : 'Pendiente'}</span></div><div class="notice-content">${escapeHtml(notice.mensaje || notice.message || '')}</div><button class="primary-button notice-button" data-recipient-id="${escapeHtml(notice.recipient_id || '')}" ${isRead ? 'disabled' : ''}>${isRead ? 'Leído' : 'Marcar como leído'}</button></article>`; }).join('');
  list.querySelectorAll('[data-recipient-id]').forEach(button => button.addEventListener('click', () => markRead(button.dataset.recipientId)));
}
function formatDate(value) { return value ? new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Fecha pendiente'; }
async function markRead(recipientId) { if (!recipientId) return showMessage('El aviso todavía no tiene un destinatario asociado.', 'error'); try { await apiRequest('/student/notices/mark-read', { method: 'POST', body: JSON.stringify({ recipient_id: recipientId }) }); loadNotices(); } catch (error) { showMessage(error.message); } }
async function loadNotices() { try { const payload = await apiRequest('/student/notices'); renderNotices(payload.data || payload.notices || []); } catch (error) { renderNotices([]); showMessage('La API de avisos aún no está disponible.'); } }
loadNotices();
