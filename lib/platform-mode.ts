/**
 * 🎥 Plataformas «solo aula virtual»: organizaciones externas que usan el aula con sus propios datos.
 * Estos módulos administrativos no forman parte de ese tipo de plataforma.
 */
export const AULA_EXCLUDED = [
  '/app/finanzas', '/app/tienda', '/app/sucursales', '/app/boletas', '/app/pagar', '/app/personal', '/app/inventario',
  '/app/reservas', '/app/punto-estudiantil', '/app/egresados', '/app/empleos', '/app/oficinas', '/app/admision',
  '/app/matriculas', '/app/credencial', '/app/apoderado', '/app/reportes',
];

export const aulaExcluded = (path: string) => AULA_EXCLUDED.some((p) => path === p || path.startsWith(p + '/'));
