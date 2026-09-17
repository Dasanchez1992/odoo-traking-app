import { useState } from 'react';
import { TimerState } from '../types';
import { formatElapsed, timerElapsedMs, useNow } from '../lib/format';
import { IconClose, IconExpand, IconPause, IconPlay, IconStop } from './Icons';

interface Props {
  timer: TimerState;
  frozenAt: number | null;
  onRequestStop: () => void;
  onDiscarded: () => void;
  onEnterFocus: () => void;
  onTimerChange: (timer: TimerState) => void;
}

export default function TimerBar({
  timer,
  frozenAt,
  onRequestStop,
  onDiscarded,
  onEnterFocus,
  onTimerChange,
}: Props) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const paused = timer.segmentStartedAt === null;
  const now = useNow(!paused && frozenAt === null);
  const displayNow = frozenAt ?? now;

  async function handleDiscard() {
    await window.api.discardTimer();
    onDiscarded();
  }

  async function togglePause() {
    onTimerChange(paused ? await window.api.resumeTimer() : await window.api.pauseTimer());
  }

  return (
    <div className="timer-bar">
      <div className="timer-bar-info">
        <span
          className={`dot ${!paused && frozenAt === null ? 'is-live' : ''}`}
          style={{
            color: paused ? 'var(--warning-fg)' : frozenAt === null ? 'var(--success-dot)' : 'var(--text-subtle)',
          }}
        />
        <div>
          <div className="timer-bar-label">
            {paused ? 'En pausa' : frozenAt === null ? 'Registrando tiempo' : 'Cronómetro detenido'}
          </div>
          <div className="timer-bar-task" title={timer.taskName}>
            {timer.taskName}
          </div>
        </div>
      </div>

      <div className="timer-bar-right">
        <span className={`timer-bar-clock ${paused ? 'is-paused' : ''}`}>
          {formatElapsed(timerElapsedMs(timer, displayNow))}
        </span>

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
              className="btn-secondary btn-sm"
              onClick={togglePause}
              title={paused ? 'Reanudar el cronómetro' : 'Pausar el cronómetro'}
            >
              {paused ? <IconPlay size={12} /> : <IconPause size={12} />}
              {paused ? 'Reanudar' : 'Pausar'}
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
