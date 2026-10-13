const pkg = require('../package.json');

const TIMEOUT_MS = 8000;

function repoApiUrl(version) {
  const destino = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {};
  if (!destino.owner || !destino.repo) return null;
  return `https://api.github.com/repos/${destino.owner}/${destino.repo}/releases/tags/v${version}`;
}

// El cuerpo del release lo arma el workflow: una sección «Novedades» con un guion por commit
// y, debajo, instrucciones de descarga que no interesan dentro de la app.
function parseNotes(body) {
  if (!body) return [];

  const secciones = String(body).split(/^##\s+/m);
  const novedades = secciones.find((bloque) => /^novedades/i.test(bloque.trim()));
  const texto = novedades || secciones[0] || '';

  return texto
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea.startsWith('- '))
    .map((linea) =>
      linea
        .slice(2)
        // El hash del commit solo sirve para rastrear el cambio en el repositorio.
        .replace(/\s*\([0-9a-f]{7,40}\)\s*$/i, '')
        .trim(),
    )
    .filter(Boolean);
}

async function fetchReleaseNotes(version) {
  const url = repoApiUrl(version);
  if (!url) return null;

  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: control.signal,
    });
    if (!res.ok) return null;

    const data = await res.json();
    return {
      version,
      items: parseNotes(data.body),
      url: data.html_url || null,
    };
  } catch {
    // Sin conexión o GitHub caído: se vuelve a intentar en el siguiente arranque.
    return null;
  } finally {
    clearTimeout(corte);
  }
}

// Decide si toca enseñar las novedades y deja anotado lo que ya no hace falta repetir.
async function pendingReleaseNotes({ version, settings, markSeen, fetchNotes = fetchReleaseNotes }) {
  if (settings.lastSeenVersion === version) return null;

  // Instalación nueva o aviso desactivado: se da por vista y no se molesta a nadie.
  if (!settings.lastSeenVersion || !settings.showReleaseNotes) {
    markSeen();
    return null;
  }

  const notes = await fetchNotes(version);
  // Sin conexión no se anota nada: se vuelve a intentar en el siguiente arranque.
  if (!notes) return null;

  if (notes.items.length === 0) {
    markSeen();
    return null;
  }
  return notes;
}

module.exports = { fetchReleaseNotes, parseNotes, pendingReleaseNotes };
