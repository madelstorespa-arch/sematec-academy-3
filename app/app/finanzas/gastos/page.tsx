import Link from 'next/link';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { campusOptions, programOptions } from '@/lib/options';
import { fmtDate, fmtMoney } from '@/lib/format';
import { EXPENSE_CATEGORIES, expenseLabel, monthName, monthRange } from '@/lib/finance';
import { FinanceTabs } from '../tabs';
import { createExpense, deleteExpense, updateExpense } from '../actions';

export const metadata = { title: 'Gastos' };

function ExpenseFields({ d = {}, programs, sections, campuses, currency }: { d?: Record<string, any>; programs: any[]; sections: any[]; campuses: any[]; currency: string }) {
  return (
    <Grid cols={4}>
      <Field label="Fecha" name="spent_on" type="date" required defaultValue={d.spent_on ?? new Date().toISOString().slice(0, 10)} />
      <SelectField label="Categoría" name="category" required defaultValue={d.category ?? 'otros'} options={EXPENSE_CATEGORIES.map(([value, label]) => ({ value, label }))} />
      <Field label="Monto" name="amount" type="number" min={1} step="0.01" required defaultValue={d.amount} />
      <Field label="Moneda" name="currency" required defaultValue={d.currency ?? currency} />
      <Field label="Descripción" name="description" required defaultValue={d.description} className="md:col-span-2" placeholder="Ej.: Arriendo sede centro, noviembre" />
      <Field label="Proveedor" name="supplier" defaultValue={d.supplier} />
      <Field label="N° boleta / factura" name="document_number" defaultValue={d.document_number} />
      <SelectField label="Programa (opcional)" name="program_id" defaultValue={d.program_id} options={programs} placeholder="— Gasto general —" />
      <SelectField label="Sección (opcional)" name="section_id" defaultValue={d.section_id} options={sections} placeholder="— Ninguna —" />
      <SelectField label="Sede (opcional)" name="campus_id" defaultValue={d.campus_id} options={campuses} placeholder="— Todas —" />
      <Field label="Nota" name="notes" defaultValue={d.notes} />
    </Grid>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ mes?: string; cat?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'finance.view');
  const orgId = requireOrg(ctx);
  const sp = await searchParams;
  const r = monthRange(sp.mes, sp.mes);
  let q = ctx.supabase.from('expenses').select('*, programs(name), sections(code, courses(name))').eq('organization_id', orgId)
    .gte('spent_on', r.start).lte('spent_on', r.end).order('spent_on', { ascending: false }).limit(1000);
  if (ctx.campusId) q = q.eq('campus_id', ctx.campusId);
  if (sp.cat) q = q.eq('category', sp.cat);
  const [{ data: rows }, programs, campuses, { data: secs }, { data: org }] = await Promise.all([
    q, programOptions(ctx), campusOptions(ctx),
    ctx.supabase.from('sections').select('id, code, courses(name)').eq('organization_id', orgId).eq('status', 'active').order('code').limit(500),
    ctx.supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
  ]);
  const sections = (secs ?? []).map((s: any) => ({ value: s.id, label: `${s.courses?.name} · ${s.code}` }));
  const currency = org?.base_currency ?? 'CLP';
  const totals: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  for (const x of rows ?? []) { totals[x.currency] = (totals[x.currency] ?? 0) + Number(x.amount); if (x.currency === currency) byCat[x.category] = (byCat[x.category] ?? 0) + Number(x.amount); }
  const canCreate = can(ctx, 'finance.create'), canEdit = canCreate || can(ctx, 'finance.edit');
  const canDelete = can(ctx, 'finance.void') || can(ctx, 'finance.edit') || can(ctx, 'finance.admin');
  const fieldsProps = { programs, sections, campuses, currency };

  return (
    <>
      <PageHeader title="Finanzas" subtitle="Gastos de la institución: lo que se paga cada mes" />
      <FinanceTabs current="gastos" />
      {canCreate && (
        <Card title="Registrar gasto" className="mb-6">
          <ActionForm action={createExpense} submitLabel="Guardar gasto"><ExpenseFields {...fieldsProps} /></ActionForm>
          <p className="mt-2 text-xs text-slate-500">Si asocia el gasto a un programa o sección, se descuenta del saldo de ese programa o sección en «📊 Ingresos y gastos».</p>
        </Card>)}
      <Card title={`Gastos de ${monthName(r.from)}`} actions={
        <form className="flex items-center gap-2 text-sm">
          <input type="month" name="mes" defaultValue={r.from} className="input py-1" aria-label="Mes" />
          <select name="cat" defaultValue={sp.cat ?? ''} className="input py-1" aria-label="Categoría">
            <option value="">Todas las categorías</option>{EXPENSE_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn-secondary btn-sm">Ver</button>
        </form>}>
        <div className="mb-4 flex flex-wrap gap-3">
          {Object.entries(totals).map(([c, t]) => <div key={c} className="rounded-xl bg-red-50 px-4 py-2"><p className="text-xs text-red-700">Total gastos {c}</p><p className="text-lg font-bold text-red-700" data-testid="total-gastos">{fmtMoney(t, c)}</p></div>)}
          {Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, t]) => <div key={k} className="rounded-xl bg-slate-50 px-3 py-2 text-sm"><p className="text-xs text-slate-500">{expenseLabel(k)}</p><p className="font-semibold">{fmtMoney(t, currency)}</p></div>)}
        </div>
        {rows?.length ? (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Asociado a</th><th className="text-right">Monto</th>{(canEdit || canDelete) && <th></th>}</tr></thead>
            <tbody>{rows.map((x: any) => (
              <tr key={x.id} className="align-top">
                <td>{fmtDate(x.spent_on)}</td><td>{expenseLabel(x.category)}</td>
                <td>{x.description}{(x.supplier || x.document_number) && <span className="block text-xs text-slate-500">{[x.supplier, x.document_number && `Doc. ${x.document_number}`].filter(Boolean).join(' · ')}</span>}</td>
                <td className="text-xs">{x.sections ? `${x.sections.courses?.name} · ${x.sections.code}` : x.programs?.name ?? 'General'}</td>
                <td className="text-right font-semibold">{fmtMoney(x.amount, x.currency)}</td>
                {(canEdit || canDelete) && <td className="whitespace-nowrap">
                  {canEdit && (
                    <details className="inline-block">
                      <summary className="link cursor-pointer text-xs">✏ Editar</summary>
                      <div className="mt-2 w-[min(90vw,48rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                        <ActionForm action={updateExpense} submitLabel="Guardar cambios" resetOnSuccess={false}>
                          <input type="hidden" name="id" value={x.id} /><ExpenseFields d={x} {...fieldsProps} />
                        </ActionForm>
                      </div>
                    </details>)}
                  {canDelete && (
                    <ActionForm action={deleteExpense} inline submitLabel="🗑" submitClass="ml-2 text-xs text-red-600 hover:underline" confirm={`¿Eliminar el gasto «${x.description}»?`}>
                      <input type="hidden" name="id" value={x.id} />
                    </ActionForm>)}
                </td>}
              </tr>))}</tbody></table></div>
        ) : <Empty>No hay gastos registrados en {monthName(r.from)}.</Empty>}
        <p className="mt-3 text-xs"><Link className="link" href={`/app/finanzas/balance?desde=${r.from}&hasta=${r.from}`}>Ver ingresos, gastos y saldo de este mes →</Link></p>
      </Card>
    </>
  );
}
