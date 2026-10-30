import { useEffect, useState } from 'react';
import {
  PullRequest,
  PullRequestDetail,
  PullRequestList,
  PullRequestScope,
  PullRequestState,
} from '../types';
import Segmented from './Segmented';
import {
  IconAlert,
  IconChat,
  IconCheck,
  IconChevronDown,
  IconExternal,
  IconRefresh,
  IconSearch,
} from './Icons';

const ESTADOS: { value: PullRequestState; label: string }[] = [
  { value: 'abiertos', label: 'Abiertos' },
  { value: 'fusionados', label: 'Fusionados' },
  { value: 'cerrados', label: 'Cerrados' },
  { value: 'todos', label: 'Todos' },
];

const AMBITOS: { value: PullRequestScope; label: string }[] = [
  { value: 'mios', label: 'Míos' },
  { value: 'revisar', label: 'Para revisar' },
  { value: 'organizacion', label: 'Toda la organización' },
];

const ESTADO_PR: Record<string, { texto: string; clase: string }> = {
  open: { texto: 'abierto', clase: 'is-success' },
  merged: { texto: 'fusionado', clase: 'is-brand' },
  closed: { texto: 'cerrado', clase: 'is-danger' },
};

function hace(iso: string) {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias < 31) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  return new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

function Detalle({ pr }: { pr: PullRequest }) {
  const [detalle, setDetalle] = useState<PullRequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    window.api
      .getPullRequestDetail({ repo: pr.repo, number: pr.number })
      .then((d) => vivo && setDetalle(d))
      .catch((err) => vivo && setError(err instanceof Error ? err.message : 'No se pudo leer el detalle'));
    return () => {
      vivo = false;
    };
  }, [pr.repo, pr.number]);

  return (
    <div className="pr-detail">
      {pr.body && <p className="pr-body">{pr.body.slice(0, 600)}</p>}

      {error && (
        <div className="alert alert-danger">
          <IconAlert size={15} />
          <span>{error}</span>
        </div>
      )}

      {!detalle && !error && <span className="pr-cargando">Leyendo el detalle en GitHub...</span>}

      {detalle && (
        <>
          <dl className="pr-stats">
            <div>
              <dt>Cambios</dt>
              <dd>
                <span className="pr-mas">+{detalle.additions}</span>{' '}
                <span className="pr-menos">−{detalle.deletions}</span>
              </dd>
            </div>
            <div>
              <dt>Archivos</dt>
              <dd>{detalle.changedFiles}</dd>
            </div>
            <div>
              <dt>Commits</dt>
              <dd>{detalle.commits}</dd>
            </div>
            <div>
              <dt>Rama</dt>
              <dd title={`${detalle.headRef} → ${detalle.baseRef}`}>{detalle.baseRef}</dd>
            </div>
          </dl>

          <div className="pr-revisiones">
            {detalle.reviews.length === 0 && detalle.requestedReviewers.length === 0 && (
              <span className="pr-cargando">Sin revisiones todavía.</span>
            )}
            {detalle.reviews.map((r) => (
              <span
                key={r.login}
                className={`pill ${r.state === 'APPROVED' ? 'is-success' : r.state === 'CHANGES_REQUESTED' ? 'is-danger' : ''}`}
              >
                {r.state === 'APPROVED' && <IconCheck size={11} />}
                {r.login}
                {r.state === 'CHANGES_REQUESTED' ? ' pidió cambios' : ''}
              </span>
            ))}
            {detalle.requestedReviewers.map((login) => (
              <span key={login} className="pill">
                {login} · pendiente
              </span>
            ))}
          </div>

          {pr.state === 'open' && detalle.mergeable === false && (
            <div className="alert alert-warning">
              <IconAlert size={15} />
              <span>
                GitHub no lo puede fusionar tal cual
                {detalle.mergeableState ? ` (${detalle.mergeableState})` : ''}: probablemente haya
                conflictos.
              </span>
            </div>
          )}
        </>
      )}

      <button className="btn-secondary btn-sm" onClick={() => window.api.openInGithub(pr.url)}>
        <IconExternal size={13} />
        Abrir en GitHub
      </button>
    </div>
  );
}

export default function PullRequestsPanel({ refreshSignal }: { refreshSignal?: number }) {
  const [scope, setScope] = useState<PullRequestScope>('mios');
  const [state, setState] = useState<PullRequestState>('abiertos');
  const [datos, setDatos] = useState<PullRequestList | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      setDatos(await window.api.getPullRequests({ scope, state }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron leer los pull requests');
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, state, refreshSignal]);

  const texto = busqueda.trim().toLowerCase();
  const visibles = (datos?.items ?? []).filter(
    (pr) => !texto || `${pr.title} ${pr.repo} ${pr.author}`.toLowerCase().includes(texto),
  );

  return (
    <section className="card">
      <div className="panel-head">
        <div className="panel-title">
          <h2>Mis PRs</h2>
          {datos && <span className="count-chip">{visibles.length}</span>}
          {datos && <span className="panel-subtitle">{datos.org} en GitHub</span>}
        </div>
        <div className="panel-actions">
          <Segmented value={state} onChange={setState} options={ESTADOS} label="Estado" />
          <button className="btn-secondary btn-sm" onClick={cargar} disabled={cargando}>
            <IconRefresh size={13} />
            Actualizar
          </button>
        </div>
      </div>

      <div className="task-filters">
        <div className="search-field">
          <IconSearch size={15} />
          <input
            type="search"
            placeholder="Buscar por título, repositorio o autor..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            aria-label="Buscar entre los pull requests"
          />
        </div>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as PullRequestScope)}
          aria-label="Qué pull requests"
        >
          {AMBITOS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
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
          <span>Consultando GitHub...</span>
        </div>
      ) : visibles.length === 0 && !error ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <IconSearch size={20} />
          </span>
          <strong>No hay pull requests que mostrar</strong>
          <span>
            {state === 'abiertos'
              ? 'Nada abierto con este filtro.'
              : 'Nada que coincida con este filtro.'}
          </span>
        </div>
      ) : (
        <>
          {datos && datos.total > visibles.length && !texto && (
            <p className="browse-hint">
              GitHub devuelve {datos.total} en total; se muestran los {datos.items.length} más
              recientes.
            </p>
          )}

          {visibles.map((pr) => {
            const estado = ESTADO_PR[pr.state];
            const desplegado = abierto === pr.id;
            return (
              <div className={`pr-item ${desplegado ? 'is-open' : ''}`} key={pr.id}>
                <button className="pr-row" onClick={() => setAbierto(desplegado ? null : pr.id)}>
                  <IconChevronDown size={13} className={desplegado ? 'is-open' : ''} />
                  <span className="pr-main">
                    <span className="pr-title">
                      {pr.draft && <em className="pr-draft">borrador</em>}
                      {pr.title}
                    </span>
                    <span className="pr-meta">
                      {pr.repo} #{pr.number} · {pr.author} · {hace(pr.updatedAt)}
                      {pr.labels.slice(0, 3).map((l) => (
                        <em key={l} className="pr-label">
                          {l}
                        </em>
                      ))}
                    </span>
                  </span>
                  {pr.comments > 0 && (
                    <span className="pr-comments" title={`${pr.comments} comentarios`}>
                      <IconChat size={13} />
                      {pr.comments}
                    </span>
                  )}
                  <span className={`pill ${estado.clase}`}>{estado.texto}</span>
                </button>

                {desplegado && <Detalle pr={pr} />}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
