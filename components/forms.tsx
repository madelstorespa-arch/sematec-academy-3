'use client';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { enqueue, type OfflineKey } from '@/lib/offline-queue';
import { showResultToast } from '@/components/result-toast';

type Result = { ok: boolean; message?: string; error?: string; data?: unknown; queued?: boolean };

/**
 * Formulario que llama a una Server Action. Si la conexión falla, informa que NADA
 * se guardó (requisito: nunca mostrar como guardada una operación no confirmada).
 * Con `offline`, si no hay internet el formulario queda en la bandeja de salida del
 * dispositivo y se envía solo al volver la conexión (se informa que aún no está en la nube).
 */
export function ActionForm({
  action, children, submitLabel = 'Guardar', className = '', confirm, resetOnSuccess = true, submitClass = 'btn-primary', inline = false, onDone, hideSubmit = false, offline, id,
}: {
  id?: string;
  action: (fd: FormData) => Promise<Result>;
  children?: ReactNode; submitLabel?: string; className?: string; confirm?: string; resetOnSuccess?: boolean;
  submitClass?: string; inline?: boolean; onDone?: (r: Result) => void; hideSubmit?: boolean;
  offline?: { key: OfflineKey; label: string };
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  // Si el formulario desaparece al guardar (la fila sale de la lista), el resultado se muestra en un aviso flotante
  const last = useRef<{ r: Result; at: number } | null>(null);
  useEffect(() => () => {
    const l = last.current;
    if (l && !l.r.queued && Date.now() - l.at < 8000) showResultToast(l.r.ok, l.r.ok ? (l.r.message ?? 'Guardado.') : (l.r.error ?? 'Error'));
  }, []);
  return (
    <form
      ref={ref}
      id={id}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        setResult(null);
        const queue = () => {
          if (!offline) return false;
          try {
            setResult({ ok: true, queued: true, message: enqueue(offline.key, offline.label, fd) });
            if (resetOnSuccess) ref.current?.reset();
          } catch (err) {
            setResult({ ok: false, error: `Sin conexión y no se pudo guardar en el dispositivo: ${(err as Error).message}` });
          }
          return true;
        };
        if (offline && typeof navigator !== 'undefined' && !navigator.onLine) { queue(); return; }
        start(async () => {
          try {
            const r = await action(fd);
            last.current = { r, at: Date.now() };
            setResult(r);
            if (r.ok) {
              if (resetOnSuccess) ref.current?.reset();
              router.refresh();
              window.dispatchEvent(new CustomEvent('sematec:changed')); // barra ↶ Deshacer
            }
            onDone?.(r);
          } catch (err) {
            // Redirecciones de Next.js (la acción SÍ se completó): dejar que el router navegue
            const digest = (err as { digest?: string } | null)?.digest ?? '';
            if (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_HTTP_ERROR') || digest === 'NEXT_NOT_FOUND') throw err;
            // Solo se guarda en el dispositivo si de verdad no hubo conexión (nunca si la operación pudo llegar)
            const network = !navigator.onLine || err instanceof TypeError;
            if (network && queue()) return;
            setResult({ ok: false, error: network
              ? 'No se pudo contactar al servidor: la operación NO fue guardada. Revise su conexión y vuelva a intentarlo.'
              : `El servidor tuvo un problema y la operación NO fue guardada. Vuelva a intentarlo; si se repite, avise a soporte${digest ? ` (código ${digest})` : ''}.` });
          }
        });
      }}
    >
      <div className={inline ? 'flex flex-wrap items-end gap-2' : 'space-y-4'}>
        {children}
        <div className={`${inline ? '' : 'flex items-center gap-3'} ${hideSubmit ? 'hidden' : ''}`}>
          <button type="submit" className={submitClass} disabled={pending}>
            {pending ? 'Procesando…' : submitLabel}
          </button>
        </div>
      </div>
      {result && (
        <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${result.queued ? 'bg-amber-50 text-amber-900' : result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {result.queued ? result.message : result.ok ? `✓ ${result.message ?? 'Guardado en la nube.'}` : `✕ ${result.error}`}
        </p>
      )}
    </form>
  );
}

export function Field({ label, name, type = 'text', required, defaultValue, placeholder, step, min, max, className = '', autoComplete }: {
  label: string; name: string; type?: string; required?: boolean; defaultValue?: string | number | null; placeholder?: string;
  step?: string; min?: string | number; max?: string | number; className?: string; autoComplete?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}{required && ' *'}</span>
      {type === 'password'
        ? <PasswordInput name={name} required={required} placeholder={placeholder} autoComplete={autoComplete} />
        : <input className="input" name={name} type={type} required={required} defaultValue={defaultValue ?? undefined}
            placeholder={placeholder} step={step} min={min} max={max} autoComplete={autoComplete} />}
    </label>
  );
}

/** Campo de contraseña con botón 👁 para mostrarla u ocultarla. */
export function PasswordInput({ name, required, placeholder, autoComplete, minLength, className = 'input', title }: {
  name: string; required?: boolean; placeholder?: string; autoComplete?: string; minLength?: number; className?: string; title?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <input className={`${className} pr-10`} name={name} type={show ? 'text' : 'password'} required={required} placeholder={placeholder}
        autoComplete={autoComplete} minLength={minLength} title={title} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        title={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500 hover:text-slate-800">{show ? '🙈' : '👁'}</button>
    </span>
  );
}

export function SelectField({ label, name, options, required, defaultValue, className = '', placeholder }: {
  label: string; name: string; options: { value: string; label: string }[]; required?: boolean; defaultValue?: string | null;
  className?: string; placeholder?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}{required && ' *'}</span>
      <select className="input" name={name} required={required} defaultValue={defaultValue ?? ''}>
        <option value="">{placeholder ?? 'Seleccione…'}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function TextArea({ label, name, required, defaultValue, rows = 3, placeholder }: { label: string; name: string; required?: boolean; defaultValue?: string | null; rows?: number; placeholder?: string }) {
  return (
    <label className="block">
      <span className="label">{label}{required && ' *'}</span>
      <textarea className="input" name={name} required={required} defaultValue={defaultValue ?? undefined} rows={rows} placeholder={placeholder} />
    </label>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' }[cols];
  return <div className={`grid grid-cols-1 gap-4 ${c}`}>{children}</div>;
}


/** ✉ Casilla «Enviar también por correo» (para mensajes, anuncios, solicitudes y respuestas). */
export function EmailCopy({ defaultChecked = true, label = 'Enviar también por correo' }: { defaultChecked?: boolean; label?: string }) {
  return (
    <label className="flex w-fit items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-900" data-testid="enviar-correo">
      <input type="checkbox" name="send_email" defaultChecked={defaultChecked} /> ✉ {label}
    </label>
  );
}
