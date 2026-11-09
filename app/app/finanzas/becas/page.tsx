import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { OwnerActions } from '@/components/owner-actions';
import { PageHeader, Card, Empty, StatusBadge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { FinanceTabs } from '../tabs';
import { createBenefit } from '../actions';

export const metadata = { title: 'Becas y descuentos' };

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'finance.view');
  const orgId = requireOrg(ctx);
  const { data } = await ctx.supabase.from('benefits').select('*').eq('organization_id', orgId).order('name');
  return (
    <>
      <PageHeader title="Finanzas" subtitle="Becas, beneficios y descuentos" />
      <FinanceTabs current="becas" />
      {can(ctx, 'finance.admin') && (
        <Card title="Nuevo beneficio" className="mb-6">
          <ActionForm action={createBenefit} submitLabel="Crear beneficio">
            <Grid cols={4}>
              <Field label="Código" name="code" required /><Field label="Nombre" name="name" required />
              <SelectField label="Tipo" name="kind" required options={[{ value: 'percent', label: 'Porcentaje' }, { value: 'amount', label: 'Monto fijo' }]} />
              <Field label="Valor" name="value" type="number" step="0.01" min={0.01} required />
            </Grid>
          </ActionForm>
        </Card>
      )}
      <Card>{data?.length ? <table className="table"><thead><tr><th>Código</th><th>Nombre</th><th>Descuento</th><th>Estado</th>{ctx.isOwner && <th></th>}</tr></thead>
        <tbody>{data.map((b: any) => <tr key={b.id}><td className="font-mono text-xs">{b.code}</td><td>{b.name}</td><td>{b.percent_off ? `${b.percent_off} %` : b.amount_off}</td><td><StatusBadge status={b.status} /></td>{ctx.isOwner && <td><OwnerActions table="benefits" id={b.id} active={b.status === 'active'} path="/app/finanzas/becas" name={`el beneficio ${b.name}`} /></td>}</tr>)}</tbody></table>
        : <Empty>Sin beneficios configurados.</Empty>}</Card>
    </>
  );
}
