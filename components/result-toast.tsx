'use client';
import { useEffect, useState } from 'react';

/** Muestra el resultado de un formulario que desapareció al guardar (p. ej. una solicitud aprobada que sale de la lista). */
export function showResultToast(ok: boolean, text: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sematec:result', { detail: { ok, text } }));
}

export function ResultToast() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ ok: boolean; text: string }>).detail;
      setMsg(d); clearTimeout(t); t = setTimeout(() => setMsg(null), 12000);
    };
    window.addEventListener('sematec:result', on);
    return () => { window.removeEventListener('sematec:result', on); clearTimeout(t); };
  }, []);
  if (!msg) return null;
  return (
    <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4" data-testid="toast-resultado">
      <p role="status" className={`flex max-w-xl items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ring-1 ${msg.ok ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-red-50 text-red-800 ring-red-200'}`}>
        <span>{msg.ok ? '✓' : '✕'} {msg.text}</span>
        <button type="button" className="text-slate-500 hover:text-slate-800" aria-label="Cerrar" onClick={() => setMsg(null)}>✕</button>
      </p>
    </div>
  );
}
