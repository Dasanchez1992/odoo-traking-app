import { useEffect, useMemo, useState } from 'react';
import { ActivitiesResult, OdooActivity } from '../types';
import { formatOdooDateShort } from '../lib/odooDate';
import { IconAlert, IconCheck, IconExternal, IconRefresh, IconSearch, IconTasks } from './Icons';

// Nombres legibles para los modelos que más aparecen en las actividades.
const MODEL_LABELS: Record<string, string> = {
  'project.task': 'Tarea',
  'helpdesk.ticket': 'Ticket',
  'res.partner': 'Contacto',
  'crm.lead': 'Oportunidad',
  'sale.order': 'Pedido',
  'purchase.order': 'Compra',
  'account.move': 'Factura',
  'mail.activity': 'Actividad',
};

function plainText(html: string | false) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stateLabel(state: string) {
  if (state === 'overdue') return 'Vencida';
  if (state === 'today') return 'Para hoy';
  return 'Planificada';
}

interface Props {
  refreshSignal: number;
}

export default function ActivityList({ refreshSignal }: Props) {
  const [result, setResult] = useState<ActivitiesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('pending');
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      setResult(await window.api.listActivities());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las actividades');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [refreshSignal]);

  const activities = result?.activities ?? [];

  const counts = useMemo(
    () => ({
      overdue: activities.filter((a) => a.state === 'overdue').length,
      today: activities.filter((a) => a.state === 'today').length,
    }),
    [activities],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activities.filter((activity) => {
      if (stateFilter === 'overdue' && activity.state !== 'overdue') return false;
      if (stateFilter === 'today' && !['overdue', 'today'].includes(activity.state)) return false;

      if (!query) return true;
      const haystack = `${activity.summary || ''} ${activity.res_name || ''} ${
        activity.activity_type_id ? activity.activity_type_id[1] : ''
      }`.toLowerCase();
      return haystack.includes(query);
    });
  }, [activities, search, stateFilter]);

  async function handleComplete(activity: OdooActivity) {
    setBusyId(activity.id);
    setError(null);
    try {
      await window.api.completeActivity(activity.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar como hecha');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
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
        <strong>No se pudieron leer las actividades</strong>
        <span>Odoo rechazó la consulta a mail.activity con tu usuario.</span>
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

      <div className="task-filters">
        <div className="search-field">
          <IconSearch size={15} />
          <input
            type="search"
            placeholder="Buscar por asunto, tipo o registro..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar actividades"
          />
        </div>

        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          aria-label="Filtrar por estado"
        >
          <option value="pending">Todas las pendientes</option>
          <option value="today">Vencidas y de hoy</option>
          <option value="overdue">Solo vencidas</option>
        </select>

        {counts.overdue > 0 && (
          <span className="pill is-danger">
            {counts.overdue} vencida{counts.overdue > 1 ? 's' : ''}
          </span>
        )}
        {counts.today > 0 && <span className="pill">{counts.today} para hoy</span>}

        <button className="btn-secondary btn-sm" onClick={load} style={{ marginLeft: 'auto' }}>
          <IconRefresh size={14} />
          Actualizar
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            {search || stateFilter !== 'pending' ? <IconSearch size={20} /> : <IconTasks size={20} />}
          </span>
          <strong>
            {search || stateFilter !== 'pending'
              ? 'Sin resultados'
              : 'No tienes actividades pendientes'}
          </strong>
          <span>
            {search || stateFilter !== 'pending'
              ? 'Ninguna actividad coincide con los filtros.'
              : 'Las actividades que te programen en Odoo aparecerán aquí.'}
          </span>
        </div>
      ) : (
        <>
          <div className="activity-table-head">
            <span>Actividad</span>
            <span>Relacionada con</span>
            <span>Vencimiento</span>
            <span className="align-end">Acción</span>
          </div>

          {visible.map((activity) => {
            const type = activity.activity_type_id ? activity.activity_type_id[1] : 'Actividad';
            const note = plainText(activity.note);
            const overdue = activity.state === 'overdue';

            return (
              <div key={activity.id} className={`activity-row ${overdue ? 'is-overdue' : ''}`}>
                <div className="activity-main">
                  <span className="activity-type">{type}</span>
                  <span className="activity-summary" title={note || undefined}>
                    {activity.summary || note || 'Sin asunto'}
                  </span>
                </div>

                <div className="activity-record">
                  <button
                    className="task-link"
                    onClick={() =>
                      window.api.openRecordInOdoo(activity.res_model, activity.res_id).catch(() => {})
                    }
                    title={`Abrir en Odoo (${activity.res_model})`}
                  >
                    <span>{activity.res_name || `#${activity.res_id}`}</span>
                    <IconExternal size={13} />
                  </button>
                  <span className="activity-model">
                    {MODEL_LABELS[activity.res_model] || activity.res_model}
                  </span>
                </div>

                <div className={`activity-deadline ${overdue ? 'is-overdue' : ''}`}>
                  {overdue && <IconAlert size={13} />}
                  <div>
                    <div>{formatOdooDateShort(activity.date_deadline)}</div>
                    <span className="activity-state">{stateLabel(activity.state)}</span>
                  </div>
                </div>

                <div className="task-action">
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => handleComplete(activity)}
                    disabled={busyId === activity.id}
                    title="Marcar la actividad como hecha en Odoo"
                  >
                    <IconCheck size={13} />
                    {busyId === activity.id ? 'Guardando...' : 'Hecha'}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
