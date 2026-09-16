const TIMEZONE = 'America/Guayaquil';

// Los campos Datetime de Odoo llegan como "YYYY-MM-DD HH:MM:SS" en UTC, sin sufijo de zona.
// Los campos Date (sin hora) no llevan zona horaria y se muestran tal cual.
function formatOdooDateTime(value) {
  if (!value) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium' }).format(
      new Date(`${value}T00:00:00`),
    );
  }

  const isoUtc = `${value.replace(' ', 'T')}Z`;
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

// Clave 'YYYY-MM-DD' del día según la zona horaria de Ecuador.
function ecuadorDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

module.exports = { formatOdooDateTime, ecuadorDateKey };
