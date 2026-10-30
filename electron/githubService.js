// Pull requests de la organización, leídos con el token personal de cada quien. Solo lectura:
// esta app no escribe nada en GitHub.
const API = 'https://api.github.com';
const TIEMPO_MAX_MS = 20000;

const ESTADOS = {
  abiertos: 'is:open',
  cerrados: 'is:closed is:unmerged',
  fusionados: 'is:merged',
  todos: '',
};

const AMBITOS = {
  mios: (usuario) => `author:${usuario}`,
  revisar: (usuario) => `review-requested:${usuario}`,
  organizacion: () => '',
};

async function pedir(ruta, token, { raw = false } = {}) {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIEMPO_MAX_MS);

  let respuesta;
  try {
    respuesta = await fetch(`${API}${ruta}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Elipsys-Time',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: control.signal,
    });
  } catch (err) {
    throw new Error(
      err.name === 'AbortError'
        ? 'GitHub tardó demasiado en responder.'
        : `No se pudo conectar con GitHub: ${err.message}`,
    );
  } finally {
    clearTimeout(temporizador);
  }

  if (respuesta.status === 401) throw new Error('El token de GitHub no es válido o caducó.');
  if (respuesta.status === 403) {
    const restantes = respuesta.headers.get('x-ratelimit-remaining');
    throw new Error(
      restantes === '0'
        ? 'GitHub está limitando las peticiones; espera un momento.'
        : 'El token no tiene permiso para esto (¿le falta el ámbito «repo»?).',
    );
  }
  if (respuesta.status === 404) throw new Error('GitHub no encontró eso (¿nombre de la organización?).');
  if (!respuesta.ok) {
    // GitHub suele explicar qué está mal (un usuario que no existe, una consulta inválida);
    // decirlo es mucho más útil que el número del error.
    let detalle = '';
    try {
      const cuerpo = await respuesta.json();
      detalle = [cuerpo.message, (cuerpo.errors || []).map((e) => e.message).filter(Boolean).join('; ')]
        .filter(Boolean)
        .join(' — ');
    } catch {
      detalle = '';
    }
    throw new Error(detalle ? `GitHub: ${detalle}` : `GitHub respondió con HTTP ${respuesta.status}`);
  }

  const datos = await respuesta.json();
  return raw ? { datos, cabeceras: respuesta.headers } : datos;
}

/** Comprueba el token y que el usuario vea la organización, antes de guardarlo. */
async function verifyCredentials({ user, token, org }) {
  const { datos: yo, cabeceras } = await pedir('/user', token, { raw: true });
  const login = yo.login;
  const esperado = String(user || '').trim();
  if (esperado && esperado.toLowerCase() !== login.toLowerCase()) {
    throw new Error(`Ese token es de «${login}», no de «${esperado}».`);
  }

  const ambitos = (cabeceras.get('x-oauth-scopes') || '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

  let verLaOrg = true;
  try {
    await pedir(`/orgs/${encodeURIComponent(org)}`, token);
  } catch {
    // Puede ser una organización privada que el token no alcanza: se avisa, no se bloquea.
    verLaOrg = false;
  }

  return { login, scopes: ambitos, orgVisible: verLaOrg };
}

function nombreRepo(url) {
  // repository_url llega como https://api.github.com/repos/org/repo
  const partes = String(url || '').split('/repos/');
  return partes.length === 2 ? partes[1] : '';
}

function estadoDe(item) {
  if (item.pull_request && item.pull_request.merged_at) return 'merged';
  return item.state === 'closed' ? 'closed' : 'open';
}

function normalizar(item) {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    repo: nombreRepo(item.repository_url),
    url: item.html_url,
    state: estadoDe(item),
    draft: !!item.draft,
    author: item.user ? item.user.login : '',
    authorAvatar: item.user ? item.user.avatar_url : null,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    closedAt: item.closed_at,
    mergedAt: item.pull_request ? item.pull_request.merged_at : null,
    comments: item.comments || 0,
    labels: (item.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    body: String(item.body || '').slice(0, 2000),
  };
}

async function searchPullRequests({ token, user, org, scope = 'mios', state = 'abiertos', limit = 50 }) {
  const ambito = (AMBITOS[scope] || AMBITOS.mios)(user);
  const consulta = ['is:pr', `org:${org}`, ambito, ESTADOS[state] ?? ESTADOS.abiertos]
    .filter(Boolean)
    .join(' ');

  const ruta =
    `/search/issues?q=${encodeURIComponent(consulta)}` +
    `&sort=updated&order=desc&per_page=${Math.min(limit, 100)}&advanced_search=true`;
  const datos = await pedir(ruta, token);

  return {
    scope,
    state,
    org,
    total: datos.total_count || 0,
    incomplete: !!datos.incomplete_results,
    items: (datos.items || []).map(normalizar),
  };
}

/** El detalle de un PR concreto: tamaño del cambio, revisores y si se puede fusionar. */
async function pullRequestDetail({ token, repo, number }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) throw new Error('Repositorio inválido');
  if (!Number.isInteger(number)) throw new Error('Número de PR inválido');

  const pr = await pedir(`/repos/${repo}/pulls/${number}`, token);

  let reviews = [];
  try {
    reviews = await pedir(`/repos/${repo}/pulls/${number}/reviews?per_page=100`, token);
  } catch {
    reviews = [];
  }

  // De cada revisor cuenta su último veredicto, no todos los que haya dejado por el camino.
  const ultimo = new Map();
  (Array.isArray(reviews) ? reviews : [])
    .filter((r) => r.user && r.state !== 'COMMENTED')
    .forEach((r) => ultimo.set(r.user.login, r.state));

  return {
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    changedFiles: pr.changed_files || 0,
    commits: pr.commits || 0,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeable_state || null,
    baseRef: pr.base ? pr.base.ref : null,
    headRef: pr.head ? pr.head.ref : null,
    requestedReviewers: (pr.requested_reviewers || []).map((r) => r.login),
    reviews: [...ultimo.entries()].map(([login, state]) => ({ login, state })),
    reviewComments: pr.review_comments || 0,
  };
}

module.exports = { verifyCredentials, searchPullRequests, pullRequestDetail, normalizar, ESTADOS, AMBITOS };
