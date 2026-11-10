'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getUndoStatus, redoLast, undoLast, type UndoStatus } from '@/app/app/deshacer-actions';

/** Avisa a la barra ↶ ↷ que se guardó un cambio (lo llama ActionForm). */
export function notifyChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sematec:changed'));
}

const editable = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
};

/**
 * Barra Deshacer / Rehacer de todo el sistema. Deshace los cambios propios de la
 * últimas 24 horas (crear, editar, vender, suspender, eliminar…). También con Ctrl+Z y Ctrl+Y
 * (dentro de un campo de texto, Ctrl+Z sigue deshaciendo lo escrito).
 */
export function UndoBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [st, setSt] = useState<UndoStatus>({ undo: null, redo: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [toast, setToast] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try { setSt(await getUndoStatus()); } catch { /* sin conexión: se reintenta en el próximo cambio */ }
  }, []);

  const run = useCallback(async (kind: 'undo' | 'redo') => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setToast(false);
    try {
      const r = await (kind === 'undo' ? undoLast() : redoLast());
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? 'Listo.') : (r.error ?? 'No se pudo completar.') });
      if (r.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: 'No se pudo contactar al servidor: no se deshizo nada.' });
    } finally {
      busyRef.current = false; setBusy(false);
      await load();
    }
  }, [load, router]);

  useEffect(() => { load(); }, [pathname, load]);

  useEffect(() => {
    const onChanged = async () => {
      setMsg(null);
      await load();
      setToast(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(false), 12000);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || editable(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); run('undo'); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); run('redo'); }
    };
    window.addEventListener('sematec:changed', onChanged);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('sematec:changed', onChanged); window.removeEventListener('keydown', onKey); clearTimeout(timer.current); };
  }, [load, run]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2 print:hidden" data-testid="barra-deshacer">
        {msg && (
          <span data-testid="undo-msg" className={`rounded-lg px-3 py-1 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
            {msg.ok ? '✓ ' : '✕ '}{msg.text}
          </span>
        )}
        <button type="button" className="btn-secondary btn-sm" onClick={() => { setMsg(null); router.refresh(); load(); }}
          title="Volver a cargar los datos de esta página" aria-label="Refrescar">🔄 Refrescar</button>
        <button type="button" className="btn-secondary btn-sm" disabled={busy || !st.undo} onClick={() => run('undo')}
          title={st.undo ? `Deshacer: ${st.undo.label} (Ctrl+Z)` : 'No hay cambios suyos recientes para deshacer'} aria-label="Deshacer">
          ↶ Deshacer
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={busy || !st.redo} onClick={() => run('redo')}
          title={st.redo ? `Rehacer: ${st.redo.label} (Ctrl+Y)` : 'No hay nada para rehacer'} aria-label="Rehacer">
          ↷ Rehacer
        </button>
      </div>
      {toast && st.undo && (
        <div data-testid="undo-toast" aria-live="polite"
          className="fixed bottom-4 left-1/2 z-50 flex max-w-[95vw] -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-xl print:hidden">
          <span className="truncate">✓ {st.undo.label}</span>
          <button type="button" className="shrink-0 font-bold text-sky-300 hover:underline" disabled={busy} onClick={() => run('undo')}>↶ Deshacer</button>
          <button type="button" className="shrink-0 text-white/60 hover:text-white" onClick={() => setToast(false)} aria-label="Cerrar">✕</button>
        </div>
      )}
    </>
  );
}
