'use client';
import { useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

type Result = { ok: boolean; message?: string; error?: string; data?: unknown };

/**
 * Formulario que llama a una Server Action. Si la conexión falla, informa que NADA
 * se guardó (requisito: nunca mostrar como guardada una operación no confirmada).
 */
export function ActionForm({
  action, children, submitLabel = 'Guardar', className = '', confirm, resetOnSuccess = true, submitClass = 'btn-primary', inline = false, onDone, hideSubmit = false,
}: {
  action: (fd: FormData) => Promise<Result>;
  children?: ReactNode; submitLabel?: string; className?: string; confirm?: string; resetOnSuccess?: boolean;
  submitClass?: string; inline?: boolean; onDone?: (r: Result) => void; hideSubmit?: boolean;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        setResult(null);
        start(async () => {
          try {
            const r = await action(fd);
            setResult(r);
            if (r.ok) {
              if (resetOnSuccess) ref.current?.reset();
              router.refresh();
            }
            onDone?.(r);
          } catch {
            setResult({ ok: false, error: 'Sin conexión con el servidor: la operación NO fue guardada. Revise su conexión y vuelva a intentarlo.' });
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
        <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {result.ok ? `✓ ${result.message ?? 'Guardado en la nube.'}` : `✕ ${result.error}`}
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
      <input className="input" name={name} type={type} required={required} defaultValue={defaultValue ?? undefined}
        placeholder={placeholder} step={step} min={min} max={max} autoComplete={autoComplete} />
    </label>
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

export function TextArea({ label, name, required, defaultValue, rows = 3 }: { label: string; name: string; required?: boolean; defaultValue?: string | null; rows?: number }) {
  return (
    <label className="block">
      <span className="label">{label}{required && ' *'}</span>
      <textarea className="input" name={name} required={required} defaultValue={defaultValue ?? undefined} rows={rows} />
    </label>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' }[cols];
  return <div className={`grid grid-cols-1 gap-4 ${c}`}>{children}</div>;
}
