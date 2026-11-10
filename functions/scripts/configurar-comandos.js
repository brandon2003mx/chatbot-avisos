const fs = require("fs");

const {Api} = require("node-telegram-bot-api");

/**
 * Comandos que aparecen en el menú del bot.
 *
 * `setMyCommands` reemplaza la lista completa (incluida la que se
 * haya configurado a mano en BotFather), así que aquí deben estar
 * TODOS los comandos, no solo los nuevos.
 *
 * @type {Array<{command: string, description: string}>}
 */
const COMANDOS = [
  {command: "info", description: "Mostrar mi información"},
  {command: "registro", description: "Modificar mi información"},
  {
    command: "pendientes_lectura",
    description: "Avisos sin confirmar lectura",
  },
  {command: "eventos", description: "Próximos eventos"},
];

/**
 * Obtiene el token del bot que se va a configurar.
 *
 * Si TELEGRAM_BOT_TOKEN ya viene en el entorno, se usa ese. Así se
 * configura el bot de producción sin copiar su token a ningún
 * archivo:
 *
 *   TELEGRAM_BOT_TOKEN="$(firebase functions:secrets:access \
 *     TELEGRAM_BOT_TOKEN)" npm run telegram:comandos
 *
 * Si no, se lee de functions/.secret.local, igual que
 * scripts/telegram-dev.js; ese token es el del bot de desarrollo.
 */
function cargarVariablesEntorno() {
  if (process.env.TELEGRAM_BOT_TOKEN) {
    return;
  }

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

/**
 * Muestra el menú actual del bot y lo reemplaza por COMANDOS.
 *
 * @return {Promise<void>}
 */
async function configurarComandos() {
  cargarVariablesEntorno();

  const api = new Api(process.env.TELEGRAM_BOT_TOKEN);

  const bot = await api.getMe();
  const anteriores = await api.getMyCommands();

  console.log(`Bot: @${bot.username}`);
  console.log("Comandos actuales:");

  for (const comando of anteriores) {
    console.log(`  /${comando.command} — ${comando.description}`);
  }

  await api.setMyCommands({commands: COMANDOS});

  console.log("Comandos nuevos:");

  for (const comando of COMANDOS) {
    console.log(`  /${comando.command} — ${comando.description}`);
  }
}

configurarComandos()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Error configurando los comandos:", error);
      process.exit(1);
    });
