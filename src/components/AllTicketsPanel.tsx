import { useEffect, useState } from 'react';
import { TicketsResult, TimerState } from '../types';
import TicketList from './TicketList';
import { IconAlert, IconSearch } from './Icons';

const LIMITE = 100;
const RETARDO_MS = 350;

interface Props {
  timers: TimerState[];
  onTimersChange: (timers: TimerState[]) => void;
  onTimerStarted: () => void;
  onRequestStop: () => void;
  frozenAt: number | null;
  refreshSignal: number;
}

export default function AllTicketsPanel({ refreshSignal, ...rest }: Props) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<TicketsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);

    const id = setTimeout(
      () => {
        window.api
          .searchAllTickets(query)
          .then((res) => {
            if (cancelado) return;
            setResult(res);
            setError(null);
          })
          .catch((err) => {
            if (cancelado) return;
            setError(err instanceof Error ? err.message : 'No se pudieron buscar los tickets');
          })
          .finally(() => {
            if (!cancelado) setLoading(false);
          });
      },
      query.trim() ? RETARDO_MS : 0,
    );

    return () => {
      cancelado = true;
      clearTimeout(id);
    };
  }, [query, refreshSignal]);

  const tickets = result?.tickets ?? [];

  return (
    <section className="card">
      <div className="panel-head">
        <div className="panel-title">
          <h2>Todos los tickets</h2>
          <span className="count-chip">{tickets.length}</span>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ margin: '14px 18px 0' }}>
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      {result && !result.available ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <IconAlert size={20} />
          </span>
          <strong>El módulo de Servicio de asistencia no está disponible</strong>
          <span>
            No se pudo leer <code>helpdesk.ticket</code> en tu Odoo.
          </span>
        </div>
      ) : (
        <>
          <div className="task-filters">
            <div className="search-field">
              <IconSearch size={15} />
              <input
                type="search"
                placeholder="Buscar por ticket, referencia o cliente en todo Odoo..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Buscar entre todos los tickets"
              />
            </div>
          </div>

          <p className="browse-hint">
            Tickets abiertos de todos los equipos que puedes ver, estén o no a tu nombre.
            {tickets.length >= LIMITE && ' Se muestran los 100 más recientes: afina la búsqueda.'}
          </p>

          <TicketList
            {...rest}
            refreshSignal={refreshSignal}
            tickets={tickets}
            externalLoading={loading}
          />
        </>
      )}
    </section>
  );
}
