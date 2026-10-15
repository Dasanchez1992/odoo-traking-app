import { useEffect, useMemo, useState } from 'react';
import { OdooTicket, TicketsResult, TimerState } from '../types';
import { formatOdooDateShort, isPast } from '../lib/odooDate';
import { formatElapsed, timerElapsedMs, useNow } from '../lib/format';
import { IconAlert, IconExternal, IconPlay, IconSearch, IconStop, IconTasks } from './Icons';

interface Props {
  timers: TimerState[];
  onTimersChange: (timers: TimerState[]) => void;
  onTimerStarted: () => void;
  onRequestStop: () => void;
  frozenAt: number | null;
  refreshSignal: number;
  /** Si el padre manda los tickets, esta lista solo los pinta: ni consulta ni filtra. */
  tickets?: OdooTicket[];
  externalLoading?: boolean;
}

export default function TicketList({
  timers,
  onTimersChange,
  onTimerStarted,
  onRequestStop,
  frozenAt,
  refreshSignal,
  tickets,
  externalLoading,
}: Props) {
  const controlado = tickets !== undefined;
  const [result, setResult] = useState<TicketsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [busyId, setBusyId] = useState<number | null>(null);

  const running = timers.some((t) => t.segmentStartedAt !== null);
  const now = useNow(running && frozenAt === null);
  const displayNow = frozenAt ?? now;

  useEffect(() => {
    if (controlado) return;
    window.api
      .listTickets()
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudieron cargar'))
      .finally(() => setLoading(false));
  }, [refreshSignal, controlado]);

  const stages = useMemo(() => {
    const map = new Map<number, string>();
    (result?.tickets ?? []).forEach((t) => {
      if (t.stage_id) map.set(t.stage_id[0], t.stage_id[1]);
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [result]);

  const visible = useMemo(() => {
    if (controlado) return tickets ?? [];
    const query = search.trim().toLowerCase();
    return (result?.tickets ?? []).filter((t) => {
      if (stageFilter !== 'all') {
        const stageId = t.stage_id ? t.stage_id[0] : null;
        if (String(stageId) !== stageFilter) return false;
      }
      if (!query) return true;
      return `${t.ticket_ref || ''} ${t.name} ${t.partner_id ? t.partner_id[1] : ''} ${
        t.team_id ? t.team_id[1] : ''
      }`
        .toLowerCase()
        .includes(query);
    });
  }, [result, search, stageFilter, controlado, tickets]);

  async function handleStart(ticket: OdooTicket) {
    setError(null);
    setBusyId(ticket.id);
    try {
      await window.api.startTimer(ticket, 'ticket');
      onTimerStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el cronómetro');
    } finally {
      setBusyId(null);
    }
  }

  if (controlado ? externalLoading : loading) {
    return (
      <div>
        {[0, 1, 2].map((i) => (
          <div className="skeleton-row" key={i} />
        ))}
      </div>
    );
  }

  if (result && !result.available) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">
          <IconAlert size={20} />
        </span>
        <strong>El módulo de Servicio de asistencia no está disponible</strong>
        <span>
          No se pudo leer <code>helpdesk.ticket</code> en tu Odoo. Puede que el módulo no esté
          instalado o que tu usuario no tenga permisos sobre él.
        </span>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="alert alert-danger" style={{ margin: '14px 18px 0' }}>
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      {!controlado && (
      <div className="task-filters">
        <div className="search-field">
          <IconSearch size={15} />
          <input
            type="search"
            placeholder="Buscar por ticket, cliente o equipo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar tickets"
          />
        </div>

        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          aria-label="Filtrar por etapa"
        >
          <option value="all">Todas las etapas</option>
          {stages.map(([id, name]) => (
            <option key={id} value={String(id)}>
              {name}
            </option>
          ))}
        </select>
      </div>
      )}

      {visible.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            {search ? <IconSearch size={20} /> : <IconTasks size={20} />}
          </span>
          <strong>
            {search || stageFilter !== 'all' ? 'Sin resultados' : 'No tienes tickets abiertos'}
          </strong>
          <span>
            {search || stageFilter !== 'all'
              ? 'Ningún ticket coincide con los filtros.'
              : 'Los tickets de asistencia abiertos a tu nombre aparecerán aquí.'}
          </span>
        </div>
      ) : (
        <>
          <div className="ticket-table-head">
            <span>Ticket</span>
            <span>Cliente</span>
            <span>Equipo</span>
            <span>Etapa</span>
            <span className="align-end">Tiempo</span>
          </div>

          {visible.map((ticket) => {
            const ticketTimer =
              timers.find((t) => t.kind === 'ticket' && t.taskId === ticket.id) ?? null;
            const isRunning = ticketTimer !== null && ticketTimer.segmentStartedAt !== null;
            const isPaused = ticketTimer !== null && ticketTimer.segmentStartedAt === null;

            return (
              <div key={ticket.id} className={`ticket-row ${isRunning ? 'is-running' : ''}`}>
                <div className="task-name">
                  {Number(ticket.priority) > 0 && (
                    <span className="task-star" title={`Prioridad ${ticket.priority} de 3`}>
                      {'★'.repeat(Number(ticket.priority))}
                    </span>
                  )}
                  <button
                    className="task-link"
                    onClick={() => window.api.openTicketInOdoo(ticket.id).catch(() => {})}
                    title={`Abrir "${ticket.name}" en Odoo`}
                  >
                    <span>
                      {ticket.ticket_ref ? `${ticket.ticket_ref} · ` : ''}
                      {ticket.name}
                    </span>
                    <IconExternal size={13} />
                  </button>
                </div>

                <div className="task-project" title={ticket.partner_id ? ticket.partner_id[1] : ''}>
                  {ticket.partner_id ? ticket.partner_id[1] : '—'}
                </div>

                <div className="task-project" title={ticket.team_id ? ticket.team_id[1] : ''}>
                  {ticket.team_id ? ticket.team_id[1] : '—'}
                </div>

                <div className="ticket-stage">
                  <span title={`Creado ${formatOdooDateShort(ticket.create_date)}`}>
                    {ticket.stage_id ? ticket.stage_id[1] : '—'}
                  </span>
                  {ticket.sla_deadline && isPast(ticket.sla_deadline) && (
                    <span className="pill is-danger" title={formatOdooDateShort(ticket.sla_deadline)}>
                      SLA vencido
                    </span>
                  )}
                </div>

                <div className="task-action">
                  {ticketTimer && (
                    <span className={`task-elapsed ${isPaused ? 'is-paused' : ''}`}>
                      {formatElapsed(timerElapsedMs(ticketTimer, displayNow))}
                    </span>
                  )}
                  {isRunning ? (
                    <button className="btn-danger btn-sm" onClick={onRequestStop}>
                      <IconStop size={12} />
                      Detener
                    </button>
                  ) : (
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleStart(ticket)}
                      disabled={busyId === ticket.id}
                      title={
                        isPaused
                          ? 'Reanudar el cronómetro de este ticket'
                          : 'Al iniciar, el cronómetro en curso se pausa'
                      }
                    >
                      <IconPlay size={12} />
                      {isPaused ? 'Reanudar' : 'Iniciar'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
