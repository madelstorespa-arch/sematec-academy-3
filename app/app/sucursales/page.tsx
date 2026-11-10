import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm, Field } from '@/components/forms';
import { fmtMoney } from '@/lib/format';
import { switchBranch } from '../actions';
import { saveBranch } from './actions';

export const metadata = { title: 'Sucursales' };
type D = { campus_id: string | null; name: string; city: string | null; sales_today: number; sales_month: number; sales_count_month: number;
  tuition_month: number; expenses_month: number; students: number; low_stock: number; open_cash: number };

/** 🏢 Cada sucursal como un sistema propio: ventas, aranceles, gastos, estudiantes, stock y cajas; el dueño ve todas. */
export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  if (!ctx.campuses.length || !(ctx.isOwner || can(ctx, 'reports.view') || can(ctx, 'store.edit') || can(ctx, 'finance.view'))) redirect('/app');
  const [{ data, error }, { data: info }] = await Promise.all([
    ctx.supabase.rpc('campus_dashboard', { p_org: orgId }),
    ctx.supabase.from('campuses').select('id, code, name, city, address, phone, email, receipt_footer, store_enabled').eq('organization_id', orgId).order('name'),
  ]);
  const rows = (data ?? []) as D[];
  const det = new Map((info ?? []).map((c: any) => [c.id, c]));
  const sum = (k: keyof D) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return (
    <>
      <PageHeader title="🏢 Sucursales" subtitle="Cada sucursal tiene sus propios estudiantes, caja, productos y stock, ventas y gastos. Elija una en el menú para trabajar solo con ella." />
      {error && <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
      {rows.length > 1 && (
        <div className="card card-pad mb-6 grid gap-3 text-sm sm:grid-cols-5" data-testid="total-sucursales">
          <div><p className="text-xs text-slate-500">Ventas hoy (todas)</p><p className="text-xl font-bold">{fmtMoney(sum('sales_today'))}</p></div>
          <div><p className="text-xs text-slate-500">Ventas del mes</p><p className="text-xl font-bold">{fmtMoney(sum('sales_month'))}</p></div>
          <div><p className="text-xs text-slate-500">Aranceles del mes</p><p className="text-xl font-bold">{fmtMoney(sum('tuition_month'))}</p></div>
          <div><p className="text-xs text-slate-500">Gastos del mes</p><p className="text-xl font-bold">{fmtMoney(sum('expenses_month'))}</p></div>
          <div><p className="text-xs text-slate-500">Resultado del mes</p><p className="text-xl font-bold">{fmtMoney(sum('sales_month') + sum('tuition_month') - sum('expenses_month'))}</p></div>
        </div>)}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const c = r.campus_id ? det.get(r.campus_id) : null;
          const result = Number(r.sales_month) + Number(r.tuition_month) - Number(r.expenses_month);
          return (
            <div key={r.campus_id ?? 'general'} className={`card card-pad ${ctx.campusId && ctx.campusId === r.campus_id ? 'ring-2 ring-brand-600' : ''}`} data-testid="tarjeta-sucursal">
              <div className="flex items-start justify-between gap-2">
                <div><h2 className="text-lg font-bold">{r.name}</h2><p className="text-xs text-slate-500">{[c?.city, c?.address].filter(Boolean).join(' · ')}</p></div>
                {c && !c.store_enabled && <Badge color="gray">Tienda cerrada</Badge>}
                {Number(r.open_cash) > 0 && <Badge color="green">🟢 {r.open_cash} caja(s) abiertas</Badge>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-slate-500">Ventas hoy</dt><dd className="text-right font-semibold">{fmtMoney(r.sales_today)}</dd>
                <dt className="text-slate-500">Ventas del mes</dt><dd className="text-right">{fmtMoney(r.sales_month)} <span className="text-xs text-slate-400">({r.sales_count_month})</span></dd>
                <dt className="text-slate-500">Aranceles del mes</dt><dd className="text-right">{fmtMoney(r.tuition_month)}</dd>
                <dt className="text-slate-500">Gastos del mes</dt><dd className="text-right">{fmtMoney(r.expenses_month)}</dd>
                <dt className="font-semibold">Resultado</dt><dd className={`text-right font-bold ${result < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtMoney(result)}</dd>
                <dt className="text-slate-500">Estudiantes activos</dt><dd className="text-right">{r.students}</dd>
                <dt className="text-slate-500">Productos con stock bajo</dt><dd className={`text-right ${Number(r.low_stock) ? 'text-amber-700' : ''}`}>{r.low_stock}</dd>
              </dl>
              {r.campus_id && !ctx.campusFixed && (
                <form action={switchBranch} className="mt-3"><input type="hidden" name="branch" value={r.campus_id} />
                  <button className="btn-secondary btn-sm w-full">{ctx.campusId === r.campus_id ? '✓ Trabajando en esta sucursal' : 'Trabajar en esta sucursal →'}</button></form>)}
              {ctx.isOwner && c && (
                <details className="mt-2 text-sm"><summary className="cursor-pointer text-slate-500">⚙ Datos de la sucursal</summary>
                  <ActionForm action={saveBranch} submitLabel="Guardar" resetOnSuccess={false} className="mt-2">
                    <input type="hidden" name="id" value={c.id} />
                    <Field label="Teléfono" name="phone" defaultValue={c.phone} /><Field label="Correo" name="email" type="email" defaultValue={c.email} />
                    <Field label="Dirección" name="address" defaultValue={c.address} />
                    <Field label="Pie de las boletas de esta sucursal" name="receipt_footer" defaultValue={c.receipt_footer} placeholder="Ej.: Gracias por su compra · Horario 9 a 20 h" />
                    <label className="flex items-center gap-2"><input type="hidden" name="store_enabled" value="off" /><input type="checkbox" name="store_enabled" value="on" defaultChecked={c.store_enabled} /> Tienda abierta en esta sucursal</label>
                  </ActionForm></details>)}
            </div>);
        })}
      </div>
      {!rows.length && <Empty>No hay sucursales.</Empty>}
      {ctx.isOwner && <p className="mt-6 text-sm text-slate-600">➕ Para crear una sucursal nueva: <Link className="link" href="/app/configuracion?t=institucion">Configuración → Todo el sistema → Sedes</Link>. Para que una persona trabaje solo en una sucursal, asígnele su rol con esa sede en <Link className="link" href="/app/usuarios">Usuarios y roles</Link>.</p>}
    </>
  );
}
