const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const admin = require("firebase-admin");
const {db} = require("./src/config/firebase");
const {getUpdates, enviarAvisoAEstudiantes} = require("./src/services/telegramService");
const { FieldValue } = require("firebase-admin/firestore");

if (process.env.FUNCTIONS_EMULATOR && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
}

setGlobalOptions({
  maxInstances: 10,
});

// Inicializa Firebase Admin si no está ya inicializado
if (!admin.apps.length) {
  admin.initializeApp();
}

const auth = admin.auth();

// Middleware para validar token
async function authenticateToken(req) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new Error("No token provided");
  try {
    return await auth.verifyIdToken(token);
  } catch (error) {
    throw new Error("Invalid token");
  }
}

// ENDPOINT: Login
async function handleLogin(req, res) {
  try {
    const {correo, password} = req.body;
    if (!correo || !password) {
      return res.status(400).json({ok: false, error: "Email y password son requeridos"});
    }

    // Intenta autenticarse con Firebase Auth
    const {IdTokenResult} = await auth.getUserByEmail(correo).then(async (user) => {
      // Genera un token personalizado
      const customToken = await auth.createCustomToken(user.uid);
      return {user, customToken, IdTokenResult: {uid: user.uid}};
    }).catch(() => {
      throw new Error("Usuario no encontrado");
    });

    // Obtiene información del usuario desde Firestore
    const userDoc = await db.collection("users").doc(IdTokenResult.uid).get();
    const userData = userDoc.data() || {};

    return res.status(200).json({
      ok: true,
      user: {
        uid: IdTokenResult.uid,
        email: correo,
        ...userData,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(401).json({ok: false, error: error.message});
  }
}

// ENDPOINT: Dashboard
async function handleDashboard(req, res) {
  try {
    // Obtiene datos académicos
    const configDoc = await db.collection("config").doc("academicData").get();
    const academicData = configDoc.data() || {};

    // Obtiene avisos
    const noticesSnapshot = await db.collection("avisos").orderBy("createdAt", "desc").limit(5).get();
    const avisos = noticesSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));

    // Obtiene estadísticas básicas
    const estudiantesSnapshot = await db.collection("estudiantes").get();
    const avisosSnapshot = await db.collection("avisos").get();
    const readsSnapshot = await db.collectionGroup("lecturas").get();
    const totalRecipients = readsSnapshot.size;
    const totalReads = readsSnapshot.docs.filter((doc) =>
      doc.data().status === "read"
    ).length;

    return res.status(200).json({
      ok: true,
      dashboard: {
        metrics: {
          total_notices: avisosSnapshot.size,
          total_students: estudiantesSnapshot.size,
          total_recipients: totalRecipients,
          total_reads: totalReads,
        },
        topNotices: avisos,
        ...academicData,
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json({ok: false, error: error.message});
  }
}

// ENDPOINT: Crear aviso
async function handleCreateNotice(req, res) {
  try {
    const {titulo, contenido, title, message, priority, prioridad, carrera, carreras, semestre, semestres, grupo, grupos} = req.body;
    
    console.log("📝 Creando aviso con datos:", req.body);
    
    // Acepta tanto nombres en español como en inglés
    const titleToUse = titulo || title;
    const messageToUse = contenido || message;
    const priorityToUse = prioridad || priority || "Media";
    
    if (!titleToUse || !messageToUse) {
      console.error("❌ Faltan title o message");
      return res.status(400).json({ok: false, error: "Título y mensaje son requeridos"});
    }

    const noticeData = {
      title: titleToUse,
      message: messageToUse,
      titulo: titleToUse,
      contenido: messageToUse,
      priority: priorityToUse,
      prioridad: priorityToUse,
      carreras: carreras || (carrera ? [carrera] : []),
      carrera: carrera || "",
      semestres: semestres || (semestre ? [semestre] : []),
      semestre: semestre || "",
      grupos: grupos || (grupo ? [grupo] : []),
      grupo: grupo || "",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.userId || "anonymous",
    };

    Object.keys(noticeData).forEach((key) => {
      if (noticeData[key] === undefined || noticeData[key] === null) {
        delete noticeData[key];
      }
    });

    console.log("💾 Guardando en Firestore:", noticeData.title);
    const docRef = await db.collection("avisos").add(noticeData);
    console.log("✅ Aviso creado con ID:", docRef.id);

    let deliveredTo = 0;
    try {
      deliveredTo = await enviarAvisoAEstudiantes(noticeData, docRef.id);
    } catch (deliveryError) {
      console.error("No fue posible enviar el aviso por Telegram:", deliveryError);
    }
    
    return res.status(201).json({ok: true, id: docRef.id, deliveredTo, message: "Aviso creado exitosamente"});
  } catch (error) {
    console.error("❌ Create notice error:", error);
    return res.status(500).json({ok: false, error: error.message});
  }
}

// ENDPOINT: Obtener avisos
async function handleGetNotices(req, res) {
  try {
    const snapshot = await db.collection("avisos").orderBy("createdAt", "desc").get();
    const notices = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    return res.status(200).json({ok: true, notices});
  } catch (error) {
    console.error("Get notices error:", error);
    return res.status(500).json({ok: false, error: error.message});
  }
}

// ENDPOINT: Editar aviso
async function handleUpdateNotice(req, res, noticeId) {
  try {
    const {titulo, contenido, prioridad, carrera, semestre, grupo} = req.body;
    if (!titulo || !contenido) {
      return res.status(400).json({ok: false, error: "Título y mensaje son requeridos"});
    }

    await db.collection("avisos").doc(noticeId).update({
      title: titulo,
      message: contenido,
      titulo,
      contenido,
      priority: prioridad || "Media",
      prioridad: prioridad || "Media",
      carrera: carrera || "",
      carreras: carrera ? [carrera] : [],
      semestre: semestre || "",
      semestres: semestre ? [semestre] : [],
      grupo: grupo || "",
      grupos: grupo ? [grupo] : [],
    });
    return res.status(200).json({ok: true, id: noticeId});
  } catch (error) {
    console.error("Update notice error:", error);
    return res.status(500).json({ok: false, error: error.message});
  }
}

// ENDPOINT: Eliminar aviso
async function handleDeleteNotice(req, res, noticeId) {
  try {
    await db.collection("avisos").doc(noticeId).delete();
    return res.status(200).json({ok: true, id: noticeId});
  } catch (error) {
    console.error("Delete notice error:", error);
    return res.status(500).json({ok: false, error: error.message});
  }
}

// ENDPOINT: Obtener estudiantes
async function handleGetStudents(req, res) {
  try {
    const snapshot = await db.collection("estudiantes").get();
    const students = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
    return res.status(200).json({ok: true, data: students, students});
  } catch (error) {
    console.error("Get students error:", error);
    return res.status(500).json({ok: false, error: error.message});
  }
}

// ENDPOINT: Crear estudiante
async function handleCreateStudent(req, res) {
  try {
    const {nombre, correo, carrera, semestre, grupo} = req.body;
    if (!nombre || !correo) {
      return res.status(400).json({ok: false, error: "Nombre y correo son requeridos"});
    }

    const studentData = {
      nombre,
      correo,
      carrera: carrera || "",
      semestre: semestre || "",
      grupo: grupo || "",
      createdAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection("estudiantes").add(studentData);
    return res.status(201).json({ok: true, id: docRef.id});
  } catch (error) {
    console.error("Create student error:", error);
    return res.status(500).json({ok: false, error: error.message});
  }
}

// Router principal
exports.api = onRequest(async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).send("");
  }

  // Normaliza la ruta que llega desde Hosting / Functions emulator
  const rawPath = req.path || req.originalUrl || req.url || "/";
  const cleanPath = rawPath.split("?")[0];
  let path = cleanPath;
  const apiIndex = cleanPath.lastIndexOf("/api");

  if (apiIndex !== -1) {
    path = cleanPath.slice(apiIndex + "/api".length) || "/";
  }

  console.log("🧭 PATH raw:", rawPath, "normalized:", path);

  try {
    // Rutas de autenticación
    if (path === "/auth/login" && req.method === "POST") {
      return handleLogin(req, res);
    }

    if (path === "/auth/logout" && req.method === "POST") {
      return res.status(200).json({ok: true});
    }

    // Rutas protegidas (comentadas por ahora)
    // const decodedToken = await authenticateToken(req);
    // req.userId = decodedToken.uid;

    // Rutas del dashboard
    if (path === "/dashboard" && req.method === "GET") {
      return handleDashboard(req, res);
    }

    // Rutas de avisos
    if (path === "/notices" && req.method === "GET") {
      return handleGetNotices(req, res);
    }

    if (path === "/notices" && req.method === "POST") {
      return handleCreateNotice(req, res);
    }

    const noticeMatch = path.match(/^\/notices\/([^/]+)$/);
    if (noticeMatch && req.method === "PATCH") {
      return handleUpdateNotice(req, res, noticeMatch[1]);
    }

    if (noticeMatch && req.method === "DELETE") {
      return handleDeleteNotice(req, res, noticeMatch[1]);
    }

    // Rutas de estudiantes
    if (path === "/students" && req.method === "GET") {
      return handleGetStudents(req, res);
    }

    if (path === "/students" && req.method === "POST") {
      return handleCreateStudent(req, res);
    }

    // Ruta por defecto
    return res.status(200).json({
      ok: true,
      mensaje: "Backend del Chatbot de Difusión ITTG funcionando",
    });
  } catch (error) {
    console.error("API error:", error);
    return res.status(500).json({ok: false, error: error.message});
  }
});

exports.telegramUpdates = onRequest(async (req, res) => {
  try {
    const updates = await getUpdates();

    res.status(200).json({
      ok: true,
      updates,
    });
  } catch (error) {
    console.error("Error obteniendo actualizaciones de Telegram:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});
