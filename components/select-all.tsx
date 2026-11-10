'use client';
/** Casilla «seleccionar todos» para las filas de una tabla (casillas con la clase indicada). */
export function SelectAll({ target = 'sel-one', label = 'Seleccionar todos' }: { target?: string; label?: string }) {
  return <input type="checkbox" aria-label={label} data-testid="sel-todos"
    onChange={(e) => document.querySelectorAll<HTMLInputElement>(`input.${target}`).forEach((c) => { c.checked = e.target.checked; })} />;
}
