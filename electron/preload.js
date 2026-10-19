const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  restoreSession: () => ipcRenderer.invoke('auth:restore'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  listTasks: () => ipcRenderer.invoke('tasks:list'),
  listOverdueTasks: () => ipcRenderer.invoke('tasks:overdue'),
  searchAllTasks: (query) => ipcRenderer.invoke('tasks:search-all', query),
  searchAllTickets: (query) => ipcRenderer.invoke('tickets:search-all', query),
  openTaskInOdoo: (taskId) => ipcRenderer.invoke('tasks:open', taskId),
  getProductivity: () => ipcRenderer.invoke('stats:productivity'),

  getProjects: () => ipcRenderer.invoke('projects:list'),
  getProjectTasks: (projectId) => ipcRenderer.invoke('projects:tasks', projectId),
  getUnassignedTimesheets: () => ipcRenderer.invoke('timesheets:unassigned'),
  assignTimesheetTask: (lineId, taskId) => ipcRenderer.invoke('timesheets:assign', lineId, taskId),
  deleteTimesheet: (lineId) => ipcRenderer.invoke('timesheets:delete', lineId),

  getStages: (kind, parentId) => ipcRenderer.invoke('record:stages', kind, parentId),
  setStage: (kind, recordId, stageId) => ipcRenderer.invoke('record:set-stage', kind, recordId, stageId),
  getRecordMessages: (kind, recordId) => ipcRenderer.invoke('record:messages', kind, recordId),
  postRecordMessage: (kind, recordId, payload) =>
    ipcRenderer.invoke('record:post-message', kind, recordId, payload),
  getMentionableUsers: () => ipcRenderer.invoke('users:mentionable'),

  listActivities: () => ipcRenderer.invoke('activities:list'),
  completeActivity: (activityId) => ipcRenderer.invoke('activities:complete', activityId),
  openRecordInOdoo: (model, recordId) => ipcRenderer.invoke('record:open', model, recordId),
  canManageTeam: () => ipcRenderer.invoke('team:available'),
  getTeamSummary: () => ipcRenderer.invoke('team:summary'),
  getTeamSchedule: () => ipcRenderer.invoke('team:schedule'),

  listTickets: () => ipcRenderer.invoke('tickets:list'),
  openTicketInOdoo: (ticketId) => ipcRenderer.invoke('tickets:open', ticketId),

  getTimerState: () => ipcRenderer.invoke('timer:state'),
  startTimer: (item, kind) => ipcRenderer.invoke('timer:start', item, kind),
  stopTimer: (payload) => ipcRenderer.invoke('timer:stop', payload),
  discardTimer: (key) => ipcRenderer.invoke('timer:discard', key),
  pauseTimer: (key) => ipcRenderer.invoke('timer:pause', key),
  resumeTimer: (key) => ipcRenderer.invoke('timer:resume', key),

  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getUpdateStatus: () => ipcRenderer.invoke('updates:status'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  getPendingReleaseNotes: () => ipcRenderer.invoke('updates:pending-notes'),
  markReleaseNotesSeen: () => ipcRenderer.invoke('updates:notes-seen'),
  openReleasePage: () => ipcRenderer.invoke('updates:open-release'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },

  listNotifications: () => ipcRenderer.invoke('notifications:list'),
  markNotificationsRead: () => ipcRenderer.invoke('notifications:mark-read'),
  clearNotifications: () => ipcRenderer.invoke('notifications:clear'),

  getAttendanceStatus: () => ipcRenderer.invoke('attendance:status'),
  toggleAttendance: () => ipcRenderer.invoke('attendance:toggle'),
  closeOpenAttendance: () => ipcRenderer.invoke('attendance:close-open'),
  diagnoseAttendance: () => ipcRenderer.invoke('attendance:diagnose'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  showMainWindow: () => ipcRenderer.invoke('mini:show-main'),
  requestStopFromMini: () => ipcRenderer.invoke('mini:request-stop'),

  onNotificationsUpdate: (callback) => {
    const listener = (_event, items) => callback(items);
    ipcRenderer.on('notifications:update', listener);
    return () => ipcRenderer.removeListener('notifications:update', listener);
  },

  onDataRefresh: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('data:refresh', listener);
    return () => ipcRenderer.removeListener('data:refresh', listener);
  },

  onStopRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('timer:stop-requested', listener);
    return () => ipcRenderer.removeListener('timer:stop-requested', listener);
  },

  onOverdueUpdate: (callback) => {
    const listener = (_event, tasks) => callback(tasks);
    ipcRenderer.on('overdue:update', listener);
    return () => ipcRenderer.removeListener('overdue:update', listener);
  },
});
