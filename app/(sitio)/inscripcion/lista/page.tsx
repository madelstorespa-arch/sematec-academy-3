import Link from 'next/link';
import { getT } from '@/lib/site-i18n';
import { anonClient } from '@/lib/site';
import { fmtMoney } from '@/lib/format';

export const metadata = { title: 'Inscripción recibida', robots: { index: false } };
export const dynamic = 'force-dynamic';

type St = { status: 'pending' | 'approved' | 'rejected'; method: 'transfer' | 'office'; amount: number; currency: string; notes: string | null; program: string | null; shift: string | null; modality: string | null };

export default async function Page({ searchParams }: { searchParams: Promise<{ correo?: string; codigo?: string }> }) {
  const { correo, codigo } = await searchParams;
  const t = await getT();
  const email = (correo ?? '').slice(0, 200);
  const code = (codigo ?? '').slice(0, 40);
  const st = code && email ? ((await anonClient().rpc('registration_request_status', { p_code: code, p_email: email })).data as St | null) : null;
  if (st && st.status !== 'approved') {
    const amount = fmtMoney(Number(st.amount), st.currency);
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <div className={`rounded-3xl border-2 p-8 ${st.status === 'rejected' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`} data-testid="inscripcion-pendiente">
          <h1 className="text-3xl font-black">{st.status === 'rejected' ? '✕' : '⏳'} {st.status === 'rejected' ? 'Inscripción no aprobada' : t('reg.pending.title')}</h1>
          <p className="mt-3 text-slate-700">{st.status === 'rejected' ? (st.notes ?? 'Comuníquese con la institución.') : st.method === 'transfer' ? t('reg.pending.transfer') : t('reg.pending.office', { amount })}</p>
          <ul className="mt-4 space-y-1 text-sm text-slate-700">
            {st.program && <li>🎓 {t('reg.program')}: <b>{st.program}</b></li>}
            {st.shift && <li>🕑 {t('reg.shift')}: <b>{st.shift}</b></li>}
            {st.modality && <li>🏫 {t('reg.modality')}: <b>{st.modality}</b></li>}
            <li>💳 {t('pay.amount')}: <b>{amount}</b></li>
          </ul>
          <p className="mt-4 rounded-lg bg-white/70 px-3 py-2 font-mono text-sm" data-testid="codigo-seguimiento">{t('reg.pending.code', { code })}</p>
          <p className="mt-3 text-sm text-slate-600">{t('reg.pending.mail', { email })}</p>
          <div className="mt-6 flex flex-wrap gap-3"><Link href="/cursos" className="btn-primary">{t('reg.done.courses')}</Link><Link href="/contacto" className="btn-secondary">{t('nav.contact')}</Link></div>
        </div>
      </main>);
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-3xl border-2 border-emerald-300 bg-emerald-50 p-8" data-testid="inscripcion-recibida">
        <h1 className="text-3xl font-black">✓ {t('reg.done.title')}</h1>
        <p className="mt-3 text-slate-700">{t('reg.done.text')}</p>
        {email && <p className="mt-3 text-sm text-slate-600">{t('reg.done.access', { email })}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/cursos" className="btn-primary">{t('reg.done.courses')}</Link>
          <Link href="/login" className="btn-secondary">{t('nav.login')}</Link>
        </div>
      </div>
    </main>
  );
}
