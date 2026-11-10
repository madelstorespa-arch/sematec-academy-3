'use client';
import { IconMin, IconMax, IconRestore } from './win-icons';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { NavItem } from '@/components/nav';

type Win = { url: string; title: string; icon: string };
const WIN_KEY = 'sematec-ventanas';
const A11Y_KEY = 'sematec-accesibilidad';
type A11y = { fs: 'sm' | 'md' | 'lg' | 'xl'; theme: 'light' | 'dark'; contrast: boolean; motion: boolean; links: boolean; spacing: boolean; max: boolean };
const DEFAULT: A11y = { fs: 'md', theme: 'light', contrast: false, motion: false, links: false, spacing: false, max: false };
const read = <T,>(k: string, d: T): T => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) ?? 'null') } as T; } catch { return d; } };
const readList = (): Win[] => { try { return JSON.parse(localStorage.getItem(WIN_KEY) ?? '[]'); } catch { return []; } };

function apply(a: A11y) {
  const h = document.documentElement.dataset;
  h.fs = a.fs; h.theme = a.theme; h.contrast = a.contrast ? '1' : ''; h.motion = a.motion ? 'reduce' : ''; h.links = a.links ? '1' : ''; h.spacing = a.spacing ? '1' : ''; h.max = a.max ? '1' : '';
}

/**
 * Barra de ventana de cada página: minimizar (queda en la barra de tareas de abajo), maximizar
 * (oculta el menú y usa toda la pantalla), ✕ cerrar (vuelve atrás) y ♿ accesibilidad (letra, modo oscuro, contraste…).
 */
