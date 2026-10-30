const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

// El token de GitHub se guarda cifrado en el equipo, igual que la sesión de Odoo y la clave de
// IA: en un archivo aparte para poder quitarlo sin tocar lo demás.
const ORG_POR_DEFECTO = 'nosolotec';

function filePath() {
  return path.join(app.getPath('userData'), 'github.dat');
}

function save({ user, token, org, scopes, orgVisible }) {
  const datos = {
    user: String(user || '').trim(),
    token: String(token || '').trim(),
    org: String(org || '').trim() || ORG_POR_DEFECTO,
    // Lo que dijo GitHub al comprobar el token: sirve para avisar en Configuración.
    scopes: Array.isArray(scopes) ? scopes : [],
    orgVisible: orgVisible !== false,
  };
  if (!datos.user || !datos.token) throw new Error('Hacen falta el usuario y el token');

  const texto = JSON.stringify(datos);
  const cifrable = safeStorage.isEncryptionAvailable();
  const buf = cifrable ? safeStorage.encryptString(texto) : Buffer.from(texto, 'utf-8');
  fs.writeFileSync(filePath(), buf, { mode: 0o600 });
  return { encrypted: cifrable };
}

function load() {
  try {
    const buf = fs.readFileSync(filePath());
    const cifrable = safeStorage.isEncryptionAvailable();
    const texto = cifrable ? safeStorage.decryptString(buf) : buf.toString('utf-8');
    const datos = JSON.parse(texto);
    return datos.user && datos.token ? { ...datos, org: datos.org || ORG_POR_DEFECTO } : null;
  } catch {
    return null;
  }
}

function clear() {
  try {
    fs.unlinkSync(filePath());
  } catch {
    // no había nada guardado
  }
}

// Para enseñarlo en la configuración sin dejarlo a la vista.
function mask(token) {
  if (!token) return '';
  return token.length <= 12 ? '•'.repeat(token.length) : `${token.slice(0, 7)}…${token.slice(-4)}`;
}

module.exports = { save, load, clear, mask, ORG_POR_DEFECTO };
