// El script /__/firebase/init.js (servido automáticamente por Firebase Hosting
// y por el Hosting Emulator) ya llamó a firebase.initializeApp() con el config
// real del proyecto antes de que este archivo se ejecute.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  firebase.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
}

let resolveAuthReady;
const authReady = new Promise(resolve => { resolveAuthReady = resolve; });
firebase.auth().onAuthStateChanged(user => resolveAuthReady(user));

function requireCoordinador(redirect) {
  authReady.then(user => { if (!user) window.location.href = redirect; });
}
