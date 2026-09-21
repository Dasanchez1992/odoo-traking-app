const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  Tray,
  nativeImage,
  screen,
  session,
  shell,
} = require('electron');
const path = require('path');

const odooClient = require('./odooClient');
const odooService = require('./odooService');
const sessionStore = require('./sessionStore');
const settingsStore = require('./settingsStore');
const { formatOdooDateTime } = require('./dateUtil');
const { createReminderScheduler } = require('./reminders');
const {
  setupAutoUpdater,
  checkForUpdatesNow,
  installUpdateNow,
  getUpdateStatus,
} = require('./updater');

const OVERDUE_POLL_MS = 5 * 60 * 1000;
const REFRESH_MS = 5 * 60 * 1000;
const LONG_SHIFT_HOURS = 12;
const MAX_NOTIFICATIONS = 60;
const APP_ID = 'com.elipsys.elideysi';

let mainWindow = null;
let miniWindow = null;
let tray = null;
let client = null;
let overduePollTimer = null;
let notifiedTaskIds = new Set();
let isQuitting = false;
let refreshTimer = null;
// Historial de avisos, para poder revisarlos después de que el aviso del sistema desaparezca.
let notifications = [];
let notifiedKeys = new Set();

// Varios cronómetros a la vez: solo uno corre (segmentStartedAt != null) y el resto queda
// en pausa, para poder cambiar de tarea sin perder lo medido en la anterior.
let timers = [];
let stopInFlight = false;

const timerKey = (kind, id) => `${kind}:${id}`;
const findTimer = (key) => timers.find((t) => t.key === key) || null;
const activeTimer = () => timers.find((t) => t.segmentStartedAt !== null) || null;

function pauseTimerAt(timer, at) {
  if (timer.segmentStartedAt === null) return timer;
  return {
    ...timer,
    accumulatedMs: timer.accumulatedMs + Math.max(0, at - timer.segmentStartedAt),
    segmentStartedAt: null,
  };
}

function replaceTimer(next) {
  timers = timers.map((t) => (t.key === next.key ? next : t));
  return next;
}

const startedHidden = process.argv.includes('--hidden');

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 580,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    mainWindow.loadURL(startUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    if (!startedHidden) mainWindow.show();
  });

  // La miniatura solo aparece cuando la ventana principal no está a la vista.
  mainWindow.on('minimize', showMiniWindow);
  mainWindow.on('hide', showMiniWindow);
  mainWindow.on('restore', hideMiniWindow);
  mainWindow.on('show', hideMiniWindow);
  mainWindow.on('focus', hideMiniWindow);

  // Cerrar la ventana solo la oculta: la app sigue en la bandeja para poder recordar los fichajes.
  // Sin bandeja disponible se cierra de verdad, para no dejarla inaccesible.
  mainWindow.on('close', (event) => {
    if (isQuitting || !tray) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

// Miniatura flotante: acompaña al usuario mientras trabaja en otras ventanas.
function createMiniWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 290;
  const winHeight = 96;

  miniWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: width - winWidth - 24,
    y: height - winHeight - 24,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Por encima incluso de ventanas a pantalla completa.
  miniWindow.setAlwaysOnTop(true, 'screen-saver');
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    miniWindow.loadURL(`${startUrl}?widget=1`);
  } else {
    miniWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { search: 'widget=1' });
  }

  miniWindow.on('closed', () => {
    miniWindow = null;
  });
}

function showMiniWindow() {
  if (timers.length === 0) return;
  if (!miniWindow || miniWindow.isDestroyed()) createMiniWindow();
  miniWindow.showInactive();
}

function hideMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) miniWindow.hide();
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Elideysi - Gestión de tiempo y tareas');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Elideysi', click: showWindow },
        { type: 'separator' },
        {
          label: 'Salir',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', showWindow);
  } catch (err) {
    tray = null;
    console.error('No hay bandeja del sistema disponible:', err.message);
  }
}

function requireClient() {
  if (!client) throw new Error('No hay sesión activa con Odoo');
  return client;
}

