import { useEffect, useMemo, useState } from 'react';
import { TeamSchedule } from '../types';
import { GanttBar, barPosition, buildGantt, isWeekend } from '../lib/gantt';
import { formatOdooDateShort } from '../lib/odooDate';
import { IconAlert, IconRefresh, IconSearch, IconTasks } from './Icons';

const HORIZONS = [
  { days: 7, label: '7 días' },
  { days: 14, label: '14 días' },
  { days: 30, label: '30 días' },
];

const ALTO_BARRA = 24;

// Dos letras: con una sola no se distingue martes de miércoles ni lunes de martes.
function dayLabel(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const corto = new Intl.DateTimeFormat('es-EC', { weekday: 'short', timeZone: 'UTC' }).format(date);
  return { weekday: corto.slice(0, 2), day: String(d) };
}

function rangoLabel(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

function barTitle(bar: GanttBar) {
  const partes = [bar.task.name];
  if (bar.task.projectName) partes.push(`Proyecto: ${bar.task.projectName}`);
  if (bar.task.stageName) partes.push(`Etapa: ${bar.task.stageName}`);
  partes.push(
    bar.projected
      ? 'Sin fechas en Odoo: posición estimada por la cola de trabajo'
      : 'Planificada en Odoo',
  );
  if (bar.task.deadline) partes.push(`Vence: ${formatOdooDateShort(bar.task.deadline)}`);
  if (bar.task.allocatedHours) {
    partes.push(
      `Horas: ${bar.task.effectiveHours.toFixed(1)} de ${bar.task.allocatedHours.toFixed(1)}`,
    );
  }
  if (bar.current) partes.push('Imputó tiempo a esta tarea hoy');
  if (bar.atRisk) partes.push('La estimación se pasa de la fecha límite');
  return partes.join('\n');
}

export default function TeamGantt() {
  const [data, setData] = useState<TeamSchedule | null>(null);
  const [days, setDays] = useState(14);
  const [search, setSearch] = useState('');
  const [onlyBusy, setOnlyBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await window.api.getTeamSchedule());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el reparto del equipo');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const { dayKeys, rows, today } = useMemo(() => {
    if (!data) return { dayKeys: [] as string[], rows: [], today: '' };
    return buildGantt(data, days);
  }, [data, days]);

  const visibles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => (query ? row.member.name.toLowerCase().includes(query) : true))
      .filter((row) => (onlyBusy ? row.pending > 0 : true));
  }, [rows, search, onlyBusy]);

  const totales = useMemo(
    () => ({
      personas: rows.length,
      trabajando: rows.filter((row) => row.member.currentTask).length,
      atrasadas: rows.filter((row) => row.bars.some((bar) => bar.overdue)).length,
      libres: rows.filter((row) => row.pending === 0).length,
    }),
    [rows],
  );

  return (
    <section className="card">
      <div className="panel-head">
        <div className="panel-title">
          <h2>Reparto del equipo</h2>
          <span className="panel-subtitle">
            {dayKeys.length > 0
              ? `${rangoLabel(dayKeys[0])} al ${rangoLabel(dayKeys[dayKeys.length - 1])}`
              : 'En qué anda cada persona y qué tiene por delante'}
          </span>
        </div>

        <div className="panel-actions">
          <div className="segmented">
            {HORIZONS.map((h) => (
              <button
                key={h.days}
                type="button"
                className={days === h.days ? 'is-active' : ''}
                onClick={() => setDays(h.days)}
              >
                {h.label}
              </button>
            ))}
          </div>
          <button className="btn-secondary btn-sm" onClick={load} disabled={loading}>
            <IconRefresh size={13} />
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ margin: '14px 18px 0' }}>
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '14px 18px' }}>
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton-row" key={i} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <IconTasks size={20} />
          </span>
          <strong>Sin personas que mostrar</strong>
          <span>No hay otros empleados con usuario de Odoo en la empresa.</span>
        </div>
      ) : (
        <>
          <div className="task-filters gantt-toolbar">
            <div className="search-field">
              <IconSearch size={14} />
              <input
                type="search"
                placeholder="Buscar persona..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Buscar persona en el reparto"
              />
            </div>

            <label className="gantt-check">
              <input
                type="checkbox"
                checked={onlyBusy}
                onChange={(e) => setOnlyBusy(e.target.checked)}
              />
              Solo con tareas abiertas
            </label>

            <div className="gantt-totals">
              <span>
                <strong>{totales.personas}</strong> personas
              </span>
              <span>
                <strong>{totales.trabajando}</strong> imputando hoy
              </span>
              <span className={totales.atrasadas ? 'is-danger' : ''}>
                <strong>{totales.atrasadas}</strong> con atrasos
              </span>
              <span>
                <strong>{totales.libres}</strong> sin tareas
              </span>
            </div>
          </div>

          <div className="gantt-legend">
            <span className="gantt-legend-item">
              <i className="gantt-chip is-planned" /> Planificada en Odoo
            </span>
            <span className="gantt-legend-item">
              <i className="gantt-chip is-projected" /> Estimada por la cola de trabajo
            </span>
            <span className="gantt-legend-item">
              <i className="gantt-chip is-current" /> En curso hoy
            </span>
            <span className="gantt-legend-item">
              <i className="gantt-chip is-late" /> Fecha límite vencida
            </span>
          </div>

          <div className="gantt">
            <div className="gantt-head">
              <div className="gantt-head-person">Persona</div>
              <div className="gantt-axis">
                {dayKeys.map((key) => {
                  const { weekday, day } = dayLabel(key);
                  return (
                    <div
                      key={key}
                      className={`gantt-day ${isWeekend(key) ? 'is-weekend' : ''} ${
                        key === today ? 'is-today' : ''
                      }`}
                      title={key}
                    >
                      <span className="gantt-day-week">{weekday}</span>
                      <span className="gantt-day-num">{day}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {visibles.map((row) => (
              <div className="gantt-row" key={row.member.id}>
                <div className="gantt-person">
                  <strong title={row.member.name}>{row.member.name}</strong>
                  {row.member.currentTask ? (
                    <span className="gantt-now" title={row.member.currentTask.name}>
                      Ahora: {row.member.currentTask.name}
                    </span>
                  ) : (
                    <span className="gantt-idle">
                      {row.pending === 0 ? 'Sin tareas abiertas' : 'Sin imputaciones hoy'}
                    </span>
                  )}
                </div>

                <div
                  className="gantt-track"
                  style={{ height: Math.max(row.lanes, 1) * ALTO_BARRA + 8 }}
                >
                  {dayKeys.map((key) => (
                    <div
                      key={key}
                      className={`gantt-cell ${isWeekend(key) ? 'is-weekend' : ''} ${
                        key === today ? 'is-today' : ''
                      }`}
                    />
                  ))}

                  {row.bars.map((bar) => {
                    const { left, width } = barPosition(bar, dayKeys);
                    const clases = [
                      'gantt-bar',
                      bar.projected ? 'is-projected' : 'is-planned',
                      bar.current ? 'is-current' : '',
                      bar.overdue ? 'is-late' : '',
                      bar.atRisk ? 'is-risk' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <button
                        key={`${bar.task.id}-${bar.startKey}`}
                        className={clases}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          top: bar.lane * ALTO_BARRA + 4,
                        }}
                        title={barTitle(bar)}
                        onClick={() => window.api.openTaskInOdoo(bar.task.id).catch(() => {})}
                      >
                        <span>{bar.task.name}</span>
                      </button>
                    );
                  })}

                  {row.bars.length === 0 && row.pending > 0 && (
                    <span className="gantt-empty-row">Nada dentro del horizonte</span>
                  )}

                  {row.beyond > 0 && (
                    <span className="gantt-beyond" title="Tareas que caen fuera del horizonte">
                      +{row.beyond}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="gantt-note">
            Las barras rayadas no tienen fechas en Odoo: se estiman poniendo las tareas en fila
            desde hoy, por fecha límite y prioridad, a razón de 8 h por día laborable y sin pisar
            lo ya planificado. «Ahora» es la última tarea a la que la persona imputó tiempo hoy.
          </p>
        </>
      )}
    </section>
  );
}
