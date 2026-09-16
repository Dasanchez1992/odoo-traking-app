import { useEffect, useState } from 'react';
import { TimerState } from './types';
import { formatStopwatch, useNow } from './lib/format';
import { IconExpand, IconStop } from './components/Icons';

export default function MiniTimer() {
  const [timer, setTimer] = useState<TimerState | null>(null);
  const now = useNow(true);

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
            {timer.taskName}
          </div>
          <div className="mini-clock">{formatStopwatch(timer.startedAt, now)}</div>
        </div>

        <div className="mini-actions">
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
