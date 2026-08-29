document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await firebase.auth().signInWithEmailAndPassword(form.get('email'), form.get('password'));
    window.location.href = 'index.html';
  } catch (error) { showMessage(error.message); }
});
