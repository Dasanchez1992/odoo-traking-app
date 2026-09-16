import { useState } from 'react';
import { TimerState } from '../types';
import { formatStopwatch, useNow } from '../lib/format';
import { IconClose, IconExpand, IconStop } from './Icons';

interface Props {
  timer: TimerState;
  frozenAt: number | null;
  onRequestStop: () => void;
  onDiscarded: () => void;
  onEnterFocus: () => void;
}

export default function TimerBar({
  timer,
  frozenAt,
  onRequestStop,
  onDiscarded,
  onEnterFocus,
}: Props) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const now = useNow(frozenAt === null);
  const displayNow = frozenAt ?? now;

  async function handleDiscard() {
    await window.api.discardTimer();
    onDiscarded();
  }

  return (
    <div className="timer-bar">
      <div className="timer-bar-info">
        <span
          className={`dot ${frozenAt === null ? 'is-live' : ''}`}
          style={{ color: frozenAt === null ? 'var(--success-dot)' : 'var(--text-subtle)' }}
        />
        <div>
          <div className="timer-bar-label">
            {frozenAt === null ? 'Registrando tiempo' : 'Cronómetro detenido'}
          </div>
          <div className="timer-bar-task" title={timer.taskName}>
            {timer.taskName}
          </div>
        </div>
      </div>

      <div className="timer-bar-right">
        <span className="timer-bar-clock">{formatStopwatch(timer.startedAt, displayNow)}</span>

        {confirmDiscard ? (
          <>
            <span className="timer-bar-confirm">¿Descartar sin registrar?</span>
            <button className="btn-danger btn-sm" onClick={handleDiscard}>
              Sí, descartar
            </button>
            <button className="btn-secondary btn-sm" onClick={() => setConfirmDiscard(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button
              className="btn-ghost btn-sm"
              onClick={onEnterFocus}
              title="Ver el temporizador a pantalla completa"
            >
              <IconExpand size={14} />
              Modo enfoque
            </button>
            <button
              className="btn-ghost btn-sm"
              onClick={() => setConfirmDiscard(true)}
              title="Descartar el cronómetro sin registrar el tiempo"
            >
              <IconClose size={14} />
              Descartar
            </button>
            <button className="btn-danger" onClick={onRequestStop}>
              <IconStop size={13} />
              Detener y registrar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
