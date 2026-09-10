const fs = require("fs");

/**
 * Carga TELEGRAM_BOT_TOKEN desde functions/.secret.local (nunca
 * desde .env: ese archivo sí se empaqueta y se despliega como
 * variable de entorno normal en `firebase deploy`, lo que choca
 * con el secreto real de Secret Manager del mismo nombre.
 * .secret.local es exclusivamente para el Emulador de Functions y
 * scripts locales como este; `firebase deploy` nunca lo toca).
 */
function cargarVariablesEntorno() {
  const contenido = fs.readFileSync(".secret.local", "utf8");

  for (const linea of contenido.split("\n")) {
    const coincidencia = linea.trim().match(/^([A-Z0-9_]+)=(.*)$/);

    if (coincidencia) {
      process.env[coincidencia[1]] = coincidencia[2].trim();
    }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error(
        "No se encontró TELEGRAM_BOT_TOKEN en functions/.secret.local.",
    );
  }
}

cargarVariablesEntorno();

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}

const {
  Api,
  longPoll,
} = require("node-telegram-bot-api");

const {
  procesarActualizacion,
} = require("../src/services/registro/telegramRegistroService");

/**
 * Ejecuta el bot en modo desarrollo mediante long polling.
 *
 * @return {Promise<void>}
 */
async function iniciar() {
  const api = new Api(process.env.TELEGRAM_BOT_TOKEN);
  const abortController = new AbortController();

  console.log("🤖 Bot de Telegram en modo desarrollo.");
  console.log("📡 Escuchando actualizaciones con long polling.");
  console.log("⛔ Presiona Ctrl+C para detenerlo.");

  process.on("SIGINT", () => {
    console.log("\nDeteniendo bot...");
    abortController.abort();
  });

  process.on("SIGTERM", () => {
    console.log("\nDeteniendo bot...");
    abortController.abort();
  });

  try {
    for await (
      const update of longPoll(
          api,
          {
            timeout: 30,
          },
          abortController.signal,
      )
    ) {
      console.log(
          `📩 Actualización recibida: ${update.update_id}`,
      );

      try {
        await procesarActualizacion(update);

        console.log(
            `✅ Actualización procesada: ${update.update_id}`,
        );
      } catch (error) {
        console.error(
            `❌ Error procesando ${update.update_id}:`,
            error,
        );
      }
    }
  } catch (error) {
    if (error.name === "AbortError") {
      console.log("Bot detenido correctamente.");
      return;
    }

    throw error;
  }
}

iniciar().catch((error) => {
  console.error("Error iniciando bot:", error);
  process.exit(1);
});
