import { useEffect, useState } from 'react';
import { TimerState } from './types';
import { formatElapsed, timerElapsedMs, useNow } from './lib/format';
import { IconExpand, IconPause, IconPlay, IconStop } from './components/Icons';

export default function MiniTimer() {
  const [timer, setTimer] = useState<TimerState | null>(null);
  const paused = timer?.segmentStartedAt === null;
  const now = useNow(!paused);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      window.api
        .getTimerState()
        .then((state) => {
          if (!cancelled) setTimer(state);
        })
        .catch(() => {});
    };
    sync();
    const id = setInterval(sync, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!timer) {
    return (
      <div className="mini">
        <div className="mini-drag" />
        <div className="mini-body">
          <span className="mini-idle">Sin cronómetro activo</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mini">
      <div className="mini-drag" />
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
            onClick={async () =>
              setTimer(paused ? await window.api.resumeTimer() : await window.api.pauseTimer())
            }
            title={paused ? 'Reanudar' : 'Pausar'}
            aria-label={paused ? 'Reanudar' : 'Pausar'}
          >
            {paused ? <IconPlay size={13} /> : <IconPause size={13} />}
          </button>
          <button
            className="mini-btn is-stop"
            onClick={() => window.api.requestStopFromMini()}
            title="Detener y registrar"
            aria-label="Detener y registrar"
          >
            <IconStop size={13} />
          </button>
          <button
            className="mini-btn"
            onClick={() => window.api.showMainWindow()}
            title="Abrir Elideysi"
            aria-label="Abrir Elideysi"
          >
            <IconExpand size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
