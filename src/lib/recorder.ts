// Captura de audio de una reunión: micrófono + audio del sistema, mezclados en una sola pista.
// Sin el audio del sistema solo se grabaría lo que dice uno, que de una videollamada es la mitad.

const TROZO_MS = 5000;

export interface RecorderHandle {
  stop: () => Promise<number>;
  hasSystemAudio: boolean;
  hasMic: boolean;
}

async function capturarMicrofono(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null;
  }
}

async function capturarSistema(): Promise<MediaStream | null> {
  try {
    // getDisplayMedia exige vídeo aunque solo queramos el audio: la pista de vídeo se descarta
    // en cuanto llega, así no se graba ni se transmite nada de la pantalla.
    const pantalla = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    pantalla.getVideoTracks().forEach((pista) => {
      pantalla.removeTrack(pista);
      pista.stop();
    });
    return pantalla.getAudioTracks().length > 0 ? pantalla : null;
  } catch {
    return null;
  }
}

export async function startRecorder(
  onChunk: (chunk: ArrayBuffer) => Promise<unknown>,
): Promise<RecorderHandle> {
  const [mic, sistema] = await Promise.all([capturarMicrofono(), capturarSistema()]);

  if (!mic && !sistema) {
    throw new Error(
      'No se pudo acceder ni al micrófono ni al audio del sistema. Revisa los permisos de ' +
        'Windows en Privacidad → Micrófono.',
    );
  }

  const contexto = new AudioContext();
  const destino = contexto.createMediaStreamDestination();
  [mic, sistema].forEach((entrada) => {
    if (entrada) contexto.createMediaStreamSource(entrada).connect(destino);
  });

  const recorder = new MediaRecorder(destino.stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 32000,
  });

  // Al detener, MediaRecorder emite un último trozo. Guardarlo es asíncrono, así que se
  // anotan los envíos en curso para no cerrar la grabación antes de que lleguen al disco: ese
  // último trozo son los segundos finales de la reunión.
  const pendientes = new Set<Promise<unknown>>();
  recorder.ondataavailable = (evento) => {
    if (evento.data.size === 0) return;
    const envio = evento.data
      .arrayBuffer()
      .then((buf) => onChunk(buf))
      .catch(() => {})
      .finally(() => pendientes.delete(envio));
    pendientes.add(envio);
  };

  const inicio = Date.now();
  // Por trozos: lo grabado se va guardando en disco, no se pierde si la app se cierra.
  recorder.start(TROZO_MS);

  return {
    hasSystemAudio: !!sistema,
    hasMic: !!mic,
    stop: () =>
      new Promise<number>((resolve) => {
        recorder.onstop = async () => {
          [mic, sistema].forEach((entrada) => entrada?.getTracks().forEach((p) => p.stop()));
          contexto.close().catch(() => {});
          await Promise.all([...pendientes]);
          resolve(Date.now() - inicio);
        };
        recorder.stop();
      }),
  };
}
