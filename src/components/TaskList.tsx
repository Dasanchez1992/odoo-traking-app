import { useState } from 'react';
import { OdooTask, TimerState } from '../types';
import { formatOdooDateShort, formatOdooDateTime, isPast } from '../lib/odooDate';
import { formatElapsed, timerElapsedMs, useNow } from '../lib/format';
import { IconAlert, IconChat, IconExternal, IconPlay, IconSearch, IconStop, IconTasks } from './Icons';
import RecordDetailModal from './RecordDetailModal';

interface Props {
  tasks: OdooTask[];
  timers: TimerState[];
  onTimersChange: (timers: TimerState[]) => void;
  onTimerStarted: () => void;
  onRequestStop: () => void;
  onTaskChanged: () => void;
  frozenAt: number | null;
  loading: boolean;
  filtered: boolean;
  /** En «Todas las tareas» importa de quién es cada una. */
  showAssignee?: boolean;
}

export default function TaskList({
  tasks,
  timers,
  onTimersChange,
  onTimerStarted,
  onRequestStop,
  onTaskChanged,
  frozenAt,
  loading,
  filtered,
  showAssignee = false,
}: Props) {
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [detailTask, setDetailTask] = useState<OdooTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = timers.some((t) => t.segmentStartedAt !== null);
  const now = useNow(running && frozenAt === null);
  const displayNow = frozenAt ?? now;

  // Iniciar otra tarea pausa la anterior en vez de perderla, así que basta con arrancar.
  async function handleStart(task: OdooTask) {
    setError(null);
    setBusyTaskId(task.id);
    try {
      await window.api.startTimer(task);
      onTimerStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el cronómetro');
    } finally {
      setBusyTaskId(null);
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

  if (tasks.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">
          {filtered ? <IconSearch size={20} /> : <IconTasks size={20} />}
        </span>
        <strong>{filtered ? 'Sin resultados' : 'No tienes tareas asignadas'}</strong>
        <span>
          {filtered
            ? 'Ninguna tarea coincide con los filtros aplicados.'
            : 'Cuando te asignen una tarea en Odoo, aparecerá aquí.'}
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

      <div className="task-table-head">
        <span>Tarea</span>
        <span>Proyecto</span>
        <span>Vencimiento</span>
        <span className="align-end">Tiempo</span>
      </div>

      {tasks.map((task) => {
        const taskTimer = timers.find((t) => t.kind === 'task' && t.taskId === task.id) ?? null;
        const isRunning = taskTimer !== null && taskTimer.segmentStartedAt !== null;
        const isPaused = taskTimer !== null && taskTimer.segmentStartedAt === null;
        const overdue = isPast(task.date_deadline);
        const isBusy = busyTaskId === task.id;
        // Odoo exige proyecto en las hojas de horas: sin él el tiempo no se podría registrar.
        const noProject = !task.project_id;

        return (
          <div key={task.id} className={`task-row ${isRunning ? 'is-running' : ''}`}>
            <div className="task-name">
              {/* En Odoo 19 la prioridad va de 0 a 3 estrellas, no es un booleano. */}
              {Number(task.priority) > 0 && (
                <span className="task-star" title={`Prioridad ${task.priority} de 3`}>
                  {'★'.repeat(Number(task.priority))}
                </span>
              )}
              <button
                className="task-link"
                onClick={() => window.api.openTaskInOdoo(task.id).catch(() => {})}
                title={`Abrir "${task.name}" en Odoo`}
              >
                <span>{task.name}</span>
                <IconExternal size={13} />
              </button>
            </div>

            <div
              className={`task-project ${showAssignee ? 'has-assignee' : ''}`}
              title={task.project_id ? task.project_id[1] : ''}
            >
              <span className="task-project-name">
                {task.project_id ? (
                  task.project_id[1]
                ) : (
                  <span className="task-no-project">Sin proyecto</span>
                )}
              </span>
              {showAssignee && (
                <span className="task-assignee" title={(task.assignee_names ?? []).join(', ')}>
                  {task.assignee_names && task.assignee_names.length > 0
                    ? task.assignee_names.join(', ')
                    : 'Sin responsable'}
                </span>
              )}
            </div>

            <div
              className={`task-deadline ${overdue ? 'is-overdue' : ''}`}
              title={task.date_deadline ? formatOdooDateTime(task.date_deadline) : undefined}
            >
              {task.date_deadline ? (
                <>
                  {overdue && <IconAlert size={13} />}
                  {formatOdooDateShort(task.date_deadline)}
                </>
              ) : (
                '—'
              )}
            </div>

            <div className="task-action">
              <button
                className="btn-ghost btn-icon"
                onClick={() => setDetailTask(task)}
                title="Cambiar etapa, dejar notas o etiquetar personas"
                aria-label={`Detalle de "${task.name}"`}
              >
                <IconChat size={15} />
              </button>
              {taskTimer && (
                <span className={`task-elapsed ${isPaused ? 'is-paused' : ''}`}>
                  {formatElapsed(timerElapsedMs(taskTimer, displayNow))}
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
                  onClick={() => handleStart(task)}
                  disabled={isBusy || noProject}
                  title={
                    noProject
                      ? 'Esta tarea no tiene proyecto en Odoo. Asígnale uno para poder registrar tiempo.'
                      : isPaused
                        ? 'Reanudar el cronómetro de esta tarea'
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

      {detailTask && (
        <RecordDetailModal
          kind="task"
          id={detailTask.id}
          title={detailTask.name}
          parentId={detailTask.project_id ? detailTask.project_id[0] : null}
          parentName={detailTask.project_id ? detailTask.project_id[1] : 'Sin proyecto'}
          stageId={detailTask.stage_id ? detailTask.stage_id[0] : null}
          onClose={() => setDetailTask(null)}
          onChanged={onTaskChanged}
        />
      )}
    </div>
  );
}
