document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const payload = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ correo: form.get('email'), password: form.get('password'), role: 'coordinator' }) });
    if (payload.user) localStorage.setItem('coordinator', JSON.stringify(payload.user));
    window.location.href = 'index.html';
  } catch (error) { showMessage(error.message); }
});
