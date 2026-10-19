// Prepara el audio de una grabación para Whisper. La decodificación se hace aquí porque el
// navegador sabe de webm/opus y Node no; el modelo corre en el proceso principal.

const MUESTREO = 16000;
// Medio millón de muestras por envío: trozos manejables para el IPC sin mil llamadas.
const MUESTRAS_POR_ENVIO = 512 * 1024;

async function decodificarA16k(datos: Uint8Array): Promise<Float32Array> {
  const buffer = new Uint8Array(datos).slice().buffer;

  const contexto = new AudioContext();
  let decodificado: AudioBuffer;
  try {
    decodificado = await contexto.decodeAudioData(buffer);
  } finally {
    contexto.close().catch(() => {});
  }

  // Un solo canal a 16 kHz, que es lo que espera Whisper.
  const offline = new OfflineAudioContext(
    1,
    Math.max(1, Math.ceil(decodificado.duration * MUESTREO)),
    MUESTREO,
  );
  const fuente = offline.createBufferSource();
  fuente.buffer = decodificado;
  fuente.connect(offline.destination);
  fuente.start();
  const remuestreado = await offline.startRendering();
  return remuestreado.getChannelData(0);
}

export async function transcribeRecording(id: string): Promise<void> {
  const datos = await window.api.getRecordingAudio(id);
  const muestras = await decodificarA16k(datos);

  const token = await window.api.beginTranscription();
  for (let i = 0; i < muestras.length; i += MUESTRAS_POR_ENVIO) {
    const trozo = muestras.subarray(i, Math.min(i + MUESTRAS_POR_ENVIO, muestras.length));
    const enteros = new Int16Array(trozo.length);
    for (let n = 0; n < trozo.length; n += 1) {
      enteros[n] = Math.max(-1, Math.min(1, trozo[n])) * 32767;
    }
    await window.api.pushPcm(token, enteros.buffer);
  }

  await window.api.runTranscription(token, id);
}
