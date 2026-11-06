'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';

type R = { ok: boolean; message?: string; error?: string; data?: unknown };
const DEMO = [
  ['propietario.a@demo.sematec.test', 'Propietaria (todo; pide MFA)'], ['secretaria.a@demo.sematec.test', 'Secretaría'],
  ['profesor2.a@demo.sematec.test', 'Profesora'], ['estudiante1.a@demo.sematec.test', 'Estudiante'], ['tesoreria.a@demo.sematec.test', 'Tesorería (pide MFA)'],
];

export function InstallForm({ action }: { action: (fd: FormData) => Promise<R> }) {
  const [r, setR] = useState<R | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setR(null);
        start(async () => { try { setR(await action(fd)); } catch { setR({ ok: false, error: 'Se perdió la conexión. Recargue la página: el instalador continúa donde quedó.' }); } }); }}>
        <label className="block"><span className="label">Clave de instalación (SETUP_TOKEN)</span>
          <input name="token" type="password" required className="input" autoComplete="off" /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="demo" defaultChecked className="mt-1" />
          <span>Cargar datos y usuarios de demostración <b>(solo para un proyecto de prueba)</b></span></label>
        <button className="btn-primary w-full py-3" disabled={pending}>{pending ? 'Instalando… (hasta 1 minuto)' : 'Instalar'}</button>
      </form>
      {r && !r.ok && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{r.error}</p>}
      {r?.ok && (
        <div className="mt-4 space-y-4">
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {r.message}</p>
          <ul className="space-y-0.5 text-xs text-slate-600">{(r.data as string[]).map((l) => <li key={l}>{l}</li>)}</ul>
          <div className="rounded-lg border border-slate-200 p-4 text-sm">
            <p className="font-bold">Usuarios de demostración · contraseña <code>Sematec-Demo-2026</code></p>
            <ul className="mt-2 space-y-1">{DEMO.map(([e, l]) => <li key={e}><code className="text-xs">{e}</code><br /><span className="text-xs text-slate-500">{l}</span></li>)}</ul>
          </div>
          <div className="flex gap-2"><Link className="btn-primary flex-1" href="/">Ver el sitio</Link><Link className="btn-secondary flex-1" href="/login">Ingresar</Link></div>
          <p className="text-xs text-amber-700">Por seguridad, elimine ahora la variable SETUP_TOKEN en Vercel.</p>
        </div>
      )}
    </div>
  );
}
