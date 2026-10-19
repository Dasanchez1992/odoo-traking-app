export interface Credentials {
  url: string;
  db: string;
  username: string;
  password: string;
}

export interface OdooUser {
  name: string;
  login: string;
  image_128?: string | false;
}

export interface OdooTask {
  id: number;
  name: string;
  project_id: [number, string] | false;
  date_deadline: string | false;
  priority: string;
  stage_id: [number, string] | false;
  partner_id?: [number, string] | false;
  planned_date_begin?: string | false;
  allocated_hours?: number;
  /** Solo en «Todas las tareas»: de quién es la tarea. */
  assignee_names?: string[];
  effective_hours?: number;
  remaining_hours?: number;
}

export interface OdooTicket {
  id: number;
  name: string;
  ticket_ref?: string | false;
  partner_id?: [number, string] | false;
  team_id: [number, string] | false;
  stage_id: [number, string] | false;
  priority: string;
  create_date: string;
  user_id?: [number, string] | false;
  project_id?: [number, string] | false;
  sla_deadline?: string | false;
  total_hours_spent?: number;
}

export interface TicketsResult {
  available: boolean;
  tickets: OdooTicket[];
  reason?: string;
}

export interface OdooProject {
  id: number;
  name: string;
}

export interface ProjectTask {
  id: number;
  name: string;
  stage_id: [number, string] | false;
}

/** Línea de hoja de horas imputada al proyecto, sin tarea todavía. */
export interface UnassignedTimesheet {
  id: number;
  name: string;
  date: string;
  unit_amount: number;
  project_id: [number, string] | false;
}

/** Registros de Odoo que la app deja comentar y cambiar de etapa. */
export type RecordKind = 'task' | 'ticket';

export interface TaskStage {
  id: number;
  name: string;
  sequence: number;
  fold: boolean;
}

export interface OdooMessage {
  id: number;
  body: string;
  date: string;
  author_id: [number, string] | false;
  subtype_id: [number, string] | false;
}

export interface MentionableUser {
  id: number;
  name: string;
  partner_id: [number, string] | false;
}

export interface OdooActivity {
  id: number;
  res_model: string;
  res_id: number;
  res_name: string | false;
  activity_type_id: [number, string] | false;
  summary: string | false;
  note: string | false;
  date_deadline: string | false;
  // Calculado por Odoo: vencida, para hoy o planificada.
  state: 'overdue' | 'today' | 'planned' | string;
  create_date: string;
}

export interface ActivitiesResult {
  available: boolean;
  activities: OdooActivity[];
  reason?: string;
}

export type TimerKind = 'task' | 'ticket' | 'project';

export interface TimerContext {
  partnerName: string | null;
  stageName: string | null;
  priority: string;
  allocatedHours: number | null;
  spentHours: number | null;
  slaDeadline: string | false | null;
}

export interface UpdateStatus {
  state: 'idle' | 'dev' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

export interface ReleaseNotes {
  version: string;
  items: string[];
  url: string | null;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
}

export interface TimerState {
  key: string;
  kind: TimerKind;
  taskId: number;
  taskName: string;
  projectId: number | null;
  projectName?: string | null;
  context?: TimerContext;
  startedAt: number;
  // El tiempo se acumula por segmentos: segmentStartedAt es null mientras está en pausa.
  segmentStartedAt: number | null;
  accumulatedMs: number;
}

export interface AttendanceStatus {
  employeeId: number;
  open: { id: number; check_in: string | false } | null;
  // false cuando Odoo no deja leer el historial de asistencias de este usuario.
  readable: boolean;
  message?: string;
}

export interface TimesheetLine {
  date: string;
  unit_amount: number;
  project_id: [number, string] | false;
}

export interface AttendanceRecord {
  check_in: string;
  check_out: string | false;
  worked_hours: number;
}

export interface ProductivityData {
  sinceKey: string;
  days: number;
  lines: TimesheetLine[];
  attendances: AttendanceRecord[];
}

export interface TeamMember {
  id: number;
  name: string;
  department: string | null;
  hasUser: boolean;
  firstCheckIn: string | null;
  checkedIn: boolean;
  workedToday: number;
  workedWeek: number;
  loggedToday: number;
  loggedWeek: number;
}

export interface TeamSummary {
  today: string;
  weekStart: string;
  employees: TeamMember[];
}

export interface ScheduleTask {
  id: number;
  name: string;
  projectName: string | null;
  stageName: string | null;
  state: string | null;
  priority: string;
  plannedStart: string | null;
  deadline: string | null;
  allocatedHours: number;
  effectiveHours: number;
  userIds: number[];
}

export interface ScheduleMember {
  id: number;
  name: string;
  userId: number;
  department: string | null;
  currentTask: { id: number; name: string; hours: number } | null;
}

export interface TeamSchedule {
  today: string;
  employees: ScheduleMember[];
  tasks: ScheduleTask[];
}

export interface AiStatus {
  available: boolean;
  configured: boolean;
  /** Clave enmascarada, solo para mostrarla en la configuración. */
  key?: string;
  reason?: string;
}

export interface TaskSuggestion {
  lineId: number;
  taskId: number | null;
  confidence: 'alta' | 'media' | 'baja';
  reason: string;
}

export interface WeeklySummary {
  since: string;
  until: string;
  byProject: { name: string; hours: number }[];
  text: string;
}

export interface TicketTriage {
  summary: string;
  priority: string;
  priorityReason: string;
  firstSteps: string[];
  relatedIds: number[];
  similar: { id: number; name: string; resolution: string }[];
}

export interface AppSettings {
  startAtLogin: boolean;
  remindersEnabled: boolean;
  floatingWidget: boolean;
  showReleaseNotes: boolean;
  aiEnabled: boolean;
  autoAttendance: boolean;
  /** Hora 'HH:MM' en zona de Ecuador. */
  autoCheckIn: string;
  autoCheckOut: string;
  startAtLoginSupported: boolean;
}

export interface ElectronApi {
  login: (credentials: Credentials) => Promise<OdooUser>;
  restoreSession: () => Promise<OdooUser | null>;
  logout: () => Promise<boolean>;

