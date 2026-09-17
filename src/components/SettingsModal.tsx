import { useEffect, useState } from 'react';
import { AppSettings, UpdateStatus } from '../types';
import { IconAlert, IconClose } from './Icons';

interface Props {
  onClose: () => void;
}

function updateMessage(update: UpdateStatus, version: string) {
  const actual = version ? `Versión ${version}. ` : '';
  switch (update.state) {
    case 'dev':
      return `${actual}Las actualizaciones automáticas solo funcionan en la aplicación instalada.`;
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

export default function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });
  const [diagnosing, setDiagnosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.api.getSettings().then(setSettings).catch(() => setError('No se pudo leer la configuración'));
    window.api.getAppVersion().then(setVersion).catch(() => {});
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

  async function toggle(key: 'startAtLogin' | 'remindersEnabled') {
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>Configuración</h2>
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

          {!settings ? (
            <div className="spinner" />
          ) : (
            <>
              <label className="setting-row">
                <div className="setting-text">
                  <strong>Iniciar con el sistema</strong>
                  <span>
                    {settings.startAtLoginSupported
                      ? 'La aplicación se abre automáticamente al iniciar sesión en Windows, minimizada en la bandeja.'
                      : 'Solo disponible en Windows y macOS.'}
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
                    Aviso a las 09:30 para marcar entrada y a las 17:30 para marcar salida (hora de
                    Ecuador), de lunes a viernes. Se omite el aviso si ya registraste ese fichaje.
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
      </div>
    </div>
  );
}
