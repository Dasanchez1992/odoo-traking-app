import { useEffect, useMemo, useState } from 'react';
import { TeamMember, UsageRange } from '../types';
import {
  UsageMode,
  formatearDuracion,
  hoyEnEcuador,
  porPersona,
  rangoDe,
  recortar,
  totalPorApp,
} from '../lib/usage';
import { IconAlert, IconChevronDown, IconClock, IconRefresh } from './Icons';

const COLORES = ['#2563eb', '#0ea5e9', '#14b8a6', '#f59e0b', '#a855f7', '#ef4444'];
const COLOR_RESTO = '#94a3b8';

interface Props {
  members: TeamMember[];
}

export default function TeamUsage({ members }: Props) {
  const [permitido, setPermitido] = useState<boolean | null>(null);
  const [modo, setModo] = useState<UsageMode>('dia');
  const [fecha, setFecha] = useState(hoyEnEcuador());
  const [datos, setDatos] = useState<UsageRange | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);

  const rango = useMemo(() => rangoDe(fecha, modo), [fecha, modo]);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const puede = await window.api.canReviewUsage();
      setPermitido(puede);
      setDatos(puede ? await window.api.getTeamUsage(rango) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el uso de aplicaciones');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rango.from, rango.to]);

  const gente = useMemo(() => porPersona(datos?.days ?? []), [datos]);
  const equipo = useMemo(() => recortar(totalPorApp(datos?.days ?? []), COLORES.length), [datos]);
  const totalEquipo = equipo.reduce((suma, uso) => suma + uso.seconds, 0);

  const colorDe = useMemo(() => {
    const mapa = new Map<string, string>();
    equipo.forEach((uso, i) => mapa.set(uso.app, COLORES[i] ?? COLOR_RESTO));
    return (clave: string) => mapa.get(clave) ?? COLOR_RESTO;
  }, [equipo]);

  const conDatos = new Set(gente.map((p) => p.userId));
  const sinRegistro = members.filter((m) => m.hasUser && m.userId && !conDatos.has(m.userId));

  return (
    <section className="card usage-panel">
      <div className="panel-head">
        <div className="panel-title">
          <h2>Uso de aplicaciones</h2>
          {datos && <span className="count-chip">{gente.length}</span>}
        </div>
        <button className="btn-secondary btn-sm" onClick={cargar} disabled={cargando}>
          <IconRefresh size={14} />
          Actualizar
        </button>
      </div>

      {permitido === false ? (
        <div className="empty-state">
          <strong>Hace falta el permiso para revisarlo</strong>
          <span>
            En Odoo, el grupo «Elipsys Time / Revisar el uso de aplicaciones» (o, si todavía no
            está instalado el módulo, «Administración / Ajustes»). Sin él solo se ve el uso
            propio, en Configuración.
          </span>
        </div>
      ) : (
        <>
          <div className="task-filters">
            <div className="segmented">
              <button
                className={modo === 'dia' ? 'is-active' : ''}
                onClick={() => setModo('dia')}
                type="button"
              >
                Día
              </button>
              <button
                className={modo === 'semana' ? 'is-active' : ''}
                onClick={() => setModo('semana')}
                type="button"
              >
                Semana
              </button>
              <button
                className={modo === 'mes' ? 'is-active' : ''}
                onClick={() => setModo('mes')}
                type="button"
              >
                Mes
              </button>
            </div>

            <input
              type="date"
              value={fecha}
              max={hoyEnEcuador()}
              onChange={(e) => setFecha(e.target.value || hoyEnEcuador())}
              aria-label="Fecha de referencia"
            />

            {rango.from !== rango.to && (
              <span className="usage-range">
                {rango.from} → {rango.to}
              </span>
            )}
          </div>

          {error && (
            <div className="alert alert-danger" style={{ margin: '0 18px 14px' }}>
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          {cargando ? (
            <div className="splash-inner" style={{ padding: 32 }}>
              <div className="spinner" />
              <span>Cargando el uso del equipo...</span>
            </div>
          ) : gente.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">
                <IconClock size={20} />
              </span>
              <strong>Todavía no hay registros</strong>
              <span>
                Cada equipo sube su resumen cada pocos minutos, siempre que tenga la app abierta y
                el registro activado.
              </span>
            </div>
          ) : (
            <>
              <div className="usage-total">
                <div className="usage-bar" role="img" aria-label="Reparto por aplicación">
                  {equipo.map((uso) => (
                    <span
                      key={uso.app}
                      style={{
                        width: `${(uso.seconds / Math.max(totalEquipo, 1)) * 100}%`,
                        background: colorDe(uso.app),
                      }}
                      title={`${uso.label}: ${formatearDuracion(uso.seconds)}`}
                    />
                  ))}
                </div>
                <ul className="usage-legend">
                  {equipo.map((uso) => (
                    <li key={uso.app}>
                      <i style={{ background: colorDe(uso.app) }} />
                      {uso.label}
                      <em>{formatearDuracion(uso.seconds)}</em>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="usage-head">
                <span>Persona</span>
                <span>Reparto</span>
                <span className="align-end">Días</span>
                <span className="align-end">Inactivo</span>
                <span className="align-end">Frente al equipo</span>
              </div>

              {gente.map((persona) => {
                const propias = recortar(persona.apps, COLORES.length);
                const desplegado = abierto === persona.userId;

                return (
                  <div className="usage-person" key={persona.userId}>
                    <button
                      className="usage-row"
                      onClick={() => setAbierto(desplegado ? null : persona.userId)}
                      aria-expanded={desplegado}
                    >
                      <span className="usage-name">
                        <IconChevronDown size={13} className={desplegado ? 'is-open' : ''} />
                        <strong title={persona.name}>{persona.name}</strong>
                      </span>

                      <span className="usage-bar is-thin">
                        {propias.map((uso) => (
                          <i
                            key={uso.app}
                            style={{
                              width: `${(uso.seconds / Math.max(persona.activeSeconds, 1)) * 100}%`,
                              background: colorDe(uso.app),
                            }}
                            title={`${uso.label}: ${formatearDuracion(uso.seconds)}`}
                          />
                        ))}
                      </span>

                      <span className="usage-cell align-end">{persona.days}</span>
                      <span className="usage-cell align-end team-muted">
                        {formatearDuracion(persona.idleSeconds)}
                      </span>
                      <span className="usage-cell align-end">
                        <strong>{formatearDuracion(persona.activeSeconds)}</strong>
                      </span>
                    </button>

                    {desplegado && (
                      <ul className="hbar-list usage-detail">
                        {persona.apps.map((uso) => (
                          <li className="hbar-row" key={uso.app}>
                            <div className="hbar-head">
                              <span className="hbar-name" title={uso.app}>
                                {uso.label}
                              </span>
                              <span className="hbar-value">
                                {formatearDuracion(uso.seconds)}
                                <em>
                                  {Math.round((uso.seconds / Math.max(persona.activeSeconds, 1)) * 100)}%
                                </em>
                              </span>
                            </div>
                            <div className="hbar-track">
                              <div
                                className="hbar-fill"
                                style={{
                                  width: `${(uso.seconds / Math.max(persona.apps[0]?.seconds ?? 1, 1)) * 100}%`,
                                  background: colorDe(uso.app),
                                }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}

              {sinRegistro.length > 0 && (
                <p className="browse-hint">
                  Sin registro en este periodo: {sinRegistro.map((m) => m.name).join(', ')}.
                </p>
              )}
            </>
          )}

          <p className="browse-hint">
            Se registra el tiempo que cada programa pasa en primer plano, y nada más: ni títulos de
            ventana, ni teclas, ni capturas de pantalla. El tiempo sin tocar el equipo durante más
            de cinco minutos cuenta como inactivo.
          </p>
        </>
      )}
    </section>
  );
}
