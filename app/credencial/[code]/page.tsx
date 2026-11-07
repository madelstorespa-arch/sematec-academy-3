import { AuthShell } from '@/components/brand';
import { anonClient } from '@/lib/site';
import { fmtDate } from '@/lib/format';

export const metadata = { title: 'Verificación de credencial estudiantil' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code).slice(0, 40);
  // Consulta pública (rol anon): solo puede ejecutar verify_credential, que entrega datos mínimos
  const { data, error } = await anonClient().rpc('verify_credential', { p_code: code });
  const r = (data as any[] | null)?.[0];
  return (
    <AuthShell title="Credencial estudiantil">
      {error ? <p className="rounded-lg bg-red-50 p-4 text-red-700">No se pudo consultar en este momento. Intente nuevamente.</p>
        : !r ? (
          <div className="rounded-xl border-2 border-red-200 bg-red-50 p-5">
            <p className="text-lg font-bold text-red-700">✕ Credencial no encontrada</p>
            <p className="mt-1 text-sm text-red-700">No existe una credencial con el código {code}.</p>
          </div>
        ) : (
          <div className={`rounded-xl border-2 p-5 ${r.valid ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
            <p className={`text-lg font-bold ${r.valid ? 'text-emerald-700' : 'text-red-700'}`}>
              {r.valid ? '✓ Estudiante regular, credencial vigente' : '✕ Credencial NO vigente'}
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <div><dt className="label">Institución</dt><dd>{r.institution}</dd></div>
              <div><dt className="label">Estudiante</dt><dd className="font-semibold">{r.full_name}</dd></div>
              <div><dt className="label">Código</dt><dd className="font-mono">{r.student_code}</dd></div>
              {r.program && <div><dt className="label">Programa</dt><dd>{r.program}</dd></div>}
              <div><dt className="label">{r.valid ? 'Válida hasta' : 'Validez'}</dt><dd>{r.valid ? fmtDate(r.valid_until) : 'Vencida, revocada o estudiante no activo'}</dd></div>
            </dl>
          </div>
        )}
    </AuthShell>
  );
}
