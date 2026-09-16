const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  startAtLogin: false,
  remindersEnabled: true,
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
