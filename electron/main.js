const {
  app,
  BrowserWindow,
  desktopCapturer,
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
const fs = require('fs');

const odooClient = require('./odooClient');
const odooService = require('./odooService');
const sessionStore = require('./sessionStore');
const settingsStore = require('./settingsStore');
const { formatOdooDateTime } = require('./dateUtil');
const { createReminderScheduler } = require('./reminders');
const { createAutoAttendanceScheduler } = require('./autoAttendance');
const { pendingReleaseNotes } = require('./releaseNotes');
const { attachContextMenu } = require('./contextMenu');
const recordings = require('./recordingStore');
const transcribe = require('./transcribeService');
const ai = require('./aiService');
const aiKeyStore = require('./aiKeyStore');
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
// Se mantiene el identificador anterior a propósito: es la clave con la que Windows reconoce
// la instalación, así que cambiarlo dejaría la versión vieja instalada al lado de la nueva.
const APP_ID = 'com.elipsys.elideysi';
// Empaquetada usaba el nombre del producto; en desarrollo, el del paquete.
const CARPETAS_ANTERIORES = ['Elideysi', 'elideysi'];

let mainWindow = null;
let miniWindow = null;
// La miniatura tarda en pintar la primera vez; sin esto se mostraría en blanco.
let miniReady = false;
// En memoria: la comprobación periódica no debe leer el disco cada dos segundos.
let floatingWidget = true;
// Último evento de la ventana principal: manda mientras no recupere el foco, porque no todos
// los entornos reflejan la minimización al instante en isMinimized().
let ocultaPorEvento = false;
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

// La carpeta de datos lleva el nombre del producto, así que al pasar a Elipsys Time cambia de
// sitio. Se arrastran la sesión y la configuración una sola vez para no obligar a entrar de nuevo.
function migrateUserData() {
  try {
    const destino = app.getPath('userData');

    for (const carpeta of CARPETAS_ANTERIORES) {
      const origen = path.join(app.getPath('appData'), carpeta);
      if (origen === destino || !fs.existsSync(origen)) continue;

      for (const archivo of ['session.dat', 'settings.json']) {
        const desde = path.join(origen, archivo);
        const hasta = path.join(destino, archivo);
        if (!fs.existsSync(desde) || fs.existsSync(hasta)) continue;
        fs.mkdirSync(destino, { recursive: true });
        fs.copyFileSync(desde, hasta);
        console.log(`Traído ${archivo} desde ${carpeta}`);
      }
    }
  } catch (err) {
    console.error('No se pudo traer la configuración de la versión anterior:', err.message);
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  // Si la ventana ya estaba a la vista no llega ningún evento: hay que limpiar la marca igual.
  ocultaPorEvento = false;
  syncMiniWindow();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // Título antes de que cargue la página; después manda el <title> del documento.
    title: 'Elipsys Time - Gestión de tiempo y tareas',
    width: 1180,
    height: 760,
    // El diseño aguanta ventanas estrechas: así se puede trabajar al lado de Odoo.
    minWidth: 680,
    minHeight: 520,
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

  attachContextMenu(mainWindow);

  mainWindow.once('ready-to-show', () => {
    if (!startedHidden) mainWindow.show();
  });

  // La miniatura solo aparece cuando la ventana principal no está a la vista.
  ['minimize', 'hide'].forEach((evento) => {
    mainWindow.on(evento, () => {
      ocultaPorEvento = true;
      syncMiniWindow();
    });
  });

  ['restore', 'show', 'focus'].forEach((evento) => {
    mainWindow.on(evento, () => {
      ocultaPorEvento = false;
      syncMiniWindow();
    });
  });

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

  miniWindow.once('ready-to-show', () => {
    miniReady = true;
    syncMiniWindow();
  });

  miniWindow.on('closed', () => {
    miniWindow = null;
    miniReady = false;
  });
}

function mainWindowHidden() {
  if (!mainWindow || mainWindow.isDestroyed()) return true;
  if (mainWindow.isMinimized() || !mainWindow.isVisible()) return true;
  return ocultaPorEvento && !mainWindow.isFocused();
}

// La miniatura se decide por el estado real, no por el evento que la disparó: da igual en qué
// pestaña, diálogo o vista de enfoque estuviera el usuario al minimizar, e igual si el
// cronómetro arrancó o se reanudó con la ventana ya oculta.
function syncMiniWindow() {
  const debeVerse = floatingWidget && timers.length > 0 && mainWindowHidden();
  if (debeVerse) showMiniWindow();
  else hideMiniWindow();
}

function showMiniWindow() {
  if (!miniWindow || miniWindow.isDestroyed()) createMiniWindow();
  if (miniWindow.isVisible()) return;
  // Mostrarla antes de que pinte deja un recuadro vacío: si aún carga, se muestra al estar lista.
  if (miniReady) miniWindow.showInactive();
}

function hideMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) miniWindow.hide();
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Elipsys Time - Gestión de tiempo y tareas');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Elipsys Time', click: showWindow },
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

