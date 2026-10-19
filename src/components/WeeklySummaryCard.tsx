import { useEffect, useState } from 'react';
import { WeeklySummary } from '../types';
import { IconAlert, IconCheck, IconRefresh, IconSparkle } from './Icons';

export default function WeeklySummaryCard() {
  const [aiOk, setAiOk] = useState(false);
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api
      .getAiStatus()
      .then((estado) => setAiOk(estado.available))
      .catch(() => setAiOk(false));
  }, []);

  async function generar() {
    setLoading(true);
    setError(null);
    try {
      setSummary(await window.api.getWeeklySummary());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el resumen');
    } finally {
      setLoading(false);
    }
  }

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

  if (!aiOk) return null;

  return (
    <section className="card summary-card">
      <div className="chart-head summary-head">
        <div>
          <h3>Resumen de la semana</h3>
          <span className="chart-sub">
            {summary
              ? `Del ${summary.since} al ${summary.until} · ${summary.byProject.length} proyecto(s)`
              : 'A partir de tus hojas de horas, listo para enviar al cliente'}
          </span>
        </div>
        <div className="panel-actions">
          {summary && (
            <button className="btn-secondary btn-sm" onClick={copiar}>
              <IconCheck size={13} />
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          )}
          <button className="btn-secondary btn-sm" onClick={generar} disabled={loading}>
            {summary ? <IconRefresh size={13} /> : <IconSparkle size={13} />}
            {loading ? 'Redactando...' : summary ? 'Rehacer' : 'Generar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginTop: 12 }}>
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      {summary && <p className="summary-text">{summary.text}</p>}

      {summary && (
        <p className="field-hint summary-foot">
          Redactado a partir de lo que registraste; revísalo antes de enviarlo.
        </p>
      )}
    </section>
  );
}
