export interface ProjectDatum {
  name: string;
  hours: number;
}

interface Props {
  data: ProjectDatum[];
  totalHours: number;
}

function formatHours(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export default function ProjectHoursChart({ data, totalHours }: Props) {
  const max = Math.max(...data.map((d) => d.hours), 0.01);

  return (
    <ul className="hbar-list">
      {data.map((item) => (
        <li className="hbar-row" key={item.name}>
          <div className="hbar-head">
            <span className="hbar-name" title={item.name}>
              {item.name}
            </span>
            <span className="hbar-value">
              {formatHours(item.hours)}
              {totalHours > 0 && (
                <em>{Math.round((item.hours / totalHours) * 100)}%</em>
              )}
            </span>
          </div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(item.hours / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