  listTasks: () => Promise<OdooTask[]>;
  listOverdueTasks: () => Promise<OdooTask[]>;
  searchAllTasks: (query: string) => Promise<OdooTask[]>;
  searchAllTickets: (query: string) => Promise<TicketsResult>;
  openTaskInOdoo: (taskId: number) => Promise<string>;
  getProductivity: () => Promise<ProductivityData>;

  getAiStatus: () => Promise<AiStatus>;
  saveAiKey: (key: string) => Promise<{ configured: boolean; encrypted: boolean; key: string }>;
  clearAiKey: () => Promise<{ configured: boolean }>;
  draftDescription: (payload: {
    kind?: RecordKind;
    recordId?: number;
    taskName: string;
    projectName?: string | null;
    stageName?: string | null;
    minutes: number;
    notes?: string;
  }) => Promise<string>;
  suggestTaskForLine: (payload: {
    lineId: number;
    description: string;
    projectId: number;
    projectName: string;
    date: string;
  }) => Promise<TaskSuggestion>;
  getWeeklySummary: () => Promise<WeeklySummary>;
  triageTicket: (ticketId: number) => Promise<TicketTriage>;

  getProjects: () => Promise<OdooProject[]>;
  getProjectTasks: (projectId: number) => Promise<ProjectTask[]>;
  getUnassignedTimesheets: () => Promise<UnassignedTimesheet[]>;
  assignTimesheetTask: (lineId: number, taskId: number) => Promise<{ id: number; taskId: number }>;
  deleteTimesheet: (lineId: number) => Promise<{ id: number }>;

  getStages: (kind: RecordKind, parentId: number | null) => Promise<TaskStage[]>;
  setStage: (
    kind: RecordKind,
    recordId: number,
    stageId: number,
  ) => Promise<{ stage_id: [number, string] | false }>;
  getRecordMessages: (kind: RecordKind, recordId: number) => Promise<OdooMessage[]>;
  postRecordMessage: (
    kind: RecordKind,
    recordId: number,
    payload: {
      body: string;
      mentions?: { partnerId: number; name: string }[];
      isNote?: boolean;
    },
  ) => Promise<unknown>;
  getMentionableUsers: () => Promise<MentionableUser[]>;

  listActivities: () => Promise<ActivitiesResult>;
  completeActivity: (activityId: number) => Promise<unknown>;
  openRecordInOdoo: (model: string, recordId: number) => Promise<string>;
  canManageTeam: () => Promise<boolean>;
  getTeamSummary: () => Promise<TeamSummary>;
  getTeamSchedule: () => Promise<TeamSchedule>;

  getTimerState: () => Promise<TimerState[]>;
  startTimer: (
    item: OdooTask | OdooTicket | { id: number; name: string; project_id: [number, string] },
    kind?: TimerKind,
  ) => Promise<TimerState>;

  listTickets: () => Promise<TicketsResult>;
  openTicketInOdoo: (ticketId: number) => Promise<string>;
  stopTimer: (payload?: {
    key?: string;
    description?: string;
    stoppedAt?: number;
    // Duración corregida por el usuario; si falta se usa la medida por el cronómetro.
    elapsedMs?: number;
  }) => Promise<TimerState & { stoppedAt: number; timesheetId: number }>;
  discardTimer: (key?: string) => Promise<TimerState[]>;
  pauseTimer: (key?: string) => Promise<TimerState>;
  resumeTimer: (key?: string) => Promise<TimerState>;

  getAppVersion: () => Promise<string>;
  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<boolean>;
  getPendingReleaseNotes: () => Promise<ReleaseNotes | null>;
  markReleaseNotesSeen: () => Promise<boolean>;
  openReleasePage: () => Promise<boolean>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;

  listNotifications: () => Promise<AppNotification[]>;
  markNotificationsRead: () => Promise<AppNotification[]>;
  clearNotifications: () => Promise<AppNotification[]>;
  onNotificationsUpdate: (callback: (items: AppNotification[]) => void) => () => void;
  onDataRefresh: (callback: () => void) => () => void;

  getAttendanceStatus: () => Promise<AttendanceStatus>;
  toggleAttendance: () => Promise<{ action: 'check_in' | 'check_out' | 'toggled'; at: string }>;
  closeOpenAttendance: () => Promise<{ action: string; at: string; closedId: number }>;
  diagnoseAttendance: () => Promise<Record<string, unknown>>;

  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;

  showMainWindow: () => Promise<boolean>;
  requestStopFromMini: () => Promise<boolean>;
  onStopRequested: (callback: () => void) => () => void;

  onOverdueUpdate: (callback: (tasks: OdooTask[]) => void) => () => void;
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}
