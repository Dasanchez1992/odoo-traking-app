import { OdooTask } from '../types';
import { ecuadorDateKey, parseOdooDateTime } from './odooDate';

export type DateFilter = 'today' | 'week' | 'nodate' | 'all';

export const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  today: 'Para hoy',
  week: 'Próximos 7 días',
  nodate: 'Sin fecha',
  all: 'Cualquier fecha',
};

function dayKey(value: string | false | null | undefined): string | null {
  const date = parseOdooDateTime(value ?? null);
  return date ? ecuadorDateKey(date) : null;
}

// Ventana de trabajo de la tarea. Con planificación de Odoo Enterprise va de planned_date_begin
// a date_deadline; sin ella, la fecha límite es a la vez el inicio y el fin.
export function taskWindow(task: OdooTask): { start: string | null; end: string | null } {
  const begin = dayKey(task.planned_date_begin);
  const deadline = dayKey(task.date_deadline);
  if (!begin && !deadline) return { start: null, end: null };
  return { start: begin ?? deadline, end: deadline ?? begin };
}

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function matchesDateFilter(task: OdooTask, filter: DateFilter, today: string): boolean {
  if (filter === 'all') return true;

  const { start, end } = taskWindow(task);
  if (filter === 'nodate') return start === null;
  if (start === null) return false;

  // "Para hoy" es lo que ya debería estar en marcha: su ventana empezó y aún no se cierra,
  // más lo que quedó atrasado, que sigue siendo trabajo del día.
  if (filter === 'today') return start <= today;

  return start <= addDays(today, 7);
}
