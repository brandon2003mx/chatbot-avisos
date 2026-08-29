const {Bot, ReplyKeyboardBuilder} = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const {FieldValue} = require("firebase-admin/firestore");

const token = process.env.TELEGRAM_BOT_TOKEN;
const projectId = process.env.GCLOUD_PROJECT || "chatbot-de-difusion";

if (!token) {
  throw new Error("Falta TELEGRAM_BOT_TOKEN en functions/.env.");
}

admin.initializeApp({projectId});
const db = admin.firestore();
const sessions = new Map();
const bot = new Bot(token);

const keyboard = new ReplyKeyboardBuilder()
    .text("Registrarme")
    .text("Mi registro")
    .row()
    .text("Cancelar")
    .build({resize_keyboard: true});

function textOf(ctx) {
  return ctx.message?.text?.trim() || "";
}

function chatIdOf(ctx) {
  return ctx.message?.chat?.id;
}

async function startRegistration(ctx) {
  sessions.set(chatIdOf(ctx), {step: "name"});
  await ctx.reply("Escribe tu nombre completo.", {reply_markup: keyboard});
}

bot.command("start", async (ctx) => {
  await ctx.reply("Bienvenido al bot de avisos ITTG. Selecciona Registrarme para recibir avisos.", {reply_markup: keyboard});
});

bot.on("message", async (ctx) => {
  const text = textOf(ctx);
  const chatId = chatIdOf(ctx);
  if (!text || !chatId || text.startsWith("/start")) return;

  if (text === "Cancelar") {
    sessions.delete(chatId);
    await ctx.reply("Registro cancelado.", {reply_markup: keyboard});
    return;
  }

  if (text === "Mi registro") {
    const student = await db.collection("estudiantes").doc(String(chatId)).get();
    if (!student.exists) {
      await ctx.reply("Aún no estás registrado. Selecciona Registrarme.", {reply_markup: keyboard});
      return;
    }
    const data = student.data();
    await ctx.reply(`Registro: ${data.nombre}\n${data.carrera}, semestre ${data.semestre}, grupo ${data.grupo}.`, {reply_markup: keyboard});
    return;
  }

  if (text === "Registrarme") {
    await startRegistration(ctx);
    return;
  }

  const session = sessions.get(chatId);
  if (!session) {
    await ctx.reply("Selecciona Registrarme para comenzar.", {reply_markup: keyboard});
    return;
  }

  if (session.step === "name") {
    session.nombre = text;
    session.step = "career";
    await ctx.reply("Escribe tu carrera exactamente como aparece en el aviso.");
    return;
  }

  if (session.step === "career") {
    session.carrera = text;
    session.step = "semester";
    await ctx.reply("Escribe tu semestre (1 al 9).");
    return;
  }

  if (session.step === "semester") {
    if (!/^[1-9]$/.test(text)) {
      await ctx.reply("El semestre debe ser un número del 1 al 9.");
      return;
    }
    session.semestre = text;
    session.step = "group";
    await ctx.reply("Escribe tu grupo: A, B o C.");
    return;
  }

  if (session.step === "group") {
    const grupo = text.toUpperCase();
    if (!["A", "B", "C"].includes(grupo)) {
      await ctx.reply("El grupo debe ser A, B o C.");
      return;
    }
    await db.collection("estudiantes").doc(String(chatId)).set({
      nombre: session.nombre,
      carrera: session.carrera,
      semestre: session.semestre,
      grupo,
      chatId,
      telegramUsername: ctx.message?.from?.username || "",
      activo: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    sessions.delete(chatId);
    await ctx.reply("Registro completado. Recibirás los avisos que correspondan a tu grupo.", {reply_markup: keyboard});
  }
});

bot.catch((error) => console.error("Error del bot:", error));
console.log("Bot de Telegram listo para recibir actualizaciones.");
bot.startPolling().catch((error) => {
  console.error("No fue posible iniciar el bot:", error);
  process.exit(1);
});
