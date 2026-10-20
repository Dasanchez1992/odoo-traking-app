export type Scope = 'mias' | 'todas';

interface Props {
  value: Scope;
  onChange: (valor: Scope) => void;
  /** Texto de la opción propia; el de la otra es siempre «Todas»/«Todos». */
  mine: string;
  all: string;
}

/** Alterna entre lo asignado a uno y todo lo que hay en Odoo, dentro del mismo panel. */
export default function ScopeSwitch({ value, onChange, mine, all }: Props) {
  return (
    <div className="segmented" role="group" aria-label="Qué se muestra">
      <button
        type="button"
        className={value === 'mias' ? 'is-active' : ''}
        onClick={() => onChange('mias')}
        aria-pressed={value === 'mias'}
      >
        {mine}
      </button>
      <button
        type="button"
        className={value === 'todas' ? 'is-active' : ''}
        onClick={() => onChange('todas')}
        aria-pressed={value === 'todas'}
      >
        {all}
      </button>
    </div>
  );
}
