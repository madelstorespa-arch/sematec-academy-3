import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { createAnnouncement, deleteAnnouncement } from './actions';

export const metadata = { title: 'Anuncios' };
const AUD: Record<string, string> = { all: 'Todos', students: 'Estudiantes', teachers: 'Profesores', staff: 'Personal', section: 'Sección' };

export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const admin = can(ctx, 'communications.create');
  const [{ data: items }, { data: mySections }] = await Promise.all([
    ctx.supabase.from('announcements').select('*, sections(code, courses(name))')
      .eq('organization_id', orgId).order('pinned', { ascending: false }).order('published_at', { ascending: false }).limit(100),
    ctx.teacherId || admin
      ? ctx.supabase.from('sections').select('id, code, courses(name)').eq('organization_id', orgId).match(admin ? {} : { teacher_id: ctx.teacherId! }).limit(200)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const sectionOpts = (mySections ?? []).map((s: any) => ({ value: s.id, label: `${s.code} · ${s.courses?.name ?? ''}` }));
  const canPost = admin || sectionOpts.length > 0;
  return (
    <>
      <PageHeader title="Anuncios" subtitle="Comunicados de la institución y de cada sección" />
      {canPost && (
        <details className="card mb-6">
          <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Publicar anuncio</summary>
          <div className="border-t border-slate-100 p-5">
            <ActionForm action={createAnnouncement} submitLabel="Publicar">
              <Field label="Título" name="title" required />
              <TextArea label="Mensaje" name="body" required rows={5} />
              <Grid cols={3}>
                {admin && <SelectField label="Dirigido a" name="audience" defaultValue="all" placeholder="Todos"
                  options={[{ value: 'students', label: 'Estudiantes' }, { value: 'teachers', label: 'Profesores' }, { value: 'staff', label: 'Personal' }]} />}
                <SelectField label={admin ? 'Solo una sección (opcional)' : 'Sección'} name="section_id" options={sectionOpts} required={!admin} />
                <Field label="Visible hasta (opcional)" name="expires_at" type="date" />
              </Grid>
              {admin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" /> Fijar arriba</label>}
            </ActionForm>
          </div>
        </details>
      )}
      <div className="space-y-4">
        {items?.length ? items.map((a: any) => (
          <Card key={a.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">{a.pinned && '📌 '}{a.title}</h2>
                <p className="text-xs text-slate-500">{fmtDateTime(a.published_at)} · {a.author_name ?? ''} · <Badge color="blue">{a.audience === 'section' ? `Sección ${a.sections?.code ?? ''}` : AUD[a.audience]}</Badge></p>
              </div>
              {(admin || a.created_by === ctx.user.id) && (
                <ActionForm action={deleteAnnouncement} inline submitLabel="Eliminar" submitClass="btn-secondary btn-sm" confirm="¿Eliminar este anuncio?">
                  <input type="hidden" name="id" value={a.id} />
                </ActionForm>)}
            </div>
            <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{a.body}</p>
          </Card>
        )) : <Card><Empty>No hay anuncios por ahora.</Empty></Card>}
      </div>
    </>
  );
}
