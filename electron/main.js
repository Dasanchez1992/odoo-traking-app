const { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage, session, shell } =
  require('electron');
const path = require('path');

const odooClient = require('./odooClient');
const odooService = require('./odooService');
const sessionStore = require('./sessionStore');
const settingsStore = require('./settingsStore');
const { formatOdooDateTime } = require('./dateUtil');
const { createReminderScheduler } = require('./reminders');

const OVERDUE_POLL_MS = 5 * 60 * 1000;
const APP_ID = 'com.elipsys.elideysi';

let mainWindow = null;
let tray = null;
let client = null;
let overduePollTimer = null;
let notifiedTaskIds = new Set();
let isQuitting = false;

let timerState = null; // { taskId, taskName, projectId, startedAt }
let stopInFlight = false;

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

  // Cerrar la ventana solo la oculta: la app sigue en la bandeja para poder recordar los fichajes.
  // Sin bandeja disponible se cierra de verdad, para no dejarla inaccesible.
  mainWindow.on('close', (event) => {
    if (isQuitting || !tray) return;
    event.preventDefault();
    mainWindow.hide();
  });
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

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  notification.on('click', showWindow);
  notification.show();
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
}

async function pollOverdueTasks() {
  if (!client) return;
  try {
    const tasks = await odooService.fetchOverdueTasks(client);
    const freshlyOverdue = tasks.filter((t) => !notifiedTaskIds.has(t.id));
    freshlyOverdue.forEach((t) => notifiedTaskIds.add(t.id));

    if (freshlyOverdue.length === 1) {
      const t = freshlyOverdue[0];
      notify('Tarea caducada', `"${t.name}" venció el ${formatOdooDateTime(t.date_deadline)}`);
    } else if (freshlyOverdue.length > 1) {
      notify('Tareas caducadas', `Tienes ${freshlyOverdue.length} tareas vencidas pendientes`);
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
  timerState = null;
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

ipcMain.handle('timer:state', async () => timerState);

ipcMain.handle('timer:start', async (_event, item, kind = 'task') => {
  if (timerState) {
    throw new Error('Ya hay un cronómetro corriendo. Deténlo antes de iniciar otro.');
  }
  timerState = {
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
    startedAt: Date.now(),
  };
  return timerState;
});

ipcMain.handle('timer:stop', async (_event, { description, stoppedAt } = {}) => {
  if (stopInFlight) throw new Error('Ya se está registrando el tiempo, espera un momento');
  if (!timerState) throw new Error('No hay ningún cronómetro corriendo');

  // El cronómetro se detiene cuando se abre el diálogo, no cuando se confirma:
  // el rato que lleve escribir la descripción no cuenta como tiempo trabajado.
  const now = Date.now();
  const validStop =
    Number.isFinite(stoppedAt) && stoppedAt >= timerState.startedAt && stoppedAt <= now
      ? stoppedAt
      : now;

  const finished = { ...timerState, stoppedAt: validStop, description };
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
    timerState = null;
    return { ...finished, timesheetId: record };
  } finally {
    stopInFlight = false;
  }
});

ipcMain.handle('timer:discard', async () => {
  timerState = null;
  return true;
});

ipcMain.handle('attendance:status', async () => {
  const c = requireClient();
  const employeeId = await odooService.getEmployeeId(c);
  const open = await odooService.getOpenAttendance(c, employeeId);
  return { employeeId, open };
});

ipcMain.handle('attendance:toggle', async () => {
  const c = requireClient();
  const employeeId = await odooService.getEmployeeId(c);
  return odooService.toggleAttendance(c, employeeId);
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  stopOverduePolling();
  reminders.stop();
});

app.on('window-all-closed', () => {
  // Con bandeja, la app sigue viva y solo se cierra desde el menú "Salir".
  if ((isQuitting || !tray) && process.platform !== 'darwin') app.quit();
});
