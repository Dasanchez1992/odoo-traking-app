import { ScheduleMember, ScheduleTask, TeamSchedule } from '../types';
import { ecuadorDateKey, parseOdooDateTime } from './odooDate';

// Jornada de referencia para estimar cuántos días ocupa una tarea sin planificar.
const HORAS_POR_DIA = 8;
const MAX_DIAS_ESTIMADOS = 10;

export interface GanttBar {
  task: ScheduleTask;
  startKey: string;
  endKey: string;
  /** Sin fechas en Odoo: la posición es una estimación a partir de la cola de trabajo. */
  projected: boolean;
  /** La persona imputó tiempo a esta tarea hoy. */
  current: boolean;
  /** Su fecha límite ya pasó. */
  overdue: boolean;
  /** La estimación la lleva más allá de su fecha límite. */
  atRisk: boolean;
  lane: number;
}

export interface GanttRow {
  member: ScheduleMember;
  bars: GanttBar[];
  lanes: number;
  /** Tareas abiertas asignadas, quepan o no en la ventana. */
  pending: number;
  /** Las que quedan fuera del horizonte elegido. */
  beyond: number;
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isWeekend(key: string): boolean {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return day === 0 || day === 6;
}

function nextWorkday(key: string): string {
  let actual = key;
  while (isWeekend(actual)) actual = addDaysKey(actual, 1);
  return actual;
}

// Día laborable libre: la estimación no puede pisar lo que Odoo ya tiene planificado.
function nextFreeDay(key: string, ocupados: Set<string>): string {
  let actual = nextWorkday(key);
  for (let i = 0; i < 400 && ocupados.has(actual); i += 1) {
    actual = nextWorkday(addDaysKey(actual, 1));
  }
  return actual;
}

function dayKeyOf(value: string | null): string | null {
  const date = parseOdooDateTime(value);
  return date ? ecuadorDateKey(date) : null;
}

// Días laborables que se estiman para una tarea sin planificar, por lo que le queda pendiente.
function estimatedDays(task: ScheduleTask): number {
  const restante = Math.max(task.allocatedHours - task.effectiveHours, 0);
  if (!restante) return 1;
  return Math.min(Math.max(Math.ceil(restante / HORAS_POR_DIA), 1), MAX_DIAS_ESTIMADOS);
}

// Primero lo atrasado, luego lo que vence antes; sin fecha va al final, por prioridad.
function queueOrder(a: ScheduleTask, b: ScheduleTask): number {
  const fechaA = dayKeyOf(a.deadline);
  const fechaB = dayKeyOf(b.deadline);
  if (fechaA !== fechaB) {
    if (!fechaA) return 1;
    if (!fechaB) return -1;
    return fechaA < fechaB ? -1 : 1;
  }
  const prioridad = Number(b.priority || 0) - Number(a.priority || 0);
  return prioridad !== 0 ? prioridad : a.id - b.id;
}

// Carriles: dos tareas que se solapan en el tiempo no pueden dibujarse en la misma línea.
function assignLanes(bars: GanttBar[]): number {
  const finDeCarril: string[] = [];
  bars
    .slice()
    .sort((a, b) => (a.startKey === b.startKey ? 0 : a.startKey < b.startKey ? -1 : 1))
    .forEach((bar) => {
      const libre = finDeCarril.findIndex((fin) => fin < bar.startKey);
      const carril = libre === -1 ? finDeCarril.length : libre;
      finDeCarril[carril] = bar.endKey;
      bar.lane = carril;
    });
  return Math.max(finDeCarril.length, 1);
}

function buildRow(
  member: ScheduleMember,
  tasks: ScheduleTask[],
  today: string,
  lastKey: string,
): GanttRow {
  const propias = tasks.filter((task) => task.userIds.includes(member.userId));
  const currentId = member.currentTask?.id ?? null;

  const planificadas: GanttBar[] = [];
  const sinFechas: ScheduleTask[] = [];

  propias.forEach((task) => {
    const inicio = dayKeyOf(task.plannedStart);
    const fin = dayKeyOf(task.deadline);
    if (!inicio) {
      sinFechas.push(task);
      return;
    }
    planificadas.push({
      task,
      startKey: inicio,
      endKey: fin && fin > inicio ? fin : inicio,
      projected: false,
      current: task.id === currentId,
      overdue: !!fin && fin < today,
      atRisk: false,
      lane: 0,
    });
  });

  // Los días que ya tienen trabajo planificado no se vuelven a ofrecer a la estimación.
  const ocupados = new Set<string>();
  planificadas.forEach((bar) => {
    let dia = bar.startKey < today ? today : bar.startKey;
    for (let i = 0; i < 400 && dia <= bar.endKey; i += 1) {
      ocupados.add(dia);
      dia = addDaysKey(dia, 1);
    }
  });

  // Lo que no está planificado se coloca en fila, empezando hoy: es la lectura de «qué sigue».
  let cursor = nextFreeDay(today, ocupados);
  const proyectadas: GanttBar[] = sinFechas.sort(queueOrder).map((task) => {
    const inicio = cursor;
    let fin = inicio;
    for (let dia = 1; dia < estimatedDays(task); dia += 1) {
      fin = nextFreeDay(addDaysKey(fin, 1), ocupados);
    }
    cursor = nextFreeDay(addDaysKey(fin, 1), ocupados);

    const limite = dayKeyOf(task.deadline);
    return {
      task,
      startKey: inicio,
      endKey: fin,
      projected: true,
      current: task.id === currentId,
      overdue: !!limite && limite < today,
      atRisk: !!limite && fin > limite,
      lane: 0,
    };
  });

  const todas = [...planificadas, ...proyectadas];
  // Lo que terminó antes de hoy se arrima al borde: sigue abierto y hay que verlo.
  const visibles = todas
    .filter((bar) => bar.startKey <= lastKey)
    .map((bar) => ({
      ...bar,
      startKey: bar.startKey < today ? today : bar.startKey,
      endKey: bar.endKey < today ? today : bar.endKey > lastKey ? lastKey : bar.endKey,
    }));

  const lanes = assignLanes(visibles);
  visibles.sort((a, b) => a.lane - b.lane || (a.startKey < b.startKey ? -1 : 1));

  return {
    member,
    bars: visibles,
    lanes,
    pending: propias.length,
    beyond: todas.length - visibles.length,
  };
}

export function buildGantt(data: TeamSchedule, days: number) {
  const today = data.today || ecuadorDateKey(new Date());
  const dayKeys = Array.from({ length: days }, (_, i) => addDaysKey(today, i));
  const lastKey = dayKeys[dayKeys.length - 1];

  const rows = data.employees.map((member) => buildRow(member, data.tasks, today, lastKey));
  return { today, dayKeys, rows };
}

// Posición de una barra dentro del eje, en porcentaje.
export function barPosition(bar: GanttBar, dayKeys: string[]) {
  const inicio = dayKeys.indexOf(bar.startKey);
  const fin = dayKeys.indexOf(bar.endKey);
  const desde = inicio === -1 ? 0 : inicio;
  const hasta = fin === -1 ? dayKeys.length - 1 : fin;
  return {
    left: (desde / dayKeys.length) * 100,
    width: ((hasta - desde + 1) / dayKeys.length) * 100,
  };
}
