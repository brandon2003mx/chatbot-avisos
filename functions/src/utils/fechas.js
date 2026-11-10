/**
 * Utilidades de fecha en la hora local de Tuxtla.
 *
 * Cloud Functions corre en UTC: sin convertir, "hoy" cambiaría de
 * día a las 6 de la tarde y un evento capturado a las 10:00 se
 * guardaría a las 10:00 UTC (4:00 en Tuxtla). Todo lo que dependa
 * del calendario local pasa por aquí.
 *
 * El desfase no se fija en -06:00: se calcula con la base de zonas
 * horarias de Node, para que siga siendo correcto si México vuelve a
 * tener horario de verano.
 */

const ZONA_HORARIA = "America/Mexico_City";

const FORMATO_PARTES = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_HORARIA,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const FORMATO_DIA_LARGO = new Intl.DateTimeFormat("es-MX", {
  timeZone: ZONA_HORARIA,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const FORMATO_HORA = new Intl.DateTimeFormat("es-MX", {
  timeZone: ZONA_HORARIA,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Descompone un instante en año, mes, día, hora, minuto y segundo
 * tal como se ven en Tuxtla.
 *
 * @param {Date} fecha Instante.
 * @return {{year: number, month: number, day: number, hour: number,
 *   minute: number, second: number}}
 */
function partesLocales(fecha) {
  const partes = {};

  for (const {type, value} of FORMATO_PARTES.formatToParts(fecha)) {
    if (type !== "literal") {
      partes[type] = Number(value);
    }
  }

  return partes;
}

/**
 * Cuántos milisegundos está Tuxtla adelante de UTC en un instante
 * (negativo: -6 h).
 *
 * @param {Date} fecha Instante.
 * @return {number}
 */
function desfaseMs(fecha) {
  const p = partesLocales(fecha);
  const comoUtc = Date.UTC(
      p.year, p.month - 1, p.day, p.hour, p.minute, p.second,
  );

  return comoUtc - Math.floor(fecha.getTime() / 1000) * 1000;
}

/**
 * Convierte una fecha y hora del calendario de Tuxtla en un instante.
 * Acepta días fuera de rango (día 32, por ejemplo) y los pasa al mes
 * siguiente, igual que Date.UTC.
 *
 * @param {number} anio Año.
 * @param {number} mes Mes (1-12).
 * @param {number} dia Día del mes.
 * @param {number} [hora] Hora (0-23).
 * @param {number} [minuto] Minuto.
 * @return {Date}
 */
function fechaLocal(anio, mes, dia, hora = 0, minuto = 0) {
  const supuesto = Date.UTC(anio, mes - 1, dia, hora, minuto);

  return new Date(supuesto - desfaseMs(new Date(supuesto)));
}

/**
 * Medianoche (hora de Tuxtla) del día en que cae un instante, o de
 * unos días después.
 *
 * @param {Date} fecha Instante.
 * @param {number} [diasDespues] Días a sumar.
 * @return {Date}
 */
function inicioDelDia(fecha, diasDespues = 0) {
  const p = partesLocales(fecha);

  return fechaLocal(p.year, p.month, p.day + diasDespues);
}

/**
 * "Jueves, 14 de noviembre" en la hora de Tuxtla.
 *
 * @param {Date} fecha Instante.
 * @return {string}
 */
function formatearDia(fecha) {
  const texto = FORMATO_DIA_LARGO.format(fecha);

  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * "10:00" en la hora de Tuxtla.
 *
 * @param {Date} fecha Instante.
 * @return {string}
 */
function formatearHora(fecha) {
  return FORMATO_HORA.format(fecha);
}

module.exports = {
  ZONA_HORARIA,
  partesLocales,
  fechaLocal,
  inicioDelDia,
  formatearDia,
  formatearHora,
};
