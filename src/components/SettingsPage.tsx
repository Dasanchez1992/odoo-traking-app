import { useEffect, useState } from 'react';
import { AiStatus, AppSettings, UpdateStatus } from '../types';
import { IconAlert, IconBack, IconCheck, IconSparkle } from './Icons';

interface Props {
  onClose: () => void;
}

// Los avisos de fichaje salen un cuarto de hora antes del horario de cada quien.
const AVISO_ANTES_MIN = 15;

function quinceAntes(hora: string) {
  const encaja = /^(\d{1,2}):(\d{2})$/.exec((hora || '').trim());
  if (!encaja) return hora;
  const total = Math.max(0, Number(encaja[1]) * 60 + Number(encaja[2]) - AVISO_ANTES_MIN);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function updateMessage(update: UpdateStatus, version: string) {
  const actual = version ? `Versión ${version}. ` : '';
  switch (update.state) {
    case 'dev':
      return `${actual}Las actualizaciones automáticas solo funcionan en la aplicación instalada.`;
    case 'manual':
      return `${actual}En Linux la actualización es manual: descarga el .deb de la versión nueva.`;
    case 'checking':
      return `${actual}Buscando una versión nueva...`;
    case 'latest':
      return `${actual}Estás al día.`;
    case 'available':
      return `${actual}Descargando la versión ${update.version}...`;
    case 'downloading':
      return `${actual}Descargando... ${update.percent ?? 0}%`;
    case 'ready':
      return `${actual}La versión ${update.version} está lista: reinicia para instalarla.`;
    case 'error':
      return `${actual}No se pudo comprobar: ${update.message ?? 'error desconocido'}`;
    default:
      return `${actual}La app busca actualizaciones al abrirse y cada cuatro horas.`;
  }
}

export default function SettingsPage({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });
  const [diagnosing, setDiagnosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [ai, setAi] = useState<AiStatus | null>(null);
  const [aiKey, setAiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    window.api.getSettings().then(setSettings).catch(() => setError('No se pudo leer la configuración'));
    window.api.getAppVersion().then(setVersion).catch(() => {});
    window.api.getAiStatus().then(setAi).catch(() => {});
    window.api.getUpdateStatus().then(setUpdate).catch(() => {});
    return window.api.onUpdateStatus(setUpdate);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function toggle(
    key:
      | 'startAtLogin'
      | 'remindersEnabled'
      | 'floatingWidget'
      | 'autoAttendance'
      | 'showReleaseNotes'
      | 'aiEnabled',
  ) {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      setSettings(await window.api.updateSettings({ [key]: !settings[key] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la configuración');
    } finally {
      setSaving(false);
    }
  }

  async function saveTime(key: 'autoCheckIn' | 'autoCheckOut', value: string) {
    if (!settings) return;
    // El input ya restringe el formato; aquí solo se evita guardar un borrado a medias.
    setSettings({ ...settings, [key]: value });
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    setError(null);
    try {
      setSettings(await window.api.updateSettings({ [key]: value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la hora');
    }
  }

  async function guardarClave() {
    setSavingKey(true);
    setAiError(null);
    try {
      // Se comprueba contra la API antes de guardarla: así nadie pega una clave rota y se entera
      // más tarde, en mitad de un registro de tiempo.
      const resultado = await window.api.saveAiKey(aiKey.trim());
      setAi({ available: true, configured: true, key: resultado.key });
      setAiKey('');
      if (!resultado.encrypted) {
        setAiError(
          'Guardada, pero este equipo no ofrece cifrado del sistema: queda en texto plano.',
        );
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'No se pudo guardar la clave');
    } finally {
      setSavingKey(false);
    }
  }

  async function borrarClave() {
    setAiError(null);
    try {
      await window.api.clearAiKey();
      setAi({ available: false, configured: false });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'No se pudo borrar la clave');
    }
  }

  async function runDiagnosis() {
    setDiagnosing(true);
    try {
      const report = await window.api.diagnoseAttendance();
      setDiagnosis(JSON.stringify(report, null, 2));
    } catch (err) {
      setDiagnosis(err instanceof Error ? err.message : 'No se pudo generar el diagnóstico');
    } finally {
      setDiagnosing(false);
    }
  }

  return (
    <section className="settings-page">
      <div className="page-head">
        <div>
          <h1>Configuración</h1>
          <p>Ajustes de la aplicación en este equipo.</p>
        </div>
        <button className="btn-secondary btn-sm" onClick={onClose}>
          <IconBack size={14} />
          Volver
        </button>
      </div>

      <div className="card settings-card">
          {error && (
            <div className="alert alert-danger">
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          {!settings ? (
            <div className="spinner" />
          ) : (
            <>
              <label className="setting-row">
                <div className="setting-text">
                  <strong>Iniciar con el sistema</strong>
                  <span>
                    {settings.startAtLoginSupported
                      ? 'La aplicación se abre sola al iniciar sesión, minimizada en la bandeja.'
                      : 'En Linux hace falta tener la app instalada (el paquete .deb); desde el código fuente no se puede.'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="switch"
                  checked={settings.startAtLogin}
                  disabled={saving || !settings.startAtLoginSupported}
                  onChange={() => toggle('startAtLogin')}
                />
              </label>

              <label className="setting-row">
                <div className="setting-text">
                  <strong>Recordatorios de fichaje</strong>
                  <span>
                    Aviso 15 minutos antes de tu horario: a las {quinceAntes(settings.autoCheckIn)}{' '}
                    para la entrada y a las {quinceAntes(settings.autoCheckOut)} para la salida
                    (hora de Ecuador), de lunes a viernes. Si se te pasa, insiste a los 15, 45 y 90
                    minutos, y se calla en cuanto marcas. El horario se cambia aquí abajo.
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="switch"
                  checked={settings.remindersEnabled}
                  disabled={saving}
                  onChange={() => toggle('remindersEnabled')}
                />
              </label>

              <label className="setting-row">
                <div className="setting-text">
                  <strong>Marcación automática de jornada</strong>
                  <span>
                    Registra tu entrada y tu salida en Odoo a las horas que fijes, de lunes a
                    viernes. Necesita la app abierta a esa hora y no duplica nada: si ya marcaste
                    a mano, lo deja como está.
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="switch"
                  checked={settings.autoAttendance}
                  disabled={saving}
                  onChange={() => toggle('autoAttendance')}
                />
              </label>

              {(settings.autoAttendance || settings.remindersEnabled) && (
                <div className="setting-row setting-times">
                  <label className="field">
                    <span className="field-label">Hora de entrada</span>
                    <input
                      type="time"
                      value={settings.autoCheckIn}
                      onChange={(e) => saveTime('autoCheckIn', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Hora de salida</span>
                    <input
                      type="time"
                      value={settings.autoCheckOut}
                      onChange={(e) => saveTime('autoCheckOut', e.target.value)}
                    />
                  </label>
                  <span className="field-hint setting-times-hint">
                    Hora de Ecuador. De aquí salen los avisos (un cuarto de hora antes) y, si la
                    marcación automática está encendida, también el fichaje.
                    {settings.autoAttendance &&
                      ' Si la app estaba cerrada, la entrada aún se registra hasta 3 horas después y la salida hasta 1 hora después, con la hora real en que se marcó.'}
                  </span>
                </div>
              )}

              <div className="setting-row ai-key-row">
                <div className="setting-text">
                  <strong>Tema</strong>
                  <span>
                    Claro, oscuro, o el que tenga el sistema. Cambia al momento, también en la
                    miniatura flotante.
                  </span>
                </div>
                <div className="ai-key-form">
                  <select
                    value={settings.theme}
                    onChange={async (e) => {
                      setSaving(true);
                      try {
                        setSettings(
                          await window.api.updateSettings({
                            theme: e.target.value as AppSettings['theme'],
                          }),
                        );
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                    aria-label="Tema de la aplicación"
                  >
                    <option value="sistema">Como el sistema</option>
                    <option value="claro">Claro</option>
                    <option value="oscuro">Oscuro</option>
                  </select>
                </div>
              </div>

              <label className="setting-row">
                <div className="setting-text">
                  <strong>Cronómetro flotante</strong>
                  <span>
                    Al minimizar o cerrar la ventana con un cronómetro en marcha, aparece una
                    miniatura sobre las demás ventanas para ver el tiempo, pausarlo o detenerlo.
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="switch"
                  checked={settings.floatingWidget}
                  disabled={saving}
                  onChange={() => toggle('floatingWidget')}
                />
              </label>

              <label className="setting-row">
                <div className="setting-text">
                  <strong>Asistencia de IA</strong>
                  <span>
                    Redacta descripciones, sugiere a qué tarea pertenece un tiempo suelto, resume
                    la semana y ayuda con el triaje de tickets. Envía a Claude solo los datos del
                    registro en cuestión, y nada si la apagas.
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="switch"
                  checked={settings.aiEnabled}
                  disabled={saving}
                  onChange={() => toggle('aiEnabled')}
                />
              </label>

              <div className="setting-row ai-key-row">
                <div className="setting-text">
                  <strong>Transcripción de reuniones</strong>
                  <span>
                    Whisper corre en este equipo: el audio no sale de aquí. El modelo se descarga
                    una sola vez. Más grande es más preciso y más lento.
                  </span>
                </div>
                <div className="ai-key-form">
                  <select
                    value={settings.whisperModel}
                    onChange={async (e) => {
                      setSaving(true);
                      try {
                        setSettings(
                          await window.api.updateSettings({
                            whisperModel: e.target.value as 'tiny' | 'base' | 'small',
                          }),
                        );
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                    aria-label="Modelo de transcripción"
                  >
                    <option value="tiny">Rápido (42 MB) · menos preciso</option>
                    <option value="base">Equilibrado (77 MB) · recomendado</option>
                    <option value="small">Preciso (241 MB) · bastante más lento</option>
                  </select>
                </div>
              </div>

              {settings.aiEnabled && (
                <div className="setting-row ai-key-row">
                  <div className="setting-text">
                    <strong>
                      <IconSparkle size={13} /> Tu clave de Claude
                    </strong>
                    <span>
                      Cada persona usa la suya. Se guarda cifrada en este equipo, nunca en Odoo ni
                      en el instalador. Se crea en console.anthropic.com → API Keys.
                      {ai?.source === 'odoo' &&
                        ' Ahora mismo funciona con la clave de la empresa configurada en Odoo; si guardas la tuya, se usa la tuya.'}
                    </span>
                  </div>

                  {ai?.configured ? (
                    <div className="ai-key-saved">
                      <span className="pill is-brand">
                        <IconCheck size={12} />
                        Guardada {ai.key ? `(${ai.key})` : ''}
                      </span>
                      <button className="btn-secondary btn-sm" onClick={borrarClave}>
                        Quitar
                      </button>
                    </div>
                  ) : (
                    <div className="ai-key-form">
                      {ai?.source === 'odoo' && (
                        <span className="pill is-brand" title="Configurada en Odoo por el administrador">
                          <IconCheck size={12} />
                          Clave de la empresa
                        </span>
                      )}
                      <input
                        type="password"
                        placeholder="sk-ant-..."
                        value={aiKey}
                        onChange={(e) => setAiKey(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="Clave de la API de Claude"
                      />
                      <button
                        className="btn-secondary btn-sm"
                        onClick={guardarClave}
                        disabled={savingKey || aiKey.trim().length < 10}
                      >
                        {savingKey ? 'Comprobando...' : 'Guardar'}
                      </button>
                    </div>
                  )}

                  {aiError && (
                    <div className="alert alert-danger ai-key-error">
                      <IconAlert size={15} />
                      <span>{aiError}</span>
                    </div>
                  )}
                </div>
              )}

              <label className="setting-row">
                <div className="setting-text">
                  <strong>Avisar de novedades al actualizar</strong>
                  <span>
                    Después de una actualización automática, muestra una vez la lista de cambios
                    que trae la versión instalada.
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="switch"
                  checked={settings.showReleaseNotes}
                  disabled={saving}
                  onChange={() => toggle('showReleaseNotes')}
                />
              </label>

              <div className="setting-row" style={{ display: 'block' }}>
                <div className="setting-text">
                  <strong>Actualizaciones</strong>
                  <span>{updateMessage(update, version)}</span>
                </div>
                <div className="diagnosis-actions">
                  {update.state === 'ready' ? (
                    <button className="btn-secondary btn-sm" onClick={() => window.api.installUpdate()}>
                      Reiniciar e instalar
                    </button>
                  ) : (
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => window.api.checkForUpdates().then(setUpdate).catch(() => {})}
                      disabled={update.state === 'checking' || update.state === 'downloading'}
                    >
                      {update.state === 'checking' ? 'Buscando...' : 'Buscar actualizaciones'}
                    </button>
                  )}
                </div>
              </div>

              <div className="setting-row" style={{ display: 'block' }}>
                <div className="setting-text">
                  <strong>Diagnóstico de asistencia</strong>
                  <span>
                    Compara lo que ve la app con lo que ve Odoo: empleados vinculados a tu usuario,
                    su estado de fichaje y las entradas abiertas.
                  </span>
                </div>
                <div className="diagnosis-actions">
                  <button className="btn-secondary btn-sm" onClick={runDiagnosis} disabled={diagnosing}>
                    {diagnosing ? 'Consultando...' : 'Ejecutar diagnóstico'}
                  </button>
                  {diagnosis && (
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => navigator.clipboard.writeText(diagnosis).catch(() => {})}
                    >
                      Copiar resultado
                    </button>
                  )}
                </div>
                {diagnosis && <pre className="diagnosis-output">{diagnosis}</pre>}
              </div>

              <p className="modal-note">
                Al cerrar la ventana la aplicación sigue activa en la bandeja del sistema para poder
                avisarte. Para cerrarla por completo, usa «Salir» en el menú de la bandeja.
              </p>
            </>
        )}
      </div>
    </section>
  );
}