const autoAttendance = createAutoAttendanceScheduler({
  // Sin sesión con Odoo no hay nada que fichar.
  isEnabled: () => !!client && settingsStore.read().autoAttendance,
  getTimes: () => {
    const settings = settingsStore.read();
    return { checkIn: settings.autoCheckIn, checkOut: settings.autoCheckOut };
  },
  getState: async () => {
    if (!client) return 'unknown';
    try {
      const employeeId = await odooService.getEmployeeId(client);
      const open = await odooService.getOpenAttendance(client, employeeId);
      return open ? 'in' : 'out';
    } catch {
      return 'unknown';
    }
  },
  toggle: async () => {
    const employeeId = await odooService.getEmployeeId(requireClient());
    return odooService.toggleAttendance(requireClient(), employeeId);
  },
  notify,
  // La tarjeta de jornada se entera en el acto, sin esperar al refresco de fondo.
  onChange: () => broadcast('data:refresh'),
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
  ai.resetAi();
  timers = [];
  hideMiniWindow();
  stopOverduePolling();
  sessionStore.clear();
  return true;
});

ipcMain.handle('tasks:list', async () => {
  return odooService.fetchAssignedTasks(requireClient());
});

ipcMain.handle('tasks:search-all', async (_event, query) => {
  return odooService.searchAllTasks(requireClient(), { query });
});

