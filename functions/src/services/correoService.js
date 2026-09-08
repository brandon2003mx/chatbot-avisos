/**
 * Remitente de los correos que envía el sistema.
 *
 * Debe ser una dirección de un dominio verificado en Resend: si no,
 * la API rechaza el envío. El dominio se verifica publicando los
 * registros DNS que Resend indica (DKIM en `resend._domainkey`, y
 * SPF + MX en el subdominio `send`).
 *
 * @type {string}
 */
const CORREO_REMITENTE = "Avisos ITTG <no-reply@avisosittg.lat>";

/**
 * Envía un correo de texto plano usando la API de Resend.
 *
 * Todo el trato con el proveedor vive aquí a propósito: si más
 * adelante se cambia de proveedor (SendGrid, SMTP del instituto,
 * etc.), solo se reescribe esta función.
 *
 * @param {string} destinatario Correo de destino.
 * @param {string} asunto Asunto del correo.
 * @param {string} texto Cuerpo del correo, en texto plano.
 * @return {Promise<Object>} Respuesta de la API.
 */
async function enviarCorreo(destinatario, asunto, texto) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error(
        "Falta RESEND_API_KEY en las variables de entorno.",
    );
  }

  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: CORREO_REMITENTE,
      to: [destinatario],
      subject: asunto,
      text: texto,
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");

    throw new Error(
        `Resend respondió ${respuesta.status}: ${detalle}`,
    );
  }

  return respuesta.json();
}

module.exports = {
  CORREO_REMITENTE,
  enviarCorreo,
};
