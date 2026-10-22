import { ScheduleMember, ScheduleTask, TeamSchedule } from '../types';
import { addDaysKey, isWeekend } from './gantt';

// Jornada de ocho horas, cinco días: la capacidad con la que se compara la carga.
export const HORAS_POR_DIA = 8;
export const HORAS_POR_SEMANA = HORAS_POR_DIA * 5;
// Con menos hueco que esto en la semana, no se considera que haya sitio para otra tarea.
const HUECO_MINIMO = 4;
// Tarea sin horas estimadas: se cuenta aparte, pero algo ocupa.
const HORAS_SI_NO_HAY_ESTIMACION = 4;

export interface TareaDeCarga {
  id: number;
  name: string;
  project: string | null;
  deadline: string | null;
  pendingHours: number;
  estimated: boolean;
  overdue: boolean;
  priority: string;
}

export interface PersonLoad {
  employeeId: number;
  name: string;
  department: string | null;
  currentTask: string | null;
  openTasks: number;
  /** Tareas abiertas sin horas asignadas en Odoo. */
  unestimated: number;
  /** Horas que faltan por hacer, sumando lo asignado menos lo imputado. */
  pendingHours: number;
  overdue: number;
  dueThisWeek: number;
  /** Carga repartida por semana (lunes de cada una). */
  byWeek: { week: string; hours: number }[];
  /** Horas libres en lo que queda de la semana en curso. */
  slackHours: number;
  /** 'ahora' o el lunes de la primera semana con hueco. */
  freeFrom: string;
  tasks: TareaDeCarga[];
}

function lunesDe(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  const diaSemana = (fecha.getUTCDay() + 6) % 7;
  return addDaysKey(key, -diaSemana);
}

function diasHabilesRestantes(desde: string): number {
  const lunes = lunesDe(desde);
  let dias = 0;
  for (let i = 0; i < 7; i += 1) {
    const dia = addDaysKey(lunes, i);
    if (dia >= desde && !isWeekend(dia)) dias += 1;
  }
  return dias;
}

function diaDe(valor: string | null): string | null {
  return valor ? valor.slice(0, 10) : null;
}

function horasPendientes(task: ScheduleTask): { horas: number; estimada: boolean } {
  if (!task.allocatedHours) return { horas: HORAS_SI_NO_HAY_ESTIMACION, estimada: false };
  return { horas: Math.max(task.allocatedHours - task.effectiveHours, 0), estimada: true };
}

/**
 * Lo que se puede contar sin opinar: cuánto le queda a cada quien, cuándo vence y en qué semana
 * se le abre hueco. El juicio («a quién le cabe otra tarea») se deja para después.
 */
export function buildLoads(data: TeamSchedule, employeeIds?: number[]): PersonLoad[] {
  const hoy = data.today;
  const semanaActual = lunesDe(hoy);
  const elegidos = employeeIds ? new Set(employeeIds) : null;

  const porUsuario = new Map<number, ScheduleTask[]>();
  data.tasks.forEach((task) => {
    task.userIds.forEach((userId) => {
      if (!porUsuario.has(userId)) porUsuario.set(userId, []);
      porUsuario.get(userId)!.push(task);
    });
  });

  return data.employees
    .filter((member: ScheduleMember) => !elegidos || elegidos.has(member.id))
    .map((member) => {
      const tareas = porUsuario.get(member.userId) ?? [];
      const porSemana = new Map<string, number>();
      let pendientes = 0;
      let sinEstimar = 0;
      let vencidas = 0;
      let estaSemana = 0;

      const detalle: TareaDeCarga[] = tareas.map((task) => {
        const { horas, estimada } = horasPendientes(task);
        const vence = diaDe(task.deadline);
        const atrasada = !!vence && vence < hoy;

        pendientes += horas;
        if (!estimada) sinEstimar += 1;
        if (atrasada) vencidas += 1;
        if (vence && !atrasada && vence <= addDaysKey(hoy, 7)) estaSemana += 1;

        // La carga cae en la semana del vencimiento; sin fecha, en la que ya corre.
        const referencia = vence || diaDe(task.plannedStart) || hoy;
        const semana = lunesDe(referencia < semanaActual ? hoy : referencia);
        porSemana.set(semana, (porSemana.get(semana) ?? 0) + horas);

        return {
          id: task.id,
          name: task.name,
          project: task.projectName,
          deadline: vence,
          pendingHours: Math.round(horas * 10) / 10,
          estimated: estimada,
          overdue: atrasada,
          priority: task.priority,
        };
      });

      const byWeek = [...porSemana.entries()]
        .map(([week, hours]) => ({ week, hours: Math.round(hours * 10) / 10 }))
        .sort((a, b) => a.week.localeCompare(b.week));

      // En la semana en curso solo cuentan los días que quedan.
      const capacidadActual = diasHabilesRestantes(hoy) * HORAS_POR_DIA;
      const cargaActual = porSemana.get(semanaActual) ?? 0;
      const slack = Math.round((capacidadActual - cargaActual) * 10) / 10;

      let freeFrom = 'ahora';
      if (slack < HUECO_MINIMO) {
        freeFrom = '';
        for (let i = 1; i <= 8 && !freeFrom; i += 1) {
          const semana = addDaysKey(semanaActual, i * 7);
          if ((porSemana.get(semana) ?? 0) <= HORAS_POR_SEMANA - HUECO_MINIMO) freeFrom = semana;
        }
        if (!freeFrom) freeFrom = addDaysKey(semanaActual, 9 * 7);
      }

      return {
        employeeId: member.id,
        name: member.name,
        department: member.department,
        currentTask: member.currentTask ? member.currentTask.name : null,
        openTasks: tareas.length,
        unestimated: sinEstimar,
        pendingHours: Math.round(pendientes * 10) / 10,
        overdue: vencidas,
        dueThisWeek: estaSemana,
        byWeek,
        slackHours: slack,
        freeFrom,
        // Al análisis le basta lo más gordo de cada quien; la lista entera solo haría ruido.
        tasks: detalle.sort((a, b) => b.pendingHours - a.pendingHours).slice(0, 12),
      };
    });
}
