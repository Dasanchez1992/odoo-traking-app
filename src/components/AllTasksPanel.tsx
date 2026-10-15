import { useEffect, useState } from 'react';
import { OdooTask, TimerState } from '../types';
import TaskList from './TaskList';
import { IconAlert, IconSearch } from './Icons';

// Tope que devuelve Odoo por consulta; si se llena, conviene afinar la búsqueda.
const LIMITE = 100;
const RETARDO_MS = 350;

interface Props {
  timers: TimerState[];
  onTimersChange: (timers: TimerState[]) => void;
  onTimerStarted: () => void;
  onRequestStop: () => void;
  onTaskChanged: () => void;
  frozenAt: number | null;
  refreshSignal: number;
}

export default function AllTasksPanel({ refreshSignal, ...rest }: Props) {
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<OdooTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);

    // La búsqueda va contra Odoo, así que se espera a que el usuario deje de escribir.
    const id = setTimeout(
      () => {
        window.api
          .searchAllTasks(query)
          .then((lista) => {
            if (cancelado) return;
            setTasks(lista);
            setError(null);
          })
          .catch((err) => {
            if (cancelado) return;
            setError(err instanceof Error ? err.message : 'No se pudieron buscar las tareas');
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

  return (
    <section className="card">
      <div className="panel-head">
        <div className="panel-title">
          <h2>Todas las tareas</h2>
          <span className="count-chip">{tasks.length}</span>
        </div>
      </div>

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
            placeholder="Buscar por tarea o proyecto en todo Odoo..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar entre todas las tareas"
          />
        </div>
      </div>

      <p className="browse-hint">
        Tareas abiertas de todos los proyectos que puedes ver, estés asignado o no, para imputar
        tiempo cuando ayudas en algo que no es tuyo.
        {tasks.length >= LIMITE && ' Se muestran las 100 más recientes: afina la búsqueda.'}
      </p>

      <TaskList {...rest} tasks={tasks} loading={loading} filtered showAssignee />
    </section>
  );
}
