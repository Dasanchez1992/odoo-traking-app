const { app, dialog } = require('electron');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let autoUpdater = null;
let emitStatus = () => {};
let lastStatus = { state: 'idle' };

function setStatus(status) {
  lastStatus = status;
  emitStatus(status);
}

function loadUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('electron-updater no disponible:', err.message);
    return null;
  }
  return autoUpdater;
}

// Solo tiene sentido en una app empaquetada: en desarrollo no hay versión publicada contra
// la cual comparar y electron-updater falla.
function setupAutoUpdater({ onNotify, onStatus } = {}) {
  emitStatus = onStatus || (() => {});

  if (!app.isPackaged) {
    setStatus({ state: 'dev' });
    return;
  }

  const updater = loadUpdater();
  if (!updater) {
    setStatus({ state: 'error', message: 'El actualizador no está disponible' });
    return;
  }

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  updater.on('checking-for-update', () => setStatus({ state: 'checking' }));
  updater.on('update-not-available', () => setStatus({ state: 'latest' }));
  updater.on('update-available', (info) => setStatus({ state: 'available', version: info.version }));
  updater.on('download-progress', (progress) =>
    setStatus({ state: 'downloading', percent: Math.round(progress.percent) }),
  );
  updater.on('error', (err) => setStatus({ state: 'error', message: err.message }));

  updater.on('update-downloaded', async (info) => {
    setStatus({ state: 'ready', version: info.version });
    if (onNotify) {
      onNotify('Actualización lista', `Elipsys Time ${info.version} se instalará al reiniciar.`, 'update');
    }
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Reiniciar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
      title: 'Actualización disponible',
      message: `Elipsys Time ${info.version} está lista para instalarse.`,
      detail: 'Se cerrará la aplicación para completar la actualización.',
    });
    if (response === 0) updater.quitAndInstall();
  });

  updater.checkForUpdates().catch(() => {});
  setInterval(() => updater.checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
}

async function checkForUpdatesNow() {
  if (!app.isPackaged) {
    setStatus({ state: 'dev' });
    return lastStatus;
  }
  const updater = loadUpdater();
  if (!updater) return lastStatus;

  try {
    await updater.checkForUpdates();
  } catch (err) {
    setStatus({ state: 'error', message: err.message });
  }
  return lastStatus;
}

function installUpdateNow() {
  if (!autoUpdater || !app.isPackaged) return false;
  autoUpdater.quitAndInstall();
  return true;
}

module.exports = {
  setupAutoUpdater,
  checkForUpdatesNow,
  installUpdateNow,
  getUpdateStatus: () => lastStatus,
};
