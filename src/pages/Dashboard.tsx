import { useEffect, useMemo, useState } from 'react';
import { OdooTask, OdooUser, TimerState } from '../types';
import TaskList from '../components/TaskList';
import TaskFilters from '../components/TaskFilters';
import AttendanceCard from '../components/AttendanceCard';
import TimerBar from '../components/TimerBar';
import SettingsModal from '../components/SettingsModal';
import ProductivityPanel from '../components/ProductivityPanel';
import StopTimerDialog from '../components/StopTimerDialog';
import TicketList from '../components/TicketList';
import FocusTimer from '../components/FocusTimer';
import TeamPanel from '../components/TeamPanel';
import { initialsOf } from '../lib/format';
import { ecuadorDateKey, isPast, parseOdooDateTime } from '../lib/odooDate';
import { DateFilter, matchesDateFilter } from '../lib/taskDates';
import {
  IconAlert,
  IconLogout,
  IconRefresh,
  IconSettings,
  IconTasks,
  LogoMark,
} from '../components/Icons';

interface Props {
  user: OdooUser;
  onLoggedOut: () => void;
}

const OLD_OVERDUE_DAYS = 30;

function isOldOverdue(task: OdooTask) {
  const deadline = parseOdooDateTime(task.date_deadline);
  if (!deadline) return false;
  return deadline.getTime() < Date.now() - OLD_OVERDUE_DAYS * 24 * 60 * 60 * 1000;
}