function broadcast(channel, payload) {
  [mainWindow, miniWindow].forEach((win) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  });
}

function recordNotification(kind, title, body) {
  notifications = [
    { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, title, body, at: Date.now(), read: false },
    ...notifications,
  ].slice(0, MAX_NOTIFICATIONS);
  broadcast('notifications:update', notifications);
}

function notify(title, body, kind = 'info') {
  recordNotification(kind, title, body);
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  notification.on('click', showWindow);
  notification.show();
}

// Avisos que no vienen del escritorio pero conviene tener a mano: jornada sin cerrar y
// actividades que vencen hoy. Cada uno se emite una sola vez al día.
async function checkDailyAlerts() {
  if (!client) return;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const employeeId = await odooService.getEmployeeId(client);
    const open = await odooService.getOpenAttendance(client, employeeId);
    if (open && open.check_in) {
      const since = new Date(`${open.check_in.replace(' ', 'T')}Z`).getTime();
      const hours = (Date.now() - since) / 3600000;
      const key = `shift:${today}`;
      if (hours > LONG_SHIFT_HOURS && !notifiedKeys.has(key)) {
        notifiedKeys.add(key);
        notify(
          'Jornada sin cerrar',
          `Llevas ${Math.floor(hours)} h fichado. Marca la salida para poder volver a fichar.`,
          'attendance',
        );
      }
    }
  } catch {
    // Sin permisos de asistencia no hay nada que avisar.
  }

  try {
    const { available, activities } = await odooService.fetchActivities(client);
    if (!available) return;
    const dueToday = activities.filter((a) => a.state === 'today' || a.state === 'overdue');
    const key = `activities:${today}:${dueToday.length}`;
    if (dueToday.length > 0 && !notifiedKeys.has(key)) {
      notifiedKeys.add(key);
      notify(
        'Actividades pendientes',
        dueToday.length === 1
          ? `«${dueToday[0].summary || 'Actividad'}» vence hoy`
          : `Tienes ${dueToday.length} actividades que vencen hoy o están vencidas`,
        'activity',
      );
    }
  } catch {
    // mail.activity puede no estar disponible para este usuario.
  }
}

function startBackgroundRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!client) return;
    checkDailyAlerts();
    // El renderer recarga sus listas al recibirlo.
    broadcast('data:refresh', Date.now());
  }, REFRESH_MS);
}

function stopBackgroundRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function applyStartAtLogin(enabled) {
  if (process.platform === 'linux') return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    args: ['--hidden'],
  });
}

const reminders = createReminderScheduler({
  notify,
  isEnabled: () => settingsStore.read().remindersEnabled,
  getAttendanceState: async () => {
    if (!client) return 'unknown';
    try {
      const employeeId = await odooService.getEmployeeId(client);
      const open = await odooService.getOpenAttendance(client, employeeId);
      return open ? 'in' : 'out';
    } catch {
      return 'unknown';
    }
  },
});

function stopOverduePolling() {
  if (overduePollTimer) {
    clearInterval(overduePollTimer);
    overduePollTimer = null;
  }
  notifiedTaskIds = new Set();
  stopBackgroundRefresh();
}

async function pollOverdueTasks() {
  if (!client) return;
  try {
    const tasks = await odooService.fetchOverdueTasks(client);
    const freshlyOverdue = tasks.filter((t) => !notifiedTaskIds.has(t.id));
    freshlyOverdue.forEach((t) => notifiedTaskIds.add(t.id));

    if (freshlyOverdue.length === 1) {
      const t = freshlyOverdue[0];
      notify('Tarea caducada', `"${t.name}" venció el ${formatOdooDateTime(t.date_deadline)}`, 'task');
    } else if (freshlyOverdue.length > 1) {
      notify(
        'Tareas caducadas',
        `Tienes ${freshlyOverdue.length} tareas vencidas pendientes`,
        'task',
      );
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('overdue:update', tasks);
    }
  } catch (err) {
    console.error('Error al revisar tareas caducadas:', err.message);
  }
}