export function WindowBar({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const router = useRouter();
  const [a11y, setA11y] = useState<A11y>(DEFAULT);
  const [wins, setWins] = useState<Win[]>([]);
  const [menu, setMenu] = useState(false);
  const [title, setTitle] = useState('');

  useEffect(() => { const a = read(A11Y_KEY, DEFAULT); setA11y(a); apply(a); setWins(readList()); }, []);
  const save = (a: A11y) => { setA11y(a); apply(a); try { localStorage.setItem(A11Y_KEY, JSON.stringify(a)); } catch { /* */ } };
  const saveWins = (w: Win[]) => { setWins(w); try { localStorage.setItem(WIN_KEY, JSON.stringify(w)); } catch { /* */ } };

  const item = [...items].filter((i) => path === i.href || path.startsWith(`${i.href}/`)).sort((x, y) => y.href.length - x.href.length)[0];
  useEffect(() => {
    const t = setTimeout(() => setTitle((document.title.split(/\s[|·–-]\s/)[0] || item?.label) ?? ''), 50);
    return () => clearTimeout(t);
  }, [path, item?.label]);
  const url = typeof window === 'undefined' ? path : `${path}${window.location.search}`;
  // Historial propio de páginas visitadas (para «Cerrar» = volver a la anterior)
  useEffect(() => {
    try {
      const h: string[] = JSON.parse(sessionStorage.getItem('sematec-historial') ?? '[]');
      const cur = `${path}${window.location.search}`;
      if (h[h.length - 1] !== cur) { h.push(cur); sessionStorage.setItem('sematec-historial', JSON.stringify(h.slice(-30))); }
    } catch { /* */ }
  }, [path]);

  const minimize = useCallback(() => {
    const w = { url, title: title || item?.label || 'Página', icon: item?.icon ?? '📄' };
    saveWins([...readList().filter((x) => x.url !== w.url), w].slice(-12));
    router.push('/app');
  }, [url, title, item, router]);
  const close = useCallback(() => {
    saveWins(readList().filter((x) => x.url !== url));
    let prev = '/app';
    try {
      const h: string[] = JSON.parse(sessionStorage.getItem('sematec-historial') ?? '[]');
      while (h.length && (h[h.length - 1] === url || h[h.length - 1].split('?')[0] === path)) h.pop();
      prev = h.pop() ?? '/app';
      sessionStorage.setItem('sematec-historial', JSON.stringify(h));
    } catch { /* */ }
    router.push(prev);
  }, [url, router]);
  const toggleMax = () => save({ ...a11y, max: !a11y.max });

  // Atajos: Alt+M minimizar, Alt+F maximizar, Alt+W cerrar
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === 'm' && path !== '/app') { e.preventDefault(); minimize(); }
      else if (key === 'f') { e.preventDefault(); save({ ...read(A11Y_KEY, DEFAULT), max: !document.documentElement.dataset.max }); }
      else if (key === 'w' && path !== '/app') { e.preventDefault(); close(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [path, minimize, close]); // eslint-disable-line react-hooks/exhaustive-deps

  const btn = 'grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-ink disabled:opacity-30';
  const toggle = (k: keyof A11y) => save({ ...a11y, [k]: !a11y[k] });
  return (
    <>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur" data-testid="barra-ventana" onDoubleClick={toggleMax}>
        <span className="text-lg" aria-hidden>{item?.icon ?? '📄'}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{title || item?.label}</span>
        <span className="relative">
          <button className={btn} onClick={() => setMenu((v) => !v)} title="Accesibilidad: tamaño de letra, modo oscuro, contraste" aria-label="Accesibilidad" aria-expanded={menu} data-testid="accesibilidad">♿</button>
          {menu && (
            <div className="absolute right-0 top-10 z-50 w-72 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-2xl" role="dialog" aria-label="Accesibilidad" data-testid="panel-accesibilidad">
              <p className="mb-2 font-bold">♿ Accesibilidad</p>
              <p className="label">Tamaño de letra</p>
              <div className="mb-3 grid grid-cols-4 gap-1">{(['sm', 'md', 'lg', 'xl'] as const).map((f, i) => (
                <button key={f} onClick={() => save({ ...a11y, fs: f })} className={`rounded-lg py-1 ${a11y.fs === f ? 'bg-brand-600 text-white' : 'bg-slate-100'}`} style={{ fontSize: 12 + i * 3 }} aria-pressed={a11y.fs === f}>A</button>))}</div>
              {([['theme', '🌙 Modo oscuro'], ['contrast', '◐ Alto contraste'], ['links', '🔗 Subrayar enlaces'], ['spacing', '🔤 Letra más espaciada (lectura fácil)'], ['motion', '⏸ Reducir animaciones'], ['max', '⛶ Pantalla amplia (sin menú)']] as [keyof A11y, string][]).map(([k, l]) => (
                <label key={k} className="flex cursor-pointer items-center justify-between gap-2 py-1">
                  <span>{l}</span>
                  <input type="checkbox" checked={k === 'theme' ? a11y.theme === 'dark' : !!a11y[k]} data-testid={`a11y-${k}`}
                    onChange={() => (k === 'theme' ? save({ ...a11y, theme: a11y.theme === 'dark' ? 'light' : 'dark' }) : toggle(k))} />
                </label>))}
              <button className="mt-2 text-xs text-slate-500 underline" onClick={() => save(DEFAULT)}>Restablecer</button>
              <p className="mt-2 text-[11px] text-slate-400">Atajos: Alt+M minimizar · Alt+F maximizar · Alt+W cerrar · Ctrl+K buscar · Ctrl+Z deshacer</p>
            </div>)}
        </span>
        <button className={btn} onClick={minimize} disabled={path === '/app'} title="Minimizar (queda abajo, en la barra de tareas)" aria-label="Minimizar" data-testid="ventana-minimizar"><IconMin /></button>
        <button className={btn} onClick={toggleMax} title={a11y.max ? 'Restaurar (mostrar el menú)' : 'Maximizar (usar toda la pantalla)'} aria-label={a11y.max ? 'Restaurar' : 'Maximizar'} data-testid="ventana-maximizar">{a11y.max ? <IconRestore /> : <IconMax />}</button>
        <button className={`${btn} hover:!bg-red-600 hover:!text-white`} onClick={close} disabled={path === '/app'} title="Cerrar esta página" aria-label="Cerrar" data-testid="ventana-cerrar">✕</button>
      </div>
      {wins.length > 0 && (
        <nav className="app-taskbar fixed bottom-0 left-0 right-0 z-40 flex gap-1 overflow-x-auto border-t border-slate-200 bg-white/95 px-2 py-1.5 shadow-[0_-4px_12px_rgba(0,0,0,.06)] backdrop-blur" aria-label="Ventanas minimizadas" data-testid="barra-tareas">
          {wins.map((w) => (
            <span key={w.url} className={`flex shrink-0 items-center rounded-lg border ${w.url === url ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white'} text-sm`}>
              <button className="flex items-center gap-1 px-2 py-1" onClick={() => { saveWins(readList().filter((x) => x.url !== w.url)); router.push(w.url); }} title={`Restaurar ${w.title}`}>
                <span aria-hidden>{w.icon}</span><span className="max-w-[10rem] truncate">{w.title}</span></button>
              <button className="px-1.5 text-slate-400 hover:text-red-600" onClick={() => saveWins(readList().filter((x) => x.url !== w.url))} aria-label={`Cerrar ${w.title}`}>✕</button>
            </span>))}
        </nav>)}
    </>
  );
}
