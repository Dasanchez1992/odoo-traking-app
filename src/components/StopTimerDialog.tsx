import { FormEvent, useEffect, useState } from 'react';
import { TimerState } from '../types';
import { formatElapsed, timerElapsedMs } from '../lib/format';
import { IconAlert, IconClose, IconStop } from './Icons';

const MIN_BILLABLE_MINUTES = 5;

interface Props {
  timer: TimerState;
  stoppedAt: number;
  onRegistered: () => void;
  onCancel: () => void;
  onDiscarded: () => void;
}

export default function StopTimerDialog({
  timer,
  stoppedAt,
  onRegistered,
  onCancel,
  onDiscarded,
}: Props) {
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const elapsedMs = timerElapsedMs(timer, stoppedAt);
  const elapsedMinutes = elapsedMs / 60000;
  const appliesMinimum = elapsedMinutes < MIN_BILLABLE_MINUTES;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  async function handleDiscard() {
    setSaving(true);
    try {
      await window.api.discardTimer();
      onDiscarded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descartar el tiempo');
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await window.api.stopTimer({ description, stoppedAt });
      onRegistered();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el tiempo');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onCancel()}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <h2>Registrar tiempo</h2>
          <button
            type="button"
            className="btn-ghost btn-icon"
            onClick={onCancel}
            disabled={saving}
            aria-label="Cerrar"
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="stop-summary">
            <div className="stop-summary-task" title={timer.taskName}>
              {timer.taskName}
            </div>
            <div className="stop-summary-time">{formatElapsed(elapsedMs)}</div>
          </div>

          {appliesMinimum && (
            <p className="stop-minimum">
              Se registrarán <strong>5 minutos</strong>, que es el mínimo por registro.
            </p>
          )}

          <div className="field" style={{ marginTop: 16 }}>
            <label className="field-label" htmlFor="timesheet-description">
              Descripción del trabajo
            </label>
            <textarea
              id="timesheet-description"
              rows={3}
              autoFocus
              placeholder="Qué hiciste en este tiempo..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
            />
            <span className="field-hint">
              Es lo que aparecerá en la hoja de horas de Odoo. Si lo dejas vacío se registra como
              «Registrado desde Elideysi».
            </span>
          </div>

          {error && (
            <div className="alert alert-danger" style={{ marginTop: 14 }}>
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="modal-actions">
            {confirmDiscard ? (
              <>
                <span className="modal-confirm">Se perderá el tiempo medido.</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmDiscard(false)}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button type="button" className="btn-danger" onClick={handleDiscard} disabled={saving}>
                  Sí, descartar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-ghost modal-action-start"
                  onClick={() => setConfirmDiscard(true)}
                  disabled={saving}
                  title="Cerrar el cronómetro sin registrar nada en Odoo"
                >
                  Descartar
                </button>
                <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
                  Seguir midiendo
                </button>
                <button type="submit" className="btn-danger" disabled={saving}>
                  <IconStop size={13} />
                  {saving ? 'Registrando...' : 'Registrar en Odoo'}
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
