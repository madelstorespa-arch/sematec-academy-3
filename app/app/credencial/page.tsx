import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { getContext, can } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { PrintButton } from '@/components/print-button';
import { env } from '@/lib/env';
import { fmtDate } from '@/lib/format';
import { issueCredential } from './actions';

export const metadata = { title: 'Credencial estudiantil' };

export default async function Page({ searchParams }: { searchParams: Promise<{ estudiante?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  // El estudiante ve la suya; el personal puede ver la de un estudiante con ?estudiante=<id>
  const sid = sp.estudiante && can(ctx, 'students.view') ? sp.estudiante : ctx.studentId;
  if (!sid) notFound();
  const sb = ctx.supabase;
  const [{ data: s }, { data: cred }, { data: enr }] = await Promise.all([
    sb.from('students').select('id, organization_id, user_id, first_names, last_names, student_code, id_document_type, id_document_number, status').eq('id', sid).maybeSingle(),
    sb.from('student_credentials').select('*').eq('student_id', sid).maybeSingle(),
    sb.from('enrollments').select('programs(name), academic_periods(code)').eq('student_id', sid).order('created_at', { ascending: false }).limit(1),
  ]);
  if (!s) notFound();
  const [{ data: org }, { data: site }, { data: prof }] = await Promise.all([
    sb.from('organizations').select('display_name').eq('id', s.organization_id).maybeSingle(),
    sb.from('site_settings').select('logo_asset_id, site_name').eq('organization_id', s.organization_id).maybeSingle(),
    s.user_id ? sb.from('profiles').select('avatar_asset_id').eq('id', s.user_id).maybeSingle() : Promise.resolve({ data: null as any }),
  ]);
  const canIssue = s.status === 'active' && (sid === ctx.studentId || can(ctx, 'students.edit'));
  const expired = cred && (cred.revoked || cred.valid_until < new Date().toISOString().slice(0, 10));
  const url = cred ? `${env.siteUrl()}/credencial/${cred.code}` : '';
  const qr = cred ? await QRCode.toDataURL(url, { margin: 1, width: 220 }) : null;
  const program = (enr?.[0] as any)?.programs?.name;

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Credencial estudiantil" subtitle="Muéstrela en la entrada, la biblioteca o donde se la pidan. Cualquiera puede verificarla escaneando el código QR."
          actions={cred ? <PrintButton /> : undefined} />
      </div>
      {!cred ? (
        <Card>
          <p className="text-sm text-slate-600">Aún no se ha emitido la credencial{sid === ctx.studentId ? '' : ' de este estudiante'}.</p>
          {canIssue ? (
            <div className="mt-4"><ActionForm action={issueCredential} inline submitLabel="🪪 Emitir credencial">
              <input type="hidden" name="student_id" value={sid} />
            </ActionForm></div>
          ) : <p className="mt-2 text-sm text-red-700">Solo se emite para estudiantes con estado activo.</p>}
          {!prof?.avatar_asset_id && sid === ctx.studentId && <p className="mt-4 text-sm text-slate-500">Consejo: suba su foto en <a className="link" href="/app/perfil">Mi cuenta</a> para que aparezca en la credencial.</p>}
        </Card>
      ) : (
        <div className="mx-auto max-w-md">
          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg print:shadow-none">
            <div className="flex items-center gap-3 bg-brand-700 px-5 py-4 text-white">
              {site?.logo_asset_id ? <img src={`/media/${site.logo_asset_id}`} alt="" className="h-10 w-10 rounded bg-white object-contain p-1" /> : <span className="text-2xl">🎓</span>}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Credencial estudiantil</p>
                <p className="font-bold">{site?.site_name || org?.display_name}</p>
              </div>
            </div>
            <div className="flex gap-4 p-5">
              {prof?.avatar_asset_id
                ? <img src={`/media/${prof.avatar_asset_id}`} alt="Foto" className="h-32 w-28 rounded-lg object-cover" />
                : <div className="flex h-32 w-28 items-center justify-center rounded-lg bg-slate-100 text-4xl text-slate-400">👤</div>}
              <div className="min-w-0 text-sm">
                <p className="text-lg font-bold leading-tight">{s.first_names} {s.last_names}</p>
                <p className="mt-1 text-slate-600">{s.id_document_type} {s.id_document_number}</p>
                <p className="mt-2"><span className="label">Código</span> <span className="font-mono font-semibold">{s.student_code}</span></p>
                {program && <p className="mt-1 text-slate-700">{program}</p>}
                <p className={`mt-2 font-semibold ${expired ? 'text-red-700' : 'text-emerald-700'}`}>
                  {cred.revoked ? 'REVOCADA' : expired ? `VENCIDA el ${fmtDate(cred.valid_until)}` : `Vigente hasta ${fmtDate(cred.valid_until)}`}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-slate-100 px-5 py-4">
              <div className="text-xs text-slate-500">
                <p>Verificación en línea</p>
                <p className="font-mono text-sm font-bold text-slate-800">{cred.code}</p>
                <p className="mt-1 break-all">{url}</p>
              </div>
              {qr && <img src={qr} alt="Código QR de verificación" className="h-28 w-28" />}
            </div>
          </article>
          {canIssue && expired && (
            <div className="mt-4 print:hidden"><ActionForm action={issueCredential} inline submitLabel="Renovar credencial">
              <input type="hidden" name="student_id" value={sid} />
            </ActionForm></div>
          )}
        </div>
      )}
    </>
  );
}
