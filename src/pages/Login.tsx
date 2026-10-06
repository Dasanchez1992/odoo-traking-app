import { useState, FormEvent } from 'react';
import { Credentials, OdooUser } from '../types';
import { ODOO_DB, ODOO_DEFAULT_URL } from '../config';
import { IconAlert, IconBell, IconClock, IconLogin, IconTasks, LogoMark } from '../components/Icons';

interface Props {
  onLoggedIn: (user: OdooUser) => void;
}

const FEATURES = [
  { icon: <IconTasks size={15} />, text: 'Tus tareas asignadas, siempre a mano' },
  { icon: <IconClock size={15} />, text: 'Registro de tiempo y jornada laboral' },
  { icon: <IconBell size={15} />, text: 'Avisos de vencimientos en el escritorio' },
];

export default function Login({ onLoggedIn }: Props) {
  const [form, setForm] = useState<Credentials>({
    url: ODOO_DEFAULT_URL,
    db: ODOO_DB,
    username: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof Credentials>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await window.api.login(form);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-layout">
      <aside className="login-brand">
        <div className="login-brand-top">
          <LogoMark size={34} />
          <span className="login-brand-name">Elipsys Time</span>
        </div>

        <div className="login-brand-body">
          <h2>Tu jornada y tus tareas, en un solo lugar</h2>
          <p>
            Conectado en tiempo real con Odoo para registrar horas, fichar entrada y salida, y no
            perder de vista ningún vencimiento.
          </p>
        </div>

        <div className="login-features">
          {FEATURES.map((feature) => (
            <div className="login-feature" key={feature.text}>
              <span className="login-feature-icon">{feature.icon}</span>
              {feature.text}
            </div>
          ))}
        </div>
      </aside>

      <main className="login-panel">
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-form-head">
            <h1>Iniciar sesión</h1>
            <p>Ingresa con tu cuenta corporativa de Odoo.</p>
          </div>

          <div className="login-server">
            <span className="dot" style={{ color: 'var(--success-dot)' }} />
            <code>{form.url.replace(/^https?:\/\//, '')}</code>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="username">
              Usuario
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              placeholder="correo@empresa.com"
              value={form.username}
              onChange={(e) => update('username', e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="password">
              Contraseña o clave API
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              required
            />
            <span className="field-hint">
              Si tienes verificación en dos pasos activada, usa una clave API (Perfil → Seguridad
              de la cuenta → Claves API).
            </span>
          </div>

          {error && (
            <div className="alert alert-danger">
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="btn-block" disabled={loading}>
            {loading ? (
              'Conectando...'
            ) : (
              <>
                <IconLogin size={15} />
                Iniciar sesión
              </>
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
