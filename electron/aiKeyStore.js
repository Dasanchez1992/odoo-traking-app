const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

// La clave de cada persona se guarda cifrada con el mismo mecanismo del sistema operativo que
// protege la sesión de Odoo, en un archivo aparte para poder borrarla sin tocar la sesión.
function filePath() {
  return path.join(app.getPath('userData'), 'ai-key.dat');
}

function save(key) {
  const texto = String(key || '').trim();
  if (!texto) throw new Error('La clave está vacía');

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
    return texto.trim() || null;
  } catch {
    return null;
  }
}

function clear() {
  try {
    fs.unlinkSync(filePath());
  } catch {
    // no había clave guardada
  }
}

// Para enseñarla en la configuración sin exponerla entera.
function mask(key) {
  if (!key) return '';
  return key.length <= 12 ? '•'.repeat(key.length) : `${key.slice(0, 7)}…${key.slice(-4)}`;
}

module.exports = { save, load, clear, mask };
