'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { PasswordInput } from '@/components/forms';

type R = { ok: boolean; message?: string; error?: string; data?: unknown; demo?: boolean };
const DEMO = [
  ['propietario.a@demo.sematec.test', 'Propietaria (todo; pide MFA)'], ['secretaria.a@demo.sematec.test', 'Secretaría'],
  ['profesor2.a@demo.sematec.test', 'Profesora'], ['estudiante1.a@demo.sematec.test', 'Estudiante'], ['tesoreria.a@demo.sematec.test', 'Tesorería (pide MFA)'],
];

export function InstallForm({ action }: { action: (fd: FormData) => Promise<R> }) {
  const [r, setR] = useState<R | null>(null);
  const [pending, start] = useTransition();
  const [demo, setDemo] = useState(false);
  return (
    <div>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setR(null);
        start(async () => { try { setR(await action(fd)); } catch { setR({ ok: false, error: 'Se perdió la conexión. Recargue la página: el instalador continúa donde quedó.' }); } }); }}>
        <label className="block"><span className="label">Clave de instalación (SETUP_TOKEN)</span>
          <PasswordInput name="token" required autoComplete="off" /></label>
        {!demo && (
          <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-xs font-bold uppercase text-slate-500">Su academia (instalación real)</legend>
            <label className="block"><span className="label">Nombre de la academia</span>
              <input name="org_name" required className="input" defaultValue="SEMATEC ACADEMY" /></label>
            <label className="block"><span className="label">Nombre del administrador</span>
              <input name="admin_name" required className="input" autoComplete="name" /></label>
            <label className="block"><span className="label">Correo del administrador</span>
              <input name="admin_email" type="email" required className="input" autoComplete="email" /></label>
            <label className="block"><span className="label">Contraseña del administrador</span>
              <PasswordInput name="admin_password" required minLength={12} autoComplete="new-password" />
              <span className="text-xs text-slate-500">Mínimo 12 caracteres, con mayúsculas, minúsculas y números.</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="aula_only" className="mt-1" />
              <span><b>Solo aula virtual</b> (para una organización que solo necesita clases en vivo, grabaciones y archivos; sin ventas ni finanzas)</span></label>
          </fieldset>
        )}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="demo" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="mt-1" />
          <span>Cargar datos y usuarios de demostración <b>(solo para un proyecto de prueba)</b></span></label>
        <button className="btn-primary w-full py-3" disabled={pending}>{pending ? 'Instalando… (hasta 1 minuto)' : 'Instalar'}</button>
      </form>
      {r && !r.ok && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{r.error}</p>}
      {r?.ok && (
        <div className="mt-4 space-y-4">
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {r.message}</p>
          <ul className="space-y-0.5 text-xs text-slate-600">{(r.data as string[]).map((l) => <li key={l}>{l}</li>)}</ul>
          {r.demo ? <div className="rounded-lg border border-slate-200 p-4 text-sm">
            <p className="font-bold">Usuarios de demostración · contraseña <code>Sematec-Demo-2026</code></p>
            <ul className="mt-2 space-y-1">{DEMO.map(([e, l]) => <li key={e}><code className="text-xs">{e}</code><br /><span className="text-xs text-slate-500">{l}</span></li>)}</ul>
          </div> : <p className="rounded-lg border border-slate-200 p-4 text-sm">Ingrese con el correo y la contraseña del administrador. Al primer ingreso se configura la verificación en dos pasos (Microsoft o Google Authenticator).</p>}
          <div className="flex gap-2"><Link className="btn-primary flex-1" href="/">Ver el sitio</Link><Link className="btn-secondary flex-1" href="/login">Ingresar</Link></div>
          <p className="text-xs text-amber-700">Por seguridad, elimine ahora la variable SETUP_TOKEN en Vercel.</p>
        </div>
      )}
    </div>
  );
}
