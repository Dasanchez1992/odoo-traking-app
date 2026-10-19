import { useEffect, useMemo, useState } from 'react';
import { ProductivityData } from '../types';
import { ecuadorDateKey, parseOdooDateTime, startOfWeekKey } from '../lib/odooDate';
import DailyHoursChart, { DayDatum } from './DailyHoursChart';
import ProjectHoursChart, { ProjectDatum } from './ProjectHoursChart';
import WeeklySummaryCard from './WeeklySummaryCard';
import { IconAlert, IconClock, IconTasks } from './Icons';

const TOP_PROJECTS = 5;

function formatHours(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export default function ProductivityPanel() {
  const [data, setData] = useState<ProductivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api
      .getProductivity()
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'No se pudieron cargar las métricas'),
      )
      .finally(() => setLoading(false));
  }, []);

  const metrics = useMemo(() => {
    if (!data) return null;

    const todayKey = ecuadorDateKey(new Date());
    const weekKey = startOfWeekKey();

    const byDay = new Map<string, number>();
    const byProject = new Map<string, number>();
    let weekLogged = 0;
    let todayLogged = 0;

    data.lines.forEach((line) => {
      const day = line.date;
      byDay.set(day, (byDay.get(day) ?? 0) + line.unit_amount);
      if (day === todayKey) todayLogged += line.unit_amount;
      if (day >= weekKey) {
        weekLogged += line.unit_amount;
        const project = line.project_id ? line.project_id[1] : 'Sin proyecto';
        byProject.set(project, (byProject.get(project) ?? 0) + line.unit_amount);
      }
    });

    let weekWorked = 0;
    let todayWorked = 0;
    data.attendances.forEach((att) => {
      const checkIn = parseOdooDateTime(att.check_in);
      if (!checkIn) return;
      const dayKey = ecuadorDateKey(checkIn);
      const checkOut = parseOdooDateTime(att.check_out);
      const hours = checkOut
        ? att.worked_hours || (checkOut.getTime() - checkIn.getTime()) / 3600000
        : (Date.now() - checkIn.getTime()) / 3600000;
      if (dayKey >= weekKey) weekWorked += hours;
      if (dayKey === todayKey) todayWorked += hours;
    });

    const days: DayDatum[] = [];
    for (let i = data.days - 1; i >= 0; i -= 1) {
      const key = ecuadorDateKey(new Date(Date.now() - i * 86400000));
      days.push({ key, hours: byDay.get(key) ?? 0, isToday: key === todayKey });
    }

    const sortedProjects = [...byProject.entries()].sort((a, b) => b[1] - a[1]);
    const top: ProjectDatum[] = sortedProjects
      .slice(0, TOP_PROJECTS)
      .map(([name, hours]) => ({ name, hours }));
    const restHours = sortedProjects.slice(TOP_PROJECTS).reduce((sum, [, h]) => sum + h, 0);
    if (restHours > 0) top.push({ name: 'Otros proyectos', hours: restHours });

    const loggedDays = days.filter((d) => d.hours > 0);
    const average = loggedDays.length
      ? loggedDays.reduce((sum, d) => sum + d.hours, 0) / loggedDays.length
      : 0;

    return {
      days,
      top,
      todayLogged,
      weekLogged,
      todayWorked,
      weekWorked,
      average,
      hasAttendance: data.attendances.length > 0,
      imputation: weekWorked > 0 ? Math.min(999, (weekLogged / weekWorked) * 100) : null,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="splash-inner" style={{ padding: 48 }}>
        <div className="spinner" />
        <span>Cargando métricas...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-danger" style={{ margin: 18 }}>
        <IconAlert size={16} />
        <span>{error}</span>
      </div>
    );
  }

  if (!metrics) return null;

  const noData = metrics.days.every((d) => d.hours === 0);

  return (
    <div className="productivity">
      <div className="prod-stats">
        <div className="card stat-card">
          <span className="card-label">
            <IconClock size={13} />
            Registrado hoy
          </span>
          <span className="stat-value">{formatHours(metrics.todayLogged)}</span>
          <span className="stat-foot">
            {metrics.hasAttendance
              ? `${formatHours(metrics.todayWorked)} en jornada`
              : 'En hojas de horas'}
          </span>
        </div>

        <div className="card stat-card">
          <span className="card-label">
            <IconClock size={13} />
            Esta semana
          </span>
          <span className="stat-value">{formatHours(metrics.weekLogged)}</span>
          <span className="stat-foot">Desde el lunes</span>
        </div>

        <div className="card stat-card">
          <span className="card-label">
            <IconTasks size={13} />
            Promedio diario
          </span>
          <span className="stat-value">{formatHours(metrics.average)}</span>
          <span className="stat-foot">Días con registro, últimas 2 semanas</span>
        </div>

        <div className="card stat-card">
          <span className="card-label">
            <IconClock size={13} />
            Imputación semanal
          </span>
          <span className="stat-value">
            {metrics.imputation === null ? '—' : `${Math.round(metrics.imputation)}%`}
          </span>
          <span className="stat-foot">
            {metrics.imputation === null
              ? 'Sin asistencias registradas'
              : 'Horas registradas sobre jornada'}
          </span>
        </div>
      </div>

      <WeeklySummaryCard />

      <div className="prod-charts">
        <section className="card chart-card">
          <div className="chart-head">
            <h3>Horas registradas por día</h3>
            <span className="chart-sub">Últimas dos semanas · hojas de horas de Odoo</span>
          </div>
          {noData ? (
            <p className="empty-state">Todavía no hay horas registradas en este período.</p>
          ) : (
            <DailyHoursChart data={metrics.days} />
          )}
        </section>

        <section className="card chart-card">
          <div className="chart-head">
            <h3>Dedicación por proyecto</h3>
            <span className="chart-sub">Esta semana</span>
          </div>
          {metrics.top.length === 0 ? (
            <p className="empty-state">Sin horas registradas esta semana.</p>
          ) : (
            <ProjectHoursChart data={metrics.top} totalHours={metrics.weekLogged} />
          )}
        </section>
      </div>
    </div>
  );
}
