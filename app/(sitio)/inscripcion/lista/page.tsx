import Link from 'next/link';
import { getT } from '@/lib/site-i18n';

export const metadata = { title: 'Inscripción recibida', robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ correo?: string }> }) {
  const { correo } = await searchParams;
  const t = await getT();
  const email = (correo ?? '').slice(0, 200);
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
