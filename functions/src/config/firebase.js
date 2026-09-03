const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

/**
 * Determina si es seguro inicializar Firestore sin exigir
 * FIRESTORE_EMULATOR_HOST: o bien es un despliegue real de Cloud
 * Functions (Cloud Run), o bien es la propia CLI de Firebase
 * inspeccionando el código sin llegar a ejecutar lógica de negocio.
 *
 * Cloud Run (y por lo tanto Cloud Functions 2nd gen ya desplegadas)
 * define K_SERVICE en tiempo de ejecución. El Emulador de Functions
 * también lo simula para que el código local se comporte igual,
 * pero además define FUNCTIONS_EMULATOR="true", algo que un
 * despliegue real nunca hace. Por eso solo la combinación de ambas
 * señales identifica un entorno desplegado de forma confiable.
 *
 * Además, tanto `firebase deploy` como el descubrimiento inicial de
 * `firebase emulators:start` lanzan un subproceso aparte, con
 * FUNCTIONS_CONTROL_API="true", que solo carga el código para leer
 * los metadatos de cada función exportada (nunca sirve peticiones
 * reales ni ejecuta lógica de negocio) — ese subproceso nunca
 * inherita el entorno del shell y por eso no puede depender de
 * FIRESTORE_EMULATOR_HOST. El proceso que sí sirve peticiones reales
 * del emulador sigue usando únicamente FUNCTIONS_EMULATOR, así que
 * esta señal no debilita esa protección.
 *
 * @return {boolean}
 */
function esEntornoDesplegado() {
  if (
    Boolean(process.env.K_SERVICE) &&
    process.env.FUNCTIONS_EMULATOR !== "true"
  ) {
    return true;
  }

  if (process.env.FUNCTIONS_CONTROL_API === "true") {
    return true;
  }

  return false;
}

if (!esEntornoDesplegado() && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "ERROR: Firestore Emulator no está configurado.\n" +
      "Por seguridad, esta ejecución local no puede conectarse a " +
      "Firestore de producción.\n" +
      "Configura FIRESTORE_EMULATOR_HOST (por ejemplo, iniciando el " +
      "Firestore Emulator con `firebase emulators:start --only " +
      "firestore` o `--only functions,firestore`) antes de ejecutar " +
      "este código localmente.",
  );
}

initializeApp({
  projectId: "chatbot-de-difusion",
});

const db = getFirestore();

module.exports = {
  db,
};