function startOverduePolling() {
  stopOverduePolling();
  pollOverdueTasks();
  checkDailyAlerts();
  startBackgroundRefresh();
  overduePollTimer = setInterval(pollOverdueTasks, OVERDUE_POLL_MS);
}

async function connectAndVerify(credentials) {
  const uid = await odooClient.login(credentials);
  const newClient = odooClient.makeClient({ ...credentials, uid });
  const [userInfo] = await newClient.execute_kw('res.users', 'read', [
    [uid],
    ['name', 'login', 'image_128'],
  ]);
  return { client: newClient, user: userInfo };
}

ipcMain.handle('auth:login', async (_event, credentials) => {
  const { client: newClient, user } = await connectAndVerify(credentials);
  client = newClient;
  sessionStore.save(credentials);
  startOverduePolling();
  return user;
});

ipcMain.handle('auth:restore', async () => {
  const saved = sessionStore.load();
  if (!saved) return null;
  try {
    const { client: newClient, user } = await connectAndVerify(saved);
    client = newClient;
    startOverduePolling();
    return user;
  } catch {
    sessionStore.clear();
    return null;
  }
});

ipcMain.handle('auth:logout', async () => {
  client = null;
  timers = [];
  hideMiniWindow();
  stopOverduePolling();
  sessionStore.clear();
  return true;
});

ipcMain.handle('tasks:list', async () => {
  return odooService.fetchAssignedTasks(requireClient());
});

ipcMain.handle('tasks:overdue', async () => {
  return odooService.fetchOverdueTasks(requireClient());
});

ipcMain.handle('tickets:list', async () => {
  return odooService.fetchAssignedTickets(requireClient());
});

ipcMain.handle('tickets:open', async (_event, ticketId) => {
  const c = requireClient();
  if (!Number.isInteger(ticketId)) throw new Error('Ticket inválido');
  const url = `${c.url.replace(/\/+$/, '')}/web#id=${ticketId}&model=helpdesk.ticket&view_type=form`;
  await shell.openExternal(url);
  return url;
});

ipcMain.handle('team:available', async () => {
  try {
    return await odooService.canManageTeam(requireClient());
  } catch {
    return false;
  }
});

ipcMain.handle('team:summary', async () => {
  return odooService.fetchTeamProductivity(requireClient());
});

ipcMain.handle('tasks:stages', async (_event, projectId) => {
  return odooService.fetchTaskStages(requireClient(), projectId ?? null);
});

ipcMain.handle('tasks:set-stage', async (_event, taskId, stageId) => {
  return odooService.setTaskStage(requireClient(), taskId, stageId);
});

ipcMain.handle('tasks:messages', async (_event, taskId) => {
  return odooService.fetchTaskMessages(requireClient(), taskId);
});

ipcMain.handle('tasks:post-message', async (_event, taskId, payload) => {
  return odooService.postTaskMessage(requireClient(), taskId, payload || {});
});

ipcMain.handle('users:mentionable', async () => {
  return odooService.fetchMentionableUsers(requireClient());
});

ipcMain.handle('activities:list', async () => {
  return odooService.fetchActivities(requireClient());
});

ipcMain.handle('activities:complete', async (_event, activityId) => {
  return odooService.completeActivity(requireClient(), activityId);
});

// Abre en Odoo el registro al que pertenece una actividad, sea del modelo que sea.
ipcMain.handle('record:open', async (_event, model, recordId) => {
  const c = requireClient();
  if (typeof model !== 'string' || !/^[a-z0-9_.]+$/.test(model)) {
    throw new Error('Modelo inválido');
  }
  if (!Number.isInteger(recordId)) throw new Error('Registro inválido');

  const url = `${c.url.replace(/\/+$/, '')}/web#id=${recordId}&model=${model}&view_type=form`;
  await shell.openExternal(url);
  return url;
});

ipcMain.handle('stats:productivity', async () => {
  return odooService.fetchProductivity(requireClient());
});

