import { UsageApp, UsageDay } from '../types';

export type UsageMode = 'dia' | 'semana' | 'mes';

const DIA_MS = 86400000;

function aFecha(clave: string) {
  return new Date(`${clave}T00:00:00Z`);
}

function aClave(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}

/** Día, semana (lunes a domingo) o mes que contiene la fecha indicada. */
export function rangoDe(fecha: string, modo: UsageMode): { from: string; to: string } {
  const base = aFecha(fecha);

  if (modo === 'semana') {
    const lunes = new Date(base.getTime() - ((base.getUTCDay() + 6) % 7) * DIA_MS);
    return { from: aClave(lunes), to: aClave(new Date(lunes.getTime() + 6 * DIA_MS)) };
  }

  if (modo === 'mes') {
    const primero = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
    const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
    return { from: aClave(primero), to: aClave(ultimo) };
  }

  return { from: fecha, to: fecha };
}

export interface PersonUsage {
  userId: number;
  name: string;
  activeSeconds: number;
  idleSeconds: number;
  /** Días con actividad registrada dentro del rango. */
  days: number;
  apps: UsageApp[];
}

function sumarApps(destino: Map<string, UsageApp>, apps: UsageApp[]) {
  apps.forEach((uso) => {
    const actual = destino.get(uso.app);
    if (actual) {
      actual.seconds += uso.seconds;
      if (uso.label) actual.label = uso.label;
    } else {
      destino.set(uso.app, { ...uso });
    }
  });
}

function ordenadas(apps: Map<string, UsageApp>) {
  return [...apps.values()].sort((a, b) => b.seconds - a.seconds);
}

/** Agrupa los días por persona; el más usado primero. */
export function porPersona(days: UsageDay[]): PersonUsage[] {
  const gente = new Map<number, PersonUsage & { apps: UsageApp[]; indice: Map<string, UsageApp> }>();

  days.forEach((dia) => {
    const id = dia.userId ?? 0;
    const actual = gente.get(id) || {
      userId: id,
      name: dia.userName || 'Sin nombre',
      activeSeconds: 0,
      idleSeconds: 0,
      days: 0,
      apps: [],
      indice: new Map<string, UsageApp>(),
    };
    if (dia.userName && actual.name === 'Sin nombre') actual.name = dia.userName;
    actual.activeSeconds += dia.activeSeconds;
    actual.idleSeconds += dia.idleSeconds;
    if (dia.activeSeconds > 0) actual.days += 1;
    sumarApps(actual.indice, dia.apps);
    gente.set(id, actual);
  });

  return [...gente.values()]
    .map(({ indice, ...persona }) => ({ ...persona, apps: ordenadas(indice) }))
    .sort((a, b) => b.activeSeconds - a.activeSeconds);
}

/** Lo más usado por todo el equipo en el rango. */
export function totalPorApp(days: UsageDay[]): UsageApp[] {
  const indice = new Map<string, UsageApp>();
  days.forEach((dia) => sumarApps(indice, dia.apps));
  return ordenadas(indice);
}

/** Deja las primeras y junta el resto, para no pintar listas interminables. */
export function recortar(apps: UsageApp[], max = 6): UsageApp[] {
  if (apps.length <= max) return apps;
  const resto = apps.slice(max).reduce((suma, a) => suma + a.seconds, 0);
  const principales = apps.slice(0, max);
  return resto > 0
    ? [...principales, { app: 'otras', label: 'Otras aplicaciones', seconds: resto }]
    : principales;
}

export function formatearDuracion(segundos: number): string {
  const total = Math.round(segundos || 0);
  if (total < 60) return `${total} s`;
  const horas = Math.floor(total / 3600);
  const minutos = Math.round((total % 3600) / 60);
  if (horas === 0) return `${minutos} min`;
  return minutos === 0 ? `${horas} h` : `${horas} h ${String(minutos).padStart(2, '0')} min`;
}

/** Fecha en zona de Ecuador, que es la que usa el resto de la app. */
export function hoyEnEcuador(ahora = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3600000).toISOString().slice(0, 10);
}
