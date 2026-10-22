import { useMemo, useState } from 'react';
import { TeamSchedule, WorkloadAnalysis } from '../types';
import { PersonLoad, buildLoads } from '../lib/workload';
import { formatOdooDateShort } from '../lib/odooDate';
import { IconAlert, IconCheck, IconClose, IconSparkle } from './Icons';

interface Props {
  schedule: TeamSchedule;
  onClose: () => void;
}

type Lectura = WorkloadAnalysis['people'][number];

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

function hueco(horas: number) {
  return horas < 0 ? `${Math.abs(horas)} h de más` : `${horas} h`;
}

function Ficha({ persona, lectura }: { persona: PersonLoad; lectura?: Lectura }) {
  return (
    <article className="wl-card">
      <header className="wl-card-head">
        <strong title={persona.name}>{persona.name}</strong>
        {lectura && <span className={`pill ${ESTADOS[lectura.estado] || ''}`}>{lectura.estado}</span>}
        <span className="wl-when">
          libre {cuando(lectura ? lectura.disponibleDesde : persona.freeFrom)}
        </span>
      </header>

      <dl className="wl-stats">
        <div>
          <dt>Pendiente</dt>
          <dd>{persona.pendingHours} h</dd>
        </div>
        <div>
          <dt>Tareas</dt>
          <dd>
            {persona.openTasks}
            {persona.unestimated > 0 && <em> · {persona.unestimated} sin estimar</em>}
          </dd>
        </div>
        <div>
          <dt>Vencidas</dt>
          <dd className={persona.overdue > 0 ? 'is-danger' : ''}>{persona.overdue}</dd>
        </div>
        <div>
          <dt>Hueco esta semana</dt>
          <dd className={persona.slackHours < 0 ? 'is-danger' : ''}>{hueco(persona.slackHours)}</dd>
        </div>
      </dl>

      {lectura && (
        <p className="wl-why" title={lectura.motivo}>
          {lectura.motivo}
        </p>
      )}
    </article>
  );
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

  const porPersona = new Map<number, Lectura>(
    analisis?.people.map((p) => [p.employeeId, p]) ?? [],
  );
  const mejor = analisis
    ? cargas.find((c) => c.employeeId === analisis.mejorOpcion.employeeId)
    : null;

  // Primero quienes pueden asumir algo, que es lo que se viene a buscar, y dentro de cada
  // grupo el que menos carga arrastra.
  const grupos = useMemo(() => {
    const pueden: PersonLoad[] = [];
    const no: PersonLoad[] = [];
    seleccionadas.forEach((persona) => {
      const lectura = porPersona.get(persona.employeeId);
      (lectura?.puedeParalelo ? pueden : no).push(persona);
    });
    const porCarga = (a: PersonLoad, b: PersonLoad) => a.pendingHours - b.pendingHours;
    return { pueden: pueden.sort(porCarga), no: no.sort(porCarga) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analisis, elegidos]);

  return (
    <div className="modal-overlay" onClick={() => !cargando && onClose()}>
      <div
        className="modal modal-wide modal-tall"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <div className="panel-title">
            <h2>Análisis de carga</h2>
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

          {!analisis && !cargando && (
            <>
              <p className="wl-lead">
                Elige a quién mirar. Las horas y los huecos salen de las tareas de Odoo; la lectura
                de en quién cabe una tarea más la hace Claude con esos números.
              </p>

              <div className="wl-pick-actions">
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setElegidos(new Set(cargas.map((c) => c.employeeId)))}
                >
                  Todos
                </button>
                <button className="btn-secondary btn-sm" onClick={() => setElegidos(new Set())}>
                  Ninguno
                </button>
              </div>

              <ul className="wl-pick">
                {cargas.map((persona) => (
                  <li key={persona.employeeId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={elegidos.has(persona.employeeId)}
                        onChange={() => alternar(persona.employeeId)}
                      />
                      <span className="wl-pick-name">{persona.name}</span>
                      <span className="wl-pick-meta">
                        {persona.pendingHours} h · {plural(persona.openTasks, 'tarea', 'tareas')}
                        {persona.overdue > 0 && (
                          <em className="is-danger"> · {persona.overdue} vencidas</em>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          {cargando && (
            <div className="splash-inner" style={{ padding: 32 }}>
              <div className="spinner" />
              <span>Midiendo la carga de cada quien...</span>
            </div>
          )}

          {analisis && !cargando && (
            <>
              <p className="wl-lead">{analisis.summary}</p>

              {mejor && (
                <div className="wl-best">
                  <IconCheck size={15} />
                  <div>
                    <strong>{mejor.name}</strong>
                    <span>{analisis.mejorOpcion.porQue}</span>
                  </div>
                </div>
              )}

              {grupos.pueden.length > 0 && (
                <>
                  <h3 className="wl-group">
                    Pueden asumir algo <span>{grupos.pueden.length}</span>
                  </h3>
                  {grupos.pueden.map((persona) => (
                    <Ficha
                      key={persona.employeeId}
                      persona={persona}
                      lectura={porPersona.get(persona.employeeId)}
                    />
                  ))}
                </>
              )}

              {grupos.no.length > 0 && (
                <>
                  <h3 className="wl-group">
                    Mejor no cargarles más <span>{grupos.no.length}</span>
                  </h3>
                  {grupos.no.map((persona) => (
                    <Ficha
                      key={persona.employeeId}
                      persona={persona}
                      lectura={porPersona.get(persona.employeeId)}
                    />
                  ))}
                </>
              )}

              {analisis.riesgos.length > 0 && (
                <details className="wl-risks">
                  <summary>
                    <IconAlert size={13} />
                    Riesgos <span>{analisis.riesgos.length}</span>
                  </summary>
                  <ul>
                    {analisis.riesgos.map((riesgo) => (
                      <li key={riesgo}>{riesgo}</li>
                    ))}
                  </ul>
                </details>
              )}

              <p className="wl-foot">
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
            {analisis ? 'Rehacer' : 'Analizar carga'}
          </button>
          <button className="btn-secondary btn-sm" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
