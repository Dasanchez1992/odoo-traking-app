import { useEffect, useState } from 'react';

export function useNow(active: boolean, intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return now;
}

// Suma los segmentos ya cerrados más el que esté corriendo.
export function timerElapsedMs(
  timer: { segmentStartedAt: number | null; accumulatedMs: number },
  now: number,
) {
  const running = timer.segmentStartedAt === null ? 0 : Math.max(0, now - timer.segmentStartedAt);
  return timer.accumulatedMs + running;
}

export function formatElapsed(totalMs: number) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatStopwatch(fromMs: number, toMs: number) {
  const totalSeconds = Math.max(0, Math.floor((toMs - fromMs) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatDurationShort(fromMs: number, toMs: number) {
  const totalMinutes = Math.max(0, Math.floor((toMs - fromMs) / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

export function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
