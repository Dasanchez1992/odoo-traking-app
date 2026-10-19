import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { MentionableUser } from '../types';

export interface Mention {
  partnerId: number;
  name: string;
}

interface Props {
  value: string;
  onChange: (value: string, mentions: Mention[]) => void;
  users: MentionableUser[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
  required?: boolean;
}

const MAX_OPCIONES = 6;

// Lo que el usuario lleva escrito tras una «@» pegada al cursor. Se corta en el primer espacio:
// los nombres con espacios se completan al elegirlos, no escribiéndolos enteros.
function queryEnCursor(texto: string, cursor: number): { query: string; desde: number } | null {
  const antes = texto.slice(0, cursor);
  const arroba = antes.lastIndexOf('@');
  if (arroba === -1) return null;

  const anterior = arroba === 0 ? '' : antes[arroba - 1];
  if (anterior && !/[\s(]/.test(anterior)) return null;

  const query = antes.slice(arroba + 1);
  if (/[\s@]/.test(query)) return null;

  return { query, desde: arroba };
}

export default function MentionTextarea({
  value,
  onChange,
  users,
  placeholder,
  rows = 3,
  disabled = false,
  id,
  autoFocus = false,
  required = false,
}: Props) {
  const [query, setQuery] = useState<string | null>(null);
  const [desde, setDesde] = useState(0);
  const [resaltada, setResaltada] = useState(0);
  const [elegidas, setElegidas] = useState<Mention[]>([]);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const candidatos = useMemo(() => {
    if (query === null) return [];
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => u.partner_id)
      .filter((u) => (q ? u.name.toLowerCase().includes(q) : true))
      .slice(0, MAX_OPCIONES);
  }, [users, query]);

  const abierto = query !== null && candidatos.length > 0;

  useEffect(() => {
    setResaltada(0);
  }, [query]);

  // Una mención solo cuenta mientras su «@Nombre» siga en el texto: si se borra, se va.
  function vigentes(texto: string, lista: Mention[]) {
    return lista.filter((m) => texto.includes(`@${m.name}`));
  }

  function emitir(texto: string, lista: Mention[]) {
    const limpias = vigentes(texto, lista);
    setElegidas(limpias);
    onChange(texto, limpias);
  }

  function handleChange(texto: string, cursor: number) {
    const encontrado = queryEnCursor(texto, cursor);
    setQuery(encontrado ? encontrado.query : null);
    setDesde(encontrado ? encontrado.desde : 0);
    emitir(texto, elegidas);
  }

  function elegir(user: MentionableUser) {
    if (!user.partner_id) return;
    const area = areaRef.current;
    const cursor = area ? area.selectionStart : value.length;

    const texto = `${value.slice(0, desde)}@${user.name} ${value.slice(cursor)}`;
    const nuevoCursor = desde + user.name.length + 2;

    setQuery(null);
    emitir(texto, [...elegidas, { partnerId: user.partner_id[0], name: user.name }]);

    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(nuevoCursor, nuevoCursor);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!abierto) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setResaltada((i) => (i + 1) % candidatos.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setResaltada((i) => (i - 1 + candidatos.length) % candidatos.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      elegir(candidatos[resaltada]);
    } else if (e.key === 'Escape') {
      // Sin esto, Escape cerraría el diálogo entero en vez de la lista.
      e.preventDefault();
      e.stopPropagation();
      setQuery(null);
    }
  }

  return (
    <div className="mention-area">
      <textarea
        id={id}
        ref={areaRef}
        rows={rows}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        onChange={(e) => handleChange(e.target.value, e.target.selectionStart)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onClick={(e) => {
          const area = e.currentTarget;
          const encontrado = queryEnCursor(area.value, area.selectionStart);
          setQuery(encontrado ? encontrado.query : null);
          setDesde(encontrado ? encontrado.desde : 0);
        }}
      />

      {abierto && (
        <div className="mention-popup" role="listbox">
          {candidatos.map((user, i) => (
            <button
              type="button"
              key={user.id}
              className={`combo-option ${i === resaltada ? 'is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => elegir(user)}
              onMouseEnter={() => setResaltada(i)}
            >
              {user.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
