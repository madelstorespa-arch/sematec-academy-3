import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, requirePerm } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { OfferingFields } from '@/components/offering-form';
import { periodOptions, programOptions } from '@/lib/options';
import { updateOffering, uploadCourseImage } from '../../actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  requirePerm(ctx, 'settings.admin');
  const { data: c } = await ctx.supabase.from('catalog_offerings').select('*').eq('id', id).maybeSingle();
  if (!c) notFound();
  const [programs, periods] = await Promise.all([programOptions(ctx), periodOptions(ctx)]);
  return (
    <>
      <PageHeader title={c.title} subtitle="Editar curso del catálogo" actions={<Link className="btn-secondary" href="/app/sitio/cursos">Volver</Link>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Datos del curso" className="xl:col-span-2">
          <ActionForm action={updateOffering} submitLabel="Guardar cambios" resetOnSuccess={false}>
            <input type="hidden" name="id" value={c.id} />
            <OfferingFields d={c} programs={programs} periods={periods} currency={c.currency} />
          </ActionForm>
        </Card>
        <Card title="Imagen">
          {c.image_asset_id && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/media/${c.image_asset_id}`} alt="" className="mb-4 w-full rounded object-cover" />
          )}
          <ActionForm action={uploadCourseImage} submitLabel="Subir imagen">
            <input type="hidden" name="id" value={c.id} />
            <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
