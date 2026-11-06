import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicSite, anonClient, mediaUrl } from '@/lib/site';
import { MODALITY } from '@/components/course-card';
import { fmtDate, fmtMoney } from '@/lib/format';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getPublicSite();
  if (!site) notFound();
  const { data: c } = await anonClient().from('catalog_offerings').select('*').eq('organization_id', site.organization_id).eq('slug', slug).eq('is_published', true).maybeSingle();
  if (!c) notFound();
  const img = mediaUrl(c.image_asset_id);
  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-3">
      <article className="lg:col-span-2">
        <p className="text-sm font-bold uppercase tracking-wider text-brand-600">{c.category}</p>
        <h1 className="mt-1 text-3xl font-black md:text-4xl">{c.title}</h1>
        <p className="mt-3 text-lg text-slate-600">{c.summary}</p>
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={c.title} className="mt-6 w-full rounded-2xl object-cover" />
        )}
        <div className="mt-8 whitespace-pre-line leading-relaxed text-slate-700">{c.description}</div>
      </article>
      <aside className="h-fit rounded-2xl border border-slate-200 p-6 shadow-sm lg:sticky lg:top-24">
        <p className="text-3xl font-black">{fmtMoney(c.price, c.currency)}</p>
        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Modalidad</dt><dd className="font-semibold">{MODALITY[c.modality]}</dd></div>
          {c.duration_text && <div className="flex justify-between"><dt className="text-slate-500">Duración</dt><dd className="font-semibold">{c.duration_text}</dd></div>}
          {c.schedule_text && <div className="flex justify-between"><dt className="text-slate-500">Horario</dt><dd className="font-semibold">{c.schedule_text}</dd></div>}
          {c.starts_on && <div className="flex justify-between"><dt className="text-slate-500">Inicio</dt><dd className="font-semibold">{fmtDate(c.starts_on)}</dd></div>}
          <div className="flex justify-between"><dt className="text-slate-500">Ingreso</dt><dd className="font-semibold">{c.admission_mode === 'application' ? 'Con postulación' : 'Inscripción inmediata'}</dd></div>
        </dl>
        <Link href={`/cursos/${c.slug}/inscripcion`} className="btn-primary mt-6 w-full">{c.admission_mode === 'application' ? 'Postular' : 'Inscribirme y pagar'}</Link>
        <p className="mt-3 text-center text-xs text-slate-500">{c.admission_mode === 'application' ? 'Revisaremos su postulación y le avisaremos para pagar.' : 'Acceso a la plataforma inmediatamente después del pago.'}</p>
        <Link href={`/contacto?curso=${c.id}`} className="mt-4 block text-center text-sm link">¿Dudas? Escríbanos</Link>
      </aside>
    </main>
  );
}