ipcMain.handle('tasks:open', async (_event, taskId) => {
  const c = requireClient();
  if (!Number.isInteger(taskId)) throw new Error('Tarea inválida');
  const url = `${c.url.replace(/\/+$/, '')}/web#id=${taskId}&model=project.task&view_type=form`;
  await shell.openExternal(url);
  return url;
});

ipcMain.handle('app:version', async () => app.getVersion());

ipcMain.handle('updates:status', async () => getUpdateStatus());

ipcMain.handle('updates:check', async () => checkForUpdatesNow());

ipcMain.handle('updates:install', async () => installUpdateNow());

ipcMain.handle('notifications:list', async () => notifications);

ipcMain.handle('notifications:mark-read', async () => {
  notifications = notifications.map((n) => ({ ...n, read: true }));
  broadcast('notifications:update', notifications);
  return notifications;
});

ipcMain.handle('notifications:clear', async () => {
  notifications = [];
  broadcast('notifications:update', notifications);
  return notifications;
});

ipcMain.handle('timer:state', async () => timers);

ipcMain.handle('timer:start', async (_event, item, kind = 'task') => {
  const key = timerKey(kind, item.id);
  const now = Date.now();

  // Cambiar de tarea pausa la anterior en vez de descartarla.
  const active = activeTimer();
  if (active && active.key !== key) replaceTimer(pauseTimerAt(active, now));

  const existing = findTimer(key);
  if (existing) return replaceTimer({ ...existing, segmentStartedAt: now });

  const timer = {
    key,
    kind,
    taskId: item.id,
    taskName: item.name,
    projectId: Array.isArray(item.project_id) ? item.project_id[0] : null,
    projectName: Array.isArray(item.project_id)
      ? item.project_id[1]
      : Array.isArray(item.team_id)
        ? item.team_id[1]
        : null,
    context: {
      partnerName: Array.isArray(item.partner_id) ? item.partner_id[1] : null,
      stageName: Array.isArray(item.stage_id) ? item.stage_id[1] : null,
      priority: item.priority || '0',
      allocatedHours: typeof item.allocated_hours === 'number' ? item.allocated_hours : null,
      spentHours:
        typeof item.effective_hours === 'number'
          ? item.effective_hours
          : typeof item.total_hours_spent === 'number'
            ? item.total_hours_spent
            : null,
      slaDeadline: item.sla_deadline || null,
    },
    startedAt: now,
    segmentStartedAt: now,
    accumulatedMs: 0,
  };
  timers = [...timers, timer];
  return timer;
});

ipcMain.handle('timer:pause', async (_event, key) => {
  const timer = key ? findTimer(key) : activeTimer();
  if (!timer) throw new Error('No hay ningún cronómetro corriendo');
  return replaceTimer(pauseTimerAt(timer, Date.now()));
});

ipcMain.handle('timer:resume', async (_event, key) => {
  const timer = key ? findTimer(key) : timers[0];
  if (!timer) throw new Error('No hay ningún cronómetro que reanudar');

  const now = Date.now();
  const active = activeTimer();
  if (active && active.key !== timer.key) replaceTimer(pauseTimerAt(active, now));

  return replaceTimer({ ...timer, segmentStartedAt: now });
});

