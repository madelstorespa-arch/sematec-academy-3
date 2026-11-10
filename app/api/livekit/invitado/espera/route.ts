import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { issueGuestToken } from '@/lib/guest-token';

/** El invitado que está en la sala de espera consulta si ya lo admitieron. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const guest = String(b.guest ?? ''), invite = String(b.invite ?? '');
  if (!/^[0-9a-f-]{36}$/.test(guest) || !/^[A-Za-z0-9_-]{16,64}$/.test(invite)) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  const admin = createAdminClient();
  const { data: g } = await admin.from('conference_guests').select('id, conference_invites!inner(token)').eq('id', guest).maybeSingle();
  if (!g || (g.conference_invites as any)?.token !== invite) return NextResponse.json({ error: 'Acceso no válido' }, { status: 403 });
  const { data: st } = await admin.rpc('guest_entry_check', { p_guest: guest });
  if (st === 'waiting') return NextResponse.json({ waiting: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  if (st !== 'ok') return NextResponse.json({ error: st === 'locked' ? '🔒 El anfitrión bloqueó la sala.' : 'El anfitrión no admitió su ingreso.' }, { status: 403 });
  try { return NextResponse.json(await issueGuestToken(guest), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 403 }); }
}
