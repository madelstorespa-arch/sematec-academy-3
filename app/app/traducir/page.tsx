import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { prefsOf } from '@/lib/prefs';
import { DocTranslator } from './translator';

export const metadata = { title: 'Traductor' };

export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { data } = await ctx.supabase.from('user_files').select('id, name, mime_type').eq('organization_id', orgId).is('deleted_at', null)
    .or('mime_type.eq.application/pdf,mime_type.like.text/%,mime_type.like.%wordprocessingml%').order('created_at', { ascending: false }).limit(200);
  return (
    <>
      <PageHeader title="🌐 Traductor" subtitle="Traduzca textos y documentos (PDF, Word, texto, subtítulos) a su idioma. Se traduce en su navegador: el documento original no cambia." />
      <Card><DocTranslator locale={prefsOf(ctx.profile).locale ?? 'es'} files={(data ?? []).map((f) => ({ id: f.id, name: f.name }))} /></Card>
      <p className="mt-4 text-sm text-slate-600">🎥 <b>Clases y reuniones:</b> active «💬 Subtítulos» en el aula virtual; si su idioma no es español, los subtítulos y el chat se muestran traducidos en su pantalla.</p>
    </>
  );
}
