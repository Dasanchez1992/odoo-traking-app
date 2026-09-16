import { useEffect, useState } from 'react';
import { AttendanceStatus } from '../types';
import { formatOdooTime, parseOdooDateTime } from '../lib/odooDate';
import { formatDurationShort, useNow } from '../lib/format';
import { IconAlert, IconClock, IconLogin, IconLogout } from './Icons';

export default function AttendanceCard() {
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isCheckedIn = !!status?.open;
  const checkInDate = parseOdooDateTime(status?.open?.check_in);
  const now = useNow(isCheckedIn, 30000);

  async function refresh() {
    try {
      const s = await window.api.getAttendanceStatus();
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer el estado de asistencia');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleToggle() {
    setLoading(true);
    try {
      await window.api.toggleAttendance();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la asistencia');
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
          <div className="alert alert-danger">
            <IconAlert size={16} />
            <span>{error}</span>
          </div>
        ) : (
          <>
            <div className="attendance-status">
              <span className="attendance-state">{isCheckedIn ? 'En jornada' : 'Fuera de jornada'}</span>
              <span className={`pill ${isCheckedIn ? 'is-success' : ''}`}>
                <span className={`dot ${isCheckedIn ? 'is-live' : ''}`} />
                {isCheckedIn ? 'Activa' : 'Sin registrar'}
              </span>
            </div>

            <span className="attendance-since">
              {isCheckedIn && checkInDate ? (
                <>
                  Entrada a las {formatOdooTime(status?.open?.check_in)} ·{' '}
                  <span className="attendance-elapsed">
                    {formatDurationShort(checkInDate.getTime(), now)}
                  </span>
                </>
              ) : (
                'Registra tu entrada para comenzar a contabilizar la jornada.'
              )}
            </span>
          </>
        )}
      </div>

      <button
        className={isCheckedIn ? 'btn-danger' : ''}
        onClick={handleToggle}
        disabled={loading || !!error}
      >
        {isCheckedIn ? <IconLogout size={15} /> : <IconLogin size={15} />}
        {isCheckedIn ? 'Marcar salida' : 'Marcar entrada'}
      </button>
    </section>
  );
}
