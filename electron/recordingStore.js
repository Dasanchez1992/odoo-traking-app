const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Las grabaciones se quedan en el equipo, nunca salen hacia Odoo ni hacia la nube. El índice
// guarda los datos de cada una; el audio va en archivos sueltos para poder abrirlos con
// cualquier reproductor y borrarlos a mano si hiciera falta.
function carpeta() {
  const dir = path.join(app.getPath('userData'), 'grabaciones');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indicePath() {
  return path.join(carpeta(), 'index.json');
}

function audioPath(id) {
  return path.join(carpeta(), `${id}.webm`);
}

function leerIndice() {
  try {
    const datos = JSON.parse(fs.readFileSync(indicePath(), 'utf-8'));
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
}

function escribirIndice(lista) {
  fs.writeFileSync(indicePath(), JSON.stringify(lista, null, 2));
}

// Una grabación a medias es mejor que ninguna: el audio se va escribiendo mientras dura la
// reunión, así un corte de luz o un cierre de la app no se lleva toda la sesión.
const abiertas = new Map();

function start({ title }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // El archivo se crea ya: createWriteStream lo abre de forma asíncrona y hasta entonces la
  // grabación en curso parecería no existir.
  fs.closeSync(fs.openSync(audioPath(id), 'w'));
  const stream = fs.createWriteStream(audioPath(id), { flags: 'a' });
  abiertas.set(id, stream);

  const registro = {
    id,
    title: (title || '').trim() || 'Reunión sin título',
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: 0,
    bytes: 0,
    transcript: '',
    summary: '',
  };
  escribirIndice([registro, ...leerIndice()]);
  return registro;
}

function appendChunk(id, chunk) {
  const stream = abiertas.get(id);
  if (stream) {
    stream.write(Buffer.from(chunk));
    return true;
  }

  // Un trozo que llega tarde es audio real: se añade al archivo en vez de descartarlo. Solo se
  // rechaza si la grabación no existe.
  const ruta = audioPath(id);
  if (!fs.existsSync(ruta)) throw new Error('Esa grabación no existe');
  fs.appendFileSync(ruta, Buffer.from(chunk));
  const actual = leerIndice().find((r) => r.id === id);
  if (actual && actual.endedAt) update(id, { bytes: fs.statSync(ruta).size });
  return true;
}

async function finish(id, { durationMs }) {
  const stream = abiertas.get(id);
  if (stream) {
    await new Promise((resolve) => stream.end(resolve));
    abiertas.delete(id);
  }

  let bytes = 0;
  try {
    bytes = fs.statSync(audioPath(id)).size;
  } catch {
    bytes = 0;
  }

  return update(id, {
    endedAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.round(durationMs || 0)),
    bytes,
  });
}

function update(id, cambios) {
  const lista = leerIndice();
  const i = lista.findIndex((r) => r.id === id);
  if (i === -1) throw new Error('No se encontró la grabación');
  lista[i] = { ...lista[i], ...cambios, id };
  escribirIndice(lista);
  return lista[i];
}

function list() {
  // Si alguien borró el .webm a mano, la ficha deja de tener sentido: se descarta. Lo que está
  // grabándose ahora mismo se respeta siempre.
  const todas = leerIndice();
  const vivas = todas.filter((r) => abiertas.has(r.id) || fs.existsSync(audioPath(r.id)));
  if (vivas.length !== todas.length) escribirIndice(vivas);
  return vivas;
}

function get(id) {
  const registro = leerIndice().find((r) => r.id === id);
  if (!registro) throw new Error('No se encontró la grabación');
  return registro;
}

function remove(id) {
  const stream = abiertas.get(id);
  if (stream) {
    stream.end();
    abiertas.delete(id);
  }
  try {
    fs.unlinkSync(audioPath(id));
  } catch {
    // ya no estaba
  }
  escribirIndice(leerIndice().filter((r) => r.id !== id));
  return { id };
}

// Para reproducir en la ventana sin exponer rutas del disco al renderer.
function readAudio(id) {
  return fs.readFileSync(audioPath(id));
}

module.exports = {
  start,
  appendChunk,
  finish,
  update,
  list,
  get,
  remove,
  readAudio,
  carpeta,
  audioPath,
};
