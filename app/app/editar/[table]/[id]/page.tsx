import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { OwnerActions } from '@/components/owner-actions';
import { label } from '@/lib/format';
import { safeNext } from '@/lib/safe-redirect';
import { ENTITIES, LONG_TEXT, EXTRA_FIELD_LABELS, SUSPENDABLE } from '@/lib/entities';
import { TABLE_LABELS, fieldLabel, recordName } from '@/lib/undo-labels';
import { saveEntity } from '../../actions';

export const dynamic = 'force-dynamic';

type Col = { col: string; data_type: string; nullable: boolean; choices: string[] | null; ref_table: string | null };
const fl = (c: string) => EXTRA_FIELD_LABELS[c] ?? fieldLabel(c);
const BOOL = [{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }];

export default async function EditarPage({ params, searchParams }: {
  params: Promise<{ table: string; id: string }>; searchParams: Promise<{ volver?: string }>;
}) {
  const { table, id } = await params; const sp = await searchParams;
  const spec = ENTITIES[table];
  if (!spec || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  if (!ctx.isOwner || !ctx.orgId) redirect('/app');
  const back = safeNext(sp.volver, spec.back);
  const [{ data: schema, error }, { data: row }, { data: org }] = await Promise.all([
    ctx.supabase.rpc('entity_schema', { p_table: table, p_org: ctx.orgId }),
    ctx.supabase.from(table).select('*').eq('id', id).maybeSingle(),
    ctx.supabase.from('organizations').select('timezone').eq('id', ctx.orgId).single(),
  ]);
  if (!row) notFound();
  const tz = org?.timezone ?? 'America/Santiago';
  const all = (schema ?? []) as Col[];
  const cols = spec.fields ? spec.fields.map((f) => all.find((c) => c.col === f)).filter((c): c is Col => !!c) : all;
  const refs = Object.fromEntries(await Promise.all([...new Set(cols.map((c) => c.ref_table).filter(Boolean))].map(async (r) => {
    const { data } = await ctx.supabase.rpc('entity_ref_options', { p_ref: r!, p_org: ctx.orgId });
    return [r!, ((data ?? []) as { id: string; label: string }[]).map((o) => ({ value: o.id, label: o.label }))];
  })));
  const local = (iso: string | null) => iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16).replace(' ', 'T') : '';
  const val = (c: Col) => {
    const v = (row as Record<string, unknown>)[c.col];
    if (v === null || v === undefined) return '';
    if (c.data_type.startsWith('timestamp')) return local(String(v));
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  };
  const name = recordName(row as Record<string, unknown>);
  const active = SUSPENDABLE[table]?.(row as Record<string, unknown>);

  return (
    <div>
      <PageHeader title={`✏️ Editar ${(TABLE_LABELS[table] ?? table).toLowerCase()}${name ? ` «${name}»` : ''}`}
        subtitle="Cambie lo que necesite y guarde. Si se equivoca, use ↶ Deshacer o el Historial."
        actions={<Link href={back} className="btn-secondary">← Volver</Link>} />
      {error ? <Card><p className="text-sm text-red-700">{error.message}</p></Card> : (
        <Card>
          {cols.length === 0 ? <p className="text-sm text-slate-600">Este registro no tiene campos editables: puede eliminarlo o restaurarlo desde la Papelera.</p> : (
            <ActionForm action={saveEntity} submitLabel="💾 Guardar cambios">
              <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} />
              <Grid cols={2}>
                {cols.map((c) => {
                  const lbl = fl(c.col); const req = !c.nullable && c.data_type !== 'boolean';
                  if (c.data_type === 'boolean') return <SelectField key={c.col} label={lbl} name={c.col} options={BOOL} defaultValue={val(c) || 'false'} />;
                  if (c.choices?.length) return <SelectField key={c.col} label={lbl} name={c.col} required={req} defaultValue={val(c)}
                    placeholder={c.nullable ? '—' : undefined} options={c.choices.map((x) => ({ value: x, label: label(x) }))} />;
                  if (c.ref_table) return <SelectField key={c.col} label={lbl} name={c.col} required={req} defaultValue={val(c)}
                    placeholder={c.nullable ? '— Ninguno —' : undefined} options={refs[c.ref_table] ?? []} />;
                  if (LONG_TEXT.has(c.col)) return <div key={c.col} className="md:col-span-2"><TextArea label={lbl} name={c.col} required={req} defaultValue={val(c)} rows={4} /></div>;
                  if (c.data_type === 'date') return <Field key={c.col} label={lbl} name={c.col} type="date" required={req} defaultValue={val(c)} />;
                  if (c.data_type.startsWith('timestamp')) return <Field key={c.col} label={lbl} name={c.col} type="datetime-local" required={req} defaultValue={val(c)} />;
                  if (/^(numeric|integer|smallint|bigint|real|double)/.test(c.data_type)) return <Field key={c.col} label={lbl} name={c.col} type="number" step="any" required={req} defaultValue={val(c)} />;
                  if (c.data_type === 'array') return <Field key={c.col} label={`${lbl} (separados por coma)`} name={c.col} defaultValue={val(c)} />;
                  return <Field key={c.col} label={lbl} name={c.col} required={req} defaultValue={val(c)} />;
                })}
              </Grid>
            </ActionForm>
          )}
          <div className="mt-6 border-t border-slate-100 pt-4">
            <p className="label mb-2">Más acciones</p>
            <OwnerActions table={table} id={id} active={active} path={back} name={name ? `«${name}»` : 'este registro'} noEdit afterDelete={back} />
          </div>
        </Card>
      )}
    </div>
  );
}
