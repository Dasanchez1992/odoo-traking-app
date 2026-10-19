import { useEffect, useState } from 'react';
import { MentionableUser, OdooMessage, OdooTask, TaskStage } from '../types';
import { formatOdooDateTime } from '../lib/odooDate';
import { IconAlert, IconCheck, IconClose, IconExternal } from './Icons';
import MentionTextarea, { Mention } from './MentionTextarea';

interface Props {
  task: OdooTask;
  onClose: () => void;
  onChanged: () => void;
}

function plainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function TaskDetailModal({ task, onClose, onChanged }: Props) {
  const [stages, setStages] = useState<TaskStage[]>([]);
  const [stageId, setStageId] = useState<number | null>(task.stage_id ? task.stage_id[0] : null);
  const [messages, setMessages] = useState<OdooMessage[]>([]);
  const [users, setUsers] = useState<MentionableUser[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);

  const [body, setBody] = useState('');
  const [isNote, setIsNote] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const projectId = task.project_id ? task.project_id[0] : null;
    Promise.all([
      window.api.getTaskStages(projectId).catch(() => []),
      window.api.getTaskMessages(task.id).catch(() => []),
      window.api.getMentionableUsers().catch(() => []),
    ])
      .then(([listaEtapas, listaMensajes, listaUsuarios]) => {
        setStages(listaEtapas);
        setMessages(listaMensajes);
        setUsers(listaUsuarios);
      })
      .finally(() => setLoading(false));
  }, [task.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  async function handleStageChange(nuevo: number) {
    const anterior = stageId;
    setStageId(nuevo);
    setError(null);
    try {
      await window.api.setTaskStage(task.id, nuevo);
      onChanged();
    } catch (err) {
      setStageId(anterior);
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la etapa');
    }
  }

  async function handleSend() {
    const texto = body.trim();
    if (!texto) {
      setError('Escribe el mensaje antes de enviarlo.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await window.api.postTaskMessage(task.id, {
        body: texto,
        // El enlace de la mención lo arma el proceso principal: necesita la URL de Odoo.
        mentions,
        isNote,
      });

      setBody('');
      setMentions([]);
      setMessages(await window.api.getTaskMessages(task.id).catch(() => messages));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="task-detail-title">
            <h2 title={task.name}>{task.name}</h2>
            <span>{task.project_id ? task.project_id[1] : 'Sin proyecto'}</span>
          </div>
          <div className="task-detail-head-actions">
            <button
              className="btn-ghost btn-sm"
              onClick={() => window.api.openTaskInOdoo(task.id).catch(() => {})}
              title="Abrir en Odoo"
            >
              <IconExternal size={14} />
              Odoo
            </button>
            <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar">
              <IconClose size={16} />
            </button>
          </div>
        </div>

        <div className="modal-body task-detail-body">
          {error && (
            <div className="alert alert-danger">
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="task-stage">
              Etapa
            </label>
            <select
              id="task-stage"
              value={stageId ?? ''}
              onChange={(e) => handleStageChange(Number(e.target.value))}
              disabled={loading || stages.length === 0}
            >
              {stages.length === 0 && <option value="">Sin etapas disponibles</option>}
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
            <span className="field-hint">El cambio se guarda en Odoo al seleccionarlo.</span>
          </div>

          <div className="field">
            <div className="task-detail-message-head">
              <span className="field-label">Mensaje</span>
              <div className="segmented">
                <button
                  className={isNote ? 'is-active' : ''}
                  onClick={() => setIsNote(true)}
                  type="button"
                >
                  Nota interna
                </button>
                <button
                  className={!isNote ? 'is-active' : ''}
                  onClick={() => setIsNote(false)}
                  type="button"
                >
                  Mensaje
                </button>
              </div>
            </div>

            <MentionTextarea
              rows={3}
              placeholder={
                isNote
                  ? 'Nota visible solo para el equipo interno... escribe @ para etiquetar'
                  : 'Mensaje a los seguidores... escribe @ para etiquetar'
              }
              value={body}
              users={users}
              onChange={(texto, lista) => {
                setBody(texto);
                setMentions(lista);
              }}
              disabled={saving}
            />

            <span className="field-hint">
              Escribe <strong>@</strong> y el nombre para etiquetar a alguien; le llegará el aviso
              en Odoo.{' '}
              {isNote
                ? 'La nota queda en el historial de la tarea.'
                : 'El mensaje notifica a todos los seguidores.'}
            </span>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cerrar
            </button>
            <button type="button" onClick={handleSend} disabled={saving || !body.trim()}>
              <IconCheck size={14} />
              {saving ? 'Enviando...' : isNote ? 'Guardar nota' : 'Enviar mensaje'}
            </button>
          </div>

          <div className="task-detail-history">
            <span className="field-label">Historial reciente</span>
            {loading ? (
              <p className="notif-empty">Cargando...</p>
            ) : messages.length === 0 ? (
              <p className="notif-empty">Todavía no hay mensajes en esta tarea.</p>
            ) : (
              <ul className="message-list">
                {messages.map((m) => {
                  const texto = plainText(m.body || '');
                  if (!texto) return null;
                  return (
                    <li className="message-item" key={m.id}>
                      <div className="message-meta">
                        <strong>{m.author_id ? m.author_id[1] : 'Sistema'}</strong>
                        <span>{formatOdooDateTime(m.date)}</span>
                      </div>
                      <p>{texto}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
