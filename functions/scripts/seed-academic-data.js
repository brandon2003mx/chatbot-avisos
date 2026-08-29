const admin = require("firebase-admin");
const {FieldValue} = require("firebase-admin/firestore");

const projectId = process.env.GCLOUD_PROJECT || "chatbot-de-difusion";

admin.initializeApp({projectId});

const db = admin.firestore();

async function seedAcademicData() {
  await db.collection("config").doc("academicData").set({
    carreras: ["Ingeniería en Sistemas", "Ingeniería Industrial", "Administración"],
    semestres: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    grupos: ["A", "B", "C"],
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});

  console.log("Datos académicos creados correctamente.");
}

seedAcademicData().then(() => process.exit(0)).catch((error) => {
  console.error("No fue posible crear los datos académicos:", error.message);
  process.exit(1);
});
