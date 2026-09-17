import { useEffect, useMemo, useState } from 'react';
import { TeamMember, TeamSummary } from '../types';
import { formatOdooTime } from '../lib/odooDate';
import { IconAlert, IconClock, IconRefresh, IconSearch, IconTasks } from './Icons';

type SortKey = 'name' | 'firstCheckIn' | 'loggedToday' | 'loggedWeek' | 'coverage';

function formatHours(hours: number) {
  if (!hours) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

// Qué parte de la jornada quedó imputada en hojas de horas.
function coverage(member: TeamMember) {
  if (!member.workedToday) return null;
  return (member.loggedToday / member.workedToday) * 100;
}

export default function TeamPanel() {
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSummary(await window.api.getTeamSummary());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el equipo');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const members = summary?.employees ?? [];

  const totals = useMemo(() => {
    const withUser = members.filter((m) => m.hasUser);
    return {
      total: withUser.length,
      checkedIn: withUser.filter((m) => m.checkedIn).length,
      withoutLog: withUser.filter((m) => m.workedToday > 0 && m.loggedToday === 0).length,
      loggedToday: withUser.reduce((sum, m) => sum + m.loggedToday, 0),
      workedToday: withUser.reduce((sum, m) => sum + m.workedToday, 0),
    };
  }, [members]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = members.filter((m) => {
      if (onlyActive && !m.checkedIn) return false;
      if (!query) return true;
      return `${m.name} ${m.department ?? ''}`.toLowerCase().includes(query);
    });

    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'firstCheckIn':
          return (a.firstCheckIn ?? '~').localeCompare(b.firstCheckIn ?? '~');
        case 'loggedToday':
          return b.loggedToday - a.loggedToday;
        case 'loggedWeek':
          return b.loggedWeek - a.loggedWeek;
        case 'coverage':
          return (coverage(b) ?? -1) - (coverage(a) ?? -1);
        default:
          return a.name.localeCompare(b.name, 'es');
      }
    });
  }, [members, search, onlyActive, sortKey]);

  if (loading) {
    return (
      <div className="splash-inner" style={{ padding: 48 }}>
        <div className="spinner" />
        <span>Cargando datos del equipo...</span>
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

  return (
    <div className="productivity">
      <div className="prod-stats">
        <div className="card stat-card">
          <span className="card-label">
            <IconClock size={13} />
            En jornada ahora
          </span>
          <span className="stat-value">
            {totals.checkedIn}
            <em className="stat-of"> / {totals.total}</em>
          </span>
          <span className="stat-foot">Personas con fichaje abierto</span>
        </div>

        <div className="card stat-card">
          <span className="card-label">
            <IconTasks size={13} />
            Registrado hoy
          </span>
          <span className="stat-value">{formatHours(totals.loggedToday)}</span>
          <span className="stat-foot">Total del equipo en hojas de horas</span>
        </div>

        <div className="card stat-card">
          <span className="card-label">
            <IconClock size={13} />
            Jornada hoy
          </span>
          <span className="stat-value">{formatHours(totals.workedToday)}</span>
          <span className="stat-foot">Total en asistencias</span>
        </div>

        <div className="card stat-card">
          <span className="card-label">
            <IconAlert size={13} />
            Sin registrar
          </span>
          <span className={`stat-value ${totals.withoutLog > 0 ? 'is-danger' : ''}`}>
            {totals.withoutLog}
          </span>
          <span className="stat-foot">
            {totals.withoutLog > 0
              ? 'Ficharon pero no imputaron horas'
              : 'Todos con horas imputadas'}
          </span>
        </div>
      </div>

      <section className="card">
        <div className="panel-head">
          <div className="panel-title">
            <h2>Equipo</h2>
            <span className="count-chip">{visible.length}</span>
          </div>
          <button className="btn-secondary btn-sm" onClick={load}>
            <IconRefresh size={14} />
            Actualizar
          </button>
        </div>

        <div className="task-filters">
          <div className="search-field">
            <IconSearch size={15} />
            <input
              type="search"
              placeholder="Buscar por persona o departamento..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar en el equipo"
            />
          </div>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Ordenar"
          >
            <option value="name">Ordenar por nombre</option>
            <option value="firstCheckIn">Por hora de llegada</option>
            <option value="loggedToday">Por horas de hoy</option>
            <option value="loggedWeek">Por horas de la semana</option>
            <option value="coverage">Por imputación</option>
          </select>

          <button className="btn-secondary btn-sm" onClick={() => setOnlyActive((v) => !v)}>
            {onlyActive ? 'Ver todo el equipo' : 'Solo en jornada'}
          </button>
        </div>

        {visible.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">
              <IconSearch size={20} />
            </span>
            <strong>Sin resultados</strong>
            <span>Nadie coincide con los filtros aplicados.</span>
          </div>
        ) : (
          <>
            <div className="team-table-head">
              <span>Persona</span>
              <span>Llegada</span>
              <span className="align-end">Jornada hoy</span>
              <span className="align-end">Registrado hoy</span>
              <span className="align-end">Semana</span>
              <span className="align-end">Imputación</span>
            </div>

            {visible.map((member) => {
              const pct = coverage(member);
              const lowCoverage = pct !== null && pct < 60;

              return (
                <div className="team-row" key={member.id}>
                  <div className="team-person">
                    <span className={`dot ${member.checkedIn ? 'is-live' : ''}`} />
                    <div className="team-person-text">
                      <strong title={member.name}>{member.name}</strong>
                      {member.department && <span>{member.department}</span>}
                    </div>
                  </div>

                  <div className="team-cell">
                    {member.firstCheckIn ? formatOdooTime(member.firstCheckIn) : '—'}
                  </div>
                  <div className="team-cell align-end">{formatHours(member.workedToday)}</div>
                  <div
                    className={`team-cell align-end ${
                      member.workedToday > 0 && member.loggedToday === 0 ? 'is-danger' : ''
                    }`}
                  >
                    {formatHours(member.loggedToday)}
                  </div>
                  <div className="team-cell align-end">{formatHours(member.loggedWeek)}</div>
                  <div className="team-cell align-end">
                    {pct === null ? (
                      <span className="team-muted">—</span>
                    ) : (
                      <span className={lowCoverage ? 'is-danger' : ''}>{Math.round(pct)}%</span>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </section>
    </div>
  );
}
