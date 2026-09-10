// El script /__/firebase/init.js (servido automáticamente por Firebase Hosting
// y por el Hosting Emulator) ya llamó a firebase.initializeApp() con el config
// real del proyecto antes de que este archivo se ejecute.
const esEntornoLocal =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1';

// El emulador de Hosting sí sirve /__/firebase/init.js, que ya llamó a
// initializeApp con la config real. Volver a llamarlo con opciones
// distintas lanza app/duplicate-app y tumba el resto del script, así que
// solo se inicializa cuando no hay app previa (por ejemplo, al abrir los
// archivos con un servidor estático que no sirve esa ruta).
const firebaseApp = firebase.apps.length ?
  firebase.app() :
  firebase.initializeApp({
    apiKey: 'fake-api-key',
    projectId: 'chatbot-de-difusion',
  });

if (esEntornoLocal) {
  firebase.auth(firebaseApp).useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
}

let resolveAuthReady;
const authReady = new Promise(resolve => { resolveAuthReady = resolve; });
firebase.auth(firebaseApp).onAuthStateChanged(user => resolveAuthReady(user));

function requireCoordinador(redirect) {
  authReady.then(user => { if (!user) window.location.href = redirect; });
}
