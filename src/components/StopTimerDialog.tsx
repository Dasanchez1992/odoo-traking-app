import { FormEvent, useEffect, useState } from 'react';
import { MentionableUser, TimerState } from '../types';
import { formatElapsed, timerElapsedMs } from '../lib/format';
import { IconAlert, IconCheck, IconClose, IconStop } from './Icons';
import MentionTextarea, { Mention } from './MentionTextarea';

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

  // Nota opcional en el historial del registro. El tiempo sin tarea no tiene dónde dejarla.
  const admiteNota = timer.kind === 'task' || timer.kind === 'ticket';
  const esTicket = timer.kind === 'ticket';
  const [withNote, setWithNote] = useState(false);
  const [note, setNote] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [isNote, setIsNote] = useState(true);
  const [users, setUsers] = useState<MentionableUser[]>([]);
  // Si el tiempo ya entró en Odoo, un reintento no debe volver a registrarlo.
  const [timeSaved, setTimeSaved] = useState(false);
  const [noteFailed, setNoteFailed] = useState(false);

  const medidoMs = timerElapsedMs(timer, stoppedAt);
  // El cronómetro es una propuesta: el usuario ajusta la duración antes de registrarla.
  const [horas, setHoras] = useState(() => Math.floor(medidoMs / 3600000));
  const [minutos, setMinutos] = useState(() => Math.round((medidoMs % 3600000) / 60000));

  const elapsedMs = (horas * 60 + minutos) * 60000;
  const elapsedMinutes = elapsedMs / 60000;
  const appliesMinimum = elapsedMinutes > 0 && elapsedMinutes < MIN_BILLABLE_MINUTES;
  const ajustado = Math.abs(elapsedMs - medidoMs) >= 60000;

  useEffect(() => {
    if (!withNote || users.length > 0) return;
    window.api.getMentionableUsers().then(setUsers).catch(() => setUsers([]));
  }, [withNote, users.length]);

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
      await window.api.discardTimer(timer.key);
      onDiscarded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descartar el tiempo');
      setSaving(false);
    }
  }

  const description_trimmed = description.trim();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!description_trimmed) {
      setError('Describe el trabajo realizado antes de registrarlo.');
      return;
    }
    if (elapsedMinutes <= 0) {
      setError('Indica cuánto tiempo dedicaste a la tarea.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // El tiempo va primero: es lo que no se puede perder. La nota se publica después.
      if (!timeSaved) {
        await window.api.stopTimer({ key: timer.key, description, stoppedAt, elapsedMs });
        setTimeSaved(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el tiempo');
      setSaving(false);
      return;
    }

    const texto = note.trim();
    if (withNote && texto) {
      try {
        await window.api.postRecordMessage(timer.kind === 'ticket' ? 'ticket' : 'task', timer.taskId, {
          body: texto,
          mentions,
          isNote,
        });
      } catch (err) {
        setNoteFailed(true);
        setError(
          `El tiempo quedó registrado, pero la nota no se pudo publicar: ${
            err instanceof Error ? err.message : 'error desconocido'
          }`,
        );
        setSaving(false);
        return;
      }
    }

    onRegistered();
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
            <div className="stop-summary-time">{formatElapsed(medidoMs)}</div>
          </div>

          <div className="stop-duration">
            <span className="field-label">Tiempo a registrar</span>
            <div className="stop-duration-fields">
              <input
                type="number"
                min={0}
                max={23}
                value={horas}
                onChange={(e) => setHoras(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                disabled={saving}
                aria-label="Horas"
              />
              <span>h</span>
              <input
                type="number"
                min={0}
                max={59}
                value={minutos}
                onChange={(e) => setMinutos(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                disabled={saving}
                aria-label="Minutos"
              />
              <span>min</span>
              {ajustado && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setHoras(Math.floor(medidoMs / 3600000));
                    setMinutos(Math.round((medidoMs % 3600000) / 60000));
                  }}
                  disabled={saving}
                >
                  Usar lo medido
                </button>
              )}
            </div>
            {ajustado && (
              <span className="field-hint">
                Se registrará este tiempo en lugar de los {formatElapsed(medidoMs)} del cronómetro.
              </span>
            )}
          </div>

          {appliesMinimum && (
            <p className="stop-minimum">
              Se registrarán <strong>5 minutos</strong>, que es el mínimo por registro.
            </p>
          )}

          <div className="field" style={{ marginTop: 16 }}>
            <label className="field-label" htmlFor="timesheet-description">
              Descripción del trabajo <span className="field-required">*</span>
            </label>
            <textarea
              id="timesheet-description"
              rows={3}
              autoFocus
              placeholder="Qué hiciste en este tiempo..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              required
            />
            <span className="field-hint">
              Es lo que aparecerá en la hoja de horas de Odoo, así que es obligatoria.
            </span>
          </div>

          {admiteNota && (
            <div className="field stop-note">
              <label className="stop-note-toggle">
                <input
                  type="checkbox"
                  checked={withNote}
                  onChange={(e) => setWithNote(e.target.checked)}
                  disabled={saving || timeSaved}
                />
                Dejar también una nota en {esTicket ? 'el ticket' : 'la tarea'}
              </label>

              {withNote && (
                <>
                  <div className="task-detail-message-head">
                    <span className="field-label">
                      Para el historial {esTicket ? 'del ticket' : 'de la tarea'}
                    </span>
                    <div className="segmented">
                      <button
                        type="button"
                        className={isNote ? 'is-active' : ''}
                        onClick={() => setIsNote(true)}
                        disabled={saving}
                      >
                        Nota interna
                      </button>
                      <button
                        type="button"
                        className={!isNote ? 'is-active' : ''}
                        onClick={() => setIsNote(false)}
                        disabled={saving}
                      >
                        Mensaje
                      </button>
                    </div>
                  </div>

                  <MentionTextarea
                    rows={2}
                    placeholder="Qué conviene que sepa el equipo... escribe @ para etiquetar"
                    value={note}
                    users={users}
                    onChange={(texto, lista) => {
                      setNote(texto);
                      setMentions(lista);
                    }}
                    disabled={saving}
                  />
                  <span className="field-hint">
                    Escribe <strong>@</strong> y el nombre para etiquetar a alguien; le llegará el
                    aviso en Odoo. Esto es aparte de la descripción de la hoja de horas.
                  </span>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="alert alert-danger" style={{ marginTop: 14 }}>
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="modal-actions">
            {noteFailed ? (
              // El tiempo ya está en Odoo: desde aquí solo queda reintentar la nota o salir.
              <>
                <span className="modal-confirm">El tiempo ya quedó registrado.</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onRegistered}
                  disabled={saving}
                >
                  Cerrar sin la nota
                </button>
                <button type="submit" className="btn-danger" disabled={saving}>
                  <IconCheck size={13} />
                  {saving ? 'Publicando...' : 'Reintentar nota'}
                </button>
              </>
            ) : confirmDiscard ? (
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
                <button
                  type="submit"
                  className="btn-danger"
                  disabled={saving || !description_trimmed}
                  title={!description_trimmed ? 'Escribe qué hiciste para poder registrar' : undefined}
                >
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
