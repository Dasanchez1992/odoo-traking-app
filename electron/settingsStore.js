const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  startAtLogin: false,
  remindersEnabled: true,
  // Miniatura flotante mientras la app no está a la vista y hay tiempo corriendo.
  floatingWidget: true,
  // Fichaje automático de entrada y salida, de lunes a viernes, con la app abierta.
  autoAttendance: false,
  autoCheckIn: '08:30',
  autoCheckOut: '17:30',
  // Asistencia de IA (redacción, sugerencias y resúmenes).
  aiEnabled: true,
  // Aviso de novedades tras una actualización automática.
  showReleaseNotes: true,
  // Última versión cuyas novedades ya vio el usuario; no es una preferencia, es estado.
  lastSeenVersion: '',
};

function filePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function read() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(filePath(), 'utf-8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(patch) {
  const next = { ...read(), ...patch };
  fs.writeFileSync(filePath(), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { read, write, DEFAULTS };
