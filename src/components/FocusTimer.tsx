import { useEffect, useState } from 'react';
import { TimerState } from '../types';
import { timerElapsedMs, useNow } from '../lib/format';
import { parseOdooDateTime } from '../lib/odooDate';
import { IconAlert, IconClose, IconPause, IconPlay, IconStop } from './Icons';

interface Props {
  timer: TimerState;
  frozenAt: number | null;
  onRequestStop: () => void;
  onDiscarded: () => void;
  onExit: () => void;
  onTimerChange: (timer: TimerState) => void;
}

function formatHours(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function formatCountdown(deadline: Date, now: number) {
  const diff = deadline.getTime() - now;
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  const amount = hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min`;
  return diff >= 0 ? `SLA vence en ${amount}` : `SLA vencido hace ${amount}`;
}

function splitClock(totalMs: number) {
  const total = Math.max(0, Math.floor(totalMs / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    head: `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}`,
    seconds: pad(total % 60),
  };
}

export default function FocusTimer({
  timer,
  frozenAt,
  onRequestStop,
  onDiscarded,
  onExit,
  onTimerChange,
}: Props) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const paused = timer.segmentStartedAt === null;
  const now = useNow(!paused && frozenAt === null);
  const displayNow = frozenAt ?? now;
  const elapsed = timerElapsedMs(timer, displayNow);
  const { head, seconds } = splitClock(elapsed);

  const context = timer.context;
  const elapsedHours = elapsed / 3600000;
  // El avance incluye lo que llevo midiendo ahora, para que la barra se mueva en vivo.
  const liveSpent = (context?.spentHours ?? 0) + elapsedHours;
  const allocated = context?.allocatedHours ?? 0;
  const showProgress = allocated > 0;
  const progressPct = showProgress ? Math.min(100, (liveSpent / allocated) * 100) : 0;
  const overBudget = showProgress && liveSpent > allocated;

  const slaDate = parseOdooDateTime(context?.slaDeadline ?? null);
  const slaOverdue = slaDate !== null && slaDate.getTime() < displayNow;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  async function handleDiscard() {
    await window.api.discardTimer();
    onDiscarded();
  }

  async function togglePause() {
    onTimerChange(paused ? await window.api.resumeTimer() : await window.api.pauseTimer());
  }

  return (
    <div className="focus-timer">
      <button className="focus-exit" onClick={onExit} title="Volver a la lista (Esc)">
        Volver a la lista
        <IconClose size={15} />
      </button>

      <div className="focus-body">
        {timer.projectName && <div className="focus-project">{timer.projectName}</div>}
        <h1 className="focus-task">{timer.taskName}</h1>

        {(context?.partnerName || context?.stageName) && (
          <div className="focus-meta">
            {context.partnerName && <span>{context.partnerName}</span>}
            {context.partnerName && context.stageName && <span className="focus-meta-sep">·</span>}
            {context.stageName && <span>{context.stageName}</span>}
          </div>
        )}

        <div className="focus-clock-wrap">
          <div className={`focus-clock ${paused ? 'is-paused' : ''}`}>
            <span>{head}</span>
            <span className="focus-seconds" key={seconds}>
              :{seconds}
            </span>
          </div>
        </div>

        <div className="focus-status">
          <span className={`dot ${!paused && frozenAt === null ? 'is-live' : ''}`} />
          {paused ? 'En pausa' : frozenAt === null ? 'Registrando tiempo' : 'Cronómetro detenido'}
        </div>

        {showProgress && (
          <div className="focus-progress">
            <div className="focus-progress-head">
              <span>
                {formatHours(liveSpent)} de {formatHours(allocated)} asignadas
              </span>
              <span className={overBudget ? 'is-over' : ''}>{Math.round(progressPct)}%</span>
            </div>
            <div className="focus-progress-track">
              <div
                className={`focus-progress-fill ${overBudget ? 'is-over' : ''}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {slaDate && (
          <div className={`focus-sla ${slaOverdue ? 'is-overdue' : ''}`}>
            <IconAlert size={14} />
            {formatCountdown(slaDate, displayNow)}
          </div>
        )}
      </div>

      <div className="focus-actions">
        {confirmDiscard ? (
          <>
            <span className="focus-confirm">¿Descartar sin registrar?</span>
            <button className="btn-danger" onClick={handleDiscard}>
              Sí, descartar
            </button>
            <button className="btn-on-dark" onClick={() => setConfirmDiscard(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button className="btn-danger btn-lg" onClick={onRequestStop}>
              <IconStop size={14} />
              Detener y registrar
            </button>
            <button className="btn-on-dark btn-lg" onClick={togglePause}>
              {paused ? <IconPlay size={13} /> : <IconPause size={13} />}
              {paused ? 'Reanudar' : 'Pausar'}
            </button>
            <button className="btn-on-dark" onClick={() => setConfirmDiscard(true)}>
              Descartar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
