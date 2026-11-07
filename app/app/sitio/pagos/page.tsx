import { getContext, requirePerm } from '@/lib/context';
import { PageHeader, Card, Badge } from '@/components/ui';
import { PROVIDERS } from '@/lib/payments';
import { env } from '@/lib/env';
import { SiteTabs } from '../tabs';

export const metadata = { title: 'Medios de pago' };

const VARS: Record<string, { vars: string[]; panel: string; webhook?: boolean }> = {
  fintoc: { vars: ['FINTOC_SECRET_KEY'], panel: 'Fintoc Dashboard → API Keys (sk_test_… para pruebas, sk_live_… para cobros reales) y Webhooks (eventos checkout_session.finished y checkout_session.expired).', webhook: true },
  webpay: { vars: ['WEBPAY_ENABLED=1', 'WEBPAY_ENV=production', 'WEBPAY_COMMERCE_CODE', 'WEBPAY_API_KEY'], panel: 'Transbank Developers → comercio Webpay Plus. En pruebas basta WEBPAY_ENABLED=1 (usa las credenciales públicas de integración).' },
  mercadopago: { vars: ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET'], panel: 'Mercado Pago Developers → Tus integraciones → Credenciales y Webhooks (evento «Pagos»).', webhook: true },
  flow: { vars: ['FLOW_API_KEY', 'FLOW_SECRET_KEY', 'FLOW_ENV=production'], panel: 'Flow → Integraciones → Datos de API. La URL de confirmación se envía en cada pago.' },
  stripe: { vars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], panel: 'Stripe Dashboard → Developers → API keys y Webhooks (eventos checkout.session.*).', webhook: true },
};

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'settings.admin');
  const site = env.siteUrl();
  return (
    <>
      <PageHeader title="Sitio web y marca" subtitle="Medios de pago en línea" />
      <SiteTabs current="pagos" />
      <p className="mb-6 max-w-3xl text-sm text-slate-600">Por seguridad, las claves de los medios de pago <b>no se guardan en la base de datos ni se escriben aquí</b>: se cargan como variables de entorno del servidor (Vercel → Settings → Environment Variables). Un medio aparece en el sitio en cuanto sus variables están cargadas.</p>
      <div className="grid gap-6 lg:grid-cols-2">
        {Object.values(PROVIDERS).map((p) => (
          <Card key={p.id} title={p.label} actions={p.enabled() ? <Badge color="green">Activo</Badge> : <Badge>No configurado</Badge>}>
            <p className="text-sm text-slate-600">{p.description} · Monedas: {p.currencies.join(', ')}</p>
            <p className="mt-3 text-xs font-bold uppercase text-slate-500">Variables</p>
            <ul className="mt-1 font-mono text-xs">{VARS[p.id].vars.map((v) => <li key={v}>{v}</li>)}</ul>
            <p className="mt-3 text-xs text-slate-500">{VARS[p.id].panel}</p>
            {VARS[p.id].webhook && <p className="mt-2 text-xs">URL de notificaciones: <code className="break-all">{site}/api/pago/webhook/{p.id}</code></p>}
          </Card>
        ))}
      </div>
    </>
  );
}
