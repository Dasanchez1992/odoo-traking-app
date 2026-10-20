import { useEffect, useMemo, useState } from 'react';
import { OdooTask, OdooUser, TimerState } from '../types';
import TaskList from '../components/TaskList';
import AllTasksPanel from '../components/AllTasksPanel';
import ScopeSwitch, { Scope } from '../components/ScopeSwitch';
import AllTicketsPanel from '../components/AllTicketsPanel';
import MeetingsPanel from '../components/MeetingsPanel';
import UnassignedTimeModal from '../components/UnassignedTimeModal';
import ReleaseNotesModal from '../components/ReleaseNotesModal';
import TaskFilters from '../components/TaskFilters';
import AttendanceCard from '../components/AttendanceCard';
import TimerBar from '../components/TimerBar';
import SettingsPage from '../components/SettingsPage';
import ProductivityPanel from '../components/ProductivityPanel';
import StopTimerDialog from '../components/StopTimerDialog';
import TicketList from '../components/TicketList';
import FocusTimer from '../components/FocusTimer';
import TeamPanel from '../components/TeamPanel';
import TeamGantt from '../components/TeamGantt';
import ActivityList from '../components/ActivityList';
import NotificationsMenu from '../components/NotificationsMenu';
import { initialsOf } from '../lib/format';
import { ecuadorDateKey, isPast, parseOdooDateTime } from '../lib/odooDate';
import { DateFilter, matchesDateFilter } from '../lib/taskDates';
import { ReleaseNotes } from '../types';
import {
  IconAlert,
  IconClock,
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
  const [timers, setTimers] = useState<TimerState[]>([]);
  // Señal para que las listas hijas recarguen cuando el refresco de fondo avisa.
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [showOldOverdue, setShowOldOverdue] = useState(false);
  const [showNoProject, setShowNoProject] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFreeTime, setShowFreeTime] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotes | null>(null);
  // Marca el instante en que se pidió detener: el cronómetro se congela ahí.
  const [stopRequestedAt, setStopRequestedAt] = useState<number | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [tab, setTab] = useState<
    | 'tasks'
    | 'tickets'
    | 'activities'
    | 'meetings'
    | 'productivity'
    | 'team'
    | 'gantt'
  >('tasks');
  // La pestaña de equipo solo existe para quien administra Empleados en Odoo.
  const [taskScope, setTaskScope] = useState<Scope>('mias');
  const [ticketScope, setTicketScope] = useState<Scope>('mias');
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [canReviewUsage, setCanReviewUsage] = useState(false);

  // El activo es el único que corre; los demás quedaron en pausa al cambiar de tarea.
  const timer = timers.find((t) => t.segmentStartedAt !== null) ?? timers[0] ?? null;

  async function refreshTimers() {
    setTimers(await window.api.getTimerState());
  }

  // Iniciar un cronómetro entra directo a la vista de enfoque; detenerlo o descartarlo la cierra.
  function handleTimerStarted() {
    refreshTimers();
    setFocusMode(true);
  }

  // Tras cambiar la etapa o comentar se recarga en silencio: sin esqueleto de carga.
  async function refreshTasks() {
    try {
      setTasks(await window.api.listTasks());
    } catch {
      // Un fallo puntual no debe tapar la lista que ya se ve.
    }
  }

  function clearTimer() {
    setStopRequestedAt(null);
    setFocusMode(false);
    refreshTimers();
  }

  async function loadAll() {
    setError(null);
    setLoading(true);
    try {
      const [taskList, timerList] = await Promise.all([
        window.api.listTasks(),
        window.api.getTimerState(),
      ]);
      setTasks(taskList);
      setTimers(timerList);
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
    const unsubscribeRefresh = window.api.onDataRefresh(() => {
      loadAll();
      setRefreshSignal((n) => n + 1);
    });
    window.api.listOverdueTasks().then(setOverdueTasks).catch(() => {});
    // Tras una actualización automática, lo primero es contar qué cambió.
    window.api.getPendingReleaseNotes().then(setReleaseNotes).catch(() => {});
    window.api.canManageTeam().then(setCanManageTeam).catch(() => setCanManageTeam(false));
    window.api.canReviewUsage().then(setCanReviewUsage).catch(() => setCanReviewUsage(false));
    return () => {
      unsubscribe();
      unsubscribeStop();
      unsubscribeRefresh();
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
            <strong>Elipsys Time</strong>
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

          <NotificationsMenu />

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
          {showSettings ? (
            <SettingsPage onClose={() => setShowSettings(false)} />
          ) : (
          <>
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
              Mis tickets
            </button>
            <button
              className={`tab ${tab === 'activities' ? 'is-active' : ''}`}
              onClick={() => setTab('activities')}
              role="tab"
              aria-selected={tab === 'activities'}
            >
              Actividades
            </button>
            <button
              className={`tab ${tab === 'meetings' ? 'is-active' : ''}`}
              onClick={() => setTab('meetings')}
              role="tab"
              aria-selected={tab === 'meetings'}
            >
              Reuniones
            </button>
            <button
              className={`tab ${tab === 'productivity' ? 'is-active' : ''}`}
              onClick={() => setTab('productivity')}
              role="tab"
              aria-selected={tab === 'productivity'}
            >
              Productividad
            </button>
            {(canManageTeam || canReviewUsage) && (
              <button
                className={`tab ${tab === 'team' ? 'is-active' : ''}`}
                onClick={() => setTab('team')}
                role="tab"
                aria-selected={tab === 'team'}
              >
                Equipo
              </button>
            )}
            {canManageTeam && (
              <button
                className={`tab ${tab === 'gantt' ? 'is-active' : ''}`}
                onClick={() => setTab('gantt')}
                role="tab"
                aria-selected={tab === 'gantt'}
              >
                Reparto
              </button>
            )}
          </div>

          {tab === 'tickets' && ticketScope === 'mias' && (
            <section className="card">
              <div className="panel-head">
                <div className="panel-title">
                  <h2>Mis tickets</h2>
                </div>
                <div className="panel-actions">
                  {timer?.kind === 'ticket' && (
                    <span className="pill is-brand">
                      <span className="dot is-live" />
                      Cronómetro activo
                    </span>
                  )}
                  <ScopeSwitch
                    value={ticketScope}
                    onChange={setTicketScope}
                    mine="Míos"
                    all="Todos"
                  />
                </div>
              </div>

              <TicketList
                timers={timers}
                onTimersChange={setTimers}
                onTimerStarted={handleTimerStarted}
                refreshSignal={refreshSignal}
                onRequestStop={() => setStopRequestedAt(Date.now())}
                frozenAt={stopRequestedAt}
              />
            </section>
          )}

          {tab === 'tasks' && taskScope === 'todas' && (
            <AllTasksPanel
              scope={taskScope}
              onScopeChange={setTaskScope}
              timers={timers}
              onTimersChange={setTimers}
              onTimerStarted={handleTimerStarted}
              onRequestStop={() => setStopRequestedAt(Date.now())}
              onTaskChanged={refreshTasks}
              frozenAt={stopRequestedAt}
              refreshSignal={refreshSignal}
            />
          )}

          {tab === 'tickets' && ticketScope === 'todas' && (
            <AllTicketsPanel
              scope={ticketScope}
              onScopeChange={setTicketScope}
              timers={timers}
              onTimersChange={setTimers}
              onTimerStarted={handleTimerStarted}
              onRequestStop={() => setStopRequestedAt(Date.now())}
              frozenAt={stopRequestedAt}
              refreshSignal={refreshSignal}
            />
          )}

          {tab === 'activities' && (
            <section className="card">
              <div className="panel-head">
                <div className="panel-title">
                  <h2>Mis actividades</h2>
                </div>
              </div>
              <ActivityList refreshSignal={refreshSignal} />
            </section>
          )}

          {tab === 'meetings' && <MeetingsPanel />}

          {tab === 'productivity' && <ProductivityPanel key={refreshSignal} />}

          {tab === 'team' && (canManageTeam || canReviewUsage) && (
            <TeamPanel key={refreshSignal} showTeam={canManageTeam} />
          )}

          {tab === 'gantt' && canManageTeam && <TeamGantt key={refreshSignal} />}

          {tab === 'tasks' && taskScope === 'mias' && (
            <section className="card">
              <div className="panel-head">
                <div className="panel-title">
                  <h2>Mis tareas</h2>
                  <span className="count-chip">
                    {isFiltered ? `${visibleTasks.length} de ${tasks.length}` : tasks.length}
                  </span>
                </div>
                <div className="panel-actions">
                  {timer?.kind === 'task' && (
                    <span className="pill is-brand">
                      <span className="dot is-live" />
                      Cronómetro activo
                    </span>
                  )}
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setShowFreeTime(true)}
                    title="Registrar tiempo en un proyecto y asignarle la tarea después"
                  >
                    <IconClock size={13} />
                    Tiempo sin tarea
                  </button>
                  <ScopeSwitch value={taskScope} onChange={setTaskScope} mine="Mías" all="Todas" />
                </div>
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
                timers={timers}
                onTimersChange={setTimers}
                onTimerStarted={handleTimerStarted}
                onRequestStop={() => setStopRequestedAt(Date.now())}
                onTaskChanged={refreshTasks}
                frozenAt={stopRequestedAt}
                loading={loading}
                filtered={isFiltered || search.trim() !== '' || projectFilter !== 'all' || stageFilter !== 'all' || dateFilter !== 'all'}
              />
            </section>
          )}
          </>
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
          onTimersChange={setTimers}
          pausedCount={timers.filter((t) => t.key !== timer.key).length}
        />
      )}

      {timer && focusMode && (
        <FocusTimer
          timer={timer}
          frozenAt={stopRequestedAt}
          onRequestStop={() => setStopRequestedAt(Date.now())}
          onDiscarded={clearTimer}
          onExit={() => setFocusMode(false)}
          onTimersChange={setTimers}
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

      {releaseNotes && (
        <ReleaseNotesModal
          notes={releaseNotes}
          onClose={() => {
            setReleaseNotes(null);
            window.api.markReleaseNotesSeen().catch(() => {});
          }}
        />
      )}

      {showFreeTime && (
        <UnassignedTimeModal
          onClose={() => setShowFreeTime(false)}
          onTimerStarted={() => {
            setShowFreeTime(false);
            handleTimerStarted();
          }}
          onAssigned={refreshTasks}
        />
      )}
    </div>
  );
}
