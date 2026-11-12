import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm, EmailCopy } from '@/components/forms';
import { fmtDate } from '@/lib/format';
import { showValue, type CustomModule } from '@/lib/modules';
import { saveRecord } from '@/app/app/modulos/actions';
import { manageSystemRecord, saveSystemRecord } from '../record-actions';
import { FieldInput, StatusBadge } from '../record-ui';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: (await params).slug.replace(/-/g, ' ') };
}
export const dynamic = 'force-dynamic';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; estado?: string; resp?: string; vista?: string; vencidos?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { q = '', estado = '', resp = '', vista = '', vencidos = '' } = sp;
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { data: m } = await ctx.supabase.from('custom_modules').select('*').eq('organization_id', orgId).eq('slug', slug).maybeSingle();
  if (!m) notFound();
  const mod = m as CustomModule;
  const wf = mod.workflow ?? [];
  const ft = mod.features ?? {};
  const pro = wf.length > 0 || !!mod.catalog_key;
  const [{ data: acc }, { data: rows }, { data: people }] = await Promise.all([
    ctx.supabase.rpc('custom_module_access', { p_module: mod.id }),
    ctx.supabase.from('custom_records').select('id, code, data, status, assignee_id, due_on, closed_at, created_at, updated_at, created_by, profiles!custom_records_created_by_fkey(full_name), assignee:profiles!custom_records_assignee_id_fkey(full_name)')
      .eq('module_id', mod.id).order('created_at', { ascending: false }).limit(2000),
    pro && ft.assignee !== false ? ctx.supabase.rpc('module_people', { p_module: mod.id }) : Promise.resolve({ data: [] as any[] }),
  ]);
  const a = (acc ?? {}) as { view?: boolean; edit?: boolean; self?: boolean };
  const edit = !!a.edit;
  const selfOnly = !edit && !a.view && !!a.self;
  const canCreate = edit || !!a.self;
  const cols = mod.fields.filter((f) => f.list !== false);
  const term = q.trim().toLowerCase();
  const now = today();
  const final = new Set(wf.filter((w) => w.final).map((w) => w.key));
  const overdue = (r: any) => r.due_on && r.due_on < now && !(r.status && final.has(r.status));
  const all = (rows ?? []) as any[];
  const list = all.filter((r) => (!term || [r.code, ...mod.fields.map((f) => showValue(f, r.data?.[f.key]))].join(' ').toLowerCase().includes(term))
    && (!estado || r.status === estado) && (!resp || r.assignee_id === ctx.user.id) && (!vencidos || overdue(r)));
  const amountField = ft.amount ? mod.fields.find((f) => f.key === ft.amount) : undefined;
  const total = amountField ? list.reduce((s, r) => s + (Number(r.data?.[amountField.key]) || 0), 0) : 0;
  const href = (p: Record<string, string>) => { const u = new URLSearchParams({ ...(q ? { q } : {}), ...(estado ? { estado } : {}), ...(resp ? { resp } : {}), ...(vista ? { vista } : {}), ...(vencidos ? { vencidos } : {}), ...p }); [...u.entries()].forEach(([k, v]) => { if (!v) u.delete(k); }); return `/app/m/${mod.slug}${u.size ? `?${u}` : ''}`; };
  const board = vista === 'tablero' && wf.length > 0;
  const peopleOpts = ((people ?? []) as { id: string; full_name: string }[]);
  const createForm = canCreate && (
    <Card title={selfOnly ? '➕ Nueva solicitud' : '➕ Nuevo registro'}>
      <ActionForm action={pro ? saveSystemRecord : saveRecord} submitLabel={selfOnly ? 'Enviar' : 'Guardar'}><input type="hidden" name="module_id" value={mod.id} />
        <div className="grid gap-3">
          {mod.fields.map((f) => <FieldInput key={f.key} f={f} />)}
          {pro && edit && ft.assignee !== false && (
            <label className="block"><span className="label">Responsable</span>
              <select name="assignee_id" className="input" defaultValue=""><option value="">— Sin asignar —</option>{peopleOpts.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>)}
          {pro && edit && ft.due && <label className="block"><span className="label">Fecha límite</span><input type="date" name="due_on" className="input" /></label>}
          {pro && ft.files !== false && <label className="block"><span className="label">Adjuntar archivo (opcional, máx. 4 MB)</span><input type="file" name="file" className="input" /></label>}
          {pro && ft.notify !== false && <EmailCopy label={selfOnly ? 'Avisar por correo a quienes atienden' : 'Avisar por correo al responsable'} />}
        </div></ActionForm>
    </Card>);
  return (
    <>
      <PageHeader title={`${mod.icon} ${mod.name}`} subtitle={mod.description ?? `Registros con código automático ${mod.code_prefix} + 6 números`}
        actions={<span className="flex flex-wrap gap-2">
          <Link className="btn-secondary" href="/app/sistemas">🧩 Sistemas</Link>
          {!selfOnly && <a className="btn-secondary" href={`/app/m/${mod.slug}/csv`} download>⬇ Excel (CSV)</a>}
        </span>} />
      {!mod.active && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Este módulo está marcado como <b>no disponible</b>: solo el propietario lo ve.</p>}
      {selfOnly && <p className="mb-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900" data-testid="modo-solicitud">Aquí envía sus solicitudes y ve en qué estado están. Solo usted y quienes las atienden pueden verlas.</p>}

      {pro && wf.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2" data-testid="filtro-estados">
          <Link href={href({ estado: '' })} className={`rounded-full border px-3 py-1 text-sm ${!estado ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : 'border-slate-200 bg-white'}`}>Todos · {all.length}</Link>
          {wf.map((w) => <Link key={w.key} href={href({ estado: w.key })} className={`rounded-full border px-3 py-1 text-sm ${estado === w.key ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : 'border-slate-200 bg-white'}`} data-testid={`estado-${w.key}`}>
            <StatusBadge wf={wf} k={w.key} /> {all.filter((r) => r.status === w.key).length}</Link>)}
          {ft.due && <Link href={href({ vencidos: vencidos ? '' : '1' })} className={`rounded-full border px-3 py-1 text-sm ${vencidos ? 'border-red-500 bg-red-50 font-semibold text-red-700' : 'border-red-200 bg-white text-red-700'}`} data-testid="filtro-vencidos">⏰ Vencidos · {all.filter(overdue).length}</Link>}
          {ft.assignee !== false && !selfOnly && <Link href={href({ resp: resp ? '' : 'yo' })} className={`rounded-full border px-3 py-1 text-sm ${resp ? 'border-violet-500 bg-violet-50 font-semibold' : 'border-slate-200 bg-white'}`} data-testid="filtro-mios">🙋 Asignados a mí · {all.filter((r) => r.assignee_id === ctx.user.id).length}</Link>}
          {amountField && <span className="ml-auto rounded-xl bg-emerald-50 px-3 py-1 text-sm text-emerald-900" data-testid="total-monto">{amountField.label}: <b>${total.toLocaleString('es-CL')}</b></span>}
          <span className="flex gap-1">
            <Link href={href({ vista: '' })} className={`btn-sm ${!board ? 'btn-primary' : 'btn-secondary'}`}>☰ Lista</Link>
            <Link href={href({ vista: 'tablero' })} className={`btn-sm ${board ? 'btn-primary' : 'btn-secondary'}`} data-testid="vista-tablero">▦ Tablero</Link>
          </span>
        </div>)}

      {board ? (
        <>
          <div className="grid gap-4 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${wf.length}, minmax(15rem, 1fr))` }} data-testid="tablero">
            {wf.map((w) => {
              const items = list.filter((r) => r.status === w.key);
              return (
                <section key={w.key} className="rounded-2xl bg-slate-100/80 p-3" data-testid={`columna-${w.key}`}>
                  <h3 className="mb-2 flex items-center justify-between text-sm font-bold"><StatusBadge wf={wf} k={w.key} /><span className="text-slate-500">{items.length}</span></h3>
                  <div className="space-y-2">{items.map((r) => (
                    <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm" data-testid="tarjeta-registro">
                      <Link className="font-mono text-xs text-brand-700 hover:underline" href={`/app/m/${mod.slug}/${r.id}`}>{r.code}</Link>
                      <p className="font-semibold">{cols[0] ? showValue(cols[0], r.data?.[cols[0].key]) : ''}</p>
                      <p className="text-xs text-slate-500">{r.assignee?.full_name ? `👤 ${r.assignee.full_name}` : ''}{r.due_on ? ` · ${overdue(r) ? '⏰ ' : ''}${fmtDate(r.due_on)}` : ''}</p>
                      {edit && <ActionForm action={manageSystemRecord} inline submitLabel="Mover" submitClass="btn-secondary btn-sm" resetOnSuccess={false}>
                        <input type="hidden" name="module_id" value={mod.id} /><input type="hidden" name="id" value={r.id} />
                        <select name="status" defaultValue={r.status} className="input mt-1 h-8 text-xs" aria-label="Mover a">{wf.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
                      </ActionForm>}
                    </div>))}</div>
                </section>);
            })}
          </div>
          {createForm && <div className="mt-6 max-w-xl">{createForm}</div>}
        </>
      ) : (
        <div className={`grid gap-6 ${canCreate ? 'xl:grid-cols-[22rem_1fr]' : ''}`}>
          {createForm}
          <Card title={`${selfOnly ? 'Mis solicitudes' : 'Registros'} (${list.length}${list.length !== all.length ? ` de ${all.length}` : ''})`}>
            <form className="mb-3 flex gap-2" method="get">
              {estado && <input type="hidden" name="estado" value={estado} />}
              <input name="q" defaultValue={q} placeholder="🔍 Buscar por código o cualquier dato…" className="input" data-testid="buscar-registros" />
              <button className="btn-secondary">Buscar</button>{term && <Link className="btn-secondary" href={href({ q: '' })}>Limpiar</Link>}
            </form>
            {list.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="tabla-registros">
                  <thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">Código</th>{wf.length > 0 && <th className="pr-3">Estado</th>}{cols.map((f) => <th key={f.key} className="pr-3">{f.label}</th>)}
                    {pro && ft.assignee !== false && <th className="pr-3">Responsable</th>}{pro && ft.due && <th className="pr-3">Fecha límite</th>}<th className="pr-3">Creado</th>{edit && !pro && <th />}</tr></thead>
                  <tbody>{list.map((r) => (
                    <tr key={r.id} className={`border-b border-slate-100 align-top ${overdue(r) ? 'bg-red-50/60' : ''}`} data-testid="registro">
                      <td className="py-2 pr-3 font-mono text-xs">{pro ? <Link href={`/app/m/${mod.slug}/${r.id}`} data-testid="abrir-registro"><Badge color="blue">{r.code}</Badge></Link> : <Badge color="blue">{r.code}</Badge>}</td>
                      {wf.length > 0 && <td className="pr-3"><StatusBadge wf={wf} k={r.status} /></td>}
                      {cols.map((f) => <td key={f.key} className="max-w-[16rem] truncate pr-3" title={showValue(f, r.data?.[f.key])}>{showValue(f, r.data?.[f.key])}</td>)}
                      {pro && ft.assignee !== false && <td className="pr-3 text-xs">{r.assignee?.full_name ?? '—'}</td>}
                      {pro && ft.due && <td className={`whitespace-nowrap pr-3 text-xs ${overdue(r) ? 'font-bold text-red-700' : ''}`}>{r.due_on ? `${overdue(r) ? '⏰ ' : ''}${fmtDate(r.due_on)}` : '—'}</td>}
                      <td className="whitespace-nowrap pr-3 text-xs text-slate-500">{fmtDate(r.created_at)}<span className="block">{r.profiles?.full_name ?? ''}</span></td>
                      {edit && !pro && <td className="whitespace-nowrap">
                        <details><summary className="link cursor-pointer text-xs">✏ Editar</summary>
                          <div className="mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3">
                            <ActionForm action={saveRecord} submitLabel="Guardar" resetOnSuccess={false}>
                              <input type="hidden" name="module_id" value={mod.id} /><input type="hidden" name="id" value={r.id} />
                              <div className="grid gap-3">{mod.fields.map((f) => <FieldInput key={f.key} f={f} v={r.data?.[f.key]} />)}</div></ActionForm></div></details>
                        <Link href={`/app/m/${mod.slug}/${r.id}`} className="text-xs text-brand-700 hover:underline">Abrir</Link>
                      </td>}
                    </tr>))}</tbody>
                </table>
              </div>) : <Empty>{term || estado || resp || vencidos ? 'No hay registros que coincidan.' : selfOnly ? 'Aún no ha enviado solicitudes.' : 'Aún no hay registros.'}</Empty>}
          </Card>
        </div>)}
    </>
  );
}