ipcMain.handle('tickets:search-all', async (_event, query) => {
  return odooService.searchAllTickets(requireClient(), { query });
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

// Mismo permiso que el resumen de equipo: Odoo rechaza la lectura de hr.employee sin él.
ipcMain.handle('team:schedule', async () => {
  return odooService.fetchTeamSchedule(requireClient());
});

ipcMain.handle('projects:list', async () => {
  return odooService.fetchProjects(requireClient());
});

ipcMain.handle('projects:tasks', async (_event, projectId) => {
  return odooService.fetchProjectTasks(requireClient(), projectId);
});

ipcMain.handle('timesheets:unassigned', async () => {
  return odooService.fetchUnassignedTimesheets(requireClient());
});

ipcMain.handle('timesheets:assign', async (_event, lineId, taskId) => {
  return odooService.assignTimesheetTask(requireClient(), lineId, taskId);
});

// Novedades de la versión instalada: se muestran una sola vez, después de actualizar.
let lastReleaseUrl = null;

ipcMain.handle('updates:pending-notes', async () => {
  const version = app.getVersion();
  const notes = await pendingReleaseNotes({
    version,
    settings: settingsStore.read(),
    markSeen: () => settingsStore.write({ lastSeenVersion: version }),
  });
  if (notes) lastReleaseUrl = notes.url;
  return notes;
});

ipcMain.handle('updates:notes-seen', async () => {
  settingsStore.write({ lastSeenVersion: app.getVersion() });
  return true;
});

ipcMain.handle('updates:open-release', async () => {
  // La URL la resolvió el proceso principal: el renderer no puede abrir cualquier enlace.
  if (!lastReleaseUrl) return false;
  await shell.openExternal(lastReleaseUrl);
  return true;
});

// ---------------------------------------------------------------------------------------
// Asistencia de IA. La clave sale de un parámetro de Odoo, así que cada quien usa la suya
// según lo que su usuario pueda leer, y nada se reparte con el instalador.
// ---------------------------------------------------------------------------------------
function aiHabilitada() {
  return settingsStore.read().aiEnabled !== false;
}

function requireAi() {
  if (!aiHabilitada()) throw new Error('La asistencia de IA está desactivada en la configuración.');
  return requireClient();
}

ipcMain.handle('ai:status', async () => {
  const configurada = !!aiKeyStore.load();
  if (!aiHabilitada()) return { available: false, configured: configurada, reason: 'desactivada' };
  return { available: configurada, configured: configurada, key: aiKeyStore.mask(aiKeyStore.load()) };
});

ipcMain.handle('ai:save-key', async (_event, key) => {
  await ai.testApiKey(key);
  const { encrypted } = aiKeyStore.save(key);
  ai.resetAi();
  return { configured: true, encrypted, key: aiKeyStore.mask(String(key).trim()) };
});

ipcMain.handle('ai:clear-key', async () => {
  aiKeyStore.clear();
  ai.resetAi();
  return { configured: false };
});

ipcMain.handle('ai:draft-description', async (_event, payload = {}) => {
  const c = requireAi();
  const { kind = 'task', recordId, taskName, projectName, stageName, minutes, notes } = payload;
  const previous = Number.isInteger(recordId)
    ? await odooService.fetchRecentTimesheetNames(c, kind, recordId)
    : [];
  return ai.draftTimesheetDescription({
    taskName,
    projectName,
    stageName,
    minutes,
    notes,
    previous,
  });
});

ipcMain.handle('ai:suggest-task', async (_event, { lineId, description, projectId, projectName, date } = {}) => {
  const c = requireAi();
  const tasks = await odooService.fetchProjectTasks(c, projectId);
  const sugerencia = await ai.suggestTaskForTimesheet({
    description,
    projectName,
    date,
    tasks: tasks.map((t) => ({ id: t.id, name: t.name })),
  });
  return { lineId, ...sugerencia };
});

ipcMain.handle('ai:weekly-summary', async () => {
  const c = requireAi();
  const datos = await odooService.fetchWeekTimesheets(c);
  if (datos.byProject.length === 0) {
    throw new Error('Esta semana todavía no tienes horas registradas que resumir.');
  }
  const texto = await ai.weeklySummary(datos);
  return { ...datos, text: texto };
});

ipcMain.handle('ai:triage-ticket', async (_event, ticketId) => {
  const c = requireAi();
  const contexto = await odooService.fetchTicketContext(c, ticketId);
  const triaje = await ai.triageTicket(contexto);
  return { ...triaje, similar: contexto.similar };
});

// ---------------------------------------------------------------------------------------
// Grabación de reuniones. Todo se queda en el equipo: el audio en la carpeta de datos de la
// app y la ficha en un índice junto a él.
// ---------------------------------------------------------------------------------------
ipcMain.handle('recordings:start', async (_event, title) => recordings.start({ title }));

ipcMain.handle('recordings:chunk', async (_event, id, chunk) => recordings.appendChunk(id, chunk));

ipcMain.handle('recordings:finish', async (_event, id, durationMs) =>
  recordings.finish(id, { durationMs }),
);

ipcMain.handle('recordings:list', async () => recordings.list());

ipcMain.handle('recordings:update', async (_event, id, cambios = {}) => {
  // Solo estos campos se dejan tocar desde la ventana.
  const { title, transcript, summary } = cambios;
  const permitido = {};
  if (typeof title === 'string') permitido.title = title.trim() || 'Reunión sin título';
  if (typeof transcript === 'string') permitido.transcript = transcript;
  if (typeof summary === 'string') permitido.summary = summary;
  return recordings.update(id, permitido);
});

ipcMain.handle('recordings:delete', async (_event, id) => recordings.remove(id));

ipcMain.handle('recordings:audio', async (_event, id) => recordings.readAudio(id));

ipcMain.handle('recordings:open-folder', async () => {
  await shell.openPath(recordings.carpeta());
  return true;
});

// Transcripción local: la ventana decodifica el audio y manda el PCM; aquí corre Whisper.
ipcMain.handle('transcribe:begin', async () => transcribe.begin());

ipcMain.handle('transcribe:pcm', async (_event, token, chunk) => transcribe.pushPcm(token, chunk));

ipcMain.handle('transcribe:run', async (_event, token, recordingId) => {
  const texto = await transcribe.run(token, {
    modelo: settingsStore.read().whisperModel || 'base',
    onProgress: (estado) => broadcast('transcribe:progress', { id: recordingId, ...estado }),
  });
  broadcast('transcribe:progress', { id: recordingId, phase: 'listo', percent: 100 });
  return recordings.update(recordingId, { transcript: texto });
});

ipcMain.handle('ai:summarize-meeting', async (_event, id) => {
  requireAi();
  const grabacion = recordings.get(id);
  const texto = (grabacion.transcript || '').trim();
  if (!texto) {
    throw new Error(
      'Primero hace falta el texto de la reunión: pega la transcripción o tus notas en el campo de abajo.',
    );
  }
  const resumen = await ai.summarizeMeeting({
    title: grabacion.title,
    date: grabacion.startedAt,
    durationMs: grabacion.durationMs,
    transcript: texto,
  });
  return recordings.update(id, { summary: resumen });
});

ipcMain.handle('timesheets:set-project', async (_event, lineId, projectId) => {
  return odooService.updateTimesheetProject(requireClient(), lineId, projectId);
});

ipcMain.handle('timesheets:delete', async (_event, lineId) => {
  return odooService.deleteTimesheet(requireClient(), lineId);
});

ipcMain.handle('record:stages', async (_event, kind, parentId) => {
  return odooService.fetchStages(requireClient(), kind, parentId ?? null);
});

ipcMain.handle('record:set-stage', async (_event, kind, recordId, stageId) => {
  return odooService.setStage(requireClient(), kind, recordId, stageId);
});

ipcMain.handle('record:messages', async (_event, kind, recordId) => {
  return odooService.fetchRecordMessages(requireClient(), kind, recordId);
});

ipcMain.handle('record:post-message', async (_event, kind, recordId, payload) => {
  return odooService.postRecordMessage(requireClient(), kind, recordId, payload || {});
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
  if (existing) {
    const reanudado = replaceTimer({ ...existing, segmentStartedAt: now });
    syncMiniWindow();
    return reanudado;
  }

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
  syncMiniWindow();
  return timer;
});

ipcMain.handle('timer:pause', async (_event, key) => {
  const timer = key ? findTimer(key) : activeTimer();
  if (!timer) throw new Error('No hay ningún cronómetro corriendo');
  const pausado = replaceTimer(pauseTimerAt(timer, Date.now()));
  syncMiniWindow();
  return pausado;
});

ipcMain.handle('timer:resume', async (_event, key) => {
  const timer = key ? findTimer(key) : timers[0];
  if (!timer) throw new Error('No hay ningún cronómetro que reanudar');

  const now = Date.now();
  const active = activeTimer();
  if (active && active.key !== timer.key) replaceTimer(pauseTimerAt(active, now));

  const reanudado = replaceTimer({ ...timer, segmentStartedAt: now });
  syncMiniWindow();
  return reanudado;
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
    let record;
    if (finished.kind === 'ticket') {
      record = await odooService.logTicketTimesheet(requireClient(), {
        ...finished,
        ticketId: finished.taskId,
      });
    } else if (finished.kind === 'project') {
      // Tiempo sin tarea: va al proyecto y queda pendiente de asignar.
      record = await odooService.logProjectTimesheet(requireClient(), finished);
    } else {
      record = await odooService.logTimesheet(requireClient(), finished);
    }

    // El cronómetro se descarta solo cuando Odoo confirmó el registro.
    timers = timers.filter((t) => t.key !== finished.key);
    syncMiniWindow();
    return { ...finished, timesheetId: record };
  } finally {
    stopInFlight = false;
  }
});

ipcMain.handle('timer:discard', async (_event, key) => {
  const timer = key ? findTimer(key) : activeTimer() || timers[0];
  if (timer) timers = timers.filter((t) => t.key !== timer.key);
  syncMiniWindow();
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
      message: odooService.attendanceError(err).message,
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
    throw odooService.attendanceError(err);
  }
});