ipcMain.handle('timer:stop', async (_event, { key, description, stoppedAt, elapsedMs: ajustado } = {}) => {
  if (stopInFlight) throw new Error('Ya se está registrando el tiempo, espera un momento');

  const timer = key ? findTimer(key) : activeTimer() || timers[0];
  if (!timer) throw new Error('No hay ningún cronómetro corriendo');

  // El cronómetro se detiene cuando se abre el diálogo, no cuando se confirma:
  // el rato que lleve escribir la descripción no cuenta como tiempo trabajado.
  const now = Date.now();
  const validStop =
    Number.isFinite(stoppedAt) && stoppedAt >= timer.startedAt && stoppedAt <= now ? stoppedAt : now;

  const runningMs =
    timer.segmentStartedAt === null ? 0 : Math.max(0, validStop - timer.segmentStartedAt);
  const medidoMs = timer.accumulatedMs + runningMs;

  // El usuario puede corregir la duración antes de registrar: el cronómetro no siempre
  // refleja el trabajo real (se olvidó detener, se trabajó sin medir, etc.).
  const elapsedMs =
    Number.isFinite(ajustado) && ajustado > 0 ? Math.round(ajustado) : medidoMs;

  const finished = { ...timer, stoppedAt: validStop, elapsedMs, description };
  stopInFlight = true;
  try {
    const record =
      finished.kind === 'ticket'
        ? await odooService.logTicketTimesheet(requireClient(), {
            ...finished,
            ticketId: finished.taskId,
          })
        : await odooService.logTimesheet(requireClient(), finished);

    // El cronómetro se descarta solo cuando Odoo confirmó el registro.
    timers = timers.filter((t) => t.key !== finished.key);
    if (timers.length === 0) hideMiniWindow();
    return { ...finished, timesheetId: record };
  } finally {
    stopInFlight = false;
  }
});

ipcMain.handle('timer:discard', async (_event, key) => {
  const timer = key ? findTimer(key) : activeTimer() || timers[0];
  if (timer) timers = timers.filter((t) => t.key !== timer.key);
  if (timers.length === 0) hideMiniWindow();
  return timers;
});

// La miniatura no puede abrir diálogos: delega en la ventana principal.
ipcMain.handle('mini:show-main', async () => {
  hideMiniWindow();
  showWindow();
  return true;
});

ipcMain.handle('mini:request-stop', async () => {
  hideMiniWindow();
  showWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer:stop-requested');
  }
  return true;
});

ipcMain.handle('attendance:status', async () => {
  const c = requireClient();
  const employeeId = await odooService.getEmployeeId(c);

  // No poder leer el historial no implica no poder fichar: attendance_manual se ejecuta con
  // permisos elevados. Se informa el estado como desconocido y se deja intentar el fichaje.
  try {
    const open = await odooService.getOpenAttendance(c, employeeId);
    return { employeeId, open, readable: true };
  } catch (err) {
    return {
      employeeId,
      open: null,
      readable: false,
      message: attendanceError(err).message,
    };
  }
});

ipcMain.handle('attendance:diagnose', async () => {
  return odooService.diagnoseAttendance(requireClient());
});

ipcMain.handle('attendance:close-open', async () => {
  const c = requireClient();
  try {
    const employeeId = await odooService.getEmployeeId(c);
    return await odooService.closeOpenAttendance(c, employeeId);
  } catch (err) {
    throw attendanceError(err);
  }
});

ipcMain.handle('attendance:toggle', async () => {
  const c = requireClient();
  try {
    const employeeId = await odooService.getEmployeeId(c);
    return await odooService.toggleAttendance(c, employeeId);
  } catch (err) {
    throw attendanceError(err);
  }
});

ipcMain.handle('settings:get', async () => ({
  ...settingsStore.read(),
  startAtLoginSupported: process.platform !== 'linux',
}));

ipcMain.handle('settings:update', async (_event, patch) => {
  const next = settingsStore.write(patch);
  applyStartAtLogin(next.startAtLogin);
  if (next.remindersEnabled) {
    reminders.start();
  } else {
    reminders.stop();
  }
  return { ...next, startAtLoginSupported: process.platform !== 'linux' };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId(APP_ID);
    }

    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });

    applyStartAtLogin(settingsStore.read().startAtLogin);
    reminders.start();

    createWindow();
    createTray();
    setupAutoUpdater({
      onNotify: notify,
      onStatus: (status) => broadcast('update:status', status),
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  stopOverduePolling();
  stopBackgroundRefresh();
  reminders.stop();
});

app.on('window-all-closed', () => {
  // Con bandeja, la app sigue viva y solo se cierra desde el menú "Salir".
  if ((isQuitting || !tray) && process.platform !== 'darwin') app.quit();
});
