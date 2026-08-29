const admin = require("firebase-admin");
const path = require("path");

// Conecta a los emuladores locales
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

// Inicializa Firebase Admin
admin.initializeApp({
  projectId: "chatbot-de-difusion",
});

const db = admin.firestore();
const auth = admin.auth();

async function seedData() {
  try {
    console.log("🌱 Iniciando seed de datos...\n");

    // 1. Crear datos académicos
    console.log("📚 Creando datos académicos...");
    const carreras = ["Ingeniería en Sistemas", "Ingeniería Industrial", "Administración"];
    const semestres = ["1", "2", "3", "4", "5", "6", "7", "8"];
    const grupos = ["A", "B", "C", "D"];

    // Crear referencia de configuración
    const configRef = db.collection("config").doc("academicData");
    await configRef.set({
      carreras,
      semestres,
      grupos,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("✅ Datos académicos creados");

    // 2. Crear usuario admin
    console.log("\n👤 Creando usuario admin...");
    const adminEmail = "admin@chatbot.local";
    const adminPassword = "Admin123456!";

    let adminUser;
    try {
      adminUser = await auth.getUserByEmail(adminEmail);
      console.log("⚠️  Usuario admin ya existe:", adminEmail);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        adminUser = await auth.createUser({
          email: adminEmail,
          password: adminPassword,
          displayName: "Administrador",
          emailVerified: true,
        });
        console.log("✅ Usuario admin creado");
        console.log("   Email:", adminEmail);
        console.log("   Contraseña:", adminPassword);
      } else {
        throw error;
      }
    }

    // 3. Crear documento de rol en Firestore
    console.log("\n🔐 Asignando rol de admin...");
    await db.collection("users").doc(adminUser.uid).set({
      email: adminEmail,
      displayName: "Administrador",
      role: "admin",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("✅ Rol de admin asignado a:", adminEmail);

    // 4. Crear algunos avisos de ejemplo
    console.log("\n📢 Creando avisos de ejemplo...");
    const noticesRef = db.collection("avisos");
    
    const exampleNotices = [
      {
        title: "Bienvenida al Sistema",
        message: "Bienvenido al sistema de avisos. Este es un aviso de prueba.",
        priority: "normal",
        carreras: ["Ingeniería en Sistemas"],
        semestres: ["1", "2"],
        grupos: ["A", "B"],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: adminUser.uid,
      },
      {
        title: "Cambio de Horario",
        message: "Las clases del próximo lunes serán a las 8:00 AM.",
        priority: "high",
        carreras: ["Ingeniería Industrial"],
        semestres: ["3", "4"],
        grupos: ["A"],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: adminUser.uid,
      },
    ];

    for (const notice of exampleNotices) {
      await noticesRef.add(notice);
    }
    console.log("✅", exampleNotices.length, "avisos de ejemplo creados");

    console.log("\n✨ ¡Seed completado exitosamente!");
    console.log("\n📝 Credenciales para login:");
    console.log("   Email: " + adminEmail);
    console.log("   Contraseña: " + adminPassword);
    console.log("\n🌐 Accede a: http://127.0.0.1:5000/login.html");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error durante seed:", error.message);
    process.exit(1);
  }
}

// Ejecutar seed
seedData();
