import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Abre la evaluación externa: valida inscripción y horario en la base de datos, registra el ingreso y redirige al enlace. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = (msg: string) => NextResponse.redirect(new URL(`/app/aula?aviso=${encodeURIComponent(msg)}`, req.url));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return back('Evaluación no válida.');
  try {
    const sb = await createClient();
    const { data, error } = await sb.rpc('open_external_evaluation', { p_id: id });
    if (error || typeof data !== 'string' || !/^https:\/\//.test(data)) return back(error?.message ?? 'No se pudo abrir la evaluación.');
    return NextResponse.redirect(data, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch {
    return back('No se pudo abrir la evaluación. Intente de nuevo.');
  }
}
