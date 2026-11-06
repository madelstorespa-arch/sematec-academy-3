import { Tabs } from '@/components/ui';
export function FinanceTabs({ current }: { current: string }) {
  return <Tabs current={current} items={[
    { key: 'cuentas', label: 'Estados de cuenta', href: '/app/finanzas' },
    { key: 'pagos', label: 'Pagos', href: '/app/finanzas/pagos' },
    { key: 'cargos', label: 'Cargos y cuotas', href: '/app/finanzas/cargos' },
    { key: 'becas', label: 'Becas y descuentos', href: '/app/finanzas/becas' },
  ]} />;
}
