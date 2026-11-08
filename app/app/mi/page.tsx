import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge, Badge } from '@/components/ui';
import { PayInstallments } from '@/components/pay-installments';
import { availableProviders } from '@/lib/payments';
import { payInstallments } from '@/app/app/pagar/actions';
import { WEEKDAYS, fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtSlot } from '@/lib/format';

export const metadata = { title: 'Mi portal' };

export default async function Page() {
  const ctx = await getContext();
  if (!ctx.studentId) notFound();
  const sb = ctx.supabase;
  const sid = ctx.studentId;
  const [{ data: sections }, { data: grades }, { data: att }, { data: balance }, { data: inst }, { data: certs }, { data: confs }] = await Promise.all([
    sb.from('section_enrollments').select('section_id, status, sections(id, code, courses(code, name), teachers(first_names, last_names), section_schedules(weekday, time_slot, rooms(code)))').eq('student_id', sid).neq('status', 'dropped'),
    sb.from('grades').select('grade, assessments(name, weight_pct, section_id)').eq('student_id', sid),
    sb.from('attendance_records').select('status, class_sessions(section_id)').eq('student_id', sid),
    sb.from('account_balances').select('*').eq('student_id', sid),
    sb.from('installment_balances').select('*').eq('student_id', sid).gt('outstanding', 0).eq('cancelled', false).order('due_on').limit(24),
    sb.from('certificates').select('id, title, serial_number, status, issued_at').eq('student_id', sid).order('issued_at', { ascending: false }),
    sb.from('conference_sessions').select('id, title, scheduled_start, timezone, status').in('status', ['scheduled', 'live']).gte('scheduled_end', new Date().toISOString()).order('scheduled_start').limit(5),
  ]);
  const pct = (sec: string) => {
    const rows = (att ?? []).filter((a: any) => a.class_sessions?.section_id === sec && a.status !== 'excused');
    return rows.length ? Math.round((100 * rows.filter((a: any) => a.status === 'present' || a.status === 'late').length) / rows.length) : null;
  };
  return (
    <>
      <PageHeader title="Mi portal" subtitle="Asignaturas, notas, asistencia, estado de cuenta y certificados" />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {(sections ?? []).length === 0 && <Empty>No tiene asignaturas inscritas.</Empty>}
          {(sections ?? []).map((x: any) => {
            const s = x.sections; const g = (grades ?? []).filter((r: any) => r.assessments?.section_id === s.id); const p = pct(s.id);
            return (
              <Card key={s.id} title={`${s.courses.code} · ${s.courses.name} (${s.code})`} actions={<StatusBadge status={x.status} />}>
                <p className="mb-3 text-sm text-slate-600">Profesor: {s.teachers ? `${s.teachers.first_names} ${s.teachers.last_names}` : '—'} · {s.section_schedules?.map((h: any) => `${WEEKDAYS[h.weekday]} ${fmtSlot(h.time_slot)}${h.rooms ? ` (${h.rooms.code})` : ''}`).join(' · ')}</p>
                <div className="flex flex-wrap gap-6 text-sm">
                  <div><p className="label">Notas publicadas</p>{g.length ? <ul>{g.map((r: any, i: number) => <li key={i}>{r.assessments.name} ({r.assessments.weight_pct} %): <b>{fmtNum(r.grade)}</b></li>)}</ul> : <span className="text-slate-500">Aún sin notas</span>}</div>
                  <div><p className="label">Asistencia</p><b className={p != null && p < 75 ? 'text-red-600' : ''}>{p != null ? `${p} %` : '—'}</b></div>
                </div>
              </Card>);
          })}
        </div>
        <div className="space-y-6">
          <Card title="Estado de cuenta">
            {balance?.length ? balance.map((b: any) => <p key={b.account_id} className="text-sm">Saldo: <b>{fmtMoney(b.outstanding, b.currency)}</b>{Number(b.overdue) > 0 && <> · <span className="text-red-600">vencido {fmtMoney(b.overdue, b.currency)}</span></>}</p>) : <p className="text-sm text-slate-500">Sin deuda.</p>}
            {!!inst?.length && <PayInstallments studentId={sid} items={inst as any[]} providers={availableProviders(inst[0].currency)} action={payInstallments} />}
            <Link className="link mt-3 inline-block text-sm" href={`/app/finanzas/cuenta/${sid}`}>Ver detalle →</Link>
          </Card>
          <Card title="Clases virtuales">
            {confs?.length ? <ul className="space-y-2 text-sm">{confs.map((c: any) => <li key={c.id} className="flex items-center justify-between gap-2"><span>{c.title}<br /><span className="text-xs text-slate-500">{fmtDateTime(c.scheduled_start, c.timezone)}</span></span><Link className="btn-primary btn-sm" href={`/app/conferencias/sala/${c.id}`}>Entrar</Link></li>)}</ul> : <p className="text-sm text-slate-500">Sin clases programadas.</p>}
          </Card>
          <Card title="Mis certificados">
            {certs?.length ? <ul className="space-y-1 text-sm">{certs.map((c: any) => <li key={c.id} className="flex justify-between gap-2"><Link className="link" href={`/app/certificados/${c.id}`}>{c.title}</Link>{c.status === 'revoked' ? <Badge color="red">Revocado</Badge> : <span className="flex items-center gap-2 text-xs text-slate-500">{fmtDate(c.issued_at)}<a className="link" href={`/app/certificados/${c.id}/pdf`} download>⬇ PDF</a></span>}</li>)}</ul> : <p className="text-sm text-slate-500">Sin certificados.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
