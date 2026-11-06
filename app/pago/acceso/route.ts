import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resultToken } from '@/lib/payments';

/**
 * Tras pagar, quien compró con una cuenta NUEVA crea su contraseña.
 * Enlace de un solo uso, protegido por la firma del resultado del pago.
 * Es una navegación completa (no una Server Action) para que el navegador reciba las cookies de sesión.
 */
export async function POST(request: NextRequest) {
  const fd = await request.formData();
  const id = String(fd.get('order') ?? ''); const t = String(fd.get('t') ?? '');
  const to = (p: string) => NextResponse.redirect(new URL(p, request.url), { status: 303 });
  if (!/^[0-9a-f-]{36}$/.test(id) || t !== resultToken(id)) return to('/');
  const admin = createAdminClient();
  const { data: o } = await admin.from('checkout_orders').select('buyer_email, status, access_link_used, user_id').eq('id', id).single();
  if (!o || o.status !== 'paid' || o.access_link_used || !o.user_id) return to('/login');
  const { data: u } = await admin.auth.admin.getUserById(o.user_id);
  if (u.user?.user_metadata?.created_from_order !== id) return to('/login');
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: o.buyer_email });
  if (error || !data.properties?.hashed_token) return to('/recuperar');
  await admin.from('checkout_orders').update({ access_link_used: true }).eq('id', id);
  return to(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery`);
}
