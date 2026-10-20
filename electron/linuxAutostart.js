const fs = require('fs');
const os = require('os');
const path = require('path');

// En Linux no existe el «abrir al iniciar sesión» de Electron: lo que hay es un archivo .desktop
// en la carpeta de autoarranque del escritorio, que es lo que leen GNOME, KDE, XFCE y compañía.
const NOMBRE = 'elipsys-time.desktop';

function carpeta() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'autostart');
}

function archivo() {
  return path.join(carpeta(), NOMBRE);
}

// Exec admite comillas, que hacen falta porque la app vive en «/opt/Elipsys Time/».
function contenido({ exec, name = 'Elipsys Time' }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${name}`,
    'Comment=Gestión de tiempo y tareas sobre Odoo',
    `Exec="${exec}" --hidden`,
    'Icon=elipsys-time',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** Ruta del ejecutable que debe arrancar: la del AppImage si la hay, o la del binario. */
function rutaEjecutable() {
  return process.env.APPIMAGE || process.execPath;
}

function isEnabled() {
  try {
    return fs.existsSync(archivo());
  } catch {
    return false;
  }
}

function set(enabled, { exec = rutaEjecutable(), name } = {}) {
  try {
    if (!enabled) {
      fs.rmSync(archivo(), { force: true });
      return false;
    }
    fs.mkdirSync(carpeta(), { recursive: true });
    fs.writeFileSync(archivo(), contenido({ exec, name }), { mode: 0o644 });
    return true;
  } catch (err) {
    console.error('No se pudo cambiar el inicio automático:', err.message);
    return isEnabled();
  }
}

module.exports = { set, isEnabled, archivo, contenido, rutaEjecutable };
