const TIMEZONE = 'America/Guayaquil';

// Los campos Datetime de Odoo llegan como "YYYY-MM-DD HH:MM:SS" en UTC, sin sufijo de zona.
export function parseOdooDateTime(value: string | false | null | undefined): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00`
    : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Los campos Date (sin hora) no llevan zona horaria y se muestran tal cual.
export function formatOdooDateTime(value: string | false | null | undefined): string {
  if (!value) return '';
  const date = parseOdooDateTime(value);
  if (!date) return value;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium' }).format(date);
  }

  return new Intl.DateTimeFormat('es-EC', {
    timeZone: TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

// Versión compacta para tablas: "15 sept, 09:16" (agrega el año solo si no es el actual).
export function formatOdooDateShort(value: string | false | null | undefined): string {
  if (!value) return '';
  const date = parseOdooDateTime(value);
  if (!date) return value;

  const yearPart = date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const };

  const formatted = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short', ...yearPart }).format(date)
    : new Intl.DateTimeFormat('es-EC', {
        timeZone: TIMEZONE,
        day: '2-digit',
        month: 'short',
        ...yearPart,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(date);

  return formatted.replace(/-/g, ' ');
}

export function formatOdooTime(value: string | false | null | undefined): string {
  const date = parseOdooDateTime(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: TIMEZONE,
    timeStyle: 'short',
  }).format(date);
}

// Clave 'YYYY-MM-DD' del día según la zona horaria de Ecuador.
export function ecuadorDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Clave del lunes de la semana en curso (hora de Ecuador).
export function startOfWeekKey(): string {
  const todayKey = ecuadorDateKey(new Date());
  const [y, m, d] = todayKey.split('-').map(Number);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = (utcNoon.getUTCDay() + 6) % 7; // lunes = 0
  utcNoon.setUTCDate(utcNoon.getUTCDate() - weekday);
  return utcNoon.toISOString().slice(0, 10);
}

export function formatDayLabel(key: string): { weekday: string; day: string } {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: new Intl.DateTimeFormat('es-EC', { weekday: 'narrow', timeZone: 'UTC' }).format(date),
    day: String(d),
  };
}

export function isPast(value: string | false | null | undefined): boolean {
  const date = parseOdooDateTime(value);
  return date !== null && date.getTime() < Date.now();
}
