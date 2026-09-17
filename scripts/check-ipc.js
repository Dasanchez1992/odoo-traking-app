#!/usr/bin/env node
// Comprueba que los canales que el preload expone tengan su contraparte en el proceso principal.
// Un canal sin handler no rompe el arranque: el botón simplemente no hace nada, así que este
// desajuste solo se descubre probando la app a mano.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', 'electron');
const preload = fs.readFileSync(path.join(raiz, 'preload.js'), 'utf-8');
const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf-8');

const buscar = (texto, patron) => new Set([...texto.matchAll(patron)].map((m) => m[1]));

const invocados = buscar(preload, /ipcRenderer\.invoke\('([^']+)'/g);
const escuchados = buscar(preload, /ipcRenderer\.on\('([^']+)'/g);
const registrados = buscar(main, /ipcMain\.handle\('([^']+)'/g);
const emitidos = new Set([
  ...buscar(main, /webContents\.send\('([^']+)'/g),
  ...buscar(main, /broadcast\('([^']+)'/g),
]);

const sinHandler = [...invocados].filter((c) => !registrados.has(c)).sort();
const sinEmisor = [...escuchados].filter((c) => !emitidos.has(c)).sort();
const sinUso = [...registrados].filter((c) => !invocados.has(c)).sort();

if (sinUso.length) {
  console.log(`Aviso: handlers que nadie invoca: ${sinUso.join(', ')}`);
}

if (sinHandler.length || sinEmisor.length) {
  if (sinHandler.length) {
    console.error(`Canales invocados sin handler en main.js: ${sinHandler.join(', ')}`);
  }
  if (sinEmisor.length) {
    console.error(`Eventos escuchados que nadie emite: ${sinEmisor.join(', ')}`);
  }
  process.exit(1);
}

console.log(`IPC correcto: ${invocados.size} canales y ${escuchados.size} eventos conectados.`);
