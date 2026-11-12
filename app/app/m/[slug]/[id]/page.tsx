import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge } from '@/components/ui';
import { ActionForm, EmailCopy } from '@/components/forms';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { showValue, type CustomModule } from '@/lib/modules';
import { HideMenu } from '@/components/hide-menu';
import { commentSystemRecord, deleteSystemFile, deleteSystemRecord, manageSystemRecord, saveSystemRecord } from '../../record-actions';
import { FieldInput, StatusBadge } from '../../record-ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Registro' };
const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Ficha de un registro: datos, estado, responsable, plazo, archivos e historial con comentarios. */
export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { data: m } = await ctx.supabase.from('custom_modules').select('*').eq('organization_id', orgId).eq('slug', slug).maybeSingle();
  if (!m) notFound();
  const mod = m as CustomModule;
  const [{ data: r }, { data: acc }, { data: events }, { data: files }, { data: people }] = await Promise.all([
    ctx.supabase.from('custom_records').select('*, author:profiles!custom_records_created_by_fkey(full_name), assignee:profiles!custom_records_assignee_id_fkey(full_name)').eq('id', id).eq('module_id', mod.id).maybeSingle(),
    ctx.supabase.rpc('custom_module_access', { p_module: mod.id }),
    ctx.supabase.from('custom_record_events').select('id, kind, body, from_status, to_status, created_at, profiles!custom_record_events_created_by_fkey(full_name)').eq('record_id', id).order('created_at'),
    ctx.supabase.from('custom_record_files').select('id, name, size, created_at, created_by').eq('record_id', id).order('created_at'),
    ctx.supabase.rpc('module_people', { p_module: mod.id }),
  ]);
  if (!r) notFound();
  const wf = mod.workflow ?? []; const ft = mod.features ?? {};
  const a = (acc ?? {}) as { edit?: boolean };
  const edit = !!a.edit;
  const canManage = edit || r.assignee_id === ctx.user.id;
  const now = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const finalKeys = new Set(wf.filter((w) => w.final).map((w) => w.key));
  const overdue = r.due_on && r.due_on < now && !finalKeys.has(r.status);
  const label = (k?: string | null) => wf.find((w) => w.key === k)?.label ?? k ?? '';
  const path = `/app/m/${mod.slug}/${id}`;
  const hid = (<><input type="hidden" name="module_id" value={mod.id} /><input type="hidden" name="id" value={id} /></>);
  return (
    <>
      <PageHeader title={`${mod.icon} ${r.code}`} subtitle={`${mod.name} · creado el ${fmtDateTime(r.created_at)} por ${(r.author as any)?.full_name ?? '—'}`}
        actions={<span className="flex flex-wrap items-center gap-2">
          <Link className="btn-secondary" href={`/app/m/${mod.slug}`}>← {mod.name}</Link>
          {ctx.isOwner && <HideMenu table="custom_records" id={id} path={path} />}
          {edit && <ActionForm action={deleteSystemRecord} inline submitLabel="🗑 Eliminar" submitClass="btn-secondary text-red-700" confirm={`¿Eliminar ${r.code}? Podrá deshacerlo con ↶.`}>{hid}<input type="hidden" name="after" value="1" /></ActionForm>}
        </span>} />
      <div className="mb-5 flex flex-wrap items-center gap-3 text-sm" data-testid="resumen-registro">
        {wf.length > 0 && <StatusBadge wf={wf} k={r.status} />}
        {ft.assignee !== false && <span>👤 Responsable: <b>{(r.assignee as any)?.full_name ?? 'sin asignar'}</b></span>}
        {ft.due && <span className={overdue ? 'font-bold text-red-700' : ''}>{overdue ? '⏰ Vencido' : '📅 Fecha límite'}: {r.due_on ? fmtDate(r.due_on) : '—'}</span>}
        {r.closed_at && <Badge color="green">Cerrado el {fmtDate(r.closed_at)}</Badge>}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card title="Datos">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="datos-registro">
              {mod.fields.map((f) => (
                <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}><dt className="text-xs text-slate-500">{f.label}</dt>
                  <dd className="whitespace-pre-line font-medium">{showValue(f, r.data?.[f.key]) || '—'}</dd></div>))}
            </dl>
            {edit && (
              <details className="mt-4 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-brand-700">✏ Editar datos</summary>
                <ActionForm action={saveSystemRecord} submitLabel="Guardar cambios" resetOnSuccess={false}>{hid}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">{mod.fields.map((f) => <FieldInput key={f.key} f={f} v={r.data?.[f.key]} />)}</div></ActionForm></details>)}
          </Card>
          <Card title={`🕘 Historial y comentarios (${events?.length ?? 0})`}>
            <ol className="space-y-3 border-l-2 border-slate-200 pl-4" data-testid="historial-registro">
              {(events ?? []).map((e: any) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
                  <span className="text-xs text-slate-500">{fmtDateTime(e.created_at)} · {e.profiles?.full_name ?? 'Sistema'}</span>
                  <p>{e.kind === 'created' ? `Creó el registro${e.to_status ? ` (${label(e.to_status)})` : ''}` : e.kind === 'status' ? <>Cambió el estado: {label(e.from_status)} → <b>{label(e.to_status)}</b></>
                    : e.kind === 'assign' ? <>Asignó a <b>{e.body}</b></> : e.kind === 'due' ? <>Fecha límite: <b>{e.body}</b></> : e.kind === 'file' ? <>📎 Adjuntó «{e.body}»</>
                    : <span className="block whitespace-pre-line rounded-lg bg-slate-50 p-2">💬 {e.body}</span>}</p>
                </li>))}
            </ol>
            <div className="mt-4">
              <ActionForm action={commentSystemRecord} submitLabel="Comentar" submitClass="btn-primary btn-sm">{hid}
                <textarea name="body" rows={2} className="input" placeholder="Escriba un comentario…" maxLength={4000} data-testid="comentario-registro" />
                {ft.files !== false && <input type="file" name="file" className="input" />}
                <EmailCopy label="Avisar por correo a quien lo pidió y al responsable" />
              </ActionForm>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          {canManage && (wf.length > 0 || ft.assignee !== false || ft.due) && (
            <Card title="🔄 Gestionar">
              <ActionForm action={manageSystemRecord} submitLabel="Guardar" resetOnSuccess={false}>{hid}
                {wf.length > 0 && <label className="block"><span className="label">Estado</span>
                  <select name="status" defaultValue={r.status ?? ''} className="input" data-testid="cambiar-estado">{wf.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}</select></label>}
                {edit && ft.assignee !== false && <label className="block"><span className="label">Responsable</span>
                  <select name="assignee_id" defaultValue={r.assignee_id ?? ''} className="input" data-testid="cambiar-responsable"><option value="">— Sin asignar —</option>
                    {((people ?? []) as any[]).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>}
                {edit && ft.due && <label className="block"><span className="label">Fecha límite</span><input type="date" name="due_on" defaultValue={r.due_on ?? ''} className="input" data-testid="cambiar-plazo" /></label>}
                <label className="block"><span className="label">Comentario (opcional)</span><textarea name="comment" rows={2} className="input" maxLength={4000} /></label>
                <EmailCopy label="Avisar por correo" />
              </ActionForm>
            </Card>)}
          {ft.files !== false && (
            <Card title={`📎 Archivos (${files?.length ?? 0})`}>
              {files?.length ? <ul className="space-y-2 text-sm" data-testid="archivos-registro">{files.map((f: any) => (
                <li key={f.id} className="flex items-center gap-2"><a className="link min-w-0 flex-1 truncate" href={`/api/sistemas/archivo/${f.id}`} data-testid="descargar-adjunto">{f.name}</a>
                  <span className="text-xs text-slate-500">{size(f.size)}</span>
                  {(f.created_by === ctx.user.id || edit) && <ActionForm action={deleteSystemFile} inline submitLabel="✕" submitClass="text-xs text-red-600" confirm="¿Eliminar este archivo?"><input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="path" value={path} /></ActionForm>}</li>))}</ul>
                : <p className="text-sm text-slate-500">Sin archivos. Adjunte uno desde «Comentar».</p>}
            </Card>)}
        </div>
      </div>
    </>
  );
}
