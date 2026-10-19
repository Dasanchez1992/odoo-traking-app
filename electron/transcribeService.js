const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Transcripción en el propio equipo con Whisper. El modelo se descarga una sola vez y queda
// cacheado en la carpeta de datos de la app; el audio nunca sale de aquí.
const MODELOS = {
  tiny: 'Xenova/whisper-tiny',
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
};

const MUESTREO = 16000;

let pipelinePromesa = null;
let modeloCargado = null;

function cacheDir() {
  const dir = path.join(app.getPath('userData'), 'modelos-whisper');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tempPath(token) {
  return path.join(app.getPath('temp'), `elipsys-pcm-${token}.raw`);
}

async function getPipeline(modelo, onProgress) {
  const nombre = MODELOS[modelo] || MODELOS.base;
  if (pipelinePromesa && modeloCargado === nombre) return pipelinePromesa;

  modeloCargado = nombre;
  pipelinePromesa = (async () => {
    // transformers.js es ESM; desde CommonJS hay que importarlo de forma dinámica.
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = cacheDir();
    env.allowRemoteModels = true;

    return pipeline('automatic-speech-recognition', nombre, {
      // Cuantizado: una cuarta parte de tamaño y bastante más rápido, sin diferencia apreciable
      // para una reunión.
      dtype: 'q8',
      progress_callback: (info) => {
        if (info.status === 'progress' && info.total) {
          onProgress({ phase: 'modelo', percent: Math.round((info.loaded / info.total) * 100) });
        }
      },
    });
  })();

  try {
    return await pipelinePromesa;
  } catch (err) {
    pipelinePromesa = null;
    modeloCargado = null;
    throw err;
  }
}

// La ventana decodifica el audio (Chromium sabe de opus; Node no) y manda el PCM en trozos.
const abiertos = new Map();

function begin() {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  abiertos.set(token, fs.createWriteStream(tempPath(token)));
  return token;
}

function pushPcm(token, chunk) {
  const stream = abiertos.get(token);
  if (!stream) throw new Error('Esa preparación de audio ya no está abierta');
  stream.write(Buffer.from(chunk));
  return true;
}

async function closePcm(token) {
  const stream = abiertos.get(token);
  if (!stream) return;
  await new Promise((resolve) => stream.end(resolve));
  abiertos.delete(token);
}

function leerPcm(token) {
  const buf = fs.readFileSync(tempPath(token));
  const enteros = new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
  const muestras = new Float32Array(enteros.length);
  for (let i = 0; i < enteros.length; i += 1) muestras[i] = enteros[i] / 32768;
  return muestras;
}

function limpiar(token) {
  try {
    fs.unlinkSync(tempPath(token));
  } catch {
    // ya no estaba
  }
}

async function run(token, { modelo = 'base', language = 'spanish', onProgress = () => {} }) {
  await closePcm(token);
  try {
    const audio = leerPcm(token);
    const segundos = audio.length / MUESTREO;
    if (segundos < 0.5) throw new Error('El audio es demasiado corto para transcribirlo.');

    onProgress({ phase: 'modelo', percent: 0 });
    const asr = await getPipeline(modelo, onProgress);

    onProgress({ phase: 'transcribiendo', percent: 0, seconds: Math.round(segundos) });
    let hechos = 0;
    const salida = await asr(audio, {
      language,
      task: 'transcribe',
      // Whisper solo mira 30 s de cada vez: para una reunión hay que trocear y solapar un poco
      // para no cortar palabras entre trozos.
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      callback_function: () => {
        hechos += 1;
        onProgress({
          phase: 'transcribiendo',
          percent: Math.min(99, Math.round((hechos * 30 * 100) / segundos)),
          seconds: Math.round(segundos),
        });
      },
    });

    return (salida.text || '').trim();
  } finally {
    limpiar(token);
  }
}

module.exports = { begin, pushPcm, run, MODELOS, MUESTREO };
