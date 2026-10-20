import { useEffect, useState } from 'react';
import { TeamMemberSummary } from '../types';
import { IconAlert, IconCheck, IconClose, IconRefresh, IconSparkle } from './Icons';

interface Props {
  employeeId: number;
  name: string;
  onClose: () => void;
}

function formatHours(hours: number) {
  if (!hours) return '0 h';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

export default function TeamSummaryModal({ employeeId, name, onClose }: Props) {
  const [summary, setSummary] = useState<TeamMemberSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generar() {
    setLoading(true);
    setError(null);
    try {
      setSummary(await window.api.getTeamMemberSummary(employeeId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el resumen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    generar();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function copiar() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('No se pudo copiar al portapapeles');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="panel-title">
            <h2>Semana de {summary?.name || name}</h2>
            {summary && (
              <span className="count-chip">
                {summary.since} → {summary.until}
              </span>
            )}
          </div>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar">
            <IconClose size={16} />
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="alert alert-danger">
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="splash-inner" style={{ padding: 32 }}>
              <div className="spinner" />
              <span>Leyendo sus hojas de horas y redactando el resumen...</span>
            </div>
          ) : (
            summary && (
              <>
                <div className="summary-totals">
                  <span>
                    <strong>{formatHours(summary.loggedHours)}</strong> imputadas
                  </span>
                  {summary.workedHours > 0 && (
                    <span>
                      <strong>{formatHours(summary.workedHours)}</strong> de jornada
                    </span>
                  )}
                  <span>
                    <strong>{summary.byProject.length}</strong>{' '}
                    {summary.byProject.length === 1 ? 'proyecto' : 'proyectos'}
                  </span>
                </div>

                <ul className="usage-legend" style={{ marginBottom: 12 }}>
                  {summary.byProject.map((proyecto) => (
                    <li key={proyecto.name}>
                      {proyecto.name}
                      <em>{formatHours(proyecto.hours)}</em>
                    </li>
                  ))}
                </ul>

                <p className="summary-text">{summary.text}</p>

                <p className="browse-hint" style={{ padding: 0, marginTop: 10 }}>
                  Redactado por Claude con las hojas de horas de la semana. Conviene leerlo antes
                  de reenviarlo.
                </p>
              </>
            )
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary btn-sm" onClick={generar} disabled={loading}>
            <IconRefresh size={14} />
            Rehacer
          </button>
          <button className="btn-secondary btn-sm" onClick={copiar} disabled={!summary || loading}>
            {copied ? <IconCheck size={14} /> : <IconSparkle size={14} />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <button onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
