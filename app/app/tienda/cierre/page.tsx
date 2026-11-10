import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader, Card, Empty, Badge, Stat } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { methodLabel } from '@/lib/store';
import { StoreTabs } from '../tabs';
import { closeCash, openCash } from '../actions';

export const metadata = { title: 'Apertura y cierre de caja' };

/** 💵 Apertura y cierre de caja (arqueo): dinero inicial, ventas del turno, efectivo esperado, contado y diferencia. */
export default async function Page() {
  const ctx = await getContext();
  if (!can(ctx, 'store.view') && !can(ctx, 'store.create')) redirect('/app');
  const orgId = requireOrg(ctx);
  const [{ data: st }, hist] = await Promise.all([
    ctx.supabase.rpc('cash_status', { p_org: orgId }),
    ctx.supabase.from('cash_sessions').select('*, campuses(name)').eq('organization_id', orgId).match(ctx.campusId ? { campus_id: ctx.campusId } : {})
      .order('opened_at', { ascending: false }).limit(100),
  ]);
  const s = st as null | { id: string; opened_at: string; opening: number; count: number; total: number; cash: number; expected: number; by_method: Record<string, number>; campus: string | null };
  const rows = (hist.data ?? []) as any[];
  const last = rows.find((r) => r.closed_at && r.opened_by === ctx.user.id && Date.now() - new Date(r.closed_at).getTime() < 12 * 3600000);
  const ids = [...new Set(rows.flatMap((r) => [r.opened_by, r.closed_by]).filter(Boolean))];
  const { data: people } = ids.length ? await createAdminClient().from('profiles').select('id, full_name, id_document_number').in('id', ids) : { data: [] };
  const who = new Map((people ?? []).map((p: any) => [p.id, `${p.full_name}${p.id_document_number ? ` · ${p.id_document_number}` : ''}`]));
  return (
    <>
      <PageHeader title="SEMATEC VENTA" subtitle={`Apertura y cierre de caja${ctx.campusName ? ` · Sucursal ${ctx.campusName}` : ''}`} />
      <StoreTabs current="cierre" />
      <div className="grid gap-6 xl:grid-cols-[26rem_1fr]">
        <div className="space-y-6">
        {!s && last && (
          <Card title="🔒 Último cierre de mi caja">
            <div className="text-sm" data-testid="ultimo-cierre">
              <p className="text-slate-600">{fmtDateTime(last.closed_at)} · {last.sales_count} venta(s) por {fmtMoney(last.sales_total)}</p>
              <p className="mt-2">Efectivo esperado <b>{fmtMoney(last.expected_cash)}</b> · contado <b>{fmtMoney(last.counted_cash)}</b></p>
              <p className={`mt-2 rounded-lg px-3 py-2 font-semibold ${Number(last.difference) === 0 ? 'bg-emerald-50 text-emerald-800' : Number(last.difference) > 0 ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-800'}`}>
                {Number(last.difference) === 0 ? '✓ La caja cuadra perfecto' : Number(last.difference) > 0 ? `Sobran ${fmtMoney(last.difference)}` : `Faltan ${fmtMoney(-Number(last.difference))}`}</p>
            </div>
          </Card>)}
        <Card title={s ? '🟢 Mi caja está abierta' : '💵 Abrir mi caja'}>
          {s ? (
            <div className="space-y-4" data-testid="caja-abierta">
              <p className="text-sm text-slate-600">Desde {fmtDateTime(s.opened_at)}{s.campus ? ` · ${s.campus}` : ''} · dinero inicial {fmtMoney(s.opening)}</p>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Ventas del turno" value={String(s.count)} />
                <Stat label="Total vendido" value={fmtMoney(s.total)} />
                <Stat label="Ventas en efectivo" value={fmtMoney(s.cash)} />
                <Stat label="Efectivo esperado" value={fmtMoney(s.expected)} hint="Inicial + ventas en efectivo" />
              </div>
              {Object.keys(s.by_method ?? {}).length > 0 && <p className="text-xs text-slate-500">{Object.entries(s.by_method).map(([m, t]) => `${methodLabel(m)}: ${fmtMoney(t)}`).join(' · ')}</p>}
              <ActionForm action={closeCash} submitLabel="🔒 Cerrar caja" confirm="¿Cerrar la caja? Se guardará el arqueo con la diferencia.">
                <input type="hidden" name="id" value={s.id} />
                <label className="block"><span className="label">Dinero contado en la caja</span>
                  <input name="counted" type="number" min={0} step="1" required className="input text-lg" placeholder="Cuente billetes y monedas" data-testid="dinero-contado" /></label>
                <label className="block"><span className="label">Observación (opcional)</span><input name="notes" maxLength={500} className="input" /></label>
              </ActionForm>
            </div>
          ) : (
            <ActionForm action={openCash} submitLabel="▶ Abrir caja">
              <label className="block"><span className="label">Dinero inicial (sencillo para dar vuelto)</span>
                <input name="amount" type="number" min={0} step="1" required className="input text-lg" defaultValue="0" data-testid="dinero-inicial" /></label>
              <label className="block"><span className="label">Observación (opcional)</span><input name="notes" maxLength={500} className="input" /></label>
              <p className="text-xs text-slate-500">Al cerrar, el sistema calcula cuánto efectivo debería haber y lo compara con lo que usted cuenta.</p>
            </ActionForm>
          )}
        </Card>
        </div>
        <Card title={`Historial de cajas (${rows.length})`}>
          {rows.length ? <div className="overflow-x-auto"><table className="table" data-testid="historial-cajas">
            <thead><tr><th>Apertura</th><th>Cajero(a)</th>{ctx.campuses.length > 0 && <th>Sucursal</th>}<th className="text-right">Inicial</th><th className="text-right">Ventas</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferencia</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(r.opened_at)}{r.closed_at ? <span className="block text-slate-400">cierre {fmtDateTime(r.closed_at)}</span> : <Badge color="green">Abierta</Badge>}</td>
                <td className="text-xs">{who.get(r.opened_by) ?? '—'}</td>
                {ctx.campuses.length > 0 && <td className="text-xs">{r.campuses?.name ?? '—'}</td>}
                <td className="text-right">{fmtMoney(r.opening_amount)}</td>
                <td className="text-right">{r.closed_at ? `${r.sales_count} · ${fmtMoney(r.sales_total)}` : '—'}</td>
                <td className="text-right">{r.closed_at ? fmtMoney(r.expected_cash) : '—'}</td>
                <td className="text-right">{r.closed_at ? fmtMoney(r.counted_cash) : '—'}</td>
                <td className={`text-right font-semibold ${!r.closed_at ? '' : Number(r.difference) === 0 ? 'text-emerald-700' : Number(r.difference) > 0 ? 'text-amber-700' : 'text-red-700'}`}>
                  {r.closed_at ? (Number(r.difference) === 0 ? '✓ 0' : `${Number(r.difference) > 0 ? '+' : ''}${fmtMoney(r.difference)}`) : ''}</td>
              </tr>))}</tbody></table></div> : <Empty>Aún no hay cajas abiertas.</Empty>}
        </Card>
      </div>
    </>
  );
}
