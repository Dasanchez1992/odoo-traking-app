interface Opcion<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  onChange: (valor: T) => void;
  options: Opcion<T>[];
  /** Para quien navega con lector de pantalla. */
  label?: string;
}

/** Selector de dos o tres opciones dentro de un panel, sin salir de la pestaña. */
export default function Segmented<T extends string>({
  value,
  onChange,
  options,
  label = 'Qué se muestra',
}: Props<T>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((opcion) => (
        <button
          key={opcion.value}
          type="button"
          className={value === opcion.value ? 'is-active' : ''}
          onClick={() => onChange(opcion.value)}
          aria-pressed={value === opcion.value}
        >
          {opcion.label}
        </button>
      ))}
    </div>
  );
}
