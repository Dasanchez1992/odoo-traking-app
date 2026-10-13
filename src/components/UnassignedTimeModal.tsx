import { useEffect, useMemo, useRef, useState } from 'react';
import { OdooProject, ProjectTask, UnassignedTimesheet } from '../types';
import { formatOdooDateShort } from '../lib/odooDate';
import { IconAlert, IconCheck, IconClose, IconPlay, IconSearch, IconTrash } from './Icons';

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
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [confirmLine, setConfirmLine] = useState<number | null>(null);
  const comboRef = useRef<HTMLDivElement>(null);
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
      if (e.key !== 'Escape') return;
      // Escape cierra lo de más arriba: primero el buscador, luego la confirmación.
      if (projectOpen) {
        setProjectOpen(false);
        return;
      }
      if (confirmLine !== null) {
        setConfirmLine(null);
        return;
      }
      if (!starting && busyLine === null) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, starting, busyLine, projectOpen, confirmLine]);

  useEffect(() => {
    if (!projectOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!comboRef.current?.contains(event.target as Node)) setProjectOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [projectOpen]);

  const proyectoElegido = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const proyectosFiltrados = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  }, [projects, projectQuery]);

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

  async function handleDelete(line: UnassignedTimesheet) {
    setBusyLine(line.id);
    setError(null);
    try {
      await window.api.deleteTimesheet(line.id);
      setLines((actual) => actual.filter((l) => l.id !== line.id));
      setConfirmLine(null);
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el registro');
    } finally {
      setBusyLine(null);
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
              <div className="combo" ref={comboRef}>
                <button
                  type="button"
                  className="combo-input"
                  onClick={() => setProjectOpen((v) => !v)}
                  disabled={loading || projects.length === 0}
                  aria-haspopup="listbox"
                  aria-expanded={projectOpen}
                  title={proyectoElegido?.name}
                >
                  <span>
                    {projects.length === 0
                      ? 'Sin proyectos disponibles'
                      : (proyectoElegido?.name ?? 'Elegir proyecto...')}
                  </span>
                </button>

                {projectOpen && (
                  <div className="combo-list" role="listbox">
                    <div className="combo-search">
                      <IconSearch size={13} />
                      <input
                        type="search"
                        autoFocus
                        placeholder="Buscar proyecto..."
                        value={projectQuery}
                        onChange={(e) => setProjectQuery(e.target.value)}
                      />
                    </div>

                    {proyectosFiltrados.length === 0 ? (
                      <p className="notif-empty">Sin coincidencias.</p>
                    ) : (
                      proyectosFiltrados.map((project) => (
                        <button
                          type="button"
                          key={project.id}
                          className={`combo-option ${project.id === projectId ? 'is-active' : ''}`}
                          title={project.name}
                          onClick={() => {
                            setProjectId(project.id);
                            setProjectQuery('');
                            setProjectOpen(false);
                          }}
                        >
                          {project.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

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

                      {confirmLine === line.id ? (
                        <div className="free-time-confirm">
                          <span>¿Eliminar este registro de {formatHours(line.unit_amount)}?</span>
                          <button
                            className="btn-danger btn-sm"
                            onClick={() => handleDelete(line)}
                            disabled={busyLine === line.id}
                          >
                            {busyLine === line.id ? 'Eliminando...' : 'Eliminar'}
                          </button>
                          <button
                            className="btn-secondary btn-sm"
                            onClick={() => setConfirmLine(null)}
                            disabled={busyLine === line.id}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="free-time-assign">
                          <select
                            value={selection[line.id] ?? ''}
                            onChange={(e) =>
                              setSelection((actual) => ({
                                ...actual,
                                [line.id]: Number(e.target.value),
                              }))
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
                          <button
                            className="btn-ghost btn-icon free-time-delete"
                            onClick={() => setConfirmLine(line.id)}
                            title="Eliminar este registro de Odoo"
                            aria-label="Eliminar registro"
                          >
                            <IconTrash size={14} />
                          </button>
                        </div>
                      )}
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
