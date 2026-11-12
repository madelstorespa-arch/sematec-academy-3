import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { resultToken, PROVIDERS, processVerification } from '@/lib/payments';
import { fintocVerify, fintocPending } from '@/lib/payments/fintoc';
import { fmtDateTime, fmtMoney } from '@/lib/format';

export const metadata = { title: 'Resultado del pago', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string; cancelado?: string; error?: string }> }) {
  const { id } = await params;
  const { t, cancelado, error } = await searchParams;
  if (!t || t !== resultToken(id)) notFound();
  const admin = createAdminClient();
  let { data: o } = await admin.from('checkout_orders').select('*, catalog_offerings(title, slug), sales!checkout_orders_sale_id_fkey(tracking_code)').eq('id', id).maybeSingle();
  if (!o) notFound();
  // Transferencia bancaria aún en curso: se vuelve a consultar a Fintoc (por si el aviso no ha llegado)
  if (o.status === 'pending' && o.provider === 'fintoc' && o.provider_reference && !cancelado) {
    try {
      const v = await fintocVerify(o.provider_reference);
      if (!fintocPending(v.status)) {
        await processVerification('fintoc', { ...v, orderId: o.id });
        ({ data: o } = await admin.from('checkout_orders').select('*, catalog_offerings(title, slug), sales!checkout_orders_sale_id_fkey(tracking_code)').eq('id', id).maybeSingle());
        if (!o) notFound();
      }
    } catch (e) { console.error('consulta Fintoc', e); }
  }
  let newAccount = false;
  if (o.status === 'paid' && o.user_id && !o.access_link_used) {
    const { data } = await admin.auth.admin.getUserById(o.user_id);
    newAccount = data.user?.user_metadata?.created_from_order === id;
  }
  const paid = o.status === 'paid';
  const cuotas = o.kind === 'installments';
  const tienda = o.kind === 'store';
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      {o.status === 'pending' && !cancelado && <meta httpEquiv="refresh" content="4" />}
      <div className={`rounded-3xl border-2 p-8 ${paid ? 'border-emerald-300 bg-emerald-50' : o.status === 'pending' && !cancelado ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
        <p className="text-sm font-semibold text-slate-600">Pedido N° {o.order_number} · {PROVIDERS[o.provider as keyof typeof PROVIDERS]?.label ?? o.provider}</p>
        <h1 className="mt-1 text-2xl font-black">
          {paid ? (tienda ? '¡Pago aprobado! Estamos preparando tu pedido' : cuotas ? '¡Pago aprobado! Tus cuotas quedaron pagadas' : '¡Pago aprobado! Ya estás inscrito') : o.status === 'pending' && !cancelado ? 'Confirmando el pago…' : cancelado ? 'Pago anulado' : 'El pago no fue aprobado'}
        </h1>
        <dl className="mt-5 space-y-1 text-sm">
          <div className="flex justify-between"><dt>{cuotas || tienda ? 'Concepto' : 'Curso'}</dt><dd className="font-semibold">{tienda ? 'Compra en la tienda' : cuotas ? `Pago de ${o.installment_ids?.length ?? ''} cuota(s)` : o.catalog_offerings?.title}</dd></div>
          <div className="flex justify-between"><dt>Monto</dt><dd className="font-semibold">{fmtMoney(o.amount, o.currency)}</dd></div>
          <div className="flex justify-between"><dt>Código de seguimiento</dt><dd className="font-mono font-semibold">{o.tracking_code}</dd></div>
          {o.paid_at && <div className="flex justify-between"><dt>Fecha de pago</dt><dd>{fmtDateTime(o.paid_at)}</dd></div>}
          <div className="flex justify-between"><dt>Correo</dt><dd>{o.buyer_email}</dd></div>
        </dl>
        {o.kind === 'offering' && o.plan === 'matricula' && (
          <p className="mt-4 rounded-xl bg-white/70 p-3 text-sm" data-testid="aviso-cuotas">
            {paid ? 'Pagaste la matrícula. ' : 'Este pago corresponde solo a la matrícula. '}
            El arancel del programa ({fmtMoney(o.course_amount ?? 0, o.currency)}) queda en {o.plan_installments} cuota(s) mensual(es) que pagas en línea desde <b>Mi portal → Mis pagos</b>.
          </p>
        )}
        {paid && newAccount && !tienda && (
          <form action="/pago/acceso" method="post" className="mt-6">
            <input type="hidden" name="order" value={o.id} /><input type="hidden" name="t" value={t} />
            <p className="mb-3 text-sm">Creamos tu cuenta con el correo {o.buyer_email}. Define tu contraseña para entrar a la plataforma:</p>
            <button className="btn-primary w-full">Crear mi contraseña y entrar</button>
          </form>
        )}
        {paid && tienda && <Link href={`/tienda/pedido/${(o as any).sales?.tracking_code ?? ''}`} className="btn-primary mt-6 w-full">Ver mi pedido</Link>}
        {paid && !newAccount && !tienda && <Link href={cuotas ? '/app/mi' : '/login'} className="btn-primary mt-6 w-full">{cuotas ? 'Volver a mi portal' : 'Ingresar a la plataforma'}</Link>}
        {!paid && (o.status !== 'pending' || cancelado) && (
          <div className="mt-6 space-y-2 text-sm">
            <p>No se realizó ningún cargo{error ? ' confirmado' : ''}. Puedes intentarlo nuevamente.</p>
            <Link href={tienda ? '/tienda' : cuotas ? '/app/mi' : `/cursos/${o.catalog_offerings?.slug}/inscripcion${o.application_id ? `?codigo=${o.tracking_code}` : ''}`} className="btn-primary">Reintentar el pago</Link>
          </div>
        )}
      </div>
      <p className="mt-6 text-center text-sm text-slate-500">Guarda tu código <b>{o.tracking_code}</b>. Puedes revisar el estado en <Link className="link" href="/estado">Estado de solicitud</Link>.</p>
    </main>
  );
}
