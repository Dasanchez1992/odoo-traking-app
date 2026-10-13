import { useEffect } from 'react';
import { ReleaseNotes } from '../types';
import { IconCheck, IconClose, IconExternal } from './Icons';

interface Props {
  notes: ReleaseNotes;
  onClose: () => void;
}

export default function ReleaseNotesModal({ notes, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="release-head">
            <h2>Novedades</h2>
            <span className="pill is-brand">Versión {notes.version}</span>
          </div>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar">
            <IconClose size={16} />
          </button>
        </div>

        <div className="modal-body release-body">
          <p className="release-intro">
            La aplicación se actualizó sola. Esto es lo que cambió:
          </p>

          <ul className="release-list">
            {notes.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>

          <div className="modal-actions">
            {notes.url && (
              <button
                className="btn-ghost btn-sm"
                style={{ marginRight: 'auto' }}
                onClick={() => window.api.openReleasePage().catch(() => {})}
              >
                <IconExternal size={13} />
                Ver en GitHub
              </button>
            )}
            <button onClick={onClose}>
              <IconCheck size={14} />
              Entendido
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
