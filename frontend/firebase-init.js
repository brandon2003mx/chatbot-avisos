// apiKey/authDomain son placeholders válidos: el Auth emulator no los valida, solo projectId debe coincidir con .firebaserc.
firebase.initializeApp({
  apiKey: 'demo-api-key',
  authDomain: 'chatbot-de-difusion.firebaseapp.com',
  projectId: 'chatbot-de-difusion',
});

if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  firebase.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
}

let resolveAuthReady;
const authReady = new Promise(resolve => { resolveAuthReady = resolve; });
firebase.auth().onAuthStateChanged(user => resolveAuthReady(user));

function requireCoordinador(redirect) {
  authReady.then(user => { if (!user) window.location.href = redirect; });
}
