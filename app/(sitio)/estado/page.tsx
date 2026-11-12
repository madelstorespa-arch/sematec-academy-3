import { getT } from '@/lib/site-i18n';
import { StatusForm } from '@/components/public-forms';
import { checkStatus } from '../actions';

export const metadata = { title: 'Estado de solicitud' };

export default async function Page({ searchParams }: { searchParams: Promise<{ codigo?: string; error?: string }> }) {
  const { codigo, error } = await searchParams;
  const t = await getT();
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">{t('status.title')}</h1>
      <p className="mt-2 text-slate-600">{t('status.intro')}</p>
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{t('status.payError')}</p>}
      <div className="mt-8"><StatusForm action={checkStatus} defaultCode={codigo} /></div>
    </main>
  );
}
