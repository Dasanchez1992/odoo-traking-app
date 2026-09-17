const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  restoreSession: () => ipcRenderer.invoke('auth:restore'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  listTasks: () => ipcRenderer.invoke('tasks:list'),
  listOverdueTasks: () => ipcRenderer.invoke('tasks:overdue'),
  openTaskInOdoo: (taskId) => ipcRenderer.invoke('tasks:open', taskId),
  getProductivity: () => ipcRenderer.invoke('stats:productivity'),

  listActivities: () => ipcRenderer.invoke('activities:list'),
  completeActivity: (activityId) => ipcRenderer.invoke('activities:complete', activityId),
  openRecordInOdoo: (model, recordId) => ipcRenderer.invoke('record:open', model, recordId),
  canManageTeam: () => ipcRenderer.invoke('team:available'),
  getTeamSummary: () => ipcRenderer.invoke('team:summary'),

  listTickets: () => ipcRenderer.invoke('tickets:list'),
  openTicketInOdoo: (ticketId) => ipcRenderer.invoke('tickets:open', ticketId),

  getTimerState: () => ipcRenderer.invoke('timer:state'),
  startTimer: (item, kind) => ipcRenderer.invoke('timer:start', item, kind),
  stopTimer: (payload) => ipcRenderer.invoke('timer:stop', payload),
  discardTimer: (key) => ipcRenderer.invoke('timer:discard', key),
  pauseTimer: (key) => ipcRenderer.invoke('timer:pause', key),
  resumeTimer: (key) => ipcRenderer.invoke('timer:resume', key),

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
