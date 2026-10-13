import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSearch } from './Icons';

export interface SearchOption {
  id: number;
  name: string;
}

interface Props {
  options: SearchOption[];
  value: number | null;
  onChange: (id: number) => void;
  /** El modal controla qué desplegable está abierto para que Escape cierre lo de más arriba. */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
  emptyLabel: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

export default function SearchSelect({
  options,
  value,
  onChange,
  isOpen,
  onOpenChange,
  placeholder,
  emptyLabel,
  searchPlaceholder = 'Buscar...',
  disabled = false,
  ariaLabel,
}: Props) {
  const [query, setQuery] = useState('');
  const comboRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // El padre pasa una función nueva en cada render; guardarla evita re-suscribir el efecto.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const elegida = options.find((option) => option.id === value) ?? null;

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      return;
    }
    // Dentro de un diálogo con scroll, la lista de la última fila quedaría cortada.
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: 'nearest' }));

    const onPointerDown = (event: MouseEvent) => {
      if (!comboRef.current?.contains(event.target as Node)) onOpenChangeRef.current(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen]);

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((option) => option.name.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const vacio = options.length === 0;

  return (
    <div className="combo" ref={comboRef}>
      <button
        type="button"
        className="combo-input"
        onClick={() => onOpenChange(!isOpen)}
        disabled={disabled || vacio}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={elegida?.name}
      >
        <span>{vacio ? emptyLabel : (elegida?.name ?? placeholder)}</span>
      </button>

      {isOpen && (
        <div className="combo-list" role="listbox" ref={listRef}>
          <div className="combo-search">
            <IconSearch size={13} />
            <input
              type="search"
              autoFocus
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {filtradas.length === 0 ? (
            <p className="notif-empty">Sin coincidencias.</p>
          ) : (
            filtradas.map((option) => (
              <button
                type="button"
                key={option.id}
                className={`combo-option ${option.id === value ? 'is-active' : ''}`}
                title={option.name}
                onClick={() => {
                  onChange(option.id);
                  onOpenChange(false);
                }}
              >
                {option.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
