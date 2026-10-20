const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Uso de aplicaciones del propio equipo, día a día. Se guarda primero aquí y luego se sube a
// Odoo: así no se pierde nada si no hay red o si la sesión está cerrada.
const DIAS_LOCALES = 120;
// En el resumen que viaja a Odoo solo van las aplicaciones más usadas; el resto se agrupa en
// «Otras» para que cada día ocupe poco.
const MAX_APPS = 25;

function carpeta() {
  const dir = path.join(app.getPath('userData'), 'uso-apps');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rutaDia(fecha) {
  return path.join(carpeta(), `${fecha}.json`);
}

function vacio(fecha) {
  return {
    date: fecha,
    apps: {},
    activeSeconds: 0,
    idleSeconds: 0,
    updatedAt: null,
    syncedAt: null,
  };
}

// El día en curso se lleva en memoria: se toca cada pocos segundos y no tiene sentido escribir
// el archivo en cada muestra.
const memoria = new Map();
const sucios = new Set();

function leerDia(fecha) {
  if (memoria.has(fecha)) return memoria.get(fecha);
  let dia;
  try {
    dia = { ...vacio(fecha), ...JSON.parse(fs.readFileSync(rutaDia(fecha), 'utf-8')), date: fecha };
  } catch {
    dia = vacio(fecha);
  }
  memoria.set(fecha, dia);
  return dia;
}

function escribir(dia) {
  fs.writeFileSync(rutaDia(dia.date), JSON.stringify(dia));
}

function acumular({ date, app: clave, label, seconds, idle = false }) {
  const segundos = Math.max(0, Math.round(seconds || 0));
  if (!date || segundos === 0) return null;

  const dia = leerDia(date);
  if (idle || !clave) {
    dia.idleSeconds += segundos;
  } else {
    const actual = dia.apps[clave] || { label: label || clave, seconds: 0 };
    actual.seconds += segundos;
    if (label) actual.label = label;
    dia.apps[clave] = actual;
    dia.activeSeconds += segundos;
  }
  dia.updatedAt = new Date().toISOString();
  sucios.add(date);
  return dia;
}

function flush() {
  sucios.forEach((fecha) => {
    try {
      escribir(leerDia(fecha));
    } catch (err) {
      console.error('No se pudo guardar el uso de', fecha, err.message);
    }
  });
  sucios.clear();
}

function marcarSincronizado(fecha, cuando = new Date().toISOString()) {
  const dia = leerDia(fecha);
  dia.syncedAt = cuando;
  sucios.add(fecha);
  flush();
  return dia;
}

// Para cuando cambia el sitio donde se guarda en Odoo: lo de este equipo se vuelve a subir.
function marcarTodoPendiente() {
  const fechas = fechasGuardadas();
  fechas.forEach((fecha) => {
    const dia = leerDia(fecha);
    if (!dia.updatedAt) return;
    dia.syncedAt = null;
    sucios.add(fecha);
  });
  flush();
  return fechas.length;
}

function fechasGuardadas() {
  try {
    return fs
      .readdirSync(carpeta())
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}

// Días cuyo contenido cambió después de la última subida: son los que hay que mandar a Odoo.
function pendientes() {
  flush();
  return fechasGuardadas()
    .map(leerDia)
    .filter((dia) => dia.updatedAt && (!dia.syncedAt || dia.syncedAt < dia.updatedAt));
}

function rango(desde, hasta) {
  flush();
  return fechasGuardadas()
    .filter((fecha) => fecha >= desde && fecha <= hasta)
    .map(leerDia);
}

// Lo que se sube a Odoo: lista ordenada y recortada, sin títulos de ventana ni nada más.
function resumen(dia) {
  const apps = Object.entries(dia.apps)
    .map(([clave, datos]) => ({ app: clave, label: datos.label || clave, seconds: datos.seconds }))
    .sort((a, b) => b.seconds - a.seconds);

  const principales = apps.slice(0, MAX_APPS);
  const resto = apps.slice(MAX_APPS).reduce((suma, a) => suma + a.seconds, 0);
  if (resto > 0) principales.push({ app: 'otras', label: 'Otras aplicaciones', seconds: resto });

  return {
    v: 1,
    date: dia.date,
    activeSeconds: dia.activeSeconds,
    idleSeconds: dia.idleSeconds,
    updatedAt: dia.updatedAt,
    apps: principales,
  };
}

function limpiarAntiguos(dias = DIAS_LOCALES) {
  const limite = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  fechasGuardadas()
    .filter((fecha) => fecha < limite)
    .forEach((fecha) => {
      try {
        fs.unlinkSync(rutaDia(fecha));
        memoria.delete(fecha);
      } catch {
        // ya no estaba
      }
    });
}

module.exports = {
  acumular,
  flush,
  leerDia,
  marcarSincronizado,
  marcarTodoPendiente,
  pendientes,
  rango,
  resumen,
  limpiarAntiguos,
  carpeta,
  DIAS_LOCALES,
};
