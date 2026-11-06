import Link from 'next/link';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { AuthShell } from '@/components/brand';
import { env } from '@/lib/env';
import { fmtDate } from '@/lib/format';

export const metadata = { title: 'Resultado de verificación' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const h = await headers();
  // Consulta pública (rol anon): solo puede ejecutar verify_certificate
  const sb = createClient(env.supabaseUrl(), env.supabaseAnonKey(), { auth: { persistSession: false } });
  const { data, error } = await sb.rpc('verify_certificate', {
    p_code: decodeURIComponent(code), p_ip: (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null, p_user_agent: h.get('user-agent'),
  });
  const r = (data ?? {}) as any;
  return (
    <AuthShell title="Verificación de certificado">
      {error ? <p className="rounded-lg bg-red-50 p-4 text-red-700">No se pudo consultar en este momento. Intente nuevamente.</p>
        : r.status === 'not_found' ? <div className="rounded-xl border-2 border-red-200 bg-red-50 p-5"><p className="text-lg font-bold text-red-700">✕ Código no encontrado</p><p className="mt-1 text-sm text-red-700">No existe un certificado con el código {decodeURIComponent(code)}.</p></div>
        : (
          <div className={`rounded-xl border-2 p-5 ${r.valid ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
            <p className={`text-lg font-bold ${r.valid ? 'text-emerald-700' : 'text-red-700'}`}>
              {r.valid ? '✓ Certificado auténtico y vigente' : r.status === 'revoked' ? '✕ Certificado REVOCADO' : '✕ Certificado con integridad comprometida'}
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <div><dt className="label">Institución</dt><dd>{r.organization}</dd></div>
              <div><dt className="label">Título</dt><dd>{r.title}</dd></div>
              <div><dt className="label">Otorgado a</dt><dd className="font-semibold">{r.recipient}</dd></div>
              <div><dt className="label">N° y fecha de emisión</dt><dd>{r.serial} · {fmtDate(r.issued_at)}</dd></div>
              {r.revoked_at && <div><dt className="label">Revocado el</dt><dd>{fmtDate(r.revoked_at)}</dd></div>}
            </dl>
          </div>
        )}
      <p className="mt-6 text-center text-sm"><Link className="link" href="/verificar">Verificar otro código</Link></p>
    </AuthShell>
  );
}
