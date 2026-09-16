import { IconEye, IconEyeOff, IconSearch } from './Icons';

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  projectFilter: string;
  onProjectFilterChange: (value: string) => void;
  projects: Array<[number, string]>;
  stages: Array<[number, string]>;
  stageFilter: string;
  onStageFilterChange: (value: string) => void;
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
  oldOverdueCount,
  showOldOverdue,
  onToggleOldOverdue,
  noProjectCount,
  showNoProject,
  onToggleNoProject,
}: Props) {
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

      {oldOverdueCount > 0 && (
        <button
          className="btn-secondary btn-sm"
          onClick={onToggleOldOverdue}
          title="Tareas con más de un mes de atraso"
        >
          {showOldOverdue ? <IconEyeOff size={14} /> : <IconEye size={14} />}
          {showOldOverdue ? 'Ocultar atrasadas +1 mes' : `Atrasadas +1 mes (${oldOverdueCount})`}
        </button>
      )}

      {noProjectCount > 0 && (
        <button
          className="btn-secondary btn-sm"
          onClick={onToggleNoProject}
          title="Tareas sin proyecto en Odoo: no admiten registro de tiempo"
        >
          {showNoProject ? <IconEyeOff size={14} /> : <IconEye size={14} />}
          {showNoProject ? 'Ocultar sin proyecto' : `Sin proyecto (${noProjectCount})`}
        </button>
      )}
    </div>
  );
}
