import { Tabs } from '@/components/ui';
export function StoreTabs({ current }: { current: string }) {
  return <Tabs current={current} items={[
    { key: 'resumen', label: '📊 Resumen', href: '/app/tienda' },
    { key: 'caja', label: '🧾 Caja', href: '/app/tienda/caja' },
    { key: 'productos', label: '📦 Productos', href: '/app/tienda/productos' },
    { key: 'ofertas', label: '🏷 Ofertas y cupones', href: '/app/tienda/ofertas' },
    { key: 'pedidos', label: '🛍 Pedidos web', href: '/app/tienda/pedidos' },
    { key: 'ventas', label: '💰 Ventas', href: '/app/tienda/ventas' },
    { key: 'compras', label: '📥 Compras', href: '/app/tienda/compras' },
    { key: 'cierre', label: '💵 Apertura y cierre', href: '/app/tienda/cierre' },
    { key: 'clientes', label: '👥 Clientes', href: '/app/tienda/clientes' },
    { key: 'reportes', label: '📈 Reportes', href: '/app/tienda/reportes' },
  ]} />;
}
