import { useState } from 'react';
import { formatDayLabel } from '../lib/odooDate';

export interface DayDatum {
  key: string;
  hours: number;
  isToday: boolean;
}

interface Props {
  data: DayDatum[];
}

function formatHours(hours: number) {
  if (hours === 0) return '0 h';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// Compacto para el eje, que tiene poco espacio.
function formatAxisHours(hours: number) {
  const rounded = Math.round(hours * 10) / 10;
  return `${String(rounded).replace('.', ',')} h`;
}

function edgeClass(index: number, total: number) {
  if (index <= 1) return 'align-start';
  if (index >= total - 2) return 'align-end';
  return '';
}

export default function DailyHoursChart({ data }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);

  const max = Math.max(...data.map((d) => d.hours), 1);
  const peakIndex = data.reduce((best, d, i) => (d.hours > data[best].hours ? i : best), 0);
  const gridLines = [1, 0.5, 0];

  return (
    <div className="chart">
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden>
          {gridLines.map((ratio) => (
            <div className="chart-grid-line" key={ratio} style={{ bottom: `${ratio * 100}%` }}>
              <span>{ratio === 0 ? '' : formatAxisHours(max * ratio)}</span>
            </div>
          ))}
        </div>

        <div className="chart-bars">
          {data.map((d, i) => {
            const heightPct = (d.hours / max) * 100;
            // Una sola etiqueta directa, en el pico: el valor de hoy ya está en las tarjetas
            // de arriba y etiquetar ambos hace que se pisen entre sí.
            const labelled = i === peakIndex && d.hours > 0;
            const label = formatDayLabel(d.key);

            return (
              <div
                className={`chart-bar-slot ${d.isToday ? 'is-today' : ''}`}
                key={d.key}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                {labelled && hovered !== i && (
                  <span
                    className={`chart-bar-label ${edgeClass(i, data.length)}`}
                    style={{ bottom: `calc(${heightPct}% + 6px)` }}
                  >
                    {formatHours(d.hours)}
                  </span>
                )}

                {hovered === i && (
                  <div
                    className={`chart-tooltip ${edgeClass(i, data.length)}`}
                    style={{ bottom: `calc(${heightPct}% + 8px)` }}
                  >
                    <strong>{formatHours(d.hours)}</strong>
                    <span>
                      {new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeZone: 'UTC' })
                        .format(new Date(`${d.key}T12:00:00Z`))}
                    </span>
                  </div>
                )}

                <div
                  className={`chart-bar ${d.hours === 0 ? 'is-empty' : ''}`}
                  style={{ height: `${Math.max(heightPct, d.hours > 0 ? 2 : 0)}%` }}
                />
                <span className={`chart-bar-axis ${d.isToday ? 'is-today' : ''}`}>
                  {label.weekday}
                  <em>{label.day}</em>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
