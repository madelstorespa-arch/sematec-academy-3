import { getPublicSite, anonClient } from '@/lib/site';
import { CourseCard } from '@/components/course-card';

export const metadata = { title: 'Cursos y precios' };

export default async function Page() {
  const site = await getPublicSite();
  const { data } = site ? await anonClient().from('catalog_offerings').select('*').eq('organization_id', site.organization_id)
    .eq('is_published', true).order('sort_order').order('created_at') : { data: [] as any[] };
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold">Cursos y programas</h1>
      <p className="mt-2 text-slate-600">Precios finales. Pago seguro con tarjeta de crédito, débito y otros medios.</p>
      <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">{(data ?? []).map((c: any) => <CourseCard key={c.id} c={c} />)}</div>
      {!data?.length && <p className="mt-8 text-slate-500">Aún no hay cursos publicados.</p>}
    </main>
  );
}
