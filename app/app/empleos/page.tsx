import { getContext, can, requireOrg } from '@/lib/context';
import { OwnerActions } from '@/components/owner-actions';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDate } from '@/lib/format';
import { createJob, toggleJob } from './actions';

export const metadata = { title: 'Bolsa de empleo' };
const MOD: Record<string, string> = { presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido' };

export default async function Page({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const sp = await searchParams;
  const manage = can(ctx, 'alumni.edit');
  let q = ctx.supabase.from('job_postings').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(200);
  if (sp.tipo === 'empleo' || sp.tipo === 'practica') q = q.eq('kind', sp.tipo);
  const { data: jobs } = await q;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Bolsa de empleo" subtitle="Ofertas de trabajo y prácticas para estudiantes y egresados" />
      {can(ctx, 'alumni.create') && (
        <details className="card mb-6">
          <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Publicar oferta</summary>
          <div className="border-t border-slate-100 p-5">
            <ActionForm action={createJob} submitLabel="Publicar">
              <Grid cols={3}>
                <SelectField label="Tipo" name="kind" required defaultValue="empleo" options={[{ value: 'empleo', label: 'Empleo' }, { value: 'practica', label: 'Práctica profesional' }]} />
                <Field label="Cargo" name="title" required />
                <Field label="Empresa" name="company" required />
                <Field label="Ciudad / comuna" name="location" />
                <SelectField label="Modalidad" name="modality" required defaultValue="presencial" options={Object.entries(MOD).map(([value, label]) => ({ value, label }))} />
                <Field label="Postular hasta (opcional)" name="closes_on" type="date" />
              </Grid>
              <TextArea label="Descripción, requisitos y beneficios" name="description" required rows={5} />
              <Grid cols={2}>
                <Field label="Enlace para postular (https://…)" name="apply_url" type="url" />
                <Field label="…o correo para enviar CV" name="apply_email" type="email" />
              </Grid>
            </ActionForm>
          </div>
        </details>
      )}
      <div className="mb-4 flex gap-2 text-sm">
        {[['', 'Todas'], ['empleo', 'Empleos'], ['practica', 'Prácticas']].map(([k, l]) => (
          <a key={k} href={k ? `?tipo=${k}` : '?'} className={(sp.tipo ?? '') === k ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>{l}</a>))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {jobs?.length ? jobs.map((j: any) => {
          const closed = !j.published || (j.closes_on && j.closes_on < today);
          return (
            <Card key={j.id} className={closed ? 'opacity-60' : ''}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold">{j.title}</h2>
                  <p className="text-sm text-slate-600">{j.company}{j.location ? ` · ${j.location}` : ''} · {MOD[j.modality]}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge color={j.kind === 'practica' ? 'amber' : 'blue'}>{j.kind === 'practica' ? 'Práctica' : 'Empleo'}</Badge>
                  {closed && <Badge color="gray">{j.published ? 'Cerrada' : 'Retirada'}</Badge>}
                </div>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{j.description}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">Publicada {fmtDate(j.created_at)}{j.closes_on ? ` · postular hasta ${fmtDate(j.closes_on)}` : ''}</span>
                <span className="flex flex-wrap gap-2">
                  {!closed && j.apply_url && <a className="btn-primary btn-sm" href={j.apply_url} target="_blank" rel="noopener noreferrer">Postular</a>}
                  {!closed && j.apply_email && <a className="btn-secondary btn-sm" href={`mailto:${j.apply_email}?subject=${encodeURIComponent('Postulación: ' + j.title)}`}>Enviar CV</a>}
                  {ctx.isOwner && <OwnerActions table="job_postings" id={j.id} path="/app/empleos" name={`la oferta ${j.title}`} />}
                  {manage && <ActionForm action={toggleJob} inline submitLabel={j.published ? 'Retirar' : 'Volver a publicar'} submitClass="btn-secondary btn-sm">
                    <input type="hidden" name="id" value={j.id} /><input type="hidden" name="publish" value={j.published ? '0' : '1'} />
                  </ActionForm>}
                </span>
              </div>
            </Card>);
        }) : <Card className="lg:col-span-2"><Empty>No hay ofertas publicadas por ahora.</Empty></Card>}
      </div>
    </>
  );
}
