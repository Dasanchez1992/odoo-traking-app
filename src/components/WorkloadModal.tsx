import { useMemo, useState } from 'react';
import { TeamSchedule, WorkloadAnalysis } from '../types';
import { PersonLoad, buildLoads } from '../lib/workload';
import { formatOdooDateShort } from '../lib/odooDate';
import { IconAlert, IconCheck, IconClose, IconSparkle } from './Icons';

interface Props {
  schedule: TeamSchedule;
  onClose: () => void;
}

const ESTADOS: Record<string, string> = {
  libre: 'is-success',
  ajustado: 'is-warning',
  saturado: 'is-danger',
};

function cuando(valor: string) {
  if (!valor || valor === 'ahora') return 'ahora';
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? formatOdooDateShort(valor) : valor;
}

function plural(cantidad: number, singular: string, plural_: string) {
  return `${cantidad} ${cantidad === 1 ? singular : plural_}`;
}

function resumenCargas(persona: PersonLoad) {
  const partes = [
    `${persona.pendingHours} h pendientes`,
    plural(persona.openTasks, 'tarea', 'tareas'),
  ];
  if (persona.unestimated) partes.push(`${persona.unestimated} sin estimar`);
  if (persona.overdue) partes.push(plural(persona.overdue, 'vencida', 'vencidas'));
  return partes.join(' · ');
}

// Un hueco negativo es carga de más: decirlo así se entiende mejor que «-12 h».
function hueco(horas: number) {
  if (horas < 0) return `${Math.abs(horas)} h por encima de su capacidad`;
  return `${horas} h de hueco esta semana`;
}

export default function WorkloadModal({ schedule, onClose }: Props) {
  const cargas = useMemo(() => buildLoads(schedule), [schedule]);
  const [elegidos, setElegidos] = useState<Set<number>>(
    () => new Set(cargas.map((c) => c.employeeId)),
  );
  const [analisis, setAnalisis] = useState<WorkloadAnalysis | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seleccionadas = cargas.filter((c) => elegidos.has(c.employeeId));

  function alternar(id: number) {
    setElegidos((previos) => {
      const siguiente = new Set(previos);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  async function analizar() {
    setCargando(true);
    setError(null);
    try {
      setAnalisis(await window.api.analyzeWorkload({ people: seleccionadas }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo analizar la carga');
    } finally {
      setCargando(false);
    }
  }

  const porPersona = new Map(analisis?.people.map((p) => [p.employeeId, p]) ?? []);
  const mejor = analisis ? cargas.find((c) => c.employeeId === analisis.mejorOpcion.employeeId) : null;

  return (
    <div className="modal-overlay" onClick={() => !cargando && onClose()}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="panel-title">
            <h2>Análisis de carga de trabajo</h2>
            <span className="count-chip">{seleccionadas.length}</span>
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

          {!analisis && (
            <>
              <p className="browse-hint" style={{ padding: '0 0 10px' }}>
                Elige a quién mirar. Las horas pendientes y los huecos salen de las tareas de Odoo;
                la lectura de en quién cabe una tarea más la hace Claude con esos números.
              </p>

              <div className="task-filters" style={{ padding: 0, border: 'none' }}>
                <button className="btn-secondary btn-sm" onClick={() => setElegidos(new Set(cargas.map((c) => c.employeeId)))}>
                  Todos
                </button>
                <button className="btn-secondary btn-sm" onClick={() => setElegidos(new Set())}>
                  Ninguno
                </button>
              </div>

              <ul className="workload-pick">
                {cargas.map((persona) => (
                  <li key={persona.employeeId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={elegidos.has(persona.employeeId)}
                        onChange={() => alternar(persona.employeeId)}
                      />
                      <span className="workload-name">{persona.name}</span>
                      <span className="workload-meta">{resumenCargas(persona)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          {cargando && (
            <div className="splash-inner" style={{ padding: 32 }}>
              <div className="spinner" />
              <span>Leyendo el reparto y midiendo la carga de cada quien...</span>
            </div>
          )}

          {analisis && !cargando && (
            <>
              <p className="summary-text">{analisis.summary}</p>

              {mejor && (
                <div className="alert alert-success" style={{ marginBottom: 12 }}>
                  <IconCheck size={16} />
                  <span>
                    <strong>{mejor.name}</strong> es quien mejor puede asumir algo más.{' '}
                    {analisis.mejorOpcion.porQue}
                  </span>
                </div>
              )}

              {seleccionadas.map((persona) => {
                const lectura = porPersona.get(persona.employeeId);
                return (
                  <div className="workload-row" key={persona.employeeId}>
                    <div className="workload-head">
                      <strong>{persona.name}</strong>
                      {lectura && (
                        <span className={`pill ${ESTADOS[lectura.estado] || ''}`}>{lectura.estado}</span>
                      )}
                      {lectura && (
                        <span className={`pill ${lectura.puedeParalelo ? 'is-brand' : ''}`}>
                          {lectura.puedeParalelo ? 'admite algo en paralelo' : 'mejor no cargarle más'}
                        </span>
                      )}
                    </div>

                    <div className="workload-meta">
                      {resumenCargas(persona)} · {hueco(persona.slackHours)} · libre{' '}
                      {cuando(lectura ? lectura.disponibleDesde : persona.freeFrom)}
                    </div>

                    {lectura && <p className="workload-motivo">{lectura.motivo}</p>}
                  </div>
                );
              })}

              {analisis.riesgos.length > 0 && (
                <div className="workload-riesgos">
                  <strong>Riesgos</strong>
                  <ul>
                    {analisis.riesgos.map((riesgo) => (
                      <li key={riesgo}>{riesgo}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="browse-hint" style={{ padding: '10px 0 0' }}>
                Las cuentas son de Odoo; la lectura es de Claude. Conviene contrastarla antes de
                mover tareas.
              </p>
            </>
          )}
        </div>

        <div className="modal-actions">
          {analisis && (
            <button className="btn-secondary btn-sm" onClick={() => setAnalisis(null)}>
              Elegir otros
            </button>
          )}
          <button onClick={analizar} disabled={cargando || seleccionadas.length === 0}>
            <IconSparkle size={13} />
            {analisis ? 'Rehacer análisis' : 'Analizar carga'}
          </button>
          <button className="btn-secondary btn-sm" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
