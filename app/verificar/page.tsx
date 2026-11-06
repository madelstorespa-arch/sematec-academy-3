import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/brand';

export const metadata = { title: 'Verificar certificado' };

async function go(fd: FormData) {
  'use server';
  const code = String(fd.get('code') ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  redirect(`/verificar/${encodeURIComponent(code)}`);
}

export default function Page() {
  return (
    <AuthShell title="Verificar certificado" subtitle="Ingrese el código impreso en el certificado o escanee su código QR.">
      <form action={go} className="space-y-4">
        <label className="block"><span className="label">Código de verificación</span>
          <input name="code" className="input font-mono uppercase tracking-widest" placeholder="XXXX-XXXX-XXXX-XXXX" required /></label>
        <button className="btn-primary w-full">Verificar</button>
      </form>
    </AuthShell>
  );
}
