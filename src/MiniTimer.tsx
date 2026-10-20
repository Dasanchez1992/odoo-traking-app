import { useEffect, useState } from 'react';
import { ActiveRecording, TimerState } from './types';
import { formatElapsed, timerElapsedMs, useNow } from './lib/format';
import { IconExpand, IconPause, IconPlay, IconStop } from './components/Icons';

// Sin esto, un canal roto deja el botón mudo y el fallo pasa desapercibido.
function reportar(accion: string, promesa: Promise<unknown>) {
  promesa.catch((err) => console.error(`Falló «${accion}» desde la miniatura:`, err));
}

export default function MiniTimer() {
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [grabacion, setGrabacion] = useState<ActiveRecording | null>(null);
  const paused = timer?.segmentStartedAt === null;
  // El reloj corre si hay algo que contar: el cronómetro en marcha o la grabación.
  const now = useNow(!paused || grabacion !== null);

  useEffect(() => {
    let cancelado = false;
    const sync = () => {
      window.api
        .getTimerState()
        .then((lista) => {
          if (cancelado) return;
          setTimer(lista.find((t) => t.segmentStartedAt !== null) ?? lista[0] ?? null);
        })
        .catch(() => {});
      window.api
        .getActiveRecording()
        .then((actual) => {
          if (!cancelado) setGrabacion(actual);
        })
        .catch(() => {});
    };
    sync();
    const id = setInterval(sync, 2000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, []);

  const abrir = (
    <button
      className="mini-btn"
      onClick={() => reportar('abrir la app', window.api.showMainWindow())}
      title="Abrir Elipsys Time"
      aria-label="Abrir Elipsys Time"
    >
      <IconExpand size={13} />
    </button>
  );

  // La franja de grabación va arriba y es la misma esté o no el cronómetro debajo.
  const franja = grabacion && (
    <div className="mini-rec">
      <span className="dot is-rec" />
      <span className="mini-rec-text" title={grabacion.title}>
        Grabando reunión
      </span>
      <span className="mini-rec-time">{formatElapsed(now - grabacion.startedAt)}</span>
    </div>
  );

  if (!timer) {
    return (
      <div className="mini">
        <div className="mini-drag" />
        {franja}
        <div className="mini-body">
          {grabacion ? (
            <>
              <div className="mini-info">
                <div className="mini-task" title={grabacion.title}>
                  {grabacion.title}
                </div>
              </div>
              <div className="mini-actions">{abrir}</div>
            </>
          ) : (
            <span className="mini-idle">Sin cronómetro activo</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mini">
      <div className="mini-drag" />
      {franja}
      <div className="mini-body">
        <div className="mini-info">
          <div className="mini-task" title={timer.taskName}>
            {paused ? '⏸ ' : ''}
            {timer.taskName}
          </div>
          <div className={`mini-clock ${paused ? 'is-paused' : ''}`}>
            {formatElapsed(timerElapsedMs(timer, now))}
          </div>
        </div>

        <div className="mini-actions">
          <button
            className="mini-btn"
            onClick={() =>
              reportar(
                paused ? 'reanudar' : 'pausar',
                (paused ? window.api.resumeTimer(timer.key) : window.api.pauseTimer(timer.key)).then(
                  setTimer,
                ),
              )
            }
            title={paused ? 'Reanudar' : 'Pausar'}
            aria-label={paused ? 'Reanudar' : 'Pausar'}
          >
            {paused ? <IconPlay size={13} /> : <IconPause size={13} />}
          </button>
          <button
            className="mini-btn is-stop"
            onClick={() => reportar('detener', window.api.requestStopFromMini())}
            title="Detener y registrar"
            aria-label="Detener y registrar"
          >
            <IconStop size={13} />
          </button>
          {abrir}
        </div>
      </div>
    </div>
  );
}
