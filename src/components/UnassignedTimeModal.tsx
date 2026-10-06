import { useEffect, useMemo, useState } from 'react';
import { OdooProject, ProjectTask, UnassignedTimesheet } from '../types';
import { formatOdooDateShort } from '../lib/odooDate';
import { IconAlert, IconCheck, IconClose, IconPlay } from './Icons';

interface Props {
  onClose: () => void;
  onTimerStarted: () => void;
  onAssigned: () => void;
}

function formatHours(hours: number) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

export default function UnassignedTimeModal({ onClose, onTimerStarted, onAssigned }: Props) {
  const [projects, setProjects] = useState<OdooProject[]>([]);
  const [lines, setLines] = useState<UnassignedTimesheet[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<number, ProjectTask[]>>({});
  const [selection, setSelection] = useState<Record<number, number>>({});

  const [projectId, setProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyLine, setBusyLine] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [listaProyectos, listaLineas] = await Promise.all([
        window.api.getProjects().catch(() => []),
        window.api.getUnassignedTimesheets().catch(() => []),
      ]);
      setProjects(listaProyectos);
      setLines(listaLineas);
      setProjectId((actual) => actual ?? (listaProyectos[0]?.id ?? null));

      // Las tareas se cargan por proyecto para poder elegir sin un segundo clic.
      const ids = [
        ...new Set(
          listaLineas.map((line) => (line.project_id ? line.project_id[0] : 0)).filter(Boolean),
        ),
      ];
      const listas = await Promise.all(
        ids.map((id) =>
          window.api
            .getProjectTasks(id)
            .then((tareas) => [id, tareas] as const)
            .catch(() => [id, [] as ProjectTask[]] as const),
        ),
      );
      setTasksByProject(Object.fromEntries(listas));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !starting && busyLine === null) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, starting, busyLine]);

  const proyectoElegido = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  async function handleStart() {
    if (!proyectoElegido) {
      setError('Elige el proyecto al que va el tiempo.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      await window.api.startTimer(
        {
          id: proyectoElegido.id,
          name: 'Tiempo sin tarea',
          project_id: [proyectoElegido.id, proyectoElegido.name],
        },
        'project',
      );
      onTimerStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el cronómetro');
    } finally {
      setStarting(false);
    }
  }

  async function handleAssign(line: UnassignedTimesheet) {
    const taskId = selection[line.id];
    if (!taskId) {
      setError('Elige la tarea a la que pasa ese tiempo.');
      return;
    }
    setBusyLine(line.id);
    setError(null);
    try {
      await window.api.assignTimesheetTask(line.id, taskId);
      setLines((actual) => actual.filter((l) => l.id !== line.id));
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo asignar la tarea');
    } finally {
      setBusyLine(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => busyLine === null && !starting && onClose()}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>Tiempo sin tarea</h2>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar">
            <IconClose size={16} />
          </button>
        </div>

        <div className="modal-body task-detail-body">
          {error && (
            <div className="alert alert-danger">
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="tiempo-proyecto">
              Proyecto
            </label>
            <div className="free-time-start">
              <select
                id="tiempo-proyecto"
                value={projectId ?? ''}
                onChange={(e) => setProjectId(Number(e.target.value))}
                disabled={loading || projects.length === 0}
              >
                {projects.length === 0 && <option value="">Sin proyectos disponibles</option>}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button onClick={handleStart} disabled={starting || !proyectoElegido}>
                <IconPlay size={13} />
                {starting ? 'Iniciando...' : 'Iniciar cronómetro'}
              </button>
            </div>
            <span className="field-hint">
              Odoo exige proyecto en la hoja de horas, pero la tarea puede quedar pendiente. Al
              detener el cronómetro el tiempo queda aquí hasta que le asignes una.
            </span>
          </div>

          <div className="task-detail-history">
            <span className="field-label">Pendientes de asignar (últimos 30 días)</span>

            {loading ? (
              <p className="notif-empty">Cargando...</p>
            ) : lines.length === 0 ? (
              <p className="notif-empty">No tienes tiempo sin tarea.</p>
            ) : (
              <ul className="free-time-list">
                {lines.map((line) => {
                  const proyecto = line.project_id ? line.project_id[0] : 0;
                  const tareas = tasksByProject[proyecto] ?? [];
                  return (
                    <li className="free-time-row" key={line.id}>
                      <div className="free-time-meta">
                        <strong>{formatHours(line.unit_amount)}</strong>
                        <span>{formatOdooDateShort(line.date)}</span>
                        <span className="free-time-project">
                          {line.project_id ? line.project_id[1] : 'Sin proyecto'}
                        </span>
                      </div>

                      <p className="free-time-desc" title={line.name}>
                        {line.name}
                      </p>

                      <div className="free-time-assign">
                        <select
                          value={selection[line.id] ?? ''}
                          onChange={(e) =>
                            setSelection((actual) => ({ ...actual, [line.id]: Number(e.target.value) }))
                          }
                          disabled={tareas.length === 0}
                          aria-label={`Tarea para el tiempo del ${line.date}`}
                        >
                          <option value="">
                            {tareas.length === 0 ? 'Sin tareas abiertas' : 'Elegir tarea...'}
                          </option>
                          {tareas.map((task) => (
                            <option key={task.id} value={task.id}>
                              {task.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-secondary btn-sm"
                          onClick={() => handleAssign(line)}
                          disabled={busyLine === line.id || !selection[line.id]}
                        >
                          <IconCheck size={13} />
                          {busyLine === line.id ? 'Asignando...' : 'Asignar'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