export default function Dashboard({ user, onLoggedOut }: Props) {
  const [tasks, setTasks] = useState<OdooTask[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<OdooTask[]>([]);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [showOldOverdue, setShowOldOverdue] = useState(false);
  const [showNoProject, setShowNoProject] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Marca el instante en que se pidió detener: el cronómetro se congela ahí.
  const [stopRequestedAt, setStopRequestedAt] = useState<number | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [tab, setTab] = useState<'tasks' | 'tickets' | 'productivity' | 'team'>('tasks');
  // La pestaña de equipo solo existe para quien administra Empleados en Odoo.
  const [canManageTeam, setCanManageTeam] = useState(false);

  // Iniciar un cronómetro entra directo a la vista de enfoque; detenerlo o descartarlo la cierra.
  function handleTimerChange(next: TimerState | null) {
    setTimer(next);
    setFocusMode(next !== null);
  }

  function clearTimer() {
    setStopRequestedAt(null);
    setFocusMode(false);
    setTimer(null);
  }

  async function loadAll() {
    setError(null);
    setLoading(true);
    try {
      const [taskList, timerState] = await Promise.all([
        window.api.listTasks(),
        window.api.getTimerState(),
      ]);
      setTasks(taskList);
      setTimer(timerState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar las tareas');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const unsubscribe = window.api.onOverdueUpdate(setOverdueTasks);
    // Detener desde la miniatura flotante abre aquí el diálogo de descripción.
    const unsubscribeStop = window.api.onStopRequested(() => setStopRequestedAt(Date.now()));
    window.api.listOverdueTasks().then(setOverdueTasks).catch(() => {});
    window.api.canManageTeam().then(setCanManageTeam).catch(() => setCanManageTeam(false));
    return () => {
      unsubscribe();
      unsubscribeStop();
    };
  }, []);

  const overdueCount = useMemo(() => {
    const ids = new Set(overdueTasks.map((t) => t.id));
    tasks.filter((t) => isPast(t.date_deadline)).forEach((t) => ids.add(t.id));
    return ids.size;
  }, [overdueTasks, tasks]);

  const projects = useMemo(() => {
    const map = new Map<number, string>();
    tasks.forEach((t) => {
      if (t.project_id) map.set(t.project_id[0], t.project_id[1]);
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [tasks]);

  const stages = useMemo(() => {
    const map = new Map<number, string>();
    tasks.forEach((t) => {
      if (t.stage_id) map.set(t.stage_id[0], t.stage_id[1]);
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [tasks]);

  const oldOverdueCount = useMemo(() => tasks.filter(isOldOverdue).length, [tasks]);

  // Sin proyecto no se puede registrar tiempo en Odoo, así que por defecto no estorban.
  const noProjectCount = useMemo(() => tasks.filter((t) => !t.project_id).length, [tasks]);

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const today = ecuadorDateKey(new Date());
    return tasks.filter((task) => {
      if (!showOldOverdue && isOldOverdue(task)) return false;
      if (!showNoProject && !task.project_id) return false;

      if (projectFilter !== 'all') {
        const projectId = task.project_id ? task.project_id[0] : null;
        if (String(projectId) !== projectFilter) return false;
      }

      if (stageFilter !== 'all') {
        const stageId = task.stage_id ? task.stage_id[0] : null;
        if (String(stageId) !== stageFilter) return false;
      }

      if (!matchesDateFilter(task, dateFilter, today)) return false;

      if (query) {
        const haystack = `${task.name} ${task.project_id ? task.project_id[1] : ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });
  }, [tasks, search, projectFilter, stageFilter, dateFilter, showOldOverdue, showNoProject]);

  const isFiltered = visibleTasks.length !== tasks.length;

  async function handleLogout() {
    await window.api.logout();
    onLoggedOut();
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <LogoMark size={30} />
          <div className="app-brand-text">
            <strong>Elideysi</strong>
            <span>Gestión de tiempo y tareas</span>
          </div>
        </div>

        <div className="app-user">
          <div className="app-user-info">
            <strong>{user.name}</strong>
            <span>{user.login}</span>
          </div>

          {user.image_128 ? (
            <img
              className="avatar avatar-img"
              src={`data:image/png;base64,${user.image_128}`}
              alt={user.name}
            />
          ) : (
            <span className="avatar">{initialsOf(user.name)}</span>
          )}

          <button
            className="btn-ghost btn-icon"
            onClick={() => setShowSettings(true)}
            title="Configuración"
            aria-label="Configuración"
          >
            <IconSettings size={16} />
          </button>
          <button className="btn-ghost btn-sm" onClick={handleLogout} title="Cerrar sesión">
            <IconLogout size={15} />
            Salir
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="app-content">
          <div className="page-head">
            <div>
              <h1>Resumen de hoy</h1>
              <p>Controla tu jornada, tus tareas y el tiempo dedicado a cada una.</p>
            </div>
            <button className="btn-secondary btn-sm" onClick={loadAll} disabled={loading}>
              <IconRefresh size={14} />
              {loading ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>

          {error && (
            <div className="alert alert-danger">
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="overview-grid">
            <AttendanceCard />

            <section className="card stat-card">
              <span className="card-label">
                <IconTasks size={13} />
                Tareas asignadas
              </span>
              <span className="stat-value">{tasks.length}</span>
              <span className="stat-foot">Activas a tu nombre en Odoo</span>
            </section>

            <section className="card stat-card">
              <span className="card-label">
                <IconAlert size={13} />
                Caducadas
              </span>
              <span className={`stat-value ${overdueCount > 0 ? 'is-danger' : ''}`}>
                {overdueCount}
              </span>
              <span className="stat-foot">
                {overdueCount > 0 ? 'Requieren atención inmediata' : 'Todo al día'}
              </span>
            </section>
          </div>

          {overdueCount > 0 && (
            <div className="alert alert-warning">
              <IconAlert size={16} />
              <span>
                Tienes <strong>{overdueCount}</strong> tarea{overdueCount > 1 ? 's' : ''} con la
                fecha límite vencida. Recibirás un aviso en el escritorio mientras sigan pendientes.
              </span>
            </div>
          )}

          <div className="tabs" role="tablist">
            <button
              className={`tab ${tab === 'tasks' ? 'is-active' : ''}`}
              onClick={() => setTab('tasks')}
              role="tab"
              aria-selected={tab === 'tasks'}
            >
              Mis tareas
            </button>
            <button
              className={`tab ${tab === 'tickets' ? 'is-active' : ''}`}
              onClick={() => setTab('tickets')}
              role="tab"
              aria-selected={tab === 'tickets'}
            >
              Tickets
            </button>
            <button
              className={`tab ${tab === 'productivity' ? 'is-active' : ''}`}
              onClick={() => setTab('productivity')}
              role="tab"
              aria-selected={tab === 'productivity'}
            >
              Productividad
            </button>
            {canManageTeam && (
              <button
                className={`tab ${tab === 'team' ? 'is-active' : ''}`}
                onClick={() => setTab('team')}
                role="tab"
                aria-selected={tab === 'team'}
              >
                Equipo
              </button>
            )}
          </div>

          {tab === 'tickets' && (
            <section className="card">
              <div className="panel-head">
                <div className="panel-title">
                  <h2>Mis tickets</h2>
                </div>
                {timer?.kind === 'ticket' && (
                  <span className="pill is-brand">
                    <span className="dot is-live" />
                    Cronómetro activo
                  </span>
                )}
              </div>

              <TicketList
                timer={timer}
                onTimerChange={handleTimerChange}
                onRequestStop={() => setStopRequestedAt(Date.now())}
                frozenAt={stopRequestedAt}
              />
            </section>
          )}

          {tab === 'productivity' && <ProductivityPanel />}

          {tab === 'team' && canManageTeam && <TeamPanel />}

          {tab === 'tasks' && (
            <section className="card">
              <div className="panel-head">
                <div className="panel-title">
                  <h2>Mis tareas</h2>
                  <span className="count-chip">
                    {isFiltered ? `${visibleTasks.length} de ${tasks.length}` : tasks.length}
                  </span>
                </div>
                {timer?.kind === 'task' && (
                  <span className="pill is-brand">
                    <span className="dot is-live" />
                    Cronómetro activo
                  </span>
                )}
              </div>

              <TaskFilters
                search={search}
                onSearchChange={setSearch}
                projectFilter={projectFilter}
                onProjectFilterChange={setProjectFilter}
                projects={projects}
                stages={stages}
                stageFilter={stageFilter}
                onStageFilterChange={setStageFilter}
                dateFilter={dateFilter}
                onDateFilterChange={setDateFilter}
                oldOverdueCount={oldOverdueCount}
                showOldOverdue={showOldOverdue}
                onToggleOldOverdue={() => setShowOldOverdue((v) => !v)}
                noProjectCount={noProjectCount}
                showNoProject={showNoProject}
                onToggleNoProject={() => setShowNoProject((v) => !v)}
              />

              <TaskList
                tasks={visibleTasks}
                timer={timer}
                onTimerChange={handleTimerChange}
                onRequestStop={() => setStopRequestedAt(Date.now())}
                frozenAt={stopRequestedAt}
                loading={loading}
                filtered={isFiltered || search.trim() !== '' || projectFilter !== 'all' || stageFilter !== 'all' || dateFilter !== 'all'}
              />
            </section>
          )}
        </div>
      </main>

      {timer && !focusMode && (
        <TimerBar
          timer={timer}
          frozenAt={stopRequestedAt}
          onRequestStop={() => setStopRequestedAt(Date.now())}
          onDiscarded={clearTimer}
          onEnterFocus={() => setFocusMode(true)}
          onTimerChange={setTimer}
        />
      )}

      {timer && focusMode && (
        <FocusTimer
          timer={timer}
          frozenAt={stopRequestedAt}
          onRequestStop={() => setStopRequestedAt(Date.now())}
          onDiscarded={clearTimer}
          onExit={() => setFocusMode(false)}
          onTimerChange={setTimer}
        />
      )}

      {timer && stopRequestedAt !== null && (
        <StopTimerDialog
          timer={timer}
          stoppedAt={stopRequestedAt}
          onRegistered={clearTimer}
          onDiscarded={clearTimer}
          onCancel={() => setStopRequestedAt(null)}
        />
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
