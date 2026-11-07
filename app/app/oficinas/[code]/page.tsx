import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge, Empty, Tabs } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { createPost, deletePost, requestAppointment, manageAppointment } from '../actions';

const AST: Record<string, [string, 'gray' | 'blue' | 'green' | 'red']> = {
  solicitada: ['Por confirmar', 'gray'], confirmada: ['Confirmada', 'green'], cancelada: ['Cancelada', 'red'], realizada: ['Realizada', 'blue'],
};
const MODE: Record<string, string> = { presencial: '🏫 Presencial', videollamada: '🎥 Videollamada', telefono: '📞 Teléfono' };
const localInput = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Santiago' }).slice(0, 16).replace(' ', 'T');

export default async function Page({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ t?: string; tema?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { data: offices } = await ctx.supabase.rpc('my_offices', { p_org: orgId });
  const o = ((offices ?? []) as any[]).find((x) => x.code === code);
  if (!o) notFound();
  const member = !!o.is_member;
  const tab = sp.t ?? (member ? 'mesa' : 'citas');
  const base = `/app/oficinas/${code}`;
  const hid = <><input type="hidden" name="office_id" value={o.id} /><input type="hidden" name="code" value={code} /></>;
  const tabs = member
    ? [{ key: 'mesa', label: '💬 Mesa de discusión', href: `${base}?t=mesa` }, { key: 'citas', label: `📅 Citas${Number(o.pending_appointments) ? ` (${o.pending_appointments})` : ''}`, href: `${base}?t=citas` }, { key: 'equipo', label: '👥 Integrantes', href: `${base}?t=equipo` }]
    : [];

  let body: React.ReactNode = null;
  if (member && tab === 'mesa') {
    if (sp.tema) {
      const [{ data: th }, { data: replies }] = await Promise.all([
        ctx.supabase.from('office_posts').select('*').eq('id', sp.tema).eq('office_id', o.id).maybeSingle(),
        ctx.supabase.from('office_posts').select('*').eq('parent_id', sp.tema).order('created_at'),
      ]);
      if (!th) notFound();
      body = (
        <>
          <Link className="link text-sm" href={`${base}?t=mesa`}>← Volver a la mesa</Link>
          <Card className="mt-3">
            <h2 className="text-lg font-bold">{th.title}</h2>
            <p className="text-xs text-slate-500">{th.author_name} · {fmtDateTime(th.created_at)}</p>
            <p className="mt-3 whitespace-pre-line text-sm">{th.body}</p>
          </Card>
          <div className="mt-4 space-y-3">
            {(replies ?? []).map((r: any) => (
              <div key={r.id} className={`rounded-xl p-4 text-sm ${r.author_id === ctx.user.id ? 'ml-8 bg-brand-50' : 'mr-8 bg-slate-50'}`}>
                <p className="flex justify-between text-xs text-slate-500"><b>{r.author_name}</b><span>{fmtDateTime(r.created_at)}</span></p>
                <p className="mt-1 whitespace-pre-line">{r.body}</p>
                {(r.author_id === ctx.user.id || ctx.isOwner) && (
                  <ActionForm action={deletePost} inline submitLabel="Eliminar" submitClass="mt-1 text-xs text-red-600 underline" confirm="¿Eliminar esta respuesta?">
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="code" value={code} /></ActionForm>)}
              </div>))}
          </div>
          <Card className="mt-4"><ActionForm action={createPost} submitLabel="Responder" offline={{ key: 'oficina_post', label: 'Respuesta en la oficina' }}>
            {hid}<input type="hidden" name="parent_id" value={th.id} />
            <TextArea label="Su respuesta" name="body" required rows={3} />
          </ActionForm></Card>
        </>);
    } else {
      const { data: threads } = await ctx.supabase.from('office_posts').select('*').eq('office_id', o.id).is('parent_id', null)
        .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100);
      const ids = (threads ?? []).map((t: any) => t.id);
      const { data: rc } = ids.length ? await ctx.supabase.from('office_posts').select('parent_id').in('parent_id', ids) : { data: [] as any[] };
      body = (
        <>
          <details className="card mb-4" open={!threads?.length}>
            <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Nuevo tema de conversación</summary>
            <div className="border-t border-slate-100 p-5"><ActionForm action={createPost} submitLabel="Publicar">
              {hid}<Field label="Tema" name="title" required placeholder="Ej.: Calendario de evaluaciones del semestre" />
              <TextArea label="Mensaje" name="body" required rows={4} />
            </ActionForm></div>
          </details>
          <Card>
            {threads?.length ? <ul className="divide-y divide-slate-100">{threads.map((t: any) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <Link href={`${base}?t=mesa&tema=${t.id}`} className="min-w-0">
                  <b className="hover:text-brand-700">{t.title}</b>
                  <span className="block text-xs text-slate-500">{t.author_name} · {fmtDateTime(t.created_at)}</span>
                </Link>
                <span className="flex items-center gap-2"><Badge>💬 {(rc ?? []).filter((r: any) => r.parent_id === t.id).length}</Badge>
                  {(t.author_id === ctx.user.id || ctx.isOwner) && <ActionForm action={deletePost} inline submitLabel="🗑" submitClass="text-xs" confirm="¿Eliminar el tema y sus respuestas?">
                    <input type="hidden" name="id" value={t.id} /><input type="hidden" name="code" value={code} /></ActionForm>}</span>
              </li>))}</ul> : <Empty>Aún no hay temas. Inicie la conversación del equipo.</Empty>}
          </Card>
        </>);
    }
  } else if (member && tab === 'equipo') {
    const { data: people } = await ctx.supabase.rpc('office_people', { p_office: o.id });
    body = (
      <Card title={`Integrantes (${people?.length ?? 0})`}>
        {people?.length ? <ul className="grid gap-2 sm:grid-cols-2">{(people as any[]).map((p) => (
          <li key={p.user_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span><b>{p.full_name || 'Sin nombre'}</b><span className="block text-xs text-slate-500">{p.role_name}</span></span>
            {p.user_id !== ctx.user.id && <Link className="btn-secondary btn-sm" href={`/app/mensajes?para=${p.user_id}`}>✉ Mensaje</Link>}
          </li>))}</ul> : <Empty>Sin integrantes.</Empty>}
      </Card>);
  } else {
    const { data: appts } = await ctx.supabase.from('appointments').select('*').eq('office_id', o.id)
      .gte('starts_at', new Date(Date.now() - 2 * 864e5).toISOString()).order('starts_at').limit(100);
    const mine = (appts ?? []).filter((a: any) => a.requester_id === ctx.user.id);
    const incoming = member ? (appts ?? []) : [];
    body = (
      <div className="space-y-6">
        {o.accepts_appointments && (
          <Card title="📅 Pedir una cita" className="scroll-mt-24" >
            <div id="agendar" />
            {o.attention_hours && <p className="mb-3 text-sm text-slate-600">Horario de atención: {o.attention_hours}</p>}
            <ActionForm action={requestAppointment} submitLabel="Solicitar cita">
              {hid}
              <Grid cols={3}>
                <Field label="Fecha y hora" name="starts_at" type="datetime-local" required />
                <SelectField label="Modalidad" name="mode" required defaultValue="presencial" options={Object.entries(MODE).map(([value, label]) => ({ value, label }))} />
                <SelectField label="Duración" name="duration_min" defaultValue="30" options={[['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '1 hora']].map(([value, label]) => ({ value, label }))} />
              </Grid>
              <Field label="Motivo" name="topic" required placeholder="Ej.: Revisar mi situación de matrícula" />
              <TextArea label="Detalle (opcional)" name="details" rows={2} />
            </ActionForm>
          </Card>)}
        {mine.length > 0 && !member && (
          <Card title="Mis citas con esta oficina">
            <ul className="divide-y divide-slate-100">{mine.map((a: any) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>{fmtDateTime(a.starts_at)} · {MODE[a.mode]} · {a.topic}{a.staff_note && <span className="block text-xs text-slate-500">Nota: {a.staff_note}</span>}</span>
                <span className="flex items-center gap-2"><Badge color={AST[a.status][1]}>{AST[a.status][0]}</Badge>
                  {['solicitada', 'confirmada'].includes(a.status) && <ActionForm action={manageAppointment} inline submitLabel="Cancelar" submitClass="btn-secondary btn-sm" confirm="¿Cancelar la cita?">
                    <input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="cancelada" /><input type="hidden" name="code" value={code} /></ActionForm>}</span>
              </li>))}</ul>
          </Card>)}
        {member && (
          <Card title="Agenda de citas de la oficina">
            {incoming.length ? <ul className="divide-y divide-slate-100">{incoming.map((a: any) => (
              <li key={a.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span><b>{fmtDateTime(a.starts_at)}</b> · {a.duration_min} min · {MODE[a.mode]}<span className="block">{a.requester_name} — {a.topic}</span>
                    {a.details && <span className="block text-xs text-slate-500">{a.details}</span>}</span>
                  <Badge color={AST[a.status][1]}>{AST[a.status][0]}</Badge>
                </div>
                {['solicitada', 'confirmada'].includes(a.status) && (
                  <ActionForm action={manageAppointment} inline submitLabel="Aplicar" submitClass="btn-secondary btn-sm" resetOnSuccess={false}>
                    <input type="hidden" name="id" value={a.id} /><input type="hidden" name="code" value={code} />
                    <select name="status" defaultValue={a.status === 'solicitada' ? 'confirmada' : 'realizada'} className="input py-1 text-xs">
                      <option value="confirmada">Confirmar</option><option value="realizada">Marcar realizada</option><option value="cancelada">Cancelar</option></select>
                    <input name="starts_at" type="datetime-local" defaultValue={localInput(a.starts_at)} className="input py-1 text-xs" title="Cambiar hora (reprogramar)" />
                    <input name="note" placeholder="Nota (sala, enlace…)" className="input w-40 py-1 text-xs" />
                  </ActionForm>)}
              </li>))}</ul> : <Empty>No hay citas agendadas.</Empty>}
          </Card>)}
      </div>);
  }

  return (
    <>
      <PageHeader title={`${o.icon} ${o.name}`} subtitle={o.description ?? ''} actions={<Link className="btn-secondary" href="/app/oficinas">Todas las oficinas</Link>} />
      {tabs.length > 0 && <Tabs items={tabs} current={tab} />}
      {body}
    </>
  );
}
