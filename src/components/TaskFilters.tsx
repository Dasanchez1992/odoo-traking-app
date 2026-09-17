import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconMore, IconSearch } from './Icons';
import { DATE_FILTER_LABELS, DateFilter } from '../lib/taskDates';

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  projectFilter: string;
  onProjectFilterChange: (value: string) => void;
  projects: Array<[number, string]>;
  stages: Array<[number, string]>;
  stageFilter: string;
  onStageFilterChange: (value: string) => void;
  dateFilter: DateFilter;
  onDateFilterChange: (value: DateFilter) => void;
  oldOverdueCount: number;
  showOldOverdue: boolean;
  onToggleOldOverdue: () => void;
  noProjectCount: number;
  showNoProject: boolean;
  onToggleNoProject: () => void;
}

export default function TaskFilters({
  search,
  onSearchChange,
  projectFilter,
  onProjectFilterChange,
  projects,
  stages,
  stageFilter,
  onStageFilterChange,
  dateFilter,
  onDateFilterChange,
  oldOverdueCount,
  showOldOverdue,
  onToggleOldOverdue,
  noProjectCount,
  showNoProject,
  onToggleNoProject,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const hiddenGroups = [
    {
      key: 'overdue',
      label: 'Atrasadas +1 mes',
      count: oldOverdueCount,
      active: showOldOverdue,
      onToggle: onToggleOldOverdue,
    },
    {
      key: 'noproject',
      label: 'Sin proyecto',
      count: noProjectCount,
      active: showNoProject,
      onToggle: onToggleNoProject,
    },
  ].filter((group) => group.count > 0);

  const someActive = hiddenGroups.some((group) => group.active);

  return (
    <div className="task-filters">
      <div className="search-field">
        <IconSearch size={15} />
        <input
          type="search"
          placeholder="Buscar por tarea o proyecto..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Buscar tareas"
        />
      </div>

      <select
        value={projectFilter}
        onChange={(e) => onProjectFilterChange(e.target.value)}
        aria-label="Filtrar por proyecto"
      >
        <option value="all">Todos los proyectos</option>
        {projects.map(([id, name]) => (
          <option key={id} value={String(id)}>
            {name}
          </option>
        ))}
      </select>

      <select
        value={dateFilter}
        onChange={(e) => onDateFilterChange(e.target.value as DateFilter)}
        aria-label="Filtrar por fecha"
        title="«Para hoy» muestra lo que ya empezó o venció, incluyendo lo atrasado"
      >
        {(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map((key) => (
          <option key={key} value={key}>
            {DATE_FILTER_LABELS[key]}
          </option>
        ))}
      </select>

      <select
        value={stageFilter}
        onChange={(e) => onStageFilterChange(e.target.value)}
        aria-label="Filtrar por etapa"
      >
        <option value="all">Todas las etapas</option>
        {stages.map(([id, name]) => (
          <option key={id} value={String(id)}>
            {name}
          </option>
        ))}
      </select>

      {hiddenGroups.length > 0 && (
        <div className="filter-menu-wrap" ref={menuRef}>
          <button
            className={`btn-secondary btn-icon ${someActive ? 'has-marker' : ''}`}
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Más filtros"
            aria-expanded={menuOpen}
            title="Mostrar tareas que se ocultan por defecto"
          >
            <IconMore size={16} />
          </button>

          {menuOpen && (
            <div className="filter-menu" role="menu">
              <div className="filter-menu-title">Mostrar además</div>
              {hiddenGroups.map((group) => (
                <button
                  key={group.key}
                  className={`filter-menu-item ${group.active ? 'is-active' : ''}`}
                  onClick={group.onToggle}
                  role="menuitemcheckbox"
                  aria-checked={group.active}
                >
                  <span className="filter-menu-check">
                    {group.active && <IconCheck size={13} />}
                  </span>
                  {group.label}
                  <em>{group.count}</em>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
