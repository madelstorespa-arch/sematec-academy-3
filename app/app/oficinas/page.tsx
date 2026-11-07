import Link from 'next/link';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';

export const metadata = { title: 'Oficinas' };
const AST: Record<string, [string, 'gray' | 'blue' | 'green' | 'red']> = {
  solicitada: ['Por confirmar', 'gray'], confirmada: ['Confirmada', 'green'], cancelada: ['Cancelada', 'red'], realizada: ['Realizada', 'blue'],
};

export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  let { data: offices } = await ctx.supabase.rpc('my_offices', { p_org: orgId });
  if (!offices?.length) { await ctx.supabase.rpc('ensure_offices', { p_org: orgId }); ({ data: offices } = await ctx.supabase.rpc('my_offices', { p_org: orgId })); }
  const { data: mine } = await ctx.supabase.from('appointments').select('*, offices(name, code, icon)').eq('requester_id', ctx.user.id)
    .gte('starts_at', new Date(Date.now() - 7 * 864e5).toISOString()).order('starts_at').limit(30);
  const list = (offices ?? []) as any[];
  const my = list.filter((o) => o.is_member);
  const others = list.filter((o) => !o.is_member && o.accepts_appointments);

  return (
    <>
      <PageHeader title="Oficinas" subtitle="Cada equipo tiene su oficina: mesa de discusión, integrantes y agenda de citas" />
      {my.length > 0 && (
        <>
          <h2 className="mb-3 text-lg font-bold">Mis oficinas</h2>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {my.map((o) => (
              <Link key={o.id} href={`/app/oficinas/${o.code}`} className="card card-pad transition hover:-translate-y-0.5 hover:shadow-md">
                <p className="text-3xl">{o.icon}</p>
                <p className="mt-2 font-bold">{o.name}</p>
                <p className="text-xs text-slate-500">{o.description}</p>
                <p className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge>{o.members} integrante(s)</Badge>
                  {Number(o.pending_appointments) > 0 && <Badge color="red">{o.pending_appointments} cita(s) por confirmar</Badge>}
                </p>
              </Link>))}
          </div>
        </>)}
      <h2 className="mb-3 text-lg font-bold">📅 Agendar una cita</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {others.length ? others.map((o) => (
          <Link key={o.id} href={`/app/oficinas/${o.code}#agendar`} className="card card-pad flex items-center gap-3 transition hover:shadow-md">
            <span className="text-2xl">{o.icon}</span><span><b className="text-sm">{o.name}</b><span className="block text-xs text-slate-500">{o.attention_hours ?? 'Pedir hora'}</span></span>
          </Link>)) : <Empty>No hay otras oficinas con atención por citas.</Empty>}
      </div>
      <Card title="Mis citas">
        {mine?.length ? (
          <ul className="divide-y divide-slate-100">
            {mine.map((a: any) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>{a.offices?.icon} <b>{a.offices?.name}</b> · {fmtDateTime(a.starts_at)} · {a.topic}{a.staff_note && <span className="block text-xs text-slate-500">Nota de la oficina: {a.staff_note}</span>}</span>
                <span className="flex items-center gap-2"><Badge color={AST[a.status][1]}>{AST[a.status][0]}</Badge>
                  <Link className="link text-xs" href={`/app/oficinas/${a.offices?.code}`}>Ver</Link></span>
              </li>))}
          </ul>) : <Empty>No tiene citas próximas.</Empty>}
      </Card>
    </>
  );
}
