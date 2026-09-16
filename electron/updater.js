const { app, dialog } = require('electron');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Solo tiene sentido en una app empaquetada: en desarrollo no hay versión publicada contra
// la cual comparar y electron-updater falla.
function setupAutoUpdater({ onNotify } = {}) {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('electron-updater no disponible:', err.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async (info) => {
    if (onNotify) {
      onNotify('Actualización lista', `Elideysi ${info.version} se instalará al reiniciar.`);
    }
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Reiniciar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
      title: 'Actualización disponible',
      message: `Elideysi ${info.version} está lista para instalarse.`,
      detail: 'Se cerrará la aplicación para completar la actualización.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => {
    console.error('Error al buscar actualizaciones:', err.message);
  });

  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
}

module.exports = { setupAutoUpdater };
