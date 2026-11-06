import { Tabs } from '@/components/ui';
export const SiteTabs = ({ current }: { current: string }) => <Tabs current={current} items={[
  { key: 'marca', label: 'Marca y contenido', href: '/app/sitio' },
  { key: 'cursos', label: 'Cursos y precios', href: '/app/sitio/cursos' },
  { key: 'pagos', label: 'Medios de pago', href: '/app/sitio/pagos' },
]} />;
