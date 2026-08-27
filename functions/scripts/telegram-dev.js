const fs = require("fs");

/**
 * Carga TELEGRAM_BOT_TOKEN desde functions/.env.
 */
function cargarVariablesEntorno() {
  const contenido = fs.readFileSync(".env", "utf8");

  const coincidencia = contenido.match(
      /^TELEGRAM_BOT_TOKEN=(.*)$/m,
  );

  if (!coincidencia || !coincidencia[1]) {
    throw new Error(
        "No se encontró TELEGRAM_BOT_TOKEN en functions/.env.",
    );
  }

  process.env.TELEGRAM_BOT_TOKEN = coincidencia[1].trim();
}

cargarVariablesEntorno();

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
