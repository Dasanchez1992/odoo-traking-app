import { useEffect, useMemo, useState } from 'react';
import { OdooProject, ProjectTask, TaskSuggestion, UnassignedTimesheet } from '../types';
import { formatOdooDateShort } from '../lib/odooDate';
import { IconAlert, IconCheck, IconClose, IconPlay, IconSparkle, IconTrash } from './Icons';
import SearchSelect from './SearchSelect';

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
  const [openCombo, setOpenCombo] = useState<string | null>(null);
  const [confirmLine, setConfirmLine] = useState<number | null>(null);
  const [aiOk, setAiOk] = useState(false);
  const [suggesting, setSuggesting] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Record<number, TaskSuggestion>>({});
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
    window.api
      .getAiStatus()
      .then((estado) => setAiOk(estado.available))
      .catch(() => setAiOk(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape cierra lo de más arriba: primero el buscador, luego la confirmación.
      if (openCombo !== null) {
        setOpenCombo(null);
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
  }, [onClose, starting, busyLine, openCombo, confirmLine]);

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

  // Cambiar el proyecto cambia también las tareas candidatas, así que se recargan y se
  // descarta lo que ya estuviera elegido o sugerido para esa fila.
  async function handleProjectChange(line: UnassignedTimesheet, projectId: number) {
    if (line.project_id && line.project_id[0] === projectId) return;
    const proyecto = projects.find((p) => p.id === projectId);
    if (!proyecto) return;

    setBusyLine(line.id);
    setError(null);
    try {
      await window.api.setTimesheetProject(line.id, projectId);
      setLines((actual) =>
        actual.map((l) =>
          l.id === line.id ? { ...l, project_id: [proyecto.id, proyecto.name] } : l,
        ),
      );
      setSelection(({ [line.id]: _descartada, ...resto }) => resto);
      setSuggestions(({ [line.id]: _vieja, ...resto }) => resto);

      if (!tasksByProject[projectId]) {
        const tareas = await window.api.getProjectTasks(projectId).catch(() => []);
        setTasksByProject((actual) => ({ ...actual, [projectId]: tareas }));
      }
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el proyecto');
    } finally {
      setBusyLine(null);
    }
  }

  async function handleSuggest(line: UnassignedTimesheet) {
    if (!line.project_id) return;
    setSuggesting(line.id);
    setError(null);
    try {
      const sugerencia = await window.api.suggestTaskForLine({
        lineId: line.id,
        description: line.name,
        projectId: line.project_id[0],
        projectName: line.project_id[1],
        date: line.date,
      });
      setSuggestions((actual) => ({ ...actual, [line.id]: sugerencia }));
      // La sugerencia se deja elegida, pero sigue haciendo falta confirmar con «Asignar».
      if (sugerencia.taskId) {
        setSelection((actual) => ({ ...actual, [line.id]: sugerencia.taskId as number }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sugerir la tarea');
    } finally {
      setSuggesting(null);
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
              <SearchSelect
                options={projects}
                value={projectId}
                onChange={setProjectId}
                isOpen={openCombo === 'project'}
                onOpenChange={(open) => setOpenCombo(open ? 'project' : null)}
                placeholder="Elegir proyecto..."
                emptyLabel="Sin proyectos disponibles"
                searchPlaceholder="Buscar proyecto..."
                disabled={loading}
                ariaLabel="Proyecto"
              />

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
                        <div className="free-time-project-combo">
                          <SearchSelect
                            options={projects}
                            value={line.project_id ? line.project_id[0] : null}
                            onChange={(nuevo) => handleProjectChange(line, nuevo)}
                            isOpen={openCombo === `proj:${line.id}`}
                            onOpenChange={(open) => setOpenCombo(open ? `proj:${line.id}` : null)}
                            placeholder="Sin proyecto"
                            emptyLabel="Sin proyectos"
                            searchPlaceholder="Buscar proyecto..."
                            disabled={busyLine === line.id}
                            ariaLabel={`Proyecto del tiempo del ${line.date}`}
                          />
                        </div>
                      </div>

                      <p className="free-time-desc" title={line.name}>
                        {line.name}
                      </p>

                      {suggestions[line.id] && (
                        <p
                          className={`free-time-suggestion ${
                            suggestions[line.id].taskId ? '' : 'is-empty'
                          }`}
                        >
                          <IconSparkle size={12} />
                          <span>
                            {suggestions[line.id].taskId
                              ? `Sugerencia (${suggestions[line.id].confidence}): ${suggestions[line.id].reason}`
                              : `Sin sugerencia clara: ${suggestions[line.id].reason}`}
                          </span>
                        </p>
                      )}

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
                          <SearchSelect
                            options={tareas}
                            value={selection[line.id] ?? null}
                            onChange={(taskId) =>
                              setSelection((actual) => ({ ...actual, [line.id]: taskId }))
                            }
                            isOpen={openCombo === `line:${line.id}`}
                            onOpenChange={(open) => setOpenCombo(open ? `line:${line.id}` : null)}
                            placeholder="Elegir tarea..."
                            emptyLabel="Sin tareas abiertas"
                            searchPlaceholder="Buscar tarea..."
                            ariaLabel={`Tarea para el tiempo del ${line.date}`}
                          />
                                                    <button
                            className="btn-secondary btn-sm"
                            onClick={() => handleAssign(line)}
                            disabled={busyLine === line.id || !selection[line.id]}
                          >
                            <IconCheck size={13} />
                            {busyLine === line.id ? 'Asignando...' : 'Asignar'}
                          </button>
                          {aiOk && tareas.length > 0 && (
                            <button
                              className="btn-ghost btn-icon"
                              onClick={() => handleSuggest(line)}
                              disabled={suggesting === line.id}
                              title="Sugerir a qué tarea pertenece este tiempo"
                              aria-label="Sugerir tarea"
                            >
                              <IconSparkle size={14} />
                            </button>
                          )}
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
