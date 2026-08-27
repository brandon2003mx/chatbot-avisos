const registration = new URLSearchParams(location.search).get('register') === 'true';
const registrationFields = document.getElementById('registrationFields');
if (registration) {
  registrationFields.hidden = false;
  document.getElementById('formTitle').textContent = 'Registro de Estudiante';
  document.getElementById('formDescription').textContent = 'Crea tu cuenta para recibir avisos de tu carrera.';
  document.getElementById('submitButton').textContent = 'Registrarse';
  document.getElementById('toggleText').textContent = '¿Ya tienes cuenta?';
  document.getElementById('toggleMode').textContent = 'Inicia sesión aquí';
  document.getElementById('toggleMode').href = 'student_login.html';
  populateSelect('carrera', ['Ingeniería en Sistemas Computacionales', 'Ingeniería Industrial', 'Ingeniería Electrónica']);
  populateSelect('semestre', ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  populateSelect('grupo', ['A', 'B', 'C']);
}
document.getElementById('studentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = { correo: form.get('email'), password: form.get('password') };
  const path = registration ? '/auth/student/register' : '/auth/student/login';
  if (registration) Object.assign(data, { nombre: form.get('nombre'), carrera: form.get('carrera'), semestre: form.get('semestre'), grupo: form.get('grupo') });
  if (registration && data.password !== form.get('confirmPassword')) return showMessage('Las contraseñas no coinciden.');
  try {
    const payload = await apiRequest(path, { method: 'POST', body: JSON.stringify(data) });
    if (payload.student) localStorage.setItem('student', JSON.stringify(payload.student));
    window.location.href = registration ? 'student_login.html' : 'student_dashboard.html';
  } catch (error) { showMessage(error.message); }
});
