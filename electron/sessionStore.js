const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function filePath() {
  return path.join(app.getPath('userData'), 'session.dat');
}

function save(session) {
  const payload = JSON.stringify(session);
  const canEncrypt = safeStorage.isEncryptionAvailable();
  const buf = canEncrypt ? safeStorage.encryptString(payload) : Buffer.from(payload, 'utf-8');
  fs.writeFileSync(filePath(), buf);
}

function load() {
  try {
    const buf = fs.readFileSync(filePath());
    const canEncrypt = safeStorage.isEncryptionAvailable();
    const payload = canEncrypt ? safeStorage.decryptString(buf) : buf.toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function clear() {
  try {
    fs.unlinkSync(filePath());
  } catch {
    // no había sesión guardada
  }
}

module.exports = { save, load, clear };
