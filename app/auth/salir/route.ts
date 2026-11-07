import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  const res = NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  // Borra del dispositivo las páginas guardadas para uso sin conexión (equipos compartidos)
  res.headers.set('Clear-Site-Data', '"cache"');
  return res;
}
