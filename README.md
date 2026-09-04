# Chatbot de Avisos ITTG

Sistema de difusión institucional para el Instituto Tecnológico de Tuxtla Gutiérrez. Los coordinadores crean avisos segmentados desde un panel web y los estudiantes se registran, reciben avisos y confirman su lectura mediante Telegram.

## Funcionalidades

- Inicio de sesión de coordinadores con Firebase Authentication.
- Panel con métricas de avisos, estudiantes, destinatarios y lecturas confirmadas.
- Creación de avisos por carrera, semestre, grupo o para todos los estudiantes.
- Envío asíncrono por lotes con idempotencia y control de reintentos.
- Administración de avisos: consulta, corrección mediante reenvío y eliminación en cascada.
- Registro y actualización de datos académicos del estudiante desde el bot de Telegram.
- Botón **Confirmar lectura** en cada aviso de Telegram. La confirmación se almacena para el destinatario del aviso y actualiza el panel administrativo.

## Arquitectura

| Componente | Tecnología | Responsabilidad |
| --- | --- | --- |
| `frontend/` | HTML, CSS y JavaScript | Panel web para coordinadores. |
| `functions/` | Node.js y Cloud Functions for Firebase | API, webhooks de Telegram y procesamiento de avisos. |
| Firebase Authentication | Firebase | Autenticación de coordinadores. |
| Cloud Firestore | Firebase | Avisos, destinatarios, estudiantes y estructura académica. |
| Telegram Bot API | Telegram | Registro de estudiantes, entrega de avisos y confirmaciones. |

No hay una vista web de estudiante. El flujo de los estudiantes se realiza desde Telegram.

## Requisitos

- Node.js 24.
- Firebase CLI.
- Java 21 o posterior para el emulador de Firestore.
- Un bot de Telegram y su token.

## Configuración

1. Instala las dependencias de Functions:

	```powershell
	cd functions
	npm install
	```

2. Crea `functions/.env` a partir de `functions/.env.example` y define los secretos requeridos:

	```env
	TELEGRAM_BOT_TOKEN=tu_token_de_telegram
	TELEGRAM_WEBHOOK_SECRET=un_secreto_aleatorio
	```

	No incluyas este archivo en Git ni publiques el token.

3. Inicia el entorno local desde la raíz del proyecto:

	```powershell
	firebase emulators:start --only auth,firestore,functions,hosting
	```

4. Abre el panel mediante Firebase Hosting:

	```text
	http://127.0.0.1:5000/login.html
	```

	No uses Live Server para probar el sistema: el rewrite de `/api/**` hacia Functions solo está disponible desde Firebase Hosting.

## Desarrollo local

Firebase Hosting sirve la carpeta `frontend/` y redirige las solicitudes `/api/**` a la función `api`.

| Servicio | URL o puerto local |
| --- | --- |
| Panel web | `http://127.0.0.1:5000` |
| Emulator UI | `http://127.0.0.1:4000` |
| Authentication | `127.0.0.1:9099` |
| Firestore | `127.0.0.1:8080` |
| Functions | `127.0.0.1:5001` |

Para ejecutar el bot por sondeo durante el desarrollo local:

```powershell
cd functions
npm run telegram:dev
```

## Flujo de Avisos

1. El coordinador inicia sesión y redacta un aviso.
2. La API valida los datos y crea el aviso junto con sus destinatarios.
3. Functions procesa los destinatarios en lotes y entrega los mensajes por Telegram.
4. El mensaje incluye el botón **Confirmar lectura**.
5. Al pulsarlo, el bot marca el destinatario como leído y el panel refleja las métricas actualizadas.

Telegram no emite eventos cuando una persona solo abre un mensaje. Por esa razón, las lecturas se contabilizan únicamente cuando el estudiante pulsa el botón de confirmación.

## Scripts Disponibles

Desde `functions/`:

```powershell
npm run lint
npm run telegram:dev
npm run serve
npm run deploy
```

## Despliegue

Antes del despliegue, configura los secretos de Firebase para producción y verifica que el webhook de Telegram apunte a la función correspondiente. Luego ejecuta:

```powershell
firebase deploy
```
