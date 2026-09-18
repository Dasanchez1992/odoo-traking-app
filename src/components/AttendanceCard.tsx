import { useEffect, useState } from 'react';
import { AttendanceStatus } from '../types';
import { formatOdooTime, parseOdooDateTime } from '../lib/odooDate';
import { formatDurationShort, useNow } from '../lib/format';
import { IconAlert, IconClock, IconLogin, IconLogout } from './Icons';

// Una jornada abierta más de esto casi siempre es una salida que nadie marcó.
const LONG_SHIFT_HOURS = 12;
// El fichaje también se hace desde Odoo o desde el móvil, así que hay que releerlo a menudo
// para no quedarse mostrando una jornada que ya se cerró en otro sitio.
const SYNC_MS = 60 * 1000;

export default function AttendanceCard() {
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Odoo rechaza una entrada nueva si quedó otra sin cerrar; hay que ofrecer salir de ahí.
  const [stuckOpen, setStuckOpen] = useState(false);

  const isCheckedIn = !!status?.open;
  const unknownState = status !== null && !status.readable;
  const checkInDate = parseOdooDateTime(status?.open?.check_in ?? null);
  const now = useNow(isCheckedIn, 30000);
  const openHours = checkInDate ? (now - checkInDate.getTime()) / 3600000 : 0;
  const longShift = isCheckedIn && openHours > LONG_SHIFT_HOURS;

  async function refresh() {
    try {
      const next = await window.api.getAttendanceStatus();
      setStatus(next);
      setError(null);
      // Si Odoo ya no reporta una entrada abierta, el atasco quedó resuelto fuera de la app.
      if (!next.open) setStuckOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer el estado de asistencia');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();

    const id = setInterval(refresh, SYNC_MS);
    const unsubscribe = window.api.onDataRefresh(refresh);
    // Al volver a la ventana es cuando más probable es que el estado haya cambiado fuera.
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(id);
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  async function handleToggle() {
    setLoading(true);
    setError(null);
    try {
      await window.api.toggleAttendance();
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo registrar la asistencia';
      setError(message);
      setStuckOpen(/sin cerrar|no ha registrado su salida/i.test(message));
      setLoading(false);
    }
  }

  async function handleCloseOpen() {
    setLoading(true);
    try {
      await window.api.closeOpenAttendance();
      setStuckOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar el fichaje abierto');
      setLoading(false);
    }
  }

  return (
    <section className="card attendance-card">
      <div className="attendance-main">
        <span className="card-label">
          <IconClock size={13} />
          Jornada laboral
        </span>

        {error ? (
          <div className="attendance-error">
            <div className="alert alert-danger">
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
            {stuckOpen && (
              <button className="btn-secondary btn-sm" onClick={handleCloseOpen} disabled={loading}>
                Cerrar fichaje abierto
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="attendance-status">
              <span className="attendance-state">
                {unknownState ? 'Jornada' : isCheckedIn ? 'En jornada' : 'Fuera de jornada'}
              </span>
              {!unknownState && (
                <span className={`pill ${isCheckedIn ? 'is-success' : ''}`}>
                  <span className={`dot ${isCheckedIn ? 'is-live' : ''}`} />
                  {isCheckedIn ? 'Activa' : 'Sin registrar'}
                </span>
              )}
            </div>

            {longShift && (
              <span className="attendance-warning">
                <IconAlert size={14} />
                Llevas {Math.floor(openHours)} h fichado. Si olvidaste marcar la salida, hazlo ahora:
                mientras siga abierta, Odoo no te dejará marcar una entrada nueva.
              </span>
            )}

            <span className="attendance-since">
              {unknownState
                ? 'Tu usuario no puede consultar el historial de asistencias en Odoo, pero puedes intentar registrar el fichaje.'
                : isCheckedIn && checkInDate
                  ? null
                  : isCheckedIn
                    ? 'Jornada iniciada.'
                    : 'Registra tu entrada para comenzar a contabilizar la jornada.'}

              {!unknownState && isCheckedIn && checkInDate && (
                <>
                  Entrada a las {formatOdooTime(status?.open?.check_in)} ·{' '}
                  <span className="attendance-elapsed">
                    {formatDurationShort(checkInDate.getTime(), now)}
                  </span>
                </>
              )}
            </span>
          </>
        )}
      </div>

      <button
        className={isCheckedIn ? 'btn-danger' : ''}
        onClick={handleToggle}
        disabled={loading}
        title={unknownState ? 'Registrar entrada o salida en Odoo' : undefined}
      >
        {isCheckedIn ? <IconLogout size={15} /> : <IconLogin size={15} />}
        {unknownState ? 'Registrar fichaje' : isCheckedIn ? 'Marcar salida' : 'Marcar entrada'}
      </button>
    </section>
  );
}