ipcMain.handle('attendance:toggle', async () => {
  const c = requireClient();
  try {
    const employeeId = await odooService.getEmployeeId(c);
    return await odooService.toggleAttendance(c, employeeId);
  } catch (err) {
    throw odooService.attendanceError(err);
  }
});

ipcMain.handle('settings:get', async () => ({
  ...settingsStore.read(),
  startAtLoginSupported: process.platform !== 'linux',
}));

ipcMain.handle('settings:update', async (_event, patch) => {
  const next = settingsStore.write(patch);
  floatingWidget = next.floatingWidget;
  applyStartAtLogin(next.startAtLogin);
  if (next.remindersEnabled) {
    reminders.start();
  } else {
    reminders.stop();
  }
  if (next.autoAttendance) {
    autoAttendance.start();
  } else {
    autoAttendance.stop();
  }
  syncMiniWindow();
  return { ...next, startAtLoginSupported: process.platform !== 'linux' };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    // Antes de que nada lea la configuración o la sesión.
    migrateUserData();

    if (process.platform === 'win32') {
      app.setAppUserModelId(APP_ID);
    }

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      // Solo audio: el micrófono hace falta para grabar reuniones, la cámara nunca.
      if (permission !== 'media') return callback(false);
      const tipos = (details && details.mediaTypes) || [];
      return callback(tipos.length === 0 || tipos.every((tipo) => tipo === 'audio'));
    });

    // getDisplayMedia necesita una fuente: se toma la pantalla solo para poder pedir el audio
    // del sistema («loopback»), que es lo que trae la voz de los demás participantes. El vídeo
    // se descarta en la ventana nada más recibirlo.
    session.defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen'] })
          .then((fuentes) => callback({ video: fuentes[0], audio: 'loopback' }))
          .catch(() => callback({}));
      },
      { useSystemPicker: false },
    );

    // El corrector se queda en español: la app y lo que se escribe en ella lo son.
    try {
      session.defaultSession.setSpellCheckerLanguages(['es']);
    } catch (err) {
      console.error('No se pudo fijar el idioma del corrector:', err.message);
    }

    floatingWidget = settingsStore.read().floatingWidget;
    applyStartAtLogin(settingsStore.read().startAtLogin);
    reminders.start();
    if (settingsStore.read().autoAttendance) autoAttendance.start();

    createWindow();
    createTray();
    // Ningún evento de ventana es infalible: esta comprobación periódica garantiza que la
    // miniatura esté visible siempre que haya cronómetro y la app no esté a la vista.
    setInterval(syncMiniWindow, 2000);
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
  autoAttendance.stop();
});

app.on('window-all-closed', () => {
  // Con bandeja, la app sigue viva y solo se cierra desde el menú "Salir".
  if ((isQuitting || !tray) && process.platform !== 'darwin') app.quit();
});
