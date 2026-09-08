// El script /__/firebase/init.js (servido automáticamente por Firebase Hosting
// y por el Hosting Emulator) ya llamó a firebase.initializeApp() con el config
// real del proyecto antes de que este archivo se ejecute.
const esEntornoLocal =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1';

const firebaseApp = esEntornoLocal ?
  firebase.initializeApp({
    apiKey: 'fake-api-key',
    projectId: 'chatbot-de-difusion',
  }) :
  firebase.app();

if (esEntornoLocal) {
  firebase.auth(firebaseApp).useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
}

let resolveAuthReady;
const authReady = new Promise(resolve => { resolveAuthReady = resolve; });
firebase.auth(firebaseApp).onAuthStateChanged(user => resolveAuthReady(user));

function requireCoordinador(redirect) {
  authReady.then(user => { if (!user) window.location.href = redirect; });
}
