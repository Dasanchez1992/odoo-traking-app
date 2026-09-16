let requestId = 0;

function normalizeUrl(url) {
  return url.replace(/\/+$/, '');
}

async function jsonRpcCall(url, service, method, args) {
  const id = ++requestId;
  let res;
  try {
    res = await fetch(`${normalizeUrl(url)}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args },
        id,
      }),
    });
  } catch (err) {
    throw new Error(`No se pudo conectar a ${url}: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`Odoo respondió con HTTP ${res.status}`);
  }

  const data = await res.json();
  if (data.error) {
    const msg =
      data.error.data?.message || data.error.message || 'Error desconocido de Odoo';
    throw new Error(msg);
  }
  return data.result;
}

async function login({ url, db, username, password }) {
  const uid = await jsonRpcCall(url, 'common', 'login', [db, username, password]);
  if (!uid) {
    throw new Error('Usuario, contraseña o base de datos inválidos');
  }
  return uid;
}

function makeClient({ url, db, uid, password }) {
  return {
    url,
    db,
    uid,
    async execute_kw(model, method, args = [], kwargs = {}) {
      return jsonRpcCall(url, 'object', 'execute_kw', [
        db,
        uid,
        password,
        model,
        method,
        args,
        kwargs,
      ]);
    },
  };
}

module.exports = { login, makeClient };
