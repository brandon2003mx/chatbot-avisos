# Canal de Difusión Inteligente vía Chatbot de Telegram — ITTG

Sistema de difusión de avisos institucionales para el Instituto Tecnológico de Tuxtla Gutiérrez. El personal crea avisos segmentados desde un panel web, y los estudiantes se registran, reciben los avisos y confirman su lectura mediante un bot de Telegram.

Proyecto de Residencia Profesional 2601-13 (agosto-diciembre 2026).

## Funcionalidades

**Panel web (coordinador y administrador)**

- Inicio de sesión con Firebase Authentication y acceso según el rol (`administrador` o `coordinador`).
- Redacción de avisos con título, mensaje, imagen opcional y, si anuncian un evento, su fecha y hora.
- Segmentación por todos los estudiantes, carrera, semestre o grupo.
- Gestión de avisos: seguimiento del envío (destinatarios, enviados, lecturas confirmadas y errores), filtros, corrección mediante un aviso nuevo y eliminación.
- Panel de inicio con indicadores y gráficas.
- Solo el administrador: catálogo de carreras (semestres y grupos) y consulta de estudiantes registrados.

**Bot de Telegram (estudiante)**

- Registro con verificación del correo institucional mediante un código de seis dígitos.
- Recepción de avisos (como foto si llevan imagen) con el botón **Confirmar lectura**.
- Comandos `/info`, `/registro`, `/pendientes_lectura` y `/eventos`.

**Envío**

- Envío asíncrono en lotes de 50 destinatarios mediante Cloud Tasks, con reintentos automáticos, sin duplicar entregas y con control de idempotencia.

Telegram no avisa a los bots cuándo una persona abre un mensaje; por eso una lectura solo se registra cuando el estudiante pulsa **Confirmar lectura**.

## Arquitectura

| Componente | Responsabilidad |
| --- | --- |
| Firebase Hosting | Publica el panel (`frontend/`) y redirige `/api/**` a la función `api`. |
| Cloud Functions (Node.js 24, 2.ª generación) | `api` (panel), `telegramWebhook` (bot), `encolarLoteAviso` y `procesarLoteAviso` (envío por lotes). |
| Cloud Firestore | Usuarios del panel, catálogo académico, estudiantes, registros en curso y avisos con sus destinatarios y lotes. |
| Cloud Storage for Firebase | Imagen de cada aviso. |
| Google Cloud Tasks | Cola de envío: 5 lotes a la vez y hasta 5 intentos por lote. |
| Firebase Authentication | Inicio de sesión del personal del panel. |
| Secret Manager | Token del bot, secreto del webhook y clave de Resend. |
| Telegram Bot API | Mensajes y botones del bot; los eventos llegan por webhook. |
| Resend | Envío del código de verificación al correo institucional. |

Las reglas de Firestore y de Storage niegan todo acceso directo desde los clientes: solo las Cloud Functions leen y escriben los datos.

## Estructura del proyecto

```text
frontend/                 Panel web (HTML, CSS y JavaScript sin compilación)
functions/
  index.js                Definición de las cuatro Cloud Functions y rutas de la API
  src/config/             Inicialización de Firebase (con protección para el entorno local)
  src/services/           Lógica: avisos, envío por lotes, imágenes, registro del bot, catálogo, etc.
  src/utils/              Fechas en la zona horaria de Tuxtla
  scripts/                Utilidades locales y pruebas de carga e imágenes
firebase.json             Configuración de Hosting, Functions, Firestore, Storage y emuladores
firestore.rules           Reglas de Firestore (acceso directo denegado)
firestore.indexes.json    Índices de Firestore
storage.rules             Reglas de Storage (acceso directo denegado)
```

## Requisitos

- Node.js 24.
- Firebase CLI.
- Java 21 o posterior (lo requieren los emuladores de Firestore y Storage).
- Un bot de Telegram **de prueba** para desarrollo (nunca el bot de producción).

## Configuración local

1. Instala las dependencias de Functions:

	```bash
	cd functions
	npm install
	```

2. Crea `functions/.secret.local` con los valores de tu bot de prueba:

	```env
	TELEGRAM_BOT_TOKEN=token_del_bot_de_prueba
	TELEGRAM_WEBHOOK_SECRET=cualquier-valor-de-prueba
	RESEND_API_KEY=clave_de_resend
	```

	Ese archivo solo lo leen los emuladores y los scripts locales; nunca se despliega ni se sube a Git. `functions/.env` debe quedarse **vacío**: lo que contenga se despliega como variable de entorno y choca con los secretos de producción (ver `functions/.env.example`).

3. Inicia los emuladores desde la raíz del proyecto (o `npm run serve` desde `functions/`):

	```bash
	firebase emulators:start --only auth,firestore,functions,hosting,storage
	```

	Por seguridad, el código local se niega a usar Firestore o Storage de producción: si falta el emulador correspondiente, la ejecución se detiene.

4. Abre el panel en `http://127.0.0.1:5000/login.html`. No uses Live Server: el rewrite de `/api/**` solo funciona desde Firebase Hosting.

5. Crea un usuario del panel: regístralo en la pestaña Authentication del Emulator UI (`http://127.0.0.1:4000`), copia su UID y asígnale un rol:

	```bash
	cd functions
	export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
	node scripts/crear-administrador.js <UID>     # o crear-coordinador.js
	node scripts/seed-academic-data.js            # carga ISC con 9 semestres y grupos A, B y C
	```

6. Para probar el bot con tu bot de prueba (por sondeo, sin webhook): `npm run telegram:dev` desde `functions/`.

| Servicio | URL o puerto local |
| --- | --- |
| Panel web | `http://127.0.0.1:5000` |
| Emulator UI | `http://127.0.0.1:4000` |
| Authentication | `127.0.0.1:9099` |
| Firestore | `127.0.0.1:8080` |
| Storage | `127.0.0.1:9199` |
| Functions | `127.0.0.1:5001` |

## Pruebas

Desde `functions/`:

```bash
# Análisis estático (también corre antes de cada despliegue)
npm run lint

# Carga y tolerancia a fallas: 5,000 estudiantes, fallas de Telegram,
# estudiantes que bloquearon el bot e interrupciones de Firestore
firebase emulators:exec --only firestore "node scripts/prueba-carga.js"

# Avisos con imagen: guardado en Storage, envío como foto, validaciones,
# corrección, reenvío desde el bot y eliminación
firebase emulators:exec --only firestore,storage "node scripts/prueba-imagen.js"
```

Ambas pruebas usan un Telegram simulado: nunca envían mensajes reales.

## Despliegue

1. En la consola de Firebase, el proyecto debe tener el plan Blaze y Cloud Storage activado.
2. Configura los secretos de producción:

	```bash
	firebase functions:secrets:set TELEGRAM_BOT_TOKEN
	firebase functions:secrets:set TELEGRAM_WEBHOOK_SECRET
	firebase functions:secrets:set RESEND_API_KEY
	```

3. Despliega desde la raíz del proyecto:

	```bash
	firebase deploy
	```

4. Registra el webhook del bot con la URL de la función `telegramWebhook` que muestra el despliegue y el mismo secreto:

	```bash
	curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
	  -d "url=<URL de telegramWebhook>" \
	  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
	```

5. Configura el menú de comandos del bot: `npm run telegram:comandos` desde `functions/`.
6. Da de alta al personal del panel: crea su cuenta en Firebase Authentication y, en Firestore, el documento `usuarios/<UID>` con los campos `rol` (`administrador` o `coordinador`) y `activo: true`.
