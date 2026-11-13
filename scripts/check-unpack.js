#!/usr/bin/env node
// Whisper se carga desde fuera del asar, y el cargador de módulos no sabe cruzar de un lado al
// otro: si un paquete del que depende se queda dentro del asar, la transcripción falla solo en
// la app instalada, nunca en desarrollo. Este guion recalcula de qué depende y comprueba que
// todo esté en asarUnpack, para que un cambio de dependencias rompa el build y no al usuario.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const paquete = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf-8'));
const patrones = paquete.build.asarUnpack || [];

// Lo de imágenes (sharp) no hace falta para transcribir audio y se excluye del instalador.
const FUERA = (nombre) => nombre === 'sharp' || nombre.startsWith('@img/');

function cierreDe(inicio) {
  const vistos = new Set();
  const pendientes = [inicio];
  while (pendientes.length) {
    const nombre = pendientes.pop();
    if (vistos.has(nombre) || FUERA(nombre)) continue;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(raiz, 'node_modules', nombre, 'package.json'), 'utf-8'));
    } catch {
      continue; // no instalado: tampoco se empaqueta, así que no hay nada que comprobar
    }
    vistos.add(nombre);
    Object.keys(meta.dependencies || {}).forEach((d) => pendientes.push(d));
    Object.keys(meta.optionalDependencies || {}).forEach((d) => pendientes.push(d));
  }
  return [...vistos];
}

const cubre = (nombre) =>
  patrones.some((p) => {
    const base = p.replace(/\/\*\*$/, '').replace(/^node_modules\//, '');
    return nombre === base || nombre.startsWith(`${base}/`);
  });

const faltan = cierreDe('@huggingface/transformers').filter((n) => !cubre(n)).sort();

if (faltan.length) {
  console.error('Estos paquetes hacen falta para transcribir y no están en build.asarUnpack:');
  faltan.forEach((n) => console.error(`  node_modules/${n}/**`));
  console.error('\nSin ellos, la transcripción falla en la app instalada con ERR_MODULE_NOT_FOUND.');
  process.exit(1);
}

console.log(
  `Empaquetado correcto: los ${cierreDe('@huggingface/transformers').length} paquetes del árbol de Whisper están marcados para ir fuera del asar.`,
);
