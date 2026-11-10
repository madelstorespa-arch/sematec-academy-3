import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDate } from '@/lib/format';
import { showValue, type CustomModule, type ModField } from '@/lib/modules';
import { deleteRecord, saveRecord } from '@/app/app/modulos/actions';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: (await params).slug.replace(/-/g, ' ') };
}

function Input({ f, v }: { f: ModField; v?: unknown }) {
  const name = `f_${f.key}`;
  const val = v === null || v === undefined ? '' : String(v);
  const label = <span className="label">{f.label}{f.required && ' *'}</span>;
  if (f.type === 'checkbox') return <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name={name} defaultChecked={v === true} /> {f.label}</label>;
  if (f.type === 'textarea') return <label className="block sm:col-span-2">{label}<textarea name={name} required={f.required} defaultValue={val} rows={3} maxLength={5000} className="input" /></label>;
  if (f.type === 'select') return (
    <label className="block">{label}<select name={name} required={f.required} defaultValue={val} className="input">
      <option value="">— Elegir —</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select></label>);
  const type = { number: 'number', money: 'number', date: 'date', email: 'email', phone: 'tel' }[f.type as string] ?? 'text';
  return <label className="block">{label}<input name={name} type={type} step={f.type === 'money' || f.type === 'number' ? 'any' : undefined} required={f.required} defaultValue={val} maxLength={500} className="input" /></label>;
}

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> }) {
  const [{ slug }, { q = '' }] = await Promise.all([params, searchParams]);
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { data: m } = await ctx.supabase.from('custom_modules').select('*').eq('organization_id', orgId).eq('slug', slug).maybeSingle();
  if (!m) notFound();
  const mod = m as CustomModule;
  const [{ data: acc }, { data: rows }] = await Promise.all([
    ctx.supabase.rpc('custom_module_access', { p_module: mod.id }),
    ctx.supabase.from('custom_records').select('id, code, data, created_at, updated_at, created_by, profiles!custom_records_created_by_fkey(full_name)').eq('module_id', mod.id).order('created_at', { ascending: false }).limit(2000),
  ]);
  const edit = !!(acc as any)?.edit;
  const cols = mod.fields.filter((f) => f.list !== false);
  const term = q.trim().toLowerCase();
  const list = ((rows ?? []) as any[]).filter((r) => !term || [r.code, ...mod.fields.map((f) => showValue(f, r.data?.[f.key]))].join(' ').toLowerCase().includes(term));
  return (
    <>
      <PageHeader title={`${mod.icon} ${mod.name}`} subtitle={mod.description ?? `Registros con código automático ${mod.code_prefix} + 6 números`}
        actions={<a className="btn-secondary" href={`/app/m/${mod.slug}/csv`} download>⬇ Excel (CSV)</a>} />
      {!mod.active && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Este módulo está marcado como <b>no disponible</b>: solo el propietario lo ve.</p>}
      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        {edit && <Card title="➕ Nuevo registro">
          <ActionForm action={saveRecord} submitLabel="Guardar"><input type="hidden" name="module_id" value={mod.id} />
            <div className="grid gap-3">{mod.fields.map((f) => <Input key={f.key} f={f} />)}</div></ActionForm>
        </Card>}
        <Card title={`Registros (${list.length}${term ? ` de ${rows?.length ?? 0}` : ''})`} className={edit ? '' : 'xl:col-span-2'}>
          <form className="mb-3 flex gap-2" method="get">
            <input name="q" defaultValue={q} placeholder="🔍 Buscar por código o cualquier dato…" className="input" data-testid="buscar-registros" />
            <button className="btn-secondary">Buscar</button>{term && <Link className="btn-secondary" href={`/app/m/${mod.slug}`}>Limpiar</Link>}
          </form>
          {list.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-registros">
                <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">Código</th>{cols.map((f) => <th key={f.key} className="pr-3">{f.label}</th>)}<th className="pr-3">Creado</th>{edit && <th />}</tr></thead>
                <tbody>{list.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top" data-testid="registro">
                    <td className="py-2 pr-3 font-mono text-xs"><Badge color="blue">{r.code}</Badge></td>
                    {cols.map((f) => <td key={f.key} className="max-w-[16rem] truncate pr-3" title={showValue(f, r.data?.[f.key])}>{showValue(f, r.data?.[f.key])}</td>)}
                    <td className="whitespace-nowrap pr-3 text-xs text-slate-500">{fmtDate(r.created_at)}<span className="block">{r.profiles?.full_name ?? ''}</span></td>
                    {edit && <td className="whitespace-nowrap">
                      <details><summary className="link cursor-pointer text-xs">✏ Editar</summary>
                        <div className="mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3">
                          <ActionForm action={saveRecord} submitLabel="Guardar" resetOnSuccess={false}>
                            <input type="hidden" name="module_id" value={mod.id} /><input type="hidden" name="id" value={r.id} />
                            <div className="grid gap-3">{mod.fields.map((f) => <Input key={f.key} f={f} v={r.data?.[f.key]} />)}</div></ActionForm></div></details>
                      <ActionForm action={deleteRecord} inline submitLabel="🗑" submitClass="text-xs text-red-600 hover:underline" confirm={`¿Eliminar el registro ${r.code}?`}>
                        <input type="hidden" name="module_id" value={mod.id} /><input type="hidden" name="id" value={r.id} /></ActionForm>
                    </td>}
                  </tr>))}</tbody>
              </table>
            </div>) : <Empty>{term ? 'No hay registros que coincidan con la búsqueda.' : 'Aún no hay registros.'}</Empty>}
        </Card>
      </div>
    </>
  );
}
