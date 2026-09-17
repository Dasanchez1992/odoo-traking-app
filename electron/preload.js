const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  restoreSession: () => ipcRenderer.invoke('auth:restore'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  listTasks: () => ipcRenderer.invoke('tasks:list'),
  listOverdueTasks: () => ipcRenderer.invoke('tasks:overdue'),
  openTaskInOdoo: (taskId) => ipcRenderer.invoke('tasks:open', taskId),
  getProductivity: () => ipcRenderer.invoke('stats:productivity'),
  canManageTeam: () => ipcRenderer.invoke('team:available'),
  getTeamSummary: () => ipcRenderer.invoke('team:summary'),

  listTickets: () => ipcRenderer.invoke('tickets:list'),
  openTicketInOdoo: (ticketId) => ipcRenderer.invoke('tickets:open', ticketId),

  getTimerState: () => ipcRenderer.invoke('timer:state'),
  startTimer: (item, kind) => ipcRenderer.invoke('timer:start', item, kind),
  stopTimer: (payload) => ipcRenderer.invoke('timer:stop', payload),
  discardTimer: () => ipcRenderer.invoke('timer:discard'),

  getAttendanceStatus: () => ipcRenderer.invoke('attendance:status'),
  toggleAttendance: () => ipcRenderer.invoke('attendance:toggle'),
  closeOpenAttendance: () => ipcRenderer.invoke('attendance:close-open'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  showMainWindow: () => ipcRenderer.invoke('mini:show-main'),
  requestStopFromMini: () => ipcRenderer.invoke('mini:request-stop'),

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
