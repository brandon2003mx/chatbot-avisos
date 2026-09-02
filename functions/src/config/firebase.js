const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

/**
 * Determina si el proceso corre en un despliegue real de Cloud
 * Functions (Cloud Run) y no en el Emulador de Functions.
 *
 * Cloud Run (y por lo tanto Cloud Functions 2nd gen ya desplegadas)
 * define K_SERVICE en tiempo de ejecución. El Emulador de Functions
 * también lo simula para que el código local se comporte igual,
 * pero además define FUNCTIONS_EMULATOR="true", algo que un
 * despliegue real nunca hace. Por eso solo la combinación de ambas
 * señales identifica un entorno desplegado de forma confiable.
 *
 * @return {boolean}
 */
function esEntornoDesplegado() {
  return (
    Boolean(process.env.K_SERVICE) &&
    process.env.FUNCTIONS_EMULATOR !== "true"
  );
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
