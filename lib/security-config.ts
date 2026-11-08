import 'server-only';

export type Check = { ok: boolean; level: 'ok' | 'warning' | 'critical'; title: string; detail: string };
const has = (k: string) => !!process.env[k] && String(process.env[k]).trim() !== '';

/**
 * Revisión de la configuración del servidor. Solo informa si cada ajuste está presente o no:
 * nunca muestra el valor de una clave.
 */
export function serverConfigChecks(): Check[] {
  const c: Check[] = [];
  const add = (ok: boolean, level: 'warning' | 'critical', title: string, okDetail: string, badDetail: string) =>
    c.push({ ok, level: ok ? 'ok' : level, title, detail: ok ? okDetail : badDetail });
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  add(!has('SETUP_TOKEN'), 'critical', 'Instalador /instalar', 'SETUP_TOKEN no está definido: nadie puede usar /instalar.',
    'SETUP_TOKEN sigue definido en Vercel: bórrelo y haga Redeploy apenas termine de instalar.');
  add(!has('WEBPAY_ENABLED') || process.env.WEBPAY_ENV === 'production', 'warning', 'Modo de prueba de pagos',
    'No hay medios de pago en modo de prueba.', 'WEBPAY_ENABLED activa Webpay en modo de PRUEBA (cobros ficticios). Bórrela si no está probando.');
  add(has('SUPABASE_SERVICE_ROLE_KEY'), 'critical', 'Clave de servicio solo en el servidor', 'La clave administrativa está configurada como variable del servidor.',
    'Falta SUPABASE_SERVICE_ROLE_KEY en Vercel.');
  add(!has('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY') && !has('NEXT_PUBLIC_SERVICE_ROLE_KEY'), 'critical', 'Ninguna clave secreta en el navegador',
    'No hay claves secretas con prefijo NEXT_PUBLIC_.', '¡Hay una clave secreta con prefijo NEXT_PUBLIC_ (visible para cualquiera)! Bórrela y rote la clave en Supabase.');
  add(!site || site.startsWith('https://'), 'warning', 'HTTPS obligatorio', 'El sitio usa HTTPS (HSTS activo).', 'NEXT_PUBLIC_SITE_URL no usa https://.');
  add(!has('DATABASE_URL') || has('SETUP_TOKEN'), 'warning', 'Conexión directa a la base solo durante la instalación',
    'DATABASE_URL no queda expuesta fuera de la instalación.', 'DATABASE_URL está definida aunque no se esté instalando. Es opcional borrarla (se vuelve a crear para la próxima instalación).');
  add(has('LIVEKIT_API_SECRET') === has('LIVEKIT_API_KEY'), 'warning', 'Videoconferencias', 'Claves de LiveKit completas o no usadas.', 'Falta la clave o el secreto de LiveKit.');
  add(!has('MERCADOPAGO_ACCESS_TOKEN') || has('MERCADOPAGO_WEBHOOK_SECRET'), 'warning', 'Firma de avisos de Mercado Pago',
    'Los avisos de pago se validan con firma.', 'Configure MERCADOPAGO_WEBHOOK_SECRET para validar los avisos de pago.');
  add(!has('STRIPE_SECRET_KEY') || has('STRIPE_WEBHOOK_SECRET'), 'warning', 'Firma de avisos de Stripe',
    'Los avisos de pago se validan con firma.', 'Configure STRIPE_WEBHOOK_SECRET para validar los avisos de pago.');
  return c;
}

/** Protecciones activas en la plataforma (informativo). */
export const PROTECTIONS: [string, string][] = [
  ['Identidad digital', 'MFA obligatorio para roles administrativos; bloqueo automático tras 5 intentos fallidos en 15 minutos; contraseñas fuertes elegidas por la institución.'],
  ['Acceso y permisos', 'Roles y permisos granulares; aislamiento por institución en la base de datos (RLS) en todas las tablas.'],
  ['Protección de datos', 'Base cifrada en reposo y en tránsito (Supabase); claves solo en variables del servidor; nada secreto en el navegador.'],
  ['Seguridad académica', 'Cambios de notas con motivo y auditoría; actas cerradas; certificados con huella SHA-256 y QR verificable.'],
  ['Seguridad financiera', 'Pagos confirmados servidor a servidor; montos verificados; operaciones idempotentes; sin datos de tarjeta en el sistema.'],
  ['Seguridad de API', 'Autorización en cada operación (RLS y funciones con verificación de permisos); límites de solicitudes en formularios públicos.'],
  ['Defensa perimetral', 'HTTPS con HSTS, CDN y protección DDoS de Vercel; cabeceras de seguridad (anti-clickjacking, nosniff).'],
  ['Auditoría', 'Registro inmutable y encadenado (cada evento firma al anterior) con verificación de integridad.'],
  ['Respaldo', 'Copias automáticas de Supabase (diarias en plan Pro, con restauración a un punto en el tiempo opcional).'],
];
