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
  project_id?: [number, string] | false;
  sla_deadline?: string | false;
  total_hours_spent?: number;
}

export interface TicketsResult {
  available: boolean;
  tickets: OdooTicket[];
  reason?: string;
}

export type TimerKind = 'task' | 'ticket';

export interface TimerContext {
  partnerName: string | null;
  stageName: string | null;
  priority: string;
  allocatedHours: number | null;
  spentHours: number | null;
  slaDeadline: string | false | null;
}

export interface TimerState {
  kind: TimerKind;
  taskId: number;
  taskName: string;
  projectId: number | null;
  projectName?: string | null;
  context?: TimerContext;
  startedAt: number;
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

export interface AppSettings {
  startAtLogin: boolean;
  remindersEnabled: boolean;
  startAtLoginSupported: boolean;
}

export interface ElectronApi {
  login: (credentials: Credentials) => Promise<OdooUser>;
  restoreSession: () => Promise<OdooUser | null>;
  logout: () => Promise<boolean>;

  listTasks: () => Promise<OdooTask[]>;
  listOverdueTasks: () => Promise<OdooTask[]>;
  openTaskInOdoo: (taskId: number) => Promise<string>;
  getProductivity: () => Promise<ProductivityData>;
  canManageTeam: () => Promise<boolean>;
  getTeamSummary: () => Promise<TeamSummary>;

  getTimerState: () => Promise<TimerState | null>;
  startTimer: (item: OdooTask | OdooTicket, kind?: TimerKind) => Promise<TimerState>;

  listTickets: () => Promise<TicketsResult>;
  openTicketInOdoo: (ticketId: number) => Promise<string>;
  stopTimer: (payload?: {
    description?: string;
    stoppedAt?: number;
  }) => Promise<TimerState & { stoppedAt: number; timesheetId: number }>;
  discardTimer: () => Promise<boolean>;

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
