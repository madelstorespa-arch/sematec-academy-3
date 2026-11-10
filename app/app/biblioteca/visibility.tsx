'use client';
import { useState } from 'react';

const ROLE_GROUPS: [string, string][] = [
  ['estudiante', 'Estudiantes'], ['profesor', 'Profesores'], ['tutor', 'Tutores'], ['apoderado', 'Apoderados'], ['egresado', 'Egresados'],
  ['secretaria', 'Secretaría'], ['coordinador', 'Coordinación'], ['director_academico', 'Dirección académica'], ['bibliotecario', 'Biblioteca'],
];

/** 👁 Quién puede ver el libro o documento: todos, solo algunos roles, y personas a las que se oculta. */
export function VisibilityFields({ roles = [], hidden = [], people }: { roles?: string[]; hidden?: string[]; people: { user_id: string; full_name: string; email: string }[] }) {
  const [mode, setMode] = useState(roles.length ? 'roles' : 'todos');
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<string[]>(hidden);
  const list = people.filter((p) => !filter || `${p.full_name} ${p.email}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 80);
  return (
    <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3" data-testid="visibilidad">
      <legend className="px-1 text-xs font-bold uppercase text-slate-500">👁 ¿Quién puede verlo?</legend>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1"><input type="radio" name="vis_mode" value="todos" checked={mode === 'todos'} onChange={() => setMode('todos')} /> Todos los que corresponda</label>
        <label className="flex items-center gap-1"><input type="radio" name="vis_mode" value="roles" checked={mode === 'roles'} onChange={() => setMode('roles')} /> Solo estos roles</label>
      </div>
      {mode === 'roles' && <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{ROLE_GROUPS.map(([v, l]) => (
        <label key={v} className="flex items-center gap-1"><input type="checkbox" name="visible_roles" value={v} defaultChecked={roles.includes(v)} /> {l}</label>))}</div>}
      <details open={sel.length > 0}>
        <summary className="cursor-pointer text-sm text-slate-700">🚫 Ocultar a personas específicas {sel.length > 0 && `(${sel.length})`}</summary>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar persona…" className="input my-2 py-1 text-sm" />
        <div className="grid max-h-40 gap-1 overflow-y-auto text-sm sm:grid-cols-2">
          {list.map((p) => (
            <label key={p.user_id} className="flex items-center gap-1"><input type="checkbox" name="hidden_users" value={p.user_id} checked={sel.includes(p.user_id)}
              onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.user_id] : s.filter((x) => x !== p.user_id)))} /> {p.full_name || p.email}</label>))}
          {sel.filter((id) => !list.some((p) => p.user_id === id)).map((id) => <input key={id} type="hidden" name="hidden_users" value={id} />)}
        </div>
      </details>
      <p className="text-xs text-slate-500">La biblioteca y el propietario siempre lo ven. Las personas ocultas no lo verán ni podrán abrir el archivo.</p>
    </fieldset>
  );
}
