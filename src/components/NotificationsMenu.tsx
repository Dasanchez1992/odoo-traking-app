import { useEffect, useRef, useState } from 'react';
import { AppNotification } from '../types';
import { IconAlert, IconBell, IconClock, IconTasks } from './Icons';

function iconFor(kind: string) {
  if (kind === 'attendance') return <IconClock size={14} />;
  if (kind === 'activity') return <IconTasks size={14} />;
  return <IconAlert size={14} />;
}

function relativeTime(at: number) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Intl.DateTimeFormat('es-EC', { dateStyle: 'short', timeStyle: 'short' }).format(at);
}

export default function NotificationsMenu() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.api.listNotifications().then(setItems).catch(() => {});
    return window.api.onNotificationsUpdate(setItems);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    // Abrir el panel cuenta como haberlas visto.
    if (next && unread > 0) window.api.markNotificationsRead().then(setItems).catch(() => {});
  }

  return (
    <div className="notif-wrap" ref={ref}>
      <button
        className="btn-ghost btn-icon notif-button"
        onClick={toggle}
        title="Notificaciones"
        aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'}
        aria-expanded={open}
      >
        <IconBell size={16} />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="menu">
          <div className="notif-head">
            <strong>Notificaciones</strong>
            {items.length > 0 && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => window.api.clearNotifications().then(setItems).catch(() => {})}
              >
                Limpiar
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="notif-empty">No hay avisos por ahora.</p>
          ) : (
            <ul className="notif-list">
              {items.map((item) => (
                <li className="notif-item" key={item.id}>
                  <span className={`notif-icon is-${item.kind}`}>{iconFor(item.kind)}</span>
                  <div className="notif-text">
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                    <em>{relativeTime(item.at)}</em>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
