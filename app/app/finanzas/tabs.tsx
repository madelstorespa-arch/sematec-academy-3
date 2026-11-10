import { Tabs } from '@/components/ui';
export function FinanceTabs({ current }: { current: string }) {
  return <Tabs current={current} items={[
    { key: 'cuentas', label: 'Estados de cuenta', href: '/app/finanzas' },
    { key: 'balance', label: '📊 Ingresos y gastos', href: '/app/finanzas/balance' },
    { key: 'pagos', label: 'Pagos y boletas', href: '/app/finanzas/pagos' },
    { key: 'gastos', label: '💸 Gastos', href: '/app/finanzas/gastos' },
    { key: 'cargos', label: 'Cargos y cuotas', href: '/app/finanzas/cargos' },
    { key: 'becas', label: 'Becas y descuentos', href: '/app/finanzas/becas' },
  ]} />;
}
