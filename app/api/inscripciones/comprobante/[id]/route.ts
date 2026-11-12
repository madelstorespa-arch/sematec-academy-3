import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** Ver el comprobante de pago de una inscripción (solo quien gestiona inscripciones o finanzas). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('No encontrado', { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', _req.url));
  const { data: q } = await supabase.from('registration_requests').select('receipt_path, receipt_name').eq('id', id).maybeSingle();
  if (!q?.receipt_path) return new NextResponse('No encontrado', { status: 404 });
  const { data } = await createAdminClient().storage.from('user-files').createSignedUrl(q.receipt_path, 120);
  if (!data?.signedUrl) return new NextResponse('No disponible', { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
