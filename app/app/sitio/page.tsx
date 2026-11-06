import Link from 'next/link';
import { getContext, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge } from '@/components/ui';
import { ActionForm, Field, Grid, TextArea } from '@/components/forms';
import { SiteTabs } from './tabs';
import { saveSite, uploadSiteImage } from './actions';

export const metadata = { title: 'Sitio web y marca' };

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'settings.admin');
  const orgId = requireOrg(ctx);
  const { data: s0 } = await ctx.supabase.from('site_settings').select('*').eq('organization_id', orgId).maybeSingle();
  const { data: org } = await ctx.supabase.from('organizations').select('display_name').eq('id', orgId).single();
  const s: any = s0 ?? { site_name: org?.display_name ?? 'SEMATEC ACADEMY', primary_color: '#1f45c8', accent_color: '#10b5a3', highlights: [], social_links: {} };
  const h = (i: number) => s.highlights?.[i] ?? {};
  return (
    <>
      <PageHeader title="Sitio web y marca" subtitle="Todo lo que ven los visitantes y la identidad de la plataforma, editable sin tocar código"
        actions={<>{s0?.is_published ? <Badge color="green">Publicado</Badge> : <Badge color="amber">No publicado</Badge>}<Link className="btn-secondary" href="/" target="_blank">Ver sitio</Link></>} />
      <SiteTabs current="marca" />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Datos y contenido">
            <ActionForm action={saveSite} submitLabel="Guardar sitio" resetOnSuccess={false}>
              <Grid cols={3}>
                <Field label="Nombre de la academia" name="site_name" required defaultValue={s.site_name} />
                <Field label="Lema" name="tagline" defaultValue={s.tagline} className="md:col-span-2" />
                <label className="block"><span className="label">Color principal</span><input type="color" name="primary_color" defaultValue={s.primary_color} className="h-10 w-full rounded-lg border border-slate-300" /></label>
                <label className="block"><span className="label">Color de acento</span><input type="color" name="accent_color" defaultValue={s.accent_color} className="h-10 w-full rounded-lg border border-slate-300" /></label>
              </Grid>
              <Field label="Título de portada" name="hero_title" defaultValue={s.hero_title} />
              <TextArea label="Subtítulo de portada" name="hero_subtitle" defaultValue={s.hero_subtitle} rows={2} />
              <TextArea label="Quiénes somos" name="about_text" defaultValue={s.about_text} rows={5} />
              <Grid><TextArea label="Misión" name="mission" defaultValue={s.mission} /><TextArea label="Visión" name="vision" defaultValue={s.vision} /></Grid>
              <fieldset className="rounded-lg border border-slate-200 p-4"><legend className="px-1 text-xs font-bold uppercase text-slate-500">Destacados de la portada</legend>
                <Grid cols={3}>{[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-2"><Field label={`Título ${i + 1}`} name={`h${i + 1}_title`} defaultValue={h(i).title} /><TextArea label="Texto" name={`h${i + 1}_text`} defaultValue={h(i).text} rows={2} /></div>))}</Grid>
              </fieldset>
              <fieldset className="rounded-lg border border-slate-200 p-4"><legend className="px-1 text-xs font-bold uppercase text-slate-500">Contacto</legend>
                <Grid cols={3}>
                  <Field label="Correo" name="contact_email" type="email" defaultValue={s.contact_email} /><Field label="Teléfono" name="contact_phone" defaultValue={s.contact_phone} />
                  <Field label="WhatsApp" name="whatsapp" defaultValue={s.whatsapp} placeholder="+56 9 …" /><Field label="Dirección" name="address" defaultValue={s.address} className="md:col-span-2" />
                  <Field label="Horario de atención" name="office_hours" defaultValue={s.office_hours} />
                </Grid>
              </fieldset>
              <fieldset className="rounded-lg border border-slate-200 p-4"><legend className="px-1 text-xs font-bold uppercase text-slate-500">Redes sociales (https://…)</legend>
                <Grid cols={3}>{['facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'x'].map((k) => <Field key={k} label={k} name={`social_${k}`} defaultValue={s.social_links?.[k]} />)}</Grid>
              </fieldset>
              <Field label="Texto del pie de página" name="footer_text" defaultValue={s.footer_text} />
              <TextArea label="Términos y condiciones" name="terms_text" defaultValue={s.terms_text} rows={5} />
              <TextArea label="Política de privacidad" name="privacy_text" defaultValue={s.privacy_text} rows={5} />
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="is_published" defaultChecked={!!s0?.is_published} /> Publicar el sitio web</label>
            </ActionForm>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Logo">
            {s0?.logo_asset_id
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={`/media/${s0.logo_asset_id}`} alt="Logo" className="mb-4 h-20 w-auto rounded bg-slate-100 object-contain p-2" />
              : <p className="mb-4 text-sm text-slate-500">Sin logo (se usan las iniciales).</p>}
            <ActionForm action={uploadSiteImage} submitLabel="Subir logo">
              <input type="hidden" name="kind" value="logo" />
              <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
              <p className="text-xs text-slate-500">PNG, JPG o WebP, máximo 3 MB. Se usa en el sitio, el inicio de sesión y el menú.</p>
            </ActionForm>
          </Card>
          <Card title="Imagen de portada">
            {s0?.hero_asset_id && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/media/${s0.hero_asset_id}`} alt="Portada" className="mb-4 w-full rounded object-cover" />
            )}
            <ActionForm action={uploadSiteImage} submitLabel="Subir portada">
              <input type="hidden" name="kind" value="hero" />
              <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
              <p className="text-xs text-slate-500">Se usa en la portada del sitio y como fondo del inicio de sesión. Recomendado: foto horizontal de 1600 px o más, máximo 3 MB.</p>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
