const admin = require("firebase-admin");
const {FieldValue} = require("firebase-admin/firestore");

const userId = process.argv[2];
const projectId = process.env.GCLOUD_PROJECT || "chatbot-de-difusion";

if (!userId) {
  console.error("Uso: node scripts/crear-administrador.js EL_LOCAL_ID");
  process.exit(1);
}

admin.initializeApp({projectId});

async function createAdministrator() {
  const user = await admin.auth().getUser(userId);
  await admin.firestore().collection("users").doc(userId).set({
    email: user.email,
    displayName: user.displayName || "Administrador",
    role: "admin",
    createdAt: FieldValue.serverTimestamp(),
  }, {merge: true});

  console.log(`Rol admin asignado a ${user.email}.`);
}

createAdministrator().then(() => process.exit(0)).catch((error) => {
  console.error("No fue posible asignar el rol admin:", error.message);
  process.exit(1);
});
